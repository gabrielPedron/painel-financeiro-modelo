import { createFileRoute } from "@tanstack/react-router";
import { LocacaoView } from "@/components/rf/locacao-view";

export const Route = createFileRoute("/_authenticated/locacao")({
  head: () => ({
    meta: [
      { title: "Locação — Painel Financeiro" },
      { name: "description", content: "Dashboard financeiro da operação de locação: entradas, saídas, margem e maiores clientes." },
      { property: "og:title", content: "Locação — Painel Financeiro" },
      { property: "og:description", content: "Dashboard financeiro da operação de locação: entradas, saídas, margem e maiores clientes." },
    ],
  }),
  component: LocacaoDashboard,
});

function LocacaoDashboard() {
  return <LocacaoView />;
}
