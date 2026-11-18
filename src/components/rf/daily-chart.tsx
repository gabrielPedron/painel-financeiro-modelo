import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBRL } from "@/lib/format";

export type DailyPoint = {
  day: string;
  revenue: number;
  commissions: number;
  installment: number;
  shipping: number;
  fulfillment: number;
  ads: number;
  tax: number;
  costs_total: number;
  net: number;
};

type Mode = "breakdown" | "net";

function formatCompactBRL(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 1_000) return `R$ ${Math.round(v / 1_000)}k`;
  return `R$ ${Math.round(v)}`;
}

function parseYMD(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function formatDayShort(s: string) {
  const d = parseYMD(s);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function formatDayLong(s: string) {
  const d = parseYMD(s);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
}

const COST_KEYS: { key: keyof DailyPoint; label: string; color: string }[] = [
  { key: "commissions", label: "Comissões", color: "#93c5fd" },

  { key: "shipping", label: "Fretes", color: "#60a5fa" },
  { key: "fulfillment", label: "Full", color: "#3b82f6" },
  { key: "ads", label: "Product Ads", color: "#1d4ed8" },
  { key: "tax", label: "Imposto", color: "#1e3a8a" },
];

const BRAND = "#1B5FAA";
const POS = "#16a34a";
const NEG = "#dc2626";

function CustomTooltip({ active, payload, label, mode }: { active?: boolean; payload?: Array<{ payload: DailyPoint }>; label?: string; mode: Mode }) {
  if (!active || !payload?.length || !label) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-border/60 bg-background/95 shadow-md px-3 py-2 text-xs">
      <div className="font-medium mb-1 capitalize">{formatDayLong(label)}</div>
      {mode === "breakdown" ? (
        <div className="space-y-0.5 tabular-nums">
          <div className="flex justify-between gap-4"><span className="text-primary font-medium">Receita</span><span>{formatBRL(p.revenue)}</span></div>
          {COST_KEYS.map((c) => (
            <div key={c.key} className="flex justify-between gap-4">
              <span className="text-muted-foreground">{c.label}</span>
              <span>{formatBRL(Number(p[c.key]))}</span>
            </div>
          ))}
          <div className="flex justify-between gap-4 pt-1 mt-1 border-t border-border/60">
            <span className="font-medium">Líquido</span>
            <span className={p.net >= 0 ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>{formatBRL(p.net)}</span>
          </div>
        </div>
      ) : (
        <div className="tabular-nums">
          <div className="flex justify-between gap-4">
            <span>Resultado líquido</span>
            <span className={p.net >= 0 ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>{formatBRL(p.net)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function DailyChart({ data, loading }: { data: DailyPoint[]; loading?: boolean }) {
  const [mode, setMode] = useState<Mode>("breakdown");

  const tickInterval = useMemo(() => {
    if (data.length <= 45) return 0;
    return Math.ceil(data.length / 15) - 1;
  }, [data.length]);

  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-primary">Evolução diária</h3>
        <div className="inline-flex rounded-md border border-border/60 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode("breakdown")}
            className={`px-2.5 py-1 rounded ${mode === "breakdown" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Receita e custos
          </button>
          <button
            type="button"
            onClick={() => setMode("net")}
            className={`px-2.5 py-1 rounded ${mode === "net" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Resultado líquido
          </button>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-[280px] w-full" />
      ) : data.length === 0 ? (
        <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
          Sem dados no período.
        </div>
      ) : (
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            {mode === "breakdown" ? (
              <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tickFormatter={formatDayShort} interval={tickInterval} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tickFormatter={formatCompactBRL} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={60} />
                <ReTooltip content={<CustomTooltip mode="breakdown" />} cursor={{ fill: "color-mix(in oklab, var(--muted) 40%, transparent)" }} />
                {COST_KEYS.map((c) => (
                  <Bar key={c.key} dataKey={c.key} stackId="costs" fill={c.color} name={c.label} />
                ))}
                <Line type="monotone" dataKey="revenue" stroke={BRAND} strokeWidth={2.5} dot={false} name="Receita" />
              </ComposedChart>
            ) : (
              <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tickFormatter={formatDayShort} interval={tickInterval} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tickFormatter={formatCompactBRL} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={60} />
                <ReTooltip content={<CustomTooltip mode="net" />} cursor={{ fill: "color-mix(in oklab, var(--muted) 40%, transparent)" }} />
                <Bar dataKey="net" name="Resultado líquido">
                  {data.map((d, i) => (
                    <NetCell key={i} value={d.net} />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      {!loading && data.length > 0 ? (
        mode === "breakdown" ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded-sm" style={{ backgroundColor: BRAND }} />
              Receita
            </span>
            {COST_KEYS.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c.color }} />
                {c.label}
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: POS }} />
              Lucro
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: NEG }} />
              Prejuízo
            </span>
          </div>
        )
      ) : null}
    </div>
  );
}

function NetCell({ value }: { value: number }) {
  return <Cell fill={value >= 0 ? POS : NEG} />;
}