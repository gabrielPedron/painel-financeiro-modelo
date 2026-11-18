import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Tags,
  Upload,
  ShoppingBag,
  ShoppingCart,
  Store,
  Settings,
  LogOut,
  Receipt,
  PanelLeftClose,
  PanelLeftOpen,
  Building2,
  ReceiptText,
  Scale,
  Menu,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SidebarGroup, SidebarSeparator } from "@/components/ui/sidebar";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppLogo } from "@/hooks/use-app-logo";
import logoPadrao from "@/assets/logo.svg";
import { useMyScreens } from "@/hooks/use-screens";
import { useOpenFindingsCount } from "@/components/rf/settings/auditoria-panel";
import { cn as cnUtil } from "@/lib/utils";

type NavItem = { title: string; url: string; icon: typeof LayoutDashboard; exact?: boolean };
type NavSeparator = { separator: true };
type NavGroupItem = NavItem | NavSeparator;
type NavGroup = { label: string | null; items: NavGroupItem[] };

// ────────────────────────────────────────────────────────────────
// DEMO E-COMMERCE — itens escondidos do menu (rotas continuam ativas).
// Para religar um item: remova a URL desta lista (1 linha) e pronto.
// Para religar TUDO: deixe a lista vazia -> const HIDDEN_NAV_URLS: string[] = [];
const HIDDEN_NAV_URLS: string[] = [
  "/shopee",
  "/outras-receitas",
  "/faturamento-locacao",
  "/locacao",
  "/contas-a-pagar",
  "/contas",
  "/custos-por-operacao",
  "/sincronizacoes",
];
// Badge de achados de auditoria em Configurações (só para o administrador).
const SHOW_AUDIT_BADGE = true;
// ────────────────────────────────────────────────────────────────

const navGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard, exact: true },
    ],
  },
  {
    label: "E-commerce",
    items: [
      { title: "Mercado Livre", url: "/mercado-livre", icon: ShoppingCart },
      { title: "Anúncios", url: "/anuncios", icon: Tags },
      { title: "Conciliação", url: "/conciliacao", icon: Scale },
      { separator: true },
      { title: "Shopee", url: "/shopee", icon: ShoppingBag },
      { title: "Outras receitas", url: "/outras-receitas", icon: Store },
    ],
  },
  {
    label: "Locação",
    items: [
      { title: "Faturamento locação", url: "/faturamento-locacao", icon: Building2 },
    ],
  },
  {
    label: "Produtos e custos",
    items: [
      { title: "Produtos / SKUs", url: "/custos", icon: Upload },
      { title: "Custos Empresa", url: "/custos-fixos", icon: Receipt },
      { title: "Contas a Pagar", url: "/contas-a-pagar", icon: ReceiptText },
    ],
  },
];


const settingsItem: NavItem = { title: "Configurações", url: "/configuracoes", icon: Settings };

const STORAGE_KEY = "rf.sidebar.collapsed";

// O que o usuário enxerga no menu: telas permitidas e o aviso da auditoria. Usado pelo menu do
// computador e pela barra do celular.
function useNav() {
  const { data: screens } = useMyScreens();
  const { data: findings } = useOpenFindingsCount();
  const isAdmin = screens?.isAdmin ?? false;
  const allowed = (url: string) => {
    if (HIDDEN_NAV_URLS.includes(url)) return false;
    if (!screens) return false;
    if (isAdmin) return true;
    const key = url === "/" ? "dashboard" : url.replace(/^\//, "");
    return screens.keys.includes(key);
  };

  const visibleGroups = navGroups
    .map((g) => {
      const filtered = g.items.filter((i): i is NavGroupItem => {
        if ("separator" in i) return true;
        return allowed(i.url);
      });
      // remove separadores órfãos no início/fim ou adjacentes
      const cleaned: NavGroupItem[] = [];
      let lastWasSeparator = true;
      for (const i of filtered) {
        if ("separator" in i) {
          if (!lastWasSeparator && cleaned.length > 0) {
            cleaned.push(i);
            lastWasSeparator = true;
          }
        } else {
          cleaned.push(i);
          lastWasSeparator = false;
        }
      }
      // remove separador no final
      if (cleaned.length > 0 && "separator" in cleaned[cleaned.length - 1]) cleaned.pop();
      return { ...g, items: cleaned };
    })
    .filter((g) => g.items.length > 0);
  const settingsVisible = allowed(settingsItem.url);
  const findingsToneRaw = findings && findings.critico > 0 ? "bg-red-600" : findings && findings.alerta > 0 ? "bg-amber-500" : null;
  const findingsTone = SHOW_AUDIT_BADGE && isAdmin ? findingsToneRaw : null;
  return { visibleGroups, settingsVisible, findingsTone, findingsTotal: findings?.total ?? 0, isAdmin: screens ? isAdmin : null };
}

export function AppSidebar() {
  const { data: logo } = useAppLogo();
  const { findingsTone } = useNav();
  const [menuAberto, setMenuAberto] = useState(false);

  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "1") setCollapsed(true);
    } catch { /* ignore */ }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <TooltipProvider delayDuration={200}>
      {/* Celular (abaixo de 768 px): barra no topo; o mesmo menu abre numa gaveta (ui-03). */}
      <header className="md:hidden flex shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-2 py-1.5">
        <Sheet open={menuAberto} onOpenChange={setMenuAberto}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Abrir menu">
              <Menu className="h-5 w-5" />
              {findingsTone ? <span className={cn("absolute top-1.5 right-1.5 h-2 w-2 rounded-full", findingsTone)} /> : null}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-64 flex-col gap-0 overflow-y-auto bg-sidebar p-0">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SheetDescription className="sr-only">Telas do sistema, Configurações e Sair.</SheetDescription>
            <NavConteudo collapsed={false} onNavigate={() => setMenuAberto(false)} />
          </SheetContent>
        </Sheet>
        <Link to="/" className="flex items-center">
          <img src={logo?.url ?? logoPadrao} alt="Painel Financeiro" className="max-h-8 w-auto max-w-[140px] object-contain" />
        </Link>
      </header>

      <aside
        className={cn(
          "hidden md:flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar h-screen sticky top-0 overflow-y-auto transition-[width] duration-200 ease-in-out",
          collapsed ? "md:w-16" : "md:w-52",
        )}
      >
        <NavConteudo
          collapsed={collapsed}
          recolher={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleCollapsed}
                  className={cn("w-full text-muted-foreground", collapsed ? "justify-center px-0" : "justify-start")}
                  aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
                >
                  {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="mr-2 h-4 w-4" /> Recolher</>}
                </Button>
              </TooltipTrigger>
              {collapsed && <TooltipContent side="right">Expandir menu</TooltipContent>}
            </Tooltip>
          }
        />
      </aside>
    </TooltipProvider>
  );
}

