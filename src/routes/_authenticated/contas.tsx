import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/contas")({
  beforeLoad: () => {
    throw redirect({ to: "/configuracoes", search: { aba: "integracoes" }, replace: true });
  },
});