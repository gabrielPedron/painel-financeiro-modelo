// Rodar: bun run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { recebidoPelaConta } from "./mp-recebido.ts";

test("venda: a conta é a recebedora", () => {
  assert.equal(recebidoPelaConta({ collector_id: 541036803 }, 541036803), true);
  assert.equal(recebidoPelaConta({ collector_id: "541036803" }, 541036803), true);
});

test("compra da própria conta: o recebedor é outro, fica de fora", () => {
  assert.equal(recebidoPelaConta({ collector_id: 3390428398 }, 541036803), false);
});

test("sem recebedor informado: fica de fora", () => {
  assert.equal(recebidoPelaConta({}, 541036803), false);
  assert.equal(recebidoPelaConta({ collector_id: null }, 541036803), false);
});
