import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/format";
import { MIN_DATE } from "@/components/rf/period-selector";

function parseYMD(v: string): Date {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Período anterior de mesma duração, imediatamente antes de [from, to]. */
export function previousRange(from: string, to: string) {
  const f = parseYMD(from);
  const t = parseYMD(to);
  const days = Math.floor((t.getTime() - f.getTime()) / 86400000) + 1;
  const prevTo = new Date(f.getTime() - 86400000);
  const prevFrom = new Date(f.getTime() - days * 86400000);
  return {
    prevFrom: toYMD(prevFrom),
    prevTo: toYMD(prevTo),
    /** Só é confiável se o período anterior inteiro estiver dentro da janela de dados. */
    valid: toYMD(prevFrom) >= MIN_DATE,
  };
}

interface ComparisonLineProps {
  current: number;
  previous: number | null | undefined;
  /** "pct" = variação percentual; "pp" = diferença em pontos percentuais. */
  mode?: "pct" | "pp";
  /** true quando subir é ruim (saídas). */
  invert?: boolean;
  show?: boolean;
}

export function ComparisonLine({ current, previous, mode = "pct", invert, show = true }: ComparisonLineProps) {
  if (!show || previous == null) return null;

  let delta: number | null;
  if (mode === "pp") {
    delta = current - previous;
  } else {
    delta = previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100;
  }

  if (delta === null) {
    return <div className="mt-2 text-[11px] text-muted-foreground">— vs período anterior</div>;
  }

  const positive = delta > 0;
  const good = invert ? !positive : positive;
  const Arrow = delta === 0 ? null : positive ? ArrowUp : ArrowDown;
  const color = delta === 0 ? "text-muted-foreground" : good ? "text-emerald-500" : "text-red-500";
  const texto = mode === "pp" ? `${formatPercent(Math.abs(delta)).replace("%", "")} pp` : formatPercent(Math.abs(delta));

  return (
    <div className={cn("mt-2 inline-flex items-center gap-1 text-[11px] font-medium tabular-nums", color)}>
      {Arrow ? <Arrow className="h-3 w-3" /> : null}
      <span>{texto}</span>
      <span className="font-normal text-muted-foreground">vs período anterior</span>
    </div>
  );
}
