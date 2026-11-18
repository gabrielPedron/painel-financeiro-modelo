import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatPercent } from "@/lib/format";

type TrendRow = {
  metric: string;
  account_id: string;
  months_rising: number | string;
  pct_change: number | string | null;
  avg_pct_of_revenue_first: number | string | null;
  avg_pct_of_revenue_last: number | string | null;
};

const METRIC_LABELS: Record<string, string> = {
  comissoes: "Comissões",
  fretes: "Fretes",
  full: "Full",
  ads: "Ads",
  outros: "Outras taxas",
};

const METRIC_VERBS: Record<string, string> = {
  comissoes: "subiram",
  fretes: "subiram",
  full: "subiu",
  ads: "subiu",
  outros: "subiram",
};

export function CostTrendsBanner({ accountIds }: { accountIds: string[] }) {
  const [dismissed, setDismissed] = useState(false);
  const key = accountIds.slice().sort().join(",");

  const { data } = useQuery({
    queryKey: ["ml-cost-trends", key],
    enabled: accountIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ml_cost_trends", {
        _account_ids: accountIds,
        _months: 4,
      });
      if (error) throw error;
      return (data ?? []) as TrendRow[];
    },
  });

  const aggregated = useMemo(() => {
    if (!data) return [];
    const byMetric = new Map<string, { rising: number; first: number; last: number; count: number }>();
    for (const r of data) {
      const rising = Number(r.months_rising) || 0;
      if (rising < 3) continue;
      const first = Number(r.avg_pct_of_revenue_first);
      const last = Number(r.avg_pct_of_revenue_last);
      if (!Number.isFinite(first) || !Number.isFinite(last)) continue;
      const cur = byMetric.get(r.metric) ?? { rising: 0, first: 0, last: 0, count: 0 };
      cur.rising = Math.max(cur.rising, rising);
      cur.first += first;
      cur.last += last;
      cur.count += 1;
      byMetric.set(r.metric, cur);
    }
    return Array.from(byMetric.entries()).map(([metric, v]) => {
      const first = v.first / v.count;
      const last = v.last / v.count;
      const pct = first > 0 ? ((last - first) / first) * 100 : null;
      return { metric, rising: v.rising, first, last, pct };
    });
  }, [data]);

  if (dismissed || aggregated.length === 0) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
      <div className="flex-1 space-y-1">
        <div className="font-medium">Tendência de alta detectada</div>
        <ul className="space-y-0.5 text-xs">
          {aggregated.map((a) => {
            const label = METRIC_LABELS[a.metric] ?? a.metric;
            const verb = METRIC_VERBS[a.metric] ?? "subiram";
            return (
              <li key={a.metric} className="tabular-nums">
                <span className="font-medium">{label}</span> {verb} {a.rising} meses seguidos:
                {" "}de {formatPercent(a.first)} para {formatPercent(a.last)} da receita
                {a.pct != null ? ` (${a.pct >= 0 ? "+" : ""}${formatPercent(a.pct, 0)})` : ""}
              </li>
            );
          })}
        </ul>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="rounded p-1 text-amber-700 hover:bg-amber-100"
        aria-label="Dispensar"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}