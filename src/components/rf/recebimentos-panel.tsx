import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, AlertTriangle, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBRL, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ErroCarregar } from "@/components/rf/erro-carregar";
import { PagamentosPresos } from "@/components/rf/pagamentos-presos";
import { todasAsPaginas } from "@/lib/paginas";

type Props = {
  accountIds: string[];
  from: string;
  to: string;
  enabled: boolean;
  nameById: Map<string, string>;
  multi: boolean;
};

const PAGE = 50;

const fmtData = (v: string | null | undefined) => {
  if (!v) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit" }).format(d);
};

const metodo = (m: string | null | undefined, tipo: string | null | undefined) => {
  const map: Record<string, string> = {
    master: "Mastercard", visa: "Visa", elo: "Elo", amex: "Amex", hipercard: "Hipercard",
    pix: "Pix", account_money: "Saldo em conta", bolbradesco: "Boleto", debmaster: "Débito Master", debvisa: "Débito Visa",
  };
  return map[String(m ?? "")] ?? (m || tipo || "—");
};

export function RecebimentosPanel({ accountIds, from, to, enabled, nameById, multi }: Props) {
  const [visible, setVisible] = useState(PAGE);
  const [filtro, setFiltro] = useState<"todos" | "liberado" | "a_liberar" | "estorno">("todos");
  const [aberta, setAberta] = useState<string | null>(null);

  // Passa de 1.000 pagamentos em 2 meses: lê todas as páginas (din-12), na mesma ordem da
  // função mais conta e pagamento, que não se repetem e não deixam linha cair entre páginas.
  const { data: rows, isPending, error: erroLista, refetch: refazerLista } = useQuery({
    queryKey: ["conc-recebimentos", from, to, accountIds.join(",")],
    enabled,
    queryFn: () =>
      todasAsPaginas((de, ate) =>
        supabase
          .rpc("conc_recebimentos", { _account_ids: accountIds, _from: from, _to: to })
          .order("release_date", { ascending: false, nullsFirst: false })
          .order("date_approved", { ascending: false, nullsFirst: false })
          .order("account_id")
          .order("payment_id")
          .range(de, ate),
      ),
  });

  const { data: resumo, isPending: resumoPending, error: erroResumo, refetch: refazerResumo } = useQuery({
    queryKey: ["conc-recebimentos-resumo", from, to, accountIds.join(",")],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("conc_recebimentos_resumo", { _account_ids: accountIds, _from: from, _to: to });
      if (error) throw error;
      return (data ?? [])[0] ?? null;
    },
  });

  const lista = useMemo(() => {
    const all = rows ?? [];
    if (filtro === "liberado") return all.filter((r) => r.status === "approved" && r.money_release_status === "released");
    if (filtro === "a_liberar") return all.filter((r) => r.status === "approved" && r.money_release_status !== "released");
    if (filtro === "estorno") return all.filter((r) => r.status === "refunded");
    return all;
  }, [rows, filtro]);

  const loading = enabled && (isPending || resumoPending);

  const Card4 = ({ label, valor, sub, tone }: { label: string; valor: number; sub: string; tone?: "ok" | "wait" | "out" }) => (
    <Card className="bg-card border-border/70 shadow-sm">
      <CardContent className="p-4">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        {loading ? (
          <Skeleton className="mt-2 h-7 w-28" />
        ) : (
          <div
            className={cn(
              "mt-2 text-2xl font-semibold tabular-nums tracking-tight",
              tone === "wait" && "text-amber-500",
              tone === "out" && "text-destructive",
            )}
          >
            {formatBRL(valor)}
          </div>
        )}
        <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );

  if ((erroLista && !rows) || (erroResumo && resumo === undefined)) {
    return (
      <ErroCarregar
        oque="Os recebimentos"
        onRetry={() => {
          void refazerLista();
          void refazerResumo();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Esta visão é de <strong className="text-foreground">caixa</strong>: o eixo é a data em que o dinheiro foi liberado pelo
          Mercado Pago, não a data da venda. As tarifas mostradas aqui explicam a composição do valor líquido de cada pagamento e
          não entram no cálculo de margem por venda (que usa o faturamento do Mercado Livre).
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card4
          label="Já liberado"
          valor={Number(resumo?.liberado ?? 0)}
          sub={`${formatNumber(Number(resumo?.liberado_qtd ?? 0))} pagamentos${resumo?.ultima_data ? ` · último em ${fmtData(String(resumo.ultima_data))}` : ""}`}
          tone="ok"
        />
        <Card4
          label="A liberar"
          valor={Number(resumo?.a_liberar ?? 0)}
          sub={`${formatNumber(Number(resumo?.a_liberar_qtd ?? 0))} pagamentos${resumo?.proxima_data ? ` · próximo em ${fmtData(String(resumo.proxima_data))}` : ""}`}
          tone="wait"
        />
        <Card4
          label="Estornado"
          valor={Number(resumo?.estornado ?? 0)}
          sub={`${formatNumber(Number(resumo?.estornado_qtd ?? 0))} estornos — saída de dinheiro`}
          tone="out"
        />
        <Card4
          label="Líquido do período"
          valor={Number(resumo?.liquido ?? 0)}
          sub={`bruto ${formatBRL(Number(resumo?.bruto ?? 0))} · tarifas ${formatBRL(-Number(resumo?.tarifas ?? 0))}`}
        />
      </div>

      <PagamentosPresos accountIds={accountIds} />

      {Number(resumo?.sem_data_qtd ?? 0) > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="font-medium text-amber-500">
            {formatNumber(Number(resumo?.sem_data_qtd ?? 0))} pagamento(s) sem data de liberação informada
            {" "}({formatBRL(Number(resumo?.sem_data ?? 0))})
          </span>
          <span className="text-muted-foreground">aparecem no fim da lista, com a data da aprovação como referência.</span>
        </div>
      ) : null}

      <Card className="bg-card border-border/70 shadow-sm">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm">Últimos recebimentos</CardTitle>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Mostrar:</span>
            <Select value={filtro} onValueChange={(v) => { setFiltro(v as typeof filtro); setVisible(PAGE); }}>
              <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Tudo</SelectItem>
                <SelectItem value="liberado">Já liberado</SelectItem>
                <SelectItem value="a_liberar">A liberar</SelectItem>
                <SelectItem value="estorno">Somente estornos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 px-6">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : lista.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              Nenhum pagamento do Mercado Pago liberado neste período. Amplie o período no filtro acima ou use “Atualizar agora”
              para trazer os pagamentos mais recentes.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead className="whitespace-nowrap">Liberação</TableHead>
                      {multi ? <TableHead className="whitespace-nowrap">Conta</TableHead> : null}
                      <TableHead className="whitespace-nowrap">Pedido</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Bruto</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Tarifas MP</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Líquido</TableHead>
                      <TableHead className="whitespace-nowrap">Pagamento</TableHead>
                      <TableHead className="whitespace-nowrap">Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lista.slice(0, visible).map((r) => {
                      const key = String(r.payment_id);
                      const estorno = r.status === "refunded";
                      const liberado = r.money_release_status === "released";
                      const aberto = aberta === key;
                      return (
                        <>
                          <TableRow
                            key={key}
                            className={cn("cursor-pointer", estorno && "bg-destructive/5")}
                            onClick={() => setAberta(aberto ? null : key)}
                          >
                            <TableCell className="text-muted-foreground">
                              {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs tabular-nums">
                              {r.sem_data ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex cursor-help items-center gap-1 text-amber-500">
                                      <AlertTriangle className="h-3 w-3" /> sem data
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[240px] text-xs leading-snug">
                                    O Mercado Pago não informou a data de liberação deste pagamento. Aprovado em {fmtData(r.date_approved)}.
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                fmtData(r.release_date)
                              )}
                            </TableCell>
                            {multi ? (
                              <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">
                                {nameById.get(r.account_id) ?? "—"}
                              </TableCell>
                            ) : null}
                            <TableCell className="whitespace-nowrap text-xs tabular-nums">
                              {r.order_id ? (
                                <a
                                  href={`https://www.mercadolivre.com.br/vendas/${r.order_id}/detalhe`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {String(r.order_id)}
                                </a>
                              ) : (
                                <span className="text-muted-foreground">sem pedido</span>
                              )}
                              {Number(r.pagamentos_do_pedido ?? 1) > 1 ? (
                                <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                                  {formatNumber(Number(r.pagamentos_do_pedido))} pagtos
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="max-w-[240px] truncate">
                                {estorno ? <span className="mr-1 text-destructive">Estorno de:</span> : null}
                                {r.title || (r.order_id ? "venda fora do período sincronizado" : "—")}
                              </div>
                              <div className="text-[11px] text-muted-foreground">{r.sku || "sem SKU"}</div>
                            </TableCell>
                            <TableCell className={cn("text-right text-xs tabular-nums", estorno && "text-destructive")}>
                              {formatBRL(Number(r.bruto ?? 0))}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                              {formatBRL(estorno ? Number(r.fee_total ?? 0) : -Number(r.fee_total ?? 0))}
                            </TableCell>
                            <TableCell className={cn("text-right text-xs font-semibold tabular-nums", estorno && "text-destructive")}>
                              {formatBRL(Number(r.liquido ?? 0))}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {metodo(r.payment_method_id, r.payment_type_id)}
                              {Number(r.installments ?? 1) > 1 ? (
                                <span className="text-muted-foreground"> · {r.installments}x</span>
                              ) : null}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {estorno ? (
                                <span className="inline-flex rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] text-destructive">Estorno</span>
                              ) : liberado ? (
                                <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-500">Liberado</span>
                              ) : (
                                <span className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-500">A liberar</span>
                              )}
                            </TableCell>
                          </TableRow>
                          {aberto ? (
                            <TableRow key={`${key}-det`} className="bg-muted/30 hover:bg-muted/30">
                              <TableCell />
                              <TableCell colSpan={multi ? 9 : 8} className="text-xs">
                                <div className="grid grid-cols-2 gap-x-6 gap-y-1 py-1 sm:grid-cols-4">
                                  <div><span className="text-muted-foreground">Pagamento nº</span> <span className="tabular-nums">{String(r.payment_id)}</span></div>
                                  <div><span className="text-muted-foreground">Aprovado em</span> <span className="tabular-nums">{fmtData(r.date_approved)}</span></div>
                                  <div><span className="text-muted-foreground">Data da venda</span> <span className="tabular-nums">{fmtData(r.order_date)}</span></div>
                                  <div><span className="text-muted-foreground">Valor do pedido</span> <span className="tabular-nums">{r.order_total != null ? formatBRL(Number(r.order_total)) : "—"}</span></div>
                                  <div><span className="text-muted-foreground">Comissão ML</span> <span className="tabular-nums">{formatBRL(-Number(r.ml_fee ?? 0))}</span></div>
                                  <div><span className="text-muted-foreground">Taxa MP</span> <span className="tabular-nums">{formatBRL(-Number(r.mp_fee ?? 0))}</span></div>
                                  <div><span className="text-muted-foreground">Parcelamento</span> <span className="tabular-nums">{formatBRL(-Number(r.installment_fee ?? 0))}</span></div>
                                  <div><span className="text-muted-foreground">Frete</span> <span className="tabular-nums">{formatBRL(-Number(r.shipping_fee ?? 0))}</span></div>
                                  <div><span className="text-muted-foreground">Itens do pedido</span> <span className="tabular-nums">{formatNumber(Number(r.itens ?? 0))}</span></div>
                                  <div><span className="text-muted-foreground">Status do pedido</span> {r.order_status ?? "—"}</div>
                                </div>
                                <p className="pt-1 text-[11px] text-muted-foreground">
                                  Estas tarifas são a composição do líquido deste pagamento no Mercado Pago. O custo da venda na visão
                                  “Por venda” vem do faturamento do Mercado Livre — não é a soma destas linhas.
                                </p>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {lista.length > visible ? (
                <div className="flex justify-center px-6 pt-3">
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => setVisible((v) => v + PAGE)}>
                    Ver mais ({formatNumber(lista.length - visible)} restantes)
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
