# Roteiro de instalação (para a IA)

Para a IA (Claude Code) que instala este sistema com o dono da loja, normalmente numa call de até
40 minutos com o mentor. O dono não é programador. O guia dele é o `PASSO-A-PASSO.md`; este
arquivo é o seu.

## Como trabalhar

- **Você faz tudo o que um comando faz.** O dono nunca abre terminal nem digita comando. Ele só
  clica em páginas que você abre ou manda, e cola senhas num arquivo que você abre para ele.
- **Junte o trabalho dele em poucas rodadas.** São quatro paradas para o dono (rodadas 1, 2, 3 e
  5), e cada mensagem sua para ele é uma lista numerada curta, com os links clicáveis e os valores
  exatos para copiar. Entre uma parada e outra, faça tudo o que der sem perguntar nada.
- **Fale como para quem nunca programou.** Nada de "env", "deploy", "migração" ou "commit" nas
  mensagens para o dono. Diga o que ele vai ver e onde clicar. Comece cada rodada dizendo quanto
  falta ("Parte 2 de 4, uns 5 minutos").
- **Segredo** é: senha, chave `sb_secret_...`, Client Secret do Mercado Livre, token. Segredo nunca
  passa pela conversa: o dono cola no arquivo `.env.local`, que você abre no Bloco de Notas, ou
  direto na tela do sistema. Não leia o `.env.local` para a conversa; os scripts leem por você.
  Se o dono colar um segredo no chat, avise que aquele valor precisa ser trocado no painel do
  serviço e siga com o novo.
- **Público** pode aparecer na conversa: endereço do projeto no Supabase, chave
  `sb_publishable_...`, endereço do app, Client ID do Mercado Livre, e-mail do dono.
- O sistema só **lê** a conta do Mercado Livre. Nenhum passo pede permissão de escrita.
- **Comandos no Windows.** Se você roda pelo PowerShell, use `npx.cmd` no lugar de `npx` (o
  PowerShell bloqueia o `npx.ps1`). Comandos que esperam o navegador (`wrangler login`) precisam
  de tempo: dê até 5 minutos antes de desistir.
- Se algo falhar de um jeito que [Se travar](#se-travar) não cobre: pare, mostre o erro exato (sem
  segredo) e pergunte. Seguir com um passo quebrado custa mais que parar.

## Rodada 0. Conferir o que o dono fez antes da call

Pergunte numa mensagem só, com sim ou não para cada item (a lista está no `PASSO-A-PASSO.md`):

1. Tem conta no GitHub e este repositório é a cópia **dele** (feita com **Use this template**)?
2. Tem conta na Cloudflare com o plano pago do Workers ativo (cerca de US$ 5 por mês)?
3. Tem conta no Supabase com vaga para um projeto novo?
4. Pediu a aplicação no Mercado Livre, com a conta titular da loja? Já foi liberada?

Enquanto ele responde, confira você mesmo:

- `git remote -v` aponta para o repositório do dono, não para o modelo. Se for o modelo, pare:
  as mudanças dele iriam para o lugar errado.
- `node --version` responde 24 ou mais. Se não tiver Node, o dono instala pelo site
  `https://nodejs.org` (botão da versão LTS, avançar até o fim) e reabre o Claude.
- `bun --version` responde. Se não, rode `npm install -g bun`.

Um "não" nos itens 2 ou 3 impede a instalação hoje: diga o que falta e pare. Um "não" no item 4
não impede: o sistema fica no ar e o Mercado Livre entra quando a aplicação for liberada.

## Rodada 1. Preparar e publicar a primeira versão

Você, sem perguntar nada:

1. `bun install` e `bun run test` (precisa terminar com `fail 0`).
2. Copie `.env.example` para `.env` e `.env.local.example` para `.env.local`.
3. Em `wrangler.jsonc`, troque `NOME-DO-SEU-SISTEMA` por `painel-financeiro` (ou outro nome em
   minúsculas, números e hífen, se o dono pediu).
4. Rode `npx wrangler login`. Antes, avise o dono: "Vai abrir uma página da Cloudflare. Entre na
   sua conta e clique em **Allow**." O comando termina sozinho quando ele autorizar.
5. `bun run build && npx wrangler deploy`. Essa primeira versão ainda não funciona: serve para
   descobrir o endereço do app, que aparece no fim, no formato
   `https://painel-financeiro.<subdomínio>.workers.dev`.
6. Grave esse endereço, sem barra no final, em `APP_BASE_URL` no `wrangler.jsonc`.

**Pronto quando:** você tem o endereço do app. Daqui em diante, `<app>` é esse endereço.

## Rodada 2. O dono cria o projeto no Supabase

Abra o `.env.local` no Bloco de Notas para ele (`notepad .env.local` no Windows,
`open -e .env.local` no Mac) e mande:

