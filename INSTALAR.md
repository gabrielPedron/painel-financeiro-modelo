# Roteiro de instalação

Para a IA (Claude Code) que está instalando este sistema junto com o dono da loja. Execute os
passos em ordem. Cada passo termina num **Pronto quando**: só avance depois de conferir.

## Quem faz o quê

- **Você (IA)** roda os comandos, edita os arquivos de configuração e confere cada passo.
- **O dono da loja** cria as contas, digita senhas e cola chaves secretas, sempre no terminal
  dele, no painel do serviço ou no arquivo `.env.local`.
- **Segredo** é: senha, chave `sb_secret_...`, Client Secret do Mercado Livre, token. Segredo
  viaja só entre o dono e o serviço. Quando um passo precisar de um, diga onde ele deve digitar
  e espere ele avisar que terminou.
- Valores **públicos** podem aparecer na conversa: project ref, URL do Supabase, chave
  `sb_publishable_...`, endereço do app, Client ID do Mercado Livre.
- O sistema só **lê** a conta do Mercado Livre. Nenhum passo pede permissão de escrita.
- **Windows:** quando o dono digitar no PowerShell um comando que começa com `npx`, peça que
  ele escreva `npx.cmd` no lugar de `npx` (o resto do comando é igual). O PowerShell vem com
  scripts bloqueados e o `npx` comum falha com "a execução de scripts foi desabilitada". Deixe a
  política de execução do Windows como está: o `npx.cmd` resolve sem mexer nela. O PowerShell
  comum basta; o de administrador não é necessário.

