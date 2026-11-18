// Rodar: bun run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { conferirFaturamento } from "./conferencia-faturamento.ts";

test("banco com tudo o que a API tem: concluído", () => {
  assert.deepEqual(conferirFaturamento(3824, 3824, 3), { acao: "concluido" });
  assert.deepEqual(conferirFaturamento(0, 0, 0), { acao: "concluido" });
});

test("abaixo da API: confere de novo até 3 vezes", () => {
  assert.deepEqual(conferirFaturamento(100, 90, 0), { acao: "reconferir", nota: "Verificação 1/3: API=100, banco=90" });
  assert.equal(conferirFaturamento(100, 90, 2).acao, "reconferir");
});

test("ainda abaixo depois de 3 conferências: incompleto, com a diferença (sync-06)", () => {
  assert.deepEqual(conferirFaturamento(100, 90, 3), {
    acao: "incompleto",
    nota: "Incompleto depois de 3 conferências: API=100, banco=90 (faltam 10)",
  });
});
