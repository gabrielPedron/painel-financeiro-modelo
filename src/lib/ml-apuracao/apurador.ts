// Adaptador do Mercado Livre — portátil, sem dependência de projeto.
//
// Não conhece Supabase, TanStack, React nem banco nenhum. Só precisa de um
// access token válido. É o que permite rodar a apuração em qualquer projeto,
// e até fora de projeto, direto pelo CLI ao lado.
//
// Quem guarda o token é o projeto. Aqui ele só chega pronto.

import {
  auditar,
  buscarPorTermo,
  buscarPorValor,
  catalogar,
  coletar,
  resumirAuditoria,
} from "./nucleo.ts";
import type { Auditoria, Catalogo, FalhaColeta, ResultadoBusca } from "./nucleo.ts";
import { GLOSSARIO_ML, procurarTermo, SINONIMOS_ML, type TermoMl } from "./glossario.ts";

export const HOST_ML = "api.mercadolibre.com";
export const BASE_ML = `https://${HOST_ML}`;

/** Teto de repetições. Cada uma é chamada real e conta na cota do ML. */
export const REPETICOES_MAX = 5;

/**
 * Confere que o caminho aponta mesmo para a API do Mercado Livre.
 *
 * Trava de segurança, não capricho: o caminho costuma vir digitado (tela ou
 * CLI) e a chamada sai com o access token do vendedor. Um caminho como
 * `//outro-servidor.com/coleta` mandaria esse token para fora. Por isso a URL
 * é montada de verdade e o host conferido no fim — comparar prefixo de string
 * não pega todos os casos.
 */
export function validarCaminhoMl(bruto: string, contaId?: string | number): string {
  let caminho = String(bruto ?? "").trim();

  if (contaId !== undefined) {
    caminho = caminho.replace(/\{conta\}/g, String(contaId));
  }

  if (!caminho.startsWith("/")) {
    throw new Error("O caminho precisa começar com barra. Ex.: /users/{conta}");
  }
  if (caminho.startsWith("//")) {
    throw new Error("Caminho inválido: duas barras no início apontariam para outro servidor.");
  }
  if (caminho.length > 600) {
    throw new Error("Caminho longo demais.");
  }
  if (/[\s<>"'\\]/.test(caminho)) {
    throw new Error("O caminho tem caracteres que não valem em uma URL.");
  }

  const url = new URL(caminho, BASE_ML);
  if (url.protocol !== "https:") {
    throw new Error("Bloqueado: só https.");
  }
  if (url.hostname !== HOST_ML) {
    throw new Error(`Bloqueado: o caminho aponta para ${url.hostname}, não para ${HOST_ML}.`);
  }
  return `${url.pathname}${url.search}`;
}

/** Como a chamada sai. Injetável para dar para testar sem rede. */
export type Buscador = (
  url: string,
  cabecalhos: Record<string, string>,
) => Promise<{ ok: boolean; status: number; corpo: unknown }>;

const buscadorPadrao: Buscador = async (url, cabecalhos) => {
  const resposta = await fetch(url, { headers: cabecalhos });
  const corpo = await resposta.json().catch(() => null);
  return { ok: resposta.ok, status: resposta.status, corpo };
};

export type ResultadoApuracaoMl = {
  caminho: string;
  statusPorTentativa: number[];
  duracaoMediaMs: number;
  coletasValidas: number;
  coletasPedidas: number;
  /** Ver a ressalva de cache em `coletar()` do núcleo. */
  respostasIdenticas: boolean;
  falhas: FalhaColeta[];
  catalogo: Catalogo;
  auditoria: Auditoria;
  termo: string | null;
  valorProcurado: string | null;
  achadosPorTermo: ResultadoBusca[] | null;
  achadosPorValor: ResultadoBusca[] | null;
  glossario: TermoMl[];
  /** Conferência do glossário contra o que a apuração realmente devolveu. */
  conferenciaGlossario: ConferenciaTermo[];
  resumo: string;
};

export type ConferenciaTermo = {
  termo: string;
  campo: string;
  confirmadoNoCodigo: boolean;
  /** O campo apareceu de verdade nesta resposta? */
  existeNaResposta: boolean;
  valor?: unknown;
};

/**
 * Confere o glossário contra a resposta real.
 *
 * É o que fecha o ciclo: o glossário nasce com `confirmado: false` porque veio
 * da documentação, e só isto aqui autoriza virar para `true`. Campo que a
 * apuração não achou continua não confirmado, por mais que a documentação jure.
 */
export function conferirGlossario(catalogo: Catalogo, recurso: string): ConferenciaTermo[] {
  const porCaminho = new Map(catalogo.campos.map((c) => [c.caminho, c]));

  return GLOSSARIO_ML.filter((t) => {
    // Só confere os termos do recurso apurado. `/users/{conta}` casa com `/users/123`.
    const alvo = t.recurso.replace(/\{[^}]*\}/g, "");
    return recurso.startsWith(alvo.split("?")[0]);
  }).map((t) => {
    const campo = porCaminho.get(t.campo);
    return {
      termo: t.termo,
      campo: t.campo,
      confirmadoNoCodigo: t.confirmado,
      existeNaResposta: !!campo,
      valor: campo?.exemplos[0],
    };
  });
}

