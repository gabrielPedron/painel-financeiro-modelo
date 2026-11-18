// TELA DE CONCILIAÇÃO — o coração financeiro do sistema.
// Mostra cada venda com receita efetiva, tarifas do Mercado Livre (comissão,
// cobrança/processamento, parcelamento, frete), imposto, custo do produto (CMV)
// e publicidade rateada, além das abas de recebimentos e divergências.
// CUIDADO: todos os números vêm das funções do banco mp_reconciliation e
// mp_reconciliation_summary. Não recalcule nada aqui — dois caminhos de cálculo
// vão divergir. Quando faltar dado, mostre traço ou aviso, nunca zero.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { Scale, AlertTriangle, Info, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { syncTodayNow, refreshReleasesNow } from "@/lib/ml-sync-today.functions";
import { supabase } from "@/integrations/supabase/client";
import { PeriodFilter, type PeriodKey } from "@/components/rf/period-filter";
import { EmptyState } from "@/components/rf/empty-state";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DivergenciasPanel } from "@/components/rf/divergencias-panel";
import { RecebimentosPanel } from "@/components/rf/recebimentos-panel";
import { formatBRL, formatNumber } from "@/lib/format";
import { todasAsPaginas } from "@/lib/paginas";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/conciliacao")({
  head: () => ({
    meta: [
      { title: "Conciliação Mercado Pago — Painel Financeiro" },
      { name: "description", content: "Conciliação por venda entre pedidos do Mercado Livre e pagamentos do Mercado Pago." },
      { property: "og:title", content: "Conciliação Mercado Pago — Painel Financeiro" },
      { property: "og:description", content: "Confira bruto, taxas, líquido e liberação de cada venda." },
    ],
  }),
  component: ConciliacaoPage,
});

type Account = { id: string; nickname: string; trade_name: string | null };

const fmtYMD = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

// Nesta tela o período vai até HOJE (inclusive) — as outras telas seguem até D-1.
function periodRange(period: PeriodKey, custom?: { from?: Date; to?: Date }): { from: string; to: string; days: number } {
  if (period === "custom" && custom?.from && custom?.to) {
    const days = Math.max(1, Math.round((custom.to.getTime() - custom.from.getTime()) / 86400000) + 1);
    return { from: fmtYMD(custom.from), to: fmtYMD(custom.to), days };
  }
  const now = new Date();
  if (period === "ontem") {
    const yesterday = new Date(now.getTime() - 86400000);
    return { from: fmtYMD(yesterday), to: fmtYMD(yesterday), days: 1 };
  }
  const days = period === "hoje" ? 1 : period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 30;
  const from = new Date(now.getTime() - (days - 1) * 86400000);
  return { from: fmtYMD(from), to: fmtYMD(now), days };
}

const fmtDateTime = (v: string | null | undefined) => {
  if (!v) return { data: "—", hora: "" };
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return { data: "—", hora: "" };
  const data = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(d);
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { data, hora };
};


