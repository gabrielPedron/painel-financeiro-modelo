// Sobe as migrações (supabase/migrations) para o banco do Supabase. Roda pela IA: o dono não abre
// terminal, não faz login da ferramenta do Supabase e não faz `link`. Basta a senha do banco.
//
//   node scripts/subir-banco.mjs            mostra o que seria aplicado (não grava nada)
//   node scripts/subir-banco.mjs --aplicar  aplica; só depois de mostrar o resultado acima ao dono
//
// Lê SUPABASE_URL do .env e SUPABASE_DB_PASSWORD do .env.local. Tenta a conexão direta e, se a rede
// não tiver IPv6, o pooler de São Paulo. Se nada conectar, aceita SUPABASE_DB_URL no .env.local:
// painel do Supabase > Connect > Session pooler, com a senha no lugar de [YOUR-PASSWORD].
//
// A ferramenta do Supabase fica na versão testada. Troque só junto com um ensaio novo.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const VERSAO_SUPABASE = "3.2.0";
const aplicar = process.argv.includes("--aplicar");

function lerEnv(arquivo) {
  if (!existsSync(arquivo)) return {};
  const saida = {};
  for (const linha of readFileSync(arquivo, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_0-9]+)\s*=\s*(.*?)\s*$/.exec(linha);
    if (m) saida[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return saida;
}

function parar(mensagem) {
  console.error(`\nPAROU: ${mensagem}`);
  process.exit(1);
}

const publico = lerEnv(".env");
const privado = lerEnv(".env.local");
const url = publico.SUPABASE_URL ?? "";
const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(url)?.[1];
const senha = privado.SUPABASE_DB_PASSWORD ?? "";
const urlManual = privado.SUPABASE_DB_URL ?? "";
if (!ref) parar("preencha SUPABASE_URL no .env (https://SEU_PROJECT_REF.supabase.co).");
if (!senha && !urlManual) parar("preencha SUPABASE_DB_PASSWORD no .env.local com a senha do banco (a que o painel gerou ao criar o projeto).");
if (!existsSync("supabase/migrations")) parar("rode este comando na pasta do sistema (onde fica a pasta supabase/migrations).");

// Nada que passe pela tela pode mostrar a senha.
const segredos = [senha, encodeURIComponent(senha), urlManual].filter((s) => s.length >= 4);
const mascarar = (texto) => segredos.reduce((t, s) => t.split(s).join("***"), texto);

// A ferramenta roda pelo npx do próprio Node, sem passar pelo PowerShell nem pelo cmd.
function acharNpx() {
  const pasta = dirname(process.execPath);
  for (const c of [join(pasta, "node_modules", "npm", "bin", "npx-cli.js"), join(pasta, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js")]) {
    if (existsSync(c)) return c;
  }
  parar("não achei o npx que vem com o Node. Reinstale o Node 24 e tente de novo.");
}
const npx = acharNpx();

function ferramenta(args) {
  const r = spawnSync(process.execPath, [npx, "--yes", `supabase@${VERSAO_SUPABASE}`, ...args], {
    encoding: "utf8",
    input: "",
    timeout: 300000,
  });
  const saida = mascarar(`${r.stdout ?? ""}${r.stderr ?? ""}`);
  // A ferramenta termina com uma linha JSON: o resultado ou o erro.
  const json = saida.split(/\r?\n/).filter((l) => l.startsWith("{")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).pop();
  return { saida, json };
}

const e = encodeURIComponent(senha);
const caminhos = urlManual
  ? [{ nome: "endereço do .env.local", url: urlManual }]
  : [
      { nome: "conexão direta", url: `postgresql://postgres:${e}@db.${ref}.supabase.co:5432/postgres` },
      { nome: "pooler de São Paulo (aws-0)", url: `postgresql://postgres.${ref}:${e}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres` },
      { nome: "pooler de São Paulo (aws-1)", url: `postgresql://postgres.${ref}:${e}@aws-1-sa-east-1.pooler.supabase.com:5432/postgres` },
    ];

let escolhido = null;
let simulacao = null;
const tentativas = [];
for (const c of caminhos) {
  const r = ferramenta(["db", "push", "--dry-run", `--remote=${c.url}`]);
  if (r.json && r.json._tag !== "Error" && (Array.isArray(r.json.migrations) || r.json.upToDate === true)) {
    escolhido = c;
    simulacao = r.json;
    break;
  }
  const motivo = r.json?.error?.message ?? r.saida.trim().split(/\r?\n/).pop() ?? "sem resposta";
  if (/password authentication failed/i.test(motivo)) {
    parar("a senha do banco não confere. Confira SUPABASE_DB_PASSWORD no .env.local; se perdeu, gere outra em Project Settings > Database > Reset database password.");
  }
  tentativas.push(`${c.nome}: ${motivo.slice(0, 160)}`);
}
if (!escolhido) {
  parar(`não consegui falar com o banco.\n  ${tentativas.join("\n  ")}\n` +
    "Copie o endereço em Connect > Session pooler, no painel do Supabase, troque [YOUR-PASSWORD] pela senha e cole no .env.local como SUPABASE_DB_URL=...");
}

const pendentes = simulacao.migrations ?? [];
console.log(`Banco: ${ref} (${escolhido.nome})`);
if (!pendentes.length) {
  console.log("O banco já está em dia: nenhuma migração para aplicar.");
  process.exit(0);
}
if (!aplicar) {
  console.log(`Migrações que seriam aplicadas (nada foi gravado):\n${pendentes.map((m) => `  - ${m}`).join("\n")}`);
  console.log("\nMostre esta lista ao dono. Com o sim dele: node scripts/subir-banco.mjs --aplicar");
  process.exit(0);
}

// A ferramenta só grava num banco hospedado com --yes quando quem roda é uma IA.
const r = ferramenta(["db", "push", "--yes", `--remote=${escolhido.url}`]);
if (!r.json || r.json._tag === "Error") parar(`a aplicação falhou: ${r.json?.error?.message ?? r.saida.trim().slice(-300)}`);
const depois = ferramenta(["db", "push", "--dry-run", `--remote=${escolhido.url}`]);
if (depois.json?.migrations?.length) parar(`aplicou, mas ainda faltam: ${depois.json.migrations.join(", ")}`);
console.log(`Aplicadas:\n${pendentes.map((m) => `  - ${m}`).join("\n")}\nO banco está em dia.`);
