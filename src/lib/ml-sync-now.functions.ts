import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { donoDaEquipe, exigirTela } from "./equipe";

const daysInput = z.object({
  days: z.number().int().min(1).max(400).optional(),
  account_id: z.string().uuid().optional(),
});

/**
 * Enfileira a carga completa (billing, orders, items, ads, visitas, MP) das
 * contas conectadas do usuário. O drenar acontece em `drainMlQueue`.
 */
export const enqueueMlFullSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => daysInput.parse(d))
  .handler(async ({ data, context }) => {
    // Contas da equipe (membro também sincroniza); tela Mercado Livre ou aba Integrações (seg-05).
    await exigirTela(context.supabase, ["mercado-livre", "configuracoes:integracoes"]);
    const dono = await donoDaEquipe(context.supabase);
    const { supabaseAdmin } = await import("./ml-oauth.server");
    const { syncAccount } = await import("./ml-sync.server");
    const days = data.days ?? 60;

    let q = supabaseAdmin
      .from("marketplace_accounts")
      .select("id")
      .eq("owner_id", dono)
      .eq("status", "conectada");
    if (data.account_id) q = q.eq("id", data.account_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    let enqueued = 0;
    const errors: string[] = [];
    for (const acc of rows ?? []) {
      try {
        const r = await syncAccount(acc.id, days);
        enqueued +=
          r.enqueued.billing +
          r.enqueued.orders +
          r.enqueued.ads +
          r.enqueued.visits +
          r.enqueued.mp_payments;
        if (r.errors.length) errors.push(...r.errors);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    return { accounts: (rows ?? []).length, enqueued, errors };
  });

/** Executa uma rodada do worker (drena parte da fila) e devolve o resultado. */
export const drainMlQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // A rodada processa a fila de todos os donos: tela Mercado Livre ou aba Integrações (seg-05).
    await exigirTela(context.supabase, ["mercado-livre", "configuracoes:integracoes"]);
    const { runWorkerTick } = await import("./ml-worker.server");
    const r = await runWorkerTick({ timeLimitMs: 40_000 });
    return {
      processed: r.processed,
      rows: r.results.reduce((s, x) => s + (x.rows ?? 0), 0),
      errors: r.results.filter((x) => !x.ok).map((x) => `${x.day}: ${x.error}`),
    };
  });

/**
 * Enfileira a CARGA HISTÓRICA completa (pedidos, pagamentos, faturamento e,
 * por último, ADS/visitas) desde o início real da conta. Prioridade baixa:
 * o dia corrente continua passando na frente.
 */
export const enqueueMlBackfill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ account_id: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    // Carga histórica das contas da equipe; só com a aba Integrações (seg-05).
    await exigirTela(context.supabase, "configuracoes:integracoes");
    const dono = await donoDaEquipe(context.supabase);
    const { supabaseAdmin } = await import("./ml-oauth.server");
    const { backfillAccount } = await import("./ml-sync.server");

    let q = supabaseAdmin
      .from("marketplace_accounts")
      .select("id, nickname")
      .eq("owner_id", dono)
      .eq("status", "conectada");
    if (data.account_id) q = q.eq("id", data.account_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const accounts: Array<{
      id: string;
      nickname: string;
      start_date: string;
      start_source: string;
      enqueued: Record<string, number>;
    }> = [];
    const errors: string[] = [];
    let total = 0;
    for (const acc of rows ?? []) {
      try {
        const r = await backfillAccount(acc.id);
        total +=
          r.enqueued.billing +
          r.enqueued.orders +
          r.enqueued.mp_payments +
          r.enqueued.ads +
          r.enqueued.visits;
        accounts.push({
          id: acc.id,
          nickname: acc.nickname,
          start_date: r.start_date,
          start_source: r.start_source,
          enqueued: r.enqueued as unknown as Record<string, number>,
        });
        if (r.errors.length) errors.push(...r.errors);
      } catch (e) {
        errors.push(`${acc.nickname}: ${(e as Error).message}`);
      }
    }
    return { accounts, enqueued: total, errors };
  });

/** Situação atual da fila para o usuário logado. */
export const mlQueueStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Fila da equipe, não só de quem está logado.
    await exigirTela(context.supabase, ["mercado-livre", "configuracoes:integracoes"]);
    const dono = await donoDaEquipe(context.supabase);
    const { supabaseAdmin } = await import("./ml-oauth.server");
    const { data, error } = await supabaseAdmin
      .from("sync_jobs")
      .select("status, job_type, last_error, target_key, target_date, priority")
      .eq("owner_id", dono)
      .limit(20000);
    if (error) throw new Error(error.message);
    const counts = { pendente: 0, executando: 0, concluido: 0, erro: 0 } as Record<string, number>;
    const errors: string[] = [];
    const porTipo: Record<string, { pendente: number; executando: number; concluido: number; erro: number }> = {};
    let historicoPendente = 0;
    let rateLimited = 0;
    const emAndamento: string[] = [];
    for (const j of data ?? []) {
      const status = j.status === "incompleto" ? "concluido" : j.status;
      counts[status] = (counts[status] ?? 0) + 1;
      const t = (porTipo[j.job_type] ??= { pendente: 0, executando: 0, concluido: 0, erro: 0 });
      t[status as keyof typeof t] = (t[status as keyof typeof t] ?? 0) + 1;
      const prio = (j as { priority?: number }).priority ?? 100;
      if (prio >= 200 && (j.status === "pendente" || j.status === "executando")) historicoPendente += 1;
      if (j.status === "executando" && emAndamento.length < 5) {
        emAndamento.push(`${j.job_type} ${j.target_key ?? j.target_date ?? ""}`.trim());
      }
      if (j.last_error && /429/.test(j.last_error)) rateLimited += 1;
      if ((j.status === "erro" || j.status === "incompleto") && j.last_error && errors.length < 5) {
        errors.push(`${j.job_type}: ${j.last_error}`);
      }
    }
    return {
      pendente: counts.pendente ?? 0,
      executando: counts.executando ?? 0,
      concluido: counts.concluido ?? 0,
      erro: counts.erro ?? 0,
      historico_pendente: historicoPendente,
      rate_limited: rateLimited,
      por_tipo: porTipo,
      em_andamento: emAndamento,
      errors,
    };
  });

