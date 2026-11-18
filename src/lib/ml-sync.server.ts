// INTEGRAÇÃO PRINCIPAL COM O MERCADO LIVRE / MERCADO PAGO (somente servidor).
// Busca pedidos, pagamentos, faturamento, anúncios, visitas e produtos nas APIs
// e grava no banco. Trata paginação, limite de chamadas (HTTP 429) e renovação
// de token.
// CUIDADO: nunca importe este arquivo em código de navegador — ele usa chaves de
// serviço. A gravação é por upsert: não apague dados para reinserir, uma coleta
// incompleta destruiria informação boa.
// Server-only helpers for syncing Mercado Livre data into the local database.
// Uses supabaseAdmin (service role) because we write tokens / consolidated data
// that must bypass RLS.
import { adsDoDiaCompleto } from "@/lib/ads-do-dia";
import { recebidoPelaConta } from "@/lib/mp-recebido";
import {
  supabaseAdmin,
  refreshAccessToken,
  logSync,
  readVaultSecret,
  saveAccountTokens,
} from "./ml-oauth.server";

const ML_API = "https://api.mercadolibre.com";
const MP_API = "https://api.mercadopago.com";
const SLEEP_MS = 150;
const BILLING_SLEEP_MS = 400;

// Max retries when Mercado Livre returns HTTP 429 (Too Many Requests).
// Backoff: 2s, 4s, 8s, 16s. Respects Retry-After header when present.
const RATE_LIMIT_MAX_RETRIES = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Yesterday in America/Sao_Paulo, as YYYY-MM-DD.
function ymdSaoPaulo(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

function isoSaoPauloStart(day: string): string {
  return `${day}T00:00:00.000-03:00`;
}
function isoSaoPauloEnd(day: string): string {
  return `${day}T23:59:59.999-03:00`;
}

export function windowDates(days: number): { from: string; to: string } {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = ymdSaoPaulo(yesterday);
  const fromDate = new Date(yesterday.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const from = ymdSaoPaulo(fromDate);
  return { from, to };
}

type Account = {
  id: string;
  client_id: string | null;
  client_secret: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  external_user_id: number | null;
  advertiser_id: number | null;
};

async function ensureFreshToken(acc: Account): Promise<string> {
  const expIso = acc.token_expires_at;
  const soon = expIso ? new Date(expIso).getTime() - Date.now() < 10 * 60 * 1000 : true;
  if (!soon && acc.access_token) return acc.access_token;
  if (!acc.client_id || !acc.client_secret || !acc.refresh_token) {
    throw new Error("Conta sem credenciais / refresh token para renovar.");
  }
  const t = await refreshAccessToken({
    clientId: acc.client_id,
    clientSecret: acc.client_secret,
    refreshToken: acc.refresh_token,
  });
  await saveAccountTokens(acc.id, t);
  acc.access_token = t.access_token;
  acc.refresh_token = t.refresh_token;
  acc.token_expires_at = new Date(Date.now() + t.expires_in * 1000).toISOString();
  return t.access_token;
}

// Fetch a marketplace_accounts row and decrypt its Vault credentials into the
// Account shape used by sync helpers. Never selects the legacy plaintext
// columns (client_secret / access_token / refresh_token).
async function loadAccountForSync(
  accountId: string,
): Promise<Account & { owner_id: string; status: string }> {
  const { data, error } = await supabaseAdmin
    .from("marketplace_accounts")
    .select(
      "id, owner_id, status, client_id, client_secret_id, access_token_id, refresh_token_id, token_expires_at, external_user_id, advertiser_id",
    )
    .eq("id", accountId)
    .maybeSingle();
  if (error || !data) throw new Error("Conta não encontrada.");
  const [client_secret, access_token, refresh_token] = await Promise.all([
    readVaultSecret(data.client_secret_id),
    readVaultSecret(data.access_token_id),
    readVaultSecret(data.refresh_token_id),
  ]);
  return {
    id: data.id,
    owner_id: data.owner_id,
    status: data.status,
    client_id: data.client_id,
    client_secret,
    access_token,
    refresh_token,
    token_expires_at: data.token_expires_at,
    external_user_id: data.external_user_id,
    advertiser_id: data.advertiser_id,
  };
}

async function mlGet(
  path: string,
  token: string,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  let attempt = 0;
  while (true) {
    const res = await fetch(`${ML_API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(extraHeaders ?? {}),
      },
    });
    if (res.status === 429 && attempt < RATE_LIMIT_MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000)
        : Math.min(2000 * Math.pow(2, attempt), 16_000);
      attempt += 1;
      await sleep(backoffMs);
      continue;
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }
}

// ---------- Periods ----------
type PeriodItem = {
  key?: string;
  period?: { date_from?: string; date_to?: string };
  amount?: number;
  unpaid_amount?: number;
  period_status?: string;
};

async function syncPeriods(accountId: string, token: string): Promise<PeriodItem[]> {
  const { status, body } = await mlGet(
    `/billing/integration/monthly/periods?group=ML&document_type=BILL`,
    token,
  );
  if (status !== 200) {
    throw new Error(`Períodos: HTTP ${status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  const results = ((body as { results?: PeriodItem[] }).results ?? []) as PeriodItem[];
  const rows = results
    .filter((p) => p.key)
    .map((p) => ({
      account_id: accountId,
      period_key: p.key!,
      date_from: p.period?.date_from ?? null,
      date_to: p.period?.date_to ?? null,
      amount: Number(p.amount ?? 0),
      unpaid_amount: Number(p.unpaid_amount ?? 0),
      period_status: p.period_status ?? null,
      synced_at: new Date().toISOString(),
    }));
  if (rows.length > 0) {
    await supabaseAdmin.from("ml_billing_periods").upsert(rows, {
      onConflict: "account_id,period_key",
    });
  }
  return results;
}

// ---------- Billing details ----------
type BillingDetail = {
  charge_info?: {
    detail_id?: string | number;
    detail_amount?: number;
    detail_type?: string;
    detail_sub_type?: string;
    concept_type?: string;
    transaction_detail?: string;
    creation_date_time?: string;
    legal_document_number?: string;
  };
  document_info?: { document_id?: string; document_type?: string };
  sales_info?: Array<{
    order_id?: number | string;
    operation_id?: number | string;
    sale_date_time?: string;
    sales_channel?: string;
    transaction_amount?: number;
  }> | null;
  shipping_info?: {
    shipping_id?: number | string;
    pack_id?: number | string;
    receiver_shipping_cost?: number;
  } | null;
  items_info?: Array<{
    item_id?: string;
    item_title?: string;
    item_category?: string;
    item_amount?: number;
    item_price?: number;
    order_id?: number | string;
  }> | null;
  marketplace_info?: { marketplace?: string } | null;
  store_info?: { store_id?: string; store_name?: string } | null;
};

async function syncBillingDetails(
  accountId: string,
  token: string,
  periods: PeriodItem[],
  windowFrom: string,
): Promise<number> {
  const relevant = periods.filter((p) => {
    if (!p.period?.date_to) return true;
    return p.period.date_to >= windowFrom;
  });
  let total = 0;
  for (const p of relevant) {
    if (!p.key) continue;
    const r = await syncBillingForPeriod(accountId, token, p.key);
    total += r.count;
  }
  return total;
}

// Sync a single billing period fully (all pages).
export async function syncBillingForPeriod(
  accountId: string,
  token: string,
  periodKey: string,
  opts?: { startOffset?: number; startCursor?: string | null; jobId?: string },
): Promise<{ count: number }> {
  const limit = 1000;
  const CURSOR_THRESHOLD = 9_000; // ML rejeita offset >= 10.000 com HTTP 422; troca antes.
  const maxPages = 500;
  let cursor: string | null = opts?.startCursor ?? null;
  let previousCursor: string | null = null;
  let offset = cursor ? 0 : Math.max(0, opts?.startOffset ?? 0);
  let useCursor = cursor !== null || offset >= CURSOR_THRESHOLD;
  if (useCursor && !cursor && offset > CURSOR_THRESHOLD) {
    offset = CURSOR_THRESHOLD;
  }
  let guard = 0;
  let total = 0;

  while (guard++ < maxPages) {
    const qs = new URLSearchParams({
      document_type: "BILL",
      limit: String(limit),
    });
    if (useCursor && cursor) {
      qs.set("from_id", cursor);
    } else {
      qs.set("offset", String(offset));
    }
    const path = `/billing/integration/periods/key/${periodKey}/group/ML/details?${qs.toString()}`;
    const { status, body } = await mlGet(path, token);
    if (status !== 200) throw new Error(`Billing ${periodKey}: HTTP ${status}`);
    const payload = body as { results?: BillingDetail[]; total?: number; last_id?: string | number };
    const results = (payload.results ?? []) as BillingDetail[];
    const totalRemaining = payload.total == null ? Number.POSITIVE_INFINITY : Number(payload.total);
    if (results.length === 0) break;
    const rows = results
      .map((d) => {
        const ci = d.charge_info ?? {};
        const detailId = ci.detail_id != null ? String(ci.detail_id) : null;
        if (!detailId) return null;
        const sales = Array.isArray(d.sales_info) ? d.sales_info : [];
        const items = Array.isArray(d.items_info) ? d.items_info : [];
        const shipping = d.shipping_info ?? null;
        const marketplace = d.marketplace_info?.marketplace ?? null;
        const orderIdRaw = sales[0]?.order_id ?? items[0]?.order_id ?? null;
        const shippingIdRaw = shipping?.shipping_id ?? null;
        const itemId = items[0]?.item_id ?? null;
        return {
          account_id: accountId,
          period_key: periodKey,
          billing_group: "ML",
          detail_id: detailId,
          document_type: d.document_info?.document_type ?? "BILL",
          detail_type: ci.detail_type ?? "UNKNOWN",
          detail_sub_type: ci.detail_sub_type ?? null,
          concept_type: marketplace ?? ci.concept_type ?? null,
          marketplace,
          concept: ci.transaction_detail ?? null,
          amount: Number(ci.detail_amount ?? 0),
          transaction_date: ci.creation_date_time ?? null,
          legal_document_number: ci.legal_document_number ?? null,
          order_id: orderIdRaw != null ? Number(orderIdRaw) : null,
          shipping_id: shippingIdRaw != null ? Number(shippingIdRaw) : null,
          item_id: itemId,
          synced_at: new Date().toISOString(),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (rows.length > 0) {
      const { error } = await supabaseAdmin
        .from("ml_billing_details")
        .upsert(rows as never, { onConflict: "account_id,period_key,billing_group,detail_id" });
      if (error) throw new Error(`Billing upsert: ${error.message}`);
      total += rows.length;
    }

    const lastId = payload.last_id != null ? String(payload.last_id) : null;
    if (lastId) {
      previousCursor = cursor;
      cursor = lastId;
    }

    offset += results.length;
    if (!useCursor && offset >= CURSOR_THRESHOLD) {
      useCursor = true;
    }

    // Persist progress on every page so timeout/rate-limit resumes from the last safe checkpoint.
    if (opts?.jobId) {
      await supabaseAdmin
        .from("sync_jobs")
        .update({ progress_offset: offset, progress_cursor: cursor })
        .eq("id", opts.jobId);
    }

    if (useCursor) {
      // In cursor mode, ML's `total` means remaining records from that cursor, not absolute total.
      // A API devolve menos que `limit` mesmo havendo mais dados — nunca usar results.length < limit como fim de página.
      if (totalRemaining <= results.length) break;
      if (previousCursor && cursor && previousCursor === cursor) {
        throw new Error(`Billing ${periodKey}: cursor não avançou em ${cursor}`);
      }
    } else if (offset >= totalRemaining) {
      break;
    }
    await sleep(BILLING_SLEEP_MS);
  }
  // Success: clear checkpoint so a future full reprocess starts from zero.
  if (opts?.jobId) {
    await supabaseAdmin
      .from("sync_jobs")
      .update({ progress_offset: 0, progress_cursor: null })
      .eq("id", opts.jobId);
  }
  return { count: total };
}

// Retorna o maior detail_id já gravado para um período (para retomar por cursor).
async function lastBillingDetailId(
  accountId: string,
  periodKey: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("ml_billing_details")
    .select("detail_id")
    .eq("account_id", accountId)
    .eq("period_key", periodKey);
  if (error || !data || data.length === 0) return null;
  let best: bigint | null = null;
  let bestStr: string | null = null;
  for (const r of data as Array<{ detail_id: string }>) {
    try {
      const n = BigInt(r.detail_id);
      if (best === null || n > best) {
        best = n;
        bestStr = r.detail_id;
      }
    } catch {
      // ignore ids não numéricos
    }
  }
  return bestStr;
}

// Fetch the reported total number of billing details for a period (no writes).
export async function fetchBillingTotal(
  token: string,
  periodKey: string,
): Promise<number> {
  const qs = new URLSearchParams({ document_type: "BILL", limit: "1", offset: "0" });
  const { status, body } = await mlGet(
    `/billing/integration/periods/key/${periodKey}/group/ML/details?${qs.toString()}`,
    token,
  );
  if (status !== 200) throw new Error(`Billing total ${periodKey}: HTTP ${status}`);
  return Number((body as { total?: number })?.total ?? 0);
}

// Fetch periods list (returns raw PeriodItems).
export async function fetchPeriods(accountId: string, token: string): Promise<PeriodItem[]> {
  return syncPeriods(accountId, token);
}

// ---------- Orders ----------
type MlOrder = {
  id: number;
  date_created: string;
  date_closed: string | null;
  status: string;
  total_amount: number;
  paid_amount: number | null;
  currency_id: string;
  shipping?: { id?: number | null };
  buyer?: { nickname?: string };
  order_items?: Array<{
    item: { id: string; title: string; seller_sku: string | null };
    quantity: number;
    unit_price: number;
    full_unit_price: number | null;
    sale_fee: number | null;
  }>;
  payments?: Array<{ transaction_amount_refunded?: number | string | null }>;
};

export async function syncOrdersForRange(
  accountId: string,
  token: string,
  seller: number,
  from: string,
  to: string,
): Promise<number> {
  const fromIso = isoSaoPauloStart(from);
  const toIso = isoSaoPauloEnd(to);
  const limit = 50;
  // O /orders/search do ML não devolve resultados além do offset 1000.
  // Quando a janela tem mais que isso, dividimos o período ao meio e
  // paginamos cada metade — nunca "paginamos infinito".
  const OFFSET_CAP = 1000;
  let offset = 0;
  let total = 0;
  let guard = 0;
  while (guard < 400) {
    guard += 1;
    const qs = new URLSearchParams({
      seller: String(seller),
      "order.date_created.from": fromIso,
      "order.date_created.to": toIso,
      limit: String(limit),
      offset: String(offset),
    });
    const { status, body } = await mlGet(`/orders/search?${qs.toString()}`, token);
    if (status !== 200) throw new Error(`Orders: HTTP ${status}`);
    const paging = (body as { paging?: { total?: number } }).paging;
    const apiTotal = Number(paging?.total ?? 0);
    if (offset === 0 && apiTotal > OFFSET_CAP && from !== to) {
      // Janela grande demais: quebra em duas e processa recursivamente.
      const oneDay = 24 * 60 * 60 * 1000;
      const startMs = Date.parse(`${from}T00:00:00Z`);
      const endMs = Date.parse(`${to}T00:00:00Z`);
      const midMs = startMs + Math.floor((endMs - startMs) / 2 / oneDay) * oneDay;
      const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      const a = await syncOrdersForRange(accountId, token, seller, from, fmt(midMs));
      await sleep(SLEEP_MS);
      const b = await syncOrdersForRange(accountId, token, seller, fmt(midMs + oneDay), to);
      return a + b;
    }
    const results = ((body as { results?: MlOrder[] }).results ?? []) as MlOrder[];
    if (results.length === 0) break;


    const orderRows = results.map((o) => ({
      account_id: accountId,
      order_id: o.id,
      date_created: o.date_created,
      date_closed: o.date_closed,
      status: o.status,
      total_amount: Number(o.total_amount ?? 0),
      paid_amount: o.paid_amount == null ? null : Number(o.paid_amount),
      currency_id: o.currency_id ?? "BRL",
      shipping_id: o.shipping?.id ?? null,
      buyer_nickname: o.buyer?.nickname ?? null,
      refunded_amount: Array.isArray(o.payments)
        ? o.payments.reduce((s, p) => s + (Number(p?.transaction_amount_refunded) || 0), 0)
        : 0,
      raw: o as unknown as Record<string, unknown>,
      synced_at: new Date().toISOString(),
    }));
    const { data: upserted, error: upErr } = await supabaseAdmin
      .from("ml_orders")
      .upsert(orderRows as never, { onConflict: "account_id,order_id" })
      .select("id, order_id");
    if (upErr) throw new Error(`Orders upsert: ${upErr.message}`);

    const idByOrder = new Map<number, string>();
    for (const r of upserted ?? []) idByOrder.set(r.order_id, r.id);

    // Itens: o banco troca os de cada pedido numa transação só, com o pedido travado (sync-03).
    // Pedido que veio sem itens na resposta não entra na lista e fica como está.
    const itemRows: Array<Record<string, unknown>> = [];
    for (const o of results) {
      const ref = idByOrder.get(o.id);
      if (!ref) continue;
      for (const it of o.order_items ?? []) {
        itemRows.push({
          order_ref: ref,
          item_id: it.item.id,
          title: it.item.title,
          seller_sku: it.item.seller_sku ?? null,
          quantity: it.quantity,
          unit_price: Number(it.unit_price ?? 0),
          full_unit_price: it.full_unit_price == null ? null : Number(it.full_unit_price),
          sale_fee: it.sale_fee == null ? null : Number(it.sale_fee),
        });
      }
    }
    if (itemRows.length > 0) {
      const { error: itErr } = await supabaseAdmin.rpc("ml_trocar_itens_dos_pedidos" as never, {
        _account_id: accountId,
        _itens: itemRows,
      } as never);
      if (itErr) throw new Error(`Order items: ${itErr.message}`);
      // Cria em product_skus os SKUs novos vistos nas vendas (sem custo, idempotente).
      await supabaseAdmin.rpc("ensure_product_skus_from_ml", { _account_id: accountId });
    }

    total += results.length;
    if (results.length < limit) break;
    offset += limit;
    if (offset >= OFFSET_CAP) break;
    await sleep(SLEEP_MS);

  }
  return total;
}

// ---------- Ads ----------
type AdRow = {
  item_id?: string;
  campaign_id?: number;
  ad_group_id?: number | null;
  title?: string;
  thumbnail?: string;
  permalink?: string;
  price?: number;
  status?: string;
  logistic_type?: string;
  metrics?: {
    clicks?: number;
    prints?: number;
    cost?: number;
    cpc?: number;
    ctr?: number;
    acos?: number;
    direct_amount?: number;
    indirect_amount?: number;
    direct_units_quantity?: number;
    indirect_units_quantity?: number;
  };
};

// ---------- Visits ----------

export async function syncVisitsForDay(
  accountId: string,
  token: string,
  userId: number,
  day: string,
): Promise<{ visits: number }> {
  const qs = new URLSearchParams({ date_from: day, date_to: day });
  const { status, body } = await mlGet(
    `/users/${userId}/items_visits?${qs.toString()}`,
    token,
  );
  if (status !== 200) {
    throw new Error(`Visitas ${day}: HTTP ${status}`);
  }
  const total = Number((body as { total_visits?: number })?.total_visits ?? 0);
  const { error } = await supabaseAdmin
    .from("ml_visits_daily")
    .upsert(
      [{ account_id: accountId, date: day, visits: total, synced_at: new Date().toISOString() }] as never,
      { onConflict: "account_id,date" },
    );
  if (error) throw new Error(`Visitas ${day} gravar: ${error.message}`);
  return { visits: total };
}

// ---------- Orchestrator ----------

// Enqueue one 'ads' job per day (descending) in sync_jobs.
// Returns how many days were enqueued (new or re-queued).
export async function enqueueAdsJobs(
  accountId: string,
  ownerId: string,
  from: string,
  to: string,
  opts?: { priority?: number; maxDays?: number; todos?: boolean },
): Promise<{ enqueued: number; capped: boolean }> {
  // Nunca enfileira ADS antes do início das campanhas: a API responde 400 e
  // não existe dado a recuperar.
  let start = from;
  const { data: acc } = await supabaseAdmin
    .from("marketplace_accounts")
    .select("ads_start_date")
    .eq("id", accountId)
    .maybeSingle();
  const adsStart = (acc as { ads_start_date?: string | null } | null)?.ads_start_date ?? null;
  if (adsStart && adsStart > start) start = String(adsStart).slice(0, 10);
  if (start > to) return { enqueued: 0, capped: false };
  return enqueueDailyJobs(accountId, ownerId, start, to, "ads", opts);
}


export async function enqueueVisitsJobs(
  accountId: string,
  ownerId: string,
  from: string,
  to: string,
  opts?: { priority?: number; maxDays?: number; todos?: boolean },
): Promise<{ enqueued: number; capped: boolean }> {
  return enqueueDailyJobs(accountId, ownerId, from, to, "visits", opts);
}

// Enqueue one 'billing' job per period_key.
export async function enqueueBillingJobs(
  accountId: string,
  ownerId: string,
  periodKeys: string[],
  opts?: { priority?: number },
): Promise<{ enqueued: number }> {
  const priority = opts?.priority ?? 100;
  const keys = Array.from(new Set(periodKeys.filter(Boolean)));
  if (keys.length === 0) return { enqueued: 0 };
  const { data: existing } = await supabaseAdmin
    .from("sync_jobs")
    .select("id, target_key, status, attempts")
    .eq("account_id", accountId)
    .eq("job_type", "billing")
    .in("target_key", keys);
  const byKey = new Map((existing ?? []).map((r) => [r.target_key as string, r]));
  const toInsert: Array<Record<string, unknown>> = [];
  const toReset: string[] = [];
  for (const k of keys) {
    const ex = byKey.get(k);
    if (!ex) {
      toInsert.push({
        account_id: accountId,
        owner_id: ownerId,
        job_type: "billing",
        status: "pendente",
        priority,
        target_key: k,
      });
    } else if (ex.status === "concluido" || ex.status === "incompleto" || ex.status === "erro") {
      // Always re-enqueue billing periods: totals evolve over time until the period closes.
      toReset.push(ex.id as string);
    }
  }
  if (toInsert.length > 0) {
    const { error } = await supabaseAdmin.from("sync_jobs").insert(toInsert as never);
    if (error) throw new Error(`Enfileirar billing: ${error.message}`);
  }
  if (toReset.length > 0) {
    const { error } = await supabaseAdmin
      .from("sync_jobs")
      .update({ status: "pendente", attempts: 0, last_error: null, started_at: null, finished_at: null })
      .in("id", toReset);
    if (error) throw new Error(`Reenfileirar billing: ${error.message}`);
  }
  return { enqueued: toInsert.length + toReset.length };
}

// Enqueue 'orders' jobs split into ~30-day chunks. target_key = "from:to".
export async function enqueueOrdersJobs(
  accountId: string,
  ownerId: string,
  from: string,
  to: string,
  opts?: { priority?: number; chunkDays?: number; todos?: boolean },
): Promise<{ enqueued: number }> {
  const priority = opts?.priority ?? 100;
  const chunks: Array<{ from: string; to: string }> = [];
  const chunkDays = opts?.chunkDays ?? 30;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const startMs = Date.UTC(fy, fm - 1, fd);
  const endMs = Date.UTC(ty, tm - 1, td);
  const oneDay = 24 * 60 * 60 * 1000;
  const fmt = (ms: number) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  };
  let cursor = endMs;
  while (cursor >= startMs) {
    const chunkEnd = cursor;
    const chunkStart = Math.max(startMs, cursor - (chunkDays - 1) * oneDay);
    chunks.push({ from: fmt(chunkStart), to: fmt(chunkEnd) });
    cursor = chunkStart - oneDay;
  }
  const keys = chunks.map((c) => `${c.from}:${c.to}`);
  const { data: existing } = await supabaseAdmin
    .from("sync_jobs")
    .select("id, target_key, status")
    .eq("account_id", accountId)
    .eq("job_type", "orders")
    .in("target_key", keys);
  const byKey = new Map((existing ?? []).map((r) => [r.target_key as string, r]));
  const toInsert: Array<Record<string, unknown>> = [];
  const toReset: string[] = [];
  // Always re-enqueue the most recent chunk; others only if not already concluded (or todos).
  const alwaysReenqueue = new Set(opts?.todos ? keys : [keys[0]]);
  for (const k of keys) {
    const ex = byKey.get(k);
    if (!ex) {
      toInsert.push({
        account_id: accountId,
        owner_id: ownerId,
        job_type: "orders",
        status: "pendente",
        priority,
        target_key: k,
      });
    } else if (ex.status === "erro" || (ex.status === "concluido" && alwaysReenqueue.has(k))) {
      toReset.push(ex.id as string);
    }
  }
  if (toInsert.length > 0) {
    const { error } = await supabaseAdmin.from("sync_jobs").insert(toInsert as never);
    if (error) throw new Error(`Enfileirar orders: ${error.message}`);
  }
  if (toReset.length > 0) {
    const { error } = await supabaseAdmin
      .from("sync_jobs")
      .update({ status: "pendente", attempts: 0, last_error: null, started_at: null, finished_at: null })
      .in("id", toReset);
    if (error) throw new Error(`Reenfileirar orders: ${error.message}`);
  }
  return { enqueued: toInsert.length + toReset.length };
}

async function enqueueDailyJobs(
  accountId: string,
  ownerId: string,
  from: string,
  to: string,
  jobType: "ads" | "visits",
  opts?: { priority?: number; maxDays?: number; todos?: boolean },
): Promise<{ enqueued: number; capped: boolean }> {
  const priority = opts?.priority ?? 100;
  const maxDays = opts?.maxDays ?? 90;
  const days: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  const oneDay = 24 * 60 * 60 * 1000;
  for (let ms = toMs; ms >= fromMs; ms -= oneDay) {
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    days.push(`${yyyy}-${mm}-${dd}`);
  }
  const capped = days.length > maxDays;
  const wanted = capped ? days.slice(0, maxDays) : days;

  // Check existing jobs for these dates
  const { data: existing } = await supabaseAdmin
    .from("sync_jobs")
    .select("id, target_date, status, attempts")
    .eq("account_id", accountId)
    .eq("job_type", jobType)
    .in("target_date", wanted);
  const existingByDate = new Map(
    (existing ?? []).map((r) => [r.target_date as string, r]),
  );
  // Últimos 7 dias sempre reprocessam: o ML ajusta ADS/visitas retroativamente. Todos, no
  // reprocessamento completo.
  const alwaysReenqueue = new Set(opts?.todos ? wanted : wanted.slice(0, 7));

  const toInsert: Array<Record<string, unknown>> = [];
  const toReset: string[] = []; // ids of existing 'concluido' rows in last-3 window to re-run
  for (const day of wanted) {
    const ex = existingByDate.get(day);
    if (!ex) {
      toInsert.push({
        account_id: accountId,
        owner_id: ownerId,
        job_type: jobType,
        status: "pendente",
        priority,
        target_date: day,
      });
    } else if (ex.status === "concluido") {
      if (alwaysReenqueue.has(day)) toReset.push(ex.id as string);
    } else if (ex.status === "erro" && (ex.attempts ?? 0) < 3) {
      toReset.push(ex.id as string);
    }
    // 'pendente' / 'executando' → leave alone
  }

  if (toInsert.length > 0) {
    const { error } = await supabaseAdmin.from("sync_jobs").insert(toInsert as never);
    if (error) throw new Error(`Enfileirar ${jobType}: ${error.message}`);
  }
  if (toReset.length > 0) {
    const { error } = await supabaseAdmin
      .from("sync_jobs")
      .update({
        status: "pendente",
        attempts: 0,
        last_error: null,
        started_at: null,
        finished_at: null,
      })
      .in("id", toReset);
    if (error) throw new Error(`Reenfileirar ${jobType}: ${error.message}`);
  }

  return { enqueued: toInsert.length + toReset.length, capped };
}

// Delete all ads jobs and ml_ads_daily rows for an account, then enqueue full 90-day window.
export async function reprocessAdsForAccount(
  accountId: string,
  ownerId: string,
): Promise<{ enqueued: number }> {
  // Não apaga o ADS antes (sync-04): cada dia é trocado quando a API traz os dados.
  await supabaseAdmin
    .from("sync_jobs")
    .delete()
    .eq("account_id", accountId)
    .eq("job_type", "ads");
  const { from, to } = windowDates(90);
  const r = await enqueueAdsJobs(accountId, ownerId, from, to);
  return { enqueued: r.enqueued };
}

// Force full re-enqueue of billing for the last 90 days. Actual work runs in the worker.
export async function reprocessBillingForAccount(
  accountId: string,
): Promise<{ enqueued: number }> {
  const acc = await loadAccountForSync(accountId);
  const token = await ensureFreshToken(acc);
  const periods = await syncPeriods(accountId, token);
  // Enfileira todos os períodos retornados pela API (não filtra por janela).
  const keys = periods.filter((p) => !!p.key).map((p) => p.key!) as string[];
  // Clear existing billing jobs so all periods re-enqueue as pending.
  await supabaseAdmin
    .from("sync_jobs")
    .delete()
    .eq("account_id", accountId)
    .eq("job_type", "billing");
  const r = await enqueueBillingJobs(accountId, acc.owner_id, keys);
  await logSync({
    accountId,
    syncType: "billing",
    status: "parcial",
    recordsProcessed: r.enqueued,
    errorMessage: `${r.enqueued} período(s) enfileirado(s) para reprocessamento`,
  });
  return { enqueued: r.enqueued };
}

// Reprocessa a conta: limpa a fila e enfileira de novo faturamento, pedidos, ADS e visitas.
// Não apaga ADS nem visitas antes de buscar (sync-04): se a busca falhar, os dados ficam; cada dia
// é trocado quando a API responde (visitas por upsert, ADS como em syncAdsForDay).
export async function forceFullReprocessForAccount(
  accountId: string,
  days: number,
): Promise<SyncResult> {
  await supabaseAdmin
    .from("sync_jobs")
    .delete()
    .eq("account_id", accountId)
    .in("status", ["pendente", "erro"]);
  return await syncAccount(accountId, days, { todos: true });
}

/**
 * Descobre (e memoriza em `marketplace_accounts.ads_start_date`) o primeiro dia
 * em que a conta teve campanha de Product Ads. Ordem das fontes:
 *   1) cache no banco;
 *   2) API de campanhas (menor `date_created`);
 *   3) menor data já gravada em `ml_ads_daily`.
 * Devolve null quando nada permite concluir com segurança — nesse caso NENHUM
 * erro é engolido.
 */
export async function resolveAdsStartDate(
  accountId: string,
  token: string,
  advertiserId: number,
): Promise<{ date: string | null; hasCampaigns: boolean | null }> {
  const { data: acc } = await supabaseAdmin
    .from("marketplace_accounts")
    .select("ads_start_date")
    .eq("id", accountId)
    .maybeSingle();
  const cached = (acc as { ads_start_date?: string | null } | null)?.ads_start_date ?? null;
  if (cached) return { date: cached, hasCampaigns: true };

  let discovered: string | null = null;
  let hasCampaigns: boolean | null = null;
  try {
    const { status, body } = await mlGet(
      `/marketplace/advertising/MLB/advertisers/${advertiserId}/product_ads/campaigns?limit=100&offset=0`,
      token,
      { "api-version": "2" },
    );
    if (status === 200) {
      const results = ((body as { results?: Array<{ date_created?: string | null }> }).results ??
        []) as Array<{ date_created?: string | null }>;
      hasCampaigns = results.length > 0;
      for (const c of results) {
        const d = c.date_created ? String(c.date_created).slice(0, 10) : null;
        if (d && (!discovered || d < discovered)) discovered = d;
      }
    }
  } catch {
    /* sem campanhas pela API: cai para a evidência do banco */
  }

  if (!discovered) {
    const { data: firstRow } = await supabaseAdmin
      .from("ml_ads_daily")
      .select("date")
      .eq("account_id", accountId)
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle();
    const d = (firstRow as { date?: string | null } | null)?.date ?? null;
    if (d) {
      discovered = String(d).slice(0, 10);
      hasCampaigns = true;
    }
  }

  if (discovered) {
    await supabaseAdmin
      .from("marketplace_accounts")
      .update({ ads_start_date: discovered } as never)
      .eq("id", accountId);
  }
  return { date: discovered, hasCampaigns };
}

// Process one day of Ads for an account. Replaces any existing rows for
// (account_id, date) before inserting, so old rows with wrong dates are wiped.
export async function syncAdsForDay(
  accountId: string,
  token: string,
  advertiserId: number,
  day: string,
): Promise<{ rows: number; skipped?: boolean; note?: string }> {

  const metrics = [
    "clicks",
    "prints",
    "cost",
    "direct_amount",
    "indirect_amount",
    "direct_units_quantity",
    "indirect_units_quantity",
    "acos",
    "cpc",
    "ctr",
  ].join(",");
  const limit = 50;
  let offset = 0;
  const collected: Array<Record<string, unknown>> = [];
  const inicio = new Date().toISOString();
  let recebidos = 0;
  let totalDaApi = 0;

  for (let page = 0; page < 200; page += 1) {
    const qs = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      date_from: day,
      date_to: day,
      metrics,
      metrics_summary: "true",
    });
    const { status, body } = await mlGet(
      `/marketplace/advertising/MLB/advertisers/${advertiserId}/product_ads/ads/search?${qs.toString()}`,
      token,
      { "api-version": "2" },
    );
    if (status === 400) {
      // A API do ML devolve 400 (em vez de vazio) quando o período consultado é
      // anterior à existência das campanhas. Só tratamos como "sem campanha"
      // quando conseguimos comprovar isso; qualquer outro 400 continua erro.
      const { date: adsStart, hasCampaigns } = await resolveAdsStartDate(
        accountId,
        token,
        advertiserId,
      );
      if (hasCampaigns === false) {
        return { rows: 0, skipped: true, note: "Conta sem campanha de Product Ads" };
      }
      if (adsStart && day < adsStart) {
        return {
          rows: 0,
          skipped: true,
          note: `Sem campanha de Product Ads em ${day} (início: ${adsStart})`,
        };
      }
      const detail =
        (body as { message?: string; error?: string } | null)?.message ??
        (body as { error?: string } | null)?.error ??
        "";
      throw new Error(`Ads ${day}: HTTP 400${detail ? ` — ${detail}` : ""}`);
    }
    if (status !== 200) throw new Error(`Ads ${day}: HTTP ${status}`);

    const results = ((body as { results?: AdRow[] }).results ?? []) as AdRow[];
    const paging = (body as { paging?: { total?: number } }).paging ?? {};
    const total = Number(paging.total ?? results.length);
    if (results.length === 0) break;
    recebidos += results.length;
    totalDaApi = total;

    for (const r of results) {
      if (!r.item_id) continue;
      const c = Number(r.metrics?.cost ?? 0);
      const cl = Number(r.metrics?.clicks ?? 0);
      const p = Number(r.metrics?.prints ?? 0);
      if (c === 0 && cl === 0 && p === 0) continue;
      collected.push({
        account_id: accountId,
        date: day,
        campaign_id: r.campaign_id ?? 0,
        campaign_name: null,
        ad_group_id: r.ad_group_id ?? null,
        item_id: r.item_id ?? null,
        title: r.title ?? null,
        clicks: cl,
        prints: p,
        cost: c,
        cpc: r.metrics?.cpc == null ? null : Number(r.metrics.cpc),
        ctr: r.metrics?.ctr == null ? null : Number(r.metrics.ctr),
        acos: r.metrics?.acos == null ? null : Number(r.metrics.acos),
        direct_amount: Number(r.metrics?.direct_amount ?? 0),
        indirect_amount: Number(r.metrics?.indirect_amount ?? 0),
        direct_units: Number(r.metrics?.direct_units_quantity ?? 0),
        indirect_units: Number(r.metrics?.indirect_units_quantity ?? 0),
        organic_units: 0,
        synced_at: new Date().toISOString(),
      });
    }

    offset += limit;
    if (offset >= total || results.length < limit) break;
    await sleep(120);
  }

  // Dedupe by (campaign_id, item_id): the ML API can return the same ad more
  // than once (variations, paging overlaps). Sum accumulable metrics and
  // recompute derived ones so the unique constraint holds.
  const merged = new Map<string, Record<string, unknown>>();
  for (const row of collected) {
    const key = `${row.campaign_id}|${row.item_id}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, row);
      continue;
    }
    const add = (k: string) => {
      (existing[k] as number) = Number(existing[k] ?? 0) + Number(row[k] ?? 0);
    };
    add("clicks"); add("prints"); add("cost");
    add("direct_amount"); add("indirect_amount");
    add("direct_units"); add("indirect_units");
    const clicks = Number(existing.clicks ?? 0);
    const prints = Number(existing.prints ?? 0);
    const cost = Number(existing.cost ?? 0);
    const revenue = Number(existing.direct_amount ?? 0) + Number(existing.indirect_amount ?? 0);
    existing.cpc = clicks > 0 ? cost / clicks : 0;
    existing.ctr = prints > 0 ? (clicks / prints) * 100 : 0;
    existing.acos = revenue > 0 ? (cost / revenue) * 100 : null;
  }
  const rows = Array.from(merged.values());

  // Resposta vazia (instabilidade da API) não apaga o dia (sync-05).
  if (rows.length === 0) return { rows: 0 };
  // Grava primeiro e só depois tira do dia o que a API deixou de trazer (linhas que esta rodada
  // não regravou): um corte no meio deixa linhas a mais por um tempo, nunca o dia vazio. Paginação
  // interrompida no meio não limpa nada.
  const { error } = await supabaseAdmin
    .from("ml_ads_daily")
    .upsert(rows as never, { onConflict: "account_id,date,campaign_id,item_id" });
  if (error) throw new Error(`Ads ${day} gravar: ${error.message}`);
  if (adsDoDiaCompleto(rows.length, recebidos, totalDaApi)) {
    const { error: delErr } = await supabaseAdmin
      .from("ml_ads_daily")
      .delete()
      .eq("account_id", accountId)
      .eq("date", day)
      .lt("synced_at", inicio);
    if (delErr) throw new Error(`Ads ${day} limpar: ${delErr.message}`);
  }
  return { rows: rows.length };
}

// Fetch fresh token for an account by id (used by the worker).
export async function getAccountToken(accountId: string): Promise<{ token: string; advertiserId: number | null; externalUserId: number | null }> {
  const acc = await loadAccountForSync(accountId);
  const token = await ensureFreshToken(acc);
  return { token, advertiserId: acc.advertiser_id ?? null, externalUserId: acc.external_user_id ?? null };
}

// ---------- Items (catálogo de anúncios) ----------

type ItemDetail = {
  id?: string;
  title?: string;
  seller_custom_field?: string | null;
  status?: string | null;
  price?: number | null;
  thumbnail?: string | null;
  permalink?: string | null;
  category_id?: string | null;
  variations?: Array<{ seller_custom_field?: string | null }> | null;
};

// Sincroniza o catálogo de anúncios de uma conta. Busca todos os ids paginando
// /users/{sellerId}/items/search (com fallback para scroll acima de 1.000) e
// consulta detalhes em lotes de 20 via /items?ids=. Faz upsert em ml_items e
// grava progresso a cada página em sync_jobs.progress_offset.
//
// Respeita um limite interno de tempo (padrão 60s) para se enquadrar no
// worker: se estourar, retorna e o job volta para a fila via retomada.
export async function syncItemsForAccount(
  accountId: string,
  token: string,
  sellerId: number,
  opts?: { startOffset?: number; startScroll?: string | null; jobId?: string; timeLimitMs?: number },
): Promise<{ processed: number; done: boolean; nextOffset: number; nextScroll: string | null }> {
  const started = Date.now();
  const timeLimit = opts?.timeLimitMs ?? 60_000;
  const pageSize = 100;
  const detailBatch = 20;
  const attrs = "id,title,seller_custom_field,status,price,thumbnail,permalink,available_quantity,variations,category_id";

  let offset = Math.max(0, opts?.startOffset ?? 0);
  let scrollId: string | null = opts?.startScroll ?? null;
  let useScroll = scrollId !== null || offset >= 1_000;
  let processed = 0;

  while (true) {
    if (Date.now() - started > timeLimit) {
      return { processed, done: false, nextOffset: offset, nextScroll: scrollId };
    }

    let ids: string[] = [];
    if (useScroll) {
      const qs = new URLSearchParams({ search_type: "scan", limit: String(pageSize) });
      if (scrollId) qs.set("scroll_id", scrollId);
      const { status, body } = await mlGet(`/users/${sellerId}/items/search?${qs.toString()}`, token);
      if (status !== 200) throw new Error(`Items search (scan): HTTP ${status}`);
      const b = body as { results?: string[]; scroll_id?: string };
      ids = Array.isArray(b.results) ? b.results : [];
      scrollId = b.scroll_id ?? null;
      if (ids.length === 0 || !scrollId) {
        // fim do scroll
        if (ids.length === 0) {
          if (opts?.jobId) {
            await supabaseAdmin
              .from("sync_jobs")
              .update({ progress_offset: 0, progress_cursor: null })
              .eq("id", opts.jobId);
          }
          return { processed, done: true, nextOffset: 0, nextScroll: null };
        }
      }
    } else {
      const qs = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
      const { status, body } = await mlGet(`/users/${sellerId}/items/search?${qs.toString()}`, token);
      if (status !== 200) {
        // Acima de 1.000 alguns tenants respondem 400/403 — troca para scan.
        if ((status === 400 || status === 403) && offset > 0) {
          useScroll = true;
          scrollId = null;
          continue;
        }
        throw new Error(`Items search: HTTP ${status}`);
      }
      const b = body as { results?: string[]; paging?: { total?: number } };
      ids = Array.isArray(b.results) ? b.results : [];
      const total = Number(b.paging?.total ?? 0);
      if (ids.length === 0) {
        if (opts?.jobId) {
          await supabaseAdmin
            .from("sync_jobs")
            .update({ progress_offset: 0, progress_cursor: null })
            .eq("id", opts.jobId);
        }
        return { processed, done: true, nextOffset: 0, nextScroll: null };
      }
      offset += ids.length;
      if (offset >= 1_000 && offset < total) {
        // próxima iteração já usa scan
        useScroll = true;
        scrollId = null;
      }
    }

    // Detalhes em lotes de 20
    for (let i = 0; i < ids.length; i += detailBatch) {
      const slice = ids.slice(i, i + detailBatch);
      const qs = new URLSearchParams({ ids: slice.join(","), attributes: attrs });
      const { status, body } = await mlGet(`/items?${qs.toString()}`, token);
      if (status !== 200) throw new Error(`Items multiget: HTTP ${status}`);
      const arr = Array.isArray(body) ? (body as Array<{ code?: number; body?: ItemDetail }>) : [];
      const rows = arr
        .filter((e) => e.code === 200 && e.body?.id)
        .map((e) => {
          const it = e.body!;
          const sku =
            (it.seller_custom_field && String(it.seller_custom_field).trim()) ||
            (Array.isArray(it.variations)
              ? it.variations.find((v) => v?.seller_custom_field && String(v.seller_custom_field).trim())?.seller_custom_field ?? null
              : null) ||
            null;
          return {
            account_id: accountId,
            item_id: it.id!,
            title: it.title ?? it.id!,
            seller_sku: sku,
            status: it.status ?? null,
            category_id: it.category_id ?? null,
            price: it.price == null ? null : Number(it.price),
            permalink: it.permalink ?? null,
            thumbnail: it.thumbnail ?? null,
            synced_at: new Date().toISOString(),
          };
        });
      if (rows.length > 0) {
        const { error } = await supabaseAdmin
          .from("ml_items")
          .upsert(rows as never, { onConflict: "account_id,item_id" });
        if (error) throw new Error(`Items upsert: ${error.message}`);
        // Cria em product_skus os SKUs novos vistos nos anúncios (sem custo, idempotente).
        await supabaseAdmin.rpc("ensure_product_skus_from_ml", { _account_id: accountId });
        processed += rows.length;
      }
      await sleep(SLEEP_MS);
    }

    // Persistir progresso
    if (opts?.jobId) {
      await supabaseAdmin
        .from("sync_jobs")
        .update({ progress_offset: useScroll ? 0 : offset, progress_cursor: scrollId })
        .eq("id", opts.jobId);
    }
  }
}

// Enfileira um único job 'items' por conta (idempotente).
export async function enqueueItemsJob(
  accountId: string,
  ownerId: string,
): Promise<{ enqueued: number }> {
  const targetKey = "catalog";
  const { data: existing } = await supabaseAdmin
    .from("sync_jobs")
    .select("id, status")
    .eq("account_id", accountId)
    .eq("job_type", "items")
    .eq("target_key", targetKey)
    .maybeSingle();
  if (!existing) {
    const { error } = await supabaseAdmin.from("sync_jobs").insert([
      {
        account_id: accountId,
        owner_id: ownerId,
        job_type: "items",
        status: "pendente",
        target_key: targetKey,
      },
    ] as never);
    if (error) throw new Error(`Enfileirar items: ${error.message}`);
    return { enqueued: 1 };
  }
  if (existing.status === "concluido" || existing.status === "erro") {
    const { error } = await supabaseAdmin
      .from("sync_jobs")
      .update({
        status: "pendente",
        attempts: 0,
        last_error: null,
        started_at: null,
        finished_at: null,
        progress_offset: 0,
        progress_cursor: null,
      })
      .eq("id", existing.id);
    if (error) throw new Error(`Reenfileirar items: ${error.message}`);
    return { enqueued: 1 };
  }
  return { enqueued: 0 };
}

// Backfill de SKU e criação de anúncios só-vendas, chamado ao final da sync de items.
export async function runItemsBackfill(): Promise<{ inserted: number; sku_updated: number }> {
  const ins = await supabaseAdmin.rpc("backfill_items_from_orders");
  const upd = await supabaseAdmin.rpc("backfill_item_skus");
  return {
    inserted: Number((ins.data as number | null) ?? 0),
    sku_updated: Number((upd.data as number | null) ?? 0),
  };
}

export type SyncResult = {
  account_id: string;
  overall: "sucesso" | "parcial" | "erro";
  enqueued: {
    billing: number;
    orders: number;
    ads: number;
    visits: number;
    mp_payments: number;
  };
  errors: string[];
};

// Enqueue-only sync: fetches periods (fast) and enqueues billing/orders/ads/visits jobs.
// Returns in seconds; heavy work runs in the worker.
export async function syncAccount(
  accountId: string,
  days: number,
  opts?: { todos?: boolean },
): Promise<SyncResult> {
  const todos = opts?.todos ?? false;
  const acc = await loadAccountForSync(accountId);
  if (acc.status !== "conectada") throw new Error("Conta não está conectada.");

  const token = await ensureFreshToken(acc);
  const { from, to } = windowDates(days);
  const ownerId = acc.owner_id;

  const result: SyncResult = {
    account_id: accountId,
    overall: "sucesso",
    enqueued: { billing: 0, orders: 0, ads: 0, visits: 0, mp_payments: 0 },
    errors: [],
  };
  const startedAt = new Date().toISOString();

  let periods: PeriodItem[] = [];
  try {
    periods = await syncPeriods(accountId, token);
  } catch (e) {
    const msg = (e as Error).message;
    result.errors.push(`períodos: ${msg}`);
    result.overall = "parcial";
    await logSync({ accountId, syncType: "periods", status: "erro", errorMessage: msg });
  }

  // Billing: enfileira TODOS os períodos retornados pela API.
  // O ML já devolve só os períodos disponíveis para a conta (cada conta pode
  // ter ciclos distintos), então não filtramos pela janela para não perder
  // períodos com date_to fora do intervalo mas com lançamentos relevantes.
  const relevantKeys = periods
    .filter((p) => !!p.key)
    .map((p) => p.key!) as string[];
  try {
    const r = await enqueueBillingJobs(accountId, ownerId, relevantKeys);
    result.enqueued.billing = r.enqueued;
    if (relevantKeys.length === 0) {
      result.errors.push("billing: nenhum período retornado pela API");
    }
  } catch (e) {
    const msg = (e as Error).message;
    result.errors.push(`billing: ${msg}`);
    result.overall = "parcial";
  }

  // Orders
  if (acc.external_user_id) {
    try {
      const r = await enqueueOrdersJobs(accountId, ownerId, from, to, { todos });
      result.enqueued.orders = r.enqueued;
    } catch (e) {
      const msg = (e as Error).message;
      result.errors.push(`orders: ${msg}`);
      result.overall = "parcial";
    }
  } else {
    result.errors.push("orders: external_user_id ausente");
    result.overall = "parcial";
  }

  // Ads
  if (acc.advertiser_id) {
    try {
      const r = await enqueueAdsJobs(accountId, ownerId, from, to, { todos });
      result.enqueued.ads = r.enqueued;
    } catch (e) {
      const msg = (e as Error).message;
      result.errors.push(`ads: ${msg}`);
      result.overall = "parcial";
    }
  }

  // Visits
  if (acc.external_user_id) {
    try {
      const r = await enqueueVisitsJobs(accountId, ownerId, from, to, { todos });
      result.enqueued.visits = r.enqueued;
    } catch (e) {
      const msg = (e as Error).message;
      result.errors.push(`visits: ${msg}`);
      result.overall = "parcial";
    }
  }

  // Items (catálogo) — um job por conta, sem janela de data.
  try {
    await enqueueItemsJob(accountId, ownerId);
  } catch (e) {
    const msg = (e as Error).message;
    result.errors.push(`items: ${msg}`);
    result.overall = "parcial";
  }

  // Mercado Pago (pagamentos / fluxo de caixa)
  try {
    // A janela do MP acompanha a das vendas: sempre 90 dias para trás,
    // mesmo quando a sincronização diária pede poucos dias. Janelas já
    // concluídas não são reenfileiradas, só a mais recente.
    const mpWindow = windowDates(Math.max(days, 90));
    const r = await enqueueMpPaymentsJobs(accountId, ownerId, mpWindow.from, mpWindow.to, { todos });
    result.enqueued.mp_payments = r.enqueued;
  } catch (e) {
    const msg = (e as Error).message;
    result.errors.push(`mp_payments: ${msg}`);
    result.overall = "parcial";
  }

  const totalEnq =
    result.enqueued.billing + result.enqueued.orders + result.enqueued.ads + result.enqueued.visits;
  await logSync({
    accountId,
    syncType: "enqueue",
    status: result.overall,
    recordsProcessed: totalEnq,
    errorMessage: result.errors.length ? result.errors.join(" · ") : `${totalEnq} job(s) enfileirado(s)`,
  });

  await supabaseAdmin
    .from("marketplace_accounts")
    .update({ last_sync_at: startedAt, last_sync_status: result.overall })
    .eq("id", accountId);

  return result;
}

// ---------- Mercado Pago (pagamentos / fluxo de caixa) ----------

type MpFeeDetail = { amount?: number | string | null };
type MpPayment = {
  id?: number | string;
  collector_id?: number | string | null;
  order?: { id?: number | string | null } | null;
  date_created?: string | null;
  date_approved?: string | null;
  money_release_date?: string | null;
  money_release_status?: string | null;
  status?: string | null;
  status_detail?: string | null;
  operation_type?: string | null;
  payment_method_id?: string | null;
  payment_type_id?: string | null;
  installments?: number | null;
  transaction_amount?: number | string | null;
  transaction_details?: {
    total_paid_amount?: number | string | null;
    net_received_amount?: number | string | null;
  } | null;
  fee_details?: MpFeeDetail[] | null;
  charges_details?: MpChargeDetail[] | null;
};

type MpChargeDetail = {
  name?: string | null;
  amount?: number | string | null;
  amounts?: { original?: number | string | null } | null;
};

/** Extrai taxas do pagamento: charges_details (real) com fallback em fee_details.
 *  Separa comissao ML, frete, parcelamento, cupom e processamento MP.
 *  Cupom, repasse de financiamento e cashback NAO sao custo do vendedor: ficam fora do feeTotal. */
function extrairTaxasMp(p: MpPayment): {
  feeTotal: number;
  mpFee: number;
  mlFee: number;
  shippingFee: number;
  installmentFee: number;
  couponFee: number;
  splitFee: number;
} {
  const charges = Array.isArray(p.charges_details) ? p.charges_details : [];
  if (charges.length > 0) {
    let mpFee = 0;
    let mlFee = 0;
    let shippingFee = 0;
    let installmentFee = 0;
    let couponFee = 0;
    let splitFee = 0;
    for (const c of charges) {
      const amount = c?.amounts?.original != null ? toNumber(c.amounts.original) : toNumber(c?.amount);
      const name = String(c?.name ?? "").toLowerCase();
      if (name.includes("sale_fee")) {
        mlFee += amount;
      } else if (
        name.startsWith("shp") ||
        name.includes("shipping") ||
        name.includes("fulfillment") ||
        name.includes("cross_docking") ||
        name.includes("dropoff")
      ) {
        shippingFee += amount;
      } else if (name === "financing_transfer" || name === "cashback-crypto") {
        // repasse/cashback: nao reduz o liquido do vendedor
        continue;
      } else if (name.includes("fee_spl")) {
        splitFee += amount;
      } else if (name.includes("financing")) {
        installmentFee += amount;
      } else if (name.includes("coupon")) {
        couponFee += amount;
      } else if (name.includes("processing") || name === "mercadopago_fee") {
        mpFee += amount;
      } else {
        console.warn(`[mp] charge nao classificada: "${name}" (${amount})`);
        mpFee += amount;
      }
    }
    return {
      // cupom fica fora: quem banca o desconto e o Mercado Livre
      feeTotal: mlFee + shippingFee + installmentFee + splitFee + mpFee,
      mpFee,
      mlFee,
      shippingFee,
      installmentFee,
      couponFee,
      splitFee,
    };
  }
  const feeTotal = Array.isArray(p.fee_details)
    ? p.fee_details.reduce((s, f) => s + toNumber(f?.amount), 0)
    : 0;
  return { feeTotal, mpFee: feeTotal, mlFee: 0, shippingFee: 0, installmentFee: 0, couponFee: 0, splitFee: 0 };
}

async function mpGet(
  path: string,
  token: string,
): Promise<{ status: number; body: unknown }> {
  let attempt = 0;
  while (true) {
    const res = await fetch(`${MP_API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        accept: "application/json",
      },
    });
    if (res.status === 429 && attempt < RATE_LIMIT_MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000)
        : Math.min(2000 * Math.pow(2, attempt), 16_000);
      attempt += 1;
      await sleep(backoffMs);
      continue;
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }
}

function toNumber(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number | null | undefined);
  return Number.isFinite(n as number) ? (n as number) : 0;
}

// Sincroniza pagamentos do Mercado Pago para um intervalo (data_created).
// Pagina com limit=50/offset até esgotar (paging.total) ou página vazia.
export async function syncMpPaymentsForRange(
  accountId: string,
  token: string,
  from: string,
  to: string,
  contaMl: number,
): Promise<number> {
  const beginIso = isoSaoPauloStart(from);
  const endIso = isoSaoPauloEnd(to);
  const limit = 50;
  let offset = 0;
  let total = 0;
  let guard = 0;
  const MP_SLEEP_MS = 200;

  while (guard < 200) {
    guard += 1;
    const qs = new URLSearchParams({
      sort: "date_created",
      criteria: "desc",
      range: "date_created",
      begin_date: beginIso,
      end_date: endIso,
      limit: String(limit),
      offset: String(offset),
    });
    const { status, body } = await mpGet(`/v1/payments/search?${qs.toString()}`, token);
    if (status !== 200) throw new Error(`MP payments: HTTP ${status}`);
    const b = (body ?? {}) as { results?: MpPayment[]; paging?: { total?: number } };
    const results = Array.isArray(b.results) ? b.results : [];
    if (results.length === 0) break;

    // Compras e transferências feitas pela conta vêm na mesma busca: ficam de fora.
    const rows = results.filter((p) => recebidoPelaConta(p, contaMl)).map((p) => {
      const { feeTotal, mpFee, mlFee, shippingFee, installmentFee, couponFee, splitFee } = extrairTaxasMp(p);
      const orderId = p.order && p.order.id != null ? Number(p.order.id) : null;
      return {
        account_id: accountId,
        payment_id: Number(p.id),
        order_id: orderId != null && Number.isFinite(orderId) ? orderId : null,
        date_created: p.date_created ?? null,
        date_approved: p.date_approved ?? null,
        money_release_date: p.money_release_date ?? null,
        money_release_status: p.money_release_status ?? null,
        status: p.status ?? null,
        status_detail: p.status_detail ?? null,
        operation_type: p.operation_type ?? null,
        payment_method_id: p.payment_method_id ?? null,
        payment_type_id: p.payment_type_id ?? null,
        installments: p.installments == null ? null : Number(p.installments),
        transaction_amount: toNumber(p.transaction_amount),
        total_paid_amount: toNumber(p.transaction_details?.total_paid_amount),
        net_received_amount: toNumber(p.transaction_details?.net_received_amount),
        fee_total: feeTotal,
        mp_fee: mpFee,
        ml_fee: mlFee,
        shipping_fee: shippingFee,
        installment_fee: installmentFee,
        coupon_fee: couponFee,
        split_fee: splitFee,
        raw: p as unknown as Record<string, unknown>,
        synced_at: new Date().toISOString(),
      };
    });

    if (rows.length > 0) {
      const { error } = await supabaseAdmin
        .from("mp_payments")
        .upsert(rows as never, { onConflict: "account_id,payment_id" });
      if (error) throw new Error(`MP payments upsert: ${error.message}`);
    }

    total += rows.length;
    const paged = b.paging?.total;
    offset += results.length;
    if (results.length < limit) break;
    if (typeof paged === "number" && offset >= paged) break;
    await sleep(MP_SLEEP_MS);
  }
  return total;
}

// Enfileira jobs 'mp_payments' em janelas fixas de 3 dias.
// As janelas são ancoradas num grid fixo (múltiplos de 3 dias desde a época),
// para que a chave target_key seja estável entre execuções e não gere duplicatas.
export async function enqueueMpPaymentsJobs(
  accountId: string,
  ownerId: string,
  from: string,
  to: string,
  opts?: { priority?: number; todos?: boolean },
): Promise<{ enqueued: number }> {
  const priority = opts?.priority ?? 100;
  const chunks: Array<{ from: string; to: string }> = [];
  const chunkDays = 3;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const startMs = Date.UTC(fy, fm - 1, fd);
  const endMs = Date.UTC(ty, tm - 1, td);
  const oneDay = 24 * 60 * 60 * 1000;
  const fmt = (ms: number) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  };
  // Alinha o início de cada janela ao grid fixo de 3 dias.
  const bucketStart = (ms: number) => Math.floor(ms / oneDay / chunkDays) * chunkDays * oneDay;
  let cursor = bucketStart(endMs);
  while (cursor >= bucketStart(startMs)) {
    chunks.push({ from: fmt(cursor), to: fmt(cursor + (chunkDays - 1) * oneDay) });
    cursor -= chunkDays * oneDay;
  }
  const keys = chunks.map((c) => `${c.from}:${c.to}`);
  const { data: existing } = await supabaseAdmin
    .from("sync_jobs")
    .select("id, target_key, status")
    .eq("account_id", accountId)
    .eq("job_type", "mp_payments")
    .in("target_key", keys);
  const byKey = new Map((existing ?? []).map((r) => [r.target_key as string, r]));
  const toInsert: Array<Record<string, unknown>> = [];
  const toReset: string[] = [];
  const alwaysReenqueue = new Set(opts?.todos ? keys : [keys[0]]);
  for (const k of keys) {
    const ex = byKey.get(k);
    if (!ex) {
      toInsert.push({
        account_id: accountId,
        owner_id: ownerId,
        job_type: "mp_payments",
        status: "pendente",
        priority,
        target_key: k,
      });
    } else if (ex.status === "erro" || (ex.status === "concluido" && alwaysReenqueue.has(k))) {
      toReset.push(ex.id as string);
    }
  }
  if (toInsert.length > 0) {
    const { error } = await supabaseAdmin.from("sync_jobs").insert(toInsert as never);
    if (error) throw new Error(`Enfileirar mp_payments: ${error.message}`);
  }
  if (toReset.length > 0) {
    const { error } = await supabaseAdmin
      .from("sync_jobs")
      .update({ status: "pendente", attempts: 0, last_error: null, started_at: null, finished_at: null })
      .in("id", toReset);
    if (error) throw new Error(`Reenfileirar mp_payments: ${error.message}`);
  }
  return { enqueued: toInsert.length + toReset.length };
}

export { supabaseAdmin };

/**
 * Sincronização do DIA CORRENTE (São Paulo): apenas pedidos e pagamentos do
 * Mercado Pago. Usada pela tela de Conciliação, que precisa enxergar as vendas
 * de hoje. Não mexe em billing/ads/visitas — esses seguem só na diária.
 */
export async function syncAccountToday(
  accountId: string,
): Promise<{ account_id: string; enqueued: number; errors: string[] }> {
  const acc = await loadAccountForSync(accountId);
  if (acc.status !== "conectada") throw new Error("Conta não está conectada.");
  const today = ymdSaoPaulo(new Date());
  const errors: string[] = [];
  let enqueued = 0;

  if (acc.external_user_id) {
    try {
      const r = await enqueueOrdersJobs(accountId, acc.owner_id, today, today);
      enqueued += r.enqueued;
    } catch (e) {
      errors.push(`orders: ${(e as Error).message}`);
    }
  } else {
    errors.push("orders: external_user_id ausente");
  }

  try {
    const r = await enqueueMpPaymentsJobs(accountId, acc.owner_id, today, today);
    enqueued += r.enqueued;
  } catch (e) {
    errors.push(`mp_payments: ${(e as Error).message}`);
  }

  // ADS do dia corrente: sem isso as vendas de hoje ficam sem rateio de publicidade.
  if (acc.advertiser_id) {
    try {
      const r = await enqueueAdsJobs(accountId, acc.owner_id, today, today);
      enqueued += r.enqueued;
    } catch (e) {
      errors.push(`ads: ${(e as Error).message}`);
    }
  }

  return { account_id: accountId, enqueued, errors };
}
/**
 * Reconsulta pedidos e pagamentos dos últimos `dias` (sync-01). Cancelamento, devolução e estorno
 * acontecem em média 2 dias depois da venda (63% depois do primeiro dia); a sincronização do dia
 * não os vê. Roda uma vez por dia pelo agendador. Pedidos em blocos de 7 dias, para cada tarefa
 * caber no tempo-limite do worker; prioridade abaixo da do dia corrente.
 */
export async function recheckRecentForAccount(
  accountId: string,
  dias: number,
): Promise<{ account_id: string; enqueued: number; errors: string[] }> {
  const acc = await loadAccountForSync(accountId);
  if (acc.status !== "conectada") throw new Error("Conta não está conectada.");
  const to = ymdSaoPaulo(new Date());
  const from = ymdSaoPaulo(new Date(Date.now() - (dias - 1) * 24 * 60 * 60 * 1000));
  const errors: string[] = [];
  let enqueued = 0;
  if (acc.external_user_id) {
    try {
      const r = await enqueueOrdersJobs(accountId, acc.owner_id, from, to, { priority: 150, chunkDays: 7, todos: true });
      enqueued += r.enqueued;
    } catch (e) {
      errors.push(`orders: ${(e as Error).message}`);
    }
  } else {
    errors.push("orders: external_user_id ausente");
  }
  try {
    const r = await enqueueMpPaymentsJobs(accountId, acc.owner_id, from, to, { priority: 150, todos: true });
    enqueued += r.enqueued;
  } catch (e) {
    errors.push(`mp_payments: ${(e as Error).message}`);
  }
  await logSync({
    accountId,
    syncType: "enqueue",
    status: errors.length ? (enqueued ? "parcial" : "erro") : "sucesso",
    recordsProcessed: enqueued,
    errorMessage: errors.length ? errors.join(" | ").slice(0, 400) : `Reconsulta de ${dias} dias: ${enqueued} tarefa(s)`,
  });
  return { account_id: accountId, enqueued, errors };
}

// ---------- Reprocessa liberações pendentes vencidas ----------

/**
 * Reconsulta na API do Mercado Pago os pagamentos que já deveriam ter sido
 * liberados (money_release_date no passado) mas continuam como pendentes,
 * e atualiza status/liberação/líquido/taxas no banco.
 */
export async function refreshPendingReleases(
  accountId: string,
  limit = 300,
): Promise<{ account_id: string; verificados: number; atualizados: number; errors: string[] }> {
  const errors: string[] = [];
  const { token } = await getAccountToken(accountId);
  const nowIso = new Date().toISOString();

  const { data: pend, error } = await supabaseAdmin
    .from("mp_payments")
    .select("payment_id, money_release_status, money_release_date, net_received_amount, status")
    .eq("account_id", accountId)
    .neq("money_release_status", "released")
    .not("money_release_date", "is", null)
    .lt("money_release_date", nowIso)
    .order("money_release_date", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Buscar pendentes: ${error.message}`);

  const rows = pend ?? [];
  let atualizados = 0;
  const BATCH = 50;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    for (const row of batch) {
      try {
        const { status, body } = await mpGet(`/v1/payments/${row.payment_id}`, token);
        if (status !== 200) {
          errors.push(`payment ${row.payment_id}: HTTP ${status}`);
          continue;
        }
        const p = (body ?? {}) as MpPayment;
        // Datas comparadas como instante: a API e o banco escrevem o mesmo horário de jeitos diferentes.
        const instante = (v: string | null | undefined) => (v ? new Date(v).getTime() : null);
        const mudou =
          (p.money_release_status ?? null) !== (row.money_release_status ?? null) ||
          instante(p.money_release_date) !== instante(row.money_release_date) ||
          (p.status ?? null) !== (row.status ?? null) ||
          toNumber(p.transaction_details?.net_received_amount) !== Number(row.net_received_amount ?? 0);
        if (!mudou) continue;

        const { feeTotal, mpFee, mlFee, shippingFee, installmentFee, couponFee } = extrairTaxasMp(p);
        const { error: upErr } = await supabaseAdmin
          .from("mp_payments")
          .update({
            money_release_status: p.money_release_status ?? null,
            money_release_date: p.money_release_date ?? null,
            status: p.status ?? null,
            status_detail: p.status_detail ?? null,
            net_received_amount: toNumber(p.transaction_details?.net_received_amount),
            total_paid_amount: toNumber(p.transaction_details?.total_paid_amount),
            fee_total: feeTotal,
            mp_fee: mpFee,
            ml_fee: mlFee,
            shipping_fee: shippingFee,
            installment_fee: installmentFee,
            coupon_fee: couponFee,
            raw: p as unknown as Record<string, unknown>,
            synced_at: new Date().toISOString(),
          } as never)
          .eq("account_id", accountId)
          .eq("payment_id", row.payment_id);
        if (upErr) {
          errors.push(`payment ${row.payment_id}: ${upErr.message}`);
          continue;
        }
        atualizados += 1;
      } catch (e) {
        errors.push(`payment ${row.payment_id}: ${(e as Error).message}`);
      }
    }
    if (i + BATCH < rows.length) await sleep(500);
  }

  return { account_id: accountId, verificados: rows.length, atualizados, errors };
}

// ---------- Carga histórica (backfill) ----------

export type BackfillResult = {
  account_id: string;
  start_date: string;
  start_source: string;
  enqueued: { billing: number; orders: number; mp_payments: number; ads: number; visits: number };
  errors: string[];
};

/**
 * Descobre a data de início real da conta: usa a data de cadastro do usuário
 * no Mercado Livre e a menor data já vista em pedidos / faturamento /
 * pagamentos. Nunca "chuta" um valor fixo.
 */
async function discoverAccountStart(
  accountId: string,
  token: string,
  externalUserId: number | null,
): Promise<{ date: string; source: string }> {
  const candidates: Array<{ date: string; source: string }> = [];

  if (externalUserId) {
    try {
      const { status, body } = await mlGet(`/users/${externalUserId}`, token);
      const reg = (body as { registration_date?: string | null })?.registration_date;
      if (status === 200 && reg) {
        candidates.push({ date: reg.slice(0, 10), source: "cadastro no Mercado Livre" });
      }
    } catch {
      /* segue com as datas do banco */
    }
  }

  const [ord, bill, pay] = await Promise.all([
    supabaseAdmin
      .from("ml_orders")
      .select("date_created")
      .eq("account_id", accountId)
      .order("date_created", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("ml_billing_periods")
      .select("date_from")
      .eq("account_id", accountId)
      .order("date_from", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("mp_payments")
      .select("date_created")
      .eq("account_id", accountId)
      .order("date_created", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (ord.data?.date_created)
    candidates.push({ date: String(ord.data.date_created).slice(0, 10), source: "primeiro pedido" });
  if (bill.data?.date_from)
    candidates.push({ date: String(bill.data.date_from).slice(0, 10), source: "primeiro faturamento" });
  if (pay.data?.date_created)
    candidates.push({ date: String(pay.data.date_created).slice(0, 10), source: "primeiro pagamento" });

  if (candidates.length === 0) {
    return { date: windowDates(365).from, source: "padrão (12 meses)" };
  }
  candidates.sort((a, b) => a.date.localeCompare(b.date));
  const earliest = candidates[0];
  // Teto de segurança: no máximo 3 anos para trás.
  const floorDate = windowDates(365 * 3).from;
  if (earliest.date < floorDate) return { date: floorDate, source: `${earliest.source} (limitado a 3 anos)` };
  return earliest;
}

/**
 * Enfileira a carga retroativa COMPLETA da conta (pedidos, pagamentos,
 * faturamento e, por último, ADS/visitas). Tudo entra com prioridade baixa,
 * para que a sincronização do dia corrente continue passando na frente.
 */
export async function backfillAccount(accountId: string): Promise<BackfillResult> {
  const acc = await loadAccountForSync(accountId);
  if (acc.status !== "conectada") throw new Error("Conta não está conectada.");
  const token = await ensureFreshToken(acc);
  const ownerId = acc.owner_id;
  const to = windowDates(1).to;

  const { date: startDate, source } = await discoverAccountStart(
    accountId,
    token,
    acc.external_user_id ?? null,
  );

  const result: BackfillResult = {
    account_id: accountId,
    start_date: startDate,
    start_source: source,
    enqueued: { billing: 0, orders: 0, mp_payments: 0, ads: 0, visits: 0 },
    errors: [],
  };

  // Nenhuma venda antiga pode gerar alerta no Telegram: o corte de alertas
  // passa a ser agora, então tudo que a carga trouxer já nasce "notificado".
  try {
    await supabaseAdmin
      .from("telegram_config")
      .update({ alerts_started_at: new Date().toISOString() })
      .eq("owner_id", ownerId)
      .is("alerts_started_at", null);
  } catch (e) {
    result.errors.push(`telegram: ${(e as Error).message}`);
  }

  // 1) Faturamento — todos os períodos que a API expõe.
  try {
    const periods = await syncPeriods(accountId, token);
    const keys = periods.filter((p) => !!p.key).map((p) => p.key!) as string[];
    const r = await enqueueBillingJobs(accountId, ownerId, keys, { priority: 200 });
    result.enqueued.billing = r.enqueued;
  } catch (e) {
    result.errors.push(`billing: ${(e as Error).message}`);
  }

  // 2) Pedidos — janelas de 30 dias, paginadas dentro de cada janela.
  if (acc.external_user_id) {
    try {
      const r = await enqueueOrdersJobs(accountId, ownerId, startDate, to, {
        priority: 210,
        chunkDays: 30,
      });
      result.enqueued.orders = r.enqueued;
    } catch (e) {
      result.errors.push(`orders: ${(e as Error).message}`);
    }
  } else {
    result.errors.push("orders: external_user_id ausente");
  }

  // 3) Pagamentos do Mercado Pago — janelas de 3 dias.
  try {
    const r = await enqueueMpPaymentsJobs(accountId, ownerId, startDate, to, { priority: 220 });
    result.enqueued.mp_payments = r.enqueued;
  } catch (e) {
    result.errors.push(`mp_payments: ${(e as Error).message}`);
  }

  // 4) ADS e visitas por último (endpoints que já geraram bloqueio 429).
  if (acc.advertiser_id) {
    try {
      const r = await enqueueAdsJobs(accountId, ownerId, startDate, to, {
        priority: 240,
        maxDays: 400,
      });
      result.enqueued.ads = r.enqueued;
    } catch (e) {
      result.errors.push(`ads: ${(e as Error).message}`);
    }
  }
  if (acc.external_user_id) {
    try {
      const r = await enqueueVisitsJobs(accountId, ownerId, startDate, to, {
        priority: 250,
        maxDays: 400,
      });
      result.enqueued.visits = r.enqueued;
    } catch (e) {
      result.errors.push(`visits: ${(e as Error).message}`);
    }
  }

  const total =
    result.enqueued.billing +
    result.enqueued.orders +
    result.enqueued.mp_payments +
    result.enqueued.ads +
    result.enqueued.visits;
  await logSync({
    accountId,
    syncType: "backfill",
    status: result.errors.length ? "parcial" : "sucesso",
    recordsProcessed: total,
    errorMessage: result.errors.length
      ? result.errors.join(" · ")
      : `Carga histórica desde ${startDate}: ${total} job(s)`,
  });

  return result;
}
