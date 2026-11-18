import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { donoDaEquipe, exigirTela } from "./equipe";

/** Envia uma mensagem de teste para o chat configurado. */
export const telegramTestMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { sendTelegramTest } = await import("./telegram-alerts.server");
    // O chat configurado é o da equipe (do dono), também para membros (int-03).
    await exigirTela(context.supabase, "configuracoes:telegram");
    return await sendTelegramTest(await donoDaEquipe(context.supabase));
  });

/** Roda os alertas manualmente (botão "Verificar agora"). */
export const telegramRunAlertsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { mode?: "sales" | "daily" }) => data ?? {})
  .handler(async ({ data, context }) => {
    // Roda os alertas de todos os donos: só quem tem a aba Telegram (seg-05).
    await exigirTela(context.supabase, "configuracoes:telegram");
    const { runTelegramAlerts } = await import("./telegram-alerts.server");
    return await runTelegramAlerts(data.mode === "daily" ? "daily" : "sales");
  });
