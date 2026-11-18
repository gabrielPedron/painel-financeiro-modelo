// Server-only helpers for the Mercado Livre OAuth flow.
// Uses the admin client (service role) since credential/token columns bypass RLS by design.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEFAULT_APP_BASE_URL } from "@/lib/app-url";

export const ML_AUTH_URL = "https://auth.mercadolivre.com.br/authorization";
export const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
export const ML_USERS_ME_URL = "https://api.mercadolibre.com/users/me";
export const ML_ADVERTISERS_URL =
  "https://api.mercadolibre.com/advertising/advertisers?product_id=PADS";

export function getAppBaseUrl(): string {
  const base =
    process.env.APP_BASE_URL ||
    process.env.VITE_APP_BASE_URL ||
    DEFAULT_APP_BASE_URL;
  if (!base) throw new Error("APP_BASE_URL não configurada: preencha nas vars do wrangler.jsonc e publique de novo.");
  return base.replace(/\/+$/, "");
}

export function getRedirectUri(): string {
  return `${getAppBaseUrl()}/api/ml/callback`;
}

export function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return `${crypto.randomUUID()}.${s}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  user_id: number;
};

async function postForm(url: string, body: Record<string, string>): Promise<Response> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) params.set(k, v);
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: params.toString(),
  });
}

export async function exchangeCodeForToken(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const res = await postForm(ML_TOKEN_URL, {
    grant_type: "authorization_code",
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code: args.code,
    redirect_uri: args.redirectUri,
  });
  const json = (await res.json()) as TokenResponse & { error?: string; message?: string };
  if (!res.ok) {
    throw new Error(
      `ML token exchange failed (${res.status}): ${json.error ?? json.message ?? "erro desconhecido"}`,
    );
  }
  return json;
}

export async function refreshAccessToken(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  const res = await postForm(ML_TOKEN_URL, {
    grant_type: "refresh_token",
    client_id: args.clientId,
    client_secret: args.clientSecret,
    refresh_token: args.refreshToken,
  });
  const json = (await res.json()) as TokenResponse & { error?: string; message?: string };
  if (!res.ok) {
    const err = new Error(
      `ML token refresh failed (${res.status}): ${json.error ?? json.message ?? "erro"}`,
    ) as Error & { code?: string };
    err.code = json.error;
    throw err;
  }
  return json;
}

export async function fetchNickname(accessToken: string): Promise<string | null> {
  const res = await fetch(ML_USERS_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { nickname?: string };
  return json.nickname ?? null;
}

export async function fetchAdvertiserId(accessToken: string, siteId: string): Promise<number | null> {
  try {
    const res = await fetch(ML_ADVERTISERS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "api-version": "2",
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { advertisers?: Array<{ advertiser_id: number; site_id: string }> };
    const list = json.advertisers ?? [];
    const match = list.find((a) => a.site_id === siteId) ?? list[0];
    return match?.advertiser_id ?? null;
  } catch {
    return null;
  }
}

export async function logSync(args: {
  accountId: string | null;
  syncType: string;
  status: "sucesso" | "erro" | "parcial" | "executando";
  recordsProcessed?: number;
  errorMessage?: string | null;
  details?: Record<string, unknown> | null;
}): Promise<void> {
  // O erro não interrompe a sincronização, mas não pode sumir: vai para o log do Worker (sync-10).
  const { error } = await supabaseAdmin.from("sync_logs").insert({
    account_id: args.accountId,
    sync_type: args.syncType,
    status: args.status,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    records_processed: args.recordsProcessed ?? 0,
    error_message: args.errorMessage ?? null,
    details: (args.details ?? null) as never,
  });
  if (error) console.error(`sync_logs (${args.syncType}) não gravou:`, error.message);
}

export { supabaseAdmin };

// ---------------------------------------------------------------------------
// Vault-backed credential storage
// ---------------------------------------------------------------------------
// Marketplace credentials (client_secret, access_token, refresh_token) live in
// Supabase Vault. The marketplace_accounts row stores only the vault UUID in
// client_secret_id / access_token_id / refresh_token_id. These helpers wrap the
// SECURITY DEFINER functions vault_set_secret / vault_get_secret (service_role
// only) so server code never touches raw vault schemas.

export async function readVaultSecret(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const { data, error } = await supabaseAdmin.rpc("vault_get_secret", { _id: id });
  if (error) throw new Error(`Vault read failed: ${error.message}`);
  return (data as string | null) ?? null;
}

async function assertVaultSecret(id: string, expected: string, label: string): Promise<void> {
  const saved = await readVaultSecret(id);
  if (saved !== expected) {
    throw new Error(`Vault write verification failed: ${label}`);
  }
}

export async function writeVaultSecret(
  name: string,
  value: string,
  existingId: string | null | undefined,
): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc("vault_set_secret", {
    _name: name,
    _secret: value,
    _existing_id: existingId ?? undefined,
  });
  if (error || !data) {
    throw new Error(`Vault write failed: ${error?.message ?? "sem id"}`);
  }
  return data as string;
}

// Persist the refreshed OAuth tokens: write to vault, store ids, clear legacy
// plaintext columns, update expiry and status in a single row update.
export async function saveAccountTokens(
  accountId: string,
  token: { access_token: string; refresh_token: string; expires_in: number },
): Promise<string> {
  const { data: acc, error: loadError } = await supabaseAdmin
    .from("marketplace_accounts")
    .select("access_token_id, refresh_token_id")
    .eq("id", accountId)
    .maybeSingle();
  if (loadError) throw new Error(`Token account lookup failed: ${loadError.message}`);
  if (!acc) throw new Error("Token account lookup failed: conta não encontrada");

  const atId = await writeVaultSecret(
    `ml_${accountId}_access_token`,
    token.access_token,
    acc?.access_token_id ?? null,
  );
  const rtId = await writeVaultSecret(
    `ml_${accountId}_refresh_token`,
    token.refresh_token,
    acc?.refresh_token_id ?? null,
  );
  await Promise.all([
    assertVaultSecret(atId, token.access_token, "access_token"),
    assertVaultSecret(rtId, token.refresh_token, "refresh_token"),
  ]);

  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
  const { error: updateError } = await supabaseAdmin
    .from("marketplace_accounts")
    .update({
      access_token: null,
      refresh_token: null,
      access_token_id: atId,
      refresh_token_id: rtId,
      token_expires_at: expiresAt,
      status: "conectada",
    })
    .eq("id", accountId);
  if (updateError) throw new Error(`Token row update failed: ${updateError.message}`);

  const { data: verified, error: verifyError } = await supabaseAdmin
    .from("marketplace_accounts")
    .select("access_token, refresh_token, access_token_id, refresh_token_id")
    .eq("id", accountId)
    .maybeSingle();
  if (verifyError) throw new Error(`Token row verification failed: ${verifyError.message}`);
  if (!verified || verified.access_token || verified.refresh_token || verified.access_token_id !== atId || verified.refresh_token_id !== rtId) {
    throw new Error("Token row verification failed: legacy token columns were not cleared");
  }

  return expiresAt;
}

// Store or rotate the client_secret in the Vault. Also wipes the legacy
// plaintext column so credentials never leak through the Data API.
export async function saveClientSecret(accountId: string, clientSecret: string): Promise<string> {
  const { data: acc, error: loadError } = await supabaseAdmin
    .from("marketplace_accounts")
    .select("client_secret_id")
    .eq("id", accountId)
    .maybeSingle();
  if (loadError) throw new Error(`Client secret lookup failed: ${loadError.message}`);
  if (!acc) throw new Error("Client secret lookup failed: conta não encontrada");
  const id = await writeVaultSecret(
    `ml_${accountId}_client_secret`,
    clientSecret,
    acc?.client_secret_id ?? null,
  );
  await assertVaultSecret(id, clientSecret, "client_secret");

  const { error: updateError } = await supabaseAdmin
    .from("marketplace_accounts")
    .update({ client_secret: null, client_secret_id: id })
    .eq("id", accountId);
  if (updateError) throw new Error(`Client secret row update failed: ${updateError.message}`);
  return id;
}