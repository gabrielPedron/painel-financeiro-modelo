import { createFileRoute } from "@tanstack/react-router";
import { cronAutorizado } from "@/lib/segredo";

// Dispara os alertas do Telegram. Chamado pelo pg_cron:
//  - a cada 5 min com {"mode":"sales"} (vendas + reenvio de falhas)
//  - 1x por dia com {"mode":"daily"} (anúncios com MC negativa)
export const Route = createFileRoute("/api/public/hooks/telegram-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await cronAutorizado(request))) {
          return new Response("unauthorized", { status: 401 });
        }

        let mode: "sales" | "daily" = "sales";
        try {
          const text = await request.text();
          const body = text ? (JSON.parse(text) as { mode?: string }) : null;
          if (body?.mode === "daily") mode = "daily";
        } catch {
          mode = "sales";
        }

        const { runTelegramAlerts } = await import("@/lib/telegram-alerts.server");
        try {
          return Response.json(await runTelegramAlerts(mode));
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
