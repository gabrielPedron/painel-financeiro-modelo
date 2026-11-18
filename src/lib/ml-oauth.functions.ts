import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { donoDaEquipe, exigirAdmin, exigirTela } from "./equipe";

const startInput = z.object({ account_id: z.string().uuid() });

export const startMlOauth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => startInput.parse(data))
  .handler(async ({ data, context }) => {
    // Integração do ML: só o administrador conecta, desconecta e cadastra (ticket 08).
    await exigirAdmin(context.supabase);
    const dono = await donoDaEquipe(context.supabase);
    const {
      supabaseAdmin,
      generateState,
      getRedirectUri,
      ML_AUTH_URL,
    } = await import("./ml-oauth.server");

    const { data: account, error } = await supabaseAdmin
      .from("marketplace_accounts")
      .select("id, owner_id, client_id, client_secret_id")
      .eq("id", data.account_id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!account || account.owner_id !== dono) {
      throw new Error("Integração não encontrada.");
    }
    if (!account.client_id || !account.client_secret_id) {
      throw new Error(
        "Cadastre o Client ID e o Client Secret desta integração antes de conectar.",
      );
    }

    const state = generateState();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error: insErr } = await supabaseAdmin.from("oauth_states").insert({
      state,
      account_id: account.id,
      owner_id: dono,
      expires_at: expiresAt,
    });
    if (insErr) throw new Error(insErr.message);

    const redirectUri = getRedirectUri();
    const url = new URL(ML_AUTH_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", account.client_id);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);

    return { url: url.toString() };
  });

export const disconnectMlAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => startInput.parse(data))
  .handler(async ({ data, context }) => {
    // Integração do ML: só o administrador conecta, desconecta e cadastra (ticket 08).
    await exigirAdmin(context.supabase);
    const dono = await donoDaEquipe(context.supabase);
    const { supabaseAdmin } = await import("./ml-oauth.server");
    const { data: account, error } = await supabaseAdmin
      .from("marketplace_accounts")
      .select("id, owner_id")
      .eq("id", data.account_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!account || account.owner_id !== dono) {
      throw new Error("Integração não encontrada.");
    }
    const { error: updErr } = await supabaseAdmin
      .from("marketplace_accounts")
      .update({
        access_token: null,
        refresh_token: null,
        access_token_id: null,
        refresh_token_id: null,
        token_expires_at: null,
        status: "nao_conectada",
      })
      .eq("id", account.id);
    if (updErr) throw new Error(updErr.message);
    return { ok: true };
  });

// Cria ou atualiza uma integração ML. O client_secret vai direto para o Vault
// via saveClientSecret; o cliente NUNCA recebe nem envia o valor pelo Data API.
const saveAccountInput = z.object({
  account_id: z.string().uuid().optional(),
  nickname: z.string().min(1),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

export const saveMlAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => saveAccountInput.parse(d))
  .handler(async ({ data, context }) => {
    // Integração do ML: só o administrador conecta, desconecta e cadastra (ticket 08).
    await exigirAdmin(context.supabase);
    const dono = await donoDaEquipe(context.supabase);
    const { supabaseAdmin, saveClientSecret } = await import("./ml-oauth.server");
    let accountId = data.account_id ?? null;

    if (accountId) {
      const { data: existing, error } = await supabaseAdmin
        .from("marketplace_accounts")
        .select("id, owner_id")
        .eq("id", accountId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!existing || existing.owner_id !== dono) {
        throw new Error("Integração não encontrada.");
      }
      const patch: { nickname: string; client_id?: string } = { nickname: data.nickname };
      if (data.client_id) patch.client_id = data.client_id;
      const { error: updErr } = await supabaseAdmin
        .from("marketplace_accounts")
        .update(patch)
        .eq("id", accountId);
      if (updErr) throw new Error(updErr.message);
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from("marketplace_accounts")
        .insert({
          owner_id: dono,
          nickname: data.nickname,
          client_id: data.client_id || null,
          platform: "mercado_livre",
        })
        .select("id")
        .single();
      if (error || !inserted) throw new Error(error?.message ?? "Falha ao criar integração.");
      accountId = inserted.id;
    }

    if (data.client_secret) {
      await saveClientSecret(accountId, data.client_secret);
    }
    return { account_id: accountId };
  });

const syncInput = z.object({
  account_id: z.string().uuid(),
  days: z.number().int().min(1).max(400).optional(),
});

export const syncMlAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => syncInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("./ml-oauth.server");
    const { data: account, error } = await supabaseAdmin
      .from("marketplace_accounts")
      .select("id, owner_id, status")
      .eq("id", data.account_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!account || account.owner_id !== userId) {
      throw new Error("Integração não encontrada.");
    }
    if (account.status !== "conectada") {
      throw new Error("Conecte a integração antes de sincronizar.");
    }
    const { syncAccount } = await import("./ml-sync.server");
    const result = await syncAccount(account.id, data.days ?? 3);
    return result;
  });

