import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  enqueueMlFullSync,
  drainMlQueue,
  mlQueueStatus,
} from "@/lib/ml-sync-now.functions";

type State = "idle" | "running" | "done" | "error";

export function SyncNowButton({
  days = 60,
  accountId,
  label = "Sincronizar agora",
  onFinished,
}: {
  days?: number;
  accountId?: string;
  label?: string;
  onFinished?: () => void;
}) {
  const enqueueFn = useServerFn(enqueueMlFullSync);
  const drainFn = useServerFn(drainMlQueue);
  const statusFn = useServerFn(mlQueueStatus);

  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string>("");
  const [rows, setRows] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  async function run() {
    setState("running");
    setErrors([]);
    setRows(0);
    setMessage("Enfileirando carga inicial...");
    let totalRows = 0;
    const collected: string[] = [];
    try {
      const enq = await enqueueFn({
        data: { days, ...(accountId ? { account_id: accountId } : {}) },
      });
      collected.push(...enq.errors);
      setMessage(`${enq.enqueued} tarefa(s) na fila. Processando...`);

      for (let i = 0; i < 40; i += 1) {
        const st = await statusFn();
        if (st.pendente === 0 && st.executando === 0) break;
        const r = await drainFn();
        totalRows += r.rows;
        setRows(totalRows);
        collected.push(...r.errors);
        setMessage(
          `Processando... ${st.pendente} pendente(s), ${totalRows} registro(s) importado(s)`,
        );
        if (r.processed === 0) break;
      }

      const final = await statusFn();
      collected.push(...final.errors);
      const uniq = Array.from(new Set(collected)).slice(0, 5);
      setErrors(uniq);
      setState(final.erro > 0 ? "error" : "done");
      setMessage(
        final.erro > 0
          ? `Concluído com ${final.erro} job(s) em erro — ${totalRows} registro(s) importado(s)`
          : `Concluído — ${totalRows} registro(s) importado(s)`,
      );
      onFinished?.();
    } catch (e) {
      setState("error");
      setMessage((e as Error).message);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={run} disabled={state === "running"} size="sm">
          <RefreshCw className={`mr-2 h-4 w-4 ${state === "running" ? "animate-spin" : ""}`} />
          {state === "running" ? "Sincronizando..." : label}
        </Button>
        {state === "done" && (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="h-3 w-3" /> Concluído
          </Badge>
        )}
        {state === "error" && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> Erro
          </Badge>
        )}
        {rows > 0 && <span className="text-xs text-muted-foreground">{rows} registro(s)</span>}
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
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
