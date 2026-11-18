import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, ArrowDownRight, ArrowUpRight, Wallet, Info } from "lucide-react";
import { DashboardObservations } from "@/components/rf/dashboard-observations";
import { useVendasSemAliquota } from "@/hooks/use-vendas-sem-aliquota";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBRL, formatPercent } from "@/lib/format";
import { PeriodSelector, DEFAULT_RANGE, clampFrom, todaySP } from "@/components/rf/period-selector";
import { ComparisonLine, previousRange } from "@/components/rf/period-comparison";
import { MargensCards } from "@/components/rf/margens-cards";
import { ErroCarregar } from "@/components/rf/erro-carregar";
import { PagamentosPresos } from "@/components/rf/pagamentos-presos";

const OP = "ecommerce";




interface TopProduto {
  titulo: string | null;
  sku: string | null;
  unidades: number;
  receita: number;
  participacao_pct: number;
  thumbnail: string | null;
  permalink: string | null;
}

export function EcommerceView() {
  const [range, setRange] = useState<{ from: string; to: string }>(DEFAULT_RANGE);
  const { from, to } = range;

  const effectiveFrom = clampFrom(from);
  const { data: semAliquota } = useVendasSemAliquota(null, effectiveFrom, to);

  const { data, isPending, error: erro1, refetch: refazer1 } = useQuery({
    queryKey: ["ecommerce-kpis", effectiveFrom, to],
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
    cmv: Number(data?.cmv ?? 0),
    pedidos_sem_custo: Number(data?.pedidos_sem_custo ?? 0),
    receita_sem_custo: Number(data?.receita_sem_custo ?? 0),
  };

  const resultPct = kpi.entradas > 0 ? (kpi.resultado / kpi.entradas) * 100 : 0;

  const { prevFrom, prevTo, valid: prevValid } = previousRange(effectiveFrom, to);

  const { data: prevData } = useQuery({
    queryKey: ["ecommerce-kpis", prevFrom, prevTo],
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
    queryKey: ["ecommerce-dre-tree", effectiveFrom, to],
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

  // Janela móvel de 12 meses: do primeiro dia do mês de 11 meses atrás até hoje
  // (fuso America/Sao_Paulo, mesma base do todaySP do period-selector).
  const monthlyWindow = useMemo(() => {
    const hoje = todaySP();
    const y = Number(hoje.slice(0, 4));
    const m = Number(hoje.slice(5, 7));
    const total = y * 12 + (m - 1) - 11;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    return { from: `${ny}-${String(nm).padStart(2, "0")}-01`, to: hoje };
  }, []);

  const { data: monthlyRows, isPending: monthlyPending, error: erro3, refetch: refazer3 } = useQuery({
    queryKey: ["ecommerce-monthly-series", monthlyWindow.from, monthlyWindow.to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_monthly_series_op" as never, {
        _from: monthlyWindow.from,
        _to: monthlyWindow.to,
        _op: OP,
      } as never);
      if (error) throw error;
      return (data ?? []) as unknown as MonthlyPoint[];
    },
  });

  const { data: topProdutos, isPending: topPending, error: erro4, refetch: refazer4 } = useQuery({
    queryKey: ["ecommerce-top-produtos", effectiveFrom, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_top_produtos" as never, {
        _from: effectiveFrom,
        _to: to,
        _limite: 10,
      } as never);
      if (error) throw error;
      return (data ?? []) as unknown as TopProduto[];
    },
  });

  const { data: ecomMetrics, isPending: metricsPending, error: erro5, refetch: refazer5 } = useQuery({
    queryKey: ["ecommerce-metrics", effectiveFrom, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_ecom_metrics" as never, {
        _from: effectiveFrom,
        _to: to,
      } as never);
      if (error) throw error;
      const row = ((data ?? []) as unknown as Record<string, number>[])[0];
      return {
        pedidos: Number(row?.pedidos ?? 0),
        faturamento: Number(row?.faturamento ?? 0),
        ads: Number(row?.ads ?? 0),
        ticket_medio: Number(row?.ticket_medio ?? 0),
        tacos_pct: Number(row?.tacos_pct ?? 0),
      };
    },
  });

  // Consulta que falhou não vira R$ 0,00 (ui-04). Só sem dado em mãos: falha numa releitura
  // em segundo plano mantém o que já está na tela.
  const falhou = (erro1 && !data) || (erro2 && !dreRows) || (erro3 && !monthlyRows) || (erro4 && !topProdutos) || (erro5 && !ecomMetrics);

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-primary">E-commerce</h1>
          <p className="text-sm text-muted-foreground">Resultado financeiro da operação de e-commerce.</p>
        </div>
        <PeriodSelector from={from} to={to} onChange={setRange} />
      </header>

      <p className="text-[11px] text-muted-foreground/70">
        Os custos são divididos entre e-commerce e locação pelos rateios da Planilha. Enquanto os rateios não estiverem
        ajustados, os valores podem variar.
      </p>


      {falhou ? (
        <ErroCarregar onRetry={() => { void refazer1(); void refazer2(); void refazer3(); void refazer4(); void refazer5(); }} />
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
              Variáveis {formatBRL(kpi.custos_variaveis)} (inclui CMV {formatBRL(kpi.cmv)}) · Fixos{" "}
              {formatBRL(kpi.custos_fixos)}
            </span>
          }
        />
        <KpiCard
          loading={isPending}
          label="Resultado (com CMV)"
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
          value={kpi.a_receber}
          icon={Wallet}
          valueClassName="text-amber-400"
          comparison={null}
          subtitle={<span className="text-[11px] text-muted-foreground">Mercado Livre</span>}
          footer={<PagamentosPresos accountIds={null} />}
        />
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SecondaryMetricCard
          loading={metricsPending}
          label="Pedidos"
          value={ecomMetrics?.pedidos ?? 0}
          formatValue={(v) => Number(v).toLocaleString("pt-BR")}
        />
        <SecondaryMetricCard
          loading={metricsPending}
          label="Ticket médio"
          value={ecomMetrics?.ticket_medio ?? 0}
          formatValue={(v) => formatBRL(v)}
        />
        <SecondaryMetricCard
          loading={isPending}
          label="CMV do período"
          value={kpi.cmv}
          formatValue={(v) => formatBRL(v)}
          tooltip="Custo da mercadoria vendida: custo cadastrado do SKU × quantidade vendida (kits somam os componentes). Pedidos cancelados ficam fora. Mesma fonte usada na Conciliação."
        />
        <SecondaryMetricCard
          loading={metricsPending}
          label="TACoS"
          value={ecomMetrics?.tacos_pct ?? 0}
          formatValue={(v) => formatPercent(v)}
          tooltip="TACoS = gasto com Ads ÷ faturamento. Quanto do faturamento foi para anúncios."
        />
      </section>

      {!isPending && kpi.pedidos_sem_custo > 0 && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-500">
          {kpi.pedidos_sem_custo.toLocaleString("pt-BR")} venda(s) sem custo de SKU cadastrado (
          {formatBRL(kpi.receita_sem_custo)} de receita). Esse custo não foi estimado nem embutido — cadastre em
          Produtos / SKUs para o CMV ficar completo.
        </p>
      )}

      <MargensCards from={effectiveFrom} to={to} op="ecommerce" />

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
        <TopProdutosCard rows={topProdutos} loading={topPending} />
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
          semAliquota={semAliquota}
        />
      </section>
      </>
      )}
    </div>
  );
}

