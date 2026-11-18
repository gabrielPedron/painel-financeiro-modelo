import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatBRL, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type Divergencia = {
  account_id: string;
  order_id: number | string;
  order_date: string | null;
  tipo: string;
  descricao: string | null;
  valor_divergencia: number | null;
  detalhe: Record<string, unknown> | null;
};

const ROTULOS: Record<string, string> = {
  comissao_duplicada: "Comissão cobrada a maior",
  frete_acima_billing: "Frete acima do faturado",
  liquido_menor_que_esperado: "Líquido menor que o esperado",
  estorno_nao_devolvido: "Estorno não devolvido",
  cobranca_sem_venda: "Cobrança sem venda",
};

const CORES: Record<string, string> = {
  comissao_duplicada: "bg-destructive/15 text-destructive",
  frete_acima_billing: "bg-amber-500/15 text-amber-500",
  liquido_menor_que_esperado: "bg-primary/15 text-primary",
  estorno_nao_devolvido: "bg-purple-500/15 text-purple-400",
  cobranca_sem_venda: "bg-rose-500/15 text-rose-400",
};

const rotulo = (t: string) => ROTULOS[t] ?? t;

const DETALHE_LABELS: Record<string, string> = {
  unidades: "Unidades",
  ml_commission: "Comissão dos itens do pedido",
  mp_ml_fee: "Comissão cobrada pelo Mercado Pago",
  diferenca: "Diferença",
  shipping_fee: "Frete cobrado no pagamento",
  billing_shipping: "Frete faturado",
  mp_gross: "Valor bruto do pagamento",
  mp_net: "Valor líquido recebido",
  esperado: "Valor esperado",
  fee_total: "Total de taxas",
  status: "Situação",
  order_status: "Situação do pedido",
  refunded: "Valor estornado",
  payment_id: "Pagamento",
};

