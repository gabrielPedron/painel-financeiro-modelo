import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/rf/empty-state";

// Consulta que falhou não pode aparecer como R$ 0,00: parece mês sem venda (ui-04).
export function ErroCarregar({ onRetry, oque = "Os números deste período" }: { onRetry: () => void; oque?: string }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="Não foi possível carregar"
      description={`${oque} não chegaram. Nada foi zerado: é só tentar de novo.`}
      action={
        <Button variant="outline" size="sm" onClick={onRetry}>
          Tentar de novo
        </Button>
      }
    />
  );
}
