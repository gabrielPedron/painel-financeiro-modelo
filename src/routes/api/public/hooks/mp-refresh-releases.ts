import { createFileRoute } from "@tanstack/react-router";
import { cronAutorizado } from "@/lib/segredo";

type Body = { account_id?: string; limit?: number } | null;

// Reconsulta no Mercado Pago os pagamentos vencidos que ainda constam pendentes. Roda todo dia
// pelo agendador (sync-01) e fica no histórico como "liberacoes".
export const Route = createFileRoute("/api/public/hooks/mp-refresh-releases")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await cronAutorizado(request))) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin, logSync } = await import("@/lib/ml-oauth.server");
        const { refreshPendingReleases } = await import("@/lib/ml-sync.server");

        let body: Body = null;
        try {
          const text = await request.text();
          body = text ? (JSON.parse(text) as Body) : null;
        } catch {
          body = null;
        }

        let query = supabaseAdmin
          .from("marketplace_accounts")
          .select("id")
          .eq("status", "conectada");
        if (body?.account_id) query = query.eq("id", body.account_id);
        const { data: accounts, error } = await query;
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const limit = body?.limit && body.limit > 0 ? Math.min(body.limit, 500) : 300;
        const results: Array<Record<string, unknown>> = [];
        let atualizados = 0;
        for (const acc of accounts ?? []) {
          try {
            const r = await refreshPendingReleases(acc.id, limit);
            atualizados += r.atualizados;
            results.push(r);
            await logSync({
              accountId: acc.id,
              syncType: "liberacoes",
              status: r.errors.length === 0 ? "sucesso" : r.atualizados > 0 ? "parcial" : "erro",
              recordsProcessed: r.atualizados,
              errorMessage: `Liberações: ${r.verificados} conferida(s), ${r.atualizados} atualizada(s)${r.errors.length ? `, ${r.errors.length} erro(s): ${r.errors[0]}` : ""}`,
            });
          } catch (e) {
            results.push({ account_id: acc.id, error: (e as Error).message });
            await logSync({ accountId: acc.id, syncType: "liberacoes", status: "erro", errorMessage: (e as Error).message });
          }
        }

        return Response.json({ ok: true, atualizados, results });
      },
    },
  },
});
