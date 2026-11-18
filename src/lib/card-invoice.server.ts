import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type DB = SupabaseClient<Database>;

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

/** Mesma lógica da função SQL public.normalize_desc */
export function normalizeDesc(texto: string | null | undefined): string {
  return (texto ?? "")
    .replace(/\(\s*\d+\s*\/\s*\d+\s*\)/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[*#]+/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function parseValor(v: unknown): number | null {
  if (typeof v === "number") return v;
  const s = cellText(v);
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.includes("-");
  const limpo = s.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(limpo.replace(/-/g, ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Aceita Date, "13/06", "13/06/2026" ou serial do Excel */
function parseData(v: unknown, anoFallback: number): string | null {
  if (v instanceof Date) return ymd(v);
  if (typeof v === "number" && v > 20000 && v < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = cellText(v);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  let ano = m[3] ? Number(m[3]) : anoFallback;
  if (ano < 100) ano += 2000;
  if (!dia || !mes || mes > 12) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function mapTipo(bruto: string): "a_vista" | "parcelada" | "internacional" | null {
  const t = stripAccents(bruto);
  if (!t) return null;
  if (t.includes("internacional")) return "internacional";
  if (t.includes("parcela")) return "parcelada";
  if (t.includes("vista")) return "a_vista";
  return null;
}

export type ParsedItem = {
  data_compra: string | null;
  descricao: string;
  descricao_normalizada: string;
  valor: number;
  tipo_compra: "a_vista" | "parcelada" | "internacional" | null;
  parcela_atual: number | null;
  parcela_total: number | null;
  codigo_autorizacao: string | null;
  final_cartao: string | null;
  credito: boolean;
};

export type ParsedInvoice = {
  referencia: string | null;
  vencimento: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  total_fatura: number | null;
  itens: ParsedItem[];
};

/** Assinatura CFB (D0 CF 11 E0) = arquivo Office criptografado */
function isCfbEncrypted(buf: Uint8Array): boolean {
  return (
    buf.length > 8 &&
    buf[0] === 0xd0 &&
    buf[1] === 0xcf &&
    buf[2] === 0x11 &&
    buf[3] === 0xe0
  );
}

/**
 * Lê o Excel da fatura BTG (aba "Titular") a partir de um base64.
 * Se o arquivo estiver protegido (padrão BTG), descriptografa com a senha (CPF).
 * A senha só é usada em memória — nunca é gravada.
 */
export async function parseBtgXlsx(base64: string, senha?: string): Promise<ParsedInvoice> {
  let buf: Uint8Array = Buffer.from(base64, "base64");

  if (isCfbEncrypted(buf)) {
    const limpa = (senha ?? "").replace(/\D/g, "");
    if (!limpa) {
      throw new Error(
        "Esta fatura está protegida. Informe a senha (seu CPF) no campo abaixo.",
      );
    }
    try {
      const officeCrypto = (await import("officecrypto-tool")).default;
      buf = await officeCrypto.decrypt(Buffer.from(buf) as Buffer, { password: limpa });
    } catch {
      throw new Error(
        "Senha incorreta. A senha da fatura BTG costuma ser o CPF do titular (só números).",
      );
    }
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/password|encrypt/i.test(msg)) {
      throw new Error(
        "Esta fatura está protegida. Informe a senha (seu CPF) no campo abaixo.",
      );
    }
    throw new Error(`Não consegui ler a planilha: ${msg}`);
  }

  const sheetName =
    wb.SheetNames.find((n) => stripAccents(n).includes("titular")) ?? wb.SheetNames[0];
  if (!sheetName) throw new Error("A planilha não tem abas.");
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Aba "${sheetName}" não encontrada.`);

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: null,
  });

  const rowText = (r: unknown[]) => r.map(cellText).filter(Boolean).join(" | ");

  // --- Cabeçalho ---
  const cabecalho = rows.slice(0, 25).map(rowText).join("\n");
  const plano = stripAccents(cabecalho);

  let ano = new Date().getFullYear();
  const anoM = cabecalho.match(/(20\d{2})/);
  if (anoM?.[1]) ano = Number(anoM[1]);

  let referencia: string | null = null;
  const mesM = plano.match(
    /\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b[^\d]{0,10}(20\d{2})?/,
  );
  if (mesM?.[1]) {
    const mes = MESES[mesM[1]] ?? 1;
    if (mesM[2]) ano = Number(mesM[2]);
    referencia = `${ano}-${String(mes).padStart(2, "0")}`;
  } else {
    const refM = cabecalho.match(/\b(0?[1-9]|1[0-2])\/(20\d{2})\b/);
    if (refM?.[1] && refM[2]) {
      referencia = `${refM[2]}-${String(Number(refM[1])).padStart(2, "0")}`;
    }
  }

  let periodo_inicio: string | null = null;
  let periodo_fim: string | null = null;
  const perM = plano.match(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*(?:ate|a|-)\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
  if (perM?.[1] && perM[2]) {
    periodo_inicio = parseData(perM[1], ano);
    periodo_fim = parseData(perM[2], ano);
  }

  let vencimento: string | null = null;
  const vencLinha = rows.slice(0, 25).map(rowText).find((t) => stripAccents(t).includes("vencimento"));
  if (vencLinha) {
    const vm = vencLinha.match(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
    if (vm?.[1]) vencimento = parseData(vm[1], ano);
  }

  let total_fatura: number | null = null;
  const totalLinha = rows.slice(0, 25).find((r) => stripAccents(rowText(r)).includes("total da fatura"));
  if (totalLinha) {
    for (const c of totalLinha) {
      const v = parseValor(c);
      if (v !== null && Math.abs(v) > 0) total_fatura = v;
    }
  }

  if (!referencia && periodo_fim) referencia = periodo_fim.slice(0, 7);

  // --- Seção de compras ---
  let emCompras = false;
  let emPagamentos = false;
  const itens: ParsedItem[] = [];

  for (const r of rows) {
    const texto = rowText(r);
    const plana = stripAccents(texto);
    if (!texto) continue;

    if (plana.includes("pagamentos feitos pelo cliente")) {
      emPagamentos = true;
      emCompras = false;
      continue;
    }
    if (plana.includes("tipo de compra") && plana.includes("descricao")) {
      emCompras = true;
      emPagamentos = false;
      continue;
    }
    if (!emCompras || emPagamentos) continue;

    const descricao = cellText(r[2]);
    const valor = parseValor(r[4]);
    const data_compra = parseData(r[1], ano);
    if (!descricao || valor === null) continue;
    if (stripAccents(descricao).startsWith("total")) continue;

    const parc = descricao.match(/\((\d+)\s*\/\s*(\d+)\)/);
    const parcela_atual = parc?.[1] ? Number(parc[1]) : null;
    const parcela_total = parc?.[2] ? Number(parc[2]) : null;

    let tipo = mapTipo(cellText(r[5]));
    if (!tipo && parcela_total && parcela_total > 1) tipo = "parcelada";

    itens.push({
      data_compra,
      descricao,
      descricao_normalizada: normalizeDesc(descricao),
      valor,
      tipo_compra: tipo,
      parcela_atual,
      parcela_total,
      codigo_autorizacao: cellText(r[6]) || null,
      final_cartao: cellText(r[7]) || null,
      credito: valor < 0,
    });
  }

  if (itens.length === 0) {
    throw new Error(
      "Não encontrei nenhuma compra na planilha. Confira se é a fatura do BTG (aba \"Titular\") e se o arquivo não está protegido por senha.",
    );
  }

  return { referencia, vencimento, periodo_inicio, periodo_fim, total_fatura, itens };
}

type Regra = Database["public"]["Tables"]["card_rules"]["Row"];

function regraCasa(regra: Regra, item: ParsedItem): boolean {
  const alvo = item.descricao_normalizada;
  const padrao = normalizeDesc(regra.padrao);
  if (!padrao) return false;
  const bate =
    regra.match_tipo === "exato"
      ? alvo === padrao
      : regra.match_tipo === "comeca"
        ? alvo.startsWith(padrao)
        : alvo.includes(padrao);
  if (!bate) return false;
  const v = Math.abs(item.valor);
  if (regra.valor_min !== null && v < Number(regra.valor_min)) return false;
  if (regra.valor_max !== null && v > Number(regra.valor_max)) return false;
  return true;
}

export type ImportSummary = {
  invoice_id: string;
  referencia: string | null;
  vencimento: string | null;
  total_fatura: number | null;
  total_itens: number;
  total_valor: number;
  casado_previsto: number;
  casado_valor_diferente: number;
  sem_destino: number;
  parcelas: number;
  creditos: number;
  duplicatas_suspeitas: number;
};

/**
 * Importa a fatura: cria card_invoices, insere os itens já classificados.
 * Nada é lançado como pago — só classificação.
 */
export async function importBtgInvoice(
  supabase: DB,
  ownerId: string,
  base64: string,
  banco = "BTG",
  senha?: string,
): Promise<ImportSummary> {
  const parsed = await parseBtgXlsx(base64, senha);
  if (!parsed.referencia) {
    throw new Error("Não foi possível identificar o mês de referência da fatura.");
  }

  // Regras ativas
  const { data: regras, error: errRegras } = await supabase
    .from("card_rules")
    .select("*")
    .eq("ativo", true);
  if (errRegras) throw new Error(errRegras.message);

  // Mês de competência da fatura (para buscar o previsto)
  const mesRef = parsed.referencia ? `${parsed.referencia}-01` : null;
  const previstoPorGasto = new Map<string, number>();
  if (mesRef) {
    const { data: valores, error: errVal } = await supabase
      .from("expense_values")
      .select("expense_id, amount")
      .eq("month", mesRef);
    if (errVal) throw new Error(errVal.message);
    for (const v of valores ?? []) {
      previstoPorGasto.set(v.expense_id, Number(v.amount) + (previstoPorGasto.get(v.expense_id) ?? 0));
    }
  }

  // Uma fatura já lançada só pode ser reimportada após o desfazer explícito.
  // O gatilho no banco também bloqueia a corrida entre esta leitura e o upsert.
  const { data: anterior, error: errAnterior } = await supabase
    .from("card_invoices")
    .select("id,status")
    .eq("owner_id", ownerId)
    .eq("banco", banco)
    .eq("referencia", parsed.referencia)
    .maybeSingle();
  if (errAnterior) throw new Error(errAnterior.message);
  if (anterior?.status === "concluida") {
    throw new Error("Esta fatura já foi lançada. Desfaça o lançamento abaixo antes de reimportar.");
  }

  // Cria/atualiza a fatura
  const { data: invoice, error: errInv } = await supabase
    .from("card_invoices")
    .upsert(
      {
        owner_id: ownerId,
        banco,
        referencia: parsed.referencia,
        vencimento: parsed.vencimento,
        periodo_inicio: parsed.periodo_inicio,
        periodo_fim: parsed.periodo_fim,
        total_fatura: parsed.total_fatura,
        status: "revisao",
      },
      { onConflict: "owner_id,banco,referencia" },
    )
    .select("id")
    .single();
  if (errInv || !invoice) throw new Error(errInv?.message ?? "Falha ao criar a fatura.");

  // Reimportação: limpa os itens anteriores dessa fatura
  const { error: errDel } = await supabase
    .from("card_invoice_items")
    .delete()
    .eq("invoice_id", invoice.id);
  if (errDel) throw new Error(errDel.message);

  // Duplicatas reais: mesma descrição normalizada + mesmo valor + mesma data
  const chaves = new Map<string, number>();
  for (const it of parsed.itens) {
    const k = `${it.descricao_normalizada}|${it.valor}|${it.data_compra ?? ""}`;
    chaves.set(k, (chaves.get(k) ?? 0) + 1);
  }

  const resumo: ImportSummary = {
    invoice_id: invoice.id,
    referencia: parsed.referencia,
    vencimento: parsed.vencimento,
    total_fatura: parsed.total_fatura,
    total_itens: parsed.itens.length,
    total_valor: 0,
    casado_previsto: 0,
    casado_valor_diferente: 0,
    sem_destino: 0,
    parcelas: 0,
    creditos: 0,
    duplicatas_suspeitas: 0,
  };

  const linhas = parsed.itens.map((it) => {
    resumo.total_valor += it.valor;
    if ((it.parcela_total ?? 0) > 1) resumo.parcelas += 1;
    if (it.credito) resumo.creditos += 1;

    const k = `${it.descricao_normalizada}|${it.valor}|${it.data_compra ?? ""}`;
    const dup = (chaves.get(k) ?? 0) > 1;

    const regra = (regras ?? []).find((r) => regraCasa(r, it));
    let match_status:
      | "casado_previsto"
      | "casado_valor_diferente"
      | "sem_destino" = "sem_destino";
    let valor_previsto: number | null = null;
    const obs: string[] = [];

    if (regra) {
      const previsto = regra.expense_id ? (previstoPorGasto.get(regra.expense_id) ?? null) : null;
      if (previsto !== null && previsto > 0) {
        valor_previsto = previsto;
        const tol = Math.max(1, Math.abs(previsto) * 0.02);
        match_status =
          Math.abs(Math.abs(it.valor) - previsto) <= tol
            ? "casado_previsto"
            : "casado_valor_diferente";
        if (match_status === "casado_valor_diferente") {
          obs.push(`Valor diferente do previsto (previsto R$ ${previsto.toFixed(2)}).`);
        }
      } else {
        match_status = "casado_valor_diferente";
        obs.push("Sem valor previsto para este mês.");
      }
    }

    if (it.credito) obs.push("Crédito/estorno (valor negativo).");
    if ((it.parcela_total ?? 0) > 1) {
      obs.push(`Parcela ${it.parcela_atual}/${it.parcela_total}.`);
    }
    if (dup) {
      obs.push("Possível duplicata: mesma descrição, valor e data.");
      resumo.duplicatas_suspeitas += 1;
    }

    resumo[match_status] += 1;

    return {
      invoice_id: invoice.id,
      owner_id: ownerId,
      data_compra: it.data_compra,
      descricao: it.descricao,
      descricao_normalizada: it.descricao_normalizada,
      valor: it.valor,
      tipo_compra: it.tipo_compra,
      parcela_atual: it.parcela_atual,
      parcela_total: it.parcela_total,
      codigo_autorizacao: it.codigo_autorizacao,
      final_cartao: it.final_cartao,
      match_status,
      expense_id: regra?.expense_id ?? null,
      expense_category_id: regra?.expense_category_id ?? null,
      valor_previsto,
      observacao: obs.length ? obs.join(" ") : null,
    };
  });

  const { error: errIns } = await supabase.from("card_invoice_items").insert(linhas);
  if (errIns) throw new Error(errIns.message);

  return resumo;
}