const detalheLabel = (k: string) =>
  DETALHE_LABELS[k] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function detalheValor(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return formatBRL(v, { showSign: false });
  if (typeof v === "boolean") return v ? "sim" : "não";
  const n = Number(v);
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(n) && /^-?\d+([.,]\d+)?$/.test(v.trim())) {
    return formatBRL(n, { showSign: false });
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const fmtData = (v: string | null | undefined) => {
  if (!v) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
};

function montarTexto(d: Divergencia): string {
  const linhas = Object.entries(d.detalhe ?? {}).map(([k, v]) => `- ${detalheLabel(k)}: ${detalheValor(v)}`);
  return [
    `Assunto: Contestação de cobrança - Pedido ${d.order_id}`,
    "",
    "Prezados,",
    "",
    `Identifiquei uma possível cobrança indevida no pedido ${d.order_id}, realizado em ${fmtData(d.order_date)}.`,
    "",
    d.descricao ?? rotulo(d.tipo),
    "",
    ...(linhas.length ? ["Detalhamento:", ...linhas, ""] : []),
    `Solicito a revisão e o estorno do valor de ${formatBRL(Number(d.valor_divergencia ?? 0), { showSign: false })}.`,
    "",
    "Atenciosamente.",
  ].join("\n");
}

export function DivergenciasPanel({
  accountIds,
  from,
  to,
  enabled,
  nameById,
  multi,
}: {
  accountIds: string[];
  from: string;
  to: string;
  enabled: boolean;
  nameById: Map<string, string>;
  multi: boolean;
}) {
  const [chamado, setChamado] = useState<Divergencia | null>(null);

  const { data: resumo, isPending: resumoPending, error: resumoError } = useQuery({
    queryKey: ["mp-divergencias-resumo", from, to, accountIds.join(",")],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("mp_divergencias_resumo", { _account_ids: accountIds, _from: from, _to: to });
      if (error) throw error;
      return (data ?? []) as { tipo: string; quantidade: number; valor_total: number }[];
    },
  });

  const { data: linhas, isPending: linhasPending, error: linhasError } = useQuery({
    queryKey: ["mp-divergencias", from, to, accountIds.join(",")],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("mp_divergencias", { _account_ids: accountIds, _from: from, _to: to });
      if (error) throw error;
      return (data ?? []) as unknown as Divergencia[];
    },
  });

  const ordenadas = useMemo(
    () => [...(linhas ?? [])].sort((a, b) => Number(b.valor_divergencia ?? 0) - Number(a.valor_divergencia ?? 0)),
    [linhas],
  );

  const comQtd = (resumo ?? []).filter((r) => Number(r.quantidade) > 0);
  const totalValor = comQtd.reduce((s, r) => s + Number(r.valor_total ?? 0), 0);
  const totalQtd = comQtd.reduce((s, r) => s + Number(r.quantidade ?? 0), 0);

  const loading = enabled && (resumoPending || linhasPending);
  const error = (resumoError ?? linhasError) as Error | null;

  const copiar = async () => {
    if (!chamado) return;
    try {
      await navigator.clipboard.writeText(montarTexto(chamado));
      toast.success("Texto copiado");
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
    }
  };

  if (error) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> Erro ao carregar as divergências
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground break-words">{error.message}</CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (totalQtd === 0 && ordenadas.length === 0) {
    return (
      <Card className="border-emerald-500/40 bg-emerald-500/5">
        <CardContent className="flex items-center gap-3 p-6">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          <p className="text-sm text-foreground">Nenhuma cobrança indevida detectada no período. ✓</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-primary/60 bg-primary/5">
        <CardContent className="p-4">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Potencialmente recuperável</span>
          <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
            {formatBRL(totalValor, { showSign: false })}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            em {formatNumber(totalQtd)} {totalQtd === 1 ? "ocorrência" : "ocorrências"}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {comQtd.map((r) => (
          <Card key={r.tipo} className="bg-card border-border/70 shadow-sm">
            <CardContent className="p-4">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{rotulo(r.tipo)}</span>
              <div className="mt-2 text-xl font-semibold tabular-nums tracking-tight text-destructive">
                {formatBRL(Number(r.valor_total ?? 0), { showSign: false })}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {formatNumber(Number(r.quantidade))} {Number(r.quantidade) === 1 ? "ocorrência" : "ocorrências"}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-card border-border/70 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Cobranças a contestar</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {ordenadas.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">Nenhuma divergência no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Data</TableHead>
                    {multi ? <TableHead className="whitespace-nowrap">Conta</TableHead> : null}
                    <TableHead className="whitespace-nowrap">Pedido</TableHead>
                    <TableHead className="whitespace-nowrap">Tipo</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Valor</TableHead>
                    <TableHead className="whitespace-nowrap">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordenadas.map((d, i) => (
                    <TableRow key={`${d.order_id}-${d.tipo}-${i}`}>
                      <TableCell className="whitespace-nowrap tabular-nums text-xs">{fmtData(d.order_date)}</TableCell>
                      {multi ? (
                        <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">
                          {nameById.get(d.account_id) ?? "—"}
                        </TableCell>
                      ) : null}
                      <TableCell className="whitespace-nowrap tabular-nums text-xs">
                        <a
                          href={`https://www.mercadolivre.com.br/vendas/${d.order_id}/detalhe`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {String(d.order_id)}
                        </a>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px]", CORES[d.tipo] ?? "bg-muted text-muted-foreground")}>
                          {rotulo(d.tipo)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div className="max-w-[420px]">{d.descricao ?? "—"}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs font-semibold text-destructive">
                        {formatBRL(Number(d.valor_divergencia ?? 0), { showSign: false })}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setChamado(d)}>
                          <FileText className="mr-1 h-3.5 w-3.5" /> Gerar chamado
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!chamado} onOpenChange={(o) => !o && setChamado(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">Texto para o chamado no Mercado Livre</DialogTitle>
          </DialogHeader>
          <Textarea readOnly value={chamado ? montarTexto(chamado) : ""} className="h-[380px] font-mono text-xs" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setChamado(null)}>Fechar</Button>
            <Button size="sm" onClick={copiar}><Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar texto</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
