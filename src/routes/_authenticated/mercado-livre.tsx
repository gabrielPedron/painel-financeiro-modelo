import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { ShoppingCart, DollarSign, Percent, Truck, Megaphone, Undo2, Landmark, Package, Boxes, Wallet, HelpCircle, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Target, AlertOctagon, ArrowDown, ArrowUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { KpiCard } from "@/components/rf/kpi-card";
import { PeriodFilter, type PeriodKey } from "@/components/rf/period-filter";
import { EmptyState } from "@/components/rf/empty-state";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBRL, formatPercent, formatNumber, formatDateTime } from "@/lib/format";
import { CostTrendsBanner } from "@/components/rf/cost-trends-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { DailyChart, type DailyPoint } from "@/components/rf/daily-chart";
import { SyncNowButton } from "@/components/rf/sync-now-button";
import { useVendasSemAliquota } from "@/hooks/use-vendas-sem-aliquota";


export const Route = createFileRoute("/_authenticated/mercado-livre")({
  head: () => ({
    meta: [
      { title: "Mercado Livre — Painel Financeiro" },
      { name: "description", content: "Métricas consolidadas das contas do Mercado Livre." },
    ],
  }),
  component: MercadoLivrePage,
});

type Account = { id: string; nickname: string; trade_name: string | null };

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
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const days = period === "ontem" ? 1 : period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 30;
  const from = new Date(yesterday.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { from: fmtYMD(from), to: fmtYMD(yesterday), days };
}

