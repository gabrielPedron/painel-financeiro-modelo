// Rodar: bun run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { podeUsar } from "./equipe.ts";

test("administrador pode tudo (my_screens devolve '*')", () => {
  assert.equal(podeUsar(["*"], "configuracoes:auditoria"), true);
});

test("membro só pode o que tem a aba (seg-05)", () => {
  const telas = ["dashboard", "configuracoes", "configuracoes:telegram"];
  assert.equal(podeUsar(telas, "configuracoes:telegram"), true);
  assert.equal(podeUsar(telas, "configuracoes:auditoria"), false);
  // Ter a tela Configurações não libera as abas dela.
  assert.equal(podeUsar(telas, "configuracoes:regras"), false);
});

test("ação que aparece em duas telas aceita qualquer uma delas", () => {
  // "Sincronizar agora" fica na tela Mercado Livre e na aba Integrações.
  const sinc = ["mercado-livre", "configuracoes:integracoes"];
  assert.equal(podeUsar(["mercado-livre"], sinc), true);
  assert.equal(podeUsar(["configuracoes:integracoes"], sinc), true);
  assert.equal(podeUsar(["dashboard"], sinc), false);
});

test("sem nenhuma tela, não pode nada", () => {
  assert.equal(podeUsar([], "configuracoes:integracoes"), false);
});
