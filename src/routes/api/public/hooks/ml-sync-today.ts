import { createFileRoute } from "@tanstack/react-router";
import { cronAutorizado } from "@/lib/segredo";

type Body = { account_id?: string; dias?: number } | null;

// Sincroniza apenas o DIA CORRENTE (pedidos + pagamentos do Mercado Pago), de hora em hora.
// Com {"dias": N}, reconsulta pedidos e pagamentos dos últimos N dias (cancelamentos e devoluções
// tardias, sync-01), uma vez por dia. O processamento pesado fica no ml-worker.
export const Route = createFileRoute("/api/public/hooks/ml-sync-today")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await cronAutorizado(request))) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/lib/ml-oauth.server");
        const { syncAccountToday, recheckRecentForAccount } = await import("@/lib/ml-sync.server");

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

        const results: Array<{ id: string; ok: boolean; enqueued?: number; error?: string }> = [];
        for (const acc of accounts ?? []) {
          try {
            const dias = Math.min(Math.max(Math.trunc(Number(body?.dias ?? 0)), 0), 90);
            const r = dias > 1 ? await recheckRecentForAccount(acc.id, dias) : await syncAccountToday(acc.id);
            results.push({ id: acc.id, ok: true, enqueued: r.enqueued });
          } catch (e) {
            results.push({ id: acc.id, ok: false, error: (e as Error).message });
          }
        }

        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});