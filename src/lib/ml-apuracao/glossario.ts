// Glossário: o que a gente fala × o que a API do Mercado Livre chama.
//
// Este arquivo existe porque o vocabulário não bate. A gente diz "medalha",
// "termômetro", "é Full?", "taxa de reclamação". A API diz `level_id`,
// `logistic_type`, `metrics.claims.rate`. Sem um mapa, toda integração nova
// começa caçando campo no escuro.
//
// REGRA DE HONESTIDADE: `confirmado: false` quer dizer que o caminho veio da
// documentação ou de memória e NÃO foi visto ainda numa conta real. Só vira
// `true` depois de aparecer na apuração de uma conta de verdade — é para isso
// que serve o apurador. Nunca marcar confirmado sem ter rodado.
//
// Sem dependência de servidor: a interface também importa daqui.

export type RecursoMl = {
  apelido: string;
  /** Caminho da API. `{conta}` é trocado pelo ml_user_id da conta conectada. */
  caminho: string;
  descricao: string;
  /** Já respondeu 200 numa conta real? */
  confirmado: boolean;
};

/** Recursos que valem uma apuração. São sugestões da interface, não uma trava. */
export const RECURSOS_ML: RecursoMl[] = [
  {
    apelido: "Conta e reputação",
    caminho: "/users/{conta}",
    descricao: "Medalha, termômetro, transações e as métricas que o ML cobra do vendedor.",
    confirmado: true,
  },
  {
    apelido: "Perguntas em aberto",
    caminho: "/questions/search?seller_id={conta}&status=UNANSWERED&api_version=4&limit=5",
    descricao: "Perguntas do comprador ainda sem resposta.",
    confirmado: true,
  },
  {
    apelido: "Vendas recentes",
    caminho: "/orders/search?seller={conta}&sort=date_desc&limit=5",
    descricao: "Últimos pedidos, com valor, status e comprador.",
    confirmado: true,
  },
  {
    apelido: "Meus anúncios",
    caminho: "/users/{conta}/items/search?limit=5",
    descricao: "Ids dos anúncios da conta. O detalhe de cada um vem de /items/{id}.",
    confirmado: true,
  },
  {
    apelido: "Reclamações abertas",
    caminho: "/marketplace/v2/claims/search?status=opened&sort=last_updated:asc",
    descricao:
      "É `marketplace/v2`, não `post-purchase/v1` — o caminho antigo devolve 404. Aceita status, stage, sort e user_id.",
    confirmado: false,
  },
  {
    apelido: "Reclamações fechadas",
    caminho: "/marketplace/v2/claims/search?status=closed&sort=last_updated:asc",
    descricao:
      "O `sort` NÃO é opcional: sem ele o ML devolve a mesma página em ordem diferente a cada chamada, e paginar por offset repete registro e perde outros. Com `sort`, a janela fica estável — medido pela auditoria. Sem nenhum filtro o endpoint devolve 400 atLeastOneFilterProvided.",
    confirmado: true,
  },
  {
    apelido: "Devoluções",
    caminho: "/marketplace/v2/claims/search?status=opened&sort=last_updated:asc",
    descricao:
      "NÃO existe busca própria de devolução. Segundo a documentação, acha-se pela reclamação: o campo related_entities traz 'return'. Só então /post-purchase/v1/returns/{id}.",
    confirmado: false,
  },
  {
    apelido: "Ficha do produto (MLBU)",
    caminho: "/user-products/{ficha}",
    descricao:
      "Trocar `{ficha}` pelo código MLBU antes de apurar. É a família de anúncios, não o anúncio: family_name, atributos e fotos. NÃO traz o id MLB, então não serve de ponte para /items.",
    confirmado: true,
  },
  {
    apelido: "Motivo da reclamação",
    caminho: "/post-purchase/v1/claims/reasons/{motivo}",
    descricao:
      "Traduz o reason_id que vem na busca de reclamações — sem isso a tela mostra código ao vendedor. A DOCUMENTAÇÃO ERRA os nomes dos campos: promete title/description/problem, mas a resposta traz 'detail' (frase no idioma do site), 'name' (código legível), 'flow', 'parent_id' (motivos são uma árvore) e settings.expected_resolutions (o desfecho esperado). Foi a apuração que corrigiu a documentação.",
    confirmado: true,
  },
  {
    apelido: "Mensagens não lidas",
    caminho: "/messages/unread?role=seller",
    descricao:
      "NÃO RESPONDEU (400/404) numa apuração real. Caminho tirado de memória, nunca confirmado — o certo ainda precisa ser descoberto.",
    confirmado: false,
  },
  {
    apelido: "Métricas de reputação",
    caminho: "/users/{conta}/reputation",
    descricao:
      "NÃO RESPONDEU (400/404) numa apuração real. Caminho tirado de memória, nunca confirmado — o certo ainda precisa ser descoberto.",
    confirmado: false,
  },
];