> **Parte 1 de 4: criar o banco de dados (uns 4 minutos)**
>
> 1. Abra https://supabase.com/dashboard/projects e clique em **New project**.
> 2. Nome: `painel-financeiro`. Região: **South America (São Paulo)**.
> 3. Na senha do banco, clique em **Generate password** e depois em **Copy**.
> 4. No Bloco de Notas que eu abri, cole a senha logo depois de `SUPABASE_DB_PASSWORD=` (sem
>    espaço) e salve com **Ctrl+S**. Guarde a senha também no seu gerenciador de senhas.
> 5. Clique em **Create new project** e espere a tela do projeto carregar (1 a 2 minutos).
> 6. Copie o endereço da barra do navegador e cole aqui no chat.

Do endereço colado (`https://supabase.com/dashboard/project/<ref>`), tire o `<ref>` de 20 letras.
Troque `SEU_PROJECT_REF` por esse ref em todas as linhas do `.env` e no `SUPABASE_URL` do
`wrangler.jsonc`.

Então suba o banco, antes de mandar a rodada 3:

```bash
node scripts/subir-banco.mjs
```

Num projeto novo, ele lista só `20260101000000_base.sql`. A instalação já é o pedido do dono:
aplique sem perguntar.

```bash
node scripts/subir-banco.mjs --aplicar
```

Se ele não conectar logo depois de o projeto ser criado, espere 1 minuto e tente de novo: o
projeto ainda está ligando.

**Pronto quando:** `node scripts/subir-banco.mjs` responde "O banco já está em dia".

## Rodada 3. O dono faz todos os cliques do Supabase e do Mercado Livre

Monte os links com o `<ref>` e o `<app>` reais e mande numa mensagem só:

> **Parte 2 de 4: cliques no Supabase e no Mercado Livre (uns 10 minutos)**
>
> **Supabase**
>
> 1. Abra https://supabase.com/dashboard/project/<ref>/settings/api-keys
>    - Em **Secret keys**, copie a chave (começa com `sb_secret_`), cole no Bloco de Notas depois
>      de `SUPABASE_SERVICE_ROLE_KEY=` e salve com **Ctrl+S**.
>    - Em **Publishable key**, copie a chave (começa com `sb_publishable_`) e cole aqui no chat.
> 2. Abra https://supabase.com/dashboard/project/<ref>/auth/providers, desligue
>    **Allow new users to sign up** e clique em **Save**. Assim ninguém de fora cria conta no
>    seu sistema.
> 3. Abra https://supabase.com/dashboard/project/<ref>/auth/users, clique em **Add user >
>    Create new user**, ponha o seu e-mail e uma senha, marque **Auto Confirm User** e crie.
>    Esse é o seu login no sistema.
> 4. Abra https://supabase.com/dashboard/project/<ref>/auth/url-configuration
>    - **Site URL:** `<app>` e **Save**.
>    - Em **Redirect URLs**, **Add URL**: `<app>/redefinir-senha` e **Save**.
>
> **Mercado Livre** (pule se a aplicação ainda está em análise)
>
> 5. Em https://developers.mercadolivre.com.br, abra a sua aplicação e edite:
>    - **URI de redirect:** `<app>/api/ml/callback`
>    - **Permissões**, todas em **somente leitura**: Usuários, Vendas e envios, Faturamento,
>      Publicidade, Métricas do negócio, Publicação e sincronização, Comunicação pré e pós-venda,
>      e a de **pagamentos do Mercado Pago**, se aparecer. Marque também o **acesso offline**.
>    - **PKCE**, se aparecer: deixe **desligado**.
>    - Salve.
>
> No fim, me mande aqui: a chave `sb_publishable_`, o e-mail do passo 3 e o seu nome.

## Rodada 4. Ligar tudo

Você, sem perguntar nada:

1. Preencha a chave publicável no `.env` e em `SUPABASE_PUBLISHABLE_KEY` no `wrangler.jsonc`.
   Confira que nada mais sobrou de exemplo: a busca por `SEU_PROJECT_REF`, `sb_publishable_...` e
   `NOME-DO-SEU-SISTEMA` em `.env` e `wrangler.jsonc` não acha nada.
2. `bun run build && npx wrangler deploy`.
3. Ligue o banco ao app:

   ```bash
   node scripts/configurar.mjs --endereco <app> --dono <e-mail> --nome "<nome>"
   ```

   Ele confere se o cadastro público está desligado, grava a chave secreta e o segredo do
   agendador no Worker e no cofre do Supabase, e torna o usuário dono da equipe. Nada disso
   aparece na tela. Se ele parar, a mensagem diz o que o dono precisa corrigir: mande só esse
   item para ele.
4. `node scripts/conferir.mjs`: precisa mostrar o app no ar, o agendador protegido, o cadastro
   fechado e o dono definido.
5. Guarde a configuração (os dois arquivos só têm valores públicos):

   ```bash
   git add .env wrangler.jsonc && git commit -m "Configuração da minha instalação" && git push
   ```

   Confira que `git ls-files` não lista `.env.local`.

**Pronto quando:** o `conferir.mjs` não aponta problema e o `git status` está limpo.

