// Rodar: bun run test (Node 24 lê TypeScript direto).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBRL, formatBRLCompact, formatDate, formatDateTime, formatNumber, formatPercent } from "./format.ts";

// Intl usa espaço não separável depois de "R$".
const brl = (s: string) => s.replace(/\u00a0/g, " ");

test("valor ausente vira traço, zero continua zero (ui-04, regra 6 do CONTEXTO-IA)", () => {
  for (const vazio of [null, undefined, Number.NaN]) {
    assert.equal(formatBRL(vazio), "—");
    assert.equal(formatPercent(vazio), "—");
    assert.equal(formatNumber(vazio), "—");
    assert.equal(formatBRLCompact(vazio), "—");
  }
  assert.equal(brl(formatBRL(0)), "R$ 0,00");
  assert.equal(formatPercent(0), "0,0%");
  assert.equal(formatNumber(0), "0");
  assert.equal(brl(formatBRL(-1234.5)), "-R$ 1.234,50");
  assert.equal(brl(formatBRL(10, { showSign: true })), "+R$ 10,00");
});

test("data sem hora é dia de calendário (ui-02)", () => {
  assert.equal(formatDate("2026-09-17"), "17/09/2026");
  assert.equal(formatDate("2026-10-01"), "01/10/2026");
});

test("data com hora continua no horário de Brasília", () => {
  // 02:30 UTC do dia 18 ainda é dia 17 em São Paulo.
  assert.equal(formatDate("2026-09-18T02:30:00Z"), "17/09/2026");
  assert.equal(formatDateTime("2026-09-18T02:30:00Z"), "17/09/2026, 23:30");
});

test("data vazia vira traço", () => {
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate(""), "—");
});
