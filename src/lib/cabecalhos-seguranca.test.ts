// Rodar: bun run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { comCabecalhosDeSeguranca } from "./cabecalhos-seguranca.ts";

test("página ganha a proteção contra ser embutida (seg-08)", async () => {
  const r = comCabecalhosDeSeguranca(new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }));
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("content-security-policy"), "frame-ancestors 'none'");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("content-type"), "text/html");
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "<html></html>");
});

test("mantém status, corpo e cabeçalhos da resposta, inclusive redirecionamento", () => {
  const r = comCabecalhosDeSeguranca(Response.redirect("https://exemplo.com/login", 302));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "https://exemplo.com/login");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
});

test("não sobrescreve cabeçalho que a resposta já trouxe", () => {
  const r = comCabecalhosDeSeguranca(new Response("", { headers: { "Referrer-Policy": "no-referrer" } }));
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
});
