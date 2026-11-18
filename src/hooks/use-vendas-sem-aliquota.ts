import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Vendas do período sem alíquota cadastrada (din-02), com o mesmo filtro da Conciliação.
 * Sem contas = todas as contas da equipe (Dashboard). `todas`: o imposto do período é "—", não zero.
 */
export function useVendasSemAliquota(accountIds: string[] | null, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ["vendas-sem-aliquota", accountIds?.join(",") ?? "equipe", from, to],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("vendas_sem_aliquota" as never, {
        _account_ids: accountIds,
        _from: from,
        _to: to,
      } as never);
      if (error) throw error;
      const r = ((data ?? []) as { sem_aliquota: number; vendas: number }[])[0];
      const sem = Number(r?.sem_aliquota ?? 0);
      const vendas = Number(r?.vendas ?? 0);
      return { sem, vendas, todas: vendas > 0 && sem === vendas };
    },
  });
}
