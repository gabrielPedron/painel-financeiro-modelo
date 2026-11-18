import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { donoDaEquipe, exigirTela } from "./equipe";

/**
 * Enfileira a sincronização do dia corrente (pedidos + Mercado Pago) para
 * todas as contas conectadas do usuário. O worker processa em até ~2 minutos.
 */
export const syncTodayNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Contas da equipe; botão da Conciliação (seg-05).
    await exigirTela(context.supabase, "conciliacao");
    const dono = await donoDaEquipe(context.supabase);
    const { supabaseAdmin } = await import("./ml-oauth.server");
    const { syncAccountToday } = await import("./ml-sync.server");

    const { data: rows, error } = await supabaseAdmin
      .from("marketplace_accounts")
      .select("id")
      .eq("owner_id", dono)
      .eq("status", "conectada");
    if (error) throw new Error(error.message);

    let enqueued = 0;
    const errors: string[] = [];
    for (const acc of rows ?? []) {
      try {
        const r = await syncAccountToday(acc.id);
        enqueued += r.enqueued;
        if (r.errors.length) errors.push(...r.errors);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    return { accounts: (rows ?? []).length, enqueued, errors };
  });
/**
 * Reconsulta no Mercado Pago os pagamentos já vencidos que continuam pendentes,
 * atualizando o status de liberação. Usado pelo botão "Atualizar agora".
 */
export const refreshReleasesNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Contas da equipe; botão da Conciliação (seg-05).
    await exigirTela(context.supabase, "conciliacao");
    const dono = await donoDaEquipe(context.supabase);
    const { supabaseAdmin } = await import("./ml-oauth.server");
    const { refreshPendingReleases } = await import("./ml-sync.server");

    const { data: rows, error } = await supabaseAdmin
      .from("marketplace_accounts")
      .select("id")
      .eq("owner_id", dono)
      .eq("status", "conectada");
    if (error) throw new Error(error.message);

    let atualizados = 0;
    const errors: string[] = [];
    for (const acc of rows ?? []) {
      try {
        const r = await refreshPendingReleases(acc.id, 100);
        atualizados += r.atualizados;
        if (r.errors.length) errors.push(...r.errors.slice(0, 3));
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    return { atualizados, errors };
  });