// Conteúdo do menu, o mesmo no computador e no celular: logo, telas, Configurações (com o aviso
// da auditoria) e Sair. `onNavigate` fecha a gaveta do celular ao escolher a tela.
function NavConteudo({ collapsed, recolher, onNavigate }: { collapsed: boolean; recolher?: React.ReactNode; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const { data: logo } = useAppLogo();
  const { visibleGroups, settingsVisible, findingsTone, findingsTotal, isAdmin } = useNav();
  // Com qual conta a pessoa entrou: a sessão já está no navegador, sem ida ao servidor.
  const { data: email } = useQuery({
    queryKey: ["conta-logada"],
    queryFn: async () => (await supabase.auth.getSession()).data.session?.user.email ?? null,
  });

  const qc = useQueryClient();
  const handleLogout = async () => {
    onNavigate?.();
    await supabase.auth.signOut();
    qc.clear(); // a próxima conta não vê dados nem o e-mail da anterior
    navigate({ to: "/login", replace: true });
  };

  return (
    <>
      <Link
        to="/"
        onClick={onNavigate}
        className={cn(
          "flex items-center border-b border-sidebar-border cursor-pointer transition-colors hover:bg-sidebar-accent/40 px-3 py-3",
          collapsed && "justify-center px-2",
        )}
      >
        {collapsed ? (
          <img
            src={logo?.iconUrl ?? logoPadrao}
            alt="Painel Financeiro"
            className="h-9 w-9 object-contain object-left"
          />
        ) : (
          <img
            src={logo?.url ?? logoPadrao}
            alt="Painel Financeiro"
            className="max-h-11 w-auto max-w-[150px] object-contain"
          />
        )}
      </Link>
      <nav className="flex-1">
        {visibleGroups.map((group, idx) => (
          <div key={idx}>
            {idx > 0 && <SidebarSeparator className="opacity-40" />}
            <SidebarGroup className="p-2">
              {group.label && !collapsed && (
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-3 pt-1 pb-1.5">
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item, itemIdx) => {
                  if ("separator" in item) {
                    return <SidebarSeparator key={`sep-${itemIdx}`} className="opacity-30 my-1.5" />;
                  }
                  const active = item.exact
                    ? pathname === item.url
                    : pathname === item.url || pathname.startsWith(item.url + "/");
                  return <SideLink key={item.url} item={item} active={active} collapsed={collapsed} onNavigate={onNavigate} />;
                })}
              </div>
            </SidebarGroup>
          </div>
        ))}
      </nav>
      <div className="mt-auto p-2 border-t border-sidebar-border space-y-0.5">
        {recolher}
        {settingsVisible ? (
          <SideLink
            item={settingsItem}
            active={pathname === settingsItem.url || pathname.startsWith(settingsItem.url + "/")}
            collapsed={collapsed}
            onNavigate={onNavigate}
            badge={findingsTone ? (
              <span
                title={`${findingsTotal} achado(s) de auditoria em aberto`}
                className={cnUtil(collapsed ? "absolute top-1 right-1" : "ml-auto", "h-2 w-2 rounded-full", findingsTone)}
              />
            ) : null}
          />
        ) : null}
        {!collapsed && email ? (
          <div className="px-3 pb-1 pt-0.5 text-[11px] leading-tight text-muted-foreground">
            <div className="truncate" title={email}>{email}</div>
            {isAdmin === null ? null : <div>{isAdmin ? "Administrador" : "Membro"}</div>}
          </div>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className={cn("w-full text-muted-foreground", collapsed ? "justify-center px-0" : "justify-start")}
              aria-label="Sair"
            >
              {collapsed ? <LogOut className="h-4 w-4" /> : <><LogOut className="mr-2 h-4 w-4" /> Sair</>}
            </Button>
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right">Sair</TooltipContent>}
        </Tooltip>
      </div>
    </>
  );
}

function SideLink({ item, active, badge, collapsed, onNavigate }: { item: NavItem; active: boolean; badge?: React.ReactNode; collapsed?: boolean; onNavigate?: () => void }) {
  const link = (
    <Link
      to={item.url as string}
      onClick={onNavigate}
      className={cn(
        "relative flex items-center gap-2 rounded-md py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
        collapsed ? "justify-center px-2" : "px-3",
        active &&
          "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-r before:bg-sidebar-primary",
      )}
    >
      <item.icon className={cn("h-4 w-4 shrink-0", active && "text-sidebar-primary")} />
      {!collapsed && item.title}
      {!collapsed && badge}
      {collapsed && badge}
    </Link>
  );
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.title}</TooltipContent>
      </Tooltip>
    );
  }
  return link;
}
