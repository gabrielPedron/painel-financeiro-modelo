// Rodar: bun run test (Node 24 lê TypeScript direto).
import { test } from "node:test";
import assert from "node:assert/strict";
import { destinoTelegram } from "./telegram-destino.ts";

test("destino do alerta: chat sozinho ou chat:tópico", () => {
  assert.deepEqual(destinoTelegram("-1004490129709"), { chat_id: "-1004490129709" });
  assert.deepEqual(destinoTelegram("-1004490129709:146"), { chat_id: "-1004490129709", message_thread_id: 146 });
  assert.deepEqual(destinoTelegram(" -1004490129709 : 146 "), { chat_id: "-1004490129709", message_thread_id: 146 });
  assert.deepEqual(destinoTelegram("5355298880"), { chat_id: "5355298880" });
  assert.deepEqual(destinoTelegram("@meucanal"), { chat_id: "@meucanal" });
});

test("o tópico Geral (1) vai sem message_thread_id", () => {
  assert.deepEqual(destinoTelegram("-1004490129709:1"), { chat_id: "-1004490129709" });
});

test("destino inválido vira nulo, para o envio falhar com mensagem clara", () => {
  for (const ruim of [null, undefined, "", "abc", "-100:abc", "-100:146:2", "https://t.me/c/4490129709/146/147"]) {
    assert.equal(destinoTelegram(ruim), null);
  }
});
