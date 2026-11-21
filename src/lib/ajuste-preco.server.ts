// Leitura de preço do Mercado Livre para a aba Ajuste de preço (somente servidor: usa o token da conta).
// O ml_items.price é o cheio, mas só muda quando o catálogo é sincronizado à mão; aqui o preço cheio e a
// promoção ativa vêm do /items/{id}/prices na hora e ficam em ajuste_preco, de onde a tela e o MCP leem.
// Só lê o ML; grava apenas a leitura (e a base do anúncio novo), pela função do banco.
import { supabaseAdmin } from "./ml-oauth.server";
import { getAccountToken, mlGet } from "./ml-sync.server";
import { interpretarPrecos, type LeituraPreco } from "./ajuste-preco.ts";

const MLB = /^MLB\d+$/;
/** Anúncios lidos por vez. */
const LOTE = 4;
/** Teto de anúncios por leitura (2 chamadas cada). */
export const MAX_ANUNCIOS = 200;

export async function lerPrecosDoML(
  token: string,
  itemIds: string[],
): Promise<{ leituras: LeituraPreco[]; falhas: string[] }> {
  const leituras: LeituraPreco[] = [];
  const falhas: string[] = [];
  for (let i = 0; i < itemIds.length; i += LOTE) {
    await Promise.all(itemIds.slice(i, i + LOTE).map(async (id) => {
      try {
        const [precos, venda] = await Promise.all([
          mlGet(`/items/${id}/prices`, token),
          mlGet(`/items/${id}/sale_price?context=channel_marketplace`, token),
        ]);
        const leitura = precos.status === 200
          ? interpretarPrecos(id, precos.body, venda.status === 200 ? venda.body : null)
          : null;
        if (leitura) leituras.push(leitura);
        else falhas.push(id);
      } catch {
        falhas.push(id);
      }
    }));
  }
  return { leituras, falhas };
}

/** Os anúncios que a releitura cobre sem lista: os que já estão em ajuste_preco e os vendidos em 15 dias. */
async function anunciosDaConta(accountId: string): Promise<string[]> {
  const { data: linhas, error } = await supabaseAdmin
    .from("ajuste_preco").select("item_id").eq("account_id", accountId);
  if (error) throw new Error(`Ajuste de preço: ${error.message}`);
  const hoje = new Date();
  const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
  const { data: vendidos, error: erroVendas } = await supabaseAdmin.rpc("anuncios_margem", {
    _account_ids: [accountId],
    _from: ymd(new Date(hoje.getTime() - 15 * 86_400_000)),
    _to: ymd(new Date(hoje.getTime() - 86_400_000)),
  });
  if (erroVendas) throw new Error(`Anúncios vendidos: ${erroVendas.message}`);
  return [...(linhas ?? []).map((l) => l.item_id), ...(vendidos ?? []).map((v) => v.item_id)];
}

/**
 * Lê no ML o preço cheio e a promoção ativa dos anúncios e grava a leitura em ajuste_preco.
 * Sem lista, cobre os anúncios que já têm linha e os vendidos nos últimos 15 dias.
 */
export async function atualizarLeiturasDaConta(
  accountId: string,
  itemIds?: string[],
): Promise<{ lidos: number; falhas: string[] }> {
  const ids = [...new Set((itemIds ?? (await anunciosDaConta(accountId))).filter((id) => MLB.test(id)))]
    .slice(0, MAX_ANUNCIOS);
  if (ids.length === 0) return { lidos: 0, falhas: [] };
  const { token } = await getAccountToken(accountId);
  const { leituras, falhas } = await lerPrecosDoML(token, ids);
  if (leituras.length > 0) {
    const { error } = await supabaseAdmin.rpc("ajuste_preco_gravar_leitura", {
      _account_id: accountId,
      _leituras: leituras as never,
    });
    if (error) throw new Error(`Gravar leitura de preço: ${error.message}`);
  }
  return { lidos: leituras.length, falhas };
}

/** Releitura diária (auditoria das 6h30): todas as contas do Mercado Livre conectadas. Uma falha não para as outras. */
export async function atualizarLeiturasDeTodasAsContas(): Promise<{ contas: number; lidos: number; erros: string[] }> {
  const { data: contas, error } = await supabaseAdmin
    .from("marketplace_accounts").select("id, nickname")
    .eq("platform", "mercado_livre").eq("status", "conectada");
  if (error) throw new Error(error.message);
  let lidos = 0;
  const erros: string[] = [];
  for (const conta of contas ?? []) {
    try {
      const r = await atualizarLeiturasDaConta(conta.id);
      lidos += r.lidos;
      if (r.falhas.length) erros.push(`${conta.nickname}: sem leitura de ${r.falhas.join(", ")}`);
    } catch (e) {
      erros.push(`${conta.nickname}: ${(e as Error).message}`);
    }
  }
  return { contas: (contas ?? []).length, lidos, erros };
}
