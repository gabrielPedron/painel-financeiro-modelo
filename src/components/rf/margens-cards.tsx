import { useQuery } from "@tanstack/react-query";
import { Info, Percent, PiggyBank } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { KpiCard } from "@/components/rf/kpi-card";
import { cn } from "@/lib/utils";
import { formatBRL, formatPercent } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ErroCarregar } from "@/components/rf/erro-carregar";

export type MargemOp = "ecommerce" | "locacao" | "total";

interface MargemRow {
  operacao: MargemOp;
  receita: number;
  custos_variaveis: number;
  margem_contribuicao_reais: number;
  margem_contribuicao_pct: number | null;
  custos_fixos: number;
  margem_lucro_reais: number;
  margem_lucro_pct: number | null;
}

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help items-center text-muted-foreground/70">
            <Info className="h-3 w-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] text-xs leading-relaxed">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function MargensCards({ from, to, op }: { from: string; to: string; op: MargemOp }) {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["dashboard-margens", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_margens" as never, { _from: from, _to: to } as never);
      if (error) throw error;
      return (data ?? []) as unknown as MargemRow[];
    },
  });

  if (error && !data) return <ErroCarregar oque="As margens" onRetry={() => void refetch()} />;

  // Sem receita no período a margem % não existe: traço e cor neutra, não "0,0%" verde (ui-04).
  const row = data?.find((r) => r.operacao === op);
  const num = (v: number | null | undefined) => (v == null ? null : Number(v));
  const mcPct = num(row?.margem_contribuicao_pct);
  const mlPct = num(row?.margem_lucro_pct);
  const mcReais = num(row?.margem_contribuicao_reais);
  const mlReais = num(row?.margem_lucro_reais);
  const cor = (pct: number | null, reais: number | null) =>
    pct == null || reais == null ? "text-muted-foreground" : reais >= 0 ? "text-emerald-500" : "text-red-500";

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <KpiCard
        loading={isPending}
        label={
          <span className="inline-flex items-center gap-1">
            Margem de contribuição (com CMV)
            <InfoTip text="Quanto sobra da receita depois dos custos que variam com a venda: CMV (custo da mercadoria vendida), comissão, frete, anúncios e imposto. Ainda não desconta os custos fixos." />
          </span>
        }
        value={mcPct ?? 0}
        formatValue={() => formatPercent(mcPct)}
        icon={Percent}
        valueClassName={cn(cor(mcPct, mcReais))}
        comparison={null}
        subtitle={<span className="text-[11px] text-muted-foreground">{formatBRL(mcReais)}</span>}
      />
      <KpiCard
        loading={isPending}
        label={
          <span className="inline-flex items-center gap-1">
            Margem de lucro (com CMV)
            <InfoTip text="O que sobra de verdade depois de TODOS os custos, incluindo o CMV e os fixos (aluguel, salários, sistemas). É o lucro real da operação." />
          </span>
        }
        value={mlPct ?? 0}
        formatValue={() => formatPercent(mlPct)}
        icon={PiggyBank}
        valueClassName={cn(cor(mlPct, mlReais))}
        comparison={null}
        subtitle={<span className="text-[11px] text-muted-foreground">{formatBRL(mlReais)}</span>}
      />
    </section>
  );
}