export type TermoMl = {
  /** Como a gente fala. */
  termo: string;
  sinonimos: string[];
  /** Em que recurso o campo aparece. */
  recurso: string;
  /** Caminho do campo dentro da resposta. */
  campo: string;
  observacao?: string;
  confirmado: boolean;
};

export const GLOSSARIO_ML: TermoMl[] = [
  {
    termo: "medalha / cor do termômetro",
    sinonimos: ["reputação", "nível", "verde", "vermelho", "amarelo"],
    recurso: "/users/{conta}",
    campo: "seller_reputation.level_id",
    observacao: "Vem como 5_green, 4_light_green… O número é o degrau, a cor é o termômetro.",
    confirmado: true,
  },
  {
    termo: "MercadoLíder",
    sinonimos: ["platinum", "gold", "líder", "selo"],
    recurso: "/users/{conta}",
    campo: "seller_reputation.power_seller_status",
    observacao: "Vem nulo quando a conta não é MercadoLíder.",
    confirmado: true,
  },
  {
    termo: "vendas concluídas",
    sinonimos: ["pedidos entregues", "transações completas"],
    recurso: "/users/{conta}",
    campo: "seller_reputation.transactions.completed",
    confirmado: true,
  },
  {
    termo: "vendas canceladas",
    sinonimos: ["cancelamentos", "pedidos cancelados"],
    recurso: "/users/{conta}",
    campo: "seller_reputation.transactions.canceled",
    confirmado: true,
  },
  {
    termo: "avaliações positivas",
    sinonimos: ["nota boa", "feedback positivo"],
    recurso: "/users/{conta}",
    campo: "seller_reputation.transactions.ratings.positive",
    observacao:
      "Vem como FRAÇÃO (0.98), não como porcentagem. Quem exibir precisa decidir " +
      "e converter — o erro clássico é mostrar 0.98% ou 98 sem saber qual dos dois é.",
    confirmado: true,
  },
  {
    termo: "taxa de reclamações",
    sinonimos: ["índice de reclamação", "claims"],
    recurso: "/users/{conta}",
    campo: "seller_reputation.metrics.claims.rate",
    observacao: "É a métrica que derruba o termômetro. O campo .value traz o número absoluto.",
    confirmado: true,
  },
  {
    termo: "taxa de cancelamento pelo vendedor",
    sinonimos: ["cancelou a venda", "cancellations"],
    recurso: "/users/{conta}",
    campo: "seller_reputation.metrics.cancellations.rate",
    confirmado: true,
  },
  {
    termo: "atraso no envio",
    sinonimos: ["despacho atrasado", "handling time", "fora do prazo"],
    recurso: "/users/{conta}",
    campo: "seller_reputation.metrics.delayed_handling_time.rate",
    confirmado: true,
  },
  {
    termo: "janela da métrica",
    sinonimos: ["período considerado", "últimos 60 dias"],
    recurso: "/users/{conta}",
    campo: "seller_reputation.metrics.claims.period",
    observacao: "Diz sobre quantos dias o ML está calculando aquela métrica.",
    confirmado: true,
  },
  {
    termo: "quantos anúncios eu tenho",
    sinonimos: ["total de anúncios", "quantidade de publicações"],
    recurso: "/users/{conta}/items/search",
    campo: "paging.total",
    observacao:
      "CUIDADO: `paging.total` existe em vários recursos e significa coisa diferente em " +
      "cada um — aqui conta ANÚNCIOS, em /orders/search conta PEDIDOS. Mesmo nome, " +
      "assunto diferente: é a armadilha de vocabulário dentro da própria API.",
    confirmado: true,
  },
  {
    termo: "ids dos meus anúncios",
    sinonimos: ["lista de anúncios", "códigos MLB"],
    recurso: "/users/{conta}/items/search",
    campo: "results[]",
    observacao:
      "Só os códigos (MLB seguido de dígitos). O detalhe de cada anúncio exige /items/{id}, " +
      "um por vez — este recurso não traz preço, estoque nem nada do anúncio.",
    confirmado: true,
  },
  {
    termo: "estoque disponível",
    sinonimos: ["quantidade em estoque", "disponível"],
    recurso: "/items/{id}",
    campo: "available_quantity",
    confirmado: true,
  },
  {
    termo: "quantidade vendida",
    sinonimos: ["vendidos", "já vendeu"],
    recurso: "/items/{id}",
    campo: "sold_quantity",
    observacao:
      "O ML ARREDONDA este número em anúncio de catálogo. Serve para tendência, " +
      "nunca para contar dinheiro nem para conferir com o extrato.",
    confirmado: true,
  },
  {
    termo: "saúde do anúncio",
    sinonimos: ["qualidade do anúncio", "ficha incompleta"],
    recurso: "/items/{id}",
    campo: "health",
    observacao:
      "ATENÇÃO: vem NULO em anúncio de catálogo (catalog_listing = true) — visto numa " +
      "apuração real. O campo existe, mas não vale para esse caso: quem depender dele " +
      "precisa tratar nulo, não assumir uma fração de 0 a 1.",
    confirmado: true,
  },
  {
    termo: "tipo de anúncio",
    sinonimos: ["clássico", "premium", "exposição"],
    recurso: "/items/{id}",
    campo: "listing_type_id",
    observacao:
      "gold_special = Clássico, gold_pro = Premium.",
    confirmado: true,
  },
  {
    termo: "é Full?",
    sinonimos: ["fulfillment", "full", "logística"],
    recurso: "/items/{id}",
    campo: "shipping.logistic_type",
    observacao: "fulfillment = Full. Outros valores: cross_docking, drop_off, self_service (Flex).",
    confirmado: true,
  },
  {
    termo: "anúncio de catálogo",
    sinonimos: ["buy box", "concorrência", "ganhou o catálogo"],
    recurso: "/items/{id}",
    campo: "catalog_listing",
    confirmado: true,
  },
  {
    termo: "total de perguntas em aberto",
    sinonimos: ["quantas perguntas", "pendentes"],
    recurso: "/questions/search",
    campo: "total",
    observacao: "Pode ser maior que o tamanho de questions[], que respeita o limit.",
    confirmado: true,
  },
  {
    termo: "total de vendas do filtro",
    sinonimos: ["quantos pedidos", "contagem de vendas"],
    recurso: "/orders/search",
    campo: "paging.total",
    observacao:
      "Conta PEDIDOS, não anúncios. CUIDADO: `seller_reputation.transactions.total`, " +
      "em /users, também se chama 'total de vendas' e DIVERGE deste, medido no mesmo " +
      "dia e na mesma conta. Provavelmente janela de tempo diferente. Nunca exibir os " +
      "dois juntos sem entender a diferença — o usuário vê a contradição.",
    confirmado: true,
  },
  {
    termo: "valor da venda",
    sinonimos: ["quanto vendeu", "faturamento do pedido"],
    recurso: "/orders/search",
    campo: "results[].total_amount",
    observacao:
      "É o valor pago pelo comprador, SEM descontar tarifa nem frete — não é o que " +
      "entra na conta do vendedor. A tarifa vem em `order_items[].sale_fee`, " +
      "no detalhe do pedido.",
    confirmado: true,
  },
];