## Rodada 5. O dono entra e conecta o Mercado Livre

> **Parte 3 de 4: entrar no sistema (uns 5 minutos)**
>
> 1. Abra <app>/login e entre com o e-mail e a senha que você criou no Supabase.
> 2. Vá em **Configurações > Integrações > Adicionar integração**.
> 3. Cole o **Client ID** e o **Client Secret** da sua aplicação do Mercado Livre e clique em
>    **Conectar**. O Mercado Livre pede para você autorizar: autorize.
> 4. Me avise quando a integração aparecer como **conectada**.

Se a aplicação do Mercado Livre ainda está em análise, peça só o item 1 e explique que os itens 2
a 4 ficam para quando ela for liberada (o `PASSO-A-PASSO.md` ensina).

## Rodada 6. Conferir e entregar

Rode `node scripts/conferir.mjs`. Ele mostra a conta conectada, a fila de sincronização e quantos
pedidos e pagamentos já chegaram. A primeira carga leva de minutos a horas: na call basta ver a
fila andando e os primeiros pedidos.

Termine com a **Parte 4 de 4** para o dono, curta:

- o endereço do sistema e que vale salvar nos favoritos;
- a próxima tarefa, **a validação dos números de um mês fechado** (`APURACAO.md`), que começa quando
  a primeira sincronização terminar: pode ser na mesma hora ou numa conversa nova;
- o que fazer nos primeiros dias: seção "Depois da call" do `PASSO-A-PASSO.md`;
- se a conexão ficou para depois, como fazer quando a aplicação do Mercado Livre for liberada.

Se depois de horas os pedidos chegam e os pagamentos não, é o caso da última linha de
[Se travar](#se-travar).

## Se travar

| O que aparece | O que é | O que fazer |
|---|---|---|
| `npx.ps1 não pode ser carregado` ou `a execução de scripts foi desabilitada` | Comando rodado no PowerShell do Windows | Use `npx.cmd` |
| Erro de limite de CPU no `wrangler deploy` | Plano gratuito do Workers | O dono ativa o plano pago na Cloudflare; publique de novo |
| `You need to register a workers.dev subdomain` (ou parecido) no `wrangler deploy` | Conta nova da Cloudflare sem subdomínio | O dono abre **Workers & Pages** no painel da Cloudflare, escolhe o subdomínio e salva; publique de novo |
| `a senha do banco não confere` no `subir-banco.mjs` | Senha errada ou não salva no `.env.local` | O dono confere se salvou o Bloco de Notas; se perdeu a senha, gera outra em Project Settings > Database > Reset database password |
| `não consegui falar com o banco` no `subir-banco.mjs` | Projeto ainda ligando, ou nenhuma conexão automática funcionou na rede do dono | Espere 1 minuto e tente de novo; se continuar, o dono copia o endereço em **Connect > Session pooler**, troca `[YOUR-PASSWORD]` pela senha e cola no `.env.local` como `SUPABASE_DB_URL=...` |
| `Unable to create project under Free Plan organization` | A conta do Supabase já tem 2 projetos gratuitos ativos | Criar a conta do Supabase com outro e-mail, ou liberar uma vaga |
| `o cadastro público do Supabase está LIGADO` no `configurar.mjs` | O item 2 da rodada 3 ficou sem salvar | O dono desliga **Allow new users to sign up** e clica em **Save**; rode de novo |
| `Usuário ... não existe` no `configurar.mjs` | O usuário do item 3 não foi criado, ou o e-mail está diferente | Conferir em Authentication > Users |
| `Já existe um dono da equipe` | A instalação já tem dono | Novos usuários: Configurações > Usuários |
| `o banco não respondeu` no `configurar.mjs` | Chave secreta errada no `.env.local` ou banco não subiu | Conferir os dois |
| `APP_BASE_URL não configurada` ao conectar o Mercado Livre | O endereço não entrou no `wrangler.jsonc` antes da publicação | Preencher e publicar de novo |
| A conexão do Mercado Livre volta com erro de `redirect_uri` | O endereço cadastrado na aplicação difere do `<app>` | Deixar idênticos, letra por letra |
| O link de "Esqueci minha senha" abre `localhost` | Site URL ou Redirect URL sem salvar | Refazer o item 4 da rodada 3 |
| `PA_UNAUTHORIZED_RESULT_FROM_POLICIES` na sincronização | Falta uma permissão na aplicação do Mercado Livre | Marcar a permissão em leitura e conectar de novo |
| Pagamentos não sincronizam, o resto sim | A aplicação não tem a permissão de leitura de pagamentos do Mercado Pago. Na aplicação que já funciona, ela aparece como `urn:mp:online:payments/read-only` | Marcar a permissão de pagamentos em leitura, conectar de novo e esperar a fila; se a permissão não existir no formulário, parar e avisar o mentor |
| A conexão volta com erro de `code_verifier` ou PKCE | A aplicação está com PKCE ligado e o sistema não usa PKCE | Desligar o PKCE na aplicação e conectar de novo |
