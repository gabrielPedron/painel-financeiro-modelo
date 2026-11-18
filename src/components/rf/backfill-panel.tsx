import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { History, Loader2, AlertTriangle } from "lucide-react";
import { enqueueMlBackfill, mlQueueStatus, drainMlQueue } from "@/lib/ml-sync-now.functions";

const TIPO_LABEL: Record<string, string> = {
  billing: "Faturamento",
  orders: "Pedidos",
  mp_payments: "Pagamentos (MP)",
  ads: "ADS",
  visits: "Visitas",
  items: "Catálogo",
};

/**
 * Carga histórica completa: enfileira tudo desde o início da conta e mostra o
 * andamento da fila. A fila é drenada pelo worker (pg_cron, a cada 5 min);
 * aqui também é possível empurrar rodadas manualmente.
 */
export function BackfillPanel({ accountId }: { accountId?: string }) {
  const backfillFn = useServerFn(enqueueMlBackfill);
  const statusFn = useServerFn(mlQueueStatus);
  const drainFn = useServerFn(drainMlQueue);

  const [starting, setStarting] = useState(false);
  const [draining, setDraining] = useState(false);
  const [info, setInfo] = useState<string>("");
  const [errors, setErrors] = useState<string[]>([]);

  const { data: fila, refetch } = useQuery({
    queryKey: ["ml-queue-status"],
    queryFn: () => statusFn(),
    refetchInterval: (q) => {
      const d = q.state.data as { pendente?: number; executando?: number } | undefined;
      return (d?.pendente ?? 0) + (d?.executando ?? 0) > 0 ? 10_000 : 30_000;
    },
  });

  const pendentes = (fila?.pendente ?? 0) + (fila?.executando ?? 0);
  const total = pendentes + (fila?.concluido ?? 0) + (fila?.erro ?? 0);
  const pct = total > 0 ? Math.round(((total - pendentes) / total) * 100) : 0;

  async function start() {
    setStarting(true);
    setErrors([]);
    try {
      const r = await backfillFn({ data: accountId ? { account_id: accountId } : {} });
      setErrors(r.errors.slice(0, 5));
      const linhas = r.accounts.map(
        (a) =>
          `${a.nickname}: desde ${a.start_date} (${a.start_source}) — ` +
          `${a.enqueued.orders} pedidos, ${a.enqueued.mp_payments} pagamentos, ` +
          `${a.enqueued.billing} faturamento, ${a.enqueued.ads} ADS, ${a.enqueued.visits} visitas`,
      );
      setInfo(
        r.enqueued === 0
          ? "Nada novo para enfileirar — o histórico já está na fila ou concluído."
          : `${r.enqueued} tarefa(s) enfileirada(s). ${linhas.join(" · ")}`,
      );
      await refetch();
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      setStarting(false);
    }
  }

  async function push() {
    setDraining(true);
    try {
      for (let i = 0; i < 5; i += 1) {
        const r = await drainFn();
        await refetch();
        if (r.processed === 0) break;
      }
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      setDraining(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">Carga histórica completa</h4>
          <p className="text-xs text-muted-foreground">
            Puxa pedidos, pagamentos e faturamento desde o início da conta. Roda em segundo plano,
            com prioridade menor que a sincronização do dia — pode levar horas.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={push} disabled={draining || pendentes === 0}>
            {draining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Processar agora
          </Button>
          <Button size="sm" onClick={start} disabled={starting}>
            {starting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <History className="mr-2 h-4 w-4" />
            )}
            Puxar histórico completo
          </Button>
        </div>
      </div>

      {total > 0 && (
        <div className="space-y-2">
          <Progress value={pct} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{pct}% concluído</span>
            <Badge variant="secondary">{fila?.pendente ?? 0} pendente(s)</Badge>
            <Badge variant="secondary">{fila?.executando ?? 0} em execução</Badge>
            {(fila?.historico_pendente ?? 0) > 0 && (
              <Badge variant="outline">{fila?.historico_pendente} do histórico</Badge>
            )}
            {(fila?.erro ?? 0) > 0 && <Badge variant="destructive">{fila?.erro} erro(s)</Badge>}
            {(fila?.rate_limited ?? 0) > 0 && (
              <Badge variant="outline" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> {fila?.rate_limited} com limite da API (429)
              </Badge>
            )}
          </div>
          {fila?.por_tipo && (
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {Object.entries(fila.por_tipo).map(([tipo, c]) => (
                <span key={tipo}>
                  {TIPO_LABEL[tipo] ?? tipo}: {c.concluido}/{c.pendente + c.executando + c.concluido + c.erro}
                </span>
              ))}
            </div>
          )}
          {(fila?.em_andamento?.length ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              Processando: {fila?.em_andamento.join(", ")}
            </p>
          )}
        </div>
      )}

      {info && <p className="text-xs text-muted-foreground">{info}</p>}
      {errors.length > 0 && (
        <ul className="space-y-1 text-xs text-destructive">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
