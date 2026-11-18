import type { QueryClient } from "@tanstack/react-query";

// Consultas pertencem à identidade atual, não à aba do navegador.
export function protegerCachePorSessao(
  cliente: QueryClient,
  assinar: (notificar: (evento: string, usuarioId?: string | null) => void) => { unsubscribe: () => void },
  aoTrocar?: (usuarioId: string | null) => void,
): () => void {
  let usuarioAtual: string | null | undefined;
  const assinatura = assinar((evento, usuarioId) => {
    // Sem ID, não se presume que a sessão anterior ainda é a mesma.
    if (usuarioId !== undefined && usuarioAtual === usuarioId) {
      if (evento === "USER_UPDATED" || evento === "PASSWORD_RECOVERY") void cliente.invalidateQueries();
      return;
    }
    usuarioAtual = usuarioId;
    cliente.clear();
    aoTrocar?.(usuarioId ?? null);
  });
  return () => assinatura.unsubscribe();
}
