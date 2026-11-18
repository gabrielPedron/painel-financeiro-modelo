// URL pública deste app. Usada para montar o endereço de retorno do Mercado Livre
// (redirect_uri) e qualquer link absoluto.
// No servidor vem de APP_BASE_URL (vars do wrangler.jsonc). No navegador, de
// VITE_APP_BASE_URL (.env) ou, na falta dela, do endereço em que o app está aberto.
export const DEFAULT_APP_BASE_URL = "";

/** Base URL para uso no navegador. */
export function appBaseUrl(): string {
  const fromEnv = import.meta.env['VITE_APP_BASE_URL'] as string | undefined;
  const daJanela = typeof window !== "undefined" ? window.location.origin : "";
  return (fromEnv || daJanela || DEFAULT_APP_BASE_URL).replace(/\/+$/, "");
}
