import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Split, TrendingUp, TrendingDown } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/rf/empty-state";
import { formatBRL, formatPercent } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/custos-por-operacao")({
  head: () => ({
    meta: [
      { title: "Custos por operação — Painel Financeiro" },
      { name: "description", content: "Custos da empresa rateados entre e-commerce e locação." },
    ],
  }),
  component: CustosPorOperacaoView,
});

type Row = {
  top_category_id: string;
  top_category_name: string;
  category_kind: "fixo" | "variavel" | string;
  category_sort: number;
  month: string;
  total: number;
  ecommerce: number;
  locacao: number;
};

type Op = "ecommerce" | "locacao";

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const BLUE_PALETTE = [
  "#1B5FAA", "#2E7BC4", "#4C93D6", "#6FA8DC", "#8FBBE3",
  "#1E4E8C", "#3873B5", "#5A9BD2", "#82B4DE", "#A6CBE9",
  "#0F3D73", "#265F99",
];

export function CustosPorOperacaoView() {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [op, setOp] = useState<Op>("ecommerce");

  const { data: rows, isLoading } = useQuery({
    queryKey: ["custos-por-operacao", year],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return [] as Row[];
      const { data, error } = await supabase.rpc("custos_por_operacao", { _owner: uid, _year: year });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const valueKey: keyof Row = op;

  const agg = useMemo(() => {
    const list = rows ?? [];
    let totalAll = 0;
    let totalOp = 0;
    const byCat = new Map<string, { id: string; name: string; kind: string; sort: number; op: number; total: number }>();
    const byMonth = new Array(12).fill(0) as number[];
    // per-category per-month for observations (op value)
    const catMonthly = new Map<string, number[]>();

    for (const r of list) {
      totalAll += Number(r.total) || 0;
      const v = Number(r[valueKey] as number) || 0;
      totalOp += v;
      const cat = byCat.get(r.top_category_id) ?? {
        id: r.top_category_id,
        name: r.top_category_name,
        kind: r.category_kind,
        sort: r.category_sort,
        op: 0,
        total: 0,
      };
      cat.op += v;
      cat.total += Number(r.total) || 0;
      byCat.set(r.top_category_id, cat);

      const m = new Date(r.month).getMonth();
      byMonth[m] += v;

      const arr = catMonthly.get(r.top_category_id) ?? (new Array(12).fill(0) as number[]);
      arr[m] += v;
      catMonthly.set(r.top_category_id, arr);
    }

    const cats = Array.from(byCat.values());
    const fixos = cats.filter((c) => c.kind === "fixo").sort((a, b) => b.op - a.op);
    const variaveis = cats.filter((c) => c.kind !== "fixo").sort((a, b) => b.op - a.op);

    // Observations: last month with any data across all cats, compare with previous month with data
    const monthsWithData = byMonth.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
    const observations: { name: string; delta: number; from: number; to: number; monthLabel: string }[] = [];
    if (monthsWithData.length >= 2) {
      const last = monthsWithData[monthsWithData.length - 1];
      const prev = monthsWithData[monthsWithData.length - 2];
      for (const c of cats) {
        const arr = catMonthly.get(c.id)!;
        const to = arr[last];
        const from = arr[prev];
        if (from > 0 && to > 0) {
          const delta = (to - from) / from;
          if (Math.abs(delta) >= 0.1) {
            observations.push({
              name: c.name,
              delta,
              from,
              to,
              monthLabel: MONTH_LABELS[last],
            });
          }
        }
      }
      observations.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    }

    return {
      totalAll,
      totalOp,
      pct: totalAll > 0 ? (totalOp / totalAll) * 100 : 0,
      fixos,
      variaveis,
      cats: cats.sort((a, b) => b.op - a.op),
      byMonth,
      monthsWithData: monthsWithData.length,
      observations,
    };
  }, [rows, valueKey]);

  const years = [2025, 2026, 2027];
  const opLabel = op === "ecommerce" ? "E-commerce" : "Locação";

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-primary">Custos por operação</h1>
          <p className="text-sm text-muted-foreground">Como o custo total da empresa se divide entre e-commerce e locação.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-border/60 bg-card/60 p-0.5">
            {years.map((y) => (
              <button
                key={y}
                onClick={() => setYear(y)}
                className={
                  "px-3 py-1.5 text-sm rounded-[5px] transition-colors " +
                  (year === y ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
                }
              >
                {y}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-md border border-border/60 bg-card/60 p-0.5">
            {(["ecommerce", "locacao"] as Op[]).map((v) => (
              <button
                key={v}
                onClick={() => setOp(v)}
                className={
                  "px-3 py-1.5 text-sm rounded-[5px] transition-colors " +
                  (op === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
                }
              >
                {v === "ecommerce" ? "E-commerce" : "Locação"}
              </button>
            ))}
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : !rows || rows.length === 0 || agg.totalAll === 0 ? (
        <EmptyState
          icon={Split}
          title="Sem custos cadastrados para este ano"
          description="Cadastre custos na tela Custos Empresa para ver o rateio entre e-commerce e locação aqui."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SummaryCard label="Custos totais da empresa" value={formatBRL(agg.totalAll)} sub={`Ano ${year}`} />
            <SummaryCard label={`Custos da operação (${opLabel})`} value={formatBRL(agg.totalOp)} sub={`Ano ${year}`} />
            <SummaryCard label="% que representa" value={formatPercent(agg.pct)} sub={`${opLabel} sobre total`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CategorySection title="Custos fixos" cats={agg.fixos} totalOp={agg.totalOp} />
            <CategorySection title="Custos variáveis" cats={agg.variaveis} totalOp={agg.totalOp} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-border/60 bg-card/60">
              <CardHeader>
                <CardTitle className="text-base">Proporção por categoria ({opLabel})</CardTitle>
              </CardHeader>
              <CardContent>
                {agg.totalOp === 0 ? (
                  <div className="text-sm text-muted-foreground">Sem valores nesta visão.</div>
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={agg.cats.filter((c) => c.op > 0).map((c) => ({ name: c.name, value: c.op }))}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={50}
                          outerRadius={100}
                          paddingAngle={1}
                        >
                          {agg.cats.filter((c) => c.op > 0).map((_, i) => (
                            <Cell key={i} fill={BLUE_PALETTE[i % BLUE_PALETTE.length]} />
                          ))}
                        </Pie>
                        <RTooltip
                          formatter={(v: number, n: string) => [
                            `${formatBRL(v)} (${formatPercent((v / agg.totalOp) * 100)})`,
                            n,
                          ]}
                          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                        />
                        <Legend
                          formatter={(name: string, entry) => {
                            const val = (entry as unknown as { payload?: { value?: number } })?.payload?.value ?? 0;
                            return `${name} — ${formatPercent((val / agg.totalOp) * 100)}`;
                          }}
                          wrapperStyle={{ fontSize: 12 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/60">
              <CardHeader>
                <CardTitle className="text-base">Custo por mês ({opLabel})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={agg.byMonth.map((v, i) => ({ month: MONTH_LABELS[i], value: v }))}>
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis
                        tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                        tick={{ fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <RTooltip
                        formatter={(v: number) => [formatBRL(v), opLabel]}
                        contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                      />
                      <Bar dataKey="value" fill="#1B5FAA" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/60 bg-card/60">
            <CardHeader>
              <CardTitle className="text-base">Observações do sistema</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {agg.monthsWithData < 2 ? (
                <p className="text-muted-foreground">
                  Os gráficos de evolução e as observações ganham valor conforme os meses de {year} forem preenchidos.
                </p>
              ) : agg.observations.length === 0 ? (
                <p className="text-muted-foreground">Nenhuma variação relevante entre os dois últimos meses com dados.</p>
              ) : (
                <ul className="space-y-1.5">
                  {agg.observations.slice(0, 6).map((o, i) => {
                    const up = o.delta > 0;
                    return (
                      <li key={i} className="flex items-center gap-2">
                        {up ? (
                          <TrendingUp className="h-4 w-4 text-red-600" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-emerald-700" />
                        )}
                        <span className="font-medium">{o.name}</span>
                        <span className={up ? "text-red-600" : "text-emerald-700"}>
                          {up ? "subiu" : "caiu"} {formatPercent(Math.abs(o.delta) * 100)}
                        </span>
                        <span className="text-muted-foreground">
                          em {o.monthLabel} ({formatBRL(o.from)} → {formatBRL(o.to)})
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="border-border/60 bg-card/60">
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

function CategorySection({
  title,
  cats,
  totalOp,
}: {
  title: string;
  cats: { id: string; name: string; op: number }[];
  totalOp: number;
}) {
  const sectionTotal = cats.reduce((s, c) => s + c.op, 0);
  const max = cats.reduce((m, c) => Math.max(m, c.op), 0);
  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>{title}</span>
          <span className="text-sm font-normal text-muted-foreground tabular-nums">{formatBRL(sectionTotal)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {cats.length === 0 || sectionTotal === 0 ? (
          <div className="text-sm text-muted-foreground">Sem valores nesta seção.</div>
        ) : (
          <ul className="space-y-2.5">
            {cats.map((c) => {
              const pct = totalOp > 0 ? (c.op / totalOp) * 100 : 0;
              const barPct = max > 0 ? (c.op / max) * 100 : 0;
              return (
                <li key={c.id} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium truncate">{c.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatBRL(c.op)} · {formatPercent(pct)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${barPct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}