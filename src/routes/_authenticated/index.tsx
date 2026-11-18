import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TrendingUp, TrendingDown, ArrowDownRight, ArrowUpRight, Wallet } from "lucide-react";
import { DashboardObservations } from "@/components/rf/dashboard-observations";
import { useVendasSemAliquota } from "@/hooks/use-vendas-sem-aliquota";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/rf/kpi-card";
import { DreTable, type DreRow } from "@/components/rf/dre-table";
import { MonthlyChart, type MonthlyPoint } from "@/components/rf/monthly-chart";
import { PontoEquilibrioBlock } from "@/components/rf/ponto-equilibrio-block";
import { SaidasPieChart } from "@/components/rf/saidas-pie-chart";
import { EntradasPieChart } from "@/components/rf/entradas-pie-chart";
import {
  CustosFixosVariaveisChart,
  EntradasSaidasResultadoChart,
} from "@/components/rf/consolidado-mini-charts";
import { Button } from "@/components/ui/button";
import { formatBRL, formatPercent } from "@/lib/format";
import { PeriodSelector, DEFAULT_RANGE, clampFrom, rangeForPreset } from "@/components/rf/period-selector";
import { ComparisonLine, previousRange } from "@/components/rf/period-comparison";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EcommerceView } from "@/components/rf/ecommerce-view";
import { LocacaoView } from "@/components/rf/locacao-view";
import { MargensCards } from "@/components/rf/margens-cards";
import { ErroCarregar } from "@/components/rf/erro-carregar";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Painel Financeiro" },
      { name: "description", content: "Visão consolidada da sua operação de e-commerce." },
    ],
  }),
  component: DashboardTabs,
});


// ────────────────────────────────────────────────────────────────
// DEMO E-COMMERCE — abas do Dashboard escondidas (código mantido intacto).
// Para religar: remova a chave desta lista (ou deixe-a vazia).
const HIDDEN_DASHBOARD_TABS: string[] = ["consolidado", "locacao"];
// ────────────────────────────────────────────────────────────────

const DASHBOARD_TABS = [
  { key: "consolidado", label: "Consolidado" },
  { key: "ecommerce", label: "E-commerce" },
  { key: "locacao", label: "Locação" },
] as const;

