import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, Plug, SlidersHorizontal, Users, ImageIcon, Trash2, Upload, ShieldCheck, MessageCircle, ListChecks, Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { EmpresasPanel } from "@/components/rf/settings/empresas-panel";
import { UsuariosPanel } from "@/components/rf/settings/usuarios-panel";
import { IntegracoesPanel } from "@/components/rf/settings/integracoes-panel";
import { AuditoriaPanel } from "@/components/rf/settings/auditoria-panel";
import { TelegramPanel } from "@/components/rf/settings/telegram-panel";
import { RegrasPanel } from "@/components/rf/settings/regras-panel";
import { useAppLogo, APP_LOGO_QUERY_KEY } from "@/hooks/use-app-logo";
import { useMyScreens, configTabKey } from "@/hooks/use-screens";
import { EmptyState } from "@/components/rf/empty-state";

import { ThemeSelector } from "@/components/rf/theme-selector";
type Aba = "empresas" | "integracoes" | "auditoria" | "usuarios" | "telegram" | "regras" | "preferencias";
const ABAS: Aba[] = ["empresas", "integracoes", "auditoria", "usuarios", "telegram", "regras", "preferencias"];

// ────────────────────────────────────────────────────────────────
// Abas escondidas de Configurações (componentes mantidos). Auditoria e Regras
// voltaram em 08/10 (ui-01); quem não é administrador precisa da permissão da aba.
const HIDDEN_CONFIG_TABS: string[] = [];
// Ordem exibida na demo.
const CONFIG_TAB_ORDER: Aba[] = ["usuarios", "integracoes", "empresas", "telegram", "preferencias", "auditoria", "regras"];
const ABAS_VISIVEIS = CONFIG_TAB_ORDER.filter((a) => !HIDDEN_CONFIG_TABS.includes(a));
// ────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_authenticated/configuracoes")({
  validateSearch: (search): { aba: Aba } => {
    const raw = (search as { aba?: unknown }).aba;
    const fallback = (ABAS_VISIVEIS[0] ?? ABAS[0]) as Aba;
    const aba = typeof raw === "string" && (ABAS_VISIVEIS as string[]).includes(raw) ? (raw as Aba) : fallback;
    return { aba };
  },

  head: () => ({
    meta: [
      { title: "Configurações — Painel Financeiro" },
      { name: "description", content: "Central de controle do Painel Financeiro." },
    ],
  }),
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  const { aba } = Route.useSearch();
  const navigate = useNavigate();
  const { data: screens } = useMyScreens();
  const isAdmin = screens?.isAdmin ?? false;
  const setAba = (next: Aba) => {
    navigate({ to: "/configuracoes", search: { aba: next }, replace: true });
  };

  const tabs: { key: Aba; label: string; icon: typeof Building2 }[] = useMemo(() => {
    const all: { key: Aba; label: string; icon: typeof Building2 }[] = [
      { key: "empresas", label: "Empresas", icon: Building2 },
      { key: "integracoes", label: "Integrações", icon: Plug },
      { key: "auditoria", label: "Auditoria", icon: ShieldCheck },
      { key: "usuarios", label: "Usuários", icon: Users },
      { key: "telegram", label: "Telegram", icon: MessageCircle },
      { key: "regras", label: "Regras", icon: ListChecks },
      { key: "preferencias", label: "Preferências", icon: SlidersHorizontal },
    ];
    return ABAS_VISIVEIS.map((k) => all.find((t) => t.key === k)!).filter(Boolean);
  }, []);

  const allowedTabs = useMemo(
    () => tabs.filter((t) => isAdmin || (screens?.keys ?? []).includes(configTabKey(t.key))),
    [tabs, isAdmin, screens],
  );

  useEffect(() => {
    if (!screens) return;
    const allowedKeys = allowedTabs.map((t) => t.key);
    if (allowedKeys.length === 0) return;
    if (!allowedKeys.includes(aba)) {
      navigate({ to: "/configuracoes", search: { aba: allowedKeys[0] as Aba }, replace: true });
    }
  }, [screens, isAdmin, aba, allowedTabs, navigate]);


  const semAcesso = !!screens && !isAdmin && allowedTabs.length === 0;

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-primary">Configurações</h1>
        <p className="text-sm text-muted-foreground">Central de controle do Painel Financeiro.</p>
      </header>

      {semAcesso ? (
        <EmptyState icon={Lock} title="Sem acesso" description="Sem acesso a nenhuma seção de Configurações." />
      ) : (
      <>
      <div className="flex flex-wrap gap-1 rounded-lg border border-border/60 bg-muted/40 p-1">
        {allowedTabs.map((t) => {
          const active = aba === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setAba(t.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-background border border-border/60 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/60",
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {aba === "empresas" ? (
        <EmpresasPanel onGoIntegracoes={() => setAba("integracoes")} />
      ) : aba === "integracoes" ? (
        <IntegracoesPanel onGoEmpresas={() => setAba("empresas")} />
      ) : aba === "auditoria" ? (
        <AuditoriaPanel />
      ) : aba === "usuarios" ? (
        <UsuariosPanel />
      ) : aba === "telegram" ? (
        <TelegramPanel />
    ) : aba === "regras" ? (
      <RegrasPanel />
      ) : (
        <PreferenciasPanel />
      )}
      </>
      )}
    </div>
  );
}

function PreferenciasPanel() {
  return (
    <div className="space-y-6 max-w-2xl">
      <LogoCard />
      <Card className="border-border/60 bg-card/60">
        <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Aparência</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-sm">Tema</Label>
            <p className="text-xs text-muted-foreground">Escolha entre claro, escuro ou seguir o sistema. A preferência fica salva neste navegador.</p>
          </div>
          <ThemeSelector />
        </CardContent>
      </Card>
      <Card className="border-border/60 bg-card/60">
        <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Preferências</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm">Fuso horário</Label>
              <p className="text-xs text-muted-foreground">Todas as datas exibidas em America/Sao_Paulo.</p>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">America/Sao_Paulo</span>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

const ACCEPTED = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

function LogoCard() {
  const { data: logo } = useAppLogo();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [busyIcon, setBusyIcon] = useState(false);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!ACCEPTED.includes(file.type)) throw new Error("Formato não suportado. Use PNG, JPG, SVG ou WEBP.");
      if (file.size > MAX_BYTES) throw new Error("Arquivo maior que 2 MB.");
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão inválida");
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${uid}/logo.${ext}`;
      // Remove any previous logo files for this user
      const { data: existing } = await supabase.storage.from("logos").list(uid);
      if (existing && existing.length > 0) {
        const toRemove = existing
          .map((f) => `${uid}/${f.name}`)
          .filter((p) => !p.includes("/logo-icon."));
        if (toRemove.length > 0) await supabase.storage.from("logos").remove(toRemove);
      }
      const { error: upErr } = await supabase.storage.from("logos").upload(path, file, {
        upsert: true,
        contentType: file.type,
      });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase
        .from("app_settings")
        .upsert({ owner_id: uid, logo_url: path }, { onConflict: "owner_id" });
      if (dbErr) throw dbErr;
    },
    onSuccess: () => {
      toast.success("Logo atualizada");
      qc.invalidateQueries({ queryKey: APP_LOGO_QUERY_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const uploadIcon = useMutation({
    mutationFn: async (file: File) => {
      if (!ACCEPTED.includes(file.type)) throw new Error("Formato não suportado. Use PNG, JPG, SVG ou WEBP.");
      if (file.size > MAX_BYTES) throw new Error("Arquivo maior que 2 MB.");
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão inválida");
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${uid}/logo-icon.${ext}`;
      const { data: existing } = await supabase.storage.from("logos").list(uid);
      if (existing && existing.length > 0) {
        const toRemove = existing
          .map((f) => `${uid}/${f.name}`)
          .filter((p) => p.includes("/logo-icon.") && p !== path);
        if (toRemove.length > 0) await supabase.storage.from("logos").remove(toRemove);
      }
      const { error: upErr } = await supabase.storage.from("logos").upload(path, file, {
        upsert: true,
        contentType: file.type,
      });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase
        .from("app_settings")
        .upsert({ owner_id: uid, logo_icon_url: path }, { onConflict: "owner_id" });
      if (dbErr) throw dbErr;
    },
    onSuccess: () => {
      toast.success("Ícone atualizado");
      qc.invalidateQueries({ queryKey: APP_LOGO_QUERY_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão inválida");
      if (logo?.path) {
        await supabase.storage.from("logos").remove([logo.path]);
      }
      const { error } = await supabase
        .from("app_settings")
        .upsert({ owner_id: uid, logo_url: null }, { onConflict: "owner_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Logo removida");
      qc.invalidateQueries({ queryKey: APP_LOGO_QUERY_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeIcon = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão inválida");
      if (logo?.iconPath) {
        await supabase.storage.from("logos").remove([logo.iconPath]);
      }
      const { error } = await supabase
        .from("app_settings")
        .upsert({ owner_id: uid, logo_icon_url: null }, { onConflict: "owner_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ícone removido");
      qc.invalidateQueries({ queryKey: APP_LOGO_QUERY_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await upload.mutateAsync(file);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onPickIcon = async (file: File | undefined) => {
    if (!file) return;
    setBusyIcon(true);
    try {
      await uploadIcon.mutateAsync(file);
    } finally {
      setBusyIcon(false);
      if (iconInputRef.current) iconInputRef.current.value = "";
    }
  };

  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Logo da empresa</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-32 items-center justify-center rounded-md border border-border/60 bg-background/60 overflow-hidden">
            {logo?.url ? (
              <img src={logo.url} alt="Logo" className="h-full w-full object-contain" />
            ) : (
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED.join(",")}
                className="hidden"
                onChange={(e) => onPick(e.target.files?.[0])}
              />
              <Button size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
                <Upload className="mr-2 h-4 w-4" />
                {busy ? "Enviando..." : logo?.url ? "Trocar logo" : "Selecionar arquivo"}
              </Button>
              {logo?.url ? (
                <Button size="sm" variant="outline" onClick={() => remove.mutate()} disabled={remove.isPending}>
                  <Trash2 className="mr-2 h-4 w-4" /> Remover logo
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">Recomendado: imagem horizontal ou quadrada, fundo transparente. PNG, JPG, SVG ou WEBP até 2 MB.</p>
          </div>
        </div>

        <div className="flex items-center gap-4 pt-4 border-t border-border/60">
          <div className="flex h-16 w-16 items-center justify-center rounded-md border border-border/60 bg-background/60 overflow-hidden">
            {logo?.iconUrl ? (
              <img src={logo.iconUrl} alt="Ícone" className="h-full w-full object-contain" />
            ) : (
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-sm">Ícone (menu recolhido)</Label>
            <div className="flex gap-2">
              <input
                ref={iconInputRef}
                type="file"
                accept={ACCEPTED.join(",")}
                className="hidden"
                onChange={(e) => onPickIcon(e.target.files?.[0])}
              />
              <Button size="sm" onClick={() => iconInputRef.current?.click()} disabled={busyIcon}>
                <Upload className="mr-2 h-4 w-4" />
                {busyIcon ? "Enviando..." : logo?.iconUrl ? "Trocar ícone" : "Selecionar arquivo"}
              </Button>
              {logo?.iconUrl ? (
                <Button size="sm" variant="outline" onClick={() => removeIcon.mutate()} disabled={removeIcon.isPending}>
                  <Trash2 className="mr-2 h-4 w-4" /> Remover ícone
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">Imagem quadrada, exibida quando o menu lateral está recolhido.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}