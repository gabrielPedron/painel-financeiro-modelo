// Rodar: bun run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { adsDoDiaCompleto } from "./ads-do-dia.ts";

test("dia inteiro recebido: troca o dia", () => {
  assert.equal(adsDoDiaCompleto(22, 22, 22), true);
  assert.equal(adsDoDiaCompleto(20, 22, 22), true); // linhas sem custo nem clique ficam de fora
});

test("resposta vazia não apaga o dia (sync-05)", () => {
  assert.equal(adsDoDiaCompleto(0, 0, 0), false);
});

test("paginação interrompida no meio não apaga o resto do dia", () => {
  assert.equal(adsDoDiaCompleto(10, 50, 120), false);
});
