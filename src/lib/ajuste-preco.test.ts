// Rodar: bun run test (Node 24 lê TypeScript direto).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avisoFaixaFrete, campanhaPropria, diaBR, etapa, inicioDaProgressao, progressao, proximoPasso, somarDias,
} from "./ajuste-preco.ts";

test("passo de 1,5% arredondado para baixo no centavo, como o gerente", () => {
  assert.equal(proximoPasso(78.99), 80.17); // 80,17485
  assert.equal(proximoPasso(140.99), 143.1); // 143,10485
  assert.equal(proximoPasso(144.99), 147.16);
  assert.equal(proximoPasso(41.99), 42.61);
  // conta exata em centavos: 100 × 1,015 = 101,50, não 101,49 do ponto flutuante
  assert.equal(proximoPasso(100), 101.5);
  // preço muito baixo: sobe ao menos 1 centavo, para a progressão não parar
  assert.equal(proximoPasso(0.5), 0.51);
});

test("progressão do cheio até o alvo, com o último passo parando no alvo", () => {
  const p = progressao({ cheioAtual: 144.99, cheioAlvo: 153.03, inicio: "2026-11-30" });
  assert.equal(p.incompleta, false);
  assert.deepEqual(p.passos.map((x) => [x.data, x.de, x.para]), [
    ["2026-11-30", 144.99, 147.16],
    ["2026-12-10", 147.16, 149.36],
    ["2026-12-20", 149.36, 151.6],
    ["2026-12-30", 151.6, 153.03],
  ]);
  assert.ok(p.passos.slice(0, 3).every((x) => x.pct <= 1.5 && !x.ultimo));
  assert.ok(p.passos[3].ultimo && p.passos[3].pct < 1.5);
});

test("sem alvo ou já no alvo: nenhum passo", () => {
  assert.deepEqual(progressao({ cheioAtual: 50, cheioAlvo: null, inicio: "2026-11-30" }).passos, []);
  assert.deepEqual(progressao({ cheioAtual: 50, cheioAlvo: 49.9, inicio: "2026-11-30" }).passos, []);
  assert.deepEqual(progressao({ cheioAtual: 50, cheioAlvo: 50, inicio: "2026-11-30" }).passos, []);
});

test("progressão longa demais para no teto e avisa", () => {
  const p = progressao({ cheioAtual: 78.99, cheioAlvo: 1000, inicio: "2026-11-30", maxPassos: 5 });
  assert.equal(p.passos.length, 5);
  assert.equal(p.incompleta, true);
});

test("o passo que cruza R$ 79 fica marcado (Kit 2 Fundos, 78,99 → 80,17)", () => {
  const p = progressao({ cheioAtual: 78.99, cheioAlvo: 82, inicio: "2026-11-30" });
  assert.equal(p.passos[0].cruzaFaixaFrete, true);
  assert.equal(p.passos[1].cruzaFaixaFrete, false);
  assert.match(avisoFaixaFrete([[75.38, 76.5], [78.99, 80.17]]) ?? "", /Cruza R\$ 79/);
  assert.equal(avisoFaixaFrete([[137.74, 145.37], [144.99, 153.03]]), null);
  assert.equal(avisoFaixaFrete([[null, 80], [79, 85]]), null);
});

test("etapa: passos inteiros de 1,5% entre o cheio-base e o de hoje", () => {
  assert.deepEqual(etapa(78.99, 78.99), { passos: 0, parcial: false, abaixoDaBase: false });
  assert.deepEqual(etapa(78.99, 80.17), { passos: 1, parcial: false, abaixoDaBase: false });
  assert.deepEqual(etapa(78.99, 81.37), { passos: 2, parcial: false, abaixoDaBase: false }); // 80,17 → 81,37
  assert.deepEqual(etapa(78.99, 80.5), { passos: 1, parcial: true, abaixoDaBase: false });
  assert.deepEqual(etapa(78.99, 79.5), { passos: 0, parcial: true, abaixoDaBase: false });
  assert.deepEqual(etapa(78.99, 75), { passos: 0, parcial: false, abaixoDaBase: true });
});

