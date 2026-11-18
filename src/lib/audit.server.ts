// Server-only: full integrity auditor for Mercado Livre data.
// Runs a suite of checks per connected account, upserts findings into
// `audit_findings`, and (when auto-fixable) enqueues the corresponding jobs.
import { supabaseAdmin, logSync } from "./ml-oauth.server";
import { getAccountToken, enqueueAdsJobs, enqueueVisitsJobs, enqueueBillingJobs, enqueueOrdersJobs, fetchBillingTotal, fetchPeriods } from "./ml-sync.server";

const ML_API = "https://api.mercadolibre.com";

type Finding = {
  account_id: string | null;
  owner_id: string;
  check_code: string;
  severity: "critico" | "alerta" | "info";
  title: string;
  detail?: string | null;
  expected?: number | null;
  actual?: number | null;
  diff?: number | null;
  context: Record<string, unknown>;
  auto_fixable?: boolean;
};

async function sleep(ms: number) { await new Promise((r) => setTimeout(r, ms)); }

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Chave do achado: conta + teste + contexto com as chaves em ordem alfabética.
// O jsonb do banco reordena as chaves ({from,to} volta como {to,from}), então
// comparar o JSON cru marcava o achado como resolvido na mesma rodada (aud-01).
function findingKey(accountId: string | null, checkCode: string, context: unknown): string {
  return `${accountId ?? "null"}|${checkCode}|${JSON.stringify(sortKeys(context))}`;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
  }
  return v;
}

// Dias com dado numa tabela diária. Pagina porque o Supabase devolve no máximo
// 1.000 linhas e ADS tem uma linha por anúncio por dia (aud-02).
async function diasPresentes(
  table: "ml_ads_daily" | "ml_visits_daily",
  accountId: string,
  from: string,
  to: string,
): Promise<Set<string>> {
  const dias = new Set<string>();
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabaseAdmin
      .from(table).select("date").eq("account_id", accountId)
      .gte("date", from).lte("date", to)
      .order("date").order("id")
      .range(off, off + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) dias.add(r.date as string);
    if ((data ?? []).length < 1000) return dias;
  }
}

async function upsertFindings(all: Finding[], seenKeys: Set<string>): Promise<void> {
  const now = new Date().toISOString();
  // ponytail: lê todos os achados de uma vez (limite de 1.000 linhas); paginar se a tabela crescer muito.
  const { data: rows } = await supabaseAdmin
    .from("audit_findings")
    .select("id, account_id, check_code, context, status");
  const existing = new Map<string, { id: string; status: string }>();
  for (const r of rows ?? []) {
    existing.set(findingKey(r.account_id, r.check_code, r.context), { id: r.id, status: r.status });
  }
  for (const f of all) {
    const key = findingKey(f.account_id, f.check_code, f.context);
    seenKeys.add(key);
    // Mesmo teste com outro contexto (outro período, outra tarifa) é outro achado (aud-06).
    const target = existing.get(key);
    if (target) {
      // Update — reopen if it was resolved.
      const newStatus = (target as { status: string }).status === "ignorado" ? "ignorado" : "aberto";
      await supabaseAdmin
        .from("audit_findings")
        .update({
          severity: f.severity,
          title: f.title,
          detail: f.detail ?? null,
          expected: f.expected ?? null,
          actual: f.actual ?? null,
          diff: f.diff ?? null,
          context: f.context as never,
          status: newStatus,
          auto_fixable: !!f.auto_fixable,
          last_seen_at: now,
          resolved_at: null,
        })
        .eq("id", (target as { id: string }).id);
    } else {
      await supabaseAdmin.from("audit_findings").insert({
        account_id: f.account_id,
        owner_id: f.owner_id,
        check_code: f.check_code,
        severity: f.severity,
        title: f.title,
        detail: f.detail ?? null,
        expected: f.expected ?? null,
        actual: f.actual ?? null,
        diff: f.diff ?? null,
        context: f.context as never,
        status: "aberto",
        auto_fixable: !!f.auto_fixable,
        first_seen_at: now,
        last_seen_at: now,
      });
    }
  }
}

