// Motor de alertas do Telegram (canal de SAÍDA).
// Regras: nunca alerta venda sem custo cadastrado, deduplica no banco,
// só considera vendas após a ativação, respeita teto por hora (agrupa se estourar)
// e reenfileira envios com falha para nova tentativa.

import type { SupabaseClient } from "@supabase/supabase-js";

export type AlertType = "margem_baixa" | "prejuizo" | "anuncio_negativo" | "sem_custo_resumo";

type Config = {
  owner_id: string;
  is_active: boolean;
  allowed_chat_id: string | null;
  alert_chat_id: string | null;
  alert_margem_baixa: boolean;
  alert_prejuizo: boolean;
  alert_anuncio_negativo: boolean;
  alert_sem_custo_resumo: boolean;
  margem_minima_pct: number;
  max_alertas_hora: number;
  alerts_started_at: string | null;
};

type SaleRow = {
  account_id: string;
  account_nickname: string | null;
  order_id: number;
  order_date: string;
  sku: string | null;
  title: string | null;
  units: number;
  receita: number;
  liquido: number;
  cmv: number;
  margem: number;
  margem_pct: number | null;
  cmv_missing: boolean;
};

type AdRow = {
  account_id: string;
  account_nickname: string | null;
  item_id: string;
  titulo: string | null;
  seller_sku: string | null;
  receita: number;
  cmv: number;
  ads: number;
  margem: number;
  margem_pct: number | null;
  custo_faltando: boolean;
};

const TG_API = "https://api.telegram.org";

function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TELEGRAM_KEY || null;
}

function brl(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);
}