Se um comando falhar de um jeito que a seção [Se travar](#se-travar) não cobre: pare, mostre o
erro exato (sem segredo) e pergunte. Seguir adiante com um passo quebrado custa mais que parar.

## Antes de começar (o dono faz sozinho, antes da instalação)

1. Conta no **GitHub**.
2. Conta na **Cloudflare** com o plano pago do Workers ativo (cerca de US$ 5 por mês). O
   plano gratuito corta a sincronização no meio: ela passa do limite de processamento.
3. Conta no **Supabase** (o plano gratuito serve para começar), com **vaga para um projeto
   novo**. Cada pessoa tem no máximo 2 projetos gratuitos ativos, somando todas as
   organizações dela. Se as duas vagas já estiverem ocupadas, o caminho sem custo é criar a
   conta do Supabase com outro e-mail.
   - Para conferir: em `https://supabase.com/dashboard`, clicar em **New project**. Se aparecer
     "Unable to create project under Free Plan organization", não há vaga.
4. **Aplicação no Mercado Livre**: entrar em `https://developers.mercadolivre.com.br` com a
   conta titular da loja e pedir a criação da aplicação. O Mercado Livre analisa o pedido, e
   isso pode levar dias: é o passo que mais atrasa. A aplicação fica presa a essa conta para
   sempre, então tem que ser a da loja, e não a de um funcionário ou do mentor.
5. No computador: Git, [Bun](https://bun.sh) e Node 24 ou mais novo.
6. **Convite do mentor aceito.** O repositório-modelo é privado: o mentor convida o usuário do
   GitHub do dono, o convite chega por e-mail, e só depois de aceitar aparece o botão
   **Use this template**. Sem o convite, o link do modelo dá "404".

**Pronto quando:** `git --version`, `bun --version` e `node --version` respondem (Node 24+), o
dono confirma as três contas e consegue abrir o repositório-modelo no GitHub. A aplicação do Mercado Livre pode ainda estar em análise: ela
só entra no passo 8.

## 1. Copiar o modelo

O dono já criou a cópia dele com **Use this template** e te mandou clonar (seção "Como
instalar" do `README.md`). Se o clone ainda não foi feito, peça o endereço do repositório **dele**
(não o do modelo) e clone:

```bash
git clone <endereço do repositório dele> sistema-financeiro
```

Depois, dentro da pasta clonada:

```bash
bun install
```

Confira com `git remote -v` que o endereço é o repositório do dono. Se for o do modelo, pare:
as mudanças dele iriam para o lugar errado.

**Pronto quando:** `bun run test` termina com `fail 0`.

## 2. Criar o projeto no Supabase

O dono cria o projeto em `https://supabase.com/dashboard` (região São Paulo) e guarda a senha
do banco num gerenciador de senhas. Peça a ele três valores públicos, de
**Project Settings > API Keys** e **Data API**: project ref, URL do projeto e chave publicável.

Com eles:

1. Copie `.env.example` para `.env` e preencha as seis linhas.
2. Em `wrangler.jsonc`, preencha `name` (nome do sistema: minúsculas, números e hífen) e, em
   `vars`, `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`. Deixe `APP_BASE_URL` vazio por enquanto.

**Pronto quando:** a busca por `SEU_PROJECT_REF`, `sb_publishable_...` e `NOME-DO-SEU-SISTEMA`
em `.env` e `wrangler.jsonc` não acha nada.

## 3. Subir o banco

Estes comandos pedem login e senha: o dono roda no terminal dele, um por vez. Eles levam a
versão testada da ferramenta (`@3.2.0`): mantenha como está, mesmo que ela avise de versão nova.

```bash
npx supabase@3.2.0 login
```

```bash
npx supabase@3.2.0 init
```

```bash
npx supabase@3.2.0 link --project-ref <project ref>
```

```bash
npx supabase@3.2.0 db push --remote
```

O `link` e o `db push` pedem a senha do banco do passo 2. O `db push` aplica uma migração
única, `supabase/migrations/20260101000000_base.sql`: tabelas, funções, permissões,
classificação das cobranças do Mercado Livre e agendamentos. Leva poucos segundos.

Se quem roda o `db push` é você (IA), a ferramenta percebe e recusa gravar sem confirmação
(`Confirmation required ... running in agent mode`). Rode antes `npx supabase@3.2.0 db push --remote --dry-run`,
mostre ao dono que ele aplica só `20260101000000_base.sql` num projeto vazio, e com o sim dele
rode `npx supabase@3.2.0 db push --remote --yes`.

**Pronto quando:** `npx supabase@3.2.0 migration list --remote` mostra `20260101000000` nas duas
colunas (local e remoto).

## 4. Fechar o cadastro e criar o usuário do dono

No painel do Supabase, o dono:

1. Em **Authentication > Sign In / Providers**, desliga **Allow new users to sign up**. O
   sistema é fechado: usuários novos entram depois, pela tela Configurações > Usuários.
2. Em **Authentication > Users > Add user**, cria o próprio usuário com e-mail e senha,
   marcando **Auto Confirm User**.

**Pronto quando:** o usuário aparece na lista de Users e o cadastro público está desligado.
Projeto novo nasce com o cadastro **ligado**; se o dono esquecer, o `configurar.mjs` do passo 7
para e mostra onde desligar.

## 5. Publicar o app

```bash
npx wrangler login
```

```bash
bun run build && npx wrangler deploy
```

A publicação mostra o endereço do app, no formato
`https://<nome>.<subdomínio-da-conta>.workers.dev`. Grave esse endereço, sem barra no final,
em `APP_BASE_URL` no `wrangler.jsonc` e publique de novo com o mesmo comando.

**Pronto quando:** abrir `<endereço>/login` no navegador mostra a tela de entrada.

## 6. Avisar o Supabase do endereço

No painel, em **Authentication > URL Configuration**, o dono põe:

- **Site URL**: o endereço do app.
- **Redirect URLs**: `<endereço>/redefinir-senha`.

**Pronto quando:** o dono abre `<endereço>/recuperar-senha`, pede o link com o e-mail dele, e o
link que chega por e-mail abre a tela "Definir nova senha" no endereço do app. Se o link
apontar para `localhost`, o Site URL ou a Redirect URL não foi salva. O dono não precisa trocar a
senha: basta conferir para onde o link leva.

## 7. Ligar o banco ao app

1. Copie `.env.local.example` para `.env.local`.
2. O dono abre `.env.local` no editor e cola a chave secreta do Supabase
   (**Project Settings > API Keys > Secret keys**) depois de `SUPABASE_SERVICE_ROLE_KEY=`.
   Esse arquivo fica fora do Git. Deixe o conteúdo dele com o dono: você só precisa saber que foi preenchido.
3. Rode:

```bash
node scripts/configurar.mjs --endereco <endereço do app> --dono <e-mail do passo 4> --nome "<nome do dono>"
```

O script grava a chave secreta e o segredo do agendador no Worker, grava o endereço e o mesmo
segredo no cofre do Supabase e transforma o usuário em dono da equipe. Nada disso aparece na tela.

**Pronto quando:** o script termina com `Pronto.` e este comando devolve `401`:

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST <endereço do app>/api/public/hooks/ml-worker
```

O `401` prova que os ganchos do agendador recusam quem chega sem o segredo.

## 8. Entrar e conectar o Mercado Livre

1. O dono entra em `<endereço>/login` com o e-mail e a senha do passo 4.
2. Em `https://developers.mercadolivre.com.br`, na aplicação dele:
   - **URI de redirect**: `<endereço>/api/ml/callback`, idêntica, letra por letra.
   - **Permissões**, todas em **somente leitura**: Usuários, Vendas e envios, Faturamento,
     Publicidade, Métricas do negócio, Publicação e sincronização, Comunicação pré e pós-venda.
     Marque também o acesso offline.
3. No sistema, em **Configurações > Integrações > Adicionar integração**, o dono cola o
   Client ID e o Client Secret e clica em **Conectar**. O Mercado Livre pede a autorização e
   devolve para o sistema.

**Pronto quando:** a integração aparece como **conectada** e a fila em Configurações >
Integrações mostra itens sendo processados. O histórico completo leva de minutos a horas.

Quando a fila esvaziar, confira os **pagamentos**: na Conciliação, aba de recebimentos, devem
aparecer valores para as vendas do período. Pedidos chegando com recebimentos vazios é o caso da
última linha de [Se travar](#se-travar): pare e avise o mentor.

## 9. Guardar a configuração

```bash
git add .env wrangler.jsonc supabase/config.toml && git commit -m "Configuração da minha instalação" && git push
```

Esses três arquivos só têm valores públicos.

**Pronto quando:** `git status` está limpo e `git ls-files` não lista `.env.local`.

Depois disso, siga a seção "Primeiros dias" do `README.md`: custo dos produtos e alíquota de imposto.

## Se travar

| O que aparece | O que é | O que fazer |
|---|---|---|
| `npx.ps1 não pode ser carregado` ou `a execução de scripts foi desabilitada` | PowerShell do Windows com scripts bloqueados | Repetir o comando com `npx.cmd` no lugar de `npx` |
| `Confirmation required ... agent mode` no `db push` | A IA rodou o comando e a ferramenta pede confirmação | `--dry-run` primeiro, mostrar ao dono, depois `--yes` |
| `could not translate host name` ou `Network is unreachable` ao falar com o banco | A conexão direta do Supabase gratuito é só IPv6, e a rede do computador está sem IPv6 | Usar o pooler, como mostra **Connect** no painel do projeto (endereço `aws-...pooler.supabase.com`, usuário `postgres.<project ref>`) |
| `Cannot find project ref` | O `link` do passo 3 não rodou nesta pasta | Rodar `npx supabase@3.2.0 link --project-ref <ref>` |
| Erro de limite de CPU no `wrangler deploy` | Plano gratuito do Workers | Ativar o plano pago na Cloudflare e publicar de novo |
| `APP_BASE_URL não configurada` ao conectar o Mercado Livre | Faltou a segunda publicação do passo 5 | Preencher `APP_BASE_URL` e publicar de novo |
| `o cadastro público do Supabase está LIGADO` no `configurar.mjs` | O passo 4 ficou pela metade | Desligar **Allow new users to sign up** em Authentication > Sign In / Providers e rodar o `configurar.mjs` de novo |
| `Unable to create project under Free Plan organization` | A conta do Supabase já tem 2 projetos gratuitos ativos | Criar a conta do Supabase com outro e-mail, ou liberar uma vaga |
| `Usuário ... não existe` no `configurar.mjs` | O usuário do passo 4 não foi criado, ou o e-mail está diferente | Conferir em Authentication > Users |
| `Já existe um dono da equipe` | A instalação já tem dono | Novos usuários: Configurações > Usuários |
| `o banco não respondeu` no `configurar.mjs` | Chave errada no `.env.local` ou passo 3 incompleto | Conferir os dois |
| `PA_UNAUTHORIZED_RESULT_FROM_POLICIES` na sincronização | Falta uma permissão do passo 8 na aplicação do Mercado Livre | Marcar a permissão em leitura e conectar de novo |
| A conexão do Mercado Livre volta com erro de `redirect_uri` | O endereço cadastrado difere do `APP_BASE_URL` | Deixar os dois idênticos |
| Pagamentos não sincronizam, o resto sim | A aplicação nova pode não ter acesso às APIs do Mercado Pago | Parar e avisar o mentor: é um caso ainda não confirmado |