function SecondaryMetricCard({
  label,
  value,
  formatValue,
  tooltip,
  loading,
}: {
  label: string;
  value: number;
  formatValue: (v: number) => string;
  tooltip?: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card/50 px-4 py-3 shadow-sm">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        {tooltip && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label={`O que é ${label}?`}
                >
                  <Info className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px]">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      {loading ? (
        <div className="mt-1.5 h-5 w-20 animate-pulse rounded bg-muted/60" />
      ) : (
        <div className="mt-1 text-lg font-semibold tracking-tight text-foreground tabular-nums">
          {formatValue(value)}
        </div>
      )}
    </div>
  );
}

function TopProdutosCard({ rows, loading }: { rows?: TopProduto[]; loading?: boolean }) {
  return (
    <Card className="bg-card border-border/70 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Top produtos (por receita)</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Sem vendas no período.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Produto</th>
                  <th className="px-3 py-2 text-left font-medium">SKU</th>
                  <th className="px-3 py-2 text-right font-medium">Unid.</th>
                  <th className="px-3 py-2 text-right font-medium">Receita</th>
                  <th className="px-3 py-2 text-right font-medium">Part.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map((r, i) => (
                  <tr key={`${r.sku ?? ""}-${i}`} className="hover:bg-muted/30">
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {r.thumbnail ? (
                          <img
                            src={r.thumbnail}
                            alt={r.titulo ?? "Produto"}
                            loading="lazy"
                            className="h-8 w-8 shrink-0 rounded border border-border/60 object-contain"
                          />
                        ) : (
                          <div className="h-8 w-8 shrink-0 rounded border border-border/60 bg-muted/40" />
                        )}
                        {r.permalink ? (
                          <a
                            href={r.permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block max-w-[380px] truncate text-primary hover:underline"
                            title={r.titulo ?? ""}
                          >
                            {r.titulo ?? "—"}
                          </a>
                        ) : (
                          <span className="block max-w-[380px] truncate" title={r.titulo ?? ""}>
                            {r.titulo ?? "—"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.sku || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(r.unidades ?? 0).toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatBRL(Number(r.receita ?? 0))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatPercent(Number(r.participacao_pct ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground/70">
          Ranking por faturamento. Margem por produto virá quando o custo por SKU estiver completo (Fase 4).
        </div>
      </CardContent>
    </Card>
  );
}