function previousRange(from: string, to: string, days: number): { from: string; to: string } {
  const toDate = new Date(`${from}T00:00:00-03:00`);
  const prevTo = new Date(toDate.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
  return { from: fmtYMD(prevFrom), to: fmtYMD(prevTo) };
}

type Bucket = {
  revenue: number; revenueGross: number; revenueLost: number;
  cancelledValue: number; partialRefunds: number;
  commissions: number; shipping: number; fulfillment: number; ads: number;
  bonifications: number; refunds: number; installment: number; other: number; tax: number; net: number;
  ordersCount: number; ordersCancelled: number; ordersRefunded: number; unitsSold: number; visits: number;
};
const emptyBucket = (): Bucket => ({
  revenue: 0, revenueGross: 0, revenueLost: 0,
  cancelledValue: 0, partialRefunds: 0,
  commissions: 0, shipping: 0, fulfillment: 0, ads: 0,
  bonifications: 0, refunds: 0, installment: 0, other: 0, tax: 0, net: 0,
  ordersCount: 0, ordersCancelled: 0, ordersRefunded: 0, unitsSold: 0, visits: 0,
});

type MetricsRow = {
  account_id: string;
  revenue: number | string;
  revenue_gross?: number | string;
  revenue_lost?: number | string;
  cancelled_value?: number | string;
  partial_refunds?: number | string;
  commissions: number | string;
  shipping: number | string;
  fulfillment: number | string;
  installment: number | string;
  bonifications: number | string;
  other: number | string;
  ads: number | string;
  refunds: number | string;
  tax: number | string;
  orders_count?: number | string;
  orders_cancelled?: number | string;
  orders_refunded?: number | string;
  units_sold?: number | string;
  visits?: number | string;
};

type FullBreakdownRow = { sub_type: string; label: string; amount: number | string };
type CommissionBreakdownRow = { label: string; amount: number | string };
type DataHealthRow = {
  orders_count: number | string;
  billing_count: number | string;
  ads_days_present: number | string;
  visits_days_present?: number | string;
  period_days: number;
  missing_ads_days: string[] | null;
  missing_visits_days?: string[] | null;
  last_sync_at: string | null;
};

function pctVar(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function pctOf(part: number, total: number): string {
  if (!total) return "—";
  return `${formatPercent((part / total) * 100)} da receita`;
}

function labelWithInfo(text: string, tip: ReactNode) {
  return (
    <span className="inline-flex items-center gap-1">
      {text}
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Sobre ${text}`}>
            <HelpCircle className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-snug">{tip}</TooltipContent>
      </Tooltip>
    </span>
  );
}

function MercadoLivrePage() {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [customRange, setCustomRange] = useState<{ from?: Date; to?: Date }>({});
  const [account, setAccount] = useState("all");
  const queryClient = useQueryClient();

  const { data: accounts } = useQuery({
    queryKey: ["accounts-ml"],
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

  const { from, to, days } = useMemo(() => periodRange(period, customRange), [period, customRange]);
  const prev = useMemo(() => previousRange(from, to, days), [from, to, days]);
  const accountIds = useMemo(
    () => (account === "all" ? (accounts ?? []).map((a) => a.id) : [account]),
    [account, accounts],
  );
  const { data: semAliquota } = useVendasSemAliquota(accountIds, from, to, hasAccounts && accountIds.length > 0);

  const { data: availableDates } = useQuery({
    queryKey: ["ml-available-dates", accountIds.join(",")],
    enabled: hasAccounts && accountIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ml_available_dates", {
        _account_ids: accountIds,
      });
      if (error) throw error;
      const set = new Set<string>();
      for (const r of data ?? []) {
        if (!r.dia) continue;
        set.add(r.dia);
      }
      return set;
    },
  });

  const fetchMetrics = async (fromD: string, toD: string): Promise<MetricsRow[] | null> => {
    if (accountIds.length === 0) return null;
    const { data, error } = await supabase.rpc("ml_metrics", {
      _account_ids: accountIds,
      _from: fromD,
      _to: toD,
    });
    if (error) throw error;
    return (data ?? []) as MetricsRow[];
  };

  const { data: metrics, isPending: metricsPending, error: metricsError } = useQuery({
    queryKey: ["ml-metrics", from, to, accountIds.join(",")],
    enabled: hasAccounts && accountIds.length > 0,
    queryFn: () => fetchMetrics(from, to),
  });

  const { data: prevMetrics, isPending: prevMetricsPending, error: prevMetricsError } = useQuery({
    queryKey: ["ml-metrics-prev", prev.from, prev.to, accountIds.join(",")],
    enabled: hasAccounts && accountIds.length > 0,
    queryFn: () => fetchMetrics(prev.from, prev.to),
  });

  const isLoadingMetrics = hasAccounts && accountIds.length > 0 && (metricsPending || prevMetricsPending);

  const fetchCmv = async (fromD: string, toD: string): Promise<number> => {
    if (accountIds.length === 0) return 0;
    const { data, error } = await supabase.rpc("ml_cmv", {
      _account_ids: accountIds,
      _from: fromD,
      _to: toD,
    });
    if (error) throw error;
    return (data ?? []).reduce((s, r) => s + (Number(r.cmv) || 0), 0);
  };

  const { data: cmvTotal = 0, isPending: cmvPending, error: cmvError } = useQuery({
    queryKey: ["ml-cmv", from, to, accountIds.join(",")],
    enabled: hasAccounts && accountIds.length > 0,
    queryFn: () => fetchCmv(from, to),
  });

  const { data: cmvPrevTotal = 0, isPending: cmvPrevPending, error: cmvPrevError } = useQuery({
    queryKey: ["ml-cmv-prev", prev.from, prev.to, accountIds.join(",")],
    enabled: hasAccounts && accountIds.length > 0,
    queryFn: () => fetchCmv(prev.from, prev.to),
  });

  const isLoadingCmv = hasAccounts && accountIds.length > 0 && (isLoadingMetrics || cmvPending || cmvPrevPending);

  const { data: fullBreakdown, error: fullBreakdownError } = useQuery({
    queryKey: ["ml-full-breakdown", from, to, accountIds.join(",")],
    enabled: hasAccounts && accountIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ml_fulfillment_breakdown", {
        _account_ids: accountIds,
        _from: from,
        _to: to,
      });
      if (error) throw error;
      return (data ?? []) as FullBreakdownRow[];
    },
  });

  const { data: commissionBreakdown, error: commissionBreakdownError } = useQuery({
    queryKey: ["ml-commission-breakdown", from, to, accountIds.join(",")],
    enabled: hasAccounts && accountIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ml_commission_breakdown", {
        _account_ids: accountIds,
        _from: from,
        _to: to,
      });
      if (error) throw error;
      return (data ?? []) as CommissionBreakdownRow[];
    },
  });

  const { data: dailySeries, isPending: dailyPending } = useQuery({
    queryKey: ["ml-daily-series", from, to, accountIds.join(",")],
    enabled: hasAccounts && accountIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ml_daily_series", {
        _account_ids: accountIds,
        _from: from,
        _to: to,
      });
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => ({
        day: String(r.day),
        revenue: Number(r.revenue ?? 0),
        commissions: Number(r.commissions ?? 0) + Number(r.installment ?? 0),
        installment: 0,
        shipping: Number(r.shipping ?? 0),
        fulfillment: Number(r.fulfillment ?? 0),
        ads: Number(r.ads ?? 0),
        tax: Number(r.tax ?? 0),
        costs_total: Number(r.costs_total ?? 0),
        net: Number(r.net ?? 0),
      })) as DailyPoint[];
    },
  });

  const { data: dataHealth, error: dataHealthError } = useQuery({
    queryKey: ["ml-data-health", from, to, accountIds.join(",")],
    enabled: hasAccounts && accountIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ml_data_health", {
        _account_ids: accountIds,
        _from: from,
        _to: to,
      });
      if (error) throw error;
      const rows = (data ?? []) as DataHealthRow[];
      return rows[0] ?? null;
    },
  });

  const buildBuckets = (rows: MetricsRow[] | null | undefined): Map<string, Bucket> => {
    const map = new Map<string, Bucket>();
    (accounts ?? []).forEach((a) => map.set(a.id, emptyBucket()));
    if (!rows) return map;
    for (const r of rows) {
      const b = emptyBucket();
      b.revenue = Number(r.revenue) || 0;
      b.revenueGross = Number(r.revenue_gross) || 0;
      b.revenueLost = Number(r.revenue_lost) || 0;
      b.cancelledValue = Number(r.cancelled_value) || 0;
      b.partialRefunds = Number(r.partial_refunds) || 0;
      b.commissions = Number(r.commissions) || 0;
      b.shipping = Number(r.shipping) || 0;
      b.fulfillment = Number(r.fulfillment) || 0;
      b.installment = Number(r.installment) || 0;
      b.bonifications = Number(r.bonifications) || 0;
      b.other = Number(r.other) || 0;
      b.ads = Number(r.ads) || 0;
      b.refunds = Number(r.refunds) || 0;
      b.tax = Number(r.tax) || 0;
      b.ordersCount = Number(r.orders_count) || 0;
      b.ordersCancelled = Number(r.orders_cancelled) || 0;
      b.ordersRefunded = Number(r.orders_refunded) || 0;
      b.unitsSold = Number(r.units_sold) || 0;
      b.visits = Number(r.visits) || 0;
      b.net = b.revenue - b.commissions - b.shipping - b.fulfillment - b.installment - b.ads - b.tax - b.other + b.bonifications;
      map.set(r.account_id, b);
    }
    return map;
  };

  const perAccount = useMemo(() => buildBuckets(metrics), [accounts, metrics]);
  const perAccountPrev = useMemo(() => buildBuckets(prevMetrics), [accounts, prevMetrics]);

  const sumTotals = (map: Map<string, Bucket>): Bucket => {
    const acc = emptyBucket();
    for (const [, v] of map) {
      acc.revenue += v.revenue; acc.revenueGross += v.revenueGross; acc.revenueLost += v.revenueLost;
      acc.cancelledValue += v.cancelledValue; acc.partialRefunds += v.partialRefunds;
      acc.commissions += v.commissions; acc.shipping += v.shipping;
      acc.fulfillment += v.fulfillment; acc.ads += v.ads; acc.bonifications += v.bonifications;
      acc.refunds += v.refunds; acc.installment += v.installment; acc.other += v.other;
      acc.tax += v.tax; acc.net += v.net;
      acc.ordersCount += v.ordersCount; acc.ordersCancelled += v.ordersCancelled;
      acc.ordersRefunded += v.ordersRefunded;
      acc.unitsSold += v.unitsSold; acc.visits += v.visits;
    }
    return acc;
  };
  const totals = useMemo(() => sumTotals(perAccount), [perAccount]);
  const totalsPrev = useMemo(() => sumTotals(perAccountPrev), [perAccountPrev]);

  const hasSynced = totals.revenueGross + totals.revenue + totals.commissions + totals.ads + totals.shipping + totals.fulfillment + totals.bonifications + totals.other > 0;
  const conversion = totals.visits > 0 ? (totals.ordersCount / totals.visits) * 100 : null;
  const prevConversion = totalsPrev.visits > 0 ? (totalsPrev.ordersCount / totalsPrev.visits) * 100 : null;
  const avgPerOrder = totals.ordersCount > 0 ? totals.unitsSold / totals.ordersCount : 0;

  const mc = totals.revenue - totals.commissions - totals.shipping - totals.fulfillment - totals.installment - totals.ads - totals.tax - totals.other + totals.bonifications - cmvTotal;
  const mcPrev = totalsPrev.revenue - totalsPrev.commissions - totalsPrev.shipping - totalsPrev.fulfillment - totalsPrev.installment - totalsPrev.ads - totalsPrev.tax - totalsPrev.other + totalsPrev.bonifications - cmvPrevTotal;
  const mcPct = totals.revenue > 0 ? (mc / totals.revenue) * 100 : null;
  const mcPctPrev = totalsPrev.revenue > 0 ? (mcPrev / totalsPrev.revenue) * 100 : null;

  const cancelledValue = totals.cancelledValue;
  const partialRefunds = totals.partialRefunds;
  const revenueTooltip = (
    <div className="space-y-1 min-w-[260px]">
      <div className="flex justify-between gap-3 text-xs tabular-nums">
        <span>Receita bruta</span><span>{formatBRL(totals.revenueGross)}</span>
      </div>
      <p className="text-[10px] text-primary-foreground/70 -mt-0.5">Equivale a “Vendas brutas” no painel do ML.</p>
      <div className="flex justify-between gap-3 text-xs tabular-nums text-red-200">
        <span>Vendas canceladas ({formatNumber(totals.ordersCancelled)} pedidos)</span>
        <span>−{formatBRL(cancelledValue)}</span>
      </div>
      <div className="flex justify-between gap-3 text-xs tabular-nums text-red-200">
        <span>Reembolsos parciais ({formatNumber(totals.ordersRefunded)} pedidos)</span>
        <span>−{formatBRL(partialRefunds)}</span>
      </div>
      <div className="mt-1 flex justify-between gap-3 border-t border-white/25 pt-1 text-xs font-medium tabular-nums">
        <span>Receita líquida</span><span>{formatBRL(totals.revenue)}</span>
      </div>
    </div>
  );

  const unitsTooltip = (
    <div className="space-y-1 min-w-[200px]">
      <div className="flex justify-between gap-3 text-xs tabular-nums">
        <span>Unidades vendidas</span><span>{formatNumber(totals.unitsSold)}</span>
      </div>
      <div className="flex justify-between gap-3 text-xs tabular-nums">
        <span>Pedidos</span><span>{formatNumber(totals.ordersCount)}</span>
      </div>
      <div className="flex justify-between gap-3 text-xs tabular-nums">
        <span>Média por pedido</span>
        <span>{avgPerOrder.toFixed(1).replace(".", ",")}</span>
      </div>
      <div className="flex justify-between gap-3 text-xs tabular-nums">
        <span>Pedidos cancelados</span><span>{formatNumber(totals.ordersCancelled)}</span>
      </div>
    </div>
  );

  const fullBreakdownItems = (fullBreakdown ?? []).map((r) => ({
    ...r,
    amountNum: Number(r.amount) || 0,
  }));
  const fullBreakdownTotal = fullBreakdownItems.reduce((s, r) => s + r.amountNum, 0);
  const fullTooltip = fullBreakdownItems.length > 0 ? (
    <div className="space-y-1 min-w-[200px]">
      <p className="text-xs">Custos do Fulfillment no período:</p>
      {fullBreakdownItems.map((r) => (
        <div key={r.sub_type} className="flex justify-between gap-3 text-xs tabular-nums">
          <span>{r.label}</span>
          <span>{formatBRL(r.amountNum)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-3 border-t border-white/25 pt-1 text-xs font-medium tabular-nums">
        <span>Total</span>
        <span>{formatBRL(fullBreakdownTotal)}</span>
      </div>
    </div>
  ) : (
    "Custos do Fulfillment: armazenagem, coleta, retirada de estoque, estoque antigo e inconformidades."
  );

  const commissionBreakdownItems = (commissionBreakdown ?? []).map((r) => ({
    ...r,
    label: r.label === "Taxa de parcelamento" ? "% premium" : r.label,
    amountNum: Number(r.amount) || 0,
  }));
  const commissionBreakdownTotal = commissionBreakdownItems.reduce((s, r) => s + r.amountNum, 0);
  const commissionTooltip = commissionBreakdownItems.length > 0 ? (
    <div className="space-y-1 min-w-[220px]">
      <p className="text-xs">Comissões no período:</p>
      {commissionBreakdownItems.map((r) => (
        <div key={r.label} className="flex justify-between gap-3 text-xs tabular-nums">
          <span>{r.label}</span>
          <span>{formatBRL(r.amountNum)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-3 border-t border-white/25 pt-1 text-xs font-medium tabular-nums">
        <span>Total</span>
        <span>{formatBRL(commissionBreakdownTotal)}</span>
      </div>
    </div>
  ) : (
    "Tarifa de venda cobrada em cada pedido, mais % premium (parcelamento) e taxa de recebimento."
  );

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-primary">Mercado Livre</h1>
          <p className="text-sm text-muted-foreground">Métricas por marketplace e comparação entre contas.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-col items-end gap-1">
            <PeriodFilter
              value={period}
              onChange={setPeriod}
              customRange={customRange}
              onCustomRangeChange={setCustomRange}
              availableDates={availableDates}
            />
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {from.split("-").reverse().join("/")} a {to.split("-").reverse().join("/")} · {days} {days === 1 ? "dia" : "dias"}
            </p>
          </div>
          <Select value={account} onValueChange={setAccount}>
            <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue placeholder="Conta" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as contas</SelectItem>
              {accounts?.map((a) => (
                <SelectItem key={a.id} value={a.id}>{displayName(a)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <SyncNowButton
        days={60}
        onFinished={() => {
          queryClient.invalidateQueries();
        }}
      />


      {!hasAccounts ? (
        <EmptyState
          icon={ShoppingCart}
          title="Nenhuma conta do Mercado Livre conectada."
          description="Conecte uma conta para visualizar as métricas por marketplace."
          action={
            <Button asChild size="sm">
              <Link to="/configuracoes" search={{ aba: "integracoes" }}>Ir para Integrações</Link>
            </Button>
          }
        />
      ) : metricsError || prevMetricsError || cmvError || cmvPrevError || fullBreakdownError || commissionBreakdownError || dataHealthError ? (
        <MetricsErrorPanel
          errors={[
            metricsError ? { label: "ml_metrics (período atual)", error: metricsError as Error } : null,
            prevMetricsError ? { label: "ml_metrics (período anterior)", error: prevMetricsError as Error } : null,
            cmvError ? { label: "ml_cmv (período atual)", error: cmvError as Error } : null,
            cmvPrevError ? { label: "ml_cmv (período anterior)", error: cmvPrevError as Error } : null,
            fullBreakdownError ? { label: "ml_fulfillment_breakdown", error: fullBreakdownError as Error } : null,
            commissionBreakdownError ? { label: "ml_commission_breakdown", error: commissionBreakdownError as Error } : null,
            dataHealthError ? { label: "ml_data_health", error: dataHealthError as Error } : null,
          ].filter((e): e is { label: string; error: Error } => e !== null)}
          onRetry={() => {
            queryClient.invalidateQueries({ queryKey: ["ml-metrics"] });
            queryClient.invalidateQueries({ queryKey: ["ml-metrics-prev"] });
            queryClient.invalidateQueries({ queryKey: ["ml-cmv"] });
            queryClient.invalidateQueries({ queryKey: ["ml-cmv-prev"] });
            queryClient.invalidateQueries({ queryKey: ["ml-full-breakdown"] });
            queryClient.invalidateQueries({ queryKey: ["ml-commission-breakdown"] });
            queryClient.invalidateQueries({ queryKey: ["ml-data-health"] });
          }}
        />
      ) : !isLoadingMetrics && !hasSynced ? (
        <EmptyState
          icon={ShoppingCart}
          title="Sem dados sincronizados no período"
          description="Rode a primeira sincronização em Configurações → Integrações → Sincronizar agora (últimos 90 dias)."
          action={
            <Button asChild size="sm">
              <Link to="/configuracoes" search={{ aba: "integracoes" }}>Ir para Integrações</Link>
            </Button>
          }
        />
      ) : (
        <>
          <TooltipProvider delayDuration={150}>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                loading={isLoadingMetrics}
                label={labelWithInfo("Receita", revenueTooltip)}
                value={totals.revenueGross}
                variation={pctVar(totals.revenueGross, totalsPrev.revenueGross)}
                icon={DollarSign}
                higherIsBetter
                subtitle={`Líquido ${formatBRL(totals.revenue)} · ${formatBRL(totals.revenueLost)} em perdas`}
              />
              <KpiCard
                loading={isLoadingMetrics}
                label={labelWithInfo("Unidades vendidas", unitsTooltip)}
                value={totals.unitsSold}
                variation={pctVar(totals.unitsSold, totalsPrev.unitsSold)}
                icon={ShoppingCart}
                higherIsBetter
                currency={false}
                subtitle={`${formatNumber(totals.ordersCount)} pedidos${totals.ordersCancelled > 0 ? ` · ${formatNumber(totals.ordersCancelled)} cancelados` : ""}`}
              />
              <KpiCard
                loading={isLoadingMetrics}
                label={labelWithInfo("Conversão", "Percentual de visitas que resultaram em venda. Visitas obtidas da API do Mercado Livre.")}
                value={conversion ?? 0}
                variation={conversion != null && prevConversion != null ? pctVar(conversion, prevConversion) : null}
                icon={Target}
                higherIsBetter
                formatValue={() => conversion == null ? "—" : formatPercent(conversion, 2)}
                subtitle={totals.visits > 0 ? `${formatNumber(totals.visits)} visitas` : undefined}
                footer={conversion == null ? "Sincronize para obter as visitas" : null}
              />
              <KpiCard loading={isLoadingMetrics} label={labelWithInfo("Comissões", commissionTooltip)} value={totals.commissions + totals.installment} variation={pctVar(totals.commissions + totals.installment, totalsPrev.commissions + totalsPrev.installment)} icon={Percent} higherIsBetter={false} subtitle={pctOf(totals.commissions + totals.installment, totals.revenue)} />
              <KpiCard loading={isLoadingMetrics} label={labelWithInfo("Fretes", "Tarifas de envio, envio intermunicipal e devoluções cobradas na fatura.")} value={totals.shipping} variation={pctVar(totals.shipping, totalsPrev.shipping)} icon={Truck} higherIsBetter={false} subtitle={pctOf(totals.shipping, totals.revenue)} />
              <KpiCard loading={isLoadingMetrics} label={labelWithInfo("Full", fullTooltip)} value={totals.fulfillment} variation={pctVar(totals.fulfillment, totalsPrev.fulfillment)} icon={Package} higherIsBetter={false} subtitle={pctOf(totals.fulfillment, totals.revenue)} />
              <KpiCard loading={isLoadingMetrics} label={labelWithInfo("Product Ads", "Investimento em publicidade, obtido diretamente da API de Ads do Mercado Livre.")} value={totals.ads} variation={pctVar(totals.ads, totalsPrev.ads)} icon={Megaphone} higherIsBetter={false} subtitle={pctOf(totals.ads, totals.revenue)} />
              <KpiCard loading={isLoadingMetrics} label={labelWithInfo("Estornos", "Valores que o Mercado Livre devolveu por vendas canceladas — comissões, fretes e taxas estornadas. Um valor alto indica muitos cancelamentos; a queda é um bom sinal.")} value={totals.bonifications} variation={pctVar(totals.bonifications, totalsPrev.bonifications)} icon={Undo2} higherIsBetter={false} subtitle={pctOf(totals.bonifications, totals.revenue)} />
              <KpiCard
                loading={isLoadingMetrics}
                label={labelWithInfo("Imposto (Simples)", "Receita bruta multiplicada pela alíquota vigente cadastrada para a empresa.")}
                value={totals.tax}
                variation={semAliquota?.todas ? undefined : pctVar(totals.tax, totalsPrev.tax)}
                icon={Landmark}
                higherIsBetter={false}
                subtitle={semAliquota?.todas ? undefined : pctOf(totals.tax, totals.revenue)}
                formatValue={semAliquota?.todas ? () => "—" : undefined}
                footer={semAliquota && semAliquota.sem > 0 ? (
                  <>{semAliquota.sem} de {semAliquota.vendas} vendas sem alíquota. <Link to="/configuracoes" search={{ aba: "empresas" }} className="text-primary underline">Cadastrar</Link></>
                ) : null}
              />
              <KpiCard loading={isLoadingCmv} label={labelWithInfo("CMV", "Custo das mercadorias vendidas (custo dos produtos vendidos no período). Considera apenas SKUs com custo cadastrado.")} value={cmvTotal} variation={pctVar(cmvTotal, cmvPrevTotal)} icon={Boxes} higherIsBetter={false} subtitle={pctOf(cmvTotal, totals.revenue)} />
              <KpiCard loading={isLoadingCmv} label={labelWithInfo("MC (R$)", "Margem de contribuição = receita líquida − comissões − frete − Full − parcelamento − Ads − imposto − CMV.")} value={mc} variation={pctVar(mc, mcPrev)} icon={Wallet} higherIsBetter subtitle={pctOf(mc, totals.revenue)} />
              <KpiCard
                loading={isLoadingCmv}
                label={labelWithInfo("MC%", "MC ÷ receita líquida.")}
                value={mcPct ?? 0}
                variation={mcPct != null && mcPctPrev != null ? pctVar(mcPct, mcPctPrev) : null}
                icon={Percent}
                higherIsBetter
                formatValue={() => (mcPct == null ? "—" : formatPercent(mcPct, 1))}
              />
            </section>
            {totals.other > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Outras taxas não classificadas: <span className="tabular-nums font-medium">{formatBRL(totals.other)}</span>
              </p>
            ) : null}
          </TooltipProvider>

          <DailyChart data={dailySeries ?? []} loading={hasAccounts && accountIds.length > 0 && dailyPending} />
          <CostTrendsBanner accountIds={accountIds} />

          <Card className="border-border/60 bg-card/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Comparativo entre contas</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <AccountsComparisonTable
                accounts={(accounts ?? []).filter((a) => account === "all" || a.id === account)}
                perAccount={perAccount}
                loading={isLoadingMetrics}
                totals={totals}
                highlightOutliers={account === "all" && (accounts ?? []).filter((a) => account === "all" || a.id === account).length > 1}
                displayName={displayName}
              />
            </CardContent>
          </Card>
        </>
      )}

      {hasAccounts && dataHealth ? <DataHealthSection health={dataHealth} /> : null}
    </div>
  );
}

function DataHealthSection({ health }: { health: DataHealthRow }) {
  const [open, setOpen] = useState(false);
  const orders = Number(health.orders_count) || 0;
  const billing = Number(health.billing_count) || 0;
  const adsDays = Number(health.ads_days_present) || 0;
  const periodDays = Number(health.period_days) || 0;
  const missing = (health.missing_ads_days ?? []) as string[];
  const missingVisits = (health.missing_visits_days ?? []) as string[];
  const visitsDays = Number(health.visits_days_present) || 0;
  const complete = missing.length === 0 && missingVisits.length === 0 && periodDays > 0;
  return (
    <Card className="border-border/60 bg-card/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/40"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Conferência de dados
        {complete ? (
          <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Período completo
          </span>
        ) : missing.length > 0 ? (
          <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" /> {missing.length} dia(s) de Ads faltando
          </span>
        ) : missingVisits.length > 0 ? (
          <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" /> {missingVisits.length} dia(s) de visitas faltando
          </span>
        ) : null}
      </button>
      {open ? (
        <CardContent className="pt-0 pb-4 text-sm text-muted-foreground space-y-2">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <div className="text-[11px] uppercase tracking-wider">Pedidos sincronizados</div>
              <div className="text-base font-semibold text-foreground tabular-nums">{orders.toLocaleString("pt-BR")}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider">Lançamentos de faturamento</div>
              <div className="text-base font-semibold text-foreground tabular-nums">{billing.toLocaleString("pt-BR")}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider">Dias com Ads</div>
              <div className="text-base font-semibold text-foreground tabular-nums">{adsDays} / {periodDays}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider">Dias com visitas</div>
              <div className="text-base font-semibold text-foreground tabular-nums">{visitsDays} / {periodDays}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider">Última sincronização</div>
              <div className="text-base font-semibold text-foreground">{formatDateTime(health.last_sync_at)}</div>
            </div>
          </div>
          {missing.length > 0 ? (
            <div className="pt-1">
              <div className="text-[11px] uppercase tracking-wider text-amber-600">Dias de Ads faltando no período</div>
              <div className="mt-1 flex flex-wrap gap-1 text-xs text-foreground tabular-nums">
                {missing.map((d) => (
                  <span key={d} className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5">
                    {d.split("-").reverse().join("/")}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs">
                Rode “Reprocessar Ads” em Configurações → Integrações para reenfileirar os dias faltantes.
              </p>
            </div>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

function MetricsErrorPanel({ errors, onRetry }: { errors: Array<{ label: string; error: Error }>; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
      <div className="mb-2 flex items-center gap-2 font-medium">
        <AlertOctagon className="h-4 w-4" />
        Erro ao carregar métricas do período
      </div>
      <p className="mb-3 text-xs text-red-800/90">
        As consultas ao banco falharam. As métricas não podem ser exibidas até que o problema seja corrigido.
      </p>
      <ul className="space-y-2">
        {errors.map((e, i) => (
          <li key={i} className="rounded bg-card/70 p-2">
            <div className="text-xs font-semibold">{e.label}</div>
            <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-snug">{e.error.message}</pre>
          </li>
        ))}
      </ul>
      {onRetry ? (
        <div className="mt-3">
          <Button size="sm" variant="outline" onClick={onRetry}>Tentar novamente</Button>
        </div>
      ) : null}
    </div>
  );
}

type SortKey = "name" | "revenue" | "revenueLost" | "unitsSold" | "conversion" | "commissions" | "shipping" | "fulfillment" | "ads" | "tax" | "bonifications" | "net";

function AccountsComparisonTable({
  accounts,
  perAccount,
  loading,
  totals,
  highlightOutliers,
  displayName,
}: {
  accounts: Account[];
  perAccount: Map<string, Bucket>;
  loading: boolean;
  totals: Bucket;
  highlightOutliers: boolean;
  displayName: (a: Account) => string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => accounts.map((a) => {
    const v = perAccount.get(a.id) ?? emptyBucket();
    const conv = v.visits > 0 ? (v.ordersCount / v.visits) * 100 : null;
    return { a, v, conv };
  }), [accounts, perAccount]);

  // Averages of pct-of-revenue across accounts (only those with revenue > 0)
  const avgPct = useMemo(() => {
    const keys: Array<keyof Bucket> = ["commissions", "shipping", "fulfillment", "ads", "tax"];
    const acc: Record<string, { sum: number; n: number }> = {};
    keys.forEach((k) => (acc[k as string] = { sum: 0, n: 0 }));
    for (const { v } of rows) {
      if (v.revenue <= 0) continue;
      for (const k of keys) {
        const raw = (v[k] as number) + (k === "commissions" ? v.installment : 0);
        acc[k as string].sum += (raw / v.revenue) * 100;
        acc[k as string].n += 1;
      }
    }
    const out: Record<string, number | null> = {};
    for (const k of keys) {
      const a = acc[k as string];
      out[k as string] = a.n > 0 ? a.sum / a.n : null;
    }
    return out;
  }, [rows]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const get = (r: { a: Account; v: Bucket; conv: number | null }): number | string => {
      switch (sortKey) {
        case "name": return displayName(r.a).toLowerCase();
        case "conversion": return r.conv ?? -Infinity;
        case "commissions": return r.v.commissions + r.v.installment;
        default: return r.v[sortKey as keyof Bucket] as number;
      }
    };
    return [...rows].sort((x, y) => {
      const a = get(x); const b = get(y);
      if (typeof a === "string" && typeof b === "string") return a.localeCompare(b) * dir;
      return ((a as number) - (b as number)) * dir;
    });
  }, [rows, sortKey, sortDir, displayName]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "name" ? "asc" : "desc"); }
  };

  const SortHead = ({ k, children, align = "right" }: { k: SortKey; children: React.ReactNode; align?: "right" | "left" }) => {
    const active = sortKey === k;
    return (
      <TableHead className={align === "right" ? "text-right" : ""}>
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""} ${align === "right" ? "justify-end w-full" : ""}`}
        >
          {children}
          {active ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
        </button>
      </TableHead>
    );
  };

  const conv = totals.visits > 0 ? (totals.ordersCount / totals.visits) * 100 : null;

  return (
    <TooltipProvider delayDuration={150}>
      <Table>
        <TableHeader>
          <TableRow className="text-[11px] uppercase tracking-wider text-muted-foreground">
            <SortHead k="name" align="left">Conta</SortHead>
            <SortHead k="revenue">Receita</SortHead>
            <SortHead k="revenueLost">Perdas</SortHead>
            <SortHead k="unitsSold">Vendas</SortHead>
            <SortHead k="conversion">Conversão</SortHead>
            <SortHead k="commissions">Comissões</SortHead>
            <SortHead k="shipping">Fretes</SortHead>
            <SortHead k="fulfillment">Full</SortHead>
            <SortHead k="ads">Ads</SortHead>
            <SortHead k="tax">Imposto</SortHead>
            <SortHead k="bonifications">Estornos</SortHead>
            <SortHead k="net">Líquido</SortHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map(({ a, v, conv: cv }) => (
            <TableRow key={a.id} className="text-sm align-top">
              <TableCell className="font-medium">{displayName(a)}</TableCell>
              {loading ? (
                Array.from({ length: 11 }).map((_, i) => (
                  <TableCell key={i} className="text-right"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                ))
              ) : (
                <>
                  <TableCell className="text-right tabular-nums">{formatBRL(v.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums text-red-700">{v.revenueLost > 0 ? `−${formatBRL(v.revenueLost)}` : formatBRL(0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(v.unitsSold)}</TableCell>
                  <TableCell className="text-right tabular-nums">{cv == null ? "—" : formatPercent(cv, 2)}</TableCell>
                  <CostCell value={v.commissions + v.installment} revenue={v.revenue} avg={highlightOutliers ? avgPct.commissions : null} />
                  <CostCell value={v.shipping} revenue={v.revenue} avg={highlightOutliers ? avgPct.shipping : null} />
                  <CostCell value={v.fulfillment} revenue={v.revenue} avg={highlightOutliers ? avgPct.fulfillment : null} />
                  <CostCell value={v.ads} revenue={v.revenue} avg={highlightOutliers ? avgPct.ads : null} />
                  <CostCell value={v.tax} revenue={v.revenue} avg={highlightOutliers ? avgPct.tax : null} />
                  <TableCell className="text-right tabular-nums">{formatBRL(v.bonifications)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatBRL(v.net)}</TableCell>
                </>
              )}
            </TableRow>
          ))}
          {!loading && sorted.length > 1 ? (
            <TableRow className="bg-muted/40 border-t-2 border-border/70 text-sm font-semibold align-top">
              <TableCell>Total</TableCell>
              <TableCell className="text-right tabular-nums">{formatBRL(totals.revenue)}</TableCell>
              <TableCell className="text-right tabular-nums text-red-700">{totals.revenueLost > 0 ? `−${formatBRL(totals.revenueLost)}` : formatBRL(0)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(totals.unitsSold)}</TableCell>
              <TableCell className="text-right tabular-nums">{conv == null ? "—" : formatPercent(conv, 2)}</TableCell>
              <TotalCostCell value={totals.commissions + totals.installment} revenue={totals.revenue} />
              <TotalCostCell value={totals.shipping} revenue={totals.revenue} />
              <TotalCostCell value={totals.fulfillment} revenue={totals.revenue} />
              <TotalCostCell value={totals.ads} revenue={totals.revenue} />
              <TotalCostCell value={totals.tax} revenue={totals.revenue} />
              <TableCell className="text-right tabular-nums">{formatBRL(totals.bonifications)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatBRL(totals.net)}</TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}

function CostCell({ value, revenue, avg }: { value: number; revenue: number; avg: number | null }) {
  const pct = revenue > 0 ? (value / revenue) * 100 : null;
  const outlier = pct != null && avg != null && avg > 0 && pct > avg * 1.2;
  return (
    <TableCell className="text-right tabular-nums">
      <div>{formatBRL(value)}</div>
      {pct != null ? (
        <div className={`mt-0.5 inline-flex items-center gap-1 text-[11px] ${outlier ? "text-red-700 font-medium" : "text-muted-foreground"}`}>
          {outlier ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex"><AlertTriangle className="h-3 w-3" /></span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Acima da média das contas ({formatPercent(avg!)}).
              </TooltipContent>
            </Tooltip>
          ) : null}
          {formatPercent(pct)}
        </div>
      ) : null}
    </TableCell>
  );
}

function TotalCostCell({ value, revenue }: { value: number; revenue: number }) {
  const pct = revenue > 0 ? (value / revenue) * 100 : null;
  return (
    <TableCell className="text-right tabular-nums">
      <div>{formatBRL(value)}</div>
      {pct != null ? <div className="mt-0.5 text-[11px] font-normal text-muted-foreground">{formatPercent(pct)}</div> : null}
    </TableCell>
  );
}