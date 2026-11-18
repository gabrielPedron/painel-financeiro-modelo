# Contexto do projeto para a IA

> O Claude Code lê este arquivo pelo AGENTS.md. Onde o sistema roda e como publicar estão no AGENTS.md.

---

## O que é o sistema

Painel financeiro para vendedores de marketplace. Conecta na conta do Mercado Livre e mostra, venda a venda, a receita real, tudo que o marketplace descontou (comissão, frete, parcelamento, processamento), o imposto, o custo do produto e a publicidade, chegando ao resultado líquido. O objetivo é responder "essa venda deu lucro?", não apenas "quanto eu faturei?".

Público: donos de operação de e-commerce, sem conhecimento técnico.

## Stack

- **TanStack Start** (framework full-stack com rotas em arquivo, em `src/routes`)
- **React** + **TypeScript**
- **Tailwind CSS** (tokens de tema em `src/styles.css`; tema escuro é o principal)
- **Supabase** para banco de dados (PostgreSQL) e autenticação
- Integração com as **APIs do Mercado Livre e do Mercado Pago**
- Lógica de servidor em `createServerFn` e em rotas de API sob `src/routes/api`

## Principais tabelas

| Tabela | O que guarda |
| --- | --- |
| `ml_orders` | Os pedidos vendidos: número do pedido, data, valor, status (inclusive cancelados). |
| `ml_order_items` | Os itens de cada pedido: qual anúncio, qual SKU, quantidade e preço. |
| `mp_payments` | Os pagamentos recebidos: valor bruto, tarifas, valor líquido e a data em que o dinheiro é liberado. |
| `ml_billing_details` | As cobranças que o Mercado Livre faz: comissão, frete, parcelamento, taxa de processamento, bônus. |
| `ml_ads_daily` | O gasto com publicidade, por anúncio e por dia. |
| `product_skus` | Os produtos e seus custos, incluindo kits (compostos por outros produtos). |
| `account_tax_rates` | A alíquota de imposto da empresa, com data de início e fim de vigência. |
| `marketplace_accounts` | As contas de marketplace conectadas, com o estado da integração. |

## Principais funções do banco

| Função | O que faz |
| --- | --- |
| `mp_reconciliation` | Monta a conciliação venda a venda: receita, cada tarifa, imposto, custo do produto, publicidade rateada e resultado. É a fonte de verdade do cálculo. |
| `mp_reconciliation_summary` | Totais do período; consome a `mp_reconciliation`, não recalcula por conta própria. |
| `ml_metrics` | Indicadores agregados da operação de Mercado Livre. |
| `dashboard_kpis` | Os números principais do Dashboard. |
| `dashboard_dre_tree` | A estrutura de receitas e despesas em formato de DRE para o Dashboard. |
| `anuncios_margem` | Margem por anúncio, usada na tela de Anúncios. |
| `conc_recebimentos` | O que já foi liberado, o que ainda vai cair e o que foi estornado. |
| `conc_divergencias` | Casos que não fecham: tarifa de pedido cancelado, tarifa sem venda, venda com faturamento pendente, venda sem custo. |

---

## REGRAS DE OURO — respeite ao alterar este projeto

1. **Nunca chamar a API do Mercado Livre pelo navegador.** Chaves, segredos e tokens só existem no servidor. Toda chamada externa passa por função de servidor ou rota de API.
2. **Nunca apagar dados de faturamento para reinserir.** A gravação usa identificador único e faz *upsert* (atualiza se existe, insere se não existe). Uma coleta incompleta jamais pode destruir dado bom que já estava salvo.
3. **Nunca somar a mesma tarifa vinda de duas fontes.** Cada custo entra uma única vez: do faturamento quando existe lançamento daquele componente; do pagamento apenas quando não existe lançamento nenhum. Nunca os dois somados.
4. **A receita de cada venda é derivada do líquido recebido mais as tarifas** (`net_received_amount + fee_total`), porque cupons muitas vezes são bancados pelo Mercado Livre e não pelo vendedor. **Não use o valor pago pelo comprador (`total_paid_amount`) como receita** — ele subestima o resultado.
5. **Custo de produto é versionado por data.** Para mudar um custo, crie uma nova vigência. Nunca sobrescreva o valor antigo, senão a margem de meses passados é reescrita e os relatórios históricos mudam sozinhos.
6. **Quando faltar dado, mostre traço ou aviso — nunca zero.** Zero parece um número verdadeiro e leva o usuário a decidir errado. Vendas sem custo cadastrado ficam sinalizadas, não viram custo zero.
7. **Não crie, altere ou apague tabelas sem pedir confirmação** ao usuário antes.

---

## Coisas que já foram resolvidas e não devem ser refeitas

- **Taxa de processamento:** o `CVVPRC` do faturamento e o `mp_fee` do pagamento são a mesma taxa vista por duas fontes. Já são tratados como um único custo; não somar os dois.
- **Frete:** em parte das vendas o frete não aparece no faturamento e só existe no pagamento. Já existe um *fallback* por componente que usa o pagamento apenas nesse caso.
- **Data de liberação do dinheiro:** vem do campo de *release* do pagamento (`money_release_date`). O campo `released` não é confiável e não deve ser usado como critério.
- **Pedidos cancelados** ficam fora de todos os cálculos; `partially_refunded` entra abatendo o valor reembolsado. O cancelamento de pedido de outro dia chega pela reconsulta de 7 dias a cada 3 horas (`ml-recheck-7d-3h`, desde 17/11/2026) e pela de 30 dias da madrugada: o `/orders/search` não filtra por data de atualização.
- **Preço médio (tela Anúncios)** = `valor_produto` ÷ unidades (Σ preço unitário × quantidade, sem frete). Não use receita ÷ unidades: a receita traz o frete pago pelo comprador. No pedido em carrinho, o Mercado Pago desconta do vendedor também o frete do comprador, que paga fora do pedido: é custo real, não erro.
- **Publicidade (ADS):** a fonte única é `ml_ads_daily`, rateada por unidade vendida do anúncio no dia. O `MCLICS` do faturamento é excluído para não duplicar.
- **Alertas do Telegram** não consideram ADS de propósito, para evitar falso positivo, e nunca disparam para vendas anteriores à ativação dos alertas.
