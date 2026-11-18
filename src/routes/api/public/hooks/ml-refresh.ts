import { createFileRoute } from "@tanstack/react-router";
import { cronAutorizado } from "@/lib/segredo";

type Body = { account_id?: string } | null;

export const Route = createFileRoute("/api/public/hooks/ml-refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await cronAutorizado(request))) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin, refreshAccessToken, logSync, readVaultSecret, saveAccountTokens } =
          await import("@/lib/ml-oauth.server");

        let body: Body = null;
        try {
          const text = await request.text();
          body = text ? (JSON.parse(text) as Body) : null;
        } catch {
          body = null;
        }

        let query = supabaseAdmin
          .from("marketplace_accounts")
          .select("id, client_id, client_secret_id, refresh_token_id")
          .eq("status", "conectada")
          .not("refresh_token_id", "is", null);

        if (body?.account_id) {
          query = query.eq("id", body.account_id);
        }

        const { data: accounts, error } = await query;
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const results: Array<{ id: string; ok: boolean; error?: string }> = [];

        for (const acc of accounts ?? []) {
          if (!acc.client_id || !acc.client_secret_id || !acc.refresh_token_id) continue;
          try {
            const [clientSecret, refreshToken] = await Promise.all([
              readVaultSecret(acc.client_secret_id),
              readVaultSecret(acc.refresh_token_id),
            ]);
            if (!clientSecret || !refreshToken) {
              results.push({ id: acc.id, ok: false, error: "Vault secret ausente" });
              continue;
            }
            const token = await refreshAccessToken({
              clientId: acc.client_id,
              clientSecret,
              refreshToken,
            });
            // CRITICAL: save the NEW refresh_token together with the new access_token
            // in Vault; saveAccountTokens updates the row atomically.
            const expiresAt = await saveAccountTokens(acc.id, token);
            await logSync({
              accountId: acc.id,
              syncType: "token_refresh",
              status: "sucesso",
              details: { expires_at: expiresAt },
            });
            results.push({ id: acc.id, ok: true });
          } catch (e) {
            const err = e as Error & { code?: string };
            const invalid = err.code === "invalid_grant" || /invalid_grant/i.test(err.message);
            if (invalid) {
              await supabaseAdmin
                .from("marketplace_accounts")
                .update({ status: "token_expirado" })
                .eq("id", acc.id);
            }
            await logSync({
              accountId: acc.id,
              syncType: "token_refresh",
              status: "erro",
              errorMessage: err.message,
              details: { invalid_grant: invalid },
            });
            results.push({ id: acc.id, ok: false, error: err.message });
          }
        }

        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});