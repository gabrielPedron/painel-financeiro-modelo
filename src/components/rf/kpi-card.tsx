import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL, formatPercent, signClass } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp } from "lucide-react";

interface KpiCardProps {
  label: React.ReactNode;
  value: number;
  variation?: number | null;
  sparkline?: number[];
  icon?: LucideIcon;
  invertSign?: boolean;
  higherIsBetter?: boolean;
  currency?: boolean;
  subtitle?: React.ReactNode;
  footer?: React.ReactNode;
  comparison?: React.ReactNode;
  formatValue?: (value: number) => string;
  loading?: boolean;
  valueClassName?: string;
}

export function KpiCard({ label, value, variation, sparkline, icon: Icon, invertSign, higherIsBetter, currency = true, subtitle, footer, comparison, formatValue, loading, valueClassName }: KpiCardProps) {
  const displayValue = formatValue
    ? formatValue(value)
    : currency
      ? formatBRL(value, { showSign: false })
      : value.toLocaleString("pt-BR");
  const varValue = variation ?? 0;
  const better = higherIsBetter ?? !invertSign;
  const varSign = better ? varValue : -varValue;
  const Arrow = varValue > 0 ? ArrowUp : varValue < 0 ? ArrowDown : null;
  return (
    <Card className="min-w-0 overflow-hidden bg-card border-border/70 shadow-sm">
      <CardContent className="min-w-0 p-4">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
          {Icon ? (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon className="h-3.5 w-3.5" />
            </span>
          ) : null}
        </div>
        {loading ? (
          <>
            <Skeleton className="mt-2 h-7 w-24" />
            <Skeleton className="mt-1.5 h-3 w-32" />
            <div className="mt-2 flex items-center justify-between">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3 w-24" />
            </div>
          </>
        ) : (
          <>
            <div
              title={displayValue}
              className={cn("mt-2 min-w-0 truncate text-xl font-semibold tabular-nums tracking-tight sm:text-2xl", valueClassName)}
            >
              {displayValue}
            </div>
            {subtitle ? <div className="mt-0.5 min-w-0 text-[11px] text-muted-foreground sm:truncate">{subtitle}</div> : null}
            {comparison !== undefined ? (
              comparison
            ) : (
            <div className="mt-2 flex min-w-0 items-center justify-between gap-2 text-xs">
              {variation == null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span className={cn("inline-flex min-w-0 items-center gap-0.5 tabular-nums font-medium", signClass(varSign))}>
                  {Arrow ? <Arrow className="h-3 w-3" /> : null}
                  {varValue > 0 ? "+" : ""}
                  {formatPercent(varValue)}
                </span>
              )}
              {sparkline && sparkline.length > 0 ? (
                <Sparkline values={sparkline} />
              ) : (
                <span className="min-w-0 truncate text-muted-foreground/60">vs. período anterior</span>
              )}
            </div>
            )}
            {footer ? <div className="mt-1 min-w-0 text-[11px] text-muted-foreground">{footer}</div> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 60;
  const h = 18;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1 || 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="shrink-0 text-primary">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
    </svg>
  );
}