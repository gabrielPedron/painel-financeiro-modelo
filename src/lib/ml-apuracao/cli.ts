// CLI de apuração e auditoria do Mercado Livre.
//
// Roda em qualquer lugar, sem projeto, sem instalar nada:
//
//   bun run cli.ts /users/{conta}
//   bun run cli.ts /users/{conta} --termo reputação
//   bun run cli.ts "/orders/search?seller={conta}&limit=5" --valor 23 --coletas 5
//   bun run cli.ts --recursos          lista os atalhos conhecidos
//   bun run cli.ts --glossario reputação   consulta sem gastar chamada
//
// O token sai de ML_ACCESS_TOKEN (ambiente, .env.local ou .env do diretório
// atual). O `{conta}` é resolvido sozinho por /users/me — não precisa informar.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  apurarRecursoMl,
  descobrirConta,
  mascarar,
  mascararCaminho,
  validarCaminhoMl,
  type ResultadoApuracaoMl,
} from "./apurador.ts";
import { GLOSSARIO_ML, RECURSOS_ML, procurarTermo } from "./glossario.ts";

// ------------------------------------------------------------------ token

const ARQUIVOS_DE_AMBIENTE = [".env.local", ".env", ".env.development.local"];
const NOMES_DE_TOKEN = ["ML_ACCESS_TOKEN", "MERCADOLIVRE_ACCESS_TOKEN", "ML_TOKEN"];

