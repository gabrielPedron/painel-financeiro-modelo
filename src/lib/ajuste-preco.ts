// Ajuste de preço: a progressão gradual do preço cheio até o cheio equivalente ao preço-alvo.
// O preço-alvo nasce no banco (anuncios_preco_alvo); aqui só a aritmética dos passos e das datas,
// usada pela tela.

/** Margem mínima padrão, em % da receita. A tela deixa trocar. */
export const MARGEM_ALVO_PCT = 8;
/** Teto de cada passo, em % do cheio de antes do passo. */
export const PASSO_PCT = 1.5;
/** Dias entre um passo e o seguinte. */
export const INTERVALO_DIAS = 10;
/** No Mercado Livre Brasil, o frete muda quando o preço cruza R$ 79 (frete grátis a partir daí). */
export const FAIXA_FRETE = 79;
/** Abaixo disso a estimativa é fraca: poucas vendas no período. */
export const MIN_UNIDADES = 5;
/** Teto de passos de uma progressão (60 × 10 dias ≈ 1 ano e meio): acima disso, a tela avisa. */
export const MAX_PASSOS = 60;

const cent = (v: number) => Math.round(v * 100);

/**
 * O próximo cheio: até `passoPct` % acima, arredondado para baixo no centavo.
 * Conta em centavos e pontos-base inteiros, para 100,00 × 1,5% dar 101,50 e não 101,49.
 */
export function proximoPasso(cheio: number, passoPct = PASSO_PCT): number {
  const c = cent(cheio);
  const bp = Math.round(passoPct * 100);
  const novo = Math.floor((c * (10_000 + bp)) / 10_000);
  return Math.max(novo, c + 1) / 100;
}

export type Passo = {
  n: number;
  data: string; // AAAA-MM-DD, prevista
  de: number;
  para: number;
  pct: number; // aumento do passo, em %
  ultimo: boolean;
  cruzaFaixaFrete: boolean;
};

export type Progressao = { passos: Passo[]; incompleta: boolean };

