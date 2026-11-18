import { createFileRoute } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";
import { EmptyState } from "@/components/rf/empty-state";

export const Route = createFileRoute("/_authenticated/shopee")({
  head: () => ({
    meta: [
      { title: "Shopee — Painel Financeiro" },
      { name: "description", content: "Integração com Shopee — em breve." },
    ],
  }),
  component: ShopeePage,
});

function ShopeePage() {
  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-primary">Shopee</h1>
        <p className="text-sm text-muted-foreground">Integração com o marketplace da Shopee.</p>
      </header>
      <EmptyState
        icon={ShoppingBag}
        title="Em construção"
        description="A integração com a Shopee será implementada em uma fase futura. O schema do Painel Financeiro já nasce preparado para múltiplos marketplaces."
      />
    </div>
  );
}