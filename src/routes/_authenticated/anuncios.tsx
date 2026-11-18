import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowDown, ArrowUp, Download, ExternalLink, ImageIcon,
  RotateCcw, Search, ShoppingCart, Tags,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PeriodFilter, type PeriodKey } from "@/components/rf/period-filter";
import { EmptyState } from "@/components/rf/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBRL, formatDate, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useVendasSemAliquota } from "@/hooks/use-vendas-sem-aliquota";

export const Route = createFileRoute("/_authenticated/anuncios")({
  head: () => ({
    meta: [
      { title: "Anúncios — Painel Financeiro" },
      { name: "description", content: "Margem por anúncio (MLB) das contas do Mercado Livre." },
      { property: "og:title", content: "Anúncios — Painel Financeiro" },
      { property: "og:description", content: "Margem por anúncio (MLB) das contas do Mercado Livre." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnunciosPage,
});

type Account = { id: string; nickname: string; trade_name: string | null };

type AnuncioRow = {
  account_id: string;
  item_id: string;
  titulo: string;
  seller_sku: string | null;
  thumbnail: string | null;
  permalink: string | null;
  preco_atual: number;
  status: string;
  unidades: number;
  receita: number;
  comissao: number;
  frete: number;
  devolucao: number;
  ads: number;
  cmv: number;
  custo_unit: number;
  is_kit: boolean;
  custo_faltando: boolean;
  componentes_sem_custo: number;
  margem: number;
  imposto: number;
  pedidos_ok: number;
  pedidos_problema: number;
  unidades_canceladas: number;
  valor_perdido: number;
  frete_rateado: number;
  /** Σ preço unitário × quantidade das vendas (sem frete): base do preço médio. Null antes da migração 20261117150000. */
  valor_produto: number | null;
};

type KitComponent = {
  component_sku: string;
  titulo: string | null;
  quantity: number;
  custo_unit: number;
  custo_total: number;
};

const fmtYMD = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

function periodRange(period: PeriodKey, custom?: { from?: Date; to?: Date }): { from: string; to: string; days: number } {
  if (period === "custom" && custom?.from && custom?.to) {
    const from = fmtYMD(custom.from);
    const to = fmtYMD(custom.to);
    const days = Math.max(1, Math.round((custom.to.getTime() - custom.from.getTime()) / 86400000) + 1);
    return { from, to, days };
  }
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  const days = period === "ontem" ? 1 : period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 30;
  const from = new Date(yesterday.getTime() - (days - 1) * 86400000);
  return { from: fmtYMD(from), to: fmtYMD(yesterday), days };
}

function useOwnerId() {
  const q = useQuery({
    queryKey: ["auth-user-id"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });
  return q.data ?? null;
}

type SortKey = "unidades" | "receita" | "comissao" | "frete" | "ads" | "imposto" | "cmv" | "margem" | "margemPct";
type Filtro = "todos" | "com_custo" | "sem_custo" | "margem_pos" | "margem_neg";

const FILTROS: { key: Filtro; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "com_custo", label: "Com custo" },
  { key: "sem_custo", label: "Sem custo" },
  { key: "margem_pos", label: "Margem positiva" },
  { key: "margem_neg", label: "Margem negativa" },
];

function csvEscape(v: string | number): string {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function AnunciosPage() {
  const qc = useQueryClient();
  const ownerId = useOwnerId();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [customRange, setCustomRange] = useState<{ from?: Date; to?: Date }>({});
  const [account, setAccount] = useState("all");
  const [query, setQuery] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [sortKey, setSortKey] = useState<SortKey>("receita");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [custoAlvo, setCustoAlvo] = useState<AnuncioRow | null>(null);
  const [detalheAlvo, setDetalheAlvo] = useState<AnuncioRow | null>(null);

  const { data: accounts } = useQuery({
    queryKey: ["accounts-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketplace_accounts")
        .select("id, nickname, trade_name")
        .eq("platform", "mercado_livre")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });

  const hasAccounts = (accounts?.length ?? 0) > 0;
  const displayName = (a: Account) => a.trade_name?.trim() || a.nickname;
  const accountName = (id: string) => {
    const a = (accounts ?? []).find((x) => x.id === id);
    return a ? displayName(a) : "—";
  };

  const { from, to, days } = useMemo(() => periodRange(period, customRange), [period, customRange]);
  const accountIds = useMemo(
    () => (account === "all" ? (accounts ?? []).map((a) => a.id) : [account]),
    [account, accounts],
  );
  const { data: semAliquota } = useVendasSemAliquota(accountIds, from, to, hasAccounts && accountIds.length > 0);
  const impostoTxt = (v: number) => (semAliquota?.todas ? "—" : formatBRL(v));

  const {
    data: rows,
    isPending,
    error,
  } = useQuery({
    queryKey: ["anuncios-margem", from, to, accountIds.join(",")],
    enabled: hasAccounts && accountIds.length > 0,
    queryFn: async () => {
      const { data, error: err } = await supabase.rpc("anuncios_margem", {
        _account_ids: accountIds,
        _from: from,
        _to: to,
      });
      if (err) throw err;
      return (data ?? []).map((r: Record<string, unknown>): AnuncioRow => ({
        account_id: String(r.account_id),
        item_id: String(r.item_id),
        titulo: String(r.titulo ?? ""),
        seller_sku: (r.seller_sku as string | null) ?? null,
        thumbnail: (r.thumbnail as string | null) ?? null,
        permalink: (r.permalink as string | null) ?? null,
        preco_atual: Number(r.preco_atual) || 0,
        status: String(r.status ?? ""),
        unidades: Number(r.unidades) || 0,
        receita: Number(r.receita) || 0,
        comissao: Number(r.comissao) || 0,
        frete: Number(r.frete) || 0,
        devolucao: Number(r.devolucao) || 0,
        ads: Number(r.ads) || 0,
        cmv: Number(r.cmv) || 0,
        custo_unit: Number(r.custo_unit) || 0,
        is_kit: Boolean(r.is_kit),
        custo_faltando: Boolean(r.custo_faltando),
        componentes_sem_custo: Number(r.componentes_sem_custo) || 0,
        margem: Number(r.margem) || 0,
        imposto: Number(r.imposto) || 0,
        pedidos_ok: Number(r.pedidos_ok) || 0,
        pedidos_problema: Number(r.pedidos_problema) || 0,
        unidades_canceladas: Number(r.unidades_canceladas) || 0,
        valor_perdido: Number(r.valor_perdido) || 0,
        frete_rateado: Number(r.frete_rateado) || 0,
        valor_produto: r.valor_produto == null ? null : Number(r.valor_produto),
      }));
    },
  });

  const { data: adsCobertura } = useQuery({
    queryKey: ["anuncios-ads-cobertura", from, to, accountIds.join(",")],
    enabled: hasAccounts && accountIds.length > 0,
    queryFn: async () => {
      const { data, error: err } = await supabase.rpc("ml_ads_periodo", {
        _account_ids: accountIds,
        _from: from,
        _to: to,
      });
      if (err) throw err;
      const rows = (data ?? []) as Array<{
        account_id: string;
        ads_faturado: number;
        ads_diario: number;
        ads_ancora: number;
        fator: number;
        ads_nao_atribuido: number;
        dias_com_dado: number;
        dias_esperados: number;
        cobertura_ok: boolean;
      }>;
      return rows.reduce(
        (acc, r) => ({
          naoAtribuido: acc.naoAtribuido + (Number(r.ads_nao_atribuido) || 0),
          ancora: acc.ancora + (Number(r.ads_ancora) || 0),
        }),
        { naoAtribuido: 0, ancora: 0 },
      );
    },
  });

  const all = rows ?? [];


  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((r) => {
      if (q) {
        const hay = `${r.titulo} ${r.item_id} ${r.seller_sku ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filtro === "com_custo") return !r.custo_faltando;
      if (filtro === "sem_custo") return r.custo_faltando;
      if (filtro === "margem_pos") return r.margem > 0;
      if (filtro === "margem_neg") return r.margem < 0;
      return true;
    });
  }, [all, query, filtro]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const get = (r: AnuncioRow): number => {
      switch (sortKey) {
        case "unidades": return r.unidades;
        case "receita": return r.receita;
        case "comissao": return r.comissao;
        case "frete": return r.frete + r.devolucao;
        case "ads": return r.ads;
        case "imposto": return r.imposto;
        case "cmv": return r.cmv;
        case "margem": return r.margem;
        case "margemPct": return r.receita > 0 ? (r.margem / r.receita) * 100 : Number.NEGATIVE_INFINITY;
        default: return 0;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === vb) return 0;
      return (va - vb) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey !== k) { setSortKey(k); setSortDir("desc"); return; }
    if (sortDir === "desc") { setSortDir("asc"); return; }
    setSortKey("receita"); setSortDir("desc");
  };

  const SortHead = ({ k, children }: { k: SortKey; children: React.ReactNode }) => {
    const active = sortKey === k;
    return (
      <TableHead className="text-right">
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={cn("inline-flex w-full items-center justify-end gap-1 hover:text-foreground", active && "text-foreground")}
        >
          {children}
          {active ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
        </button>
      </TableHead>
    );
  };

  const exportCsv = () => {
    const header = ["MLB", "Título", "SKU", "Conta", "Unidades", "Receita", "Comissão", "Frete", "Devolução", "Ads", "Custos do período", "Imposto", "CMV", "Margem", "Margem %", "Pedidos OK", "Pedidos com problema", "Unidades canceladas", "Valor perdido"];
    const lines = [header.map(csvEscape).join(";")];
    for (const r of sorted) {
      const pct = r.receita > 0 ? (r.margem / r.receita) * 100 : 0;
      lines.push([
        r.item_id, r.titulo, r.seller_sku ?? "", accountName(r.account_id),
        r.unidades,
        r.receita.toFixed(2).replace(".", ","),
        r.comissao.toFixed(2).replace(".", ","),
        r.frete.toFixed(2).replace(".", ","),
        r.devolucao.toFixed(2).replace(".", ","),
        r.ads.toFixed(2).replace(".", ","),
        r.frete_rateado.toFixed(2).replace(".", ","),
        r.imposto.toFixed(2).replace(".", ","),
        r.cmv.toFixed(2).replace(".", ","),
        r.margem.toFixed(2).replace(".", ","),
        pct.toFixed(2).replace(".", ","),
        r.pedidos_ok,
        r.pedidos_problema,
        r.unidades_canceladas,
        r.valor_perdido.toFixed(2).replace(".", ","),
      ].map(csvEscape).join(";"));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `anuncios-${from}-a-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="p-6 space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-primary">Anúncios</h1>
            </div>
            <p className="text-sm text-muted-foreground">Margem por anúncio (beta)</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-col items-end gap-1">
              <PeriodFilter
                value={period}
                onChange={setPeriod}
                customRange={customRange}
                onCustomRangeChange={setCustomRange}
              />
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {from.split("-").reverse().join("/")} a {to.split("-").reverse().join("/")} · {days} {days === 1 ? "dia" : "dias"}
              </p>
            </div>
            <Select value={account} onValueChange={setAccount}>
              <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue placeholder="Conta" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as contas</SelectItem>
                {accounts?.map((a) => (<SelectItem key={a.id} value={a.id}>{displayName(a)}</SelectItem>))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={sorted.length === 0}>
              <Download className="mr-2 h-4 w-4" /> Exportar CSV
            </Button>
          </div>
        </header>

        {!hasAccounts ? (
          <EmptyState
            icon={ShoppingCart}
            title="Nenhuma conta do Mercado Livre conectada."
            description="Conecte uma conta para ver a margem por anúncio."
            action={
              <Button asChild size="sm">
                <Link to="/configuracoes" search={{ aba: "integracoes" }}>Ir para Integrações</Link>
              </Button>
            }
          />
        ) : error ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="space-y-1 p-4 text-sm">
              <p className="font-medium text-destructive">Não foi possível carregar a margem por anúncio.</p>
              <p className="text-xs text-muted-foreground break-all">{(error as Error).message}</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por título, MLB ou SKU"
                  className="h-8 w-72 pl-7 text-xs"
                />
              </div>
              <div className="inline-flex rounded-md border border-border bg-card/60 p-0.5">
                {FILTROS.map((f) => (
                  <Button
                    key={f.key}
                    size="sm"
                    variant="ghost"
                    onClick={() => setFiltro(f.key)}
                    className={cn("h-7 px-3 text-xs font-medium", filtro === f.key && "bg-primary text-primary-foreground hover:bg-primary/90")}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatNumber(sorted.length)} anúncio{sorted.length === 1 ? "" : "s"}
              </span>
            </div>

            {semAliquota && semAliquota.sem > 0 ? (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-500">
                {semAliquota.sem} de {semAliquota.vendas} vendas do período estão sem alíquota cadastrada: o imposto delas
                não entra na margem, que fica maior do que é.{" "}
                <Link to="/configuracoes" search={{ aba: "empresas" }} className="underline">Cadastrar a alíquota</Link>
              </p>
            ) : null}

            {adsCobertura && adsCobertura.naoAtribuido > 0 ? (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-500">
                {formatBRL(adsCobertura.naoAtribuido)} de investimento em Ads não pôde ser distribuído entre os anúncios neste período, porque os dados diários de campanha não cobrem todos os dias. Esse valor está no custo total da conta, mas não na margem por anúncio abaixo — as margens desta tela estão otimistas.
              </p>
            ) : null}

            <Card className="border-border/60 bg-card/60">

              <CardContent className="p-0">
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_tr]:border-b">
                    <TableRow className="border-b bg-card text-[11px] uppercase tracking-wider text-muted-foreground hover:bg-card">
                      <TableHead className="w-14"></TableHead>
                      <TableHead>Anúncio</TableHead>
                      <TableHead>Conta</TableHead>
                      <SortHead k="unidades">Un.</SortHead>
                      <TableHead className="text-right whitespace-nowrap" title="Preço unitário médio das vendas do período, sem o frete pago pelo comprador">Preço médio</TableHead>
                      <SortHead k="receita">Receita</SortHead>
                      <SortHead k="comissao">Comissão</SortHead>
                      <SortHead k="frete">Frete</SortHead>
                      <SortHead k="ads">Ads</SortHead>
                      <SortHead k="imposto">Imposto</SortHead>
                      <SortHead k="cmv">CMV</SortHead>
                      <SortHead k="margem">Margem R$</SortHead>
                      <SortHead k="margemPct">Margem %</SortHead>
                      <TableHead className="text-right">Problemas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isPending
                      ? Array.from({ length: 6 }).map((_, i) => (
                          <TableRow key={i}>
                            <TableCell colSpan={14}><Skeleton className="h-8 w-full" /></TableCell>
                          </TableRow>
                        ))
                      : sorted.map((r) => {
                          const freteTotal = r.frete + r.devolucao;
                          const pct = r.receita > 0 ? (r.margem / r.receita) * 100 : null;
                          const totalPedidos = r.pedidos_ok + r.pedidos_problema;
                          const pctProblema = totalPedidos > 0 ? (r.pedidos_problema / totalPedidos) * 100 : 0;
                          const semProblema = r.pedidos_problema === 0 && r.valor_perdido === 0;
                          const margemClass = r.custo_faltando
                            ? "text-muted-foreground"
                            : r.margem > 0
                              ? "text-emerald-600"
                              : r.margem < 0
                                ? "text-red-600"
                                : "text-muted-foreground";
                          return (
                            <TableRow
                              key={`${r.account_id}-${r.item_id}`}
                              onClick={() => setDetalheAlvo(r)}
                              className="cursor-pointer hover:bg-muted/30"
                            >
                              <TableCell>
                                <Thumb src={r.thumbnail} alt={r.titulo} />
                              </TableCell>
                              <TableCell className="max-w-[320px]">
                                <div className="flex items-start gap-2">
                                  <p className="line-clamp-2 text-sm">{r.titulo}</p>
                                  {r.is_kit ? (
                                    <span className="mt-0.5 shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground">Kit</span>
                                  ) : null}
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                  {r.permalink ? (
                                    <a
                                      href={r.permalink}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="inline-flex items-center gap-1 hover:text-foreground"
                                    >
                                      {r.item_id}<ExternalLink className="h-3 w-3" />
                                    </a>
                                  ) : (
                                    <span>{r.item_id}</span>
                                  )}
                                  <span>SKU: {r.seller_sku || "—"}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{accountName(r.account_id)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatNumber(r.unidades)}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {precoMedio(r.valor_produto, r.unidades)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{formatBRL(r.receita)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatBRL(r.comissao)}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {r.devolucao > 0 ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="underline decoration-dotted underline-offset-2">{formatBRL(freteTotal)}</span>
                                    </TooltipTrigger>
                                    <TooltipContent>inclui {formatBRL(r.devolucao)} de devoluções</TooltipContent>
                                  </Tooltip>
                                ) : (
                                  formatBRL(freteTotal)
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{formatBRL(r.ads)}</TableCell>
                              <TableCell className="text-right tabular-nums">{impostoTxt(r.imposto)}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {r.custo_faltando ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setCustoAlvo(r); }}
                                        className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-500"
                                      >
                                        <AlertTriangle className="h-3.5 w-3.5" /> sem custo
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[240px] space-y-1">
                                      <p className="text-xs">
                                        {r.is_kit && r.componentes_sem_custo > 0
                                          ? `${r.componentes_sem_custo} componente(s) do kit sem custo`
                                          : "Este SKU não tem custo cadastrado"}
                                      </p>
                                      <p className="text-[11px] opacity-80">Clique em “sem custo” para preencher.</p>
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  formatBRL(r.cmv)
                                )}
                              </TableCell>
                              <TableCell className={cn("text-right tabular-nums font-medium", margemClass)}>
                                {r.custo_faltando ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="underline decoration-dotted underline-offset-2">{formatBRL(r.margem)}*</span>
                                    </TooltipTrigger>
                                    <TooltipContent>Margem sem o custo do produto — não confiável</TooltipContent>
                                  </Tooltip>
                                ) : (
                                  formatBRL(r.margem)
                                )}
                              </TableCell>
                              <TableCell className={cn("text-right tabular-nums", margemClass)}>
                                {pct == null ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <>
                                    {formatPercent(pct)}
                                    {r.custo_faltando ? "*" : ""}
                                  </>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {semProblema ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span
                                        className={cn(
                                          "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
                                          pctProblema >= 10
                                            ? "border-red-500/40 bg-red-500/10 text-red-600"
                                            : "border-amber-500/40 bg-amber-500/10 text-amber-600",
                                        )}
                                      >
                                        <RotateCcw className="h-3 w-3" />
                                        {formatNumber(r.pedidos_problema)}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[260px] space-y-1 text-xs">
                                      <div className="flex justify-between gap-4 tabular-nums"><span>Pedidos com problema</span><span>{formatNumber(r.pedidos_problema)}</span></div>
                                      <div className="flex justify-between gap-4 tabular-nums"><span>Unidades canceladas</span><span>{formatNumber(r.unidades_canceladas)}</span></div>
                                      <div className="flex justify-between gap-4 tabular-nums"><span>Valor perdido</span><span>{formatBRL(r.valor_perdido)}</span></div>
                                      <div className="flex justify-between gap-4 tabular-nums"><span>% de problema</span><span>{formatPercent(pctProblema)}</span></div>
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    {!isPending && sorted.length > 0 ? <TotalRow rows={sorted} impostoTxt={impostoTxt} /> : null}
                  </TableBody>
                </Table>
                </div>
                {!isPending && sorted.length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      icon={Tags}
                      title={all.length === 0 ? "Nenhuma venda no período" : "Nenhum anúncio para este filtro"}
                      description={
                        all.length === 0
                          ? "Não há vendas sincronizadas no período selecionado para as contas escolhidas."
                          : "Ajuste a busca ou os filtros rápidos."
                      }
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </>
        )}

        <CustoDialog
          row={custoAlvo}
          ownerId={ownerId}
          onClose={() => setCustoAlvo(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["anuncios-margem"] })}
        />

        <AnuncioDetalhe
          row={detalheAlvo}
          ownerId={ownerId}
          accountName={accountName}
          onClose={() => setDetalheAlvo(null)}
          onPreencherCusto={(r) => { setDetalheAlvo(null); setCustoAlvo(r); }}
        />
      </div>
    </TooltipProvider>
  );
}

function parseValor(v: string): number | null {
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  const [erro, setErro] = useState(false);
  const box = "h-10 w-10 shrink-0 flex-shrink-0 overflow-hidden rounded";
  if (!src || erro) {
    return (
      <div className={cn(box, "flex items-center justify-center bg-muted")}>
        <ImageIcon className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }
  const melhor = src.replace(/-I\.(jpg|jpeg|png|webp)(\?.*)?$/i, "-O.$1$2");
  return (
    <div className={cn(box, "bg-muted")}>
      <img
        src={melhor}
        alt={alt}
        loading="lazy"
        onError={(e) => {
          const img = e.currentTarget;
          if (img.src !== src) {
            img.src = src;
            return;
          }
          setErro(true);
        }}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

type CostHistoryRow = {
  id: string;
  valor_unitario: number;
  origem: string;
  data_nota: string | null;
  numero_nota: string | null;
  registrado_em: string;
};

function LinhaPL({ label, value, negativo, sub }: { label: string; value: React.ReactNode; negativo?: boolean; sub?: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-muted-foreground">{negativo ? "− " : "+ "}{label}</span>
        <span className="tabular-nums">{value}</span>
      </div>
      {sub ? <div className="pl-4 text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function AnuncioDetalhe({
  row, ownerId, accountName, onClose, onPreencherCusto,
}: {
  row: AnuncioRow | null;
  ownerId: string | null;
  accountName: (id: string) => string;
  onClose: () => void;
  onPreencherCusto: (row: AnuncioRow) => void;
}) {
  const sku = row?.seller_sku ?? null;
  const isKit = row?.is_kit ?? false;

  const histQuery = useQuery({
    queryKey: ["sku-cost-history", ownerId, sku],
    enabled: !!row && !isKit && !!ownerId && !!sku,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sku_cost_history", { _owner: ownerId!, _sku: sku! });
      if (error) throw error;
      return (data ?? []) as CostHistoryRow[];
    },
  });

  const kitQuery = useQuery({
    queryKey: ["kit-recipe-detalhe", ownerId, sku],
    enabled: !!row && isKit && !!ownerId && !!sku,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("kit_recipe", { _owner: ownerId!, _kit_sku: sku! });
      if (error) throw error;
      return (data ?? []) as KitComponent[];
    },
  });

  const pct = row && row.receita > 0 ? (row.margem / row.receita) * 100 : null;
  const totalPedidos = row ? row.pedidos_ok + row.pedidos_problema : 0;
  const pctProblema = totalPedidos > 0 && row ? (row.pedidos_problema / totalPedidos) * 100 : 0;
  const kitTotal = (kitQuery.data ?? []).reduce((s, c) => s + (Number(c.custo_total) || 0), 0);

  return (
    <Dialog open={row !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 p-0">
        {row ? (
          <>
            <DialogHeader className="border-b border-border/60 p-4">
              <div className="flex items-start gap-3 text-left">
                <Thumb src={row.thumbnail} alt={row.titulo} />
                <div className="min-w-0 flex-1">
                  <DialogTitle className="text-base leading-snug">{row.titulo}</DialogTitle>
                  <DialogDescription asChild>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                      {row.permalink ? (
                        <a href={row.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                          {row.item_id}<ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span>{row.item_id}</span>
                      )}
                      <span>SKU: {row.seller_sku || "—"}</span>
                      <span>{accountName(row.account_id)}</span>
                      <span className="tabular-nums">{formatBRL(row.preco_atual)}</span>
                      {row.is_kit ? <span className="rounded border border-border px-1">Kit</span> : null}
                    </div>
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resultado no período</h3>
                <div className="rounded-md border border-border/60 p-3">
                  <LinhaPL label="Receita" value={formatBRL(row.receita)} />
                  <LinhaPL label="Comissão" value={formatBRL(row.comissao)} negativo />
                  <LinhaPL
                    label="Frete"
                    value={formatBRL(row.frete + row.devolucao)}
                    negativo
                    sub={row.devolucao > 0 ? `inclui devoluções: ${formatBRL(row.devolucao)}` : undefined}
                  />
                  <LinhaPL label="Ads" value={formatBRL(row.ads)} negativo />
                  {row.frete_rateado > 0 ? (
                    <LinhaPL
                      label="Custos do período (rateado)"
                      value={formatBRL(row.frete_rateado)}
                      negativo
                      sub="Armazenamento Full, coleta e assinaturas, rateados por participação na receita"
                    />
                  ) : null}
                  <LinhaPL label="Imposto" value={formatBRL(row.imposto)} negativo />
                  <LinhaPL
                    label="CMV / custo do produto"
                    negativo
                    value={row.custo_faltando ? <span className="text-amber-600">sem custo cadastrado</span> : formatBRL(row.cmv)}
                    sub={!isKit && sku ? (
                      <Link to="/custos" search={{ sku }} className="underline underline-offset-2 hover:text-foreground">
                        editar custo do SKU {sku}
                      </Link>
                    ) : undefined}
                  />
                  <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-border/60 pt-2">
                    <span className="text-sm font-semibold">= Margem</span>
                    <span className={cn("text-base font-semibold tabular-nums", row.margem > 0 ? "text-emerald-600" : row.margem < 0 ? "text-red-600" : "")}>
                      {formatBRL(row.margem)}
                      <span className="ml-2 text-xs font-normal">{pct == null ? "—" : formatPercent(pct)}</span>
                    </span>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vendas e problemas</h3>
                <div className="space-y-1 rounded-md border border-border/60 p-3 text-sm">
                  <div className="flex justify-between tabular-nums"><span className="text-muted-foreground">Unidades vendidas</span><span>{formatNumber(row.unidades)}</span></div>
                  <div className="flex justify-between tabular-nums"><span className="text-muted-foreground">Pedidos OK</span><span>{formatNumber(row.pedidos_ok)}</span></div>
                  {row.pedidos_problema > 0 ? (
                    <>
                      <div className="flex justify-between tabular-nums"><span className="text-muted-foreground">Pedidos com problema</span><span>{formatNumber(row.pedidos_problema)}</span></div>
                      <div className="flex justify-between tabular-nums"><span className="text-muted-foreground">Unidades canceladas</span><span>{formatNumber(row.unidades_canceladas)}</span></div>
                      <div className="flex justify-between tabular-nums"><span className="text-muted-foreground">Valor perdido</span><span>{formatBRL(row.valor_perdido)}</span></div>
                      <div className="flex justify-between tabular-nums"><span className="text-muted-foreground">% de problema</span><span>{formatPercent(pctProblema)}</span></div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">Sem devoluções ou cancelamentos no período.</p>
                  )}
                </div>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custo do produto</h3>
                  {row.custo_faltando ? (
                    <Button size="sm" variant="outline" onClick={() => onPreencherCusto(row)}>
                      <AlertTriangle className="mr-2 h-3.5 w-3.5 text-amber-600" /> Preencher custo
                    </Button>
                  ) : null}
                </div>
                <div className="rounded-md border border-border/60 p-3 text-sm">
                  {isKit ? (
                    kitQuery.isPending ? (
                      <Skeleton className="h-16 w-full" />
                    ) : (kitQuery.data ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">Kit sem componentes cadastrados.</p>
                    ) : (
                      <div className="space-y-1">
                        {(kitQuery.data ?? []).map((c) => {
                          const semCusto = !Number(c.custo_unit);
                          return (
                            <div key={c.component_sku} className={cn("flex items-baseline justify-between gap-3 text-xs tabular-nums", semCusto && "text-amber-600")}>
                              <span className="min-w-0 truncate">{c.component_sku}{c.titulo ? ` · ${c.titulo}` : ""} × {formatNumber(c.quantity)}</span>
                              <span className="shrink-0">
                                {semCusto ? "sem custo" : `${formatBRL(Number(c.custo_unit))} · ${formatBRL(Number(c.custo_total))}`}
                              </span>
                            </div>
                          );
                        })}
                        <div className="flex justify-between border-t border-border/60 pt-1 text-xs font-semibold tabular-nums">
                          <span>Custo do kit</span><span>{formatBRL(kitTotal)}</span>
                        </div>
                      </div>
                    )
                  ) : (
                    <>
                      <div className="flex justify-between text-xs tabular-nums">
                        <span className="text-muted-foreground">Custo unitário atual</span>
                        <span>{row.custo_faltando ? <span className="text-amber-600">sem custo</span> : formatBRL(row.custo_unit)}</span>
                      </div>
                      <div className="mt-2 border-t border-border/60 pt-2">
                        {histQuery.isPending ? (
                          <Skeleton className="h-12 w-full" />
                        ) : (histQuery.data ?? []).length === 0 ? (
                          <p className="text-xs text-muted-foreground">Sem histórico de custo.</p>
                        ) : (
                          <div className="space-y-1">
                            {(histQuery.data ?? []).map((h) => (
                              <div key={h.id} className="flex items-baseline justify-between gap-3 text-xs tabular-nums">
                                <span className="text-muted-foreground">
                                  {formatDate(h.data_nota ?? h.registrado_em)} · {h.origem === "nota" ? "Nota" : h.origem === "manual" ? "Manual" : h.origem}
                                  {h.numero_nota ? ` nº ${h.numero_nota}` : ""}
                                </span>
                                <span>{formatBRL(Number(h.valor_unitario))}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </section>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border/60 p-3">
              {row.permalink ? (
                <Button size="sm" variant="outline" asChild>
                  <a href={row.permalink} target="_blank" rel="noreferrer">
                    Ver no Mercado Livre <ExternalLink className="ml-2 h-3.5 w-3.5" />
                  </a>
                </Button>
              ) : null}
              <Button size="sm" onClick={onClose}>Fechar</Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Preço médio praticado: valor dos produtos (sem frete) ÷ unidades. A receita traz o frete pago pelo comprador
 *  e não serve para isso (apuração ML × finance de 17/11/2026). */
function precoMedio(valorProduto: number | null, unidades: number): string {
  return valorProduto != null && unidades > 0 ? formatBRL(valorProduto / unidades) : "—";
}

function TotalRow({ rows, impostoTxt }: { rows: AnuncioRow[]; impostoTxt: (v: number) => string }) {
  const t = rows.reduce(
    (acc, r) => ({
      unidades: acc.unidades + r.unidades,
      receita: acc.receita + r.receita,
      comissao: acc.comissao + r.comissao,
      frete: acc.frete + r.frete + r.devolucao + r.frete_rateado,
      rateado: acc.rateado + r.frete_rateado,
      ads: acc.ads + r.ads,
      imposto: acc.imposto + r.imposto,
      cmv: acc.cmv + r.cmv,
      margem: acc.margem + r.margem,
      problemas: acc.problemas + r.pedidos_problema,
      produto: acc.produto == null || r.valor_produto == null ? null : acc.produto + r.valor_produto,
    }),
    { unidades: 0, receita: 0, comissao: 0, frete: 0, rateado: 0, ads: 0, imposto: 0, cmv: 0, margem: 0, problemas: 0, produto: 0 as number | null },
  );
  const pct = t.receita > 0 ? (t.margem / t.receita) * 100 : null;
  return (
    <TableRow className="border-t-2 bg-muted/40 font-semibold hover:bg-muted/40">
      <TableCell className="text-muted-foreground">—</TableCell>
      <TableCell>Total</TableCell>
      <TableCell className="text-muted-foreground">—</TableCell>
      <TableCell className="text-right tabular-nums">{formatNumber(t.unidades)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {precoMedio(t.produto, t.unidades)}
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatBRL(t.receita)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatBRL(t.comissao)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {t.rateado > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="underline decoration-dotted underline-offset-2">{formatBRL(t.frete)}</span>
            </TooltipTrigger>
            <TooltipContent>inclui {formatBRL(t.rateado)} de custos do período rateados (Full, coleta e assinaturas)</TooltipContent>
          </Tooltip>
        ) : (
          formatBRL(t.frete)
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatBRL(t.ads)}</TableCell>
      <TableCell className="text-right tabular-nums">{impostoTxt(t.imposto)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatBRL(t.cmv)}</TableCell>
      <TableCell className={cn("text-right tabular-nums", t.margem > 0 ? "text-emerald-600" : t.margem < 0 ? "text-red-600" : "")}>
        {formatBRL(t.margem)}
      </TableCell>
      <TableCell className={cn("text-right tabular-nums", t.margem > 0 ? "text-emerald-600" : t.margem < 0 ? "text-red-600" : "")}>
        {pct == null ? "—" : formatPercent(pct)}
      </TableCell>
      <TableCell className="text-right tabular-nums">{t.problemas > 0 ? formatNumber(t.problemas) : "—"}</TableCell>
    </TableRow>
  );
}

function CustoDialog({
  row, ownerId, onClose, onSaved,
}: {
  row: AnuncioRow | null;
  ownerId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = row !== null;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Preencher custo</DialogTitle>
          <DialogDescription>
            {row?.is_kit
              ? "Este anúncio é um kit. Preencha o custo dos componentes que faltam."
              : "Informe o custo unitário do produto deste SKU."}
          </DialogDescription>
        </DialogHeader>
        {row ? (
          !row.seller_sku ? (
            <p className="text-sm text-muted-foreground">
              Este anúncio não tem SKU cadastrado no Mercado Livre. Cadastre o SKU no anúncio para poder vincular o custo.
            </p>
          ) : row.is_kit ? (
            <KitCustoForm ownerId={ownerId} kitSku={row.seller_sku} onSaved={onSaved} />
          ) : (
            <SkuCustoForm ownerId={ownerId} sku={row.seller_sku} onSaved={() => { onSaved(); onClose(); }} />
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function useSetCusto(ownerId: string | null, onSaved: () => void) {
  return useMutation({
    mutationFn: async ({ sku, valor }: { sku: string; valor: number }) => {
      if (!ownerId) throw new Error("Usuário não identificado.");
      const { data: custoVigente, error } = await supabase.rpc("set_manual_sku_cost", { _owner: ownerId, _sku: sku, _valor: valor });
      if (error) throw error;
      return { custoVigente: custoVigente == null ? null : Number(custoVigente), valor };
    },
    onSuccess: ({ custoVigente, valor }) => {
      if (custoVigente != null && custoVigente !== valor) {
        toast.warning(`Salvo, mas o custo que vale continua ${formatBRL(custoVigente)}, da nota mais recente. Para usar o valor digitado, trave o custo em Produtos / SKUs.`);
      } else toast.success("Custo salvo.");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function SkuCustoForm({ ownerId, sku, onSaved }: { ownerId: string | null; sku: string; onSaved: () => void }) {
  const [valor, setValor] = useState("");
  const mut = useSetCusto(ownerId, onSaved);
  const parsed = parseValor(valor);
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">SKU: <span className="font-medium text-foreground">{sku}</span></div>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <label className="text-xs text-muted-foreground">Custo unitário (R$)</label>
          <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" className="h-8 text-sm tabular-nums" />
        </div>
        <Button
          size="sm"
          disabled={!parsed || !ownerId || mut.isPending}
          onClick={() => parsed && mut.mutate({ sku, valor: parsed })}
        >
          Salvar
        </Button>
      </div>
    </div>
  );
}

function KitCustoForm({ ownerId, kitSku, onSaved }: { ownerId: string | null; kitSku: string; onSaved: () => void }) {
  const qc = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ["kit-recipe", ownerId, kitSku],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data: rows, error: err } = await supabase.rpc("kit_recipe", { _owner: ownerId!, _kit_sku: kitSku });
      if (err) throw err;
      return (rows ?? []).map((r: Record<string, unknown>): KitComponent => ({
        component_sku: String(r.component_sku),
        titulo: (r.titulo as string | null) ?? null,
        quantity: Number(r.quantity) || 0,
        custo_unit: Number(r.custo_unit) || 0,
        custo_total: Number(r.custo_total) || 0,
      }));
    },
  });

  if (isPending) return <Skeleton className="h-24 w-full" />;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  const comps = data ?? [];
  if (comps.length === 0) {
    return <p className="text-sm text-muted-foreground">Este kit não tem componentes cadastrados na receita.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">Kit: <span className="font-medium text-foreground">{kitSku}</span></div>
      {comps.map((c) => (
        <ComponenteLinha
          key={c.component_sku}
          comp={c}
          ownerId={ownerId}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["kit-recipe", ownerId, kitSku] });
            onSaved();
          }}
        />
      ))}
    </div>
  );
}

function ComponenteLinha({ comp, ownerId, onSaved }: { comp: KitComponent; ownerId: string | null; onSaved: () => void }) {
  const [valor, setValor] = useState("");
  const mut = useSetCusto(ownerId, onSaved);
  const parsed = parseValor(valor);
  const semCusto = !comp.custo_unit || comp.custo_unit <= 0;
  return (
    <div className="flex items-center gap-2 rounded border border-border/60 p-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{comp.titulo || comp.component_sku}</p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {comp.component_sku} · {formatNumber(comp.quantity)}x · custo unit. {semCusto ? "—" : formatBRL(comp.custo_unit)}
        </p>
      </div>
      {semCusto ? (
        <div className="flex items-center gap-2">
          <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" className="h-8 w-24 text-sm tabular-nums" />
          <Button
            size="sm"
            disabled={!parsed || !ownerId || mut.isPending}
            onClick={() => parsed && mut.mutate({ sku: comp.component_sku, valor: parsed })}
          >
            Salvar
          </Button>
        </div>
      ) : (
        <span className="text-xs tabular-nums text-emerald-600">{formatBRL(comp.custo_total)}</span>
      )}
    </div>
  );
}
