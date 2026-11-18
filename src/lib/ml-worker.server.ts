// Núcleo do worker que drena a fila `sync_jobs`.
// Extraído da rota /api/public/hooks/ml-worker para poder ser chamado também
// pelo botão "Sincronizar agora" (server function), sem duplicar lógica.

import { conferirFaturamento } from "@/lib/conferencia-faturamento";

export type WorkerJobResult = {
  id: string;
  day: string;
  ok: boolean;
  rows?: number;
  error?: string;
  account_id: string;
};

export type WorkerTickResult = {
  ok: true;
  picked: number;
  processed: number;
  results: WorkerJobResult[];
  elapsed_ms: number;
};

export async function runWorkerTick(opts?: {
  timeLimitMs?: number;
  accountId?: string;
}): Promise<WorkerTickResult> {
  const { supabaseAdmin, logSync } = await import("@/lib/ml-oauth.server");
  const {
    syncAdsForDay,
    syncVisitsForDay,
    syncBillingForPeriod,
    syncOrdersForRange,
    getAccountToken,
    syncItemsForAccount,
    runItemsBackfill,
    syncMpPaymentsForRange,
    fetchBillingTotal,
  } = await import("@/lib/ml-sync.server");

  const TIME_LIMIT_MS = opts?.timeLimitMs ?? 150_000;
  const JOB_TIMEOUT_MS: Record<string, number> = {
    ads: 45_000,
    visits: 45_000,
    billing: 120_000,
    orders: 120_000,
    items: 90_000,
    mp_payments: 120_000,
  };
  const started = Date.now();
  const results: WorkerJobResult[] = [];

  const tokenCache = new Map<
    string,
    { token: string; advertiserId: number | null; externalUserId: number | null }
  >();

  const stuckThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await supabaseAdmin
    .from("sync_jobs")
    .update({ status: "pendente", started_at: null })
    .eq("status", "executando")
    .lt("started_at", stuckThreshold);
  await supabaseAdmin
    .from("sync_jobs")
    .update({ status: "pendente" })
    .eq("status", "executando")
    .is("started_at", null);

  let jobsQuery = supabaseAdmin
    .from("sync_jobs")
    .select(
      "id, account_id, job_type, target_date, target_key, attempts, status, progress_offset, progress_cursor, transient_retries, verify_passes, priority",
    )
    .in("status", ["pendente", "erro"])
    .lt("attempts", 3)
    .order("priority", { ascending: true })
    .order("target_date", { ascending: false })
    .limit(15);
  if (opts?.accountId) jobsQuery = jobsQuery.eq("account_id", opts.accountId);
  const { data: jobs, error: jobsErr } = await jobsQuery;
  if (jobsErr) throw new Error(jobsErr.message);

  // Ordem de execução: pendentes antes de erros, prioridade menor primeiro
  // (dia corrente = 100, carga histórica = 200+), depois data mais recente.
  (jobs ?? []).sort((a, b) => {
    if (a.status !== b.status) return a.status === "pendente" ? -1 : 1;
    const pa = (a as { priority?: number }).priority ?? 100;
    const pb = (b as { priority?: number }).priority ?? 100;
    if (pa !== pb) return pa - pb;
    return (b.target_date ?? "").localeCompare(a.target_date ?? "");
  });

  const hasHeavy = (jobs ?? []).some((j) => j.job_type === "billing" || j.job_type === "orders");
  const maxJobs = hasHeavy ? 5 : 15;
  const jobsToRun = (jobs ?? []).slice(0, maxJobs);


  for (const job of jobsToRun) {
    if (Date.now() - started > TIME_LIMIT_MS) break;
    const validType =
      job.job_type === "ads" ||
      job.job_type === "visits" ||
      job.job_type === "billing" ||
      job.job_type === "orders" ||
      job.job_type === "items" ||
      job.job_type === "mp_payments";
    const needsDate = job.job_type === "ads" || job.job_type === "visits";
    const needsKey =
      job.job_type === "billing" ||
      job.job_type === "orders" ||
      job.job_type === "items" ||
      job.job_type === "mp_payments";
    if (!validType || (needsDate && !job.target_date) || (needsKey && !job.target_key)) {
      await supabaseAdmin
        .from("sync_jobs")
        .update({
          status: "erro",
          last_error: "job inválido",
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      continue;
    }

    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("sync_jobs")
      .update({ status: "executando", started_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", job.status)
      .select("id")
      .maybeSingle();
    if (claimErr || !claimed) continue;

    const jobTimeoutMs = JOB_TIMEOUT_MS[job.job_type] ?? 45_000;
    const offsetBefore = job.progress_offset ?? 0;
    const cursorBefore = (job as { progress_cursor?: string | null }).progress_cursor ?? null;
    try {
      let creds = tokenCache.get(job.account_id);
      if (!creds) {
        creds = await getAccountToken(job.account_id);
        tokenCache.set(job.account_id, creds);
      }
      let skipNote: string | null = null;
      const work = (async (): Promise<number> => {
        if (job.job_type === "ads") {
          if (!creds!.advertiserId) throw new Error("advertiser_id ausente");
          const r = await syncAdsForDay(
            job.account_id,
            creds!.token,
            creds!.advertiserId,
            job.target_date!,
          );
          if (r.skipped) skipNote = r.note ?? "Sem campanha de Product Ads nesta data";
          return r.rows;

        } else if (job.job_type === "visits") {
          if (!creds!.externalUserId) throw new Error("external_user_id ausente");
          const r = await syncVisitsForDay(
            job.account_id,
            creds!.token,
            creds!.externalUserId,
            job.target_date!,
          );
          return r.visits;
        } else if (job.job_type === "billing") {
          const r = await syncBillingForPeriod(job.account_id, creds!.token, job.target_key!, {
            startOffset: job.progress_offset ?? 0,
            startCursor: (job as { progress_cursor?: string | null }).progress_cursor ?? null,
            jobId: job.id,
          });
          return r.count;
        } else if (job.job_type === "orders") {
          if (!creds!.externalUserId) throw new Error("external_user_id ausente");
          const [fromDay, toDay] = (job.target_key ?? "").split(":");
          if (!fromDay || !toDay) throw new Error("target_key inválido");
          return await syncOrdersForRange(
            job.account_id,
            creds!.token,
            creds!.externalUserId,
            fromDay,
            toDay,
          );
        } else if (job.job_type === "items") {
          if (!creds!.externalUserId) throw new Error("external_user_id ausente");
          const r = await syncItemsForAccount(job.account_id, creds!.token, creds!.externalUserId, {
            startOffset: job.progress_offset ?? 0,
            startScroll: (job as { progress_cursor?: string | null }).progress_cursor ?? null,
            jobId: job.id,
          });
          if (!r.done) {
            throw new Error(`timeout parcial items (offset=${r.nextOffset})`);
          }
          await runItemsBackfill();
          return r.processed;
        } else if (job.job_type === "mp_payments") {
          const [fromDay, toDay] = (job.target_key ?? "").split(":");
          if (!fromDay || !toDay) throw new Error("target_key inválido");
          if (!creds!.externalUserId) throw new Error("external_user_id ausente");
          return await syncMpPaymentsForRange(job.account_id, creds!.token, fromDay, toDay, creds!.externalUserId);
        }
        return 0;
      })();
      const rows = await Promise.race<number>([
        work,
        new Promise<number>((_, reject) =>
          setTimeout(
            () => reject(new Error(`HTTP 599 timeout ${Math.round(jobTimeoutMs / 1000)}s`)),
            jobTimeoutMs,
          ),
        ),
      ]);

      let requeuedForVerify = false;
      let fimStatus = "concluido";
      let fimNota: string | null = skipNote;
      if (job.job_type === "billing") {
        const verifyPasses = (job as { verify_passes?: number }).verify_passes ?? 0;
        try {
          const apiTotal = await fetchBillingTotal(creds!.token, job.target_key!);
          // Sem a cópia que o ML passou a listar num período mais novo (sync-07, como as telas).
          const { data: localCount, error: countErr } = await supabaseAdmin.rpc("billing_lancamentos_no_periodo" as never, {
            _account_id: job.account_id,
            _period_key: job.target_key!,
          } as never);
          if (countErr) throw new Error(countErr.message);
          const conferencia = conferirFaturamento(apiTotal, Number(localCount ?? 0), verifyPasses);
          if (conferencia.acao === "reconferir") {
            const { data: maxIdRes } = await supabaseAdmin.rpc("billing_max_detail_id", {
              _account_id: job.account_id,
              _period_key: job.target_key!,
            });
            const nextCursor = (maxIdRes as string | null) ?? null;
            await supabaseAdmin
              .from("sync_jobs")
              .update({
                status: "pendente",
                attempts: 0,
                transient_retries: 0,
                verify_passes: verifyPasses + 1,
                progress_offset: 0,
                progress_cursor: nextCursor,
                started_at: null,
                finished_at: new Date().toISOString(),
                last_error: conferencia.nota,
              })
              .eq("id", job.id);
            requeuedForVerify = true;
          } else if (conferencia.acao === "incompleto") {
            fimStatus = "incompleto";
            fimNota = conferencia.nota;
          }
        } catch (verifyErr) {
          console.error("billing verify falhou:", verifyErr);
        }
      }
      if (!requeuedForVerify) {
        await supabaseAdmin
          .from("sync_jobs")
          .update({
            status: fimStatus,
            finished_at: new Date().toISOString(),
            last_error: fimNota,
            attempts: (job.attempts ?? 0) + 1,
          })
          .eq("id", job.id);
      }

      results.push({
        id: job.id,
        day: job.target_date ?? job.target_key ?? "",
        ok: true,
        rows,
        account_id: job.account_id,
      });
    } catch (e) {
      const rawMsg = ((e as Error).message ?? "erro").slice(0, 300);
      const isRateLimit = /HTTP\s*429/i.test(rawMsg);
      const isTimeout = /timeout/i.test(rawMsg);
      const isTransient = isRateLimit || /HTTP\s5\d\d/i.test(rawMsg) || isTimeout;
      const attemptsSoFar = job.attempts ?? 0;
      const transientSoFar = job.transient_retries ?? 0;
      const rateLimitBudget = 10;
      let progressedOffset: number | null = null;
      let progressedCursor: string | null = null;
      if (isTimeout) {
        const { data: fresh } = await supabaseAdmin
          .from("sync_jobs")
          .select("progress_offset, progress_cursor")
          .eq("id", job.id)
          .maybeSingle();
        progressedOffset = fresh?.progress_offset ?? null;
        progressedCursor =
          (fresh as { progress_cursor?: string | null } | null)?.progress_cursor ?? null;
      }
      const offsetAdvanced = progressedOffset != null && progressedOffset > offsetBefore;
      const cursorAdvanced = progressedCursor != null && progressedCursor !== cursorBefore;
      const madeProgress = isTimeout && (offsetAdvanced || cursorAdvanced);
      const timeoutBudget = job.job_type === "billing" ? 20 : 5;
      const canRetryProgress = madeProgress && transientSoFar < timeoutBudget;
      const canRetryRateLimit = isRateLimit && transientSoFar < rateLimitBudget;
      const canRetryOther = isTransient && !isRateLimit && !madeProgress && attemptsSoFar < 1;
      if (canRetryProgress || canRetryRateLimit || canRetryOther) {
        const bumpTransient = canRetryProgress || canRetryRateLimit;
        const msg = canRetryProgress
          ? cursorAdvanced
            ? `Retomando pelo cursor ${progressedCursor}`
            : `Retomando do registro ${progressedOffset}`
          : `Temporário: ${rawMsg}`;
        await supabaseAdmin
          .from("sync_jobs")
          .update({
            status: "pendente",
            last_error: msg,
            started_at: null,
            finished_at: new Date().toISOString(),
            ...(bumpTransient ? { transient_retries: transientSoFar + 1 } : {}),
          })
          .eq("id", job.id);
        // Backoff em caso de rate limit para não martelar a API do ML.
        if (isRateLimit) await new Promise((r) => setTimeout(r, 2000));
      } else {
        await supabaseAdmin
          .from("sync_jobs")
          .update({
            status: "erro",
            last_error: isTransient ? `Temporário: ${rawMsg}` : rawMsg,
            attempts: attemptsSoFar + 1,
            finished_at: new Date().toISOString(),
          })
          .eq("id", job.id);
      }
      results.push({
        id: job.id,
        day: job.target_date ?? job.target_key ?? "",
        ok: false,
        error: rawMsg,
        account_id: job.account_id,
      });
    }
    // Carga histórica: espaça as chamadas para não provocar HTTP 429.
    if ((((job as { priority?: number }).priority ?? 100) >= 200)) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }


  const byAccount = new Map<string, { ok: number; err: number; rows: number }>();
  for (const r of results) {
    const s = byAccount.get(r.account_id) ?? { ok: 0, err: 0, rows: 0 };
    if (r.ok) {
      s.ok += 1;
      s.rows += r.rows ?? 0;
    } else {
      s.err += 1;
    }
    byAccount.set(r.account_id, s);
  }
  for (const [accountId, s] of byAccount) {
    await logSync({
      accountId,
      syncType: "worker",
      status: s.err === 0 ? "sucesso" : s.ok === 0 ? "erro" : "parcial",
      recordsProcessed: s.rows,
      errorMessage: `Worker: ${s.ok} ok, ${s.err} erro, ${s.rows} linhas`,
    });
  }

  try {
    await supabaseAdmin.rpc("audit_recheck_billing");
  } catch (e) {
    console.error("audit_recheck_billing falhou:", e);
  }

  return {
    ok: true,
    picked: (jobs ?? []).length,
    processed: results.length,
    results,
    elapsed_ms: Date.now() - started,
  };
}