function lerArquivoDeAmbiente(caminho: string): Record<string, string> {
  const valores: Record<string, string> = {};
  try {
    for (const linha of readFileSync(caminho, "utf8").split("\n")) {
      const limpa = linha.trim();
      if (!limpa || limpa.startsWith("#")) continue;
      const igual = limpa.indexOf("=");
      if (igual === -1) continue;
      const chave = limpa.slice(0, igual).trim();
      // Tira aspas que às vezes vêm coladas no valor.
      valores[chave] = limpa
        .slice(igual + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  } catch {
    // Arquivo não existe — normal.
  }
  return valores;
}

function acharToken(): { token: string; origem: string } | null {
  // O Bun já carrega .env/.env.local sozinho no process.env, então este laço
  // pega os dois casos. Por isso a origem não afirma de qual arquivo veio.
  for (const nome of NOMES_DE_TOKEN) {
    const valor = process.env[nome];
    if (valor) return { token: valor, origem: `${nome} (ambiente ou .env carregado)` };
  }
  for (const arquivo of ARQUIVOS_DE_AMBIENTE) {
    const valores = lerArquivoDeAmbiente(resolve(process.cwd(), arquivo));
    for (const nome of NOMES_DE_TOKEN) {
      if (valores[nome]) return { token: valores[nome], origem: `${arquivo} (${nome})` };
    }
  }
  return null;
}

// --------------------------------------------------------------- argumentos

export type Argumentos = {
  caminho: string | null;
  termo: string;
  valor: string;
  coletas: number;
  json: boolean;
  listarRecursos: boolean;
  consultaGlossario: string;
  ajuda: boolean;
};

/**
 * O Git Bash no Windows converte um argumento que começa com barra em caminho
 * do sistema (`/users/me` vira `C:/Program Files/Git/users/me`), mas só quando
 * não há `?` no argumento — o que faz o mesmo comando funcionar ou falhar
 * dependendo da query string. Desfazemos isso aqui.
 */
export function normalizarCaminho(bruto: string): string {
  const semPrefixoMsys = bruto.replace(/^[A-Za-z]:[\\/].*?[\\/]Git[\\/]/, "/");
  return semPrefixoMsys.replace(/\\/g, "/");
}

export function lerArgumentos(argv: string[]): Argumentos {
  const args: Argumentos = {
    caminho: null,
    termo: "",
    valor: "",
    coletas: 3,
    json: false,
    listarRecursos: false,
    consultaGlossario: "",
    ajuda: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--termo" || a === "-t") args.termo = argv[++i] ?? "";
    else if (a === "--valor" || a === "-v") args.valor = argv[++i] ?? "";
    else if (a === "--coletas" || a === "-n") args.coletas = Number(argv[++i]) || 3;
    else if (a === "--json") args.json = true;
    else if (a === "--recursos") args.listarRecursos = true;
    else if (a === "--glossario") args.consultaGlossario = argv[++i] ?? "";
    else if (a === "--ajuda" || a === "-h" || a === "--help") args.ajuda = true;
    else if (!a.startsWith("-") && args.caminho === null) args.caminho = normalizarCaminho(a);
  }
  return args;
}

// ------------------------------------------------------------------ saída

const AJUDA = `
Apuração e auditoria da API do Mercado Livre

  bun run cli.ts <caminho> [opções]

  <caminho>              caminho da API. {conta} é resolvido sozinho.
  --termo, -t <texto>    procura o campo que fala disso (em português)
  --valor, -v <valor>    procura de qual campo veio esse valor
  --coletas, -n <n>      quantas leituras para a moda (padrão 3, máximo 5)
  --json                 devolve o resultado cru, para encadear
  --recursos             lista os atalhos conhecidos e sai
  --glossario <termo>    consulta o glossário sem gastar chamada
  --ajuda                esta ajuda

Token: ML_ACCESS_TOKEN no ambiente, no .env.local ou no .env do diretório atual.

Exemplos:
  bun run cli.ts /users/{conta}
  bun run cli.ts /users/{conta} --termo reputação
  bun run cli.ts "/orders/search?seller={conta}&limit=5" --valor 23 -n 5
`;


export function formatarRelatorio(r: ResultadoApuracaoMl): string {
  const l: string[] = [];

  l.push("");
  l.push(`  ${r.caminho}`);
  l.push(
    `  status ${r.statusPorTentativa.join(", ")} · ${r.coletasValidas}/${r.coletasPedidas} coletas · ${r.duracaoMediaMs} ms em média`,
  );

  if (r.falhas.length > 0) {
    l.push("");
    l.push("  FALHAS");
    for (const f of r.falhas) l.push(`    tentativa ${f.tentativa}: ${f.erro}`);
  }
  if (r.coletasValidas === 0) {
    l.push("");
    l.push("  Nenhuma coleta válida — nada a apurar.");
    return l.join("\n");
  }

  if (r.respostasIdenticas) {
    l.push("");
    l.push("  RESSALVA: as coletas voltaram idênticas. Pode ser dado estável de verdade ou");
    l.push("  cache devolvendo a mesma resposta — nesse caso repetir não confirmou nada.");
    l.push("  Para separar os dois casos, rode de novo daqui a alguns minutos.");
  }

  l.push("");
  l.push(`  AUDITORIA — ${r.auditoria.campos.length} campos, ${r.auditoria.instaveis.length} instáveis`);
  if (r.auditoria.instaveis.length === 0) {
    l.push("    Todos os campos vieram iguais nas coletas.");
  } else {
    for (const c of r.auditoria.instaveis) {
      const outras = c.variantes
        .slice(1)
        .map((v) => `${mascarar(c.caminho, v.valor)}x${v.votos}`)
        .join(", ");
      l.push(`    ${mascararCaminho(c.caminho)}`);
      l.push(
        `      eleito ${mascarar(c.caminho, c.valor)} (${c.confianca}, ${c.votos}/${c.presenteEm})` +
          (outras ? ` · também veio: ${outras}` : "") +
          (c.ausenteEm > 0 ? ` · faltou em ${c.ausenteEm}` : ""),
      );
    }
  }

  if (r.achadosPorTermo) {
    l.push("");
    l.push(`  CAMPOS QUE FALAM DE "${r.termo}"`);
    if (r.achadosPorTermo.length === 0) l.push("    Nada nesta resposta. Tente outro recurso.");
    for (const a of r.achadosPorTermo.slice(0, 10)) {
      l.push(`    ${mascararCaminho(a.campo.caminho)} = ${mascarar(a.campo.caminho, a.campo.exemplos[0])}`);
      l.push(`      ${a.motivo}`);
    }
  }

  if (r.achadosPorValor) {
    l.push("");
    l.push(`  CAMPOS COM O VALOR ${r.valorProcurado}`);
    if (r.achadosPorValor.length === 0) l.push("    Esse valor não apareceu em nenhum campo.");
    for (const a of r.achadosPorValor.slice(0, 10)) {
      l.push(`    ${a.campo.caminho} — ${a.motivo}`);
    }
  }

  if (r.conferenciaGlossario.length > 0) {
    const achados = r.conferenciaGlossario.filter((c) => c.existeNaResposta);
    const sumidos = r.conferenciaGlossario.filter((c) => !c.existeNaResposta);
    l.push("");
    l.push(`  GLOSSÁRIO — ${achados.length} de ${r.conferenciaGlossario.length} campos existem mesmo`);
    for (const c of achados) {
      const marca = c.confirmadoNoCodigo ? " " : "+";
      l.push(`    ${marca} ${c.termo}: ${c.campo} = ${mascarar(c.campo, c.valor)}`);
    }
    for (const c of sumidos) {
      l.push(`    ! ${c.termo}: ${c.campo} NÃO existe nesta resposta`);
    }
    const aConfirmar = achados.filter((c) => !c.confirmadoNoCodigo).length;
    if (aConfirmar > 0) {
      l.push("");
      l.push(`    ${aConfirmar} campo(s) marcados com + podem virar confirmado: true no glossário.`);
    }
    if (sumidos.length > 0) {
      l.push(`    ${sumidos.length} marcado(s) com ! precisam ser corrigidos ou removidos.`);
    }
  }

  l.push("");
  l.push(`  CATÁLOGO — ${r.catalogo.campos.length} campos`);
  for (const c of r.catalogo.campos.slice(0, 60)) {
    l.push(`    ${mascararCaminho(c.caminho)}: ${c.tipos.join("|")} = ${mascarar(c.caminho, c.exemplos[0])}`);
  }
  if (r.catalogo.campos.length > 60) {
    l.push(`    … e mais ${r.catalogo.campos.length - 60}. Use --json para ver todos.`);
  }

  l.push("");
  return l.join("\n");
}

// ---------------------------------------------------------------- execução

export async function principal(argv: string[]): Promise<number> {
  const args = lerArgumentos(argv);

  if (args.ajuda) {
    console.log(AJUDA);
    return 0;
  }

  if (args.listarRecursos) {
    console.log("\n  Atalhos conhecidos (? = ainda não confirmado numa conta real)\n");
    for (const r of RECURSOS_ML) {
      console.log(`    ${r.confirmado ? " " : "?"} ${r.apelido}`);
      console.log(`      ${r.caminho}`);
      console.log(`      ${r.descricao}\n`);
    }
    return 0;
  }

  if (args.consultaGlossario) {
    const achados = procurarTermo(args.consultaGlossario);
    console.log(`\n  "${args.consultaGlossario}" no glossário (${GLOSSARIO_ML.length} termos)\n`);
    if (achados.length === 0) {
      console.log("    Nada. Rode a apuração num recurso e use --termo para procurar no que voltar.\n");
      return 0;
    }
    for (const t of achados) {
      console.log(`    ${t.confirmado ? " " : "?"} ${t.termo}`);
      console.log(`      ${t.recurso} → ${t.campo}`);
      if (t.observacao) console.log(`      ${t.observacao}`);
      console.log("");
    }
    return 0;
  }

  if (!args.caminho) {
    console.log(AJUDA);
    return 1;
  }

  // Valida o caminho ANTES de procurar token: erro de digitação não deve
  // parecer problema de credencial.
  try {
    validarCaminhoMl(args.caminho, 0);
  } catch (erro) {
    console.error(`\n  ${erro instanceof Error ? erro.message : erro}\n`);
    return 1;
  }

  const credencial = acharToken();
  if (!credencial) {
    console.error(
      "\n  Falta o token. Defina ML_ACCESS_TOKEN de um destes jeitos:\n" +
        "    - no ambiente:   ML_ACCESS_TOKEN=APP_USR-... bun run cli.ts /users/{conta}\n" +
        "    - num arquivo:   ML_ACCESS_TOKEN=APP_USR-...  no .env.local do diretório atual\n\n" +
        "  O token do ML vale ~6 horas. Se o projeto já tem OAuth, pegue o access_token de lá.\n",
    );
    return 1;
  }

  console.log(`\n  Token: ${credencial.origem}`);

  let conta: { id: number; nickname: string };
  try {
    conta = await descobrirConta(credencial.token);
  } catch (erro) {
    console.error(`\n  ${erro instanceof Error ? erro.message : erro}\n`);
    return 1;
  }
  console.log(`  Conta: ${conta.nickname} (${conta.id})`);

  const resultado = await apurarRecursoMl({
    token: credencial.token,
    caminho: args.caminho,
    contaId: conta.id,
    repeticoes: args.coletas,
    termo: args.termo,
    valor: args.valor,
  });

  console.log(args.json ? JSON.stringify(resultado, null, 2) : formatarRelatorio(resultado));
  return resultado.coletasValidas > 0 ? 0 : 1;
}

// Só roda quando chamado direto, não quando importado pelos testes.
if (import.meta.main) {
  principal(process.argv.slice(2))
    .then((codigo) => process.exit(codigo))
    .catch((erro) => {
      console.error(`\n  Erro inesperado: ${erro instanceof Error ? erro.message : erro}\n`);
      process.exit(1);
    });
}
