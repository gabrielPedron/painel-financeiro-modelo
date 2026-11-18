import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Info, Lock, Pencil, Plus, Receipt, Trash2, Upload, FileSpreadsheet, PieChart as PieIcon, ListChecks, Rows3, Layers, Columns3, Table2, X, Split } from "lucide-react";
import { toast } from "sonner";
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/rf/empty-state";
import { formatBRL, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CustosPorOperacaoView } from "@/routes/_authenticated/custos-por-operacao";
import { PlanilhaImportDialog } from "@/components/rf/costs/planilha-import-dialog";

type Aba = "planilha" | "operacao";
const ABAS: Aba[] = ["planilha", "operacao"];

// ────────────────────────────────────────────────────────────────
// DEMO E-COMMERCE — abas escondidas desta tela (código mantido intacto).
// Para religar: remova a chave desta lista (ou deixe-a vazia).
const HIDDEN_CUSTOS_TABS: string[] = ["operacao"];
const ABAS_VISIVEIS = ABAS.filter((a) => !HIDDEN_CUSTOS_TABS.includes(a));

// DEMO E-COMMERCE — operação 100% e-commerce, sem contas a pagar.
// SHOW_RATEIO=false esconde percentual/valor de rateio entre empresas
// (dados no banco preservados; todos os custos contam 100%).
// SHOW_PREVISTO=false esconde custo previsto (parcelas em aberto de Contas a Pagar).
// Para religar: mudar as flags para true.
const SHOW_RATEIO = false;
const SHOW_PREVISTO = false;
// ────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_authenticated/custos-fixos")({
  validateSearch: (search): { aba: Aba } => {
    const raw = (search as { aba?: unknown }).aba;
    const fallback = (ABAS_VISIVEIS[0] ?? "planilha") as Aba;
    const aba = typeof raw === "string" && (ABAS_VISIVEIS as string[]).includes(raw) ? (raw as Aba) : fallback;
    return { aba };
  },

  head: () => ({
    meta: [
      { title: "Custos da Empresa — Painel Financeiro" },
      {
        name: "description",
        content: "Despesas fixas e variáveis da operação de e-commerce, mês a mês.",
      },
    ],
  }),
  component: CustosEmpresaPage,
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

type CostMonthRow = {
  id: string;
  name: string;
  category: string;
  cost_type: "fixo" | "variavel";
  recurrence: "mensal_recorrente" | "mensal_variavel" | "avulso";
  amount_total: number;
  ecommerce_mode: "percent" | "fixed";
  ecommerce_percent: number;
  ecommerce_amount: number;
  amount_ecommerce: number;
};

type CostBase = {
  id: string;
  name: string;
  category: string;
  cost_type: "fixo" | "variavel";
  recurrence: "mensal_recorrente" | "mensal_variavel" | "avulso";
  amount: number | null;
  start_month: string;
  end_month: string | null;
  notes: string | null;
  is_active: boolean;
  ecommerce_mode: "percent" | "fixed";
  ecommerce_percent: number;
  ecommerce_amount: number;
};

const CATEGORIES = [
  { value: "fornecedores", label: "Fornecedores" },
  { value: "salarios", label: "Salários" },
  { value: "encargos", label: "Encargos" },
  { value: "impostos", label: "Impostos" },
  { value: "aluguel", label: "Aluguel" },
  { value: "energia", label: "Energia" },
  { value: "internet", label: "Internet" },
  { value: "telefonia", label: "Telefonia" },
  { value: "contabilidade", label: "Contabilidade" },
  { value: "sistemas", label: "Sistemas" },
  { value: "marketing", label: "Marketing" },
  { value: "combustivel", label: "Combustível" },
  { value: "manutencao", label: "Manutenção" },
  { value: "limpeza", label: "Limpeza" },
  { value: "descartaveis", label: "Descartáveis" },
  { value: "frete_terceiros", label: "Frete de terceiros" },
  { value: "bancarias", label: "Bancárias" },
  { value: "retiradas", label: "Retiradas" },
  { value: "investimentos", label: "Investimentos" },
  { value: "outros", label: "Outros" },
];

const RECURRENCE_LABEL: Record<CostBase["recurrence"], string> = {
  mensal_recorrente: "Mensal recorrente",
  mensal_variavel: "Mensal variável",
  avulso: "Avulso",
};

function monthKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}
function parseMonth(v: string): Date {
  const [y, m] = v.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1);
}
function labelMonth(v: string | null | undefined): string {
  if (!v) return "—";
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(parseMonth(v));
}
function shortMonth(v: string | null | undefined): string {
  if (!v) return "—";
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(parseMonth(v)).replace(".", "");
}
function addMonths(v: string, delta: number): string {
  const d = parseMonth(v);
  d.setMonth(d.getMonth() + delta);
  return monthKey(d);
}
function parseBRLInput(raw: string): number {
  const clean = raw.replace(/\s|R\$/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(clean);
  return Number.isFinite(n) ? n : NaN;
}
function catLabel(v: string): string {
  return CATEGORIES.find((c) => c.value === v)?.label ?? v;
}

const CATEGORY_INFO: Record<string, string> = {
  fornecedores: "Compra de mercadoria. O custo do produto vendido entra pelo CMV por SKU, não por aqui.",
  impostos: "O imposto do Simples já é calculado automaticamente na tela do Mercado Livre. Lançar aqui geraria contagem dupla.",
};

type EcoFilter = "todos" | "considerados" | "fora";
type ViewMode = "lista" | "grupos" | "comparar";
type GroupBy = "grupos" | "categorias";

const GROUP_MAP: Record<string, string> = {
  fornecedores: "Fornecedores",
  salarios: "Despesas com funcionários",
  encargos: "Despesas com funcionários",
  impostos: "Despesas tributárias",
  aluguel: "Despesas fixas",
  energia: "Despesas fixas",
  internet: "Despesas fixas",
  telefonia: "Despesas fixas",
  contabilidade: "Despesas fixas",
  sistemas: "Despesas fixas",
  combustivel: "Despesas variáveis",
  manutencao: "Despesas variáveis",
  limpeza: "Despesas variáveis",
  descartaveis: "Despesas variáveis",
  frete_terceiros: "Despesas variáveis",
  marketing: "Despesas variáveis",
  retiradas: "Retiradas",
  bancarias: "Bancárias",
  investimentos: "Investimentos",
  outros: "Diversos",
};
function groupLabelFor(category: string): string {
  return GROUP_MAP[category] ?? "Diversos";
}

function CustosEmpresaPage() {
  const { aba } = Route.useSearch();
  const navigate = useNavigate();
  const setAba = (next: Aba) => navigate({ to: "/custos-fixos", search: { aba: next }, replace: true });

  const [month, setMonth] = useState<string>(monthKey(new Date()));

  const tabs: { key: Aba; label: string; icon: typeof ListChecks }[] = [
    { key: "planilha", label: "Planilha", icon: Table2 },
    { key: "operacao", label: "Custos por operação", icon: Split },
  ].filter((t) => !HIDDEN_CUSTOS_TABS.includes(t.key)) as { key: Aba; label: string; icon: typeof ListChecks }[];


  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-primary">Custos da Empresa</h1>
        <p className="text-sm text-muted-foreground">
          Despesas da operação. Defina quanto de cada custo entra no cálculo do e-commerce.
        </p>
      </header>

      <div className={cn("flex-wrap gap-1 rounded-lg border border-border/60 bg-muted/40 p-1", tabs.length > 1 ? "flex" : "hidden")}>
        {tabs.map((t) => {
          const active = aba === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setAba(t.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-background border border-border/60 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/60",
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {aba === "operacao" ? (
        <CustosPorOperacaoView />
      ) : (
        <PlanilhaTab />
      )}
    </div>
  );
}

// ============ Aba Lançamentos ============

function useMonthCosts(month: string) {
  return useQuery({
    queryKey: ["oc-month", month],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      const { data, error } = await supabase.rpc("operating_costs_month", { _owner: uid, _month: month });
      if (error) throw error;
      return (data ?? []) as unknown as CostMonthRow[];
    },
  });
}

function useSummary(fromMonth: string, toMonth: string) {
  return useQuery({
    queryKey: ["oc-summary", fromMonth, toMonth],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      const { data, error } = await supabase.rpc("operating_costs_summary", {
        _owner: uid, _from: fromMonth, _to: toMonth,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        month: r.month as string,
        total_all: Number(r.total_all),
        total_ecommerce: Number(r.total_ecommerce),
        total_fixed: Number(r.total_fixed),
        total_variable: Number(r.total_variable),
      }));
    },
  });
}

type CompareRange = 3 | 6 | 12;

type MatrixRow = {
  cost_id: string;
  name: string;
  category: string;
  month: string;
  amount_total: number;
  amount_ecommerce: number;
};

function useMatrix(fromMonth: string, toMonth: string, enabled: boolean) {
  return useQuery({
    queryKey: ["oc-matrix", fromMonth, toMonth],
    enabled,
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      const { data, error } = await supabase.rpc("operating_costs_matrix", {
        _owner: uid, _from: fromMonth, _to: toMonth,
      });
      if (error) throw error;
      return ((data ?? []) as unknown as MatrixRow[]).map((r) => ({
        ...r,
        amount_total: Number(r.amount_total),
        amount_ecommerce: Number(r.amount_ecommerce),
      }));
    },
  });
}

