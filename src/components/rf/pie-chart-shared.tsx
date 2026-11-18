import { formatBRL } from "@/lib/format";
import type { DreRow } from "@/components/rf/dre-table";

export interface PieSlice {
  name: string;
  valor: number;
  pct: number;
}

export const OUTROS_AGRUPADOS = "Demais categorias";
export const OUTROS_AGRUPADOS_COLOR = "hsl(215 16% 47%)";

export function buildSlices(
  rows: DreRow[] | undefined,
  secoes: string[],
  topN = 8
): PieSlice[] {
  const alvo = new Set(secoes.map((s) => s.toUpperCase()));
  const filtered = (rows ?? []).filter((r) => alvo.has((r.secao ?? "").toUpperCase()));
  const map = new Map<string, number>();
  for (const r of filtered) {
    const nome = r.item?.trim() || "(sem nome)";
    map.set(nome, (map.get(nome) ?? 0) + (Number(r.valor) || 0));
  }
  const sorted = [...map.entries()]
    .map(([name, valor]) => ({ name, valor }))
    .filter((x) => x.valor > 0)
    .sort((a, b) => b.valor - a.valor);

  const total = sorted.reduce((sum, x) => sum + x.valor, 0);
  if (total <= 0) return [];

  const result: PieSlice[] = sorted.slice(0, topN).map((x) => ({
    name: x.name,
    valor: x.valor,
    pct: (x.valor / total) * 100,
  }));
  const resto = sorted.slice(topN).reduce((sum, x) => sum + x.valor, 0);
  if (resto > 0) {
    result.push({ name: OUTROS_AGRUPADOS, valor: resto, pct: (resto / total) * 100 });
  }
  return result;
}

export function PieTooltip({
  active,
  payload,
  sufixo,
}: {
  active?: boolean;
  payload?: Array<{ payload?: PieSlice; color?: string }>;
  sufixo: string;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  const slice = entry?.payload;
  if (!slice) return null;
  return (
    <div className="rounded-lg border border-border/70 bg-popover px-3.5 py-3 shadow-lg">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: entry.color }}
        />
        <span className="text-xs font-medium text-popover-foreground">{slice.name}</span>
      </div>
      <div className="mt-2 text-base font-semibold tabular-nums text-popover-foreground">
        {formatBRL(slice.valor)}
      </div>
      <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
        {slice.pct.toFixed(1).replace(".", ",")}% {sufixo}
      </div>
    </div>
  );
}
