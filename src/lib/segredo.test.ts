// Rodar: bun run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { segredoConfere } from "./segredo.ts";

test("segredo certo confere", async () => {
  assert.equal(await segredoConfere("abc123-segredo-longo", "abc123-segredo-longo"), true);
});

test("segredo errado, mais curto ou mais longo não confere", async () => {
  assert.equal(await segredoConfere("abc123-segredo-longX", "abc123-segredo-longo"), false);
  assert.equal(await segredoConfere("abc", "abc123-segredo-longo"), false);
  assert.equal(await segredoConfere("abc123-segredo-longo-e-mais", "abc123-segredo-longo"), false);
});

test("sem segredo configurado ou sem cabeçalho: recusa (seg-10)", async () => {
  assert.equal(await segredoConfere(null, "abc"), false);
  assert.equal(await segredoConfere("abc", undefined), false);
  assert.equal(await segredoConfere("", ""), false);
});