function LancamentosTab({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<CostBase | null>(null);
  const [ecoFilter, setEcoFilter] = useState<EcoFilter>("todos");
  const [viewMode, setViewMode] = useState<ViewMode>("lista");
  const [groupBy, setGroupBy] = useState<GroupBy>("grupos");
  const [compareRange, setCompareRange] = useState<CompareRange>(6);

  const compareTo = monthKey(new Date());
  const compareFrom = addMonths(compareTo, -(compareRange - 1));
  const { data: matrixData, isLoading: matrixLoading } = useMatrix(
    compareFrom, compareTo, viewMode === "comparar",
  );

  const today = monthKey(new Date());
  const from12 = addMonths(today, -11);
  const rangeFrom = from12 < addMonths(month, -1) ? from12 : addMonths(month, -1);
  const rangeTo = today > month ? today : month;
  const { data: summary } = useSummary(rangeFrom, rangeTo);
  const { data: rows, isLoading } = useMonthCosts(month);

  const sorted = useMemo(
    () => (rows ?? []).slice().sort((a, b) => Number(b.amount_total) - Number(a.amount_total)),
    [rows],
  );

  const filtered = useMemo(() => {
    if (ecoFilter === "todos") return sorted;
    if (ecoFilter === "considerados") return sorted.filter((r) => Number(r.amount_ecommerce) > 0);
    return sorted.filter((r) => Number(r.amount_ecommerce) === 0);
  }, [sorted, ecoFilter]);

  const totals = useMemo(() => {
    let total = 0, fixo = 0, variavel = 0, ecommerce = 0;
    for (const r of sorted) {
      const t = Number(r.amount_total);
      total += t;
      if (r.cost_type === "fixo") fixo += t; else variavel += t;
      ecommerce += Number(r.amount_ecommerce);
    }
    return { total, fixo, variavel, ecommerce };
  }, [sorted]);

  const validSummary = useMemo(() => (summary ?? []).filter((s) => s.month), [summary]);
  const chartData = useMemo(() => {
    const fromKey = from12.slice(0, 7);
    const toKey = today.slice(0, 7);
    return validSummary.filter((s) => {
      const k = s.month.slice(0, 7);
      return k >= fromKey && k <= toKey;
    });
  }, [validSummary, from12, today]);
  const selectedKey = month.slice(0, 7);
  const prevMonth = validSummary.find((s) => s.month.slice(0, 7) === addMonths(month, -1).slice(0, 7));
  const prevTotal = prevMonth?.total_all ?? 0;
  const variation = prevTotal > 0 ? ((totals.total - prevTotal) / prevTotal) * 100 : null;

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("operating_costs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Custo removido.");
      qc.invalidateQueries({ queryKey: ["oc-month"] });
      qc.invalidateQueries({ queryKey: ["oc-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEdit = async (id: string) => {
    const { data, error } = await supabase
      .from("operating_costs")
      .select("id, name, category, cost_type, recurrence, amount, start_month, end_month, notes, is_active, ecommerce_mode, ecommerce_percent, ecommerce_amount")
      .eq("id", id)
      .maybeSingle();
    if (error) { toast.error(error.message); return; }
    if (data) {
      setEditing(data as unknown as CostBase);
      setDialogOpen(true);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {viewMode === "comparar" ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Período:</span>
            <div className="inline-flex rounded-md border border-border/70 bg-background">
              {([3, 6, 12] as CompareRange[]).map((n, i, arr) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCompareRange(n)}
                  className={cn(
                    "px-2.5 py-1 transition-colors",
                    i === 0 && "rounded-l-md",
                    i === arr.length - 1 && "rounded-r-md",
                    compareRange === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Últimos {n} meses
                </button>
              ))}
            </div>
          </div>
        ) : (
          <MonthPicker value={month} onChange={setMonth} />
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Importar planilha
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="mr-1 h-4 w-4" /> Adicionar custo
          </Button>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total do mês" value={totals.total} variation={variation} />
        <SummaryCard label="Fixos" value={totals.fixo} secondary={totals.total > 0 ? `${formatPercent((totals.fixo/totals.total)*100)} do total` : "—"} />
        <SummaryCard label="Variáveis" value={totals.variavel} secondary={totals.total > 0 ? `${formatPercent((totals.variavel/totals.total)*100)} do total` : "—"} />
        <SummaryCard
          label="Considerado no e-commerce"
          value={totals.ecommerce}
          secondary={totals.total > 0 ? `${formatPercent((totals.ecommerce/totals.total)*100)} do total` : "—"}
          highlight
        />
      </section>

      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Últimos 12 meses</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            {chartData && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                  <XAxis dataKey="month" tickFormatter={(v: string) => shortMonth(v)} fontSize={11} />
                  <YAxis fontSize={11} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v/1000)}k` : String(v))} />
                  <RTooltip
                    formatter={(value: number, name) => [formatBRL(value), name === "total_all" ? "Total" : "E-commerce"]}
                    labelFormatter={(v: string) => labelMonth(v)}
                    contentStyle={{ fontSize: 12, background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }}
                  />
                  <Bar
                    dataKey="total_all"
                    name="Total"
                    fill="var(--primary)"
                    radius={[4,4,0,0]}
                    cursor="pointer"
                    onClick={(data: unknown) => {
                      const d = data as { payload?: { month?: string } };
                      if (d?.payload?.month) setMonth(d.payload.month);
                    }}
                  >
                    {chartData.map((c) => {
                      const isSel = c.month.slice(0, 7) === selectedKey;
                      return (
                        <Cell
                          key={c.month}
                          fill="var(--primary)"
                          fillOpacity={isSel ? 1 : 0.45}
                          stroke={isSel ? "var(--primary)" : "transparent"}
                          strokeWidth={isSel ? 2 : 0}
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem dados suficientes.</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold">
              {viewMode === "comparar"
                ? `Comparativo — últimos ${compareRange} meses`
                : `Custos de ${labelMonth(month)}`}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border border-border/70 bg-background text-[11px]">
              {([
                { key: "lista", label: "Lista", icon: Rows3, disabled: false },
                { key: "grupos", label: "Grupos", icon: Layers, disabled: false },
                { key: "comparar", label: "Comparar meses", icon: Columns3, disabled: false },
              ] as { key: ViewMode; label: string; icon: typeof Rows3; disabled: boolean }[]).map((opt, i, arr) => (
                <button
                  key={opt.key}
                  type="button"
                  disabled={opt.disabled}
                  onClick={() => !opt.disabled && setViewMode(opt.key)}
                  className={cn(
                    "inline-flex items-center gap-1 px-2.5 py-1 transition-colors",
                    i === 0 && "rounded-l-md",
                    i === arr.length - 1 && "rounded-r-md",
                    opt.disabled && "opacity-40 cursor-not-allowed",
                    !opt.disabled && viewMode === opt.key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <opt.icon className="h-3.5 w-3.5" />
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-md border border-border/70 bg-background text-[11px]">
              {([
                { key: "todos", label: "Todos" },
                { key: "considerados", label: "Considerados no e-commerce" },
                { key: "fora", label: "Fora do e-commerce" },
              ] as { key: EcoFilter; label: string }[]).map((opt, i, arr) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setEcoFilter(opt.key)}
                  className={cn(
                    "px-2.5 py-1 transition-colors",
                    i === 0 && "rounded-l-md",
                    i === arr.length - 1 && "rounded-r-md",
                    ecoFilter === opt.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            </div>
          </div>
          {viewMode !== "lista" ? (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>Agrupar por:</span>
              <div className="inline-flex rounded-md border border-border/70 bg-background">
                {([
                  { key: "grupos", label: "Grupos" },
                  { key: "categorias", label: "Categorias" },
                ] as { key: GroupBy; label: string }[]).map((opt, i, arr) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setGroupBy(opt.key)}
                    className={cn(
                      "px-2 py-0.5 transition-colors",
                      i === 0 && "rounded-l-md",
                      i === arr.length - 1 && "rounded-r-md",
                      groupBy === opt.key ? "bg-primary text-primary-foreground" : "hover:text-foreground",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {viewMode === "comparar" ? (
            matrixLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Carregando...</div>
            ) : (
              <CompareMatrix
                data={matrixData ?? []}
                from={compareFrom}
                to={compareTo}
                groupBy={groupBy}
                ecoFilter={ecoFilter}
              />
            )
          ) : isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Carregando...</div>
          ) : sorted.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Receipt}
                title="Nenhum custo cadastrado."
                description="Adicione as despesas fixas e variáveis da sua operação."
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Nenhum custo neste filtro.</div>
          ) : viewMode === "grupos" ? (
            <GroupedCosts
              rows={filtered}
              month={month}
              groupBy={groupBy}
              onEdit={openEdit}
              onDelete={(id: string) => {
                if (confirm("Remover este custo? Todos os registros mensais serão apagados.")) deleteMut.mutate(id);
              }}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Recorrência</TableHead>
                  <TableHead className="text-right">Valor total</TableHead>
                  <TableHead className="w-[220px]">Rateio e-commerce</TableHead>
                  <TableHead className="text-right">Valor e-commerce</TableHead>
                  <TableHead className="w-[80px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <CostRowInline
                    key={r.id}
                    row={r}
                    month={month}
                    onEdit={() => openEdit(r.id)}
                    onDelete={() => {
                      if (confirm("Remover este custo? Todos os registros mensais serão apagados.")) deleteMut.mutate(r.id);
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CostDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["oc-month"] });
          qc.invalidateQueries({ queryKey: ["oc-summary"] });
        }}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        month={month}
        onImported={() => {
          qc.invalidateQueries({ queryKey: ["oc-month"] });
          qc.invalidateQueries({ queryKey: ["oc-summary"] });
        }}
      />
    </div>
  );
}

function SummaryCard({ label, value, variation, secondary, highlight }: {
  label: string; value: number; variation?: number | null; secondary?: string; highlight?: boolean;
}) {
  return (
    <Card className={cn("border-border/70", highlight && "border-primary/40 bg-primary/5")}>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{formatBRL(value)}</div>
        {variation != null ? (
          <div className={cn("mt-1 text-[11px] tabular-nums", variation > 0 ? "text-red-700" : variation < 0 ? "text-emerald-700" : "text-muted-foreground")}>
            {variation > 0 ? "+" : ""}{formatPercent(variation)} vs. mês anterior
          </div>
        ) : secondary ? (
          <div className="mt-1 text-[11px] text-muted-foreground">{secondary}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MonthPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [y, m] = value.split("-").map(Number);
  const setYear = (yy: number) => onChange(`${yy}-${String(m).padStart(2, "0")}-01`);
  const setMonth = (mm: number) => onChange(`${y}-${String(mm).padStart(2, "0")}-01`);
  const now = new Date();
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);
  const months = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  return (
    <div className="flex items-center gap-2">
      <Select value={String(m)} onValueChange={(v) => setMonth(Number(v))}>
        <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {months.map((label, i) => (<SelectItem key={i} value={String(i + 1)}>{label}</SelectItem>))}
        </SelectContent>
      </Select>
      <Select value={String(y)} onValueChange={(v) => setYear(Number(v))}>
        <SelectTrigger className="h-8 w-[90px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {years.map((yy) => (<SelectItem key={yy} value={String(yy)}>{yy}</SelectItem>))}
        </SelectContent>
      </Select>
    </div>
  );
}

function CostRowInline({
  row, month, onEdit, onDelete,
}: {
  row: CostMonthRow; month: string; onEdit: () => void; onDelete: () => void;
}) {
  const qc = useQueryClient();
  const total = Number(row.amount_total);
  const eco = Number(row.amount_ecommerce);
  const isRecurring = row.recurrence === "mensal_recorrente";
  const [expanded, setExpanded] = useState(false);
  const { data: itemsCount } = useQuery({
    queryKey: ["oc-items-count", row.id, month],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("operating_cost_items")
        .select("id", { count: "exact", head: true })
        .eq("cost_id", row.id)
        .eq("month", month);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const hasItems = (itemsCount ?? 0) > 0;

  // Total inline edit
  const [editingTotal, setEditingTotal] = useState(false);
  const [draftTotal, setDraftTotal] = useState(total > 0 ? total.toString().replace(".", ",") : "");

  const saveTotal = useMutation({
    mutationFn: async (raw: string) => {
      const amount = parseBRLInput(raw);
      if (!Number.isFinite(amount)) throw new Error("Valor inválido");
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      const { error } = await supabase
        .from("operating_cost_entries")
        .upsert({ cost_id: row.id, owner_id: uid, month, amount }, { onConflict: "cost_id,month" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Valor salvo.");
      setEditingTotal(false);
      qc.invalidateQueries({ queryKey: ["oc-month"] });
      qc.invalidateQueries({ queryKey: ["oc-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearOverride = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("operating_cost_entries")
        .delete()
        .eq("cost_id", row.id)
        .eq("month", month);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oc-month"] });
      qc.invalidateQueries({ queryKey: ["oc-summary"] });
    },
  });

  // Share inline
  const [mode, setMode] = useState<"percent" | "fixed">(row.ecommerce_mode);
  const [share, setShare] = useState<string>(
    row.ecommerce_mode === "percent"
      ? String(row.ecommerce_percent).replace(".", ",")
      : String(row.ecommerce_amount).replace(".", ","),
  );
  useEffect(() => {
    setMode(row.ecommerce_mode);
    setShare(row.ecommerce_mode === "percent"
      ? String(row.ecommerce_percent).replace(".", ",")
      : String(row.ecommerce_amount).replace(".", ","));
  }, [row.ecommerce_mode, row.ecommerce_percent, row.ecommerce_amount]);

  const saveShare = useMutation({
    mutationFn: async (payload: { mode: "percent" | "fixed"; value: number }) => {
      const update = payload.mode === "percent"
        ? { ecommerce_mode: "percent", ecommerce_percent: payload.value }
        : { ecommerce_mode: "fixed", ecommerce_amount: payload.value };
      const { error } = await supabase.from("operating_costs").update(update).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oc-month"] });
      qc.invalidateQueries({ queryKey: ["oc-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const commitShare = (nextMode: "percent" | "fixed", raw: string) => {
    const v = parseBRLInput(raw);
    if (!Number.isFinite(v) || v < 0) { toast.error("Valor inválido"); return; }
    if (nextMode === "percent" && v > 100) { toast.error("Percentual máximo 100"); return; }
    saveShare.mutate({ mode: nextMode, value: v });
  };

  const equivalent = total > 0
    ? (mode === "percent" ? (Number(share.replace(",", ".")) / 100) * total : Number(share.replace(",", ".")))
    : 0;
  const equivalentPct = total > 0 ? (eco / total) * 100 : 0;

  return (
    <>
    <TableRow className="text-sm">
      <TableCell className="font-medium">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title={hasItems ? "Ver detalhamento" : "Detalhar em itens"}
            className={cn(
              "inline-flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-muted",
              hasItems ? "text-muted-foreground" : "text-muted-foreground/40",
            )}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <span>{row.name}</span>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          {catLabel(row.category)}
          {CATEGORY_INFO[row.category] ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="text-primary/70 hover:text-primary" aria-label="Informação sobre a categoria">
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">{CATEGORY_INFO[row.category]}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground capitalize">{row.cost_type === "fixo" ? "Fixo" : "Variável"}</TableCell>
      <TableCell className="text-muted-foreground">{RECURRENCE_LABEL[row.recurrence]}</TableCell>
      <TableCell className="text-right tabular-nums">
        {editingTotal ? (
          <div className="flex items-center justify-end gap-1">
            <Input autoFocus value={draftTotal} onChange={(e) => setDraftTotal(e.target.value)}
              className="h-7 w-28 text-right text-xs" placeholder="0,00" />
            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => saveTotal.mutate(draftTotal)} disabled={saveTotal.isPending}>Salvar</Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingTotal(false)}>Cancelar</Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <span>{formatBRL(total)}</span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
              onClick={() => { setDraftTotal(total > 0 ? total.toString().replace(".", ",") : ""); setEditingTotal(true); }}>
              {isRecurring ? "Sobrescrever" : "Editar"}
            </Button>
            {isRecurring && (equivalentPct !== 0 || total > 0) ? null : null}
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <div className="inline-flex rounded-md border border-input bg-background text-[11px]">
            <button type="button"
              className={cn(
                "px-2 py-1 rounded-l-md cursor-pointer transition-colors",
                mode === "percent"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
              onClick={() => { setMode("percent"); commitShare("percent", share); }}>%</button>
            <button type="button"
              className={cn(
                "px-2 py-1 rounded-r-md cursor-pointer transition-colors",
                mode === "fixed"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
              onClick={() => { setMode("fixed"); commitShare("fixed", share); }}>R$</button>
          </div>
          <Input
            value={share}
            onChange={(e) => setShare(e.target.value)}
            onBlur={() => commitShare(mode, share)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="h-7 w-24 text-right text-xs border-input bg-background"
            placeholder={mode === "percent" ? "0,0" : "0,00"}
          />
          <span className="text-[11px] text-muted-foreground">{mode === "percent" ? "%" : ""}</span>
        </div>
      </TableCell>
      <TableCell className={cn("text-right tabular-nums", eco === 0 && "text-muted-foreground")}>
        <div>{formatBRL(equivalent)}</div>
        {mode === "fixed" && total > 0 ? (
          <div className="text-[10px] text-muted-foreground">≈ {formatPercent(Math.min(100, (equivalent/total)*100))}</div>
        ) : null}
      </TableCell>
      <TableCell className="text-right">
        <div className="inline-flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onEdit} title="Editar"><Pencil className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onDelete} title="Excluir"><Trash2 className="h-3.5 w-3.5" /></Button>
          {isRecurring && total > 0 ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-muted-foreground" title="Voltar ao valor padrão"
              onClick={() => clearOverride.mutate()}>reset</Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
    {expanded ? (
      <TableRow className="bg-muted/20">
        <TableCell colSpan={8} className="p-0">
          <SubItemsPanel costId={row.id} costName={row.name} month={month} totalCost={total} />
        </TableCell>
      </TableRow>
    ) : null}
    </>
  );
}

// ============ SubItems Panel ============

type SubItem = { id: string; label: string; amount: number };

function SubItemsPanel({
  costId, costName, month, totalCost,
}: {
  costId: string; costName: string; month: string; totalCost: number;
}) {
  const qc = useQueryClient();
  const { data: items, isLoading } = useQuery({
    queryKey: ["oc-items", costId, month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("operating_cost_items")
        .select("id, label, amount")
        .eq("cost_id", costId)
        .eq("month", month)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({ id: r.id, label: r.label, amount: Number(r.amount) })) as SubItem[];
    },
  });

  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["oc-items", costId, month] });
    qc.invalidateQueries({ queryKey: ["oc-items-count", costId, month] });
  };

  const addMut = useMutation({
    mutationFn: async (payload: { label: string; amount: number }) => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      const { error } = await supabase.from("operating_cost_items").insert({
        cost_id: costId, owner_id: uid, month, label: payload.label, amount: payload.amount,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewLabel(""); setNewAmount("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: async (payload: { id: string; label?: string; amount?: number }) => {
      const patch: { label?: string; amount?: number } = {};
      if (payload.label != null) patch.label = payload.label;
      if (payload.amount != null) patch.amount = payload.amount;
      const { error } = await supabase.from("operating_cost_items").update(patch).eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("operating_cost_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const list = items ?? [];
  const sum = list.reduce((s, it) => s + Number(it.amount), 0);
  const diff = totalCost - sum;
  const hasDiff = Math.abs(diff) >= 0.01 && list.length > 0;

  const handleAdd = () => {
    const label = newLabel.trim();
    if (!label) { toast.error("Informe um rótulo."); return; }
    const amount = parseBRLInput(newAmount);
    if (!Number.isFinite(amount)) { toast.error("Valor inválido."); return; }
    addMut.mutate({ label, amount });
  };

  return (
    <div className="border-l-2 border-primary/40 bg-muted/10 px-6 py-3">
      <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        Detalhamento — {costName}
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground py-2">Carregando itens...</div>
      ) : (
        <div className="space-y-1">
          {list.length === 0 ? (
            <div className="text-xs text-muted-foreground py-1">
              Nenhum item cadastrado. Adicione os detalhes abaixo (ex.: nomes, produtos).
            </div>
          ) : (
            list.map((it) => (
              <SubItemRow
                key={it.id}
                item={it}
                onSave={(label, amount) => updateMut.mutate({ id: it.id, label, amount })}
                onDelete={() => { if (confirm("Remover este item?")) deleteMut.mutate(it.id); }}
              />
            ))
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/40 pt-3">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Rótulo (ex.: nome da pessoa)"
          className="h-7 w-56 text-xs"
        />
        <Input
          value={newAmount}
          onChange={(e) => setNewAmount(e.target.value)}
          placeholder="0,00"
          className="h-7 w-28 text-right text-xs"
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />
        <Button size="sm" className="h-7 px-3 text-xs" onClick={handleAdd} disabled={addMut.isPending}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar item
        </Button>
      </div>

      <div className={cn(
        "mt-3 flex flex-wrap items-center gap-4 rounded-md px-3 py-2 text-xs tabular-nums",
        hasDiff ? "bg-amber-100/70 text-amber-900" : "bg-muted/40 text-muted-foreground",
      )}>
        <span>Itens: <span className="font-semibold">{formatBRL(sum)}</span></span>
        <span>Total do custo: <span className="font-semibold">{formatBRL(totalCost)}</span></span>
        <span>
          Diferença:{" "}
          <span className={cn("font-semibold", hasDiff && "text-amber-900")}>
            {formatBRL(diff)}
          </span>
        </span>
        {hasDiff ? (
          <span className="text-[11px] italic">
            A soma dos itens não bate com o total. O total continua sendo usado no cálculo.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SubItemRow({
  item, onSave, onDelete,
}: {
  item: SubItem;
  onSave: (label: string, amount: number) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [amount, setAmount] = useState(String(item.amount).replace(".", ","));
  useEffect(() => {
    setLabel(item.label);
    setAmount(String(item.amount).replace(".", ","));
  }, [item.label, item.amount]);

  const commit = () => {
    const l = label.trim();
    const a = parseBRLInput(amount);
    if (!l) { toast.error("Rótulo obrigatório."); setLabel(item.label); return; }
    if (!Number.isFinite(a)) { toast.error("Valor inválido."); setAmount(String(item.amount).replace(".", ",")); return; }
    if (l === item.label && Math.abs(a - item.amount) < 0.001) return;
    onSave(l, a);
  };

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/40">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="h-7 flex-1 min-w-[180px] text-xs"
      />
      <Input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="h-7 w-28 text-right text-xs tabular-nums"
      />
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onDelete} title="Excluir">
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ============ Compare Matrix ============

function CompareMatrix({
  data, from, to, groupBy, ecoFilter,
}: {
  data: MatrixRow[];
  from: string;
  to: string;
  groupBy: GroupBy;
  ecoFilter: EcoFilter;
}) {
  const months = useMemo(() => {
    const out: string[] = [];
    let cur = from;
    while (cur <= to) { out.push(cur); cur = addMonths(cur, 1); }
    return out;
  }, [from, to]);

  // Filter by rateio (based on aggregate across the period for that cost)
  const filtered = useMemo(() => {
    if (ecoFilter === "todos") return data;
    const byCost = new Map<string, number>();
    for (const r of data) {
      byCost.set(r.cost_id, (byCost.get(r.cost_id) ?? 0) + r.amount_ecommerce);
    }
    return data.filter((r) => {
      const eco = byCost.get(r.cost_id) ?? 0;
      return ecoFilter === "considerados" ? eco > 0 : eco === 0;
    });
  }, [data, ecoFilter]);

  type CostAgg = { cost_id: string; name: string; category: string; byMonth: Map<string, number>; total: number };
  type Grp = { key: string; label: string; costs: Map<string, CostAgg>; byMonth: Map<string, number>; total: number };

  const groups = useMemo(() => {
    const map = new Map<string, Grp>();
    for (const r of filtered) {
      const gKey = groupBy === "grupos" ? groupLabelFor(r.category) : r.category;
      const gLabel = groupBy === "grupos" ? groupLabelFor(r.category) : catLabel(r.category);
      let g = map.get(gKey);
      if (!g) { g = { key: gKey, label: gLabel, costs: new Map(), byMonth: new Map(), total: 0 }; map.set(gKey, g); }
      let c = g.costs.get(r.cost_id);
      if (!c) { c = { cost_id: r.cost_id, name: r.name, category: r.category, byMonth: new Map(), total: 0 }; g.costs.set(r.cost_id, c); }
      const v = Number(r.amount_total);
      c.byMonth.set(r.month, (c.byMonth.get(r.month) ?? 0) + v);
      c.total += v;
      g.byMonth.set(r.month, (g.byMonth.get(r.month) ?? 0) + v);
      g.total += v;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered, groupBy]);

  const totalsByMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of groups) for (const mo of months) m.set(mo, (m.get(mo) ?? 0) + (g.byMonth.get(mo) ?? 0));
    return m;
  }, [groups, months]);

  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];

  function variation(first: number, last: number): number | null {
    if (!first || first === 0) return null;
    return ((last - first) / first) * 100;
  }

  function VarCell({ v }: { v: number | null }) {
    if (v == null) return <span className="text-muted-foreground/60">—</span>;
    const up = v > 0;
    const flat = Math.abs(v) < 0.05;
    return (
      <span className={cn("tabular-nums", flat ? "text-muted-foreground" : up ? "text-red-700" : "text-emerald-700")}>
        {up ? "▲ " : v < 0 ? "▼ " : ""}{v > 0 ? "+" : ""}{formatPercent(v, 1)}
      </span>
    );
  }

  function Amt({ v }: { v: number | undefined }) {
    if (v == null || v === 0) return <span className="text-muted-foreground/60">—</span>;
    return <span className="tabular-nums">{formatBRL(v)}</span>;
  }

  if (groups.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">Sem dados no período.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="sticky left-0 z-10 bg-muted/60 px-4 py-2 text-left min-w-[240px]">
              {groupBy === "grupos" ? "Grupo / Custo" : "Categoria / Custo"}
            </th>
            {months.map((mo) => (
              <th
                key={mo}
                className={cn(
                  "px-3 py-2 text-right whitespace-nowrap",
                  mo === lastMonth && "bg-primary/10 text-primary",
                )}
              >
                {shortMonth(mo)}
              </th>
            ))}
            <th className="px-3 py-2 text-right whitespace-nowrap">Variação</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <CompareGroupRow
              key={g.key}
              group={g}
              months={months}
              lastMonth={lastMonth}
              firstMonth={firstMonth}
              VarCell={VarCell}
              Amt={Amt}
              variation={variation}
            />
          ))}
          <tr className="bg-muted/60 text-sm font-semibold">
            <td className="sticky left-0 z-10 bg-muted/60 px-4 py-2">TOTAL</td>
            {months.map((mo) => (
              <td key={mo} className={cn("px-3 py-2 text-right tabular-nums", mo === lastMonth && "bg-primary/10 text-primary")}>
                <Amt v={totalsByMonth.get(mo)} />
              </td>
            ))}
            <td className="px-3 py-2 text-right">
              <VarCell v={variation(totalsByMonth.get(firstMonth) ?? 0, totalsByMonth.get(lastMonth) ?? 0)} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CompareGroupRow({
  group, months, lastMonth, firstMonth, VarCell, Amt, variation,
}: {
  group: { key: string; label: string; costs: Map<string, { cost_id: string; name: string; category: string; byMonth: Map<string, number>; total: number }>; byMonth: Map<string, number>; total: number };
  months: string[];
  lastMonth: string;
  firstMonth: string;
  VarCell: (p: { v: number | null }) => React.ReactElement;
  Amt: (p: { v: number | undefined }) => React.ReactElement;
  variation: (first: number, last: number) => number | null;
}) {
  const [open, setOpen] = useState(false);
  const costs = Array.from(group.costs.values()).sort((a, b) => b.total - a.total);
  return (
    <>
      <tr className="border-t border-border/60 hover:bg-muted/30">
        <td className="sticky left-0 z-10 bg-background px-4 py-2">
          <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-2 text-left">
            {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            <span className="font-medium">{group.label}</span>
          </button>
        </td>
        {months.map((mo) => (
          <td key={mo} className={cn("px-3 py-2 text-right", mo === lastMonth && "bg-primary/5")}>
            <Amt v={group.byMonth.get(mo)} />
          </td>
        ))}
        <td className="px-3 py-2 text-right">
          <VarCell v={variation(group.byMonth.get(firstMonth) ?? 0, group.byMonth.get(lastMonth) ?? 0)} />
        </td>
      </tr>
      {open && costs.map((c) => (
        <tr key={c.cost_id} className="border-t border-border/40 bg-muted/10 text-[13px]">
          <td className="sticky left-0 z-10 bg-muted/10 px-4 py-1.5 pl-10 text-muted-foreground">{c.name}</td>
          {months.map((mo) => (
            <td key={mo} className={cn("px-3 py-1.5 text-right", mo === lastMonth && "bg-primary/5")}>
              <Amt v={c.byMonth.get(mo)} />
            </td>
          ))}
          <td className="px-3 py-1.5 text-right">
            <VarCell v={variation(c.byMonth.get(firstMonth) ?? 0, c.byMonth.get(lastMonth) ?? 0)} />
          </td>
        </tr>
      ))}
    </>
  );
}

// ============ Cost Dialog ============

function GroupedCosts({
  rows, month, groupBy, onEdit, onDelete,
}: {
  rows: CostMonthRow[];
  month: string;
  groupBy: GroupBy;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; items: CostMonthRow[]; total: number }>();
    for (const r of rows) {
      const label = groupBy === "grupos" ? groupLabelFor(r.category) : catLabel(r.category);
      const key = groupBy === "grupos" ? label : r.category;
      let g = map.get(key);
      if (!g) { g = { key, label, items: [], total: 0 }; map.set(key, g); }
      g.items.push(r);
      g.total += Number(r.amount_total);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [rows, groupBy]);

  const grand = useMemo(() => groups.reduce((s, g) => s + g.total, 0), [groups]);
  const grandEco = useMemo(
    () => rows.reduce((s, r) => s + Number(r.amount_ecommerce), 0),
    [rows],
  );
  const maxTotal = groups.length > 0 ? Math.max(...groups.map((g) => g.total)) : 0;

  return (
    <div className="divide-y divide-border/60">
      {groups.map((g) => (
        <GroupRow
          key={g.key}
          group={g}
          grand={grand}
          maxTotal={maxTotal}
          month={month}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
      <div className="flex items-center justify-between gap-4 bg-muted/40 px-4 py-3 text-sm font-semibold">
        <span>Total</span>
        <div className="flex items-center gap-6 tabular-nums">
          <span className="text-xs text-muted-foreground">
            E-commerce: <span className="text-foreground">{formatBRL(grandEco)}</span>
          </span>
          <span>{formatBRL(grand)}</span>
        </div>
      </div>
    </div>
  );
}

function GroupRow({
  group, grand, maxTotal, month, onEdit, onDelete,
}: {
  group: { key: string; label: string; items: CostMonthRow[]; total: number };
  grand: number;
  maxTotal: number;
  month: string;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pct = grand > 0 ? (group.total / grand) * 100 : 0;
  const barPct = maxTotal > 0 ? (group.total / maxTotal) * 100 : 0;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        >
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium truncate">{group.label}</span>
              <div className="flex items-center gap-4 tabular-nums text-sm">
                <span className="text-xs text-muted-foreground w-12 text-right">{formatPercent(pct, 1)}</span>
                <span className="font-semibold w-32 text-right">{formatBRL(group.total)}</span>
              </div>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary/70" style={{ width: `${barPct}%` }} />
            </div>
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border/60 bg-muted/20">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <TableHead>Nome</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Recorrência</TableHead>
                <TableHead className="text-right">Valor total</TableHead>
                <TableHead className="w-[220px]">Rateio e-commerce</TableHead>
                <TableHead className="text-right">Valor e-commerce</TableHead>
                <TableHead className="w-[80px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.items
                .slice()
                .sort((a, b) => Number(b.amount_total) - Number(a.amount_total))
                .map((r) => (
                  <CostRowInline
                    key={r.id}
                    row={r}
                    month={month}
                    onEdit={() => onEdit(r.id)}
                    onDelete={() => onDelete(r.id)}
                  />
                ))}
            </TableBody>
          </Table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ============ Cost Dialog ============

function CostDialog({
  open, onOpenChange, editing, onSaved,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: CostBase | null; onSaved: () => void;
}) {
  const initial = () => ({
    name: editing?.name ?? "",
    category: editing?.category ?? "outros",
    cost_type: (editing?.cost_type ?? "fixo") as CostBase["cost_type"],
    recurrence: (editing?.recurrence ?? "mensal_recorrente") as CostBase["recurrence"],
    amount: editing?.amount != null ? String(editing.amount).replace(".", ",") : "",
    start_month: editing?.start_month ?? monthKey(new Date()),
    end_month: editing?.end_month ?? "",
    notes: editing?.notes ?? "",
    ecommerce_mode: (editing?.ecommerce_mode ?? "percent") as "percent" | "fixed",
    ecommerce_percent: editing?.ecommerce_percent != null ? String(editing.ecommerce_percent).replace(".", ",") : "0",
    ecommerce_amount: editing?.ecommerce_amount != null ? String(editing.ecommerce_amount).replace(".", ",") : "0",
  });
  const [form, setForm] = useState(initial);
  useEffect(() => { if (open) setForm(initial()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, editing?.id]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      if (!form.name.trim()) throw new Error("Informe um nome.");
      const amount = form.amount === "" ? null : parseBRLInput(form.amount);
      if (form.recurrence === "mensal_recorrente" && (amount == null || !Number.isFinite(amount))) {
        throw new Error("Custo recorrente exige valor padrão.");
      }
      const pct = parseBRLInput(form.ecommerce_percent || "0");
      const fix = parseBRLInput(form.ecommerce_amount || "0");
      if (form.ecommerce_mode === "percent" && (pct < 0 || pct > 100)) throw new Error("Percentual entre 0 e 100.");
      if (form.ecommerce_mode === "fixed" && fix < 0) throw new Error("Valor de rateio inválido.");

      const payload = {
        owner_id: uid,
        name: form.name.trim(),
        category: form.category,
        cost_type: form.cost_type,
        recurrence: form.recurrence,
        amount,
        start_month: form.start_month,
        end_month: form.end_month || null,
        notes: form.notes.trim() || null,
        ecommerce_mode: form.ecommerce_mode,
        ecommerce_percent: form.ecommerce_mode === "percent" ? pct : 0,
        ecommerce_amount: form.ecommerce_mode === "fixed" ? fix : 0,
      };
      if (editing) {
        const { error } = await supabase.from("operating_costs").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("operating_costs").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Custo atualizado." : "Custo cadastrado.");
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar custo" : "Novo custo"}</DialogTitle>
          <DialogDescription>Despesas da operação de e-commerce.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Nome</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Aluguel do galpão" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Categoria</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={form.cost_type} onValueChange={(v) => setForm({ ...form, cost_type: v as CostBase["cost_type"] })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixo">Fixo</SelectItem>
                  <SelectItem value="variavel">Variável</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Recorrência</Label>
            <Select value={form.recurrence} onValueChange={(v) => setForm({ ...form, recurrence: v as CostBase["recurrence"] })}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mensal_recorrente">Mensal recorrente</SelectItem>
                <SelectItem value="mensal_variavel">Mensal variável</SelectItem>
                <SelectItem value="avulso">Avulso</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Valor padrão (R$)</Label>
              <Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0,00" disabled={form.recurrence === "avulso"} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mês de início</Label>
              <Input type="month" value={form.start_month.slice(0, 7)} onChange={(e) => setForm({ ...form, start_month: `${e.target.value}-01` })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mês de fim</Label>
              <Input type="month" value={form.end_month ? form.end_month.slice(0, 7) : ""} onChange={(e) => setForm({ ...form, end_month: e.target.value ? `${e.target.value}-01` : "" })} />
            </div>
          </div>

          <div className="rounded-md border border-border/70 bg-muted/30 p-3 space-y-2">
            <Label className="text-xs font-semibold">Rateio para o e-commerce</Label>
            <div className="flex items-center gap-2">
              <Select value={form.ecommerce_mode} onValueChange={(v) => setForm({ ...form, ecommerce_mode: v as "percent" | "fixed" })}>
                <SelectTrigger className="h-9 w-32 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percentual</SelectItem>
                  <SelectItem value="fixed">Valor fixo</SelectItem>
                </SelectContent>
              </Select>
              {form.ecommerce_mode === "percent" ? (
                <Input value={form.ecommerce_percent} onChange={(e) => setForm({ ...form, ecommerce_percent: e.target.value })} placeholder="0,0" className="h-9" />
              ) : (
                <Input value={form.ecommerce_amount} onChange={(e) => setForm({ ...form, ecommerce_amount: e.target.value })} placeholder="0,00" className="h-9" />
              )}
              <span className="text-xs text-muted-foreground">{form.ecommerce_mode === "percent" ? "% do total" : "R$"}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {form.ecommerce_mode === "percent"
                ? "Uma porcentagem do valor mensal entra no resultado do e-commerce."
                : "Um valor fixo em reais entra no e-commerce, limitado ao total do mês."}
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Observação</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>{saveMut.isPending ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Import Dialog ============

type ImportRow = {
  nome: string;
  categoria: string;
  tipo: "fixo" | "variavel";
  recorrencia: CostBase["recurrence"];
  valor: number;
  rateio_modo: "percent" | "fixed";
  rateio_valor: number;
  existingId: string | null;
};

function normalizeCategory(raw: string): string {
  const s = (raw ?? "").toString().trim().toLowerCase();
  const match = CATEGORIES.find((c) => c.value === s || c.label.toLowerCase() === s);
  return match?.value ?? "outros";
}
function normalizeType(raw: string): "fixo" | "variavel" {
  const s = (raw ?? "").toString().trim().toLowerCase();
  return s.startsWith("var") ? "variavel" : "fixo";
}
function normalizeRecurrence(raw: string): CostBase["recurrence"] {
  const s = (raw ?? "").toString().trim().toLowerCase();
  if (s.includes("var")) return "mensal_variavel";
  if (s.includes("avuls") || s.includes("pontual")) return "avulso";
  return "mensal_recorrente";
}
function normalizeMode(raw: string): "percent" | "fixed" {
  const s = (raw ?? "").toString().trim().toLowerCase();
  if (s.includes("fix") || s.includes("r$") || s === "reais" || s === "valor") return "fixed";
  return "percent";
}
function toNumber(raw: unknown): number {
  if (typeof raw === "number") return raw;
  const s = String(raw ?? "").replace(/\s|R\$|%/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function ImportDialog({
  open, onOpenChange, month, onImported,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; month: string;
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState<string>("");

  useEffect(() => { if (!open) { setRows([]); setFileName(""); } }, [open]);

  const parseFile = async (file: File) => {
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    // Buscar TODOS os custos existentes (independente do mês), para casar duplicados por nome.
    const { data: existingAll, error: existErr } = await supabase
      .from("operating_costs")
      .select("id, name");
    if (existErr) { toast.error(existErr.message); return; }
    const byName = new Map<string, string>();
    for (const c of existingAll ?? []) {
      byName.set(c.name.toLowerCase().trim(), c.id);
    }
    const parsed: ImportRow[] = raw
      .map((r: Record<string, unknown>) => {
        const keys = Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase().trim(), v]));
        const nome = String(keys["nome"] ?? keys["name"] ?? "").trim();
        if (!nome) return null;
        return {
          nome,
          categoria: normalizeCategory(String(keys["categoria"] ?? keys["category"] ?? "")),
          tipo: normalizeType(String(keys["tipo"] ?? keys["type"] ?? "fixo")),
          recorrencia: normalizeRecurrence(String(keys["recorrencia"] ?? keys["recorrência"] ?? "mensal_recorrente")),
          valor: toNumber(keys["valor"] ?? keys["value"]),
          rateio_modo: normalizeMode(String(keys["rateio_modo"] ?? keys["rateio modo"] ?? "percent")),
          rateio_valor: toNumber(keys["rateio_valor"] ?? keys["rateio valor"] ?? 0),
          existingId: byName.get(nome.toLowerCase().trim()) ?? null,
        } as ImportRow;
      })
      .filter((r: ImportRow | null): r is ImportRow => r !== null);
    setRows(parsed);
  };

  const importMut = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      if (rows.length === 0) throw new Error("Nada para importar.");
      const toInsert = rows.filter((r) => !r.existingId);
      const importedAt = new Date().toISOString();
      const idByRow = new Map<ImportRow, string>();
      for (const r of rows) {
        if (r.existingId) idByRow.set(r, r.existingId);
      }
      if (toInsert.length > 0) {
        const payload = toInsert.map((r) => {
          // Categorias sem impacto direto no e-commerce nascem com rateio 0%.
          const forceZero = r.categoria === "fornecedores" || r.categoria === "impostos";
          return {
            owner_id: uid,
            name: r.nome,
            category: r.categoria,
            cost_type: r.tipo,
            recurrence: r.recorrencia,
            amount: r.recorrencia === "mensal_recorrente" ? r.valor : null,
            start_month: month,
            end_month: null,
            ecommerce_mode: forceZero ? "percent" : r.rateio_modo,
            ecommerce_percent: forceZero ? 0 : (r.rateio_modo === "percent" ? r.rateio_valor : 0),
            ecommerce_amount: forceZero ? 0 : (r.rateio_modo === "fixed" ? r.rateio_valor : 0),
            imported_at: importedAt,
          };
        });
        const { data: inserted, error } = await supabase.from("operating_costs").insert(payload).select("id");
        if (error) throw error;
        (inserted ?? []).forEach((row, i) => idByRow.set(toInsert[i], row.id));
      }
      // Sempre gravar o valor do mês em operating_cost_entries (upsert por cost_id + month),
      // inclusive para custos mensal_recorrente — assim cada mês guarda o valor real.
      const entries = rows
        .filter((r) => r.valor > 0 && idByRow.get(r))
        .map((r) => ({ cost_id: idByRow.get(r)!, owner_id: uid, month, amount: r.valor }));
      if (entries.length > 0) {
        const { error: eErr } = await supabase
          .from("operating_cost_entries")
          .upsert(entries, { onConflict: "cost_id,month" });
        if (eErr) throw eErr;
      }
    },
    onSuccess: () => {
      toast.success("Lançamentos importados.");
      onImported();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const news = rows.filter((r) => !r.existingId).length;
  const updates = rows.length - news;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar planilha de custos</DialogTitle>
          <DialogDescription>
            CSV ou XLSX com colunas: <code>nome, categoria, tipo, recorrencia, valor, rateio_modo, rateio_valor</code>. Custos com nome já cadastrado têm apenas o valor do mês atualizado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); }}
            />
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
              <Upload className="mr-1 h-4 w-4" /> Selecionar arquivo
            </Button>
            {fileName ? <span className="text-xs text-muted-foreground">{fileName}</span> : null}
          </div>
          {rows.length > 0 ? (
            <>
              <div className="text-xs text-muted-foreground">
                {rows.length} linha(s) lida(s) — <span className="text-emerald-700 font-medium">{news} serão criados</span>, <span className="text-sky-700 font-medium">{updates} terão o valor do mês atualizado</span>.
                {" "}Referência: {labelMonth(month)}.
              </div>
              <div className="max-h-64 overflow-auto rounded-md border border-border/60">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <TableHead>Nome</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Recorrência</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Rateio</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => (
                      <TableRow key={i} className="text-xs">
                        <TableCell className="font-medium">{r.nome}</TableCell>
                        <TableCell>{catLabel(r.categoria)}</TableCell>
                        <TableCell className="capitalize">{r.tipo}</TableCell>
                        <TableCell>{RECURRENCE_LABEL[r.recorrencia]}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(r.valor)}</TableCell>
                        <TableCell>{r.rateio_modo === "percent" ? `${formatPercent(r.rateio_valor)}` : `${formatBRL(r.rateio_valor)} fixo`}</TableCell>
                        <TableCell>
                          {r.existingId
                            ? <span className="text-sky-700">valor do mês atualizado</span>
                            : <span className="text-emerald-700">custo será criado</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => importMut.mutate()} disabled={importMut.isPending || rows.length === 0}>
            {importMut.isPending ? "Importando..." : `Importar ${rows.length} lançamento(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Aba E-commerce ============

function EcommerceTab({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const today = monthKey(new Date());
  const from12 = addMonths(today, -11);
  const { data: summary } = useSummary(from12, today);
  const validSummary = useMemo(() => (summary ?? []).filter((s) => s.month), [summary]);
  const selectedKey = month.slice(0, 7);
  const { data: rows } = useMonthCosts(month);
  const active = useMemo(() => (rows ?? []).filter((r) => Number(r.amount_ecommerce) > 0), [rows]);

  const totalEco = active.reduce((s, r) => s + Number(r.amount_ecommerce), 0);

  const suppliersTotal = useMemo(
    () => (rows ?? [])
      .filter((r) => r.category === "fornecedores" && Number(r.amount_ecommerce) === 0)
      .reduce((s, r) => s + Number(r.amount_total), 0),
    [rows],
  );

  // Ranking por categoria
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of active) m.set(r.category, (m.get(r.category) ?? 0) + Number(r.amount_ecommerce));
    return Array.from(m.entries()).map(([k, v]) => ({ category: k, value: v })).sort((a, b) => b.value - a.value);
  }, [active]);
  const maxCat = byCategory[0]?.value ?? 0;

  // Receita ML para o mês selecionado
  const monthFrom = month;
  const monthTo = useMemo(() => {
    const d = parseMonth(month);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  }, [month]);

  const { data: mlRevenue } = useQuery({
    queryKey: ["oc-ml-revenue", monthFrom, monthTo],
    queryFn: async () => {
      const { data: accts, error: accErr } = await supabase
        .from("marketplace_accounts")
        .select("id")
        .eq("platform", "mercado_livre");
      if (accErr) throw accErr;
      const ids = (accts ?? []).map((a) => a.id);
      if (ids.length === 0) return 0;
      const { data, error } = await supabase.rpc("ml_metrics", { _account_ids: ids, _from: monthFrom, _to: monthTo });
      if (error) throw error;
      return (data ?? []).reduce((s, r: { revenue?: number | null }) => s + Number(r.revenue ?? 0), 0);
    },
  });

  const pctOverRevenue = mlRevenue && mlRevenue > 0 ? (totalEco / mlRevenue) * 100 : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker value={month} onChange={setMonth} />
        <span className="text-xs text-muted-foreground">Somente leitura. Configure o rateio na aba Lançamentos.</span>
      </div>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="border-primary/40 bg-primary/5 lg:col-span-1">
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Custos no e-commerce</div>
            <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{formatBRL(totalEco)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {pctOverRevenue != null
                ? `${formatPercent(pctOverRevenue)} da receita do período`
                : mlRevenue === 0 ? "Sem receita ML no período" : "Calculando receita..."}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Ranking por categoria</CardTitle></CardHeader>
          <CardContent>
            {byCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum custo rateado.</p>
            ) : (
              <ul className="space-y-2">
                {byCategory.map((c) => {
                  const share = maxCat > 0 ? (c.value / maxCat) * 100 : 0;
                  const pct = totalEco > 0 ? (c.value / totalEco) * 100 : 0;
                  return (
                    <li key={c.category} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">{catLabel(c.category)}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatBRL(c.value)} · {formatPercent(pct)}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted">
                        <div className="h-1.5 rounded-full bg-primary" style={{ width: `${share}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {suppliersTotal > 0 ? (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-primary/90 flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <p>
            O custo da mercadoria não está incluído neste total. <strong>{formatBRL(suppliersTotal)}</strong> em compras de fornecedores foram lançados no mês, mas serão considerados pelo CMV por SKU quando a importação de custos de produto estiver ativa. Até lá, o resultado do e-commerce aparece maior do que o real.
          </p>
        </div>
      ) : null}

      <Card className="border-border/70">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Evolução no e-commerce — 12 meses</CardTitle></CardHeader>
        <CardContent>
          <div className="h-56">
            {validSummary && validSummary.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={validSummary} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ecoGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                  <XAxis dataKey="month" tickFormatter={(v: string) => shortMonth(v)} fontSize={11} />
                  <YAxis fontSize={11} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v/1000)}k` : String(v))} />
                  <RTooltip formatter={(v: number) => [formatBRL(v), "E-commerce"]} labelFormatter={(v: string) => labelMonth(v)} contentStyle={{ fontSize: 12, background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }} />
                  <Area type="monotone" dataKey="total_ecommerce" stroke="var(--primary)" fill="url(#ecoGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem dados suficientes.</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Custos considerados em {labelMonth(month)}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {active.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={PieIcon}
                title="Nenhum custo com rateio para e-commerce."
                description="Configure o rateio na aba Lançamentos."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Valor total</TableHead>
                  <TableHead>Rateio</TableHead>
                  <TableHead className="text-right">Valor e-commerce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {active
                  .slice()
                  .sort((a, b) => Number(b.amount_ecommerce) - Number(a.amount_ecommerce))
                  .map((r) => (
                    <TableRow key={r.id} className="text-sm">
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">{catLabel(r.category)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBRL(Number(r.amount_total))}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {r.ecommerce_mode === "percent"
                          ? `${formatPercent(Number(r.ecommerce_percent))}`
                          : `${formatBRL(Number(r.ecommerce_amount))} fixo`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatBRL(Number(r.amount_ecommerce))}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
// ============ Aba Planilha ============

type SheetRow = {
  category_id: string;
  category_name: string;
  category_kind: "fixo" | "variavel";
  category_sort: number;
  expense_id: string;
  expense_name: string;
  expense_sort: number;
  month: string;
  amount: number;
  amount_ecommerce: number;
};

type CategoryRec = {
  id: string;
  name: string;
  kind: "fixo" | "variavel";
  ecommerce_mode: "percent" | "fixed";
  ecommerce_percent: number;
  ecommerce_amount: number;
  sort_order: number;
  allow_subcategories: boolean;
  parent_category_id: string | null;
};

type ExpenseRec = {
  id: string;
  category_id: string;
  name: string;
  notes: string | null;
  ecommerce_override: boolean;
  ecommerce_mode: "percent" | "fixed";
  ecommerce_percent: number;
  ecommerce_amount: number;
  sort_order: number;
};

const MONTH_ABBR = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const KIND_LABEL: Record<"fixo" | "variavel", string> = { fixo: "CUSTOS FIXOS", variavel: "CUSTOS VARIÁVEIS" };
const YEAR_OPTIONS = [2025, 2026, 2027];

function yearMonthKey(year: number, monthIdx0: number): string {
  const m = String(monthIdx0 + 1).padStart(2, "0");
  return `${year}-${m}-01`;
}

function useSheet(year: number) {
  return useQuery({
    queryKey: ["expense-sheet", year],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      const size = 1000;
      let from = 0;
      const all: SheetRow[] = [];
      for (;;) {
        const { data, error } = await supabase
          .rpc("expense_sheet", { _owner: uid, _year: year })
          .range(from, from + size - 1);
        if (error) throw error;
        const page = (data ?? []) as SheetRow[];
        all.push(...page);
        if (page.length < size) break;
        from += size;
      }
      return all.map((r) => ({
        ...r,
        category_kind: r.category_kind as "fixo" | "variavel",
        amount: Number(r.amount),
        amount_ecommerce: Number(r.amount_ecommerce),
      }));
    },
  });
}

function useCategories() {
  return useQuery({
    queryKey: ["expense-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_categories")
        .select("id,name,kind,ecommerce_mode,ecommerce_percent,ecommerce_amount,sort_order,allow_subcategories,parent_category_id")
        .order("kind")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return ((data ?? []) as unknown) as CategoryRec[];
    },
  });
}

type PrevMode = "pago" | "previsto" | "ambos";
type PrevistoRow = { categoria_efetiva_id: string; gasto_id: string | null; mes: string; valor: number };

type PlanilhaExpenseRow = {
  id: string; name: string; values: number[]; total: number;
  previstoValues: number[]; previstoTotal: number;
};
type PlanilhaSubAgg = {
  category: CategoryRec;
  totals: number[]; grandTotal: number;
  previstoTotals: number[]; previstoGrand: number; soltoValues: number[];
  expenses: PlanilhaExpenseRow[];
};
type PlanilhaTopAgg = {
  category: CategoryRec;
  totals: number[]; grandTotal: number;
  previstoTotals: number[]; previstoGrand: number; soltoValues: number[];
  directExpenses: PlanilhaExpenseRow[];
  directTotals: number[]; directGrand: number;
  subcategories: PlanilhaSubAgg[];
};

function useSheetPrevisto(year: number) {
  return useQuery({
    queryKey: ["expense-sheet-previsto", year],
    staleTime: 30_000,
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      const size = 1000;
      let from = 0;
      const all: PrevistoRow[] = [];
      for (;;) {
        const { data, error } = await supabase
          .rpc("expense_sheet_previsto", { _owner: uid, _year: year })
          .range(from, from + size - 1);
        if (error) throw error;
        const page = (data ?? []) as unknown as PrevistoRow[];
        all.push(...page);
        if (page.length < size) break;
        from += size;
      }
      return all.map((r) => ({
        categoria_efetiva_id: r.categoria_efetiva_id,
        gasto_id: r.gasto_id ?? null,
        mes: String(r.mes),
        valor: Number(r.valor),
      }));
    },
  });
}

function ValueCell({ pago, previsto: previstoRaw, modo: modoRaw, total }: { pago: number; previsto: number; modo: PrevMode; total?: boolean }) {
  // DEMO E-COMMERCE: sem custo previsto — sempre mostra só o valor efetivo.
  const previsto = SHOW_PREVISTO ? previstoRaw : 0;
  const modo: PrevMode = SHOW_PREVISTO ? modoRaw : "pago";
  if (modo === "pago") {
    if (pago || total) return <>{formatBRL(pago)}</>;
    return <span className="text-muted-foreground/60">—</span>;
  }
  if (modo === "previsto") {
    return previsto ? <span className="text-amber-600">{formatBRL(previsto)}</span> : <span className="text-muted-foreground/60">—</span>;
  }
  if (!pago && !previsto && !total) return <span className="text-muted-foreground/60">—</span>;
  return (
    <span className="flex flex-col items-end leading-tight">
      <span>{pago || total ? formatBRL(pago) : <span className="text-muted-foreground/60">—</span>}</span>
      {previsto > 0 && <span className="text-[10px] text-amber-600">{formatBRL(previsto)}</span>}
    </span>
  );
}

function PlanilhaTab() {
  const now = new Date();
  const [year, setYear] = useState<number>(
    YEAR_OPTIONS.includes(now.getFullYear()) ? now.getFullYear() : YEAR_OPTIONS[0],
  );
  const [openSections, setOpenSections] = useState<Record<"fixo" | "variavel", boolean>>({ fixo: true, variavel: true });
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<CategoryRec | null>(null);
  const [newCatParent, setNewCatParent] = useState<{ id: string; name: string; kind: "fixo" | "variavel" } | null>(null);
  const [expModalOpen, setExpModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingExp, setEditingExp] = useState<{ expenseId: string | null; categoryId: string | null }>({ expenseId: null, categoryId: null });

  const { data: sheet, isLoading, error: sheetError } = useSheet(year);
  const { data: cats, error: catsError } = useCategories();
  const { data: previsto, error: previstoError } = useSheetPrevisto(year);
  const loadError = sheetError ?? catsError ?? previstoError;
  const [modo, setModo] = useState<PrevMode>("pago");

  const previstoIdx = useMemo(() => {
    const porGasto = new Map<string, number[]>();
    const soltoPorCategoria = new Map<string, number[]>();
    for (const r of previsto ?? []) {
      const m = parseMonth(r.mes).getMonth();
      if (m < 0 || m > 11) continue;
      if (r.gasto_id) {
        let arr = porGasto.get(r.gasto_id);
        if (!arr) { arr = Array(12).fill(0); porGasto.set(r.gasto_id, arr); }
        arr[m] += r.valor;
      } else {
        let arr = soltoPorCategoria.get(r.categoria_efetiva_id);
        if (!arr) { arr = Array(12).fill(0); soltoPorCategoria.set(r.categoria_efetiva_id, arr); }
        arr[m] += r.valor;
      }
    }
    return { porGasto, soltoPorCategoria };
  }, [previsto]);

  // Build grouped structure. Top-level categories are shown; subcategories nest under their parent.
  const grouped = useMemo(() => {
    const catsList = cats ?? [];
    type ExpenseAgg = { id: string; name: string; sort: number; values: number[]; total: number };
    const byCat: Record<string, {
      category: CategoryRec;
      expenses: Map<string, ExpenseAgg>;
    }> = {};
    for (const c of catsList) {
      byCat[c.id] = { category: c, expenses: new Map() };
    }
    for (const r of sheet ?? []) {
      let bucket = byCat[r.category_id];
      if (!bucket) {
        bucket = {
          category: {
            id: r.category_id, name: r.category_name, kind: r.category_kind,
            ecommerce_mode: "percent", ecommerce_percent: 0, ecommerce_amount: 0, sort_order: r.category_sort,
            allow_subcategories: false, parent_category_id: null,
          },
          expenses: new Map(),
        };
        byCat[r.category_id] = bucket;
      }
      let e = bucket.expenses.get(r.expense_id);
      if (!e) {
        e = { id: r.expense_id, name: r.expense_name, sort: r.expense_sort, values: Array(12).fill(0), total: 0 };
        bucket.expenses.set(r.expense_id, e);
      }
      const m = parseMonth(r.month).getMonth();
      e.values[m] = r.amount;
      e.total += r.amount;
    }

    // Group subcategory ids by parent
    const subsByParent: Record<string, string[]> = {};
    for (const b of Object.values(byCat)) {
      if (b.category.parent_category_id) {
        (subsByParent[b.category.parent_category_id] ||= []).push(b.category.id);
      }
    }

    const sections: Record<"fixo" | "variavel", {
      totals: number[]; grandTotal: number;
      previstoTotals: number[]; previstoGrand: number;
      cats: PlanilhaTopAgg[];
    }> = {
      fixo: { totals: Array(12).fill(0), grandTotal: 0, previstoTotals: Array(12).fill(0), previstoGrand: 0, cats: [] },
      variavel: { totals: Array(12).fill(0), grandTotal: 0, previstoTotals: Array(12).fill(0), previstoGrand: 0, cats: [] },
    };

    const zeros = () => Array(12).fill(0) as number[];
    const prevOfExpense = (id: string) => previstoIdx.porGasto.get(id) ?? null;
    const soltoOf = (catId: string) => previstoIdx.soltoPorCategoria.get(catId) ?? null;

    const listExpenses = (bucket: { expenses: Map<string, ExpenseAgg> }): PlanilhaExpenseRow[] => {
      const base = Array.from(bucket.expenses.values());
      // gastos sem realizado, mas com previsto, precisam aparecer
      return base
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
        .map((e) => {
          const pv = prevOfExpense(e.id);
          const previstoValues = pv ? pv.slice() : zeros();
          const previstoTotal = previstoValues.reduce((s, v) => s + v, 0);
          return { id: e.id, name: e.name, values: e.values, total: e.total, previstoValues, previstoTotal };
        });
    };

    for (const bucket of Object.values(byCat)) {
      if (bucket.category.parent_category_id) continue; // subcategorias entram nos pais abaixo
      const directExpenses = listExpenses(bucket);
      const directTotals = zeros();
      const directPrevisto = zeros();
      let directGrand = 0;
      let directPrevistoGrand = 0;
      for (const e of directExpenses) {
        for (let i = 0; i < 12; i++) {
          directTotals[i] += e.values[i];
          directPrevisto[i] += e.previstoValues[i];
        }
        directGrand += e.total;
        directPrevistoGrand += e.previstoTotal;
      }
      const subIds = subsByParent[bucket.category.id] ?? [];
      const subcategories: PlanilhaSubAgg[] = subIds
        .map((sid) => byCat[sid])
        .filter(Boolean)
        .map((sb) => {
          const exps = listExpenses(sb);
          const t = zeros();
          const pt = zeros();
          let g = 0;
          let pg = 0;
          for (const e of exps) {
            for (let i = 0; i < 12; i++) {
              t[i] += e.values[i];
              pt[i] += e.previstoValues[i];
            }
            g += e.total;
            pg += e.previstoTotal;
          }
          const solto = soltoOf(sb.category.id);
          const soltoValues = solto ? solto.slice() : zeros();
          for (let i = 0; i < 12; i++) { pt[i] += soltoValues[i]; pg += soltoValues[i]; }
          return {
            category: sb.category, totals: t, grandTotal: g, expenses: exps,
            previstoTotals: pt, previstoGrand: pg, soltoValues,
          };
        })
        .sort((a, b) =>
          a.category.sort_order - b.category.sort_order || a.category.name.localeCompare(b.category.name),
        );
      const combinedTotals = directTotals.slice();
      const combinedPrevisto = directPrevisto.slice();
      let combinedGrand = directGrand;
      let combinedPrevistoGrand = directPrevistoGrand;
      for (const sc of subcategories) {
        for (let i = 0; i < 12; i++) {
          combinedTotals[i] += sc.totals[i];
          combinedPrevisto[i] += sc.previstoTotals[i];
        }
        combinedGrand += sc.grandTotal;
        combinedPrevistoGrand += sc.previstoGrand;
      }
      const soltoTop = soltoOf(bucket.category.id);
      const soltoValues = soltoTop ? soltoTop.slice() : zeros();
      for (let i = 0; i < 12; i++) { combinedPrevisto[i] += soltoValues[i]; combinedPrevistoGrand += soltoValues[i]; }
      const kind: "fixo" | "variavel" = bucket.category.kind === "fixo" ? "fixo" : "variavel";
      sections[kind].cats.push({
        category: bucket.category,
        totals: combinedTotals,
        grandTotal: combinedGrand,
        previstoTotals: combinedPrevisto,
        previstoGrand: combinedPrevistoGrand,
        soltoValues,
        directExpenses,
        directTotals,
        directGrand,
        subcategories,
      });
      for (let i = 0; i < 12; i++) {
        sections[kind].totals[i] += combinedTotals[i];
        sections[kind].previstoTotals[i] += combinedPrevisto[i];
      }
      sections[kind].grandTotal += combinedGrand;
      sections[kind].previstoGrand += combinedPrevistoGrand;
    }

    for (const kind of ["fixo", "variavel"] as const) {
      sections[kind].cats.sort((a, b) =>
        a.category.sort_order - b.category.sort_order || a.category.name.localeCompare(b.category.name),
      );
    }

    const monthTotals = Array(12).fill(0) as number[];
    for (let i = 0; i < 12; i++) monthTotals[i] = sections.fixo.totals[i] + sections.variavel.totals[i];
    const grand = sections.fixo.grandTotal + sections.variavel.grandTotal;
    const previstoMonthTotals = Array(12).fill(0) as number[];
    for (let i = 0; i < 12; i++) previstoMonthTotals[i] = sections.fixo.previstoTotals[i] + sections.variavel.previstoTotals[i];
    const previstoGrand = sections.fixo.previstoGrand + sections.variavel.previstoGrand;

    return { sections, monthTotals, grand, previstoMonthTotals, previstoGrand };
  }, [sheet, cats, previstoIdx]);

  const hasAnyCategory = (cats?.length ?? 0) > 0;

  const openNewCategory = () => { setEditingCat(null); setNewCatParent(null); setCatModalOpen(true); };
  const openNewSubcategory = (parent: CategoryRec) => {
    setEditingCat(null);
    setNewCatParent({ id: parent.id, name: parent.name, kind: parent.kind });
    setCatModalOpen(true);
  };
  const openEditCategory = (c: CategoryRec) => { setEditingCat(c); setNewCatParent(null); setCatModalOpen(true); };
  const openNewExpense = (categoryId: string) => { setEditingExp({ expenseId: null, categoryId }); setExpModalOpen(true); };
  const openEditExpense = (expenseId: string) => { setEditingExp({ expenseId, categoryId: null }); setExpModalOpen(true); };

  return (
    <div className="space-y-4">
      {loadError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-3">
            <p className="text-xs font-semibold text-destructive">Falha ao carregar os dados da planilha</p>
            <p className="text-xs text-muted-foreground font-mono break-all">
              {loadError instanceof Error ? loadError.message : String(loadError)}
            </p>
          </CardContent>
        </Card>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
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
        <div className="flex items-center gap-2">
          {SHOW_PREVISTO && (
          <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
            {([
              { v: "pago", label: "Pago" },
              { v: "previsto", label: "Previsto" },
              { v: "ambos", label: "Ambos" },
            ] as const).map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setModo(o.v)}
                className={cn(
                  "px-3 h-8 text-xs rounded-[5px] transition-colors",
                  modo === o.v ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          )}
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-1" /> Importar planilha
          </Button>
          <Button size="sm" onClick={openNewCategory}>
            <Plus className="h-4 w-4 mr-1" /> Nova categoria
          </Button>
        </div>
      </div>

      {!hasAnyCategory && !isLoading ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              icon={Table2}
              title="Nenhuma categoria criada"
              description='Comece criando uma categoria de gastos, como "Salários" ou "Gastos prédio".'
              action={<Button size="sm" onClick={openNewCategory}><Plus className="h-4 w-4 mr-1" /> Nova categoria</Button>}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full min-w-max text-xs border-collapse">
              <thead>
                <tr className="border-b bg-muted text-[11px] uppercase text-muted-foreground">
                  <th className="sticky left-0 z-20 bg-muted border-r border-border text-left px-3 py-2 min-w-[240px] max-w-[240px]">Categoria / Gasto</th>
                  {MONTH_ABBR.map((m, i) => (
                    <th key={i} className="text-right px-2 py-2 min-w-[92px] pr-3">{m}</th>
                  ))}
                  <th className="text-right px-3 py-2 min-w-[110px] bg-muted">Total</th>
                  <th className="bg-muted w-auto" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {(["fixo", "variavel"] as const).map((kind) => {
                  const sec = grouped.sections[kind];
                  if (!sec) return null;
                  const isOpen = openSections[kind];
                  return (
                    <PlanilhaSection
                      key={kind}
                      kind={kind}
                      year={year}
                      isOpen={isOpen}
                      onToggle={() => setOpenSections((s) => ({ ...s, [kind]: !s[kind] }))}
                      totals={sec.totals}
                      grand={sec.grandTotal}
                      previstoTotals={sec.previstoTotals}
                      previstoGrand={sec.previstoGrand}
                      modo={modo}
                      cats={sec.cats}
                      openCats={openCats}
                      setOpenCats={setOpenCats}
                      onEditCategory={openEditCategory}
                      onNewExpense={openNewExpense}
                      onEditExpense={openEditExpense}
                      onNewSubcategory={openNewSubcategory}
                    />
                  );
                })}
                <tr className="border-t-2 border-primary/40 bg-muted font-semibold">
                  <td className="sticky left-0 z-20 bg-muted border-r border-border px-3 py-2 truncate max-w-[240px]">TOTAL</td>
                  {grouped.monthTotals.map((v, i) => (
                    <td key={i} className="text-right px-2 py-2 tabular-nums text-[11px]" title={v ? formatBRL(v) : undefined}>
                      <ValueCell pago={v} previsto={grouped.previstoMonthTotals[i]} modo={modo} />
                    </td>
                  ))}
                  <td className="text-right px-3 py-2 tabular-nums bg-muted">
                    <ValueCell pago={grouped.grand} previsto={grouped.previstoGrand} modo={modo} total />
                  </td>
                  <td className="bg-muted" aria-hidden />
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <CategoryModal
        open={catModalOpen}
        onOpenChange={setCatModalOpen}
        editing={editingCat}
        parent={newCatParent}
      />
      <ExpenseModal
        open={expModalOpen}
        onOpenChange={setExpModalOpen}
        year={year}
        expenseId={editingExp.expenseId}
        defaultCategoryId={editingExp.categoryId}
      />
      <PlanilhaImportDialog open={importOpen} onOpenChange={setImportOpen} defaultYear={year} />

    </div>
  );
}

function PlanilhaSection({
  kind, year, isOpen, onToggle, totals, grand, previstoTotals, previstoGrand, modo, cats, openCats, setOpenCats,
  onEditCategory, onNewExpense, onEditExpense, onNewSubcategory,
}: {
  kind: "fixo" | "variavel";
  year: number;
  isOpen: boolean;
  onToggle: () => void;
  totals: number[];
  grand: number;
  previstoTotals: number[];
  previstoGrand: number;
  modo: PrevMode;
  cats: PlanilhaTopAgg[];
  openCats: Record<string, boolean>;
  setOpenCats: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  onEditCategory: (c: CategoryRec) => void;
  onNewExpense: (categoryId: string) => void;
  onEditExpense: (expenseId: string) => void;
  onNewSubcategory: (parent: CategoryRec) => void;
}) {
  return (
    <>
      <tr className="border-y-2 border-border bg-muted text-sm font-bold uppercase tracking-wide text-foreground">
        <td className="sticky left-0 z-20 bg-muted border-r border-border px-3 py-3 truncate max-w-[240px]">
          <button type="button" onClick={onToggle} className="inline-flex items-center gap-1.5 hover:text-primary">
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {KIND_LABEL[kind]}
          </button>
        </td>
        {totals.map((v, i) => (
          <td key={i} className="text-right px-2 py-3 tabular-nums text-xs bg-muted" title={v ? formatBRL(v) : undefined}>
            <ValueCell pago={v} previsto={previstoTotals[i]} modo={modo} />
          </td>
        ))}
        <td className="text-right px-3 py-3 tabular-nums text-xs bg-muted">
          <ValueCell pago={grand} previsto={previstoGrand} modo={modo} total />
        </td>
        <td className="bg-muted" aria-hidden />
      </tr>
      {isOpen && cats.length === 0 && (
        <tr className="border-b">
          <td colSpan={15} className="px-3 py-2 text-xs text-muted-foreground italic">Nenhuma categoria em {KIND_LABEL[kind].toLowerCase()}.</td>
        </tr>
      )}
      {isOpen && cats.map((row) => {
        const open = !!openCats[row.category.id];
        return (
          <PlanilhaCategoryRows
            key={row.category.id}
            year={year}
            open={open}
            onToggle={() => setOpenCats((prev) => ({ ...prev, [row.category.id]: !prev[row.category.id] }))}
            row={row}
            modo={modo}
            openCats={openCats}
            setOpenCats={setOpenCats}
            onEditCategory={onEditCategory}
            onNewExpense={onNewExpense}
            onEditExpense={onEditExpense}
            onNewSubcategory={onNewSubcategory}
          />
        );
      })}
    </>
  );
}

function PlanilhaCategoryRows({
  open, year, onToggle, row, modo, openCats, setOpenCats,
  onEditCategory, onNewExpense, onEditExpense, onNewSubcategory,
}: {
  open: boolean;
  year: number;
  onToggle: () => void;
  row: PlanilhaTopAgg;
  modo: PrevMode;
  openCats: Record<string, boolean>;
  setOpenCats: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  onEditCategory: (c: CategoryRec) => void;
  onNewExpense: (categoryId: string) => void;
  onEditExpense: (expenseId: string) => void;
  onNewSubcategory: (parent: CategoryRec) => void;
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("expense_categories").delete().eq("id", row.category.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Categoria excluída.");
      qc.invalidateQueries({ queryKey: ["expense-categories"] });
      qc.invalidateQueries({ queryKey: ["expense-sheet"] });
      qc.invalidateQueries({ queryKey: ["expense-sheet-previsto"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao excluir."),
  });

  const allowSubs = row.category.allow_subcategories;
  const hasContent = row.subcategories.length > 0 || row.directExpenses.length > 0;
  const hasSolto = SHOW_PREVISTO && modo !== "pago" && row.soltoValues.some((v) => v > 0);
  const soltoTotal = row.soltoValues.reduce((s, v) => s + v, 0);

  return (
    <>
      <tr className="border-b group hover:bg-muted/30 bg-card">
        <td className="sticky left-0 z-20 bg-card border-r border-border px-3 py-2.5 max-w-[240px]">
          <div className="flex items-center gap-1.5 min-w-0">
            <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 hover:text-primary text-[13px] font-semibold">
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <span className="truncate">{row.category.name}</span>
            </button>
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 ml-1 shrink-0">
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                title={allowSubs ? "Adicionar subcategoria" : "Adicionar gasto"}
                onClick={() => (allowSubs ? onNewSubcategory(row.category) : onNewExpense(row.category.id))}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Editar categoria"
                onClick={() => onEditCategory(row.category)}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive" title="Excluir categoria"
                onClick={() => {
                  if (confirm(`Excluir a categoria "${row.category.name}" e todos os seus gastos?`)) del.mutate();
                }}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </td>
        {row.totals.map((v, i) => (
          <td key={i} className="text-right px-2 py-2.5 tabular-nums text-[13px]" title={v ? formatBRL(v) : undefined}>
            <ValueCell pago={v} previsto={row.previstoTotals[i]} modo={modo} />
          </td>
        ))}
        <td className="text-right px-3 py-2.5 tabular-nums font-medium text-[13px] bg-muted">
          <ValueCell pago={row.grandTotal} previsto={row.previstoGrand} modo={modo} total />
        </td>
        <td className="bg-muted" aria-hidden />
      </tr>
      {open && !hasContent && (
        <tr className="border-b">
          <td className="sticky left-0 z-20 bg-card border-r border-border px-3 py-1.5 pl-10 max-w-[240px]">
            <div className="flex items-center gap-3">
              {!allowSubs && (
                <button type="button" onClick={() => onNewExpense(row.category.id)}
                  className="text-xs font-normal text-muted-foreground hover:text-primary italic inline-flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Adicionar gasto
                </button>
              )}
              {allowSubs && (
                <button type="button" onClick={() => onNewSubcategory(row.category)}
                  className="text-xs font-normal text-muted-foreground hover:text-primary italic inline-flex items-center gap-1">
                  <Layers className="h-3 w-3" /> Nova subcategoria
                </button>
              )}
            </div>
          </td>
          {Array.from({ length: 12 }).map((_, i) => (
            <td key={i} className="text-right px-2 py-1.5 text-muted-foreground/60 text-xs">—</td>
          ))}
          <td className="text-right px-3 py-1.5 text-muted-foreground/60 bg-muted text-xs">—</td>
          <td className="bg-muted" aria-hidden />
        </tr>
      )}
      {open && row.subcategories.map((sc) => {
        const subOpen = !!openCats[sc.category.id];
        return (
          <PlanilhaSubcategoryRows
            key={sc.category.id}
            year={year}
            open={subOpen}
            onToggle={() => setOpenCats((prev) => ({ ...prev, [sc.category.id]: !prev[sc.category.id] }))}
            row={sc}
            modo={modo}
            onEditCategory={onEditCategory}
            onNewExpense={onNewExpense}
            onEditExpense={onEditExpense}
          />
        );
      })}
      {open && row.directExpenses.map((e) => (
        <ExpenseRowInline
          key={e.id}
          expense={e}
          modo={modo}
          onEdit={() => onEditExpense(e.id)}
          indentLevel={0}
        />
      ))}
      {open && hasSolto && (
        <tr className="border-b bg-card">
          <td className="sticky left-0 z-20 bg-card border-r border-border px-3 py-1.5 pl-10 max-w-[240px]">
            <span className="text-[11px] italic text-amber-600">sem gasto detalhado</span>
          </td>
          {row.soltoValues.map((v, i) => (
            <td key={i} className="text-right px-2 py-1.5 tabular-nums text-xs" title={v ? formatBRL(v) : undefined}>
              <ValueCell pago={0} previsto={v} modo="previsto" />
            </td>
          ))}
          <td className="text-right px-3 py-1.5 tabular-nums text-xs bg-muted">
            <ValueCell pago={0} previsto={soltoTotal} modo="previsto" />
          </td>
          <td className="bg-muted" aria-hidden />
        </tr>
      )}
    </>
  );
}

function PlanilhaSubcategoryRows({
  open, year, onToggle, row, modo, onEditCategory, onNewExpense, onEditExpense,
}: {
  open: boolean;
  year: number;
  onToggle: () => void;
  row: PlanilhaSubAgg;
  modo: PrevMode;
  onEditCategory: (c: CategoryRec) => void;
  onNewExpense: (categoryId: string) => void;
  onEditExpense: (expenseId: string) => void;
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("expense_categories").delete().eq("id", row.category.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Subcategoria excluída.");
      qc.invalidateQueries({ queryKey: ["expense-categories"] });
      qc.invalidateQueries({ queryKey: ["expense-sheet"] });
      qc.invalidateQueries({ queryKey: ["expense-sheet-previsto"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao excluir."),
  });
  void year;
  const hasSolto = SHOW_PREVISTO && modo !== "pago" && row.soltoValues.some((v) => v > 0);
  const soltoTotal = row.soltoValues.reduce((s, v) => s + v, 0);

  return (
    <>
      <tr className="border-b group hover:bg-muted/20 bg-card/70">
        <td className="sticky left-0 z-20 bg-card/70 border-r border-border px-3 py-2 pl-8 max-w-[240px]">
          <div className="flex items-center gap-1.5 min-w-0">
            <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 hover:text-primary text-xs font-semibold text-foreground/90">
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <span className="truncate">{row.category.name}</span>
            </button>
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 ml-1 shrink-0">
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Adicionar gasto"
                onClick={() => onNewExpense(row.category.id)}><Plus className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Editar subcategoria"
                onClick={() => onEditCategory(row.category)}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive" title="Excluir subcategoria"
                onClick={() => {
                  if (confirm(`Excluir a subcategoria "${row.category.name}" e todos os seus gastos?`)) del.mutate();
                }}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </td>
        {row.totals.map((v, i) => (
          <td key={i} className="text-right px-2 py-2 tabular-nums text-xs" title={v ? formatBRL(v) : undefined}>
            <ValueCell pago={v} previsto={row.previstoTotals[i]} modo={modo} />
          </td>
        ))}
        <td className="text-right px-3 py-2 tabular-nums text-xs bg-muted">
          <ValueCell pago={row.grandTotal} previsto={row.previstoGrand} modo={modo} total />
        </td>
        <td className="bg-muted" aria-hidden />
      </tr>
      {open && row.expenses.length === 0 && (
        <tr className="border-b">
          <td className="sticky left-0 z-20 bg-card border-r border-border px-3 py-1.5 pl-16 max-w-[240px]">
            <button type="button" onClick={() => onNewExpense(row.category.id)}
              className="text-xs font-normal text-muted-foreground hover:text-primary italic inline-flex items-center gap-1">
              <Plus className="h-3 w-3" /> Adicionar gasto
            </button>
          </td>
          {Array.from({ length: 12 }).map((_, i) => (
            <td key={i} className="text-right px-2 py-1.5 text-muted-foreground/60 text-xs">—</td>
          ))}
          <td className="text-right px-3 py-1.5 text-muted-foreground/60 bg-muted text-xs">—</td>
          <td className="bg-muted" aria-hidden />
        </tr>
      )}
      {open && row.expenses.map((e) => (
        <ExpenseRowInline
          key={e.id}
          expense={e}
          modo={modo}
          onEdit={() => onEditExpense(e.id)}
          indentLevel={1}
        />
      ))}
      {open && hasSolto && (
        <tr className="border-b bg-card">
          <td className="sticky left-0 z-20 bg-card border-r border-border px-3 py-1.5 pl-16 max-w-[240px]">
            <span className="text-[11px] italic text-amber-600">sem gasto detalhado</span>
          </td>
          {row.soltoValues.map((v, i) => (
            <td key={i} className="text-right px-2 py-1.5 tabular-nums text-xs" title={v ? formatBRL(v) : undefined}>
              <ValueCell pago={0} previsto={v} modo="previsto" />
            </td>
          ))}
          <td className="text-right px-3 py-1.5 tabular-nums text-xs bg-muted">
            <ValueCell pago={0} previsto={soltoTotal} modo="previsto" />
          </td>
          <td className="bg-muted" aria-hidden />
        </tr>
      )}
    </>
  );
}

function ExpenseRowInline({
  expense,
  modo,
  onEdit,
  indentLevel,
}: {
  expense: PlanilhaExpenseRow;
  modo: PrevMode;
  onEdit: () => void;
  indentLevel: 0 | 1;
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("expenses").delete().eq("id", expense.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Gasto excluído.");
      qc.invalidateQueries({ queryKey: ["expense-sheet"] });
      qc.invalidateQueries({ queryKey: ["expense-sheet-previsto"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao excluir."),
  });

  const pad = indentLevel === 1 ? "pl-16" : "pl-10";

  return (
    <tr className="border-b group hover:bg-muted/20 bg-card">
      <td className={cn("sticky left-0 z-20 bg-card border-r border-border px-3 py-1.5 max-w-[240px]", pad)}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-xs font-normal text-foreground" title={expense.name}>{expense.name}</span>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 ml-1 shrink-0">
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Editar gasto" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
              title="Excluir gasto"
              onClick={() => {
                if (confirm(`Excluir o gasto "${expense.name}" e todos os seus valores?`)) del.mutate();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </td>
      {expense.values.map((v, i) => (
        <td key={i} className="text-right px-2 py-1.5 tabular-nums text-xs" title={v ? formatBRL(v) : undefined}>
          <ValueCell pago={v} previsto={expense.previstoValues[i]} modo={modo} />
        </td>
      ))}
      <td className="text-right px-3 py-1.5 tabular-nums font-medium bg-muted text-xs">
        <ValueCell pago={expense.total} previsto={expense.previstoTotal} modo={modo} total />
      </td>
      <td className="bg-muted" aria-hidden />
    </tr>
  );
}

function CategoryModal({
  open, onOpenChange, editing, parent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: CategoryRec | null;
  parent: { id: string; name: string; kind: "fixo" | "variavel" } | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"fixo" | "variavel">("fixo");
  const [ecoMode, setEcoMode] = useState<"percent" | "fixed">("percent");
  const [ecoPercent, setEcoPercent] = useState<string>("0");
  const [ecoAmount, setEcoAmount] = useState<string>("0");

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setKind(editing?.kind ?? parent?.kind ?? "fixo");
      setEcoMode(editing?.ecommerce_mode ?? "percent");
      setEcoPercent(String(editing?.ecommerce_percent ?? 0));
      setEcoAmount(String(editing?.ecommerce_amount ?? 0));
    }
  }, [open, editing, parent]);

  const isSub = !editing && !!parent;
  const isEditingSub = !!editing?.parent_category_id;

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Nome é obrigatório.");
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      const payload: {
        owner_id: string; name: string; kind: "fixo" | "variavel";
        ecommerce_mode: "percent" | "fixed"; ecommerce_percent: number; ecommerce_amount: number;
        parent_category_id?: string | null;
      } = {
        owner_id: uid,
        name: name.trim(),
        kind,
        // DEMO E-COMMERCE: sem rateio — todo custo conta 100% no e-commerce.
        ecommerce_mode: SHOW_RATEIO ? ecoMode : "percent",
        ecommerce_percent: SHOW_RATEIO ? (Number(ecoPercent.replace(",", ".")) || 0) : 100,
        ecommerce_amount: SHOW_RATEIO ? (parseBRLInput(ecoAmount) || 0) : 0,
      };
      if (editing) {
        const { error } = await supabase.from("expense_categories").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        if (parent) payload.parent_category_id = parent.id;
        const { error } = await supabase.from("expense_categories").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(
        editing
          ? (isEditingSub ? "Subcategoria atualizada." : "Categoria atualizada.")
          : (isSub ? "Subcategoria criada." : "Categoria criada."),
      );
      qc.invalidateQueries({ queryKey: ["expense-categories"] });
      qc.invalidateQueries({ queryKey: ["expense-sheet"] });
      onOpenChange(false);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao salvar."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? (isEditingSub ? "Editar subcategoria" : "Editar categoria")
              : (isSub ? `Nova subcategoria em ${parent?.name}` : "Nova categoria")}
          </DialogTitle>
          <DialogDescription>Organize os gastos da operação em categorias e subcategorias.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={isSub ? "Ex.: COGRA" : "Ex.: Salários"} />
          </div>
          {!isSub && !isEditingSub && (
          <div>
            <Label>Tipo</Label>
            <div className="flex w-full rounded-md border border-border/70 bg-background overflow-hidden">
              <button
                type="button"
                onClick={() => setKind("fixo")}
                className={cn(
                  "flex-1 px-3 py-2 text-sm font-medium transition-colors",
                  kind === "fixo" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                Fixo
              </button>
              <button
                type="button"
                onClick={() => setKind("variavel")}
                className={cn(
                  "flex-1 px-3 py-2 text-sm font-medium transition-colors",
                  kind === "variavel" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                Variável
              </button>
            </div>
          </div>
          )}
          {(isSub || isEditingSub) && (
            <p className="text-xs text-muted-foreground">
              Subcategoria herda o tipo ({KIND_LABEL[kind].toLowerCase()}) da categoria pai.
            </p>
          )}
          {SHOW_RATEIO && (
          <div className="space-y-2">
            <Label>Rateio e-commerce</Label>
            <Select value={ecoMode} onValueChange={(v) => setEcoMode(v as "percent" | "fixed")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Percentual</SelectItem>
                <SelectItem value="fixed">Valor fixo</SelectItem>
              </SelectContent>
            </Select>
            {ecoMode === "percent" ? (
              <div className="flex items-center gap-2">
                <Input value={ecoPercent} onChange={(e) => setEcoPercent(e.target.value)} className="max-w-[120px] tabular-nums" />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">R$</span>
                <Input value={ecoAmount} onChange={(e) => setEcoAmount(e.target.value)} className="max-w-[160px] tabular-nums" />
              </div>
            )}
          </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseModal({
  open, onOpenChange, year, expenseId, defaultCategoryId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  year: number;
  expenseId: string | null;
  defaultCategoryId: string | null;
}) {
  const qc = useQueryClient();
  const { data: cats } = useCategories();

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [override, setOverride] = useState(false);
  const [ecoMode, setEcoMode] = useState<"percent" | "fixed">("percent");
  const [ecoPercent, setEcoPercent] = useState<string>("100");
  const [ecoAmount, setEcoAmount] = useState<string>("0");
  const [amountInput, setAmountInput] = useState<string>("");
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  const [pendingValues, setPendingValues] = useState<number[]>(() => Array(12).fill(0) as number[]);

  // Load expense + monthly values when editing
  const loadKey = expenseId ?? "new";
  const detail = useQuery({
    enabled: open && !!expenseId,
    queryKey: ["expense-detail", loadKey, year],
    queryFn: async () => {
      const { data: e, error: eErr } = await supabase
        .from("expenses")
        .select("id,category_id,name,notes,ecommerce_override,ecommerce_mode,ecommerce_percent,ecommerce_amount,sort_order")
        .eq("id", expenseId as string)
        .single();
      if (eErr) throw eErr;
      const { data: vals, error: vErr } = await supabase
        .from("expense_values")
        .select("month,amount,tem_conta,previsto")
        .eq("expense_id", expenseId as string)
        .gte("month", `${year}-01-01`)
        .lte("month", `${year}-12-01`);
      if (vErr) throw vErr;
      const arr = Array(12).fill(0) as number[];
      // Mês com conta paga no Contas a Pagar: valor = soma das contas, digitado vira previsto.
      const conta = Array(12).fill(null) as ({ previsto: number | null } | null)[];
      for (const v of vals ?? []) {
        const m = parseMonth(v.month).getMonth();
        arr[m] = Number(v.amount);
        if (v.tem_conta) conta[m] = { previsto: v.previsto == null ? null : Number(v.previsto) };
      }
      return { expense: (e as unknown) as ExpenseRec, values: arr, conta };
    },
  });

  useEffect(() => {
    if (!open) return;
    setAmountInput("");
    setRangeStart(null);
    setRangeEnd(null);
    setPendingValues(Array(12).fill(0) as number[]);
    if (expenseId && detail.data) {
      const e = detail.data.expense;
      setName(e.name);
      setCategoryId(e.category_id);
      setNotes(e.notes ?? "");
      setOverride(e.ecommerce_override);
      setEcoMode((e.ecommerce_mode as "percent" | "fixed") ?? "percent");
      setEcoPercent(String(e.ecommerce_percent ?? 0));
      setEcoAmount(String(e.ecommerce_amount ?? 0));
    } else if (!expenseId) {
      setName("");
      setNotes("");
      setOverride(false);
      setEcoMode("percent");
      setEcoPercent("100");
      setEcoAmount("0");
      setCategoryId(defaultCategoryId ?? (cats?.[0]?.id ?? ""));
    }
  }, [open, expenseId, detail.data, defaultCategoryId, cats]);

  const monthValues = expenseId ? (detail.data?.values ?? Array(12).fill(0)) : pendingValues;
  const currentCat = (cats ?? []).find((c) => c.id === categoryId);

  const selected = useMemo(() => {
    if (rangeStart === null) return new Set<number>();
    const a = rangeStart;
    const b = rangeEnd ?? rangeStart;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const s = new Set<number>();
    for (let i = lo; i <= hi; i++) s.add(i);
    return s;
  }, [rangeStart, rangeEnd]);

  const onMonthClick = (i: number) => {
    if (rangeStart === null) { setRangeStart(i); setRangeEnd(null); return; }
    if (rangeEnd === null) { setRangeEnd(i); return; }
    setRangeStart(i); setRangeEnd(null);
  };
  const onMonthDouble = (i: number) => { setRangeStart(i); setRangeEnd(i); };

  const save = useMutation({
    mutationFn: async (overrideValues?: number[]) => {
      if (!name.trim()) throw new Error("Nome é obrigatório.");
      if (!categoryId) throw new Error("Selecione uma categoria.");
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      const payload = {
        owner_id: uid,
        category_id: categoryId,
        name: name.trim(),
        notes: notes.trim() || null,
        ecommerce_override: SHOW_RATEIO ? override : false,
        // DEMO E-COMMERCE: sem rateio — todo custo conta 100% no e-commerce.
        ecommerce_mode: SHOW_RATEIO ? ecoMode : "percent",
        ecommerce_percent: SHOW_RATEIO ? (Number(ecoPercent.replace(",", ".")) || 0) : 100,
        ecommerce_amount: SHOW_RATEIO ? (parseBRLInput(ecoAmount) || 0) : 0,
      };
      if (expenseId) {
        const { error } = await supabase.from("expenses").update(payload).eq("id", expenseId);
        if (error) throw error;
        return expenseId;
      } else {
        const { data, error } = await supabase.from("expenses").insert(payload).select("id").single();
        if (error) throw error;
        const newId = (data as { id: string }).id;
        const rows = (overrideValues ?? pendingValues)
          .map((amount, i) => ({ expense_id: newId, owner_id: uid, month: yearMonthKey(year, i), amount }))
          .filter((r) => r.amount > 0);
        if (rows.length > 0) {
          const { error: vErr } = await supabase
            .from("expense_values")
            .upsert(rows, { onConflict: "expense_id,month" });
          if (vErr) throw vErr;
        }
        return newId;
      }
    },
    onSuccess: () => {
      toast.success(expenseId ? "Gasto atualizado." : "Gasto criado.");
      qc.invalidateQueries({ queryKey: ["expense-sheet"] });
      qc.invalidateQueries({ queryKey: ["expense-detail"] });
      onOpenChange(false);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao salvar."),
  });

  const applyRange = useMutation({
    mutationFn: async (mode: "replace" | "sum") => {
      if (rangeStart === null) throw new Error("Selecione um mês ou intervalo.");
      const amount = parseBRLInput(amountInput);
      if (!Number.isFinite(amount)) throw new Error("Valor inválido.");
      const a = rangeStart;
      const b = rangeEnd ?? rangeStart;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const count = hi - lo + 1;
      if (!expenseId) {
        setPendingValues((prev) => {
          const next = prev.slice();
          for (let i = lo; i <= hi; i++) {
            next[i] = mode === "sum" ? (next[i] || 0) + amount : amount;
          }
          return next;
        });
        return { mode, count };
      }
      if (mode === "replace") {
        const { error } = await supabase.rpc("set_expense_range", {
          _expense_id: expenseId,
          _from_month: yearMonthKey(year, lo),
          _to_month: yearMonthKey(year, hi),
          _amount: amount,
        });
        if (error) throw error;
      } else {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id;
        if (!uid) throw new Error("Sessão expirada.");
        const rows = [];
        for (let i = lo; i <= hi; i++) {
          const current = monthValues[i] || 0;
          rows.push({
            expense_id: expenseId,
            owner_id: uid,
            month: yearMonthKey(year, i),
            amount: current + amount,
          });
        }
        const { error } = await supabase
          .from("expense_values")
          .upsert(rows, { onConflict: "expense_id,month" });
        if (error) throw error;
      }
      return { mode, count };
    },
    onSuccess: (result) => {
      const { mode, count } = result ?? { mode: "replace" as const, count: 0 };
      const verb = mode === "sum" ? "somado" : "substituído";
      const plural = count === 1 ? "mês" : "meses";
      toast.success(`Valor ${verb} em ${count} ${plural}.`);
      if (expenseId) {
        qc.invalidateQueries({ queryKey: ["expense-detail", expenseId] });
        qc.invalidateQueries({ queryKey: ["expense-sheet"] });
      }
      setAmountInput("");
      setRangeStart(null); setRangeEnd(null);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao aplicar."),
  });

  const handleSalvar = async () => {
    const parsed = parseBRLInput(amountInput);
    const temValorAplicar = amountInput.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
    if (!temValorAplicar) { save.mutate(undefined); return; }
    if (selected.size === 0) {
      toast.error("Selecione um ou mais meses para aplicar o valor, ou limpe o campo.");
      return;
    }
    const algumMesSelecionadoTemValor = Array.from(selected).some((i) => (monthValues[i] || 0) > 0);
    if (algumMesSelecionadoTemValor) {
      toast.error("Um ou mais meses selecionados já têm valor. Escolha Somar ou Substituir.");
      return;
    }
    const idxs = Array.from(selected);
    const lo = Math.min(...idxs);
    const hi = Math.max(...idxs);
    if (!expenseId) {
      const next = pendingValues.slice();
      for (let i = lo; i <= hi; i++) next[i] = parsed;
      setPendingValues(next);
      save.mutate(next);
      return;
    }
    const { error } = await supabase.rpc("set_expense_range", {
      _expense_id: expenseId,
      _from_month: yearMonthKey(year, lo),
      _to_month: yearMonthKey(year, hi),
      _amount: parsed,
    });
    if (error) { toast.error(error.message || "Falha ao aplicar."); return; }
    save.mutate(undefined);
  };

  const clearMonth = useMutation({
    mutationFn: async (monthIdx: number) => {
      if (!expenseId) {
        setPendingValues((prev) => {
          const next = prev.slice();
          next[monthIdx] = 0;
          return next;
        });
        return;
      }
      const { error } = await supabase.rpc("clear_expense_month", {
        _expense_id: expenseId,
        _month: yearMonthKey(year, monthIdx),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      if (expenseId) {
        qc.invalidateQueries({ queryKey: ["expense-detail", expenseId] });
        qc.invalidateQueries({ queryKey: ["expense-sheet"] });
      }
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao limpar mês."),
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!expenseId) return;
      const { error } = await supabase.from("expenses").delete().eq("id", expenseId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Gasto excluído.");
      qc.invalidateQueries({ queryKey: ["expense-sheet"] });
      onOpenChange(false);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao excluir."),
  });

  const yearTotal = monthValues.reduce((a, b) => a + b, 0);
  const effMode: "percent" | "fixed" = override ? ecoMode : (currentCat?.ecommerce_mode ?? "percent");
  const effPercent = override ? (Number(ecoPercent.replace(",", ".")) || 0) : (currentCat?.ecommerce_percent ?? 0);
  const effAmount = override ? (parseBRLInput(ecoAmount) || 0) : (currentCat?.ecommerce_amount ?? 0);
  const ecoText = effMode === "percent"
    ? `${effPercent}% × total = ${formatBRL(yearTotal * effPercent / 100)} no ano`
    : `menor entre R$ ${formatBRL(effAmount)} e cada valor mensal`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{expenseId ? "Editar gasto" : "Novo gasto"}</DialogTitle>
          <DialogDescription>
            {expenseId ? "Ajuste dados, valores mensais e rateio." : "Preencha os dados e salve para depois aplicar valores mensais."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Nome do gasto</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Salário do Paulo" />
            </div>
            <div>
              <Label>Categoria</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {(() => {
                    const list = cats ?? [];
                    const byId = new Map(list.map((c) => [c.id, c] as const));
                    // Order: top-level first, immediately followed by its subcategories
                    const tops = list.filter((c) => !c.parent_category_id)
                      .sort((a, b) => a.kind.localeCompare(b.kind) || a.sort_order - b.sort_order || a.name.localeCompare(b.name));
                    const items: { id: string; label: string; sub: string }[] = [];
                    for (const top of tops) {
                      items.push({ id: top.id, label: top.name, sub: top.kind === "fixo" ? "fixo" : "variável" });
                      const subs = list.filter((c) => c.parent_category_id === top.id)
                        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
                      for (const s of subs) {
                        const parentName = byId.get(top.id)?.name ?? "";
                        items.push({ id: s.id, label: `${parentName} › ${s.name}`, sub: s.kind === "fixo" ? "fixo" : "variável" });
                      }
                    }
                    return items.map((it) => (
                      <SelectItem key={it.id} value={it.id}>
                        {it.label} <span className="text-xs text-muted-foreground">({it.sub})</span>
                      </SelectItem>
                    ));
                  })()}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Observação</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Opcional" />
          </div>

          <div className="rounded-md border p-3 space-y-3 bg-muted/20">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-end gap-2">
                  <div>
                    <Label className="text-xs">Valor a aplicar</Label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-muted-foreground">R$</span>
                      <Input value={amountInput} onChange={(e) => setAmountInput(e.target.value)}
                        placeholder="0,00" className="w-40 tabular-nums" />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => applyRange.mutate("replace")}
                    disabled={applyRange.isPending || rangeStart === null || !amountInput}
                  >
                    🔄 Substituir
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => applyRange.mutate("sum")}
                    disabled={applyRange.isPending || rangeStart === null || !amountInput}
                  >
                    ➕ Somar
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                {MONTH_ABBR.map((abbr, i) => {
                  const value = monthValues[i];
                  const isSel = selected.has(i);
                  return (
                    <div key={i}
                      onClick={() => onMonthClick(i)}
                      onDoubleClick={() => onMonthDouble(i)}
                      className={cn(
                        "relative rounded-md border px-2 py-1.5 text-left cursor-pointer select-none transition-colors",
                        isSel
                          ? "border-primary bg-primary/10 ring-1 ring-primary"
                          : "border-border/60 bg-background hover:border-primary/60",
                      )}
                    >
                      <div className="text-[11px] font-medium text-muted-foreground">{abbr}</div>
                      <div className="text-xs tabular-nums font-medium">
                        {value ? formatBRL(value) : <span className="text-muted-foreground/60">—</span>}
                      </div>
                      {detail.data?.conta[i] ? (
                        <div
                          className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground"
                          title="Valor das contas pagas no Contas a Pagar. O que você digitar neste mês vira só o previsto."
                        >
                          <Lock className="h-2.5 w-2.5" />
                          {detail.data.conta[i]!.previsto != null ? `prev. ${formatBRL(detail.data.conta[i]!.previsto!)}` : "contas pagas"}
                        </div>
                      ) : null}
                      {value && !detail.data?.conta[i] ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); clearMonth.mutate(i); }}
                          className="absolute top-0.5 right-0.5 text-muted-foreground hover:text-destructive"
                          title="Limpar este mês"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
          </div>

          {SHOW_RATEIO && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Usar rateio próprio</Label>
                <p className="text-xs text-muted-foreground">
                  {override ? "Rateio configurado abaixo." : `Herdando da categoria: ${
                    currentCat ? (currentCat.ecommerce_mode === "percent"
                      ? `${currentCat.ecommerce_percent}%`
                      : `R$ ${formatBRL(currentCat.ecommerce_amount)} fixo`) : "—"
                  }`}
                </p>
              </div>
              <Switch checked={override} onCheckedChange={setOverride} />
            </div>
            {override && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Select value={ecoMode} onValueChange={(v) => setEcoMode(v as "percent" | "fixed")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percentual</SelectItem>
                    <SelectItem value="fixed">Valor fixo</SelectItem>
                  </SelectContent>
                </Select>
                {ecoMode === "percent" ? (
                  <div className="flex items-center gap-2">
                    <Input value={ecoPercent} onChange={(e) => setEcoPercent(e.target.value)} className="tabular-nums" />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">R$</span>
                    <Input value={ecoAmount} onChange={(e) => setEcoAmount(e.target.value)} className="tabular-nums" />
                  </div>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" /> {ecoText}
            </p>
          </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            Total do ano: <span className="font-semibold text-foreground tabular-nums">{formatBRL(yearTotal)}</span>
          </div>
          <div className="flex items-center gap-2">
            {expenseId && (
              <Button variant="ghost" className="text-destructive hover:text-destructive"
                onClick={() => { if (confirm("Excluir este gasto e todos os valores mensais?")) del.mutate(); }}>
                <Trash2 className="h-4 w-4 mr-1" /> Excluir gasto
              </Button>
            )}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Fechar</Button>
            <Button onClick={() => void handleSalvar()} disabled={save.isPending}>Salvar</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
