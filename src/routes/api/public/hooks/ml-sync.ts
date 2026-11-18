// ENFILEIRA UMA SINCRONIZAÇÃO. Recebe a conta e a quantidade de dias e cria as
// tarefas na fila; quem executa depois é o worker (ml-worker).
// Usado pelos agendamentos automáticos e pelo botão "Sincronizar agora".
// CUIDADO: só roda com o segredo correto no cabeçalho. Enfileirar muitos dias de
// uma vez pode esbarrar no limite de chamadas do Mercado Livre — o período é
// fatiado de propósito. Não altere isso sem entender o rate limit.
import { createFileRoute } from "@tanstack/react-router";
import { cronAutorizado } from "@/lib/segredo";

type Body = { account_id?: string; days?: number } | null;

export const Route = createFileRoute("/api/public/hooks/ml-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await cronAutorizado(request))) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/lib/ml-oauth.server");
        const { syncAccount } = await import("@/lib/ml-sync.server");

        let body: Body = null;
        try {
          const text = await request.text();
          body = text ? (JSON.parse(text) as Body) : null;
        } catch {
          body = null;
        }
        const days = Math.min(Math.max(Number(body?.days ?? 3), 1), 400);

        let query = supabaseAdmin
          .from("marketplace_accounts")
          .select("id")
          .eq("status", "conectada");
        if (body?.account_id) query = query.eq("id", body.account_id);
        const { data: accounts, error } = await query;
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const results: Array<{ id: string; ok: boolean; error?: string; summary?: unknown }> = [];
        for (const acc of accounts ?? []) {
          try {
            const r = await syncAccount(acc.id, days);
            results.push({ id: acc.id, ok: true, summary: r });
          } catch (e) {
            results.push({ id: acc.id, ok: false, error: (e as Error).message });
          }
        }

        return Response.json({ ok: true, processed: results.length, days, results });
      },
    },
  },
});