// Mark findings that were previously open but no longer detected as 'resolvido'.
async function resolveMissing(seenKeys: Set<string>): Promise<number> {
  const { data: openRows } = await supabaseAdmin
    .from("audit_findings")
    .select("id, account_id, check_code, context")
    .in("status", ["aberto", "corrigindo"]);
  const toResolve: string[] = [];
  for (const r of openRows ?? []) {
    if (!seenKeys.has(findingKey(r.account_id, r.check_code, r.context))) toResolve.push(r.id as string);
  }
  if (toResolve.length > 0) {
    await supabaseAdmin
      .from("audit_findings")
      .update({ status: "resolvido", resolved_at: new Date().toISOString() })
      .in("id", toResolve);
  }
  return toResolve.length;
}

async function apiOrderCount(token: string, seller: number, from: string, to: string): Promise<number> {
  const qs = new URLSearchParams({
    seller: String(seller),
    "order.date_created.from": `${from}T00:00:00.000-03:00`,
    "order.date_created.to": `${to}T23:59:59.999-03:00`,
    limit: "1",
    offset: "0",
  });
  const res = await fetch(`${ML_API}/orders/search?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`orders total HTTP ${res.status}`);
  const j = await res.json() as { paging?: { total?: number } };
  return Number(j.paging?.total ?? 0);
}

export async function runAudit(): Promise<{ accounts: number; findings: number; resolved: number; errors: string[]; }> {
  const errors: string[] = [];
  const findings: Finding[] = [];
  const seenKeys = new Set<string>();

  const { data: accounts, error } = await supabaseAdmin
    .from("marketplace_accounts")
    .select("id, owner_id, external_user_id, advertiser_id, status, token_expires_at, nickname, trade_name")
    .eq("platform", "mercado_livre");
  if (error) throw new Error(error.message);

  const today = new Date();
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
  const from = new Date(to.getTime() - 89 * 24 * 60 * 60 * 1000);
  const fromStr = ymd(from);
  const toStr = ymd(to);
  const oneDay = 86400000;

  for (const acc of accounts ?? []) {
    const ownerId = acc.owner_id as string;
    const label = acc.trade_name || acc.nickname || acc.id;

    // --- E. Integridade do token
    if (acc.status === "erro" || acc.status === "token_expirado") {
      findings.push({
        account_id: acc.id, owner_id: ownerId,
        check_code: "token_status",
        severity: "critico",
        title: `Conta "${label}" desconectada`,
        detail: `Status atual: ${acc.status}. Reconecte a integração para retomar as sincronizações.`,
        context: { status: acc.status },
      });
    } else if (acc.token_expires_at && new Date(acc.token_expires_at).getTime() < Date.now() - 24 * 3600 * 1000) {
      findings.push({
        account_id: acc.id, owner_id: ownerId,
        check_code: "token_stale",
        severity: "critico",
        title: `Token da conta "${label}" expirado há mais de 24h`,
        detail: "Renovação automática falhou. Reconecte a integração.",
        context: { expires_at: acc.token_expires_at },
      });
    }

    if (acc.status !== "conectada") continue;

    let token: string;
    try {
      const creds = await getAccountToken(acc.id);
      token = creds.token;
    } catch (e) {
      errors.push(`${label}: token ${(e as Error).message}`);
      continue;
    }

    // --- A. Completude vs API (auto-corrigível)
    // Orders
    if (acc.external_user_id) {
      try {
        const apiTotal = await apiOrderCount(token, acc.external_user_id, fromStr, toStr);
        const { count } = await supabaseAdmin
          .from("ml_orders")
          .select("id", { count: "exact", head: true })
          .eq("account_id", acc.id)
          .gte("date_created", `${fromStr}T00:00:00-03:00`)
          .lte("date_created", `${toStr}T23:59:59-03:00`);
        const local = count ?? 0;
        const diff = apiTotal - local;
        const missRatio = apiTotal > 0 ? Math.abs(diff) / apiTotal : 0;
        if (Math.abs(diff) > 0) {
          findings.push({
            account_id: acc.id, owner_id: ownerId,
            check_code: "orders_completeness",
            severity: missRatio > 0.05 ? "critico" : "alerta",
            title: `Pedidos incompletos em "${label}"`,
            detail: `API reporta ${apiTotal} pedidos nos últimos 90 dias; banco tem ${local}. Diferença: ${diff}.`,
            expected: apiTotal, actual: local, diff,
            auto_fixable: true,
            context: { from: fromStr, to: toStr },
          });
          try { await enqueueOrdersJobs(acc.id, ownerId, fromStr, toStr); } catch { /* ignore */ }
        }
        await sleep(200);
      } catch (e) { errors.push(`${label}: orders ${(e as Error).message}`); }
    }

    // Billing por período
    try {
      const periods = await fetchPeriods(acc.id, token);
      const recentPeriods = periods
        .filter((p) => p.key && (!p.period?.date_to || p.period.date_to >= ymd(new Date(Date.now() - 120 * oneDay))))
        .slice(0, 5);
      for (const p of recentPeriods) {
        try {
          const apiTotal = await fetchBillingTotal(token, p.key!);
          // Sem a cópia que o ML passou a listar num período mais novo (sync-07, como as telas).
          const { data: count, error: countErr } = await supabaseAdmin.rpc("billing_lancamentos_no_periodo" as never, {
            _account_id: acc.id,
            _period_key: p.key!,
          } as never);
          if (countErr) throw new Error(countErr.message);
          const local = Number(count ?? 0);
          const diff = apiTotal - local;
          const missRatio = apiTotal > 0 ? Math.abs(diff) / apiTotal : 0;
          const isOpen = (p.period_status ?? "").toUpperCase() === "OPEN";
          if (Math.abs(diff) > 0) {
            if (!isOpen || missRatio > 0.05) {
              const detail = isOpen
                ? `API reporta ${apiTotal} lançamentos; banco tem ${local}. Período ainda aberto — a diferença tende a sumir na próxima sincronização.`
                : `API reporta ${apiTotal} lançamentos; banco tem ${local}.`;
              findings.push({
                account_id: acc.id, owner_id: ownerId,
                check_code: "billing_completeness",
                severity: isOpen ? "alerta" : "critico",
                title: `Faturamento incompleto em "${label}" (período ${p.key})`,
                detail,
                expected: apiTotal, actual: local, diff,
                auto_fixable: true,
                context: { period_key: p.key, period_status: p.period_status },
              });
            }
            try { await enqueueBillingJobs(acc.id, ownerId, [p.key!]); } catch { /* ignore */ }
          }
          await sleep(200);
        } catch (e) { errors.push(`${label}: billing ${p.key} ${(e as Error).message}`); }
      }
    } catch (e) { errors.push(`${label}: periods ${(e as Error).message}`); }

    // Dias de ADS e de visitas. Vai até anteontem: as visitas de ontem chegam
    // depois das 06:30 UTC, quando a auditoria roda.
    const toDaily = new Date(to.getTime() - oneDay);
    const toDailyStr = ymd(toDaily);
    const totalDias = Math.round((toDaily.getTime() - from.getTime()) / oneDay) + 1;
    const diasFaltando = (present: Set<string>): string[] => {
      const missing: string[] = [];
      for (let t = from.getTime(); t <= toDaily.getTime(); t += oneDay) {
        const d = ymd(new Date(t));
        if (!present.has(d)) missing.push(d);
      }
      return missing;
    };

    // Ads days
    if (acc.advertiser_id) {
      try {
        const missing = diasFaltando(await diasPresentes("ml_ads_daily", acc.id, fromStr, toDailyStr));
        const missRatio = missing.length / totalDias;
        if (missing.length > 0) {
          findings.push({
            account_id: acc.id, owner_id: ownerId,
            check_code: "ads_days_missing",
            severity: missRatio > 0.05 ? "critico" : "alerta",
            title: `Ads faltando em "${label}" (${missing.length} dia(s))`,
            detail: `Sem métricas de Ads em ${missing.length} dos últimos ${totalDias} dias.`,
            expected: totalDias, actual: totalDias - missing.length, diff: -missing.length,
            auto_fixable: true,
            context: { missing_sample: missing.slice(0, 20), total_missing: missing.length },
          });
          // missing vem em ordem crescente: (de, até) = (primeiro, último) — aud-05.
          try {
            await enqueueAdsJobs(acc.id, ownerId, missing[0], missing[missing.length - 1]);
          } catch { /* ignore */ }
        }
      } catch (e) { errors.push(`${label}: ads_days ${(e as Error).message}`); }
    }

    // Visits days
    if (acc.external_user_id) {
      try {
        const missing = diasFaltando(await diasPresentes("ml_visits_daily", acc.id, fromStr, toDailyStr));
        if (missing.length > 0) {
          const missRatio = missing.length / totalDias;
          findings.push({
            account_id: acc.id, owner_id: ownerId,
            check_code: "visits_days_missing",
            severity: missRatio > 0.05 ? "critico" : "alerta",
            title: `Visitas faltando em "${label}" (${missing.length} dia(s))`,
            detail: `Sem métricas de visitas em ${missing.length} dos últimos ${totalDias} dias.`,
            expected: totalDias, actual: totalDias - missing.length, diff: -missing.length,
            auto_fixable: true,
            context: { missing_sample: missing.slice(0, 20), total_missing: missing.length },
          });
          try {
            await enqueueVisitsJobs(acc.id, ownerId, missing[0], missing[missing.length - 1]);
          } catch { /* ignore */ }
        }
      } catch (e) { errors.push(`${label}: visits_days ${(e as Error).message}`); }
    }

    // --- B. Consistência interna
    const { count: orphanCount } = await supabaseAdmin
      .from("ml_order_items")
      .select("id", { count: "exact", head: true })
      .eq("account_id", acc.id)
      .is("order_ref", null);
    if ((orphanCount ?? 0) > 0) {
      findings.push({
        account_id: acc.id, owner_id: ownerId,
        check_code: "orphan_items",
        severity: "critico",
        title: `Itens de pedido órfãos em "${label}"`,
        detail: `${orphanCount} item(ns) sem referência a um pedido válido.`,
        actual: orphanCount ?? 0,
        context: {},
      });
    }

    // Pedidos pagos sem itens (agregado no banco, evita limite de 1000 linhas)
    {
      const { data: noItemsCount, error: noItemsErr } = await supabaseAdmin.rpc(
        "audit_orders_without_items",
        { _account_id: acc.id, _from: fromStr },
      );
      if (noItemsErr) {
        errors.push(`${label}: orders_without_items ${noItemsErr.message}`);
      } else {
        const n = Number(noItemsCount ?? 0);
        if (n > 0) {
          findings.push({
            account_id: acc.id, owner_id: ownerId,
            check_code: "orders_without_items",
            severity: "critico",
            title: `Pedidos pagos sem itens em "${label}"`,
            detail: `${n} pedido(s) pago(s) não têm nenhum item importado.`,
            actual: n,
            auto_fixable: true,
            context: { from: fromStr, to: toStr },
          });
        }
      }
    }

    // Itens de pedidos pagos com sale_fee ausente (agregado no banco)
    {
      const { data: nullFeeCount, error: nullFeeErr } = await supabaseAdmin.rpc(
        "audit_null_sale_fee",
        { _account_id: acc.id, _from: fromStr },
      );
      if (nullFeeErr) {
        errors.push(`${label}: null_sale_fee ${nullFeeErr.message}`);
      } else {
        const n = Number(nullFeeCount ?? 0);
        if (n > 0) {
          findings.push({
            account_id: acc.id, owner_id: ownerId,
            check_code: "null_sale_fee",
            severity: "alerta",
            title: `Comissão ausente em itens de "${label}"`,
            detail: `${n} item(ns) de pedidos pagos estão sem sale_fee. Reprocesse os pedidos.`,
            actual: n,
            auto_fixable: true,
            context: { from: fromStr, to: toStr },
          });
        }
      }
    }

    // Datas futuras / muito antigas
    const cutoff = ymd(new Date(Date.now() - 400 * oneDay));
    const future = ymd(new Date(Date.now() + oneDay));
    const { count: futureOrders } = await supabaseAdmin
      .from("ml_orders").select("id", { count: "exact", head: true })
      .eq("account_id", acc.id).gt("date_created", `${future}T00:00:00-03:00`);
    if ((futureOrders ?? 0) > 0) {
      findings.push({
        account_id: acc.id, owner_id: ownerId,
        check_code: "future_dates",
        severity: "alerta",
        title: `Pedidos com data futura em "${label}"`,
        detail: `${futureOrders} pedido(s) com data posterior a hoje.`,
        actual: futureOrders ?? 0, context: {},
      });
    }
    const { count: oldOrders } = await supabaseAdmin
      .from("ml_orders").select("id", { count: "exact", head: true })
      .eq("account_id", acc.id).lt("date_created", `${cutoff}T00:00:00-03:00`);
    if ((oldOrders ?? 0) > 0) {
      findings.push({
        account_id: acc.id, owner_id: ownerId,
        check_code: "stale_dates",
        severity: "info",
        title: `Pedidos anteriores à janela de 13 meses em "${label}"`,
        detail: `${oldOrders} pedido(s) fora da janela suportada.`,
        actual: oldOrders ?? 0, context: {},
      });
    }

    // --- D. Classificação de taxas (agregado no banco)
    const { data: rev } = await supabaseAdmin.rpc("ml_metrics", {
      _account_ids: [acc.id], _from: fromStr, _to: toStr,
    });
    const revenue = Number((rev?.[0] as { revenue?: number })?.revenue ?? 0);
    {
      const { data: unclassifiedRows, error: uErr } = await supabaseAdmin.rpc(
        "audit_unclassified_subtypes",
        { _account_id: acc.id, _from: fromStr, _to: toStr },
      );
      if (uErr) {
        errors.push(`${label}: unclassified ${uErr.message}`);
      } else {
        for (const row of (unclassifiedRows ?? []) as Array<{
          sub_type: string;
          detail_type: string | null;
          concept: string | null;
          sum_amount: number | string;
          cnt: number | string;
        }>) {
          const sum = Number(row.sum_amount ?? 0);
          const count = Number(row.cnt ?? 0);
          const ratio = revenue > 0 ? sum / revenue : 0;
          findings.push({
            account_id: acc.id, owner_id: ownerId,
            check_code: "unclassified_subtype",
            severity: ratio > 0.01 ? "critico" : "alerta",
            title: `Taxa não classificada em "${label}": ${row.sub_type}`,
            detail: `${count} lançamento(s), valor total ${sum.toFixed(2)}. Descrição: ${row.concept ?? "—"}.`,
            actual: sum,
            context: { sub_type: row.sub_type },
          });
        }
      }
    }

    // --- C. Sanidade financeira
    if (revenue > 0) {
      const m = (rev?.[0] as unknown as Record<string, number>) ?? {};
      const commissions = Number(m.commissions ?? 0);
      const ads = Number(m.ads ?? 0);
      const commRatio = commissions / revenue;
      if (commRatio < 0.08 || commRatio > 0.25) {
        findings.push({
          account_id: acc.id, owner_id: ownerId,
          check_code: "commission_out_of_range",
          severity: "alerta",
          title: `Comissão fora da faixa esperada em "${label}"`,
          detail: `Comissão representa ${(commRatio * 100).toFixed(1)}% da receita (esperado 8–25%). Pode indicar erro de classificação.`,
          expected: revenue * 0.13, actual: commissions,
          context: { from: fromStr, to: toStr },
        });
      }
      if (ads / revenue > 0.3) {
        findings.push({
          account_id: acc.id, owner_id: ownerId,
          check_code: "ads_disproportionate",
          severity: "alerta",
          title: `Ads acima de 30% da receita em "${label}"`,
          detail: `Ads: ${((ads / revenue) * 100).toFixed(1)}% da receita.`,
          actual: ads, expected: revenue * 0.3,
          context: { from: fromStr, to: toStr },
        });
      }
    } else {
      // Receita zero com pedidos existentes
      const { count: paidCount } = await supabaseAdmin
        .from("ml_orders").select("id", { count: "exact", head: true })
        .eq("account_id", acc.id).in("status", ["paid", "delivered"])
        .gte("date_created", `${fromStr}T00:00:00-03:00`);
      if ((paidCount ?? 0) > 0) {
        findings.push({
          account_id: acc.id, owner_id: ownerId,
          check_code: "zero_revenue_with_orders",
          severity: "alerta",
          title: `Receita zerada com pedidos existentes em "${label}"`,
          detail: `${paidCount} pedido(s) pago(s) mas receita somada é zero.`,
          context: { from: fromStr, to: toStr },
        });
      }
    }
  }

  await upsertFindings(findings, seenKeys);
  const resolved = await resolveMissing(seenKeys);

  await logSync({
    accountId: null,
    syncType: "audit",
    status: errors.length === 0 ? "sucesso" : "parcial",
    recordsProcessed: findings.length,
    errorMessage: errors.length ? errors.slice(0, 10).join(" · ") : `${findings.length} achado(s), ${resolved} resolvido(s)`,
  });

  return { accounts: (accounts ?? []).length, findings: findings.length, resolved, errors };
}