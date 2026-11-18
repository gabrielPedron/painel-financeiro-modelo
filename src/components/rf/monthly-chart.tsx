import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBRL } from "@/lib/format";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface MonthlyPoint {
  mes: string;
  entradas: number;
  saidas: number;
  resultado: number;
}

function labelMes(mes: string) {
  const d = new Date(`${String(mes).slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" })
    .format(d)
    .replace(".", "")
    .replace(" de ", "/");
}

function abreviaBRL(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (abs >= 1_000) return `R$ ${Math.round(v / 1_000)} mil`;
  return `R$ ${Math.round(v)}`;
}

export function MonthlyChart({ data, loading }: { data?: MonthlyPoint[]; loading?: boolean }) {
  const rows = (data ?? []).map((r) => ({
    label: labelMes(r.mes),
    entradas: Number(r.entradas ?? 0),
    saidas: Number(r.saidas ?? 0),
    resultado: Number(r.resultado ?? 0),
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Evolução mensal</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : rows.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
            Sem dados no período.
          </div>
        ) : (
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                />
                <YAxis
                  tickFormatter={(v: number) => abreviaBRL(v)}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={90}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--popover-foreground)",
                    fontSize: 12,
                  }}
                  formatter={(value: number, name: string) => [formatBRL(Number(value)), name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="entradas" name="Entradas" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="saidas" name="Saídas" stroke="hsl(0 72% 51%)" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="resultado" name="Resultado" stroke="hsl(212 73% 58%)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Desde maio/2026. O mês atual está em andamento.
        </p>
      </CardContent>
    </Card>
  );
}
