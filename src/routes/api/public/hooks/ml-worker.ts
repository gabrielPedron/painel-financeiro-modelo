// WORKER DA FILA DE SINCRONIZAÇÃO. Chamado automaticamente a cada 5 minutos.
// Pega as tarefas pendentes (pedidos, pagamentos, faturamento, anúncios, visitas)
// e executa uma a uma, com limite de tempo e repetição em caso de falha temporária.
// CUIDADO: só roda com o segredo correto no cabeçalho. A lógica de verdade está
// em src/lib/ml-worker.server.ts — altere lá, não aqui. Nunca faça o worker
// apagar dados já salvos para regravar: a gravação é por upsert.
import { createFileRoute } from "@tanstack/react-router";
import { cronAutorizado } from "@/lib/segredo";

export const Route = createFileRoute("/api/public/hooks/ml-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await cronAutorizado(request))) {
          return new Response("unauthorized", { status: 401 });
        }

        const { runWorkerTick } = await import("@/lib/ml-worker.server");
        try {
          const result = await runWorkerTick();
          return Response.json(result);
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
