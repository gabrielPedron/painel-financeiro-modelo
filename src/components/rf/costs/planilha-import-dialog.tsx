import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

const MONTH_ABBR = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const YEAR_OPTIONS = [2024, 2025, 2026, 2027, 2028];

type Kind = "fixo" | "variavel";
type CategoryRec = { id: string; name: string; kind: Kind; parent_category_id: string | null };

type ParsedRow = {
  key: string;
  sheet: string;
  kind: Kind;
  name: string;
  values: (number | null)[];
  total: number;
};

function strip(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function monthIndexOf(header: string): number {
  const h = strip(header);
  if (!h) return -1;
  if (h.includes("total") || h.includes("%")) return -1;
  return MONTH_ABBR.findIndex((m) => h.startsWith(strip(m)));
}

function kindOfSheet(name: string): Kind | null {
  const n = strip(name);
  if (n.includes("resumo")) return null;
  if (n.includes("variave")) return "variavel";
  if (n.includes("fixo")) return "fixo";
  return null;
}

/** Lê o arquivo matricial (item × mês). Uma aba por seção de custo. */
export async function parseMatrixWorkbook(file: File): Promise<ParsedRow[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const out: ParsedRow[] = [];

  for (const sheetName of wb.SheetNames) {
    const kind = kindOfSheet(sheetName);
    if (!kind) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: true, defval: null });

    // Cabeçalho: primeira coluna "Item" seguida de meses
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const r = rows[i] ?? [];
      if (strip(cellText(r[0])).startsWith("item") && r.slice(1).some((c) => monthIndexOf(cellText(c)) >= 0)) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) continue;

    const header = rows[headerIdx] ?? [];
    const monthCols: { col: number; month: number }[] = [];
    for (let c = 1; c < header.length; c++) {
      const m = monthIndexOf(cellText(header[c]));
      if (m >= 0 && !monthCols.some((x) => x.month === m)) monthCols.push({ col: c, month: m });
    }
    if (!monthCols.length) continue;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const name = cellText(r[0]);
      if (!name) continue;
      const flat = strip(name);
      if (flat === "total" || flat.startsWith("total ")) continue;
      const values = Array(12).fill(null) as (number | null)[];
      for (const { col, month } of monthCols) values[month] = toNumber(r[col]);
      const total = values.reduce<number>((a, v) => a + (v ?? 0), 0);
      out.push({ key: `${sheetName}|${name}`, sheet: sheetName, kind, name, values, total });
    }
  }
  return out;
}

