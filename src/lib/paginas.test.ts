// Rodar: bun run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { todasAsPaginas } from "./paginas.ts";

// Simula a API do banco: devolve no máximo `teto` linhas por pedido, como o Supabase.
function fonte(total: number, teto = 1000) {
  const linhas = Array.from({ length: total }, (_, i) => ({ id: i }));
  const pedidos: Array<[number, number]> = [];
  const buscar = async (de: number, ate: number) => {
    pedidos.push([de, ate]);
    return { data: linhas.slice(de, Math.min(ate + 1, de + teto)), error: null };
  };
  return { buscar, pedidos };
}

test("junta todas as páginas acima de 1.000 linhas (din-12)", async () => {
  const { buscar, pedidos } = fonte(1322);
  const linhas = await todasAsPaginas(buscar);
  assert.equal(linhas.length, 1322);
  assert.deepEqual(linhas.map((l) => l.id), Array.from({ length: 1322 }, (_, i) => i));
  assert.deepEqual(pedidos, [[0, 999], [1000, 1999]]);
});

test("para na primeira página quando ela vem incompleta", async () => {
  const { buscar, pedidos } = fonte(37);
  assert.equal((await todasAsPaginas(buscar)).length, 37);
  assert.equal(pedidos.length, 1);
});

test("múltiplo exato de 1.000 pede uma página a mais e para no vazio", async () => {
  const { buscar, pedidos } = fonte(2000);
  assert.equal((await todasAsPaginas(buscar)).length, 2000);
  assert.equal(pedidos.length, 3);
});

test("erro em qualquer página é repassado, sem devolver lista pela metade", async () => {
  let n = 0;
  const buscar = async () => (++n === 2 ? { data: null, error: new Error("timeout") } : { data: Array(1000).fill({}), error: null });
  await assert.rejects(todasAsPaginas(buscar), /timeout/);
});
