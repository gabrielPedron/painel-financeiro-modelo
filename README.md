# Painel Financeiro

Painel financeiro para quem vende em marketplace. Este repositório é um **modelo**: você copia,
instala nas suas contas e passa a ser dono do seu sistema.

## 1. O que é

O sistema se conecta à sua conta do Mercado Livre e mostra, **venda por venda**, quanto entrou,
o que o marketplace descontou e quanto sobrou.

O vendedor enxerga o faturamento, mas não enxerga o lucro. Entre o preço do anúncio e o dinheiro
que cai na conta existem comissão, frete, taxa de parcelamento, taxa de processamento, imposto,
custo do produto e publicidade. O sistema junta tudo e responde: **essa venda deu lucro?**

Ele só **lê** a sua conta do Mercado Livre. Não altera anúncio, preço, estoque nem mensagem.

## 2. Telas

| Tela | O que faz |
| --- | --- |
| **Dashboard** | Visão do período: quanto vendeu, quanto gastou, quanto sobrou. |
| **Mercado Livre** | Situação da conexão e botão para sincronizar agora. |
| **Anúncios** | Margem por anúncio: receita, tarifas, imposto, custo, publicidade e resultado. |
| **Conciliação** | Cada venda com receita, comissão, frete, imposto, custo, publicidade e resultado. Abas de recebimentos e divergências. |
| **Produtos / SKUs** | Cadastro dos produtos e do custo de cada um, com planilha de importação. |
| **Custos Empresa** | Despesas da empresa por mês. |
| **Contas a Pagar** | Contas em aberto, vencimentos e faturas de cartão. |
| **Outras receitas** e **Locação** | Entradas que não vêm de marketplace. Se não usa, deixe vazio. |
| **Shopee** | Espaço reservado, ainda sem integração. |
| **Configurações** | Usuários, Integrações, Empresas, Regras, Auditoria, Telegram e Preferências. |

## 3. O que este sistema usa

| Serviço | Para quê | Custo |
| --- | --- | --- |
| GitHub | Guarda o código | Gratuito |
| Cloudflare Workers | Roda o app | Plano pago, cerca de US$ 5 por mês |
| Supabase | Banco de dados e login | Gratuito para começar |
| Mercado Livre (DevCenter) | Autoriza a leitura da sua conta | Gratuito |

As contas são **suas**. Senhas e chaves ficam com você: ninguém mais precisa delas, nem quem
está te ajudando a instalar.

## 4. Como instalar

Siga o **`PASSO-A-PASSO.md`**. Resumo:

1. **Antes da call**, sozinho: contas no GitHub, na Cloudflare (plano pago do Workers), no
   Supabase e a aplicação no Mercado Livre, que pode levar dias para ser liberada. No computador,
   o app do Claude e o Node.js.
2. **Na call**, uns 35 minutos: você copia este modelo com **Use this template** e manda uma
   mensagem para o Claude. A IA faz toda a parte técnica e te pede, em três listas curtas, os
   cliques que só você pode dar.

Senhas e chaves ficam só com você: nem o mentor nem o chat precisam delas.

## 5. Primeiros dias

Faça nesta ordem:

1. **Espere a primeira sincronização.** Pedidos, pagamentos, cobranças e publicidade chegam em
   minutos ou horas, conforme o volume. Acompanhe em Configurações > Integrações.
2. **Cadastre o custo dos produtos.** Em Produtos / SKUs, exporte a planilha, preencha o custo e
   importe de volta. Os produtos aparecem sozinhos conforme as vendas chegam.
3. **Cadastre a alíquota de imposto** da empresa, em Configurações.

Enquanto faltar custo ou alíquota, o resultado aparece **maior do que é**. O sistema avisa
quantas vendas estão sem custo, para você não decidir com número inflado.

## 6. Como mudar o sistema

Peça à IA, com a pasta aberta no Claude (aba **Code**). Ela lê o `AGENTS.md` (onde o sistema roda, como
publicar, o que é segredo) e o `CONTEXTO-IA.md` (tabelas e regras do cálculo).

## 7. Problemas comuns

**A conta do Mercado Livre desconectou.** A autorização cai se ficar muito tempo sem uso ou se
você trocar a senha. Em Configurações > Integrações, conecte de novo. Os dados já baixados ficam.

**Os dados não aparecem.** Confira, nesta ordem: a conta está "conectada"? O período do filtro
cobre datas com venda? Ainda há itens na fila em Configurações > Integrações? Se a fila estiver
vazia, use **Sincronizar agora**.

**A margem parece alta demais.** Quase sempre é custo de produto faltando. Confira também a alíquota.

**A sincronização parece travada.** O sistema tenta de novo sozinho a cada poucos minutos. Se um
item ficar parado por mais de uma hora, use **Sincronizar agora** na tela Mercado Livre. Erros
de "sem campanha de Product Ads" em datas antigas são esperados: não havia anúncio patrocinado naquele dia.