const truncar = (s: string | null | undefined, n = 30) => {
  const t = (s ?? "").trim();
  if (!t) return "—";
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

const PAGE = 100;

type StatusLinha = "ok" | "aguardando" | "cancelada" | "sem_pagamento";

/** Classificação única do status da venda — usada no badge da tabela e no filtro. */
function classificarStatus(r: { match_status?: string | null; order_status?: string | null; order_date?: string | null }): StatusLinha {
  if (r.match_status === "ok") return "ok";
  const orderStatus = String(r.order_status ?? "").toLowerCase();
  if (orderStatus === "cancelled" || orderStatus === "canceled") return "cancelada";
  const orderDate = new Date(String(r.order_date ?? ""));
  const nowSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const doisDiasAtras = new Date(nowSP);
  doisDiasAtras.setDate(doisDiasAtras.getDate() - 2);
  doisDiasAtras.setHours(0, 0, 0, 0);
  const orderDateStart = new Date(orderDate);
  orderDateStart.setHours(0, 0, 0, 0);
  if (!Number.isNaN(orderDateStart.getTime()) && orderDateStart >= doisDiasAtras) return "aguardando";
  return "sem_pagamento";
}

const pct = (n: number) => `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Cor do "Retorno líquido": verde >70, âmbar 50-70, vermelho <50. */
function pctClass(v: number): string {
  if (v >= 70) return "text-emerald-500";
  if (v >= 50) return "text-amber-500";
  return "text-destructive";
}

function InfoTip({ texto }: { texto: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help text-muted-foreground/70 hover:text-muted-foreground">
          <Info className="h-3.5 w-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-xs leading-snug">{texto}</TooltipContent>
    </Tooltip>
  );
}

function ResumoCard({
  label,
  value,
  subtitle,
  destaque,
  saida,
  loading,
  formatado,
  ajuda,
}: {
  label: string;
  value: number;
  subtitle?: React.ReactNode;
  destaque?: boolean;
  saida?: boolean;
  loading?: boolean;
  formatado?: string;
  ajuda?: string;
}) {
  return (
    <Card className={cn("bg-card border-border/70 shadow-sm", destaque && "border-primary/60 bg-primary/5")}>
      <CardContent className="p-4">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
          {ajuda ? <InfoTip texto={ajuda} /> : null}
        </span>
        {loading ? (
          <>
            <Skeleton className="mt-2 h-7 w-24" />
            <Skeleton className="mt-1.5 h-3 w-28" />
          </>
        ) : (
          <>
            <div className={cn("mt-2 text-2xl font-semibold tabular-nums tracking-tight", saida && "text-destructive")}>
              {formatado ?? (saida ? `− ${formatBRL(Math.abs(value), { showSign: false })}` : formatBRL(value))}
            </div>
            {subtitle ? <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</div> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Célula de tarifa: valor como saída, com marca discreta quando a origem é o pagamento (provisório). */
function FeeCell({ valor, origem, pendente }: { valor: number; origem?: string | null; pendente?: boolean }) {
  if (pendente) {
    return (
      <TableCell className="text-right tabular-nums text-xs">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex cursor-help items-center gap-1 text-amber-500">
              <Info className="h-3 w-3" /> pendente
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-[240px] text-xs leading-snug">
            O Mercado Livre ainda não lançou as tarifas desta venda e o pagamento também não traz retenções. A margem exibida vai cair quando a tarifa chegar.
          </TooltipContent>
        </Tooltip>
      </TableCell>
    );
  }
  const provisorio = origem === "pagamento";
  return (
    <TableCell className="text-right tabular-nums text-xs">
      {provisorio ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">
              {formatBRL(-valor)}
              <span className="ml-0.5 text-muted-foreground">*</span>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-[260px] text-xs leading-snug">
            Valor do pagamento do Mercado Pago; o Mercado Livre ainda não lançou esta tarifa no faturamento.
          </TooltipContent>
        </Tooltip>
      ) : (
        formatBRL(-valor)
      )}
    </TableCell>
  );
}



function ConciliacaoPage() {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [customRange, setCustomRange] = useState<{ from?: Date; to?: Date }>({});
  const [account, setAccount] = useState("all");
  const [visible, setVisible] = useState(PAGE);
  const [ordem, setOrdem] = useState<"recentes" | "retorno_asc" | "retorno_desc" | "bruto" | "liquido">("recentes");
  const [situacao, setSituacao] = useState<"todas" | "ok" | "aguardando" | "concluidas" | "devolvidas" | "canceladas">("todas");
  const [atualizando, setAtualizando] = useState(false);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpand = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  const queryClient = useQueryClient();
  const dispararSyncHoje = useServerFn(syncTodayNow);
  const dispararRefreshLiberacoes = useServerFn(refreshReleasesNow);

  const atualizarAgora = async () => {
    setAtualizando(true);
    try {
      const r = await dispararSyncHoje({});
      toast.success(
        r.enqueued > 0
          ? "Sincronização do dia iniciada. Os dados chegam em até 2 minutos."
          : "Nada novo para sincronizar agora.",
      );
      try {
        const lib = await dispararRefreshLiberacoes({});
        if (lib.atualizados > 0) {
          toast.success(`${lib.atualizados} pagamento(s) com liberação atualizada.`);
        }
      } catch {
        // atualização de liberações é complementar; não bloqueia o sync
      }
      await new Promise((res) => setTimeout(res, 8000));
      await queryClient.invalidateQueries({ queryKey: ["mp-reconciliation"] });
      await queryClient.invalidateQueries({ queryKey: ["mp-reconciliation-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["ml-available-dates"] });
      await queryClient.invalidateQueries({ queryKey: ["mp-a-receber"] });
      setUltimaAtualizacao(new Date());
    } catch (e) {
      toast.error((e as Error).message || "Não foi possível iniciar a sincronização.");
    } finally {
      setAtualizando(false);
    }
  };

  const { data: accounts } = useQuery({
    queryKey: ["accounts-ml"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketplace_accounts")
        .select("id, nickname, trade_name")
        .eq("platform", "mercado_livre")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });

  const hasAccounts = (accounts?.length ?? 0) > 0;
  const displayName = (a: Account) => a.trade_name?.trim() || a.nickname;
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    (accounts ?? []).forEach((a) => m.set(a.id, displayName(a)));
    return m;
  }, [accounts]);

  const { from, to, days } = useMemo(() => periodRange(period, customRange), [period, customRange]);
  const accountIds = useMemo(
    () => (account === "all" ? (accounts ?? []).map((a) => a.id) : [account]),
    [account, accounts],
  );
  const enabled = hasAccounts && accountIds.length > 0;
  const multi = account === "all" && (accounts?.length ?? 0) > 1;

  const { data: availableDates } = useQuery({
    queryKey: ["ml-available-dates", accountIds.join(",")],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ml_available_dates", { _account_ids: accountIds });
      if (error) throw error;
      const set = new Set<string>();
      for (const r of data ?? []) if (r.dia) set.add(r.dia);
      return set;
    },
  });

  const { data: summary, isPending: summaryPending, error: summaryError } = useQuery({
    queryKey: ["mp-reconciliation-summary", from, to, accountIds.join(",")],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("mp_reconciliation_summary", { _account_ids: accountIds, _from: from, _to: to });
      if (error) throw error;
      return (data ?? [])[0] ?? null;
    },
  });

  const { data: rows, isPending: rowsPending, error: rowsError } = useQuery({
    queryKey: ["mp-reconciliation", from, to, accountIds.join(",")],
    enabled,
    // Mais de 1.000 pedidos no período: lê todas as páginas, em ordem fixa (din-12).
    queryFn: () =>
      todasAsPaginas((de, ate) =>
        supabase
          .rpc("mp_reconciliation", { _account_ids: accountIds, _from: from, _to: to })
          .order("order_date", { ascending: false })
          .order("account_id")
          .order("order_id")
          .range(de, ate),
      ),
  });

  const { data: caixa, isPending: caixaPending } = useQuery({
    queryKey: ["conc-caixa-futuro", from, to, accountIds.join(",")],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("conc_caixa_futuro", { _account_ids: accountIds, _from: from, _to: to });
      if (error) throw error;
      return (data ?? [])[0] ?? null;
    },
  });

  const { data: div, isPending: divPending } = useQuery({
    queryKey: ["conc-divergencias", from, to, accountIds.join(",")],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("conc_divergencias", { _account_ids: accountIds, _from: from, _to: to });
      if (error) throw error;
      return (data ?? [])[0] ?? null;
    },
  });

  const { data: tarifasCanceladas } = useQuery({
    queryKey: ["conc-tarifas-canceladas", from, to, accountIds.join(",")],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("conc_tarifas_canceladas", { _account_ids: accountIds, _from: from, _to: to });
      if (error) throw error;
      return data ?? [];
    },
  });

  const linhaPct = (r: { mp_gross?: number | null; mp_net?: number | null }) => {
    const g = Number(r.mp_gross ?? 0);
    return g > 0 ? (Number(r.mp_net ?? 0) / g) * 100 : 0;
  };

  const sorted = useMemo(() => {
    let list = [...(rows ?? [])];
    const devolvida = (s: string | null | undefined) => {
      const st = String(s ?? "").toLowerCase();
      return st.includes("cancel") || st.includes("refund") || st.includes("devol");
    };
    if (situacao === "concluidas") {
      list = list.filter((r) => ["paid", "delivered"].includes(String(r.order_status ?? "").toLowerCase()));
    } else if (situacao === "devolvidas") {
      list = list.filter((r) => devolvida(r.order_status));
    } else if (situacao === "ok") {
      list = list.filter((r) => classificarStatus(r) === "ok");
    } else if (situacao === "aguardando") {
      list = list.filter((r) => classificarStatus(r) === "aguardando");
    } else if (situacao === "canceladas") {
      list = list.filter((r) => classificarStatus(r) === "cancelada");
    }
    if (ordem === "retorno_asc") list.sort((a, b) => linhaPct(a) - linhaPct(b));
    else if (ordem === "retorno_desc") list.sort((a, b) => linhaPct(b) - linhaPct(a));
    else if (ordem === "bruto") list.sort((a, b) => Number(b.mp_gross ?? 0) - Number(a.mp_gross ?? 0));
    else if (ordem === "liquido") list.sort((a, b) => Number(b.mp_net ?? 0) - Number(a.mp_net ?? 0));
    else list.sort((a, b) => String(b.order_date).localeCompare(String(a.order_date)));
    return list;
  }, [rows, ordem, situacao]);

  /** Totais das colunas de saída, somados das linhas exibidas (respeitam o filtro). */
  const totais = useMemo(() => {
    const acc = {
      gross: 0, ml: 0, frete: 0, parcel: 0, cupom: 0, proc: 0, net: 0, cmv: 0, semCusto: 0, semCustoReceita: 0,
      receita: 0, comissao: 0, cobranca: 0, parcelBill: 0, freteBill: 0, outros: 0, imposto: 0, ads: 0, resultado: 0,
      completas: 0, semAliquota: 0, fallbackCount: 0, fallbackValor: 0,
    };
    for (const r of sorted) {
      acc.gross += Number(r.mp_gross ?? 0);
      acc.ml += Number(r.ml_fee ?? 0);
      acc.frete += Number(r.shipping_fee ?? 0);
      acc.parcel += Number(r.installment_fee ?? 0);
      acc.cupom += Number(r.coupon_fee ?? 0);
      acc.proc += Number(r.mp_fee ?? 0);
      acc.net += Number(r.mp_net ?? 0);
      acc.receita += Number(r.receita ?? r.mp_gross ?? 0);
      acc.comissao += Number(r.fee_comissao ?? 0);
      acc.cobranca += Number(r.fee_cobranca ?? 0);
      acc.parcelBill += Number(r.fee_parcelamento ?? 0);
      acc.freteBill += Number(r.fee_frete ?? 0);
      acc.outros += Number(r.fee_outros ?? 0);
      acc.ads += Number(r.ads_rateado ?? 0);
      if (!r.imposto_missing) acc.imposto += Number(r.imposto ?? 0);
      else acc.semAliquota += 1;
      if (!r.cmv_missing && !r.imposto_missing) {
        acc.resultado += Number(r.resultado ?? 0);
        acc.completas += 1;
      }
      if (r.cmv_missing) {
        acc.semCusto += 1;
        acc.semCustoReceita += Number(r.mp_gross ?? 0) || Number(r.order_total ?? 0);
      } else {
        acc.cmv += Number(r.cmv ?? 0);
      }
      if (r.fees_fallback) {
        acc.fallbackCount += 1;
        if (r.fee_comissao_origem === "pagamento") acc.fallbackValor += Number(r.fee_comissao ?? 0);
        if (r.fee_cobranca_origem === "pagamento") acc.fallbackValor += Number(r.fee_cobranca ?? 0);
        if (r.fee_parcelamento_origem === "pagamento") acc.fallbackValor += Number(r.fee_parcelamento ?? 0);
        if (r.fee_frete_origem === "pagamento") acc.fallbackValor += Number(r.fee_frete ?? 0);
      }
    }
    return acc;
  }, [sorted]);

  // Cards e rodapé derivam das MESMAS linhas exibidas (totais), não do summary.
  // summary continua servindo apenas para indicadores fora da tabela (ADS sem venda, faturamento pendente)
  const adsNaoAtribuido = Number(summary?.total_ads_nao_atribuido ?? 0);
  // ADS de anúncio que não vendeu no dia não é de nenhuma venda: só entra com todas as vendas (din-07).
  const adsSemVenda = situacao === "todas" ? adsNaoAtribuido : 0;
  // Sem nenhuma venda com custo e alíquota não há resultado: traço, não zero nem só o ADS negativo.
  const resultado = totais.completas > 0 ? totais.resultado - adsSemVenda : null;
  const resultadoPct = resultado !== null && totais.receita > 0 ? (resultado / totais.receita) * 100 : null;
  const conferencia = useMemo(() => {
    const calculado =
      totais.receita - totais.comissao - totais.cobranca - totais.parcelBill - totais.freteBill - totais.outros - totais.imposto - totais.cmv - totais.ads;
    return { calculado, diferenca: calculado - totais.resultado };
  }, [totais]);
  const billingPendenteCount = Number(summary?.orders_sem_billing ?? 0);
  const billingPendenteReceita = Number(div?.receita_billing_pendente ?? 0);
  const ordersCount = Number(summary?.orders_count ?? 0);
  const unmatched = Number(summary?.orders_unmatched ?? 0);
  const showPartialWarning = ordersCount > 0 && unmatched / ordersCount > 0.2;
  const loading = enabled && (summaryPending || rowsPending);
  const error = (summaryError ?? rowsError) as Error | null;


  return (
    <TooltipProvider delayDuration={200}>
      <div className="p-6 space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-primary">Conciliação</h1>
            <p className="text-sm text-muted-foreground">Venda a venda: quanto entrou, quanto foi taxa e quando o dinheiro é liberado.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-col items-end gap-1">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={atualizarAgora} disabled={atualizando}>
                <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", atualizando && "animate-spin")} />
                {atualizando ? "Atualizando…" : "Atualizar agora"}
              </Button>
              {ultimaAtualizacao ? (
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  atualizado às{" "}
                  {new Intl.DateTimeFormat("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  }).format(ultimaAtualizacao)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-1">
              <PeriodFilter
                value={period}
                onChange={(v) => { setPeriod(v); setVisible(PAGE); }}
                customRange={customRange}
                onCustomRangeChange={(r) => { setCustomRange(r); setVisible(PAGE); }}
                availableDates={availableDates}
                includeToday
              />
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {from.split("-").reverse().join("/")} a {to.split("-").reverse().join("/")} · {days} {days === 1 ? "dia" : "dias"}
              </p>
            </div>
            <Select value={account} onValueChange={(v) => { setAccount(v); setVisible(PAGE); }}>
              <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue placeholder="Conta" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as contas</SelectItem>
                {accounts?.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{displayName(a)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>

        {!hasAccounts ? (
          <EmptyState
            icon={Scale}
            title="Nenhuma conta do Mercado Livre conectada."
            description="Conecte uma conta para conciliar os pagamentos do Mercado Pago."
            action={
              <Button asChild size="sm">
                <Link to="/configuracoes" search={{ aba: "integracoes" }}>Ir para Integrações</Link>
              </Button>
            }
          />
        ) : error ? (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" /> Erro ao carregar a conciliação
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground break-words">{error.message}</CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="venda" className="space-y-4">
            <TabsList>
              <TabsTrigger value="venda">Por venda</TabsTrigger>
              <TabsTrigger value="recebimentos">Últimos recebimentos</TabsTrigger>
              <TabsTrigger value="divergencias">Divergências</TabsTrigger>
            </TabsList>
            <TabsContent value="recebimentos">
              <RecebimentosPanel
                accountIds={accountIds}
                from={from}
                to={to}
                enabled={enabled}
                nameById={nameById}
                multi={multi}
              />
            </TabsContent>
            <TabsContent value="venda" className="space-y-6">
            <div className="space-y-3">
              <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <ResumoCard
                  label="Receita"
                  value={totais.receita}
                  subtitle="cancelados fora"
                  loading={loading}
                  ajuda="Valor pago pelos compradores nas vendas exibidas, já descontando reembolsos. Pedidos cancelados não entram."
                />
                <ResumoCard
                  label="Comissão"
                  value={totais.comissao}
                  subtitle="tarifa de venda do ML"
                  saida
                  loading={loading}
                  ajuda="Comissão cobrada pelo Mercado Livre sobre cada venda. Vem do faturamento; quando ainda não lançada, usamos a retenção do pagamento."
                />
                <ResumoCard
                  label="Cobrança"
                  value={totais.cobranca}
                  subtitle="processamento do MP"
                  saida
                  loading={loading}
                  ajuda="Custo por cobrar no Mercado Pago (CVVPRC). Nunca é somado com o mp_fee do pagamento — usamos uma fonte só por venda."
                />
                <ResumoCard
                  label="Parcelamento"
                  value={totais.parcelBill}
                  subtitle="custo do parcelado"
                  saida
                  loading={loading}
                  ajuda="Custo do parcelamento assumido pelo vendedor nas vendas em mais de uma parcela."
                />
                <ResumoCard
                  label="Frete"
                  value={totais.freteBill}
                  subtitle="frete pago ao ML"
                  saida
                  loading={loading}
                  ajuda="Frete descontado pelo Mercado Livre. Quando não há lançamento no faturamento, usamos o valor retido no pagamento (provisório)."
                />
                <ResumoCard
                  label="Imposto"
                  value={totais.imposto}
                  formatado={sorted.length > 0 && totais.semAliquota === sorted.length ? "—" : undefined}
                  subtitle={totais.semAliquota > 0 ? `${formatNumber(totais.semAliquota)} venda(s) sem alíquota` : "alíquota sobre o produto"}
                  saida
                  loading={loading}
                  ajuda="Alíquota vigente aplicada sobre o valor do produto (sem frete). Vendas sem alíquota cadastrada ficam de fora."
                />
                <ResumoCard
                  label="CMV"
                  value={totais.cmv}
                  subtitle={totais.semCusto > 0 ? `${formatNumber(totais.semCusto)} venda(s) sem custo` : "custo dos produtos"}
                  saida
                  loading={loading}
                  ajuda="Custo cadastrado de cada SKU (kits somam os componentes) × quantidade vendida. Vendas sem custo ficam de fora."
                />
                <ResumoCard
                  label="Resultado"
                  value={resultado ?? 0}
                  formatado={resultado === null ? "—" : undefined}
                  subtitle={resultado === null ? "nenhuma venda com custo e alíquota" : adsSemVenda > 0 ? `inclui ${formatBRL(adsSemVenda)} de ADS sem venda` : "após tarifas, imposto, CMV e ADS"}
                  destaque
                  loading={loading}
                  ajuda={`Resultado das vendas exibidas (receita menos tarifas, imposto, CMV e ADS rateado: ${formatBRL(totais.resultado)}) menos o ADS sem venda (${formatBRL(adsNaoAtribuido)}), gasto em anúncios que não venderam no dia. Assim o ADS bate com o do Dashboard. Com um filtro de situação, o ADS sem venda fica de fora, porque não é de nenhuma venda. Vendas sem custo ou sem alíquota ficam fora; se nenhuma tem, aparece traço.`}
                />
                <ResumoCard
                  label="Resultado %"
                  value={resultadoPct ?? 0}
                  formatado={resultadoPct === null ? "—" : pct(resultadoPct)}
                  subtitle="da receita"
                  destaque
                  loading={loading}
                  ajuda="Resultado dividido pela receita das vendas exibidas. É quanto sobra de cada R$ 100 vendidos depois de tarifas, imposto, CMV e publicidade."
                />
                <Card className="bg-card border-border/70 shadow-sm">
                  <CardContent className="p-4">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      A receber
                      <InfoTip texto={`Pagamentos aprovados das vendas do período ainda retidos pelo Mercado Pago, pelas datas informadas pelo próprio MP. Já liberado: ${formatBRL(Number(caixa?.liberado ?? 0))}. Até 7 dias: ${formatBRL(Number(caixa?.ate_7d ?? 0))} · 8 a 15: ${formatBRL(Number(caixa?.de_8_a_15d ?? 0))} · 16+: ${formatBRL(Number(caixa?.mais_16d ?? 0))}.`} />
                    </span>
                    {caixaPending && enabled ? (
                      <>
                        <Skeleton className="mt-2 h-7 w-24" />
                        <Skeleton className="mt-1.5 h-3 w-28" />
                      </>
                    ) : (
                      <>
                        <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
                          {formatBRL(Number(caixa?.a_liberar ?? 0))}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                          {caixa?.proxima_data
                            ? `próxima: ${String(caixa.proxima_data).split("-").reverse().join("/")} — ${formatBRL(Number(caixa.proxima_valor ?? 0))}`
                            : "nenhuma liberação futura"}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              {!loading ? (
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
                  <span>Conferência:</span>
                  <span className="text-foreground">{formatBRL(totais.receita)}</span>
                  <span>− {formatBRL(totais.comissao, { showSign: false })} (comissão)</span>
                  <span>− {formatBRL(totais.cobranca, { showSign: false })} (cobrança)</span>
                  <span>− {formatBRL(totais.parcelBill, { showSign: false })} (parcelamento)</span>
                  <span>− {formatBRL(totais.freteBill, { showSign: false })} (frete)</span>
                  {totais.outros !== 0 ? (
                    <span>− {formatBRL(totais.outros, { showSign: false })} (outras tarifas)</span>
                  ) : null}
                  <span>− {formatBRL(totais.imposto, { showSign: false })} (imposto)</span>
                  <span>− {formatBRL(totais.cmv, { showSign: false })} (CMV)</span>
                  <span>− {formatBRL(totais.ads, { showSign: false })} (ADS)</span>
                  <span>= <span className="font-medium text-foreground">{formatBRL(conferencia.calculado)}</span></span>
                  {Math.abs(conferencia.diferenca) > 0.01 ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help font-medium text-amber-500">
                          diferença de {formatBRL(conferencia.diferenca, { showSign: true })} para o resultado das vendas ({formatBRL(totais.resultado)})
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[280px] text-xs leading-snug">
                        A soma dos componentes não fecha com o resultado somado das linhas. Em geral acontece porque vendas sem custo de SKU ou sem alíquota ficam fora do resultado, mas continuam somando receita e tarifas.
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="text-emerald-500">confere</span>
                  )}
                  {adsSemVenda > 0 && resultado !== null ? (
                    <>
                      <span>· Resultado das vendas {formatBRL(totais.resultado)}</span>
                      <span>− {formatBRL(adsSemVenda, { showSign: false })} (ADS sem venda)</span>
                      <span>= <span className="font-medium text-foreground">{formatBRL(resultado)}</span> (resultado)</span>
                    </>
                  ) : null}
                </p>
              ) : null}

              {!loading && totais.fallbackCount > 0 ? (
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {formatNumber(totais.fallbackCount)} {totais.fallbackCount === 1 ? "venda com tarifa ainda não faturada" : "vendas com tarifa ainda não faturada"}
                  {" "}({formatBRL(totais.fallbackValor, { showSign: false })} no total) — valores marcados com <span className="text-muted-foreground">*</span> vêm do pagamento do Mercado Pago e podem mudar quando o Mercado Livre lançar no faturamento.
                </p>
              ) : null}

              {totais.semCusto > 0 || billingPendenteCount > 0 || showPartialWarning ? (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {totais.semCusto > 0 ? (
                    <span>
                      <span className="font-medium text-amber-500">
                        {formatNumber(totais.semCusto)} {totais.semCusto === 1 ? "venda sem custo cadastrado" : "vendas sem custo cadastrado"}
                        {" "}({formatBRL(totais.semCustoReceita, { showSign: false })} de receita)
                      </span>
                      {" — ficaram fora do CMV. "}
                      <Link to="/custos" className="text-primary hover:underline">Preencher custos</Link>
                    </span>
                  ) : null}
                  {totais.semCusto > 0 && (billingPendenteCount > 0 || showPartialWarning) ? <span aria-hidden>·</span> : null}
                  {billingPendenteCount > 0 ? (
                    <span>
                      <span className="font-medium">
                        {formatNumber(billingPendenteCount)} venda(s) com faturamento pendente
                        {" "}({formatBRL(billingPendenteReceita)} de receita)
                      </span>
                      {" — a margem delas vai cair quando a tarifa chegar."}
                    </span>
                  ) : null}
                  {billingPendenteCount > 0 && showPartialWarning ? <span aria-hidden>·</span> : null}
                  {showPartialWarning ? (
                    <span>Sincronização do Mercado Pago em andamento — alguns pedidos podem aparecer sem pagamento até completar.</span>
                  ) : null}
                </p>
              ) : null}
            </div>



            <Card className="bg-card border-border/70 shadow-sm">
              <CardHeader className="flex flex-wrap items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm">Conciliação por venda</CardTitle>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Ordenar por:</span>
                    <Select value={ordem} onValueChange={(v) => { setOrdem(v as typeof ordem); setVisible(PAGE); }}>
                      <SelectTrigger className="h-8 w-[210px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="recentes">Mais recentes</SelectItem>
                        <SelectItem value="retorno_asc">Retorno líquido (menor)</SelectItem>
                        <SelectItem value="retorno_desc">Retorno líquido (maior)</SelectItem>
                        <SelectItem value="bruto">Bruto pago (maior)</SelectItem>
                        <SelectItem value="liquido">Líquido recebido (maior)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Situação:</span>
                    <Select value={situacao} onValueChange={(v) => { setSituacao(v as typeof situacao); setVisible(PAGE); }}>
                      <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todas">Todas</SelectItem>
                        <SelectItem value="ok">Conciliadas (ok)</SelectItem>
                        <SelectItem value="aguardando">Aguardando pagamento</SelectItem>
                        <SelectItem value="concluidas">Concluídas</SelectItem>
                        <SelectItem value="devolvidas">Devolvidas</SelectItem>
                        
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-0">
                {loading ? (
                  <div className="space-y-2 px-6">
                    {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                  </div>
                ) : sorted.length === 0 ? (
                  <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                    {situacao === "todas" ? "Nenhum pedido no período." : "Nenhum pedido nessa situação no período."}
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8" />
                            <TableHead className="whitespace-nowrap">Data</TableHead>
                            {multi ? <TableHead className="whitespace-nowrap">Conta</TableHead> : null}
                            <TableHead className="whitespace-nowrap">Pedido</TableHead>
                            <TableHead>Produto</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Receita</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Comissão</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Cobrança</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Parcelamento</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Frete</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Imposto</TableHead>

                            <TableHead className="text-right whitespace-nowrap">CMV</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Resultado</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Resultado %</TableHead>
                            <TableHead className="whitespace-nowrap">Liberação</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sorted.slice(0, visible).map((r, i) => {
                            const semPagamento = r.match_status !== "ok";
                            const rowKey = `${r.order_id}-${i}`;
                            const isOpen = !!expanded[rowKey];
                            const st = classificarStatus(r);
                            const stLabel =
                              st === "ok" ? "Conciliada" :
                              st === "aguardando" ? "Aguardando pagamento" :
                              st === "cancelada" ? "Cancelada" : "Sem pagamento no MP";
                            const stTooltip =
                              st === "aguardando" ? "O pagamento no Mercado Pago costuma aparecer algumas horas após a venda." :
                              st === "cancelada" ? "Pedido cancelado — fora dos cálculos de receita e resultado." :
                              st === "sem_pagamento" ? "Venda sem pagamento correspondente no Mercado Pago. Pode ter sido paga fora do MP ou precisa de verificação." : "";
                            const tarifas = Number(r.fee_comissao ?? 0) + Number(r.fee_cobranca ?? 0) + Number(r.fee_parcelamento ?? 0) + Number(r.fee_frete ?? 0);
                            const semTarifa = !!r.fees_billing_missing && tarifas === 0;
                            const colSpan = multi ? 15 : 14;

                            return (
                              <Fragment key={rowKey}>
                                <TableRow
                                  className="cursor-pointer"
                                  onClick={() => toggleExpand(rowKey)}
                                >
                                  <TableCell className="w-8 pr-0">
                                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap tabular-nums text-xs">
                                    {(() => {
                                      const { data, hora } = fmtDateTime(r.order_date);
                                      return (
                                        <div className="flex flex-col leading-tight">
                                          <span>{data}</span>
                                          {hora ? <span className="text-[11px] text-muted-foreground">{hora}</span> : null}
                                        </div>
                                      );
                                    })()}
                                  </TableCell>
                                  {multi ? (
                                    <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">
                                      {nameById.get(r.account_id) ?? "—"}
                                    </TableCell>
                                  ) : null}
                                  <TableCell className="whitespace-nowrap tabular-nums text-xs">
                                    <span className="inline-flex items-center gap-1">
                                      <a
                                        href={`https://www.mercadolivre.com.br/vendas/${r.order_id}/detalhe`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline cursor-pointer"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {String(r.order_id)}
                                      </a>
                                      {st !== "ok" ? (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span
                                              className={cn(
                                                "inline-block h-1.5 w-1.5 rounded-full cursor-help",
                                                st === "aguardando" ? "bg-amber-500" : st === "cancelada" ? "bg-muted-foreground" : "bg-destructive",
                                              )}
                                            />
                                          </TooltipTrigger>
                                          <TooltipContent className="max-w-[240px] text-xs leading-snug">{stLabel}{stTooltip ? ` — ${stTooltip}` : ""}</TooltipContent>
                                        </Tooltip>
                                      ) : null}
                                      {r.has_rejected ? (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span className="text-amber-500"><AlertTriangle className="h-3 w-3" /></span>
                                          </TooltipTrigger>
                                          <TooltipContent className="text-xs">Houve tentativa de pagamento recusada neste pedido</TooltipContent>
                                        </Tooltip>
                                      ) : null}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    <div className="max-w-[240px] truncate">{truncar(r.title)}</div>
                                    <div className="text-[11px] text-muted-foreground">{r.sku || "sem SKU"}</div>
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums text-xs">
                                    {formatBRL(Number(r.receita ?? r.mp_gross ?? 0))}
                                    {Number(r.refunded_amount ?? 0) > 0 ? (
                                      <div className="text-[10px] text-amber-500">reembolso {formatBRL(-Number(r.refunded_amount ?? 0))}</div>
                                    ) : null}
                                  </TableCell>
                                  <FeeCell valor={Number(r.fee_comissao ?? 0)} origem={r.fee_comissao_origem} pendente={semTarifa} />
                                  <FeeCell valor={Number(r.fee_cobranca ?? 0)} origem={r.fee_cobranca_origem} pendente={semTarifa} />
                                  <FeeCell valor={Number(r.fee_parcelamento ?? 0)} origem={r.fee_parcelamento_origem} pendente={semTarifa} />
                                  <FeeCell valor={Number(r.fee_frete ?? 0)} origem={r.fee_frete_origem} pendente={semTarifa} />


                                  <TableCell className="text-right tabular-nums text-xs">
                                    {r.imposto_missing ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="inline-flex cursor-help items-center gap-1 text-amber-500">
                                            <AlertTriangle className="h-3 w-3" /> sem alíquota
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-[240px] text-xs leading-snug">
                                          Nenhuma alíquota vigente cadastrada para a data desta venda. O imposto não foi calculado — não é zero.
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      formatBRL(-Number(r.imposto ?? 0))
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums text-xs">
                                    {r.cmv_missing ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="inline-flex cursor-help items-center gap-1 text-amber-500">
                                            <AlertTriangle className="h-3 w-3" /> sem custo
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-[240px] text-xs leading-snug">
                                          O SKU desta venda não tem custo cadastrado em Produtos / SKUs, então não entra no CMV.
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      formatBRL(-Number(r.cmv ?? 0))
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums text-xs font-semibold">
                                    {r.cmv_missing || r.imposto_missing ? (
                                      <span className="text-muted-foreground">—</span>
                                    ) : (
                                      formatBRL(Number(r.resultado ?? 0))
                                    )}
                                  </TableCell>
                                  <TableCell className={cn("text-right tabular-nums text-xs font-medium", semPagamento || r.cmv_missing || r.imposto_missing ? "text-muted-foreground" : pctClass(Number(r.resultado_pct ?? 0)))}>
                                    {semPagamento || r.cmv_missing || r.imposto_missing ? "—" : pct(Number(r.resultado_pct ?? 0))}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap text-xs tabular-nums">
                                    {semPagamento ? (
                                      <span className="text-muted-foreground">—</span>
                                    ) : r.release_status === "released" ? (
                                      <span className="text-emerald-500">liberado</span>
                                    ) : r.release_date ? (
                                      <span className="text-amber-500">em {fmtDateTime(r.release_date).data}</span>
                                    ) : (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </TableCell>
                                </TableRow>
                                {isOpen ? (
                                  <TableRow key={`${rowKey}-det`} className="bg-muted/30 hover:bg-muted/30">
                                    <TableCell colSpan={colSpan} className="py-3">
                                      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-2 text-xs">
                                        <span className="text-muted-foreground">Taxa split do MP: <span className="font-medium tabular-nums text-foreground">{formatBRL(-Number(r.split_fee ?? 0))}</span></span>
                                        {Number(r.coupon_fee ?? 0) > 0 ? (
                                          <>
                                            <span className="text-muted-foreground">Pago pelo comprador: <span className="font-medium tabular-nums text-foreground">{formatBRL(Number(r.mp_paid_by_buyer ?? 0))}</span></span>
                                            <span className="text-muted-foreground">Cupom: <span className="font-medium tabular-nums text-foreground">{formatBRL(Number(r.coupon_fee ?? 0))}</span></span>
                                            {Number(r.receita ?? 0) > Number(r.mp_paid_by_buyer ?? 0) + 0.01 ? (
                                              <span className="text-muted-foreground">Cupom bancado pelo Mercado Livre — sua receita considera o valor cheio da venda.</span>
                                            ) : (
                                              <span className="text-muted-foreground">Cupom bancado pelo vendedor — sua receita considera o valor pago pelo comprador.</span>
                                            )}
                                          </>
                                        ) : null}
                                        <span className="text-muted-foreground">ADS rateado: <span className="font-medium tabular-nums text-foreground">{formatBRL(-Number(r.ads_rateado ?? 0))}</span>{r.ads_parcial ? <span className="ml-1 text-amber-500">provisório</span> : null}</span>
                                        {Number(r.fee_outros ?? 0) !== 0 ? (
                                          <span className="text-muted-foreground">Outras tarifas: <span className="font-medium tabular-nums text-foreground">{formatBRL(-Number(r.fee_outros ?? 0))}</span></span>
                                        ) : null}
                                        <span className="text-muted-foreground">Líquido MP: <span className="font-medium tabular-nums text-foreground">{semPagamento ? "—" : formatBRL(Number(r.mp_net ?? 0))}</span></span>
                                        <span className="text-muted-foreground">Status: <span className="font-medium text-foreground">{stLabel}</span></span>
                                        <span className="text-muted-foreground">Pagamentos: <span className="font-medium tabular-nums text-foreground">{formatNumber(Number(r.payment_count ?? 0))}</span></span>
                                      </div>

                                    </TableCell>
                                  </TableRow>
                                ) : null}
                              </Fragment>
                            );
                          })}
                        </TableBody>
                        <TableBody>
                          <TableRow className="border-t-2 border-border font-semibold hover:bg-transparent">
                            <TableCell />
                            <TableCell className="whitespace-nowrap text-xs">Total</TableCell>
                            {multi ? <TableCell /> : null}
                            <TableCell />
                            <TableCell className="text-xs text-muted-foreground">{formatNumber(sorted.length)} vendas</TableCell>
                            <TableCell className="text-right tabular-nums text-xs">{formatBRL(totais.receita)}</TableCell>
                            <TableCell className="text-right tabular-nums text-xs">{formatBRL(-totais.comissao)}</TableCell>
                            <TableCell className="text-right tabular-nums text-xs">{formatBRL(-totais.cobranca)}</TableCell>
                            <TableCell className="text-right tabular-nums text-xs">{formatBRL(-totais.parcelBill)}</TableCell>
                            <TableCell className="text-right tabular-nums text-xs">{formatBRL(-totais.freteBill)}</TableCell>

                            <TableCell className="text-right tabular-nums text-xs">{formatBRL(-totais.imposto)}</TableCell>
                            <TableCell className="text-right tabular-nums text-xs">{formatBRL(-totais.cmv)}</TableCell>
                            <TableCell className="text-right tabular-nums text-xs">{formatBRL(totais.resultado)}</TableCell>
                            <TableCell className={cn("text-right tabular-nums text-xs", pctClass(totais.receita > 0 ? (totais.resultado / totais.receita) * 100 : 0))}>
                              {totais.receita > 0 ? pct((totais.resultado / totais.receita) * 100) : "—"}
                            </TableCell>
                            <TableCell />
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                    {sorted.length > visible ? (
                      <div className="flex justify-center px-6 pt-3">
                        <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + PAGE)}>
                          Carregar mais ({formatNumber(sorted.length - visible)} restantes)
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>
            </TabsContent>
            <TabsContent value="divergencias" className="space-y-4">
              <Card className="bg-card border-border/70 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">O que não entra nas vendas do período</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {divPending ? (
                    <Skeleton className="h-24 w-full" />
                  ) : !div ? (
                    <p className="text-xs text-muted-foreground">
                      Sem dados de faturamento no período. Use “Atualizar agora” para trazer os lançamentos do Mercado Livre.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <ResumoCard
                        label="Tarifas de pedidos cancelados"
                        value={Number(div.tarifas_canceladas ?? 0)}
                        subtitle={`${formatNumber(Number(div.pedidos_cancelados ?? 0))} pedidos · ${formatBRL(Number(div.receita_cancelada ?? 0))} cancelados`}
                        saida
                        ajuda="O Mercado Livre cobrou estas tarifas em pedidos cancelados. Como o pedido está fora da tela, elas não entram no custo das vendas — mas existem no seu extrato."
                      />
                      <ResumoCard
                        label="Tarifas sem venda correspondente"
                        value={Number(div.tarifas_sem_venda ?? 0)}
                        subtitle={`${formatNumber(Number(div.order_ids_sem_venda ?? 0))} pedidos fora da base`}
                        saida
                        ajuda="Lançamentos de faturamento cujo pedido não está sincronizado (o faturamento cobre um período maior que os pedidos importados). Como o recorte é por data da venda, ficam de fora do cálculo."
                      />
                      <ResumoCard
                        label="Vendas sem custo de SKU"
                        value={Number(div.vendas_sem_custo ?? 0)}
                        formatado={formatNumber(Number(div.vendas_sem_custo ?? 0))}
                        subtitle={`${formatBRL(Number(div.receita_sem_custo ?? 0))} de receita sem CMV`}
                        ajuda="Vendas cujo SKU não tem custo cadastrado. Elas ficam fora do CMV e do resultado."
                      />
                      <ResumoCard
                        label="Faturamento pendente"
                        value={Number(div.vendas_billing_pendente ?? 0)}
                        formatado={formatNumber(Number(div.vendas_billing_pendente ?? 0))}
                        subtitle={`${formatBRL(Number(div.receita_billing_pendente ?? 0))} de receita sem tarifa lançada`}
                        ajuda="Vendas recentes cujo ciclo de faturamento do Mercado Livre ainda não fechou. Aparecem com margem alta porque a tarifa ainda não chegou."
                      />
                    </div>
                  )}
                  {div ? (
                    <p className="text-[11px] text-muted-foreground">
                      Conferência: tarifas calculadas pelo sistema {formatBRL(Number(div.sistema_tarifas ?? 0))} · retido pelo Mercado Pago{" "}
                      {formatBRL(Number(div.ml_retido ?? 0))} · diferença{" "}
                      <span className={cn("font-medium tabular-nums", Math.abs(Number(div.diff_tarifas ?? 0)) > 1 ? "text-amber-500" : "text-muted-foreground")}>
                        {formatBRL(Number(div.diff_tarifas ?? 0), { showSign: true })}
                      </span>
                      . A diferença costuma ser faturamento ainda não fechado.
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              {(tarifasCanceladas?.length ?? 0) > 0 ? (
                <Card className="bg-card border-border/70 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Tarifas cobradas em pedidos cancelados</CardTitle>
                  </CardHeader>
                  <CardContent className="px-0">
                    <div className="max-h-[360px] overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="whitespace-nowrap">Data</TableHead>
                            <TableHead className="whitespace-nowrap">Pedido</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Valor do pedido</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Tarifas cobradas</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(tarifasCanceladas ?? []).map((t) => (
                            <TableRow key={String(t.order_id)}>
                              <TableCell className="whitespace-nowrap text-xs tabular-nums">{fmtDateTime(t.order_date).data}</TableCell>
                              <TableCell className="whitespace-nowrap text-xs tabular-nums">{String(t.order_id)}</TableCell>
                              <TableCell className="text-right text-xs tabular-nums">{formatBRL(Number(t.order_total ?? 0))}</TableCell>
                              <TableCell className="text-right text-xs tabular-nums text-destructive">{formatBRL(Number(t.tarifas ?? 0))}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              <DivergenciasPanel
                accountIds={accountIds}
                from={from}
                to={to}
                enabled={enabled}
                nameById={nameById}
                multi={multi}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </TooltipProvider>
  );
}