/**
 * Vocabulário do Mercado Livre que o dicionário genérico do núcleo não conhece.
 * Entra na busca somado aos sinônimos padrão.
 */
export const SINONIMOS_ML: string[][] = [
  ["full", "fulfillment", "logistic", "logistica"],
  ["flex", "self_service"],
  ["mercadolider", "lider", "power", "seller", "platinum", "gold"],
  ["termometro", "medalha", "level", "cor"],
  ["catalogo", "catalog", "buybox", "concorrencia"],
  ["classico", "gold_special", "premium", "gold_pro"],
  ["anuncio", "item", "publicacao", "mlb"],
  ["reputacao", "reputation", "metrics", "metricas"],
  ["ficha", "attributes", "atributos"],
];

function limpar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Procura no glossário por um termo do nosso vocabulário.
 * É a resposta rápida de "como o ML chama isso?" — sem chamar a API.
 */
export function procurarTermo(consulta: string): TermoMl[] {
  const alvo = limpar(consulta);
  if (!alvo) return [];
  const palavras = alvo.split(" ");

  return GLOSSARIO_ML.map((entrada) => {
    const texto = limpar(
      [entrada.termo, ...entrada.sinonimos, entrada.campo, entrada.observacao ?? ""].join(" "),
    );
    const pontos = palavras.reduce(
      (soma, palavra) => soma + (palavra.length >= 3 && texto.includes(palavra) ? 1 : 0),
      0,
    );
    return { entrada, pontos };
  })
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .map((x) => x.entrada);
}

/** Caminho inverso: a API devolveu este campo — como a gente chama isso? */
export function descreverCampo(campo: string): TermoMl | undefined {
  const alvo = limpar(campo);
  return GLOSSARIO_ML.find((e) => limpar(e.campo) === alvo);
}
