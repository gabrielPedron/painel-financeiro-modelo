import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, FileSpreadsheet } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/rf/empty-state";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

const MONTH_ABBR = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const YEAR_OPTIONS = [2025, 2026, 2027];
const MONTH_OPTIONS = [
  { v: "all", label: "Ano inteiro" },
  ...MONTH_ABBR.map((m, i) => ({ v: String(i + 1), label: m })),
];

function pct(n: number): string {
  return `${n.toFixed(1).replace(".", ",")}%`;
}

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const id = data.user?.id;
  if (!id) throw new Error("Sessão expirada.");
  return id;
}

function useMonthly(year: number) {
  return useQuery({
    queryKey: ["rental-monthly-total", year],
    queryFn: async () => {
      const _owner = await uid();
      const { data, error } = await supabase.rpc("rental_monthly_total", { _owner, _year: year });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        month: r.month as string,
        total: Number(r.total),
        faturas: Number(r.faturas),
      }));
    },
  });
}

export function RentalOverview({ onGoToImport }: { onGoToImport?: () => void }) {
  const now = new Date();
  const [year, setYear] = useState<number>(
    YEAR_OPTIONS.includes(now.getFullYear()) ? now.getFullYear() : YEAR_OPTIONS[0],
  );
  const [monthSel, setMonthSel] = useState<string | null>(null);

  const monthly = useMonthly(year);
  const monthlyPrev = useMonthly(year - 1);

  const months = monthly.data ?? [];
  const lastWithData = useMemo(() => {
    for (let i = months.length - 1; i >= 0; i--) if (months[i].faturas > 0) return i + 1;
    return null;
  }, [months]);

  const effectiveMonth = monthSel ?? (lastWithData ? String(lastWithData) : String(now.getMonth() + 1));
  const monthNum = effectiveMonth === "all" ? null : Number(effectiveMonth);

  const grouped = useQuery({
    queryKey: ["rental-overview-grouped", year, monthNum],
    queryFn: async () => {
      const _owner = await uid();
      const { data, error } = await supabase.rpc("rental_invoices_grouped", {
        _owner, _year: year, _month: monthNum ?? undefined,
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

  const cities = useQuery({
    queryKey: ["rental-by-city", year, monthNum],
    queryFn: async () => {
      const _owner = await uid();
      const { data, error } = await supabase.rpc("rental_by_city", {
        _owner, _year: year, _month: monthNum ?? undefined,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        municipio: r.municipio as string,
        uf: r.uf as string,
        total: Number(r.total),
        faturas: Number(r.faturas),
      }));
    },
  });

  const groups = grouped.data ?? [];
  const totalPeriodo = groups.reduce((a, b) => a + b.total, 0);
  const totalFaturas = groups.reduce((a, b) => a + b.faturas, 0);

  // comparação com período anterior
  let compare: { label: string; delta: number | null } | null = null;
  if (monthNum) {
    if (monthNum === 1) {
      compare = { label: "Sem mês anterior no ano", delta: null };
    } else {
      const prev = months[monthNum - 2]?.total ?? 0;
      compare = {
        label: `vs. ${MONTH_ABBR[monthNum - 2]}`,
        delta: prev > 0 ? ((totalPeriodo - prev) / prev) * 100 : null,
      };
    }
  } else {
    const prevYear = (monthlyPrev.data ?? []).reduce((a, b) => a + b.total, 0);
    if (prevYear > 0) {
      compare = { label: `vs. ${year - 1}`, delta: ((totalPeriodo - prevYear) / prevYear) * 100 };
    }
  }

  const yearHasData = months.some((m) => m.faturas > 0);
  const loading = monthly.isLoading || grouped.isLoading;

  const chartData = months.map((m, i) => ({
    name: MONTH_ABBR[i],
    total: m.total,
    selected: monthNum === i + 1,
  }));

  const topGroups = [...groups].sort((a, b) => b.total - a.total).slice(0, 10);
  const topCities = (cities.data ?? []).slice(0, 10);
  const cityTotal = (cities.data ?? []).reduce((a, b) => a + b.total, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Ano</Label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Mês</Label>
          <Select value={effectiveMonth} onValueChange={setMonthSel}>
            <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTH_OPTIONS.map((o) => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!yearHasData && !loading ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              icon={FileSpreadsheet}
              title={`Nenhuma fatura importada em ${year}`}
              description="Importe o Excel de faturamento na aba “Faturas importadas” para ver o painel gerencial."
              action={onGoToImport ? <Button size="sm" onClick={onGoToImport}>Ir para Faturas importadas</Button> : undefined}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card><CardContent className="p-4">
              <div className="text-[11px] uppercase text-muted-foreground">Faturamento do período</div>
              <div className="text-xl font-semibold tabular-nums">{formatBRL(totalPeriodo)}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-[11px] uppercase text-muted-foreground">Faturas</div>
              <div className="text-xl font-semibold tabular-nums">{totalFaturas}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-[11px] uppercase text-muted-foreground">Clientes</div>
              <div className="text-xl font-semibold tabular-nums">{groups.length}</div>
            </CardContent></Card>
            {compare && (
              <Card><CardContent className="p-4">
                <div className="text-[11px] uppercase text-muted-foreground">Período anterior</div>
                {compare.delta === null ? (
                  <div className="text-sm text-muted-foreground mt-1">{compare.label}</div>
                ) : (
                  <div className={cn(
                    "text-xl font-semibold tabular-nums flex items-center gap-1",
                    compare.delta >= 0 ? "text-emerald-500" : "text-destructive",
                  )}>
                    {compare.delta >= 0 ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
                    {pct(Math.abs(compare.delta))}
                    <span className="text-[11px] font-normal text-muted-foreground ml-1">{compare.label}</span>
                  </div>
                )}
              </CardContent></Card>
            )}
          </div>

          <Card>
            <CardContent className="p-4 space-y-3">
              <h2 className="text-sm font-semibold">Maiores clientes</h2>
              {topGroups.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem faturas no período selecionado.</p>
              ) : (
                <div className="space-y-2">
                  {topGroups.map((g) => {
                    const share = totalPeriodo > 0 ? (g.total / totalPeriodo) * 100 : 0;
                    const rel = topGroups[0].total > 0 ? (g.total / topGroups[0].total) * 100 : 0;
                    return (
                      <div key={g.cnpj_raiz} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-3 text-xs">
                          <span className="truncate">{g.grupo_label}</span>
                          <span className="tabular-nums shrink-0">
                            {formatBRL(g.total)}
                            <span className="text-muted-foreground ml-2">{pct(share)}</span>
                          </span>
                        </div>
                        <div className="h-2 rounded bg-muted overflow-hidden">
                          <div className="h-full rounded bg-primary" style={{ width: `${Math.max(rel, 1)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <h2 className="text-sm font-semibold">Faturamento por mês — {year}</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis
                      tickLine={false} axisLine={false} fontSize={11} width={70}
                      tickFormatter={(v: number) => formatBRL(v)}
                    />
                    <Tooltip
                      cursor={{ fill: "color-mix(in oklab, var(--muted) 40%, transparent)" }}
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8, fontSize: 12,
                      }}
                      formatter={(v: number) => [formatBRL(v), "Faturamento"]}
                    />
                    <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                      {chartData.map((d, i) => (
                        <Cell
                          key={i}
                          fill={d.selected ? "var(--primary)" : "color-mix(in oklab, var(--primary) 35%, transparent)"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <h2 className="text-sm font-semibold">Faturamento por cidade</h2>
              {topCities.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem faturas no período selecionado.</p>
              ) : (
                <div className="space-y-2">
                  {topCities.map((c) => {
                    const share = cityTotal > 0 ? (c.total / cityTotal) * 100 : 0;
                    const rel = topCities[0].total > 0 ? (c.total / topCities[0].total) * 100 : 0;
                    return (
                      <div key={`${c.municipio}-${c.uf}`} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-3 text-xs">
                          <span className="truncate">
                            {c.municipio}{c.uf ? `/${c.uf}` : ""}
                            <span className="text-muted-foreground ml-2">{c.faturas} fatura{c.faturas === 1 ? "" : "s"}</span>
                          </span>
                          <span className="tabular-nums shrink-0">
                            {formatBRL(c.total)}
                            <span className="text-muted-foreground ml-2">{pct(share)}</span>
                          </span>
                        </div>
                        <div className="h-2 rounded bg-muted overflow-hidden">
                          <div className="h-full rounded bg-sky-500/70" style={{ width: `${Math.max(rel, 1)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