function DashboardTabs() {
  const visible = DASHBOARD_TABS.filter((t) => !HIDDEN_DASHBOARD_TABS.includes(t.key));
  const defaultTab = visible[0]?.key ?? "ecommerce";

  return (
    <Tabs defaultValue={defaultTab} className="w-full">
      {visible.length > 1 && (
        <div className="border-b border-border/60 bg-background/80 px-4 pt-4 sm:px-6">
          <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
            {visible.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </div>
      )}
      {visible.some((t) => t.key === "consolidado") && (
        <TabsContent value="consolidado" className="mt-0">
          <Consolidado />
        </TabsContent>
      )}
      {visible.some((t) => t.key === "ecommerce") && (
        <TabsContent value="ecommerce" className="mt-0">
          <EcommerceView />
        </TabsContent>
      )}
      {visible.some((t) => t.key === "locacao") && (
        <TabsContent value="locacao" className="mt-0">
          <LocacaoView />
        </TabsContent>
      )}
    </Tabs>
  );
}


function Consolidado() {
  const [range, setRange] = useState<{ from: string; to: string }>(DEFAULT_RANGE);
  const { from, to } = range;

  const effectiveFrom = clampFrom(from);

  const { data, isPending, error: kpiError, refetch: refetchKpi } = useQuery({
    queryKey: ["dashboard-kpis", effectiveFrom, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_kpis", { _from: effectiveFrom, _to: to });
      if (error) throw error;
      return (data ?? [])[0];
    },
  });

  const kpi = data ?? {
    entradas_ml: 0,
    entradas_locacao: 0,
    entradas_total: 0,
    saidas_ml: 0,
    saidas_gerais: 0,
    saidas_total: 0,
    custos_variaveis: 0,
    custos_fixos: 0,
    mc: 0,
    mc_pct: 0,
    resultado: 0,
    a_receber_ml: 0,
  };

  const resultPct = kpi.entradas_total > 0 ? (kpi.resultado / kpi.entradas_total) * 100 : 0;

  const { prevFrom, prevTo, valid: prevValid } = previousRange(effectiveFrom, to);
  const { data: semAliquota } = useVendasSemAliquota(null, effectiveFrom, to);

  const { data: prevData } = useQuery({
    queryKey: ["dashboard-kpis", prevFrom, prevTo],
    enabled: prevValid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_kpis", { _from: prevFrom, _to: prevTo });
      if (error) throw error;
      return (data ?? [])[0];
    },
  });
  const showComp = prevValid && !!prevData;

  const pontoEquilibrio = kpi.mc_pct > 0 ? kpi.custos_fixos / (kpi.mc_pct / 100) : null;
  const diferenca = pontoEquilibrio !== null ? kpi.entradas_total - pontoEquilibrio : null;
  const equilibrioProgress =
    pontoEquilibrio && pontoEquilibrio > 0
      ? Math.min((kpi.entradas_total / pontoEquilibrio) * 100, 100)
      : null;
  const acimaDoPonto = diferenca !== null && diferenca >= 0;

  const { data: dreRows, isPending: drePending, error: dreError, refetch: refetchDre } = useQuery({
    queryKey: ["dashboard-dre-tree", effectiveFrom, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_dre_tree", { _from: effectiveFrom, _to: to });
      if (error) throw error;
      return (data ?? []) as DreRow[];
    },
  });

  const { data: monthlyRows, isPending: monthlyPending, error: monthlyError, refetch: refetchMonthly } = useQuery({
    queryKey: ["dashboard-monthly-series"],
    queryFn: async () => {
      // Últimos 12 meses, como no E-commerce (antes: fixo desde 2026-05, ui-05).
      const { from: _from, to: _to } = rangeForPreset("12m");
      const { data, error } = await supabase.rpc("dashboard_monthly_series", { _from, _to });
      if (error) throw error;
      return (data ?? []) as unknown as MonthlyPoint[];
    },
  });

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-primary">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Resumo financeiro consolidado da sua operação.</p>
        </div>
        <PeriodSelector from={from} to={to} onChange={setRange} />
      </header>

      {(kpiError && !data) || (dreError && !dreRows) || (monthlyError && !monthlyRows) ? (
        <ErroCarregar
          onRetry={() => {
            void refetchKpi();
            void refetchDre();
            void refetchMonthly();
          }}
        />
      ) : (
      <>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          loading={isPending}
          label="Faturamento bruto"
          value={kpi.entradas_total}
          icon={ArrowUpRight}
          valueClassName="text-emerald-600"
          comparison={
            <ComparisonLine show={showComp} current={kpi.entradas_total} previous={Number(prevData?.entradas_total ?? 0)} />
          }
          subtitle={
            <span className="text-[11px] text-muted-foreground">
              E-commerce {formatBRL(kpi.entradas_ml)} · Locação {formatBRL(kpi.entradas_locacao)}
            </span>
          }
        />
        <KpiCard
          loading={isPending}
          label="Saídas"
          value={kpi.saidas_total}
          icon={ArrowDownRight}
          valueClassName="text-red-500"
          comparison={
            <ComparisonLine show={showComp} invert current={kpi.saidas_total} previous={Number(prevData?.saidas_total ?? 0)} />
          }
          subtitle={
            <span className="text-[11px] text-muted-foreground">
              Vendas ML (com produtos) {formatBRL(kpi.saidas_ml)} · Custos gerais {formatBRL(kpi.saidas_gerais)}
            </span>
          }
        />
        <KpiCard
          loading={isPending}
          label="Resultado"
          value={kpi.resultado}
          icon={kpi.resultado >= 0 ? TrendingUp : TrendingDown}
          valueClassName={cn(kpi.resultado >= 0 ? "text-emerald-500" : "text-red-500")}
          comparison={
            <ComparisonLine show={showComp} current={kpi.resultado} previous={Number(prevData?.resultado ?? 0)} />
          }
          subtitle={
            <span className={cn("text-[11px] font-medium", kpi.resultado >= 0 ? "text-emerald-500" : "text-red-500")}>
              {formatPercent(resultPct)} das entradas
            </span>
          }
        />
        <KpiCard
          loading={isPending}
          label="A receber"
          value={kpi.a_receber_ml}
          icon={Wallet}
          valueClassName="text-amber-400"
          comparison={null}
          subtitle={
            <div className="space-y-0.5 text-[11px] text-muted-foreground">
              <div>Mercado Livre</div>
              <div className="text-muted-foreground/60">Locação: em breve</div>
            </div>
          }
        />
      </section>

      <MargensCards from={effectiveFrom} to={to} op="total" />

      <PontoEquilibrioBlock
        loading={isPending}
        entradas={kpi.entradas_total}
        custos_fixos={kpi.custos_fixos}
        mc_pct={kpi.mc_pct}
      />

      <section>
        <DreTable rows={dreRows} loading={drePending} />
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <EntradasPieChart rows={dreRows} loading={drePending} />
        <SaidasPieChart rows={dreRows} loading={drePending} compact />
      </section>

      <section>
        <MonthlyChart data={monthlyRows} loading={monthlyPending} />
      </section>

      <section>
        <DashboardObservations
          kpi={kpi}
          monthlyRows={monthlyRows}
          dreRows={dreRows}
          loading={isPending || drePending || monthlyPending}
          semAliquota={semAliquota}
        />
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CustosFixosVariaveisChart
          loading={isPending}
          custosVariaveis={kpi.custos_variaveis}
          custosFixos={kpi.custos_fixos}
        />
        <EntradasSaidasResultadoChart
          loading={isPending}
          entradas={kpi.entradas_total}
          saidas={kpi.saidas_total}
          resultado={kpi.resultado}
        />
      </section>
      </>
      )}
    </div>
  );
}
