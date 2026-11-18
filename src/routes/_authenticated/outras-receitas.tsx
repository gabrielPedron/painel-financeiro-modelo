import { createFileRoute } from "@tanstack/react-router";
import { Store } from "lucide-react";
import { EmptyState } from "@/components/rf/empty-state";
// Conteúdo funcional preservado (cadastro de empresas + faturamento).
// Para reativar: troque EM_CONSTRUCAO para false.
import { OutrasReceitasPage } from "./-outras-receitas-conteudo";

const EM_CONSTRUCAO = true;

export const Route = createFileRoute("/_authenticated/outras-receitas")({
  head: () => ({
    meta: [
      { title: "Outras receitas — Painel Financeiro" },
      { name: "description", content: "Lançamento manual de faturamento de Shopee, balcão e TikTok Shop por empresa e mês." },
    ],
  }),
  component: OutrasReceitasRoute,
});


function OutrasReceitasRoute() {
  if (!EM_CONSTRUCAO) return <OutrasReceitasPage />;
  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-primary">Outras receitas</h1>
        <p className="text-sm text-muted-foreground">Faturamento manual de Shopee, balcão e TikTok Shop.</p>
      </header>
      <EmptyState
        icon={Store}
        title="Em construção"
        description="O lançamento de outras receitas será liberado em uma fase futura. O cadastro de empresas e o faturamento já estão prontos por baixo, aguardando ativação."
      />
    </div>
  );
}
