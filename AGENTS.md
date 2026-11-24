# Onde este sistema roda

- **App:** um Cloudflare Worker. Nome e variáveis em `wrangler.jsonc`.
- **Banco, login e cofre:** um projeto Supabase. Valores públicos em `.env`.
- **Instalação do zero:** `INSTALAR.md`. Siga quando `wrangler.jsonc` ainda tiver `NOME-DO-SEU-SISTEMA`.
  O dono não programa: o guia dele é `PASSO-A-PASSO.md`. Fale com ele sem termos técnicos.
- **Conferir se está funcionando:** `node scripts/conferir.mjs` (só lê; mostra app, banco, login e Mercado Livre).
- **Publicar:** `bun run build && npx wrangler deploy`.
- **Regras do cálculo e tabelas:** `CONTEXTO-IA.md`. Leia antes de mexer em valores, margem ou conciliação.

# Segredos

- Segredo é senha, chave `sb_secret_...`, Client Secret, token. O dono digita no terminal dele, no
  painel do serviço ou em `.env.local`. Peça que ele faça isso e espere; a conversa fica só com valores públicos.
- `.env` e `wrangler.jsonc` vão para o Git e só carregam valores públicos. `.env.local` fica fora (`*.local` no `.gitignore`).
- Os segredos do Worker (`SUPABASE_SERVICE_ROLE_KEY`, `ML_CRON_SECRET`) são gravados por `node scripts/configurar.mjs`.
  Opcionais, com `npx wrangler secret put NOME`: `OPENAI_API_KEY` (leitura de boletos) e `TELEGRAM_BOT_TOKEN` (alertas).

# Banco

- O banco nasce de `supabase/migrations/20260101000000_base.sql`. Deixe esse arquivo como está.
- Toda mudança no banco é uma migração nova: `npx supabase@3.2.0 migration new <nome>` cria o arquivo; depois
  `node scripts/subir-banco.mjs` mostra o que seria aplicado e, com o sim do dono, `node scripts/subir-banco.mjs --aplicar`.
  Use sempre o script: na versão 3.2.0 da ferramenta, `supabase db push --remote` sem endereço não funciona.
- Mudança que apaga coluna, tabela ou dado: mostre ao dono o que será perdido e espere o sim dele.
- O plano gratuito do Supabase não guarda cópia do banco. Antes de qualquer migração, rode
  `node scripts/copia-banco.mjs`: ele salva os dados de cada tabela em Documentos/Backups/painel-financeiro e
  diz quantas linhas copiou. Confira que terminou sem erro antes de seguir. A estrutura do banco já está nas
  migrações; usuários do login e tokens do Mercado Livre não entram na cópia.

# Mercado Livre

- O sistema só lê a conta: toda chamada às APIs do Mercado Livre e do Mercado Pago é `GET`. Uma mudança que
  escreva na conta (preço, estoque, anúncio, mensagem) precisa de pedido explícito do dono e de permissão nova na aplicação.
- As chamadas saem só do servidor (`*.server.ts` e `src/routes/api`). O navegador nunca recebe token.
- Antes de ler um campo novo da API, apure com `src/lib/ml-apuracao` (`LEIAME.md` na pasta): o nome combinado
  na conversa quase nunca é o nome do campo.

# Agendamentos

O `pg_cron` do Supabase chama `/api/public/hooks/*` pela função `public.chamar_gancho`, que lê o endereço do
app e o segredo no cofre. Se o endereço do app mudar: `node scripts/configurar.mjs` de novo, e atualizar a URI
de redirect no Mercado Livre e o Site URL no Supabase Auth.
