import { createFileRoute } from "@tanstack/react-router";
import { EcommerceView } from "@/components/rf/ecommerce-view";

export const Route = createFileRoute("/_authenticated/ecommerce")({
  head: () => ({
    meta: [
      { title: "E-commerce — Painel Financeiro" },
      { name: "description", content: "Dashboard financeiro da operação de e-commerce: entradas, saídas, margem e top produtos." },
      { property: "og:title", content: "E-commerce — Painel Financeiro" },
      { property: "og:description", content: "Dashboard financeiro da operação de e-commerce: entradas, saídas, margem e top produtos." },
    ],
  }),
  component: EcommerceDashboard,
});

function EcommerceDashboard() {
  return <EcommerceView />;
}
