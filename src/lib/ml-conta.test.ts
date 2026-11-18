// Rodar: bun run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mesmaContaDoMl } from "./ml-conta.ts";

test("integração nova aceita qualquer conta do ML", () => {
  assert.equal(mesmaContaDoMl(null, 123), true);
  assert.equal(mesmaContaDoMl(undefined, 123), true);
});

test("reconectar com a mesma conta funciona (o banco devolve bigint como número ou texto)", () => {
  assert.equal(mesmaContaDoMl(123, 123), true);
  assert.equal(mesmaContaDoMl("123", 123), true);
});

test("reconectar com outra conta é recusado (sync-08)", () => {
  assert.equal(mesmaContaDoMl(123, 456), false);
});
