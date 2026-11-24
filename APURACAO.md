# Apuração do primeiro mês (para a IA)

A primeira tarefa depois que o Mercado Livre conecta. Até ela terminar, nenhum número do sistema
serve para decisão: a instalação prova que o sistema liga, a apuração prova que ele conta certo.

## Quando começar

Quando `node scripts/conferir.mjs` mostrar o Mercado Livre conectado e a fila de sincronização sem
itens `pendente`. A primeira carga leva de minutos a horas: se ainda houver fila, diga ao dono
quando voltar e pare.

## O mês

Um **mês fechado**: o último mês inteiro que já terminou, e de preferência com o dinheiro das
vendas já liberado. Se hoje é dia 10 ou antes, use o mês retrasado. Daqui em diante, `<mês>` é
esse mês (ex.: `2026-10`).

## As três fontes

| Fonte | O que é | Quem traz |
|---|---|---|
| **Sistema** | O que o sistema gravou e calculou | Você: `node scripts/copia-banco.mjs` |
| **Mercado Livre** | O que o marketplace diz que vendeu e cobrou | O dono baixa no painel de vendedor |
| **Mercado Pago** | O dinheiro que de fato entrou | O dono baixa o extrato do mês |

Crie a pasta `Documentos/Apuracao/<mês>` (fora do repositório), abra para o dono no Explorador de
Arquivos (`explorer` no Windows, `open` no Mac) e mande numa mensagem só:

> **Validação dos números de <mês> (uns 10 minutos seus)**
>
> Baixe estes três arquivos, todos do mês <mês> inteiro, e salve na pasta que eu abri:
>
> 1. **Vendas do Mercado Livre:** no Mercado Livre, **Vendas**, filtre o período do mês e use
>    **Baixar** (planilha Excel).
> 2. **Faturamento do Mercado Livre:** em **Faturamento** (ou "Minhas faturas"), o relatório
>    detalhado das cobranças do mês, em planilha.
> 3. **Extrato do Mercado Pago:** no Mercado Pago, **Relatórios** (ou "Sua atividade"), o
>    **relatório de liberações** ou o extrato da conta do mês, em planilha (Excel ou CSV). PDF
>    também serve.
>
> Me avise quando os três estiverem na pasta.

Os menus do Mercado Livre e do Mercado Pago mudam de nome. Se o dono não achar, peça uma foto da
tela e guie a partir dela.

Esses arquivos têm dados de clientes e da conta. **Nunca** copie para dentro do repositório, nunca
faça commit deles e não cole o conteúdo na conversa além do necessário para explicar uma
diferença.

Enquanto o dono baixa, rode `node scripts/copia-banco.mjs` e leia o `CONTEXTO-IA.md` (o que cada
tabela guarda e as regras do cálculo).

## O que cruzar, nesta ordem

Compare pedido a pedido, pelo número do pedido (ou do pagamento), não só pelos totais: totais que
batem podem esconder erros que se anulam. Diferença de até R$ 0,05 por pedido é arredondamento.

1. **Vendas.** Quantidade de pedidos e faturamento bruto do mês: `ml_orders` e `ml_order_items`
   contra a planilha de vendas. Separe cancelados e devolvidos. Liste os pedidos que estão só de
   um lado.
2. **Tarifas e frete por venda.** Comissão, frete e taxas de cada pedido: `ml_billing_details` e o
   cálculo da Conciliação contra as colunas da planilha de vendas e o relatório de faturamento.
3. **Dinheiro recebido.** `mp_payments` contra o extrato do Mercado Pago: valor bruto, tarifas,
   valor líquido e data de liberação de cada pagamento, e o total liberado no mês.
4. **Cobranças do mês.** Total por tipo de cobrança em `ml_billing_details` contra o relatório de
   faturamento. Um tipo de cobrança que o sistema não reconhece aparece aqui.
5. **Publicidade.** `ml_ads_daily` do mês contra o valor de publicidade da fatura.

## Cada diferença tem um destes motivos

| Motivo | Exemplo | O que fazer |
|---|---|---|
| **Critério** | O sistema conta pela data da venda e o extrato pela data da liberação | Não é erro. Explique ao dono com um exemplo e anote |
| **Dado faltando** | Pedidos ou pagamentos que não chegaram | **Sincronizar agora** na tela Mercado Livre, espere e cruze de novo |
| **Cadastro do dono** | Custo de produto ou alíquota faltando | Diga ao dono o que cadastrar e onde |
| **Cálculo** | O sistema soma, classifica ou desconta errado | Corrija (abaixo) |
| **Pagamentos não chegam nenhum** | Pedidos chegam, `mp_payments` vazio | Pare e avise o mentor: é um caso ainda não confirmado |

## Corrigir um erro de cálculo

1. Mostre ao dono, em português simples, o que está errado, em quantos pedidos e quanto dinheiro.
2. Antes de mexer: leia as REGRAS DE OURO do `CONTEXTO-IA.md`. Mudança no banco segue o
   `AGENTS.md` (cópia antes, migração nova, `subir-banco.mjs`).
3. Corrija com um teste que falhava antes e passa depois. `bun run test` precisa passar inteiro.
4. Publique (`bun run build && npx wrangler deploy`) e cruze de novo os pedidos afetados.
5. Um erro de cálculo pode estar no modelo de todos os mentorados, não só neste sistema: escreva
   no resumo, para o dono mandar ao mentor.

## Resultado

Grave `docs/apuracao/<mês>.md` no repositório, sem dado pessoal de cliente (número de pedido
pode; nome, CPF e endereço não):

- **Confere:** o que bateu, com os totais das três fontes lado a lado;
- **Diferenças explicadas:** critério e cadastro, com um exemplo de cada;
- **Corrigido:** o que estava errado, quantos pedidos, o teste que prova;
- **Pendente:** o que ficou aberto e por quê.

Faça commit desse arquivo e das correções e publique. Para o dono, termine com um resumo de
cinco linhas no máximo: pode ou não confiar nos números, e o que ainda falta. Peça que ele mande
o arquivo `docs/apuracao/<mês>.md` ao mentor.

**Pronto quando:** cada uma das cinco comparações está em "confere", "explicada" ou "corrigido",
ou foi anotada como pendente com o motivo, e o dono viu o resumo.
