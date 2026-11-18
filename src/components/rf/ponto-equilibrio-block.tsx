import { Info } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatBRL, formatPercent } from "@/lib/format";

interface PontoEquilibrioBlockProps {
  loading: boolean;
  entradas: number;
  custos_fixos: number;
  mc_pct: number;
}

export function PontoEquilibrioBlock({ loading, entradas, custos_fixos, mc_pct }: PontoEquilibrioBlockProps) {
  const pontoEquilibrio = mc_pct > 0 ? custos_fixos / (mc_pct / 100) : null;
  const diferenca = pontoEquilibrio !== null ? entradas - pontoEquilibrio : null;
  const equilibrioProgress =
    pontoEquilibrio && pontoEquilibrio > 0 ? Math.min((entradas / pontoEquilibrio) * 100, 100) : null;
  const acimaDoPonto = diferenca !== null && diferenca >= 0;

  return (
    <section className="rounded-lg border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-medium text-foreground">Ponto de equilíbrio</h2>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label="O que é ponto de equilíbrio?"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[260px]">
                  Ponto de equilíbrio é o faturamento mínimo para o resultado ficar em zero. Abaixo dele a operação dá
                  prejuízo; acima, começa o lucro.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="text-[11px] text-muted-foreground">Quanto você precisa faturar no período para empatar</p>
        </div>
        <div className="text-right">
          {loading ? (
            <div className="h-8 w-32 animate-pulse rounded bg-muted/60" />
          ) : pontoEquilibrio !== null ? (
            <>
              <div className="text-2xl font-semibold tracking-tight text-primary">{formatBRL(pontoEquilibrio)}</div>
              <div className={cn("text-[11px] font-medium", acimaDoPonto ? "text-emerald-500" : "text-red-500")}>
                {acimaDoPonto
                  ? `${formatBRL(diferenca!)} acima do ponto`
                  : `${formatBRL(Math.abs(diferenca!))} abaixo do ponto`}
              </div>
            </>
          ) : (
            <div className="text-sm font-medium text-muted-foreground">
              Ponto de equilíbrio indisponível — margem de contribuição não positiva no período.
            </div>
          )}
        </div>
      </div>

      {equilibrioProgress !== null && (
        <div className="mt-4">
          <Progress value={equilibrioProgress} className="h-1.5" />
          <div className="mt-1.5 text-[10px] text-muted-foreground/70">
            Realizado {formatBRL(entradas)} de {formatBRL(pontoEquilibrio!)} ({formatPercent(equilibrioProgress)} do ponto)
          </div>
        </div>
      )}

      <div className="mt-3 space-y-1">
        {!loading && pontoEquilibrio !== null && (
          <>
            <div className="text-[11px] text-muted-foreground">
              Cálculo: custos fixos ({formatBRL(custos_fixos)}) ÷ margem de contribuição ({formatPercent(mc_pct)}).
            </div>
            <div className={cn("text-[11px] font-medium", acimaDoPonto ? "text-emerald-500" : "text-red-500")}>
              {acimaDoPonto
                ? `Cada R$ 1 vendido acima daqui vira ${formatPercent(mc_pct)} de lucro.`
                : `Faltam ${formatBRL(Math.abs(diferenca!))} de faturamento para cobrir os custos fixos.`}
            </div>
          </>
        )}
        <div className="text-[10px] text-muted-foreground/60">
          Baseado nos custos fixos e na margem de contribuição do período selecionado.
        </div>
      </div>
    </section>
  );
}
