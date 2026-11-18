import { createFileRoute } from "@tanstack/react-router";
import { cronAutorizado } from "@/lib/segredo";

// Continuous integrity auditor. For each connected account, run a suite of
// checks (API completeness, DB consistency, financial sanity, fee classification,
// token health). Records findings in `audit_findings`; auto_fixable checks
// enqueue the corresponding sync jobs. Marks findings that stop reappearing
// as 'resolvido'. Runs every 6h via pg_cron and can be triggered ad-hoc.
export const Route = createFileRoute("/api/public/hooks/ml-audit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await cronAutorizado(request))) {
          return new Response("unauthorized", { status: 401 });
        }

        const { runAudit } = await import("@/lib/audit.server");
        try {
          const summary = await runAudit();
          return Response.json({ ok: true, ...summary });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});