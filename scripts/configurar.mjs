// Liga o banco ao app depois da primeira publicação. Não mostra nenhum segredo na tela.
//
//   node scripts/configurar.mjs --endereco https://SEU-APP.SUA-CONTA.workers.dev --dono voce@email.com --nome "Seu Nome"
//
// O que faz, nesta ordem (pode rodar de novo quantas vezes precisar):
//   1. grava a chave secreta do Supabase no Worker        (wrangler secret put SUPABASE_SERVICE_ROLE_KEY)
//   2. sorteia o segredo do agendador e grava nos dois lados (cofre do Supabase + Worker)
//   3. transforma o usuário --dono em dono da equipe       (só enquanto não existe dono)
// Antes de gravar qualquer coisa, confere se o cadastro público do Supabase está desligado.
//
// Lê SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY do .env e SUPABASE_SERVICE_ROLE_KEY do .env.local
// (arquivo que só você preenche).
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function parar(mensagem) {
  console.error(`\nPAROU: ${mensagem}`);
  process.exit(1);
}

function gravarSegredoNoWorker(nome, valor) {
  // O valor entra pela entrada padrão: não aparece na linha de comando nem na tela.
  // Comando numa linha só (o nome é fixo, vem deste arquivo): com shell e lista de argumentos o Node avisa DEP0190.
  const r = spawnSync(`npx wrangler secret put ${nome}`, { input: valor, shell: true, encoding: "utf8" });
  if (r.status !== 0) {
    const erro = `${r.stderr ?? ""}${r.stdout ?? ""}`.split(valor).join("***").trim().split("\n").slice(-6).join("\n");
    parar(`não gravei ${nome} no Worker. Rode "npx wrangler login" e publique o app uma vez antes.\n${erro}`);
  }
  console.log(`ok  ${nome} gravado no Worker`);
}

const publico = lerEnv(".env");
const privado = lerEnv(".env.local");
const url = publico.SUPABASE_URL;
const publicavel = publico.SUPABASE_PUBLISHABLE_KEY;
const chave = privado.SUPABASE_SERVICE_ROLE_KEY;
const endereco = (argumento("endereco") ?? "").replace(/\/+$/, "");
const dono = argumento("dono");
const nome = argumento("nome");

if (!url || /SEU_PROJECT_REF/.test(url)) parar("preencha SUPABASE_URL no .env (copie de .env.example).");
if (!publicavel || publicavel.endsWith("...")) parar("preencha SUPABASE_PUBLISHABLE_KEY no .env (copie de .env.example).");
if (!chave) parar("preencha SUPABASE_SERVICE_ROLE_KEY no .env.local (copie de .env.local.example). Só você vê esse arquivo.");
if (!/^https:\/\/[^/]+$/.test(endereco)) parar("informe --endereco https://... (o endereço que a publicação mostrou, sem barra no final).");
if (!dono) parar("informe --dono com o e-mail do usuário criado em Authentication > Add user.");

const supabase = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });

// Prova que a chave e o banco respondem antes de mexer em qualquer coisa.
const { error: erroBanco } = await supabase.from("billing_subtype_map").select("sub_type", { count: "exact", head: true });
if (erroBanco) parar(`o banco não respondeu (${erroBanco.message}). Confira a chave e se "npx supabase@3.2.0 db push --remote" já rodou.`);

// Projeto novo do Supabase nasce com o cadastro aberto: qualquer pessoa com a chave pública (que está
// no navegador) criaria conta e gravaria dados e arquivos. O sistema é fechado; o dono cria usuários
// em Configurações > Usuários.
const respostaAuth = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publicavel } }).catch(() => null);
const ajustesAuth = respostaAuth?.ok ? await respostaAuth.json().catch(() => null) : null;
if (!ajustesAuth) parar(`não consegui ler os ajustes de login do Supabase (HTTP ${respostaAuth?.status ?? "sem resposta"}). Confira SUPABASE_PUBLISHABLE_KEY no .env.`);
if (ajustesAuth.disable_signup !== true) {
  parar("o cadastro público do Supabase está LIGADO: qualquer pessoa poderia criar conta no seu sistema.\n" +
    "No painel do Supabase, em Authentication > Sign In / Providers, desligue 'Allow new users to sign up', salve e rode este comando de novo.");
}
console.log("ok  cadastro público desligado no Supabase");

gravarSegredoNoWorker("SUPABASE_SERVICE_ROLE_KEY", chave);

const segredo = randomBytes(32).toString("hex");
const { error: erroCofre } = await supabase.rpc("configurar_agendador", { _endereco_app: endereco, _segredo: segredo });
if (erroCofre) parar(`não gravei o endereço e o segredo no cofre: ${erroCofre.message}`);
console.log("ok  endereço do app e segredo do agendador gravados no cofre do Supabase");
gravarSegredoNoWorker("ML_CRON_SECRET", segredo);

const { data: idDono, error: erroDono } = await supabase.rpc("definir_primeiro_dono", { _email: dono, _nome: nome ?? null });
if (erroDono) parar(erroDono.message);
console.log(`ok  ${dono} é o dono da equipe (${String(idDono).slice(0, 8)}…)`);

console.log(`\nPronto. Abra ${endereco}/login e entre com ${dono}.`);
console.log(`Endereço de retorno para cadastrar no Mercado Livre: ${endereco}/api/ml/callback`);
