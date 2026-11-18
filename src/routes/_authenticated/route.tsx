import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "@/components/rf/app-sidebar";
import { EmptyState } from "@/components/rf/empty-state";
import { ErroCarregar } from "@/components/rf/erro-carregar";
import { AvisoSincronizacao } from "@/components/rf/aviso-sincronizacao";
import { Lock } from "lucide-react";
import { SCREENS, screenKeyForPath, useMyScreens } from "@/hooks/use-screens";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    // Celular: barra do menu em cima e a tela embaixo; computador: menu ao lado (ui-03).
    <div className="h-dvh flex flex-col md:flex-row w-full overflow-hidden bg-background text-foreground">
      <AppSidebar />
      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto">
        <AvisoSincronizacao />
        <ScreenGuard />
      </main>
    </div>
  );
}

function ScreenGuard() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const { data: screens, isLoading, error, refetch } = useMyScreens();

  const key = screenKeyForPath(pathname);
  const isAdmin = screens?.isAdmin ?? false;
  const keys = screens?.keys ?? [];
  const allowedHere = isAdmin || keys.includes(key);
  const firstAllowed = SCREENS.find((s) => keys.includes(s.key));

  useEffect(() => {
    if (isLoading || !screens || allowedHere || !firstAllowed) return;
    navigate({ to: firstAllowed.url, replace: true });
  }, [isLoading, screens, allowedHere, firstAllowed, navigate]);

  // Sem isto a tela ficava em branco para sempre quando my_screens falhava (ui-06). Só sem
  // permissões em mãos: falha numa releitura em segundo plano não derruba a tela aberta.
  if (error && !screens) {
    return (
      <div className="p-6">
        <ErroCarregar oque="Suas permissões" onRetry={() => void refetch()} />
      </div>
    );
  }
  if (isLoading || !screens) return null;

  if (!allowedHere) {
    if (!firstAllowed) {
      return (
        <div className="p-6">
          <EmptyState
            icon={Lock}
            title="Sem acesso"
            description="Você ainda não tem acesso a nenhuma tela. Fale com o administrador."
          />
        </div>
      );
    }
    return null;
  }

  return <Outlet />;
}