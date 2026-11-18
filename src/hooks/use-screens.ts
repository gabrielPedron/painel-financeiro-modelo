import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const SCREENS: { key: string; label: string; url: string }[] = [
  { key: "dashboard", label: "Dashboard", url: "/" },
  { key: "mercado-livre", label: "Mercado Livre", url: "/mercado-livre" },
  { key: "conciliacao", label: "Conciliação", url: "/conciliacao" },
  { key: "shopee", label: "Shopee", url: "/shopee" },
  { key: "anuncios", label: "Anúncios", url: "/anuncios" },
  { key: "outras-receitas", label: "Outras receitas", url: "/outras-receitas" },
  { key: "faturamento-locacao", label: "Faturamento locação", url: "/faturamento-locacao" },
  { key: "custos-fixos", label: "Custos Empresa", url: "/custos-fixos" },
  { key: "contas-a-pagar", label: "Contas a Pagar", url: "/contas-a-pagar" },
  { key: "custos", label: "Produtos / SKUs", url: "/custos" },
  { key: "configuracoes", label: "Configurações", url: "/configuracoes" },
];

export function screenKeyForPath(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg || seg === "ecommerce" || seg === "locacao") return "dashboard";
  return seg;
}

export const CONFIG_TABS: { key: string; label: string }[] = [
  { key: "empresas", label: "Empresas" },
  { key: "integracoes", label: "Integrações" },
  { key: "auditoria", label: "Auditoria" },
  { key: "usuarios", label: "Usuários" },
  { key: "telegram", label: "Telegram" },
  { key: "regras", label: "Regras" },
  { key: "preferencias", label: "Preferências" },
];

export const configTabKey = (tab: string) => `configuracoes:${tab}`;

export function useMyScreens() {
  return useQuery({
    queryKey: ["my-screens"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_screens");
      if (error) throw error;
      const keys = (data ?? []).map((r) => r.screen_key);
      return { keys, isAdmin: keys.includes("*") };
    },
  });
}
