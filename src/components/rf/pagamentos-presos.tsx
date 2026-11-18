import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBRL } from "@/lib/format";

type Preso = {
  payment_id: number;
  order_id: number | null;
  produto: string | null;
  aprovado: string;
  previsto: string;
  dias_atraso: number;
  valor: number;
};

const dataBR = (v: string) => v.split("-").reverse().join("/");

/**
 * Dinheiro preso no Mercado Pago: pagamento aprovado cuja liberação venceu há mais de 7 dias e
 * segue pendente. Fica fora do "a receber". Sem nenhum, não aparece.
 * Sem contas = todas as contas da equipe (Dashboard).
 */
export function PagamentosPresos({ accountIds }: { accountIds: string[] | null }) {
  const { data: presos, isError } = useQuery({
    queryKey: ["pagamentos-presos", accountIds?.join(",") ?? "equipe"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pagamentos_presos" as never, { _account_ids: accountIds } as never);
      if (error) throw error;
      return (data ?? []) as unknown as Preso[];
    },
  });

  if (isError && !presos) {
    return <span className="text-[11px] text-muted-foreground">Não foi possível conferir se há dinheiro preso no Mercado Pago.</span>;
  }
  if (!presos?.length) return null;
  const total = presos.reduce((s, p) => s + Number(p.valor), 0);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-500 hover:underline">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {formatBRL(total)} preso no Mercado Pago
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Dinheiro preso no Mercado Pago</DialogTitle>
          <DialogDescription>
            Pagamentos aprovados que o Mercado Pago deveria ter liberado há mais de 7 dias e continuam pendentes. Ficam fora do
            "a receber". Para ver o motivo, busque o número da operação em Mercado Pago → Atividade, ou a venda em Mercado Livre →
            Vendas (reclamação ou devolução aberta). Saem daqui sozinhos quando o Mercado Pago liberar.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Venda</TableHead>
                <TableHead>Operação MP</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Aprovado</TableHead>
                <TableHead>Liberação prevista</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {presos.map((p) => (
                <TableRow key={p.payment_id}>
                  <TableCell className="text-xs tabular-nums">
                    {p.order_id ? (
                      <a
                        href={`https://www.mercadolivre.com.br/vendas/${p.order_id}/detalhe`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {p.order_id}
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">{p.payment_id}</TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs" title={p.produto ?? undefined}>{p.produto ?? "—"}</TableCell>
                  <TableCell className="text-xs tabular-nums">{dataBR(p.aprovado)}</TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {dataBR(p.previsto)} <span className="text-amber-500">({p.dias_atraso} dias)</span>
                  </TableCell>
                  <TableCell className="text-right text-xs font-medium tabular-nums">{formatBRL(Number(p.valor))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
