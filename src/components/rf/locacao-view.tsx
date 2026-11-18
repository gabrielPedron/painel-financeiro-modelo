import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TrendingUp, TrendingDown, ArrowDownRight, ArrowUpRight, Wallet } from "lucide-react";
import { DashboardObservations } from "@/components/rf/dashboard-observations";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/rf/kpi-card";
import { DreTable, type DreRow } from "@/components/rf/dre-table";
import { MonthlyChart, type MonthlyPoint } from "@/components/rf/monthly-chart";
import { PontoEquilibrioBlock } from "@/components/rf/ponto-equilibrio-block";
import { SaidasPieChart } from "@/components/rf/saidas-pie-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBRL, formatPercent } from "@/lib/format";
import { PeriodSelector, DEFAULT_RANGE, clampFrom, rangeForPreset } from "@/components/rf/period-selector";
import { ComparisonLine, previousRange } from "@/components/rf/period-comparison";
import { MargensCards } from "@/components/rf/margens-cards";
import { ErroCarregar } from "@/components/rf/erro-carregar";

const OP = "locacao";




interface TopCliente {
  cliente: string | null;
  cnpj_raiz: string | null;
  total: number;
  faturas: number;
  participacao_pct: number;
  uf: string | null;
}

export function LocacaoView() {
  const [range, setRange] = useState<{ from: string; to: string }>(DEFAULT_RANGE);
  const { from, to } = range;

  const effectiveFrom = clampFrom(from);

  const { data, isPending, error: erro1, refetch: refazer1 } = useQuery({
    queryKey: ["locacao-kpis", effectiveFrom, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_kpis_op" as never, {
        _from: effectiveFrom,
        _to: to,
        _op: OP,
      } as never);
      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, number>[])[0];
    },
  });

  const kpi = {
    entradas: Number(data?.entradas ?? 0),
    saidas: Number(data?.saidas ?? 0),
    custos_variaveis: Number(data?.custos_variaveis ?? 0),
    custos_fixos: Number(data?.custos_fixos ?? 0),
    mc: Number(data?.mc ?? 0),
    mc_pct: Number(data?.mc_pct ?? 0),
    resultado: Number(data?.resultado ?? 0),
    a_receber: Number(data?.a_receber ?? 0),
  };

  const resultPct = kpi.entradas > 0 ? (kpi.resultado / kpi.entradas) * 100 : 0;

  const { prevFrom, prevTo, valid: prevValid } = previousRange(effectiveFrom, to);

  const { data: prevData } = useQuery({
    queryKey: ["locacao-kpis", prevFrom, prevTo],
    enabled: prevValid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_kpis_op" as never, {
        _from: prevFrom,
        _to: prevTo,
        _op: OP,
      } as never);
      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, number>[])[0];
    },
  });
  const showComp = prevValid && !!prevData;

  const pontoEquilibrio = kpi.mc_pct > 0 ? kpi.custos_fixos / (kpi.mc_pct / 100) : null;
  const diferenca = pontoEquilibrio !== null ? kpi.entradas - pontoEquilibrio : null;
  const equilibrioProgress =
    pontoEquilibrio && pontoEquilibrio > 0 ? Math.min((kpi.entradas / pontoEquilibrio) * 100, 100) : null;
  const acimaDoPonto = diferenca !== null && diferenca >= 0;

  const { data: dreRows, isPending: drePending, error: erro2, refetch: refazer2 } = useQuery({
    queryKey: ["locacao-dre-tree", effectiveFrom, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_dre_tree_op" as never, {
        _from: effectiveFrom,
        _to: to,
        _op: OP,
      } as never);
      if (error) throw error;
      return (data ?? []) as unknown as DreRow[];
    },
  });

  const { data: monthlyRows, isPending: monthlyPending, error: erro3, refetch: refazer3 } = useQuery({
    queryKey: ["locacao-monthly-series"],
    queryFn: async () => {
      // Últimos 12 meses, como no E-commerce (antes: fixo desde 2026-05, ui-05).
      const { from: _from, to: _to } = rangeForPreset("12m");
      const { data, error } = await supabase.rpc("dashboard_monthly_series_op" as never, {
        _from,
        _to,
        _op: OP,
      } as never);
      if (error) throw error;
      return (data ?? []) as unknown as MonthlyPoint[];
    },
  });

  const { data: topClientes, isPending: topPending, error: erro4, refetch: refazer4 } = useQuery({
    queryKey: ["locacao-top-clientes", effectiveFrom, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_top_clientes_locacao" as never, {
        _from: effectiveFrom,
        _to: to,
        _limite: 10,
      } as never);
      if (error) throw error;
      return (data ?? []) as unknown as TopCliente[];
    },
  });

  // Consulta que falhou não vira R$ 0,00 (ui-04). Só sem dado em mãos: falha numa releitura
  // em segundo plano mantém o que já está na tela.
  const falhou = (erro1 && !data) || (erro2 && !dreRows) || (erro3 && !monthlyRows) || (erro4 && !topClientes);

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-primary">Locação</h1>
          <p className="text-sm text-muted-foreground">Resultado financeiro da operação de locação.</p>
        </div>
        <PeriodSelector from={from} to={to} onChange={setRange} />
      </header>

      <p className="text-[11px] text-muted-foreground/70">
        Os custos são divididos entre e-commerce e locação pelos rateios da Planilha. Enquanto os rateios não estiverem
        ajustados, os valores podem variar.
      </p>


      {falhou ? (
        <ErroCarregar onRetry={() => { void refazer1(); void refazer2(); void refazer3(); void refazer4(); }} />
      ) : (
      <>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          loading={isPending}
          label="Faturamento bruto"
          value={kpi.entradas}
          icon={ArrowUpRight}
          valueClassName="text-emerald-600"
          comparison={<ComparisonLine show={showComp} current={kpi.entradas} previous={Number(prevData?.entradas ?? 0)} />}
        />
        <KpiCard
          loading={isPending}
          label="Saídas"
          value={kpi.saidas}
          icon={ArrowDownRight}
          valueClassName="text-red-500"
          comparison={<ComparisonLine show={showComp} invert current={kpi.saidas} previous={Number(prevData?.saidas ?? 0)} />}
          subtitle={
            <span className="text-[11px] text-muted-foreground">
              Variáveis {formatBRL(kpi.custos_variaveis)} · Fixos {formatBRL(kpi.custos_fixos)}
            </span>
          }
        />
        <KpiCard
          loading={isPending}
          label="Resultado"
          value={kpi.resultado}
          icon={kpi.resultado >= 0 ? TrendingUp : TrendingDown}
          valueClassName={cn(kpi.resultado >= 0 ? "text-emerald-500" : "text-red-500")}
          comparison={<ComparisonLine show={showComp} current={kpi.resultado} previous={Number(prevData?.resultado ?? 0)} />}
          subtitle={
            <span className={cn("text-[11px] font-medium", kpi.resultado >= 0 ? "text-emerald-500" : "text-red-500")}>
              {formatPercent(resultPct)} das entradas
            </span>
          }
        />
        <KpiCard
          loading={isPending}
          label="A receber"
          value={0}
          formatValue={() => "Em breve"}
          icon={Wallet}
          valueClassName="text-amber-400"
          comparison={null}
          subtitle={<span className="text-[11px] text-muted-foreground">Aguardando relatório do Ótimo Gestor</span>}
        />
      </section>

      <MargensCards from={effectiveFrom} to={to} op="locacao" />

      <PontoEquilibrioBlock
        loading={isPending}
        entradas={kpi.entradas}
        custos_fixos={kpi.custos_fixos}
        mc_pct={kpi.mc_pct}
      />

      <section>
        <DreTable rows={dreRows} loading={drePending} />
      </section>

      <section>
        <SaidasPieChart rows={dreRows} loading={drePending} />
      </section>

      <section>
        <TopClientesCard rows={topClientes} loading={topPending} />
      </section>

      <section>
        <MonthlyChart data={monthlyRows} loading={monthlyPending} />
      </section>

      <section>
        <DashboardObservations
          kpi={{
            resultado: kpi.resultado,
            entradas_total: kpi.entradas,
            mc_pct: kpi.mc_pct,
            a_receber_ml: kpi.a_receber,
            saidas_total: kpi.saidas,
          }}
          monthlyRows={monthlyRows}
          dreRows={dreRows}
          loading={isPending || drePending || monthlyPending}
        />
      </section>
      </>
      )}
    </div>
  );
}

function TopClientesCard({ rows, loading }: { rows?: TopCliente[]; loading?: boolean }) {
  return (
    <Card className="bg-card border-border/70 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Maiores clientes</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Sem faturamento no período.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Cliente</th>
                  <th className="px-3 py-2 text-left font-medium">UF</th>
                  <th className="px-3 py-2 text-right font-medium">Faturas</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-right font-medium">Part.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map((r, i) => (
                  <tr key={`${r.cnpj_raiz ?? ""}-${i}`} className="hover:bg-muted/30">
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2">
                      <span className="block max-w-[420px] truncate" title={r.cliente ?? ""}>
                        {r.cliente ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.uf || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(r.faturas ?? 0).toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatBRL(Number(r.total ?? 0))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatPercent(Number(r.participacao_pct ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