test("início: hoje, 10 dias depois da última mudança ou o dia seguinte ao fim da campanha própria", () => {
  const base = { hoje: "2026-11-18", cheioAlteradoEm: "2026-10-26T18:11:35Z", promocaoFim: null, promocaoCampanha: null };
  assert.deepEqual(inicioDaProgressao(base), { data: "2026-11-18", motivo: "hoje" });
  assert.deepEqual(inicioDaProgressao({ ...base, cheioAlteradoEm: "2026-11-15T13:00:00Z" }), { data: "2026-11-25", motivo: "intervalo" });
  // BLACK NOVEMBER: o /prices dá 30/11 02:59Z, que em Brasília é 29/11; o passo é em 30/11
  assert.deepEqual(
    inicioDaProgressao({ ...base, promocaoFim: "2026-11-30T02:59:59Z", promocaoCampanha: "C-MLB6284610" }),
    { data: "2026-11-30", motivo: "fim_da_campanha" },
  );
  // promoção do ML (não é campanha própria) não segura o passo
  assert.deepEqual(
    inicioDaProgressao({ ...base, promocaoFim: "2026-11-30T02:59:59Z", promocaoCampanha: "P-MLB123" }),
    { data: "2026-11-18", motivo: "hoje" },
  );
});

test("datas: dia de Brasília e soma de dias atravessando o mês", () => {
  assert.equal(diaBR("2026-11-30T02:59:59Z"), "2026-11-29");
  assert.equal(somarDias("2026-11-30", 10), "2026-12-10");
  assert.equal(somarDias("2026-12-30", 10), "2027-01-09");
  assert.equal(campanhaPropria("C-MLB6284610"), true);
  assert.equal(campanhaPropria(null), false);
});

test("leitura do ML: cheio do standard, promoção ativa do marketplace e a campanha do sale_price", async () => {
  const { interpretarPrecos } = await import("./ajuste-preco.ts");
  // Respostas reais do Kit 2 Fundos em 18/11/2026 (BLACK NOVEMBER, campanha própria)
  const precos = { id: "MLB7538838652", prices: [
    { id: "1", type: "standard", amount: 78.99, regular_amount: null, last_updated: "2026-08-28T11:43:32Z",
      conditions: { context_restrictions: [], start_time: null, end_time: null } },
    { id: "7", type: "promotion", amount: 75.04, regular_amount: 78.99, last_updated: "2026-11-16T22:30:13Z",
      conditions: { context_restrictions: ["channel_marketplace"], start_time: "2026-10-30T03:00:00Z", end_time: "2026-11-30T02:59:59Z" } },
  ] };
  const venda = { price_id: "7", amount: 75.04, regular_amount: 78.99,
    metadata: { campaign_id: "C-MLB6284610", promotion_id: "OFFER-MLB7538838652-14408213865", promotion_type: "custom" } };
  const agora = Date.parse("2026-11-19T00:00:00Z");
  assert.deepEqual(interpretarPrecos("MLB7538838652", precos, venda, agora), {
    item_id: "MLB7538838652", cheio: 78.99, cheio_alterado_em: "2026-08-28T11:43:32Z",
    promocao_preco: 75.04, promocao_fim: "2026-11-30T02:59:59Z", promocao_tipo: "custom", promocao_campanha: "C-MLB6284610",
  });
  // depois do fim, a promoção não conta
  const depois = interpretarPrecos("MLB7538838652", precos, venda, Date.parse("2026-11-30T12:00:00Z"));
  assert.equal(depois?.promocao_preco, null);
  // sem promoção
  const so = interpretarPrecos("MLB1", { prices: [precos.prices[0]] }, { price_id: "1", metadata: {} }, agora);
  assert.equal(so?.cheio, 78.99);
  assert.equal(so?.promocao_preco, null);
  assert.equal(so?.promocao_campanha, null);
  // promoção de outro canal (Mercado Shops) não conta; sem standard, nulo
  const outro = { prices: [precos.prices[0], { ...precos.prices[1], conditions: { context_restrictions: ["channel_mshops"] } }] };
  assert.equal(interpretarPrecos("MLB1", outro, null, agora)?.promocao_preco, null);
  assert.equal(interpretarPrecos("MLB1", { prices: [precos.prices[1]] }, venda, agora), null);
  assert.equal(interpretarPrecos("MLB1", null, null, agora), null);
});
