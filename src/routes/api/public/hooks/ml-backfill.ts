import { createFileRoute } from "@tanstack/react-router";
import { cronAutorizado } from "@/lib/segredo";

type Body = { account_id?: string } | null;

// Enfileira a CARGA HISTÓRICA completa das contas conectadas (pedidos,
// pagamentos, faturamento e, por último, ADS/visitas). Protegido por segredo
// de cron — o processamento em si fica no ml-worker.
export const Route = createFileRoute("/api/public/hooks/ml-backfill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await cronAutorizado(request))) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/lib/ml-oauth.server");
        const { backfillAccount } = await import("@/lib/ml-sync.server");

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

        const results: Array<Record<string, unknown>> = [];
        for (const acc of accounts ?? []) {
          try {
            results.push(await backfillAccount(acc.id));
          } catch (e) {
            results.push({ account_id: acc.id, error: (e as Error).message });
          }
        }
        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});
