# Passo a passo do dono da loja

Este é o seu guia. Você não precisa programar nem abrir terminal: a IA (Claude) faz a parte
técnica e te pede só o que depende de você, em poucas listas curtas.

**Regra de ouro:** senha e chave secreta nunca vão no chat. Você cola só no Bloco de Notas que a
IA abrir, ou direto na tela do sistema. No chat vão só valores que a IA pedir pelo nome.

## Antes da call (sozinho, uns 30 minutos)

Faça com antecedência: o item 4 pode levar dias.

1. **GitHub.** Crie a conta em https://github.com e mande o seu nome de usuário para o mentor.
   Chega um convite por e-mail: aceite. Sem isso o modelo não abre (aparece "404").
2. **Cloudflare.** Crie a conta em https://dash.cloudflare.com e ative o **plano pago do Workers**
   (cerca de US$ 5 por mês, no cartão). É onde o sistema fica no ar.
3. **Supabase.** Crie a conta em https://supabase.com (o plano gratuito serve). É o banco de
   dados. Cada pessoa pode ter 2 projetos gratuitos: se você já tem 2, crie a conta com outro e-mail.
4. **Mercado Livre.** Entre em https://developers.mercadolivre.com.br com a **conta titular da
   loja** (não a de um funcionário) e crie uma aplicação. Se pedir um endereço de redirect, use
   `https://www.mercadolivre.com.br` por enquanto: na call a IA te dá o certo. O Mercado Livre pode
   analisar o pedido por alguns dias.
5. **No computador:**
   - Instale o **Claude** (app de computador) em https://claude.ai/download e entre na sua conta.
     Se ele pedir para instalar o Git, aceite.
   - Instale o **Node.js** em https://nodejs.org: botão da versão **LTS**, depois "Avançar" até o fim.

## Na call (uns 35 minutos)

1. **Copie o modelo.** No GitHub, abra o repositório-modelo, clique em **Use this template >
   Create a new repository**, marque **Private** e crie. Na página do seu repositório novo,
   copie o endereço da barra do navegador.
2. **Chame a IA.** Crie uma pasta vazia (por exemplo, "Sistemas" em Documentos). No Claude, abra a
   aba **Code**, escolha essa pasta e mande esta mensagem, com o endereço que você copiou:

   > Clone https://github.com/SEU-USUARIO/SEU-REPOSITORIO e siga o INSTALAR.md que está dentro dele.

3. **Responda à IA.** Daqui em diante ela conduz. Você vai:
   - clicar em **Permitir** quando o Claude pedir para rodar um comando;
   - clicar em **Allow** numa página da Cloudflare que vai abrir sozinha;
   - criar o projeto no Supabase e colar a senha no Bloco de Notas (Parte 1);
   - seguir uma lista de cliques no Supabase e no Mercado Livre (Parte 2);
   - entrar no sistema e conectar o Mercado Livre (Parte 3).

   Cada parte vem numa mensagem só, com os links prontos. Quando terminar, avise "pronto".

Se o Mercado Livre ainda não liberou a aplicação, a instalação termina do mesmo jeito: o sistema
fica no ar e você conecta depois (veja abaixo).

## Depois da call

**A primeira tarefa: validar os números.** Antes de usar o sistema para decidir qualquer coisa,
a IA confere um mês inteiro que já terminou, cruzando três fontes: o que o sistema calculou, o que
o Mercado Livre diz que vendeu e cobrou, e o extrato do Mercado Pago. Quando a primeira
sincronização terminar, abra o Claude na pasta do sistema e mande:

> Siga o APURACAO.md.

Ela vai te pedir três arquivos do mês para baixar (vendas e faturamento do Mercado Livre, extrato
do Mercado Pago) e uma pasta para salvar. Esses arquivos ficam só no seu computador. No fim ela
diz se pode confiar nos números, corrige o que estiver errado e grava um resumo. Mande esse
resumo ao seu mentor.

**Nos primeiros dias:**

1. **Espere a primeira sincronização.** Pedidos, pagamentos, cobranças e publicidade chegam em
   minutos ou horas. Acompanhe em Configurações > Integrações.
2. **Cadastre o custo dos produtos.** Em Produtos / SKUs, exporte a planilha, preencha o custo e
   importe de volta.
3. **Cadastre a alíquota de imposto** da empresa, em Configurações.

Enquanto faltar custo ou alíquota, o resultado aparece **maior do que é**.

**Quando o Mercado Livre liberar a aplicação** (se ficou para depois): abra o Claude na pasta do
sistema e peça "a aplicação do Mercado Livre foi liberada, me ajude a conectar". A IA te dá o
endereço de redirect e as permissões, e você conecta em Configurações > Integrações.

**Para mudar ou consertar alguma coisa:** abra o Claude, aba **Code**, na pasta do sistema, e
peça em português o que quer. A IA já sabe onde o sistema roda, como publicar e o que é segredo.
Antes de mexer no banco de dados, ela faz uma cópia dele no seu computador.

**Para saber se está tudo funcionando:** peça ao Claude "confere o sistema". Ele roda uma
checagem e diz o que está certo e o que falta.

**Custos:** Cloudflare, cerca de US$ 5 por mês. GitHub, Supabase e Mercado Livre, gratuitos para
começar.

Problemas comuns e o que fazer: seção 7 do `README.md`.