function pct(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(1).replace(".", ",")}%`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function todaySP(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function tgSend(chatId: string, text: string): Promise<void> {
  const token = botToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN não configurado");
  const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!res.ok || !body?.ok) {
    throw new Error(`Telegram ${res.status}: ${body?.description ?? "falha no envio"}`);
  }
}

function saleMessage(kind: AlertType, r: SaleRow, minPct: number): string {
  const head =
    kind === "prejuizo"
      ? "🔴 <b>Venda com prejuízo</b>"
      : `🟡 <b>Margem abaixo de ${pct(minPct)}</b>`;
  const nome = esc(r.title ?? r.sku ?? `Pedido ${r.order_id}`);
  return [
    head,
    "",
    `<b>${nome}</b>`,
    r.sku ? `SKU: <code>${esc(r.sku)}</code>` : null,
    `Pedido: <code>${r.order_id}</code> · ${r.units} un.`,
    r.account_nickname ? `Conta: ${esc(r.account_nickname)}` : null,
    "",
    `Receita: ${brl(r.receita)}`,
    `Líquido ML/MP: ${brl(r.liquido)}`,
    `CMV: ${brl(r.cmv)}`,
    `<b>Margem: ${brl(r.margem)} (${pct(r.margem_pct)})</b>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function adMessage(r: AdRow): string {
  return [
    "📉 <b>Anúncio com margem negativa</b>",
    "",
    `<b>${esc(r.titulo ?? r.item_id)}</b>`,
    r.seller_sku ? `SKU: <code>${esc(r.seller_sku)}</code>` : null,
    `Anúncio: <code>${esc(r.item_id)}</code>`,
    r.account_nickname ? `Conta: ${esc(r.account_nickname)}` : null,
    "",
    `Receita 30d: ${brl(r.receita)}`,
    `CMV: ${brl(r.cmv)} · Ads: ${brl(r.ads)}`,
    `<b>MC: ${brl(r.margem)} (${pct(r.margem_pct)})</b>`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function loadConfigs(db: SupabaseClient): Promise<Config[]> {
  const { data, error } = await db
    .from("telegram_config")
    .select(
      "owner_id, is_active, allowed_chat_id, alert_chat_id, alert_margem_baixa, alert_prejuizo, alert_anuncio_negativo, alert_sem_custo_resumo, margem_minima_pct, max_alertas_hora, alerts_started_at",
    )
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Config[];
}

function chatOf(cfg: Config): string | null {
  return cfg.alert_chat_id || cfg.allowed_chat_id || null;
}

/** Enfileira (com deduplicação) os alertas de venda pendentes. */
async function queueSaleAlerts(db: SupabaseClient, cfg: Config): Promise<number> {
  if (!cfg.alert_margem_baixa && !cfg.alert_prejuizo && !cfg.alert_sem_custo_resumo) return 0;
  const since = cfg.alerts_started_at;
  if (!since) return 0;

  const { data, error } = await db.rpc("telegram_sale_candidates", {
    _owner_id: cfg.owner_id,
    _since: since,
    _limit: 200,
  });
  if (error) throw new Error(`telegram_sale_candidates: ${error.message}`);
  const rows = (data ?? []) as unknown as SaleRow[];

  const toInsert: Array<Record<string, unknown>> = [];
  let semCusto = 0;
  let semCustoReceita = 0;

  for (const r of rows) {
    if (r.cmv_missing) {
      // REGRA: venda sem custo cadastrado NUNCA gera alerta de margem.
      semCusto += 1;
      semCustoReceita += Number(r.receita ?? 0);
      continue;
    }
    const margem = Number(r.margem ?? 0);
    const mp = r.margem_pct == null ? null : Number(r.margem_pct);
    let kind: AlertType | null = null;
    if (margem < 0) kind = cfg.alert_prejuizo ? "prejuizo" : null;
    else if (mp != null && mp < Number(cfg.margem_minima_pct))
      kind = cfg.alert_margem_baixa ? "margem_baixa" : null;
    if (!kind) continue;

    toInsert.push({
      owner_id: cfg.owner_id,
      account_id: r.account_id,
      alert_type: kind,
      ref_key: String(r.order_id),
      status: "pendente",
      payload: r as unknown as Record<string, unknown>,
      message: saleMessage(kind, r, Number(cfg.margem_minima_pct)),
    });
  }

  if (cfg.alert_sem_custo_resumo && semCusto > 0) {
    toInsert.push({
      owner_id: cfg.owner_id,
      alert_type: "sem_custo_resumo",
      ref_key: todaySP(),
      status: "pendente",
      payload: { vendas: semCusto, receita: semCustoReceita },
      message: [
        "⚠️ <b>Vendas sem custo cadastrado</b>",
        "",
        `${semCusto} venda(s) sem custo — ${brl(semCustoReceita)} de receita sem margem calculável.`,
        "Cadastre o custo em Produtos / SKUs para liberar os alertas dessas vendas.",
      ].join("\n"),
    });
  }

  if (!toInsert.length) return 0;
  const { data: inserted, error: insErr } = await db
    .from("telegram_alert_log")
    .upsert(toInsert, { onConflict: "owner_id,alert_type,ref_key", ignoreDuplicates: true })
    .select("id");
  if (insErr) throw new Error(`enfileirar alertas: ${insErr.message}`);
  return (inserted ?? []).length;
}

/** Envia o que está pendente respeitando o teto por hora (agrupa se estourar). */
async function flushPending(
  db: SupabaseClient,
  cfg: Config,
): Promise<{ enviados: number; agrupados: number; erros: number }> {
  const chatId = chatOf(cfg);
  if (!chatId) return { enviados: 0, agrupados: 0, erros: 0 };

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: sentLastHour } = await db
    .from("telegram_alert_log")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", cfg.owner_id)
    .eq("status", "enviado")
    .gte("sent_at", hourAgo);

  const budget = Math.max(0, Number(cfg.max_alertas_hora ?? 20) - (sentLastHour ?? 0));
  if (budget <= 0) return { enviados: 0, agrupados: 0, erros: 0 };

  const { data: pend, error } = await db
    .from("telegram_alert_log")
    .select("id, alert_type, message, attempts, payload")
    .eq("owner_id", cfg.owner_id)
    .in("status", ["pendente", "erro"])
    .lt("attempts", 6)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  const rows = (pend ?? []) as Array<{
    id: string;
    alert_type: string;
    message: string | null;
    attempts: number;
    payload: Record<string, unknown> | null;
  }>;
  if (!rows.length) return { enviados: 0, agrupados: 0, erros: 0 };

  let enviados = 0;
  let erros = 0;

  // Estouro do teto: manda um resumo único em vez de dezenas de mensagens.
  if (rows.length > budget) {
    const porTipo = new Map<string, number>();
    for (const r of rows) porTipo.set(r.alert_type, (porTipo.get(r.alert_type) ?? 0) + 1);
    const linhas = [...porTipo.entries()].map(([t, n]) => `• ${labelTipo(t)}: ${n}`);
    const texto = [
      "🧾 <b>Resumo de alertas</b>",
      "",
      `${rows.length} alertas no período (acima do limite de ${cfg.max_alertas_hora}/hora).`,
      ...linhas,
      "",
      "Abra Conciliação e Anúncios para ver o detalhe.",
    ].join("\n");
    try {
      await tgSend(chatId, texto);
      await db
        .from("telegram_alert_log")
        .update({
          status: "enviado",
          sent_at: new Date().toISOString(),
          last_error: "Agrupado no resumo (teto por hora)",
        })
        .in(
          "id",
          rows.map((r) => r.id),
        );
      return { enviados: 1, agrupados: rows.length, erros: 0 };
    } catch (e) {
      await markError(db, rows, (e as Error).message);
      return { enviados: 0, agrupados: 0, erros: rows.length };
    }
  }

  for (const r of rows.slice(0, budget)) {
    try {
      await tgSend(chatId, r.message ?? labelTipo(r.alert_type));
      await db
        .from("telegram_alert_log")
        .update({
          status: "enviado",
          sent_at: new Date().toISOString(),
          attempts: r.attempts + 1,
          last_error: null,
        })
        .eq("id", r.id);
      enviados += 1;
    } catch (e) {
      erros += 1;
      await markError(db, [r], (e as Error).message);
    }
  }
  return { enviados, agrupados: 0, erros };
}

async function markError(
  db: SupabaseClient,
  rows: Array<{ id: string; attempts: number }>,
  msg: string,
): Promise<void> {
  for (const r of rows) {
    await db
      .from("telegram_alert_log")
      .update({ status: "erro", attempts: r.attempts + 1, last_error: msg.slice(0, 300) })
      .eq("id", r.id);
  }
}

function labelTipo(t: string): string {
  if (t === "prejuizo") return "Vendas com prejuízo";
  if (t === "margem_baixa") return "Vendas com margem baixa";
  if (t === "anuncio_negativo") return "Anúncios com MC negativa";
  if (t === "sem_custo_resumo") return "Vendas sem custo cadastrado";
  return t;
}

/** Verificação diária dos anúncios com MC% negativa (uma vez por dia, sem repetir). */
async function queueAdAlerts(db: SupabaseClient, cfg: Config): Promise<number> {
  if (!cfg.alert_anuncio_negativo) return 0;
  const { data, error } = await db.rpc("telegram_ad_candidates", {
    _owner_id: cfg.owner_id,
    _dias: 30,
  });
  if (error) throw new Error(`telegram_ad_candidates: ${error.message}`);
  const rows = (data ?? []) as unknown as AdRow[];

  const { data: states } = await db
    .from("telegram_ad_alert_state")
    .select("account_id, item_id, is_negative")
    .eq("owner_id", cfg.owner_id);
  const prev = new Map<string, boolean>();
  for (const s of (states ?? []) as Array<{
    account_id: string;
    item_id: string;
    is_negative: boolean;
  }>) {
    prev.set(`${s.account_id}|${s.item_id}`, s.is_negative);
  }

  const day = todaySP();
  const toInsert: Array<Record<string, unknown>> = [];
  const upStates: Array<Record<string, unknown>> = [];

  for (const r of rows) {
    if (r.custo_faltando) continue; // sem custo cadastrado não gera alerta
    const key = `${r.account_id}|${r.item_id}`;
    const negativo = Number(r.margem ?? 0) < 0;
    const eraNegativo = prev.get(key) ?? false;
    upStates.push({
      owner_id: cfg.owner_id,
      account_id: r.account_id,
      item_id: r.item_id,
      is_negative: negativo,
      ...(negativo && !eraNegativo ? { last_alert_at: new Date().toISOString() } : {}),
    });
    if (negativo && !eraNegativo) {
      toInsert.push({
        owner_id: cfg.owner_id,
        account_id: r.account_id,
        alert_type: "anuncio_negativo",
        ref_key: `${r.item_id}:${day}`,
        status: "pendente",
        payload: r as unknown as Record<string, unknown>,
        message: adMessage(r),
      });
    }
  }

  if (upStates.length) {
    await db
      .from("telegram_ad_alert_state")
      .upsert(upStates, { onConflict: "owner_id,account_id,item_id" });
  }
  if (!toInsert.length) return 0;
  const { data: inserted, error: insErr } = await db
    .from("telegram_alert_log")
    .upsert(toInsert, { onConflict: "owner_id,alert_type,ref_key", ignoreDuplicates: true })
    .select("id");
  if (insErr) throw new Error(insErr.message);
  return (inserted ?? []).length;
}

export type AlertsRunResult = {
  ok: true;
  mode: "sales" | "daily";
  owners: number;
  enfileirados: number;
  enviados: number;
  agrupados: number;
  erros: number;
  detalhes: string[];
};

export async function runTelegramAlerts(mode: "sales" | "daily" = "sales"): Promise<AlertsRunResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as SupabaseClient;

  const cfgs = await loadConfigs(db);
  let enfileirados = 0;
  let enviados = 0;
  let agrupados = 0;
  let erros = 0;
  const detalhes: string[] = [];

  for (const cfg of cfgs) {
    if (!chatOf(cfg)) {
      detalhes.push(`${cfg.owner_id}: sem chat de destino`);
      continue;
    }
    try {
      enfileirados +=
        mode === "daily" ? await queueAdAlerts(db, cfg) : await queueSaleAlerts(db, cfg);
    } catch (e) {
      detalhes.push(`fila: ${(e as Error).message}`);
    }
    try {
      const f = await flushPending(db, cfg);
      enviados += f.enviados;
      agrupados += f.agrupados;
      erros += f.erros;
    } catch (e) {
      detalhes.push(`envio: ${(e as Error).message}`);
    }
  }

  return { ok: true, mode, owners: cfgs.length, enfileirados, enviados, agrupados, erros, detalhes };
}

/** Mensagem de teste manual, a partir do painel de Configurações. */
export async function sendTelegramTest(ownerId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as SupabaseClient;
  const { data } = await db
    .from("telegram_config")
    .select("owner_id, alert_chat_id, allowed_chat_id")
    .eq("owner_id", ownerId)
    .maybeSingle();
  const chat =
    (data as { alert_chat_id?: string | null; allowed_chat_id?: string | null } | null)
      ?.alert_chat_id ||
    (data as { allowed_chat_id?: string | null } | null)?.allowed_chat_id ||
    null;
  if (!chat) return { ok: false, error: "Configure o chat de destino primeiro." };
  try {
    await tgSend(
      chat,
      "✅ <b>Painel Financeiro</b>\nCanal de alertas configurado corretamente.",
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
