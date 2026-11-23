// Cópia dos dados do banco numa pasta deste computador. Rode antes de qualquer mudança no banco:
// o plano gratuito do Supabase não guarda cópia nenhuma.
//
//   node scripts/copia-banco.mjs
//
// Salva uma pasta por cópia em Documentos/Backups/painel-financeiro (ou em BACKUP_DIR), com um
// arquivo .json por tabela e um resumo.json com a contagem de linhas. Precisa só do Node: lê
// SUPABASE_URL do .env e SUPABASE_SERVICE_ROLE_KEY do .env.local.
//
// O que NÃO vai na cópia:
//   - a estrutura do banco: ela está nas migrações (supabase/migrations), que vão para o Git;
//   - os usuários do login e os tokens do Mercado Livre (ficam em áreas protegidas do Supabase):
//     depois de restaurar, recrie os usuários e conecte a conta do Mercado Livre de novo.
//
// Para voltar uma tabela, peça à IA: "restaure a tabela X a partir de <pasta>/X.json", com upsert
// pela chave primária, depois de mostrar quantas linhas vão mudar.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const POR_PAGINA = 1000;

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

const url = lerEnv(".env").SUPABASE_URL;
const chave = lerEnv(".env.local").SUPABASE_SERVICE_ROLE_KEY;
if (!url || /SEU_PROJECT_REF/.test(url)) parar("preencha SUPABASE_URL no .env.");
if (!chave) parar("preencha SUPABASE_SERVICE_ROLE_KEY no .env.local.");

const cabecalhos = { apikey: chave, Accept: "application/json" };
const pedir = async (caminho, extra = {}) => {
  const r = await fetch(`${url}/rest/v1/${caminho}`, { headers: { ...cabecalhos, ...extra } });
  if (!r.ok) throw new Error(`${caminho.split("?")[0] || "catálogo"}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r;
};

// O catálogo da API (OpenAPI) lista as tabelas e diz qual coluna é a chave primária.
let catalogo;
try { catalogo = await (await pedir("", { Accept: "application/openapi+json" })).json(); }
catch (e) { parar(`não consegui ler o catálogo do banco (${e.message}). Confira a chave do .env.local.`); }
const tabelas = Object.entries(catalogo.definitions ?? {})
  .map(([nome, def]) => {
    const chavePrimaria = Object.entries(def.properties ?? {}).find(([, p]) => /<pk\/>/.test(p.description ?? ""))?.[0];
    return { nome, chavePrimaria };
  })
  .sort((a, b) => a.nome.localeCompare(b.nome));
if (!tabelas.length) parar("o catálogo veio sem tabelas. O banco foi instalado (supabase db push)?");

const ref = new URL(url).hostname.split(".")[0];
const agora = new Date();
const carimbo = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}_${String(agora.getHours()).padStart(2, "0")}${String(agora.getMinutes()).padStart(2, "0")}`;
const destino = join(process.env.BACKUP_DIR || join(homedir(), "Documents", "Backups", "painel-financeiro"), `${ref}-${carimbo}`);
mkdirSync(destino, { recursive: true });

const resumo = { projeto: ref, feita_em: agora.toISOString(), tabelas: {} };
let falhas = 0;
for (const { nome, chavePrimaria } of tabelas) {
  try {
    const linhas = [];
    // Ordem fixa pela chave primária: sem ela, páginas seguidas podem repetir ou pular linhas.
    const ordem = chavePrimaria ? `&order=${encodeURIComponent(chavePrimaria)}.asc` : "";
    for (let inicio = 0; ; inicio += POR_PAGINA) {
      const r = await pedir(`${encodeURIComponent(nome)}?select=*${ordem}`, { Range: `${inicio}-${inicio + POR_PAGINA - 1}`, "Range-Unit": "items" });
      const pagina = await r.json();
      linhas.push(...pagina);
      if (pagina.length < POR_PAGINA) break;
    }
    writeFileSync(join(destino, `${nome}.json`), JSON.stringify(linhas));
    resumo.tabelas[nome] = linhas.length;
  } catch (e) {
    falhas++;
    resumo.tabelas[nome] = `ERRO: ${e.message}`;
  }
}
writeFileSync(join(destino, "resumo.json"), JSON.stringify(resumo, null, 2));

const total = Object.values(resumo.tabelas).filter((n) => typeof n === "number").reduce((a, b) => a + b, 0);
console.log(`Cópia salva em ${destino}`);
console.log(`  ${tabelas.length - falhas} tabelas, ${total} linhas${falhas ? `; ${falhas} tabela(s) com erro (ver resumo.json)` : ""}`);
process.exit(falhas ? 1 : 0);
