import { createFileRoute } from "@tanstack/react-router";
import { cronAutorizado } from "@/lib/segredo";

// Continuous integrity auditor. For each connected account, run a suite of
// checks (API completeness, DB consistency, financial sanity, fee classification,
// token health). Records findings in `audit_findings`; auto_fixable checks
// enqueue the corresponding sync jobs. Marks findings that stop reappearing
// as 'resolvido'. Runs every 6h via pg_cron and can be triggered ad-hoc.
// Depois da auditoria, relê no ML o preço cheio e a promoção ativa dos anúncios da aba Ajuste de
// preço (ajuste_preco), para o MCP e a tela partirem da leitura do dia. Uma falha aqui não derruba a auditoria.
export const Route = createFileRoute("/api/public/hooks/ml-audit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await cronAutorizado(request))) {
          return new Response("unauthorized", { status: 401 });
        }

        const { runAudit } = await import("@/lib/audit.server");
        const { atualizarLeiturasDeTodasAsContas } = await import("@/lib/ajuste-preco.server");
        const lerPrecos = () => atualizarLeiturasDeTodasAsContas()
          .catch((e: Error) => ({ contas: 0, lidos: 0, erros: [e.message] }));
        try {
          const summary = await runAudit();
          return Response.json({ ok: true, ...summary, precos: await lerPrecos() });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message, precos: await lerPrecos() }, { status: 500 });
        }
      },
    },
  },
});
