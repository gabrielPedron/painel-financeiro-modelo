import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { protegerCachePorSessao } from "./cache-por-sessao.ts";

test("troca de identidade limpa consultas guardadas e liberação remove o observador", () => {
  const cliente = new QueryClient();
  let notificar: (evento: string, id?: string | null) => void = () => {};
  let cancelou = false;
  const liberar = protegerCachePorSessao(cliente, (callback) => {
    notificar = callback;
    return { unsubscribe: () => { cancelou = true; } };
  });
  cliente.setQueryData(["my-screens"], { keys: ["*"], isAdmin: true });
  cliente.setQueryData(["exemplo", "chamadas"], [{ item: "primeiro" }]);
  notificar("SIGNED_IN", "usuario-a");
  assert.equal(cliente.getQueryData(["my-screens"]), undefined);
  assert.equal(cliente.getQueryData(["exemplo", "chamadas"]), undefined);
  cliente.setQueryData(["exemplo", "credenciais"], [{ nome: "antiga" }]);
  notificar("SIGNED_OUT", null);
  assert.equal(cliente.getQueryData(["exemplo", "credenciais"]), undefined);
  notificar("SIGNED_IN", "usuario-b");
  cliente.setQueryData(["my-screens"], { keys: ["dashboard"] });
  notificar("TOKEN_REFRESHED", "usuario-b");
  assert.deepEqual(cliente.getQueryData(["my-screens"]), { keys: ["dashboard"] });
  liberar();
  assert.equal(cancelou, true);
});

test("sessão inicial desconhecida descarta cache de usuário anterior", () => {
  const cliente = new QueryClient();
  cliente.setQueryData(["my-screens"], { keys: ["*"] });
  let notificar: (evento: string) => void = () => {};
  protegerCachePorSessao(cliente, (callback) => {
    notificar = callback;
    return { unsubscribe: () => {} };
  });
  notificar("INITIAL_SESSION");
  assert.equal(cliente.getQueryData(["my-screens"]), undefined);
});

test("evento de MFA para a mesma identidade não desmonta o formulário", () => {
  const cliente = new QueryClient();
  let notificar: (evento: string, id?: string | null) => void = () => {};
  let montagens = 0;
  protegerCachePorSessao(cliente, (callback) => {
    notificar = callback;
    return { unsubscribe: () => {} };
  }, () => { montagens += 1; });
  notificar("INITIAL_SESSION", "usuario-a");
  notificar("SIGNED_IN", "usuario-a");
  notificar("USER_UPDATED", "usuario-a");
  assert.equal(montagens, 1);
});

test("troca de usuário pede remontagem dos observadores ativos", () => {
  const cliente = new QueryClient();
  const chave = ["exemplo", "credenciais"];
  cliente.setQueryData(chave, [{ nome: "antiga" }]);
  const observadorAntigo = new QueryObserver(cliente, { queryKey: chave, queryFn: async () => [] });
  const desassinar = observadorAntigo.subscribe(() => {});
  let notificar: (evento: string, id?: string | null) => void = () => {};
  const mudancas: Array<string | null> = [];
  protegerCachePorSessao(cliente, (callback) => {
    notificar = callback;
    return { unsubscribe: () => {} };
  }, (id) => mudancas.push(id));
  notificar("INITIAL_SESSION", "usuario-a");
  cliente.setQueryData(chave, [{ nome: "antiga" }]);
  notificar("SIGNED_IN", "usuario-b");
  assert.deepEqual(mudancas, ["usuario-a", "usuario-b"]);
  const observadorNovo = new QueryObserver(cliente, { queryKey: chave, enabled: false });
  assert.equal(observadorNovo.getCurrentResult().data, undefined);
  desassinar();
});

test("recuperação de senha e renovação que mudam o usuário eliminam cache e observadores", () => {
  const cliente = new QueryClient();
  let notificar: (evento: string, id?: string | null) => void = () => {};
  const mudancas: Array<string | null> = [];
  protegerCachePorSessao(cliente, (callback) => {
    notificar = callback;
    return { unsubscribe: () => {} };
  }, (id) => mudancas.push(id));
  notificar("INITIAL_SESSION", "usuario-a");
  cliente.setQueryData(["exemplo", "credenciais"], [{ nome: "do usuario a" }]);
  notificar("PASSWORD_RECOVERY", "usuario-b");
  assert.equal(cliente.getQueryData(["exemplo", "credenciais"]), undefined);
  cliente.setQueryData(["exemplo", "chamadas"], [{ conta: "do usuario b" }]);
  notificar("TOKEN_REFRESHED", "usuario-c");
  assert.equal(cliente.getQueryData(["exemplo", "chamadas"]), undefined);
  assert.deepEqual(mudancas, ["usuario-a", "usuario-b", "usuario-c"]);
});
