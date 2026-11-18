import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/empresas")({
  beforeLoad: () => {
    throw redirect({ to: "/configuracoes", search: { aba: "empresas" }, replace: true });
  },
});