/**
 * Apuração completa de um recurso do Mercado Livre.
 *
 * Chamadas sequenciais e espaçadas de propósito — ver `coletar()` no núcleo.
 * Em paralelo cairiam no mesmo cache e a auditoria não provaria nada.
 */
export async function apurarRecursoMl(
  params: {
    token: string;
    caminho: string;
    contaId?: string | number;
    repeticoes?: number;
    intervaloMs?: number;
    termo?: string;
    valor?: string;
  },
  opcoes: { buscador?: Buscador } = {},
): Promise<ResultadoApuracaoMl> {
  const buscador = opcoes.buscador ?? buscadorPadrao;
  const caminho = validarCaminhoMl(params.caminho, params.contaId);
  const repeticoes = Math.min(Math.max(1, params.repeticoes ?? 3), REPETICOES_MAX);

  const statusPorTentativa: number[] = [];

  const coleta = await coletar(
    async () => {
      const { ok, status, corpo } = await buscador(`${BASE_ML}${caminho}`, {
        Authorization: `Bearer ${params.token}`,
        accept: "application/json",
      });
      statusPorTentativa.push(status);
      if (!ok) {
        const detalhe =
          (corpo as { message?: string; error?: string } | null)?.message ??
          (corpo as { message?: string; error?: string } | null)?.error ??
          "sem detalhe";
        throw new Error(`${status} — ${detalhe}`);
      }
      return corpo;
    },
    // minimoValido 0: se tudo falhar, ainda queremos devolver status e erros.
    // Falha de apuração é informação, não exceção.
    { repeticoes, intervaloMs: params.intervaloMs ?? 700, minimoValido: 0 },
  );

  const amostras = coleta.amostras.map((a) => a.dados);
  const catalogo = catalogar(amostras);
  // 1% de margem: para ordem de grandeza e tendência, 100,00 e 100,40 são o
  // mesmo número. O pedido foi aproximação confiável, não igualdade milimétrica.
  const auditoria = auditar(amostras, { toleranciaRelativa: 0.01 });

  const termo = params.termo?.trim() || null;
  const valor = params.valor?.trim() || null;
  const duracoes = coleta.amostras.map((a) => a.duracaoMs);

  return {
    caminho,
    statusPorTentativa,
    duracaoMediaMs: duracoes.length
      ? Math.round(duracoes.reduce((s, d) => s + d, 0) / duracoes.length)
      : 0,
    coletasValidas: coleta.amostras.length,
    coletasPedidas: repeticoes,
    respostasIdenticas: coleta.respostasIdenticas,
    falhas: coleta.falhas,
    catalogo,
    auditoria,
    termo,
    valorProcurado: valor,
    achadosPorTermo: termo
      ? buscarPorTermo(catalogo, termo, { sinonimos: SINONIMOS_ML, limite: 20 })
      : null,
    achadosPorValor: valor
      ? buscarPorValor(catalogo, valor, { toleranciaRelativa: 0.02, limite: 20 })
      : null,
    glossario: termo ? procurarTermo(termo) : [],
    conferenciaGlossario: amostras.length > 0 ? conferirGlossario(catalogo, caminho) : [],
    resumo: amostras.length > 0 ? resumirAuditoria(auditoria) : "Nenhuma coleta válida.",
  };
}

