import { Lightbulb, TrendingUp, TrendingDown, ArrowDownRight, Calendar, Wallet, Percent, AlertTriangle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatBRL, formatPercent } from "@/lib/format";

export interface KpiData {
  resultado: number;
  entradas_total: number;
  mc_pct: number;
  a_receber_ml: number;
  saidas_total: number;
}

export interface MonthlyPoint {
  mes: string;
  entradas: number;
  saidas: number;
  resultado: number;
}

export interface DreRow {
  secao: string;
  grupo: string;
  item: string;
  valor: number;
}

interface DashboardObservationsProps {
  kpi: KpiData;
  monthlyRows: MonthlyPoint[] | undefined;
  dreRows: DreRow[] | undefined;
  loading?: boolean;
  /** Vendas do período sem alíquota (din-02): o imposto delas não entra no resultado. */
  semAliquota?: { sem: number; vendas: number };
}

function toYMDSP(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function monthName(mes: string): string {
  const d = new Date(`${String(mes).slice(0, 10)}T12:00:00-03:00`);
  return new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(d);
}

function currentMonth(): string {
  return toYMDSP(new Date()).slice(0, 7);
}

export function DashboardObservations({ kpi, monthlyRows, dreRows, loading, semAliquota }: DashboardObservationsProps) {
  const observations: { icon: React.ElementType; text: React.ReactNode; color?: "green" | "red" | "amber" }[] = [];

  if (!loading && semAliquota && semAliquota.sem > 0) {
    observations.push({
      icon: AlertTriangle,
      color: "amber",
      text: (
        <>
          {semAliquota.sem === semAliquota.vendas
            ? "Nenhuma venda do período tem alíquota cadastrada: o imposto não entra no resultado"
            : `${semAliquota.sem} de ${semAliquota.vendas} vendas do período estão sem alíquota cadastrada: o imposto delas não entra no resultado`}
          , que fica maior do que é.{" "}
          <Link to="/configuracoes" search={{ aba: "empresas" }} className="text-primary underline">Cadastrar</Link>
        </>
      ),
    });
  }

  if (!loading) {
    const hasPeriodData = kpi.entradas_total > 0 || kpi.saidas_total > 0 || kpi.resultado !== 0;

    if (hasPeriodData) {
      const resultPct = kpi.entradas_total > 0 ? (kpi.resultado / kpi.entradas_total) * 100 : 0;
      if (kpi.resultado >= 0) {
        observations.push({
          icon: TrendingUp,
          color: "green",
          text: (
            <>
              No período, sobraram{" "}
              <span className="text-emerald-500 font-medium">{formatBRL(kpi.resultado)}</span>
              {" "}({formatPercent(resultPct)} das entradas).
            </>
          ),
        });
      } else {
        observations.push({
          icon: TrendingDown,
          color: "red",
          text: (
            <>
              No período, faltaram{" "}
              <span className="text-red-500 font-medium">{formatBRL(Math.abs(kpi.resultado))}</span>
              {" "}para empatar.
            </>
          ),
        });
      }
    }

    const saidas = (dreRows ?? []).filter((r) => r.secao === "SAÍDAS");
    if (saidas.length > 0) {
      const maior = saidas.reduce((max, r) => (Number(r.valor) > Number(max.valor) ? r : max), saidas[0]);
      if (Number(maior.valor) > 0) {
        observations.push({
          icon: ArrowDownRight,
          text: (
            <>
              A maior saída foi <span className="font-medium">{maior.item}</span> ({maior.grupo}) com{" "}
              <span className="font-medium">{formatBRL(Number(maior.valor))}</span>.
            </>
          ),
        });
      }
    }

    const nowMonth = currentMonth();
    const historico = (monthlyRows ?? []).filter((r) => String(r.mes).slice(0, 7) !== nowMonth);
    if (historico.length > 0) {
      const melhor = historico.reduce((max, r) => (Number(r.resultado) > Number(max.resultado) ? r : max), historico[0]);
      observations.push({
        icon: Calendar,
        text: (
          <>
            Melhor mês desde maio: <span className="font-medium">{monthName(melhor.mes)}</span> — resultado{" "}
            <span className="font-medium">{formatBRL(Number(melhor.resultado))}</span>.
          </>
        ),
      });
    }

    if (kpi.a_receber_ml > 0) {
      observations.push({
        icon: Wallet,
        text: (
          <>
            Há <span className="font-medium">{formatBRL(kpi.a_receber_ml)}</span> a receber do Mercado Livre (vendas ainda não liberadas).
          </>
        ),
      });
    }

    if (hasPeriodData) {
      observations.push({
        icon: Percent,
        text: (
          <>
            Margem de contribuição do período: <span className="font-medium">{formatPercent(kpi.mc_pct)}</span>.
          </>
        ),
      });
    }
  }

  const visible = observations.slice(0, 5);

  return (
    <Card className="bg-card border-border/70 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-muted-foreground" />
          Observações
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem observações para o período.</p>
        ) : (
          <ul className="space-y-2">
            {visible.map((obs, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm">
                <obs.icon
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    obs.color === "green" && "text-emerald-500",
                    obs.color === "red" && "text-red-500",
                    obs.color === "amber" && "text-amber-500",
                    !obs.color && "text-muted-foreground"
                  )}
                />
                <span className="text-muted-foreground leading-relaxed">{obs.text}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
