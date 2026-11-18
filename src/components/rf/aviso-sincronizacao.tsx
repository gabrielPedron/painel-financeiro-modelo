import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/format";

type Estado = {
  account_id: string;
  conta: string;
  situacao: "ok" | "desconectada" | "token_falhou" | "atrasada";
  ultima_sincronizacao: string | null;
};

function texto(e: Estado): string {
  if (e.situacao === "desconectada") return `A conta ${e.conta} do Mercado Livre está desconectada: os números pararam de atualizar.`;
  if (e.situacao === "token_falhou") return `A renovação do acesso da conta ${e.conta} ao Mercado Livre falhou: os números podem parar de atualizar.`;
  return `A conta ${e.conta} não sincroniza desde ${e.ultima_sincronizacao ? formatDateTime(e.ultima_sincronizacao) : "o início"}: os números podem estar desatualizados.`;
}

/** Faixa no topo de todas as telas quando a sincronização do ML para (sync-02). Some com tudo em dia. */
export function AvisoSincronizacao() {
  const { data, isError } = useQuery({
    queryKey: ["estado-sincronizacao"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("estado_da_sincronizacao" as never);
      if (error) throw error;
      return (data ?? []) as unknown as Estado[];
    },
    refetchInterval: 5 * 60 * 1000,
  });
  const problemas = (data ?? []).filter((e) => e.situacao !== "ok");
  if (problemas.length === 0 && !(isError && !data)) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {problemas.length > 0 ? problemas.map(texto).join(" ") : "Não foi possível conferir se a sincronização com o Mercado Livre está em dia."}
      </span>
      <Link to="/configuracoes" search={{ aba: "integracoes" }} className="font-medium underline">
        Ver integrações
      </Link>
    </div>
  );
}