export const reprocessMlAds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => startInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("./ml-oauth.server");
    const { data: account, error } = await supabaseAdmin
      .from("marketplace_accounts")
      .select("id, owner_id")
      .eq("id", data.account_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!account || account.owner_id !== userId) {
      throw new Error("Integração não encontrada.");
    }
    const { reprocessAdsForAccount } = await import("./ml-sync.server");
    const r = await reprocessAdsForAccount(account.id, userId);
    return r;
  });

export const reprocessMlBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => startInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("./ml-oauth.server");
    const { data: account, error } = await supabaseAdmin
      .from("marketplace_accounts")
      .select("id, owner_id, status")
      .eq("id", data.account_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!account || account.owner_id !== userId) {
      throw new Error("Integração não encontrada.");
    }
    if (account.status !== "conectada") {
      throw new Error("Conecte a integração antes de reprocessar.");
    }
    const { reprocessBillingForAccount } = await import("./ml-sync.server");
    return await reprocessBillingForAccount(account.id);
  });

const enqueueAllInput = z.object({
  days: z.number().int().min(1).max(400).optional(),
});

// Enfileira uma sincronização para todas as contas conectadas do usuário.
// Retorna imediatamente — o worker processa em segundo plano.
export const enqueueSyncAllAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => enqueueAllInput.parse(d))
  .handler(async ({ data, context }) => {
    // Contas da equipe; só com a aba Integrações (seg-05).
    await exigirTela(context.supabase, "configuracoes:integracoes");
    const dono = await donoDaEquipe(context.supabase);
    const { supabaseAdmin } = await import("./ml-oauth.server");
    const { syncAccount } = await import("./ml-sync.server");
    const days = data.days ?? 30;
    const { data: rows, error } = await supabaseAdmin
      .from("marketplace_accounts")
      .select("id")
      .eq("owner_id", dono)
      .eq("status", "conectada");
    if (error) throw new Error(error.message);
    let totalEnq = 0;
    const errors: string[] = [];
    for (const acc of rows ?? []) {
      try {
        const r = await syncAccount(acc.id, days);
        totalEnq += r.enqueued.billing + r.enqueued.orders + r.enqueued.ads + r.enqueued.visits;
        if (r.errors.length) errors.push(...r.errors);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    return { accounts: (rows ?? []).length, enqueued: totalEnq, errors };
  });

const forceInput = z.object({
  days: z.number().int().min(1).max(400).optional(),
  account_id: z.string().uuid().optional(),
});

// Limpa dados de Ads/visitas na janela e reenfileira tudo.
// Se account_id vier, aplica só a essa conta; senão, a todas as conectadas do usuário.
export const forceFullReprocess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => forceInput.parse(d))
  .handler(async ({ data, context }) => {
    // Apaga ADS/visitas antes de buscar de novo (sync-04): só com a aba Integrações (seg-05).
    await exigirTela(context.supabase, "configuracoes:integracoes");
    const dono = await donoDaEquipe(context.supabase);
    const { supabaseAdmin } = await import("./ml-oauth.server");
    const { forceFullReprocessForAccount } = await import("./ml-sync.server");
    const days = data.days ?? 90;
    let query = supabaseAdmin
      .from("marketplace_accounts")
      .select("id, owner_id, status")
      .eq("owner_id", dono)
      .eq("status", "conectada");
    if (data.account_id) query = query.eq("id", data.account_id);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    let totalEnq = 0;
    const errors: string[] = [];
    for (const acc of rows ?? []) {
      try {
        const r = await forceFullReprocessForAccount(acc.id, days);
        totalEnq += r.enqueued.billing + r.enqueued.orders + r.enqueued.ads + r.enqueued.visits;
        if (r.errors.length) errors.push(...r.errors);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    return { accounts: (rows ?? []).length, enqueued: totalEnq, errors };
  });