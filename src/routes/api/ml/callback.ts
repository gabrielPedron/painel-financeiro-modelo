// RETORNO DA AUTORIZAÇÃO DO MERCADO LIVRE (redirect_uri /api/ml/callback).
// O Mercado Livre manda o usuário para cá depois que ele autoriza a conta.
// Aqui o código recebido vira token de acesso, os dados da conta são salvos e a
// carga inicial de dados é colocada na fila (tanto na conexão quanto na reconexão).
// CUIDADO: este endereço precisa ser idêntico ao cadastrado no DevCenter. Não
// mexa na lógica de tokens/Vault e nunca exponha o client secret ao navegador.
import { createFileRoute } from "@tanstack/react-router";
import { mesmaContaDoMl } from "@/lib/ml-conta";

function redirectTo(path: string): Response {
  return new Response(null, { status: 302, headers: { location: path } });
}

function errorRedirect(message: string, base: string): Response {
  const url = new URL(`${base}/configuracoes`);
  url.searchParams.set("aba", "integracoes");
  url.searchParams.set("erro", message.slice(0, 200));
  return redirectTo(url.toString());
}

function successRedirect(base: string): Response {
  const url = new URL(`${base}/configuracoes`);
  url.searchParams.set("aba", "integracoes");
  url.searchParams.set("conectado", "1");
  return redirectTo(url.toString());
}

export const Route = createFileRoute("/api/ml/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const {
          supabaseAdmin,
          exchangeCodeForToken,
          fetchNickname,
          fetchAdvertiserId,
          getRedirectUri,
          getAppBaseUrl,
          logSync,
          readVaultSecret,
          saveAccountTokens,
        } = await import("@/lib/ml-oauth.server");

        const base = getAppBaseUrl();
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const errorParam = url.searchParams.get("error");

        if (errorParam) {
          return errorRedirect(`Autorização negada: ${errorParam}`, base);
        }
        if (!code || !state) {
          return errorRedirect("Parâmetros inválidos no retorno do Mercado Livre.", base);
        }

        // 1. Look up and validate the state
        const { data: stateRow, error: stateErr } = await supabaseAdmin
          .from("oauth_states")
          .select("id, account_id, owner_id, expires_at, used_at")
          .eq("state", state)
          .maybeSingle();
        if (stateErr) return errorRedirect("Erro consultando state.", base);
        if (!stateRow) return errorRedirect("State inválido ou desconhecido.", base);
        if (stateRow.used_at) return errorRedirect("Este link de autorização já foi usado.", base);
        if (new Date(stateRow.expires_at).getTime() < Date.now()) {
          return errorRedirect("Link de autorização expirado. Tente conectar novamente.", base);
        }

        // 2. Mark as used immediately
        await supabaseAdmin
          .from("oauth_states")
          .update({ used_at: new Date().toISOString() })
          .eq("id", stateRow.id);

        // 3. Fetch account credentials
        const { data: account, error: accErr } = await supabaseAdmin
          .from("marketplace_accounts")
          .select("id, client_id, client_secret_id, site_id, external_user_id, external_nickname")
          .eq("id", stateRow.account_id)
          .maybeSingle();
        if (accErr || !account) return errorRedirect("Integração não encontrada.", base);
        if (!account.client_id || !account.client_secret_id) {
          return errorRedirect("Credenciais da integração ausentes.", base);
        }
        const clientSecret = await readVaultSecret(account.client_secret_id);
        if (!clientSecret) {
          return errorRedirect("Client Secret não encontrado no Vault.", base);
        }

        // 4. Exchange code for tokens
        try {
          const token = await exchangeCodeForToken({
            clientId: account.client_id,
            clientSecret,
            code,
            redirectUri: getRedirectUri(),
          });

          // Outra conta do ML misturaria os pedidos das duas no mesmo histórico (sync-08).
          // A conexão atual continua como está: nada é gravado.
          if (!mesmaContaDoMl(account.external_user_id, token.user_id)) {
            await logSync({
              accountId: account.id,
              syncType: "full",
              status: "erro",
              errorMessage: `Reconexão recusada: conta do ML ${token.user_id} diferente da ${account.external_user_id}`,
              details: { event: "oauth_outra_conta" },
            });
            return errorRedirect(
              `Esta integração é da conta do Mercado Livre ${account.external_nickname ?? account.external_user_id}. ` +
                "Entre no Mercado Livre com essa conta e conecte de novo; para outra conta, crie uma integração nova.",
              base,
            );
          }

          // 5. Save tokens (Vault) + user id
          const expiresAt = await saveAccountTokens(account.id, token);
          await supabaseAdmin
            .from("marketplace_accounts")
            .update({ external_user_id: token.user_id })
            .eq("id", account.id);

          // 6. Fetch nickname
          const nickname = await fetchNickname(token.access_token);
          if (nickname) {
            await supabaseAdmin
              .from("marketplace_accounts")
              .update({ external_nickname: nickname })
              .eq("id", account.id);
          }

          // 7. Try to resolve advertiser_id (best effort)
          const advertiserId = await fetchAdvertiserId(token.access_token, account.site_id ?? "MLB");
          if (advertiserId) {
            await supabaseAdmin
              .from("marketplace_accounts")
              .update({ advertiser_id: advertiserId })
              .eq("id", account.id);
          }

          // 8. Enfileirar a carga inicial SEMPRE (conexão e reconexão).
          // Antes isso só acontecia na primeira conexão, deixando a fila vazia
          // ao reconectar uma conta existente.
          let enqueued = 0;
          let enqueueError: string | null = null;
          try {
            await supabaseAdmin
              .from("marketplace_accounts")
              .update({ status: "conectada" })
              .eq("id", account.id);
            const { syncAccount } = await import("@/lib/ml-sync.server");
            const r = await syncAccount(account.id, 60);
            enqueued =
              r.enqueued.billing +
              r.enqueued.orders +
              r.enqueued.ads +
              r.enqueued.visits +
              r.enqueued.mp_payments;
            if (r.errors.length) enqueueError = r.errors.join(" | ").slice(0, 400);
          } catch (e) {
            enqueueError = (e as Error).message;
          }

          // 9. Log sync
          await logSync({
            accountId: account.id,
            syncType: "full",
            status: enqueueError ? "parcial" : "sucesso",
            recordsProcessed: enqueued,
            errorMessage: enqueueError,
            details: {
              event: "oauth_connected",
              nickname,
              advertiser_id: advertiserId,
              expires_at: expiresAt,
              enqueued,
            },
          });

          return successRedirect(base);

        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await supabaseAdmin
            .from("marketplace_accounts")
            .update({ status: "erro" })
            .eq("id", account.id);
          await logSync({
            accountId: account.id,
            syncType: "full",
            status: "erro",
            errorMessage: msg,
            details: { event: "oauth_callback_failed" },
          });
          return errorRedirect(msg, base);
        }
      },
    },
  },
});