/** Quem é a conta do token — resolve o `{conta}` sozinho, sem o usuário informar. */
export async function descobrirConta(
  token: string,
  opcoes: { buscador?: Buscador } = {},
): Promise<{ id: number; nickname: string }> {
  const buscador = opcoes.buscador ?? buscadorPadrao;
  const { ok, status, corpo } = await buscador(`${BASE_ML}/users/me`, {
    Authorization: `Bearer ${token}`,
    accept: "application/json",
  });
  if (!ok) {
    // O ML devolve 403 para token malformado e 401 para token expirado —
    // confirmado chamando a API de verdade. Os dois querem o mesmo conserto.
    if (status === 401 || status === 403) {
      throw new Error(
        `Token recusado (${status}). O access token do ML vale ~6 horas: ` +
          "pegue um novo pelo OAuth do projeto e atualize ML_ACCESS_TOKEN.",
      );
    }
    throw new Error(`Não foi possível ler a conta (${status}).`);
  }
  const dados = corpo as { id?: number; nickname?: string } | null;
  if (!dados?.id) throw new Error("A resposta de /users/me não trouxe o id da conta.");
  return { id: dados.id, nickname: dados.nickname ?? "—" };
}

// ------------------------------------------------------- dado que não sai daqui

/**
 * Trechos de caminho que indicam dado pessoal.
 *
 * Aprendido na marra, apurando uma conta real: `company.brand_name` trouxe nome
 * completo e CNPJ do vendedor, e `buyer.nickname` trouxe o apelido de um CLIENTE
 * dele — dado de terceiro. Os dois foram parar num arquivo que seria versionado.
 *
 * Lista heurística erra por omissão, e só rodar contra dado real acha a falha.
 * Na dúvida, mascara.
 */
export const TRECHOS_SENSIVEIS = [
  "address", "phone", "email", "identification", "first_name", "last_name",
  "cpf", "cnpj", "zip", "tax_id", "bill_data", "credential", "token", "secret",
  "password", "birth", "gender", "document",
  "company", "corporate", "brand_name", "razao", "fantasia",
  // Dado de TERCEIRO — o cliente. Pior que vazar o do próprio dono.
  "buyer", "payer", "receiver", "collector",
];

/** Campos públicos no site do ML: passam inteiros mesmo longos. */
const CAMPOS_PUBLICOS = ["title", "permalink", "thumbnail", "warranty", "family_name", "detail"];

const TAMANHO_MAXIMO_DE_TEXTO = 60;

/**
 * O apurador indexa listas por identidade, então o id entra no CAMINHO —
 * `players[user_id=123].role`. Mascarar só o valor não adianta: o id já está no
 * nome do campo. Visto apurando reclamações, onde cada uma traz os dois lados.
 */
const IDENTIDADES_DE_PESSOA = ["user_id", "buyer_id", "payer_id", "seller_id", "receiver_id"];

/** Como um valor aparece no relatório. Sensível vence público. */
export function mascarar(caminho: string, valor: unknown): string {
  const c = caminho.toLowerCase();
  const sensivel = TRECHOS_SENSIVEIS.some((t) => c.includes(t));
  const nomeDoCampo = c.split(".").pop()?.replace(/\[.*?\]/g, "") ?? "";

  // Id de pessoa vem como NÚMERO: `buyer.id`, `players[].user_id`. O early-return
  // por tipo pulava a lista de sensíveis inteira e o inteiro saía no arquivo
  // versionado. Visto apurando reclamações, onde cada registro traz os dois lados.
  if (typeof valor === "number" && (sensivel || IDENTIDADES_DE_PESSOA.includes(nomeDoCampo))) {
    return "«id»";
  }
  if (typeof valor === "string" && valor.length > 70) valor = valor.slice(0, 70) + "…";
  if (typeof valor !== "string") {
    if (valor === null) return "nulo";
    if (valor === undefined) return "—";
    if (typeof valor === "object") return Array.isArray(valor) ? "[]" : "{}";
    return String(valor);
  }
  if (valor === "") return '""';

  const publico = !sensivel && CAMPOS_PUBLICOS.includes(nomeDoCampo);

  if (sensivel || (!publico && valor.length > TAMANHO_MAXIMO_DE_TEXTO)) {
    return `«texto, ${valor.length} caracteres»`;
  }
  return valor;
}

export function mascararCaminho(caminho: string): string {
  return caminho.replace(/\[([a-z_]+)=([^\]]+)\]/gi, (todo, chave) =>
    IDENTIDADES_DE_PESSOA.includes(chave.toLowerCase()) ? `[${chave}=…]` : todo,
  );
}
