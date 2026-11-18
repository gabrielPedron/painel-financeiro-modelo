import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FileSpreadsheet, Pencil, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/rf/empty-state";
import { RentalOverview } from "@/components/rf/rental-overview";
import { formatBRL, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const MONTH_ABBR = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const YEAR_OPTIONS = [2025, 2026, 2027];


export const Route = createFileRoute("/_authenticated/faturamento-locacao")({
  head: () => ({
    meta: [
      { title: "Faturamento locação — Painel Financeiro" },
      { name: "description", content: "Faturamento bruto por cliente e por mês da operação de locação." },
    ],
  }),
  component: FaturamentoLocacaoPage,
  errorComponent: ({ error }) => (
    <div className="p-6">
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="p-4 space-y-2">
          <h2 className="text-sm font-semibold text-destructive">Erro ao carregar a tela</h2>
          <p className="text-xs text-muted-foreground font-mono">{error instanceof Error ? error.message : String(error)}</p>
        </CardContent>
      </Card>
    </div>
  ),
});

// ============ Faturas importadas ============

function FaturamentoLocacaoPage() {
  const [tab, setTab] = useState<"visao" | "faturas">("visao");
  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-primary">Faturamento locação</h1>
        <p className="text-sm text-muted-foreground">
          Faturamento bruto da operação de locação, a partir das faturas importadas do sistema.
        </p>
      </header>
      <Tabs value={tab} onValueChange={(v) => setTab(v as "visao" | "faturas")}>
        <TabsList>
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          <TabsTrigger value="faturas">Faturas importadas</TabsTrigger>
        </TabsList>
        <TabsContent value="visao" className="mt-4">
          <RentalOverview onGoToImport={() => setTab("faturas")} />
        </TabsContent>
        <TabsContent value="faturas" className="mt-4">
          <FaturasImportadasView />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type ParsedInvoice = {
  talao: string;
  fatura_num: string;
  cnpj: string | null;
  cnpj_raiz: string | null;
  nome_fantasia: string | null;
  razao_social: string | null;
  municipio: string | null;
  uf: string | null;
  valor: number;
  vencimento: string; // YYYY-MM-DD
  month: string;      // YYYY-MM-01
};

const MONTH_OPTIONS = [
  { v: "all", label: "Ano inteiro" },
  ...MONTH_ABBR.map((m, i) => ({ v: String(i + 1), label: m })),
];

function onlyDigits(s: string | null | undefined): string {
  return String(s ?? "").replace(/\D+/g, "");
}
function excelSerialToDate(n: number): Date {
  // Excel serial: days since 1899-12-30 (accounts for 1900 leap bug)
  const ms = Math.round((n - 25569) * 86400 * 1000);
  return new Date(ms);
}
function parseVencimento(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) {
    if (!Number.isFinite(raw.getTime())) return null;
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const d = excelSerialToDate(raw);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    let yyyy = Number(m[3]);
    if (yyyy < 100) yyyy += 2000;
    if (!dd || !mm || !yyyy) return null;
    return `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  return null;
}
function parseValor(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s = String(raw).replace(/\s|R\$/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function monthFromDate(dateISO: string): string {
  return `${dateISO.slice(0, 7)}-01`;
}
function monthLabel(monthISO: string): string {
  const d = new Date(monthISO + "T00:00:00");
  const m = MONTH_ABBR[d.getUTCMonth()];
  return `${m.toLowerCase()}/${d.getUTCFullYear()}`;
}

function FaturasImportadasView() {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState<number>(
    YEAR_OPTIONS.includes(now.getFullYear()) ? now.getFullYear() : YEAR_OPTIONS[0],
  );
  const [monthSel, setMonthSel] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const monthNum = monthSel === "all" ? null : Number(monthSel);

  const grouped = useQuery({
    queryKey: ["rental-invoices-grouped", year, monthNum],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      const { data, error } = await supabase.rpc("rental_invoices_grouped", {
        _owner: uid, _year: year, _month: monthNum ?? undefined,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        cnpj_raiz: r.cnpj_raiz as string,
        grupo_label: r.grupo_label as string,
        faturas: Number(r.faturas),
        total: Number(r.total),
      }));
    },
  });

  const rows = grouped.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.grupo_label.toLowerCase().includes(q) || r.cnpj_raiz.includes(q),
    );
  }, [rows, search]);

  const totalPeriodo = rows.reduce((a, b) => a + b.total, 0);
  const totalFaturas = rows.reduce((a, b) => a + b.faturas, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Ano</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {YEAR_OPTIONS.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Mês</Label>
            <Select value={monthSel} onValueChange={setMonthSel}>
              <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTH_OPTIONS.map((o) => (
                  <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button size="sm" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4 mr-1" /> Importar faturas (Excel)
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <div className="text-[11px] uppercase text-muted-foreground">Total do período</div>
            <div className="text-xl font-semibold tabular-nums">{formatBRL(totalPeriodo)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-muted-foreground">Faturas</div>
            <div className="text-xl font-semibold tabular-nums">{totalFaturas}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-muted-foreground">Grupos</div>
            <div className="text-xl font-semibold tabular-nums">{rows.length}</div>
          </div>
        </CardContent>
      </Card>

      {rows.length === 0 && !grouped.isLoading ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              icon={FileSpreadsheet}
              title="Nenhuma fatura importada no período"
              description="Importe o Excel exportado do seu sistema de faturamento para começar."
              action={
                <Button size="sm" onClick={() => setImportOpen(true)}>
                  <Upload className="h-4 w-4 mr-1" /> Importar faturas (Excel)
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="relative max-w-md">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar grupo por nome ou CNPJ..."
              className="pl-7 h-9"
            />
          </div>
          <Card>
            <CardContent className="p-0 divide-y">
              {filtered.map((g) => (
                <GroupRow
                  key={g.cnpj_raiz}
                  group={g}
                  year={year}
                  monthNum={monthNum}
                  onRenamed={() => qc.invalidateQueries({ queryKey: ["rental-invoices-grouped"] })}
                />
              ))}
              {filtered.length === 0 && (
                <div className="p-4 text-xs text-muted-foreground">Nenhum grupo corresponde à busca.</div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

function GroupRow({
  group, year, monthNum, onRenamed,
}: {
  group: { cnpj_raiz: string; grupo_label: string; faturas: number; total: number };
  year: number;
  monthNum: number | null;
  onRenamed: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState(group.grupo_label);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editing, setEditing] = useState<null | {
    id: string;
    nome_fantasia: string;
    municipio: string;
    uf: string;
    vencimento: string;
    valor: string;
  }>(null);

  const from = `${year}-01-01`;
  const to = `${year}-12-01`;
  const monthFrom = monthNum ? `${year}-${String(monthNum).padStart(2, "0")}-01` : from;
  const monthTo = monthNum ? `${year}-${String(monthNum).padStart(2, "0")}-01` : to;

  const detail = useQuery({
    enabled: open,
    queryKey: ["rental-invoices-detail", group.cnpj_raiz, year, monthNum],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_invoices")
        .select("id,nome_fantasia,municipio,uf,vencimento,valor,month")
        .eq("cnpj_raiz", group.cnpj_raiz)
        .gte("month", monthFrom)
        .lte("month", monthTo)
        .order("vencimento", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const rename = useMutation({
    mutationFn: async () => {
      const label = labelDraft.trim();
      if (!label) throw new Error("Informe um nome.");
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      const { error } = await supabase
        .from("rental_group_labels")
        .upsert(
          { owner_id: uid, cnpj_raiz: group.cnpj_raiz, label },
          { onConflict: "owner_id,cnpj_raiz" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Grupo renomeado.");
      setRenameOpen(false);
      onRenamed();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao renomear."),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["rental-invoices-detail"] });
    qc.invalidateQueries({ queryKey: ["rental-invoices-grouped"] });
  };

  const removeMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("rental_invoices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Fatura excluída.");
      setDeleteId(null);
      invalidateAll();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao excluir."),
  });

  const editMut = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("Nada para salvar.");
      const valor = parseValor(editing.valor);
      if (valor == null || !(valor > 0)) throw new Error("Valor inválido.");
      if (!editing.vencimento || Number.isNaN(new Date(editing.vencimento + "T00:00:00").getTime())) {
        throw new Error("Vencimento inválido.");
      }
      const month = monthFromDate(editing.vencimento);
      const { error } = await supabase
        .from("rental_invoices")
        .update({
          nome_fantasia: editing.nome_fantasia.trim() || null,
          municipio: editing.municipio.trim() || null,
          uf: editing.uf.trim().toUpperCase() || null,
          vencimento: editing.vencimento,
          month,
          valor,
        })
        .eq("id", editing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Fatura atualizada.");
      setEditing(null);
      invalidateAll();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao salvar."),
  });

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 flex items-center gap-2 text-left"
        >
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{group.grupo_label}</div>
            <div className="text-[11px] text-muted-foreground">
              {group.faturas} {group.faturas === 1 ? "fatura" : "faturas"} · CNPJ raiz {group.cnpj_raiz}
            </div>
          </div>
        </button>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">{formatBRL(group.total)}</div>
        </div>
        <Button
          size="sm" variant="ghost" className="h-8 text-xs"
          onClick={() => { setLabelDraft(group.grupo_label); setRenameOpen(true); }}
        >
          renomear
        </Button>
      </div>
      {open && (
        <div className="bg-muted/20 border-t px-4 py-3">
          {detail.isLoading ? (
            <div className="text-xs text-muted-foreground">Carregando faturas...</div>
          ) : (detail.data ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">Sem faturas neste período.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[11px] uppercase text-muted-foreground">
                  <th className="text-left py-1 pr-2">Nome fantasia</th>
                  <th className="text-left py-1 pr-2">Município/UF</th>
                  <th className="text-left py-1 pr-2">Vencimento</th>
                  <th className="text-right py-1">Valor</th>
                  <th className="py-1 w-[68px]"></th>
                </tr>
              </thead>
              <tbody>
                {(detail.data ?? []).map((f) => (
                  <tr key={f.id} className="border-t border-border/40">
                    <td className="py-1 pr-2 truncate max-w-[280px]">{f.nome_fantasia ?? "—"}</td>
                    <td className="py-1 pr-2 text-muted-foreground">
                      {[f.municipio, f.uf].filter(Boolean).join(" / ") || "—"}
                    </td>
                    <td className="py-1 pr-2 tabular-nums">{formatDate(f.vencimento)}</td>
                    <td className="py-1 text-right tabular-nums font-medium">{formatBRL(Number(f.valor))}</td>
                    <td className="py-1 pl-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon" variant="ghost" className="h-6 w-6"
                          onClick={() => setEditing({
                            id: f.id,
                            nome_fantasia: f.nome_fantasia ?? "",
                            municipio: f.municipio ?? "",
                            uf: f.uf ?? "",
                            vencimento: f.vencimento ?? "",
                            valor: String(f.valor ?? "").replace(".", ","),
                          })}
                          aria-label="Editar fatura"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon" variant="ghost" className="h-6 w-6 text-destructive"
                          onClick={() => setDeleteId(f.id)}
                          aria-label="Excluir fatura"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Renomear grupo</DialogTitle>
            <DialogDescription>
              O apelido substitui o nome padrão para o CNPJ raiz {group.cnpj_raiz}.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Nome do grupo</Label>
            <Input value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>Cancelar</Button>
            <Button onClick={() => rename.mutate()} disabled={rename.isPending}>
              {rename.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar fatura</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label>Nome fantasia</Label>
                <Input
                  value={editing.nome_fantasia}
                  onChange={(e) => setEditing({ ...editing, nome_fantasia: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-[1fr_80px] gap-2">
                <div>
                  <Label>Município</Label>
                  <Input
                    value={editing.municipio}
                    onChange={(e) => setEditing({ ...editing, municipio: e.target.value })}
                  />
                </div>
                <div>
                  <Label>UF</Label>
                  <Input
                    maxLength={2}
                    value={editing.uf}
                    onChange={(e) => setEditing({ ...editing, uf: e.target.value.toUpperCase() })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Vencimento</Label>
                  <Input
                    type="date"
                    value={editing.vencimento}
                    onChange={(e) => setEditing({ ...editing, vencimento: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Valor</Label>
                  <Input
                    inputMode="decimal"
                    value={editing.valor}
                    onChange={(e) => setEditing({ ...editing, valor: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={() => editMut.mutate()} disabled={editMut.isPending}>
              {editMut.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(v) => { if (!v) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta fatura?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteId) removeMut.mutate(deleteId); }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ImportDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [fileName, setFileName] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedInvoice[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<number>(0);

  useEffect(() => {
    if (!open) {
      setFileName(""); setParsed(null); setParseError(null); setSkipped(0);
    }
  }, [open]);

  const handleFile = async (file: File) => {
    setParseError(null); setParsed(null); setSkipped(0); setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true, raw: false });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error("Arquivo sem planilhas.");
      const ws = wb.Sheets[sheetName];

      const norm = (s: unknown) =>
        String(s ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
          .toLowerCase();

      const wanted: Record<string, string[]> = {
        talao: ["talao"],
        fatura: ["fatura"],
        vencimento: ["vencimento"],
        cnpj: ["cnpj/cpf", "cnpj", "cpf/cnpj"],
        valor: ["valor total fatura", "valor total", "valor da fatura", "valor"],
        nome_fantasia: ["nome fantasia"],
        razao_social: ["razao social"],
        municipio: ["municipio"],
        uf: ["uf"],
      };

      const buildFromRecords = (records: Record<string, unknown>[]) => {
        if (records.length === 0) return { out: [] as ParsedInvoice[], skipped: 0, read: 0 };
        const keys = Object.keys(records[0]);
        const idx: Partial<Record<keyof typeof wanted, string>> = {};
        for (const [field, aliases] of Object.entries(wanted)) {
          const found = keys.find((k) => aliases.some((a) => norm(k) === a));
          if (found) (idx as Record<string, string>)[field] = found;
        }
        if (!idx.fatura || !idx.valor) return null;
        const out: ParsedInvoice[] = [];
        let skippedCount = 0;
        for (const r of records) {
          const fatura_num = String(r[idx.fatura!] ?? "").trim();
          const talao = idx.talao ? String(r[idx.talao] ?? "").trim() : "";
          const valor = parseValor(r[idx.valor!]);
          if (!fatura_num || valor == null) { skippedCount++; continue; }
          if (/^total$/i.test(fatura_num)) { skippedCount++; continue; }
          const vencimento = idx.vencimento ? parseVencimento(r[idx.vencimento]) : null;
          if (!vencimento) { skippedCount++; continue; }
          const cnpjRaw = idx.cnpj ? (r[idx.cnpj] == null ? null : String(r[idx.cnpj])) : null;
          const cnpj_raiz = cnpjRaw ? onlyDigits(cnpjRaw).slice(0, 8) || null : null;
          const strOrNull = (k?: string) => {
            if (!k) return null;
            const v = r[k];
            if (v == null) return null;
            const t = String(v).trim();
            return t || null;
          };
          out.push({
            talao,
            fatura_num,
            cnpj: cnpjRaw,
            cnpj_raiz,
            nome_fantasia: strOrNull(idx.nome_fantasia),
            razao_social: strOrNull(idx.razao_social),
            municipio: strOrNull(idx.municipio),
            uf: strOrNull(idx.uf),
            valor,
            vencimento,
            month: monthFromDate(vencimento),
          });
        }
        return { out, skipped: skippedCount, read: records.length };
      };

      // Primary path: matrix + detect header row
      const matrix = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: null,
        blankrows: false,
      }) as unknown[][];

      let result: { out: ParsedInvoice[]; skipped: number; read: number } | null = null;

      if (matrix.length > 0) {
        const scanRows = Math.min(matrix.length, 15);
        let headerIdx = -1;
        for (let i = 0; i < scanRows; i++) {
          const row = matrix[i] ?? [];
          const cells = row.map((c) => norm(c));
          const hasFatura = cells.some((c) => c === "fatura");
          const hasValor = cells.some(
            (c) => c === "valor total fatura" || c === "valor total" || c === "valor da fatura",
          );
          if (hasFatura && hasValor) { headerIdx = i; break; }
        }
        if (headerIdx >= 0) {
          const header = matrix[headerIdx].map((c) => String(c ?? "").trim());
          const records: Record<string, unknown>[] = [];
          for (let i = headerIdx + 1; i < matrix.length; i++) {
            const row = matrix[i] ?? [];
            const rec: Record<string, unknown> = {};
            for (let c = 0; c < header.length; c++) {
              const key = header[c];
              if (!key) continue;
              rec[key] = row[c] ?? null;
            }
            records.push(rec);
          }
          result = buildFromRecords(records);
        }
      }

      // Fallback: by-name parse
      if (!result || result.out.length === 0) {
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
        const fb = buildFromRecords(rows);
        if (fb && fb.out.length > 0) result = fb;
        else if (!result) result = fb;
      }

      if (!result) {
        throw new Error(
          "Não encontrei o cabeçalho esperado (colunas 'Fatura' e 'Valor Total Fatura'). Confira se é o relatório de faturamento certo.",
        );
      }
      if (result.out.length === 0) {
        throw new Error(
          `Li ${result.read} linha(s) mas nenhuma fatura válida (faltou Fatura, Valor ou Vencimento válidos). Ignoradas: ${result.skipped}.`,
        );
      }
      setParsed(result.out);
      setSkipped(result.skipped);
    } catch (e: unknown) {
      console.error("[ImportDialog] handleFile error:", e);
      setParseError(e instanceof Error ? e.message : String(e));
    }
  };

  const summary = useMemo(() => {
    if (!parsed) return null;
    const total = parsed.reduce((a, b) => a + b.valor, 0);
    const months = Array.from(new Set(parsed.map((p) => p.month))).sort();
    return { total, months };
  }, [parsed]);

  const importMut = useMutation({
    mutationFn: async () => {
      if (!parsed) throw new Error("Selecione um arquivo.");
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      const rows = parsed.map((p) => ({ ...p, owner_id: uid }));
      const CHUNK = 200;
      let saved = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("rental_invoices")
          .upsert(slice, { onConflict: "owner_id,fatura_num" });
        if (error) throw error;
        saved += slice.length;
      }
      return saved;
    },
    onSuccess: (n) => {
      toast.success(`${n} faturas importadas/atualizadas.`);
      qc.invalidateQueries({ queryKey: ["rental-invoices-grouped"] });
      qc.invalidateQueries({ queryKey: ["rental-invoices-detail"] });
      onOpenChange(false);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao importar."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar faturas de locação</DialogTitle>
          <DialogDescription>
            Selecione o Excel exportado do sistema. Reimportar o mesmo arquivo atualiza os registros existentes (sem duplicar).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Arquivo (.xlsx)</Label>
            <Input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            {fileName && <div className="text-[11px] text-muted-foreground mt-1">{fileName}</div>}
          </div>

          {parseError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              {parseError}
            </div>
          )}

          {summary && parsed && (
            <div className="rounded-md border bg-muted/20 p-3 text-xs space-y-1">
              <div>
                <span className="font-medium">{parsed.length}</span> faturas lidas
                {skipped > 0 && <span className="text-muted-foreground"> · {skipped} linha(s) ignorada(s)</span>}
              </div>
              <div>Total: <span className="tabular-nums font-medium">{formatBRL(summary.total)}</span></div>
              <div>
                Meses detectados:{" "}
                <span className="text-muted-foreground">{summary.months.map(monthLabel).join(", ")}</span>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() => importMut.mutate()}
            disabled={!parsed || importMut.isPending}
          >
            {importMut.isPending ? "Importando..." : "Confirmar importação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
