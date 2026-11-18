import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBRL } from "@/lib/format";
import type { DreRow } from "@/components/rf/dre-table";
import {
  buildSlices,
  PieTooltip,
  OUTROS_AGRUPADOS,
  OUTROS_AGRUPADOS_COLOR,
  type PieSlice,
} from "@/components/rf/pie-chart-shared";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

const PALETTE = [
  "hsl(0 72% 55%)",
  "hsl(25 85% 55%)",
  "hsl(45 90% 55%)",
  "hsl(15 65% 45%)",
  "hsl(340 70% 50%)",
  "hsl(35 70% 40%)",
  "hsl(5 55% 38%)",
  "hsl(50 60% 45%)",
];

export function sliceColor(slice: PieSlice, index: number, palette: string[]) {
  return slice.name === OUTROS_AGRUPADOS
    ? OUTROS_AGRUPADOS_COLOR
    : palette[index % palette.length];
}

export function PieLegendBelow({ data, palette }: { data: PieSlice[]; palette: string[] }) {
  return (
    <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
      {data.map((s, i) => (
        <li key={s.name} className="flex items-center gap-2 text-[11px]">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: sliceColor(s, i, palette) }}
          />
          <span className="truncate text-muted-foreground">{s.name}</span>
          <span className="ml-auto shrink-0 tabular-nums text-foreground/80">
            {formatBRL(s.valor)} · {s.pct.toFixed(1).replace(".", ",")}%
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SaidasPieChart({
  rows,
  loading,
  compact,
}: {
  rows: DreRow[] | undefined;
  loading?: boolean;
  compact?: boolean;
}) {
  const data = useMemo(() => buildSlices(rows, ["SAÍDAS", "SAIDAS"]), [rows]);

  return (
    <Card className="bg-card border-border/70 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Composição das saídas</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : data.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
            Sem saídas no período.
          </div>
        ) : (
          <>
            <div className={compact ? "h-[240px] w-full" : "h-[360px] w-full"}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="valor"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="85%"
                    paddingAngle={2}
                    cx={compact ? "50%" : "40%"}
                    cy="50%"
                  >
                    {data.map((entry, index) => (
                      <Cell
                        key={`cell-${entry.name}`}
                        fill={sliceColor(entry, index, PALETTE)}
                        stroke="var(--card)"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip sufixo="das saídas" />} />
                  {!compact && (
                    <Legend
                      verticalAlign="middle"
                      align="right"
                      layout="vertical"
                      wrapperStyle={{ fontSize: 12, paddingLeft: 16 }}
                      formatter={(value: string, entry: unknown) => {
                        const slice = (entry as { payload?: PieSlice })?.payload;
                        return `${value} · ${slice ? formatBRL(slice.valor) : formatBRL(0)} (${slice ? slice.pct.toFixed(1) : "0,0"}%)`;
                      }}
                    />
                  )}
                </PieChart>
              </ResponsiveContainer>
            </div>
            {compact && <PieLegendBelow data={data} palette={PALETTE} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}
