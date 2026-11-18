import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBRL, formatBRLCompact } from "@/lib/format";
import { PieTooltip, type PieSlice } from "@/components/rf/pie-chart-shared";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

const VARIAVEIS_COLOR = "hsl(25 85% 55%)";
const FIXOS_COLOR = "hsl(205 70% 50%)";
const POSITIVO = "hsl(142 60% 45%)";
const NEGATIVO = "hsl(0 72% 55%)";

export function CustosFixosVariaveisChart({
  custosVariaveis,
  custosFixos,
  loading,
}: {
  custosVariaveis: number;
  custosFixos: number;
  loading?: boolean;
}) {
  const total = (Number(custosVariaveis) || 0) + (Number(custosFixos) || 0);
  const data: PieSlice[] =
    total > 0
      ? [
          {
            name: "Variáveis",
            valor: Number(custosVariaveis) || 0,
            pct: ((Number(custosVariaveis) || 0) / total) * 100,
          },
          {
            name: "Fixos",
            valor: Number(custosFixos) || 0,
            pct: ((Number(custosFixos) || 0) / total) * 100,
          },
        ].filter((s) => s.valor > 0)
      : [];
  const colors = [VARIAVEIS_COLOR, FIXOS_COLOR];

  return (
    <Card className="bg-card border-border/70 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-muted-foreground">
          Custos fixos × variáveis
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : data.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            Sem custos no período.
          </div>
        ) : (
          <>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="valor"
                    nameKey="name"
                    innerRadius="58%"
                    outerRadius="85%"
                    paddingAngle={2}
                    cx="50%"
                    cy="50%"
                  >
                    {data.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={colors[index % colors.length]}
                        stroke="var(--card)"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip sufixo="das saídas" />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-3 space-y-1">
              {data.map((s, i) => (
                <li key={s.name} className="flex items-center gap-2 text-[11px]">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: colors[i % colors.length] }}
                  />
                  <span className="text-muted-foreground">{s.name}</span>
                  <span className="ml-auto tabular-nums text-foreground/80">
                    {formatBRL(s.valor)} · {s.pct.toFixed(1).replace(".", ",")}%
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BarTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { name: string; valor: number; fill: string } }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-border/70 bg-popover px-3.5 py-3 shadow-lg">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: p.fill }}
        />
        <span className="text-xs font-medium text-popover-foreground">{p.name}</span>
      </div>
      <div className="mt-2 text-base font-semibold tabular-nums text-popover-foreground">
        {formatBRL(p.valor)}
      </div>
    </div>
  );
}

export function EntradasSaidasResultadoChart({
  entradas,
  saidas,
  resultado,
  loading,
}: {
  entradas: number;
  saidas: number;
  resultado: number;
  loading?: boolean;
}) {
  const e = Number(entradas) || 0;
  const s = Number(saidas) || 0;
  const r = Number(resultado) || 0;
  const vazio = e === 0 && s === 0 && r === 0;
  const data = [
    { name: "Entradas", valor: e, fill: POSITIVO },
    { name: "Saídas", valor: s, fill: NEGATIVO },
    { name: "Resultado", valor: r, fill: r >= 0 ? POSITIVO : NEGATIVO },
  ];

  return (
    <Card className="bg-card border-border/70 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-muted-foreground">
          Entradas × Saídas × Resultado
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : vazio ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            Sem dados no período.
          </div>
        ) : (
          <div className="h-[248px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(v: number) => formatBRLCompact(v)}
                />
                <Tooltip cursor={{ fill: "color-mix(in oklab, var(--muted) 30%, transparent)" }} content={<BarTooltip />} />
                <Bar dataKey="valor" radius={[6, 6, 0, 0]} maxBarSize={64}>
                  {data.map((d) => (
                    <Cell key={d.name} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