/** Soma dias a uma data AAAA-MM-DD (calendário, sem fuso). */
export function somarDias(dia: string, dias: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** O dia em Brasília (AAAA-MM-DD) de um instante. */
export function diaBR(instante: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(typeof instante === "string" ? new Date(instante) : instante);
}

/**
 * Do cheio atual ao cheio-alvo: passos de até `passoPct` % do cheio, arredondados para baixo no
 * centavo, um a cada `intervaloDias` a partir de `inicio`. O último passo para no cheio-alvo
 * (arredondado para cima no centavo pelo banco), mesmo que seja menor que um passo cheio.
 */
export function progressao(args: {
  cheioAtual: number;
  cheioAlvo: number | null;
  inicio: string;
  passoPct?: number;
  intervaloDias?: number;
  maxPassos?: number;
}): Progressao {
  const { cheioAtual, cheioAlvo, inicio } = args;
  const passoPct = args.passoPct ?? PASSO_PCT;
  const intervalo = args.intervaloDias ?? INTERVALO_DIAS;
  const max = args.maxPassos ?? MAX_PASSOS;
  const passos: Passo[] = [];
  if (cheioAlvo == null || !(cheioAtual > 0) || cent(cheioAtual) >= cent(cheioAlvo)) {
    return { passos, incompleta: false };
  }
  let de = cheioAtual;
  for (let n = 1; n <= max; n++) {
    const cheio = proximoPasso(de, passoPct);
    const ultimo = cent(cheio) >= cent(cheioAlvo);
    const para = ultimo ? cheioAlvo : cheio;
    passos.push({
      n,
      data: somarDias(inicio, (n - 1) * intervalo),
      de,
      para,
      pct: (para / de - 1) * 100,
      ultimo,
      cruzaFaixaFrete: de < FAIXA_FRETE && para >= FAIXA_FRETE,
    });
    if (ultimo) return { passos, incompleta: false };
    de = para;
  }
  return { passos, incompleta: true };
}

export type Etapa = { passos: number; parcial: boolean; abaixoDaBase: boolean };

/**
 * Em que etapa está o anúncio: quantos passos inteiros de `passoPct` % cabem entre o cheio-base e
 * o cheio de hoje. `parcial` diz que, depois deles, sobrou um aumento menor que um passo.
 */
export function etapa(cheioBase: number, cheioHoje: number, passoPct = PASSO_PCT): Etapa {
  if (cent(cheioHoje) < cent(cheioBase)) return { passos: 0, parcial: false, abaixoDaBase: true };
  let c = cheioBase;
  let n = 0;
  while (n < 1000) {
    const prox = proximoPasso(c, passoPct);
    if (cent(prox) > cent(cheioHoje)) break;
    c = prox;
    n++;
  }
  return { passos: n, parcial: cent(cheioHoje) > cent(c), abaixoDaBase: false };
}

/** Campanha do próprio vendedor (SELLER_CAMPAIGN): o ML a identifica com id "C-…". */
export function campanhaPropria(campanha: string | null | undefined): boolean {
  return typeof campanha === "string" && campanha.startsWith("C-");
}

export type Inicio = { data: string; motivo: "hoje" | "intervalo" };

/**
 * A data do 1º passo: `intervaloDias` depois da última mudança do cheio (o `last_updated` do preço
 * standard no /items/{id}/prices), ou hoje, se isso já passou ou se a data não veio.
 * Não espera o fim da campanha própria (regra do dono da conta desde 18/11/2026): o cheio sobe por
 * baixo, e o preço da promoção fica como está na central de promoções.
 */
export function inicioDaProgressao(args: {
  hoje: string;
  cheioAlteradoEm: string | null;
  intervaloDias?: number;
}): Inicio {
  const intervalo = args.intervaloDias ?? INTERVALO_DIAS;
  if (args.cheioAlteradoEm) {
    const d = somarDias(diaBR(args.cheioAlteradoEm), intervalo);
    if (d > args.hoje) return { data: d, motivo: "intervalo" };
  }
  return { data: args.hoje, motivo: "hoje" };
}

/**
 * Aviso quando o caminho até o alvo cruza R$ 79, no preço praticado ou no cheio: o frete e a tarifa
 * fixa por unidade mudam nessa faixa, e a estimativa usa os de hoje.
 */
export function avisoFaixaFrete(pares: Array<[number | null | undefined, number | null | undefined]>): string | null {
  const cruza = pares.some(([a, b]) => {
    if (a == null || b == null) return false;
    return Math.min(a, b) < FAIXA_FRETE && Math.max(a, b) >= FAIXA_FRETE;
  });
  return cruza
    ? `Cruza R$ ${FAIXA_FRETE}: no Mercado Livre, o frete e a tarifa fixa por unidade mudam nessa faixa. ` +
      "A estimativa usa o frete e a tarifa de hoje e não vale do outro lado; refaça depois do 1º período acima."
    : null;
}

/** Uma leitura de preço do ML, no formato que a função ajuste_preco_gravar_leitura recebe. */
export type LeituraPreco = {
  item_id: string;
  cheio: number;
  cheio_alterado_em: string | null;
  promocao_preco: number | null;
  promocao_fim: string | null;
  promocao_tipo: string | null;
  promocao_campanha: string | null;
};

type PrecoML = {
  id?: string;
  type?: string;
  amount?: number;
  last_updated?: string | null;
  conditions?: { context_restrictions?: string[]; start_time?: string | null; end_time?: string | null };
};

/**
 * Lê o /items/{id}/prices (cheio = o preço "standard"; promoção ativa no marketplace) e o
 * /items/{id}/sale_price?context=channel_marketplace (que diz qual campanha é). Sem standard, nulo.
 */
export function interpretarPrecos(itemId: string, precos: unknown, venda: unknown, agora = Date.now()): LeituraPreco | null {
  const lista = (precos && typeof precos === "object" && Array.isArray((precos as { prices?: unknown }).prices)
    ? (precos as { prices: PrecoML[] }).prices : []);
  const std = lista.find((p) => p.type === "standard");
  const cheio = Number(std?.amount);
  if (!(cheio > 0)) return null;
  const v = (venda && typeof venda === "object" ? venda : {}) as {
    price_id?: string; metadata?: { promotion_type?: string; campaign_id?: string };
  };
  const ativas = lista.filter((p) => {
    if (p.type !== "promotion" || !(Number(p.amount) > 0) || !(Number(p.amount) < cheio)) return false;
    const c = p.conditions ?? {};
    const contextos = c.context_restrictions ?? [];
    if (contextos.length > 0 && !contextos.includes("channel_marketplace")) return false;
    if (c.start_time && Date.parse(c.start_time) > agora) return false;
    if (c.end_time && Date.parse(c.end_time) < agora) return false;
    return true;
  });
  const promo = ativas.find((p) => v.price_id != null && p.id === v.price_id)
    ?? [...ativas].sort((a, b) => Number(a.amount) - Number(b.amount))[0];
  const daVenda = promo && v.price_id != null && promo.id === v.price_id;
  return {
    item_id: itemId,
    cheio,
    cheio_alterado_em: std?.last_updated ?? null,
    promocao_preco: promo ? Number(promo.amount) : null,
    promocao_fim: promo?.conditions?.end_time ?? null,
    promocao_tipo: daVenda ? v.metadata?.promotion_type ?? null : null,
    promocao_campanha: daVenda ? v.metadata?.campaign_id ?? null : null,
  };
}
