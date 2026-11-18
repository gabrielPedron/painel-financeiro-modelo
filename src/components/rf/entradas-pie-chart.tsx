import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DreRow } from "@/components/rf/dre-table";
import { buildSlices, PieTooltip } from "@/components/rf/pie-chart-shared";
import { PieLegendBelow, sliceColor } from "@/components/rf/saidas-pie-chart";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const PALETTE = [
  "hsl(142 60% 45%)",
  "hsl(170 60% 40%)",
  "hsl(190 75% 45%)",
  "hsl(205 70% 50%)",
  "hsl(160 45% 55%)",
  "hsl(220 60% 55%)",
  "hsl(150 40% 35%)",
  "hsl(185 50% 60%)",
];

export function EntradasPieChart({
  rows,
  loading,
}: {
  rows: DreRow[] | undefined;
  loading?: boolean;
}) {
  const data = useMemo(() => buildSlices(rows, ["ENTRADAS"]), [rows]);

  return (
    <Card className="bg-card border-border/70 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Composição das entradas</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : data.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
            Sem entradas no período.
          </div>
        ) : (
          <>
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="valor"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="85%"
                    paddingAngle={2}
                    cx="50%"
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
                  <Tooltip content={<PieTooltip sufixo="das entradas" />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <PieLegendBelow data={data} palette={PALETTE} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