export function PlanilhaImportDialog({
  open, onOpenChange, defaultYear,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultYear: number;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [year, setYear] = useState(defaultYear);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [target, setTarget] = useState<Record<string, string>>({});
  const [parsing, setParsing] = useState(false);

  const { data: cats } = useQuery({
    queryKey: ["expense-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_categories")
        .select("id,name,kind,parent_category_id")
        .order("kind").order("sort_order").order("name");
      if (error) throw error;
      return (data ?? []) as CategoryRec[];
    },
  });

  const { data: existing } = useQuery({
    queryKey: ["expenses-flat"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("id,name,category_id");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; category_id: string }[];
    },
  });

  const catById = useMemo(() => new Map((cats ?? []).map((c) => [c.id, c])), [cats]);

  const suggest = (row: ParsedRow): string => {
    const match = (existing ?? []).find(
      (e) => strip(e.name) === strip(row.name) && catById.get(e.category_id)?.kind === row.kind,
    );
    if (match) return match.category_id;
    return (cats ?? []).find((c) => c.kind === row.kind)?.id ?? "";
  };

  const targetFor = (row: ParsedRow) => target[row.key] ?? suggest(row);

  const stats = useMemo(() => {
    let novos = 0, atualizados = 0;
    for (const r of rows) {
      const cid = targetFor(r);
      const found = (existing ?? []).some((e) => e.category_id === cid && strip(e.name) === strip(r.name));
      if (found) atualizados++; else novos++;
    }
    return { novos, atualizados, total: rows.reduce((a, r) => a + r.total, 0) };
  }, [rows, target, existing, cats]);

  const reset = () => { setRows([]); setFileName(""); setTarget({}); };

  const onFile = async (f: File) => {
    setParsing(true);
    try {
      const parsed = await parseMatrixWorkbook(f);
      if (!parsed.length) {
        toast.error("Não encontrei nenhuma aba de custos com cabeçalho 'Item' + meses.");
        return;
      }
      setRows(parsed);
      setFileName(f.name);
      setTarget({});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao ler o arquivo.");
    } finally {
      setParsing(false);
    }
  };

  const importar = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      let criados = 0, atualizados = 0, valores = 0;

      for (const r of rows) {
        const categoryId = targetFor(r);
        if (!categoryId) throw new Error(`Escolha a categoria de destino para "${r.name}".`);

        const { data: found, error: findErr } = await supabase
          .from("expenses").select("id,name").eq("category_id", categoryId);
        if (findErr) throw findErr;
        let expenseId = (found ?? []).find((e) => strip(e.name) === strip(r.name))?.id ?? null;

        if (expenseId) {
          atualizados++;
        } else {
          const { data: ins, error: insErr } = await supabase
            .from("expenses")
            .insert({ owner_id: uid, category_id: categoryId, name: r.name })
            .select("id").single();
          if (insErr) throw insErr;
          expenseId = ins.id;
          criados++;
        }

        const payload = r.values
          .map((v, i) => ({ v, i }))
          .filter((x) => x.v !== null)
          .map((x) => ({
            expense_id: expenseId as string,
            owner_id: uid,
            month: `${year}-${String(x.i + 1).padStart(2, "0")}-01`,
            amount: x.v as number,
          }));
        if (payload.length) {
          const { error: valErr } = await supabase
            .from("expense_values").upsert(payload, { onConflict: "expense_id,month" });
          if (valErr) throw valErr;
          valores += payload.length;
        }
      }
      return { criados, atualizados, valores };
    },
    onSuccess: (r) => {
      toast.success(`Importado: ${r.criados} gasto(s) criado(s), ${r.atualizados} atualizado(s), ${r.valores} valor(es) gravado(s).`);
      qc.invalidateQueries({ queryKey: ["expense-sheet"] });
      qc.invalidateQueries({ queryKey: ["expense-categories"] });
      qc.invalidateQueries({ queryKey: ["expenses-flat"] });
      reset();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao importar."),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Importar planilha (matriz item × mês)</DialogTitle>
          <DialogDescription>
            Cada aba do arquivo vira uma seção (fixo/variável). Linhas de TOTAL, colunas de total anual e % são ignoradas.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Ano dos valores</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }}
          />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={parsing}>
            <Upload className="h-4 w-4 mr-1" /> {parsing ? "Lendo…" : "Escolher arquivo"}
          </Button>
          {fileName && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <FileSpreadsheet className="h-3.5 w-3.5" /> {fileName}
            </span>
          )}
        </div>

        {rows.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground">
              {rows.length} linha(s) lida(s) — {stats.novos} gasto(s) novo(s), {stats.atualizados} existente(s). Total lido: {formatBRL(stats.total)}
            </p>
            <div className="max-h-[45vh] overflow-auto rounded-md border">
              <table className="w-full min-w-max text-xs border-collapse">
                <thead className="sticky top-0 bg-muted text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-2">Seção</th>
                    <th className="text-left px-2 py-2 min-w-[200px]">Gasto</th>
                    <th className="text-left px-2 py-2 min-w-[200px]">Categoria de destino</th>
                    {MONTH_ABBR.map((m) => <th key={m} className="text-right px-2 py-2">{m}</th>)}
                    <th className="text-right px-2 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className={cn("border-t", !r.total && "opacity-60")}>
                      <td className="px-2 py-1.5 whitespace-nowrap">{r.kind === "fixo" ? "Fixo" : "Variável"}</td>
                      <td className="px-2 py-1.5">{r.name}</td>
                      <td className="px-2 py-1.5">
                        <Select
                          value={targetFor(r)}
                          onValueChange={(v) => setTarget((t) => ({ ...t, [r.key]: v }))}
                        >
                          <SelectTrigger className="h-8"><SelectValue placeholder="Escolher…" /></SelectTrigger>
                          <SelectContent>
                            {(cats ?? []).filter((c) => c.kind === r.kind).map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      {r.values.map((v, i) => (
                        <td key={i} className="text-right px-2 py-1.5 tabular-nums">
                          {v === null ? <span className="text-muted-foreground/60">—</span> : formatBRL(v)}
                        </td>
                      ))}
                      <td className="text-right px-2 py-1.5 tabular-nums font-medium">{formatBRL(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() => importar.mutate()}
            disabled={!rows.length || importar.isPending}
          >
            {importar.isPending ? "Importando…" : `Importar ${rows.length || ""} gasto(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
