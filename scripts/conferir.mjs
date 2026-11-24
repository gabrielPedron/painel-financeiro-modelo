// Confere a instalação de ponta a ponta e diz o que falta. Só lê: não grava nada e não mostra segredo.
//
//   node scripts/conferir.mjs
//
// Lê SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY do .env, APP_BASE_URL do wrangler.jsonc e
// SUPABASE_SERVICE_ROLE_KEY do .env.local.
import { existsSync, readFileSync } from "node:fs";

function lerEnv(arquivo) {
  if (!existsSync(arquivo)) return {};
  const saida = {};
  for (const linha of readFileSync(arquivo, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_0-9]+)\s*=\s*(.*?)\s*$/.exec(linha);
    if (m) saida[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return saida;
}

const publico = lerEnv(".env");
const chave = lerEnv(".env.local").SUPABASE_SERVICE_ROLE_KEY ?? "";
const url = publico.SUPABASE_URL ?? "";
const publicavel = publico.SUPABASE_PUBLISHABLE_KEY ?? "";
const wrangler = existsSync("wrangler.jsonc") ? readFileSync("wrangler.jsonc", "utf8") : "";
const app = (/"APP_BASE_URL"\s*:\s*"([^"]*)"/.exec(wrangler)?.[1] ?? "").replace(/\/+$/, "");

let problemas = 0;
const ok = (texto) => console.log(`ok     ${texto}`);
const falta = (texto) => { problemas++; console.log(`FALTA  ${texto}`); };
const info = (texto) => console.log(`       ${texto}`);
const esconder = (texto) => (chave.length >= 8 ? String(texto).split(chave).join("***") : String(texto));

async function pedir(caminho, opcoes = {}) {
  return fetch(caminho, { ...opcoes, signal: AbortSignal.timeout(20000) }).catch((e) => ({ ok: false, status: 0, erro: e }));
}

// 1. App
if (!app) falta("APP_BASE_URL vazio no wrangler.jsonc (rodada 1 do INSTALAR.md)");
else {
  const login = await pedir(`${app}/login`);
  login.status === 200 ? ok(`app no ar: ${app}`) : falta(`o app não abriu ${app}/login (HTTP ${login.status})`);
  const gancho = await pedir(`${app}/api/public/hooks/ml-worker`, { method: "POST" });
  gancho.status === 401 ? ok("agendador recusa quem chega sem o segredo (401)") : falta(`o gancho do agendador respondeu ${gancho.status}, esperado 401 (rode scripts/configurar.mjs)`);
}

// 2. Supabase
if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(url) || publicavel.endsWith("...")) {
  falta("SUPABASE_URL ou SUPABASE_PUBLISHABLE_KEY sem preencher no .env");
  process.exit(1);
}
const ajustes = await pedir(`${url}/auth/v1/settings`, { headers: { apikey: publicavel } });
const auth = ajustes.ok ? await ajustes.json().catch(() => null) : null;
if (!auth) falta(`não li os ajustes de login do Supabase (HTTP ${ajustes.status}); confira a chave publicável no .env`);
else auth.disable_signup === true ? ok("cadastro público desligado") : falta("cadastro público LIGADO: Authentication > Sign In / Providers > Allow new users to sign up");

if (!chave) {
  falta("SUPABASE_SERVICE_ROLE_KEY vazio no .env.local: sem ele não dá para conferir o banco");
  process.exit(1);
}
const cabecalho = { apikey: chave, Authorization: `Bearer ${chave}` };

async function contar(tabela, filtro = "") {
  const r = await pedir(`${url}/rest/v1/${tabela}?select=*${filtro}`, { method: "HEAD", headers: { ...cabecalho, Prefer: "count=exact", Range: "0-0" } });
  if (!r.ok && r.status !== 206) return null;
  return Number(r.headers.get("content-range")?.split("/")[1] ?? NaN);
}
async function ler(tabela, consulta) {
  const r = await pedir(`${url}/rest/v1/${tabela}?${consulta}`, { headers: cabecalho });
  return r.ok ? r.json() : null;
}

const regras = await contar("billing_subtype_map");
if (regras === null) {
  falta("o banco não respondeu: confira a chave secreta no .env.local e se o banco subiu (node scripts/subir-banco.mjs)");
  process.exit(1);
}
regras > 0 ? ok(`banco instalado (${regras} regras de cobrança do Mercado Livre)`) : falta("banco sem as regras de cobrança: rode node scripts/subir-banco.mjs");

const dono = await ler("account_members", "select=member_id&limit=1");
dono?.length ? ok("dono da equipe definido") : falta("sem dono da equipe: rode node scripts/configurar.mjs");

// 3. Mercado Livre
const contas = (await ler("marketplace_accounts", "select=nickname,external_nickname,status,last_sync_at,last_sync_status&platform=eq.mercado_livre")) ?? [];
if (!contas.length) {
  falta("nenhuma conta do Mercado Livre cadastrada: Configurações > Integrações > Adicionar integração");
} else {
  for (const c of contas) {
    const nome = c.external_nickname || c.nickname;
    c.status === "conectada" ? ok(`Mercado Livre conectado: ${nome}`) : falta(`conta ${nome} está "${c.status}": conecte de novo em Configurações > Integrações`);
    if (c.last_sync_at) info(`última sincronização: ${new Date(c.last_sync_at).toLocaleString("pt-BR")} (${c.last_sync_status ?? "sem status"})`);
  }
  const fila = (await ler("sync_jobs", "select=status,last_error&order=created_at.desc&limit=5000")) ?? [];
  const porStatus = {};
  for (const j of fila) porStatus[j.status] = (porStatus[j.status] ?? 0) + 1;
  info(`fila de sincronização: ${Object.entries(porStatus).map(([s, n]) => `${n} ${s}`).join(", ") || "vazia"}`);
  const erros = [...new Set(fila.filter((j) => j.last_error).map((j) => esconder(j.last_error).slice(0, 140)))].slice(0, 3);
  for (const e of erros) info(`erro recente: ${e}`);
  for (const [tabela, nome] of [["ml_orders", "pedidos"], ["mp_payments", "pagamentos do Mercado Pago"], ["ml_billing_details", "cobranças do faturamento"], ["ml_ads_daily", "dias de publicidade"], ["ml_items", "anúncios"]]) {
    info(`${nome}: ${(await contar(tabela)) ?? "?"}`);
  }
  const pedidos = await contar("ml_orders");
  const pagamentos = await contar("mp_payments");
  if (pedidos > 0 && pagamentos === 0 && !porStatus.pendente) falta("os pedidos chegaram e os pagamentos não: avise o mentor (última linha de Se travar, no INSTALAR.md)");
}

console.log(problemas ? `\n${problemas} ponto(s) para resolver.` : "\nTudo certo.");
process.exit(problemas ? 1 : 0);
