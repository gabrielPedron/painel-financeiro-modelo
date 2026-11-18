import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearch, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Copy, Check, Plug, Link2, Pencil, Trash2, RefreshCw, Building2, Clock, ChevronDown, ChevronRight, AlertTriangle, Unplug, ShieldCheck, Loader2, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/rf/empty-state";
import { AuditBanner } from "@/components/rf/audit-banner";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { appBaseUrl } from "@/lib/app-url";
import { toast } from "sonner";
import { SyncNowButton } from "@/components/rf/sync-now-button";
import { BackfillPanel } from "@/components/rf/backfill-panel";
import { startMlOauth, disconnectMlAccount, enqueueSyncAllAccounts, forceFullReprocess, saveMlAccount } from "@/lib/ml-oauth.functions";
import { useMyScreens } from "@/hooks/use-screens";

type AccountRow = {
  id: string;
  nickname: string;
  external_nickname: string | null;
  status: string;
  last_sync_at: string | null;
  is_active: boolean;
  created_at: string;
  trade_name: string | null;
  advertiser_id: number | null;
  token_expires_at: string | null;
  has_credentials: boolean;
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  nao_conectada: { label: "Não conectada", className: "bg-muted text-muted-foreground" },
  conectada: { label: "Conectada", className: "bg-primary/15 text-primary" },
  erro: { label: "Erro", className: "bg-red-600/10 text-red-700" },
  token_expirado: { label: "Token expirado", className: "bg-amber-500/15 text-amber-500" },
};

function timeAgo(iso: string | null): string {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "há menos de 1 minuto";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `há ${mins} minuto${mins > 1 ? "s" : ""}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `há ${hrs} hora${hrs > 1 ? "s" : ""}`;
  const days = Math.floor(hrs / 24);
  return `há ${days} dia${days > 1 ? "s" : ""}`;
}

export function IntegracoesPanel({ onGoEmpresas }: { onGoEmpresas: () => void }) {
  const qc = useQueryClient();
  // Conectar, desconectar, cadastrar e remover a integração: só o administrador (ticket 08).
  const { data: telas } = useMyScreens();
  const isAdmin = telas?.isAdmin ?? false;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [copied, setCopied] = useState(false);
  const [subTab, setSubTab] = useState<"conexoes" | "historico">("conexoes");
  const [howtoOpen, setHowtoOpen] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const redirectUri = `${appBaseUrl()}/api/ml/callback`;

  const search = useSearch({ strict: false }) as { aba?: string; conectado?: string; erro?: string };
  const navigate = useNavigate();
  useEffect(() => {
    if (search.conectado === "1") {
      toast.success("Conta conectada com sucesso");
      navigate({ to: "/configuracoes", search: { aba: "integracoes" }, replace: true });
    } else if (search.erro) {
      toast.error(`Falha ao conectar: ${search.erro}`);
      navigate({ to: "/configuracoes", search: { aba: "integracoes" }, replace: true });
    }
  }, [search.conectado, search.erro]);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketplace_accounts")
        .select("id, nickname, external_nickname, status, last_sync_at, is_active, created_at, trade_name, advertiser_id, token_expires_at, client_id")
        .eq("platform", "mercado_livre")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => {
        const { client_id, ...rest } = r as typeof r & { client_id: string | null };
        return { ...rest, has_credentials: !!client_id } as AccountRow;
      });
    },
  });

  // Conta com pedidos não se exclui (o banco recusa): a lixeira só aparece para conta vazia (ticket 08).
  const { data: comHistorico } = useQuery({
    queryKey: ["contas-com-historico", (accounts ?? []).map((a) => a.id).join(",")],
    enabled: isAdmin && !!accounts?.length,
    queryFn: async () => {
      const ids = new Set<string>();
      for (const a of accounts ?? []) {
        const { count, error } = await supabase
          .from("ml_orders")
          .select("id", { count: "exact", head: true })
          .eq("account_id", a.id);
        if (error) throw error;
        if ((count ?? 0) > 0) ids.add(a.id);
      }
      return ids;
    },
  });

  const removeAccount = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("marketplace_accounts").delete().eq("id", id);
      // O banco recusa excluir conta com histórico, em vez de apagar tudo em cascata (ticket 08).
      if (error?.code === "23503") {
        throw new Error("Esta conta tem histórico e não pode ser removida: os dados ficam guardados. Para parar de sincronizar, deixe-a desconectada.");
      }
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Integração removida");
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startFn = useServerFn(startMlOauth);
  const disconnectFn = useServerFn(disconnectMlAccount);

  const onConnect = async (accountId: string) => {
    setConnectingId(accountId);
    try {
      const res = await startFn({ data: { account_id: accountId } });
      window.location.href = res.url;
    } catch (e) {
      toast.error((e as Error).message);
      setConnectingId(null);
    }
  };

  const onDisconnect = async (accountId: string, name: string) => {
    if (!confirm(`Desconectar "${name}"? Os tokens serão removidos e você precisará autorizar de novo.`)) return;
    try {
      await disconnectFn({ data: { account_id: accountId } });
      toast.success("Conta desconectada");
      qc.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const copyUri = async () => {
    await navigator.clipboard.writeText(redirectUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <AuditBanner accountIds={(accounts ?? []).map((a) => a.id)} />
        <div className="inline-flex rounded-md border border-border/60 bg-muted/40 p-0.5">
          {([
            { key: "conexoes", label: "Conexões" },
            { key: "historico", label: "Histórico de sincronizações" },
          ] as const).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubTab(t.key)}
              className={cn(
                "rounded-sm px-3 py-1 text-xs font-medium transition-colors",
                subTab === t.key
                  ? "bg-background text-foreground shadow-sm border border-border/60"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {subTab === "historico" ? (
          <HistoricoSincronizacoes accounts={accounts ?? []} />
        ) : (
          <>
            <EstadoDosDados accounts={accounts ?? []} />

            <Card className="border-border/60 bg-card/60">
              <button
                type="button"
                onClick={() => setHowtoOpen((v) => !v)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/40"
              >
                {howtoOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Como conectar uma conta do Mercado Livre
              </button>
              {howtoOpen ? (
                <CardContent className="pt-0 pb-4 text-sm text-muted-foreground space-y-2">
                  <ol className="list-decimal list-inside space-y-1.5 leading-relaxed">
                    <li>Acesse <a href="https://developers.mercadolivre.com.br" target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">developers.mercadolivre.com.br</a> e crie um aplicativo para cada conta.</li>
                    <li>Em <span className="text-foreground">Redirect URI</span>, cadastre exatamente: <code className="text-foreground bg-muted px-1 py-0.5 rounded text-xs">{redirectUri}</code></li>
                    <li>Marque os escopos: <span className="text-foreground">read e offline_access (somente leitura; não marque write)</span>.</li>
                    <li>Copie o <span className="text-foreground">Client ID</span> e o <span className="text-foreground">Client Secret</span> e cadastre aqui em "Adicionar integração".</li>
                    <li>Clique em "Conectar" e autorize com a conta correspondente.</li>
                  </ol>
                </CardContent>
              ) : null}
            </Card>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Conecte suas contas de marketplace. Cada conta usa suas próprias credenciais de aplicativo.{" "}
                <button type="button" onClick={onGoEmpresas} className="underline underline-offset-2 hover:text-foreground">
                  Dados fiscais em Empresas
                </button>
                .
              </p>
              {isAdmin ? (
                <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
                  <Plus className="mr-2 h-4 w-4" /> Adicionar integração
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Só o administrador conecta ou altera a integração.</span>
              )}
            </div>

            <Card className="border-border/60 bg-card/60">
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Redirect URI do app</div>
                    <div className="mt-1 truncate font-mono text-xs text-foreground">{redirectUri}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">Cadastre exatamente esta URL nas configurações do seu app no Mercado Livre.</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={copyUri}>
                    {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                    {copied ? "Copiado" : "Copiar"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {isLoading ? (
              <div className="text-sm text-muted-foreground">Carregando...</div>
            ) : !accounts || accounts.length === 0 ? (
              <EmptyState
                icon={Plug}
                title="Nenhuma integração cadastrada"
                description="Adicione sua primeira integração com o Mercado Livre para começar a organizar o financeiro da sua operação."
                action={
                  isAdmin ? (
                    <Button size="sm" onClick={() => setOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" /> Adicionar integração
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {accounts.map((acc) => {
                  const status = STATUS_LABELS[acc.status] ?? STATUS_LABELS.nao_conectada;
                  const connected = acc.status === "conectada";
                  const needsReconnect = acc.status === "token_expirado" || acc.status === "erro";
                  const canConnect = acc.has_credentials;
                  const isConnecting = connectingId === acc.id;
                  return (
                    <Card key={acc.id} className="border-border/60 bg-card/60">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{acc.nickname}</div>
                            {acc.trade_name ? (
                              <div className="truncate text-xs text-muted-foreground flex items-center gap-1">
                                <Building2 className="h-3 w-3" />
                                {acc.trade_name}
                              </div>
                            ) : null}
                            {acc.external_nickname ? (
                              <div className="truncate text-[11px] text-muted-foreground/80">
                                Nickname ML: {acc.external_nickname}
                              </div>
                            ) : null}
                          </div>
                          <Badge className={status.className}>{status.label}</Badge>
                        </div>
                        <div className="space-y-1 text-xs text-muted-foreground">
                          {connected && acc.advertiser_id === null ? (
                            <div className="flex items-center gap-1.5 text-amber-600">
                              <AlertTriangle className="h-3 w-3" />
                              Product Ads não detectado nesta conta
                            </div>
                          ) : null}
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-3 w-3" />
                            Última sincronização: {timeAgo(acc.last_sync_at)}
                          </div>
                        </div>
                        {isAdmin ? (
                        <div className="flex items-center justify-between gap-2 pt-1">
                          {connected ? (
                            <Button size="sm" variant="outline" onClick={() => onDisconnect(acc.id, acc.trade_name || acc.nickname)}>
                              <Unplug className="mr-2 h-4 w-4" /> Desconectar
                            </Button>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Button
                                    size="sm"
                                    variant={needsReconnect ? "default" : "secondary"}
                                    disabled={!canConnect || isConnecting}
                                    onClick={() => onConnect(acc.id)}
                                  >
                                    <Link2 className="mr-2 h-4 w-4" />
                                    {isConnecting ? "Redirecionando..." : needsReconnect ? "Reconectar" : "Conectar"}
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              {!canConnect ? (
                                <TooltipContent>Cadastre Client ID e Client Secret antes de conectar</TooltipContent>
                              ) : null}
                            </Tooltip>
                          )}
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="ghost" onClick={() => { setEditing(acc); setOpen(true); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {comHistorico && !comHistorico.has(acc.id) ? (
                              <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Remover a conta "${acc.nickname}"? Ela ainda não tem histórico.`)) removeAccount.mutate(acc.id); }}>
                                <Trash2 className="h-4 w-4 text-red-700" />
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            <AccountDialog
              open={open}
              onOpenChange={setOpen}
              editing={editing}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ["accounts"] });
              }}
            />
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

function EstadoDosDados({ accounts }: { accounts: AccountRow[] }) {
  const qc = useQueryClient();
  const syncAllFn = useServerFn(enqueueSyncAllAccounts);
  const forceFn = useServerFn(forceFullReprocess);
  const [advOpen, setAdvOpen] = useState(false);
  const [advDays, setAdvDays] = useState<number>(30);
  const [running, setRunning] = useState(false);
  const [forcing, setForcing] = useState(false);

  const { data: jobs } = useQuery({
    queryKey: ["all-jobs-status"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_jobs")
        .select("status, started_at, attempts, last_error");
      if (error) throw error;
      const rows = (data ?? []) as { status: string; started_at: string | null; attempts: number | null; last_error: string | null }[];
      let pending = 0, running = 0, done = 0, err = 0, stuck = 0, failedMax = 0, rateLimited = 0;
      const incompletos: string[] = [];
      const stuckCutoff = Date.now() - 5 * 60 * 1000;
      for (const r of rows) {
        if (r.status === "pendente") pending += 1;
        else if (r.status === "executando") {
          running += 1;
          if (r.started_at && new Date(r.started_at).getTime() < stuckCutoff) stuck += 1;
        }
        else if (r.status === "concluido") done += 1;
        else if (r.status === "incompleto") {
          // Terminou, mas o faturamento ficou abaixo da API depois de 3 conferências (sync-06).
          done += 1;
          incompletos.push(r.last_error ?? "");
        }
        else if (r.status === "erro") {
          err += 1;
          if ((r.attempts ?? 0) >= 3) failedMax += 1;
        }
        const msg = r.last_error ?? "";
        if ((r.status === "pendente" || r.status === "erro") && (/429/.test(msg) || /Temporário/i.test(msg))) {
          rateLimited += 1;
        }
      }
      return { pending, running, done, err, stuck, failedMax, rateLimited, incompletos, active: pending + running, total: rows.length };
    },
    refetchInterval: (query) => {
      const d = query.state.data as { active: number } | undefined;
      return d && d.active > 0 ? 10_000 : 60_000;
    },
  });

  const { data: findings } = useQuery({
    queryKey: ["audit-open-count"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_findings")
        .select("severity, status")
        .in("status", ["aberto", "corrigindo"]);
      if (error) throw error;
      let critico = 0, alerta = 0;
      for (const r of data ?? []) {
        if ((r as { severity: string }).severity === "critico") critico += 1;
        else if ((r as { severity: string }).severity === "alerta") alerta += 1;
      }
      return { critico, alerta };
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const lastSync = accounts
    .map((a) => a.last_sync_at)
    .filter((v): v is string => !!v)
    .sort()
    .pop() ?? null;

  const runSync = async () => {
    setRunning(true);
    try {
      const r = await syncAllFn({ data: { days: advDays } });
      toast.success(
        `Sincronização enfileirada${r.accounts > 0 ? ` (${r.accounts} conta${r.accounts > 1 ? "s" : ""})` : ""}. O processamento continua em segundo plano.`,
        { duration: 8000 },
      );
      qc.invalidateQueries({ queryKey: ["all-jobs-status"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["sync-logs"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const runForce = async () => {
    setForcing(true);
    const tid = toast.loading("Reenfileirando tudo...");
    try {
      const r = await forceFn({ data: { days: advDays } });
      toast.success(
        `Reprocessamento completo enfileirado (${r.accounts} conta${r.accounts > 1 ? "s" : ""}). O processamento continua em segundo plano.`,
        { id: tid, duration: 10000 },
      );
      qc.invalidateQueries({ queryKey: ["all-jobs-status"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["ml-metrics"] });
    } catch (e) {
      toast.error(`Falha: ${(e as Error).message}`, { id: tid });
    } finally {
      setForcing(false);
    }
  };

  // Determine display state
  const hasConnected = accounts.some((a) => a.status === "conectada");
  const hasCritical = (findings?.critico ?? 0) > 0;
  const hasAlerts = (findings?.alerta ?? 0) > 0;
  const activeJobs = jobs?.active ?? 0;

  let icon: React.ReactNode;
  let title: string;
  let subtitle: React.ReactNode;
  let tone: "ok" | "info" | "warn" | "err";

  if (!hasConnected) {
    tone = "info";
    icon = <Plug className="h-5 w-5 text-muted-foreground" />;
    title = "Nenhuma conta conectada";
    subtitle = <>Conecte uma conta abaixo para começar a receber dados.</>;
  } else if (hasCritical) {
    tone = "err";
    icon = <AlertTriangle className="h-5 w-5 text-red-700" />;
    title = `${findings!.critico} problema${findings!.critico > 1 ? "s" : ""} crítico${findings!.critico > 1 ? "s" : ""} detectado${findings!.critico > 1 ? "s" : ""}`;
    subtitle = (
      <>
        A auditoria encontrou inconsistências nos dados.{" "}
        <Link to="/configuracoes" search={{ aba: "auditoria" } as never} className="underline underline-offset-2 hover:text-foreground">
          Ver na Auditoria
        </Link>
      </>
    );
  } else if (activeJobs > 0) {
    tone = "info";
    icon = <Loader2 className="h-5 w-5 text-primary animate-spin" />;
    title = `Processando ${activeJobs} tarefa${activeJobs > 1 ? "s" : ""} em segundo plano`;
    subtitle = jobs && jobs.total > 0 ? (
      <>
        {jobs.done} de {jobs.total} concluída{jobs.total > 1 ? "s" : ""}{jobs.err > 0 ? ` · ${jobs.err} com erro` : ""}
      </>
    ) : null;
  } else if (hasAlerts) {
    tone = "warn";
    icon = <AlertTriangle className="h-5 w-5 text-amber-600" />;
    title = `${findings!.alerta} alerta${findings!.alerta > 1 ? "s" : ""} de auditoria`;
    subtitle = (
      <>
        Última sincronização {timeAgo(lastSync)} · Próxima às 10h30.{" "}
        <Link to="/configuracoes" search={{ aba: "auditoria" } as never} className="underline underline-offset-2 hover:text-foreground">
          Ver na Auditoria
        </Link>
      </>
    );
  } else {
    tone = "ok";
    icon = <ShieldCheck className="h-5 w-5 text-emerald-700" />;
    title = "Dados atualizados e conferidos";
    subtitle = <>Última sincronização {timeAgo(lastSync)} · Próxima às 10h30 (horário de Brasília)</>;
  }

  const toneCls =
    tone === "err" ? "border-red-300 bg-red-50/60" :
    tone === "warn" ? "border-amber-300 bg-amber-50/60" :
    tone === "info" ? "border-primary/30 bg-primary/5" :
    "border-emerald-300 bg-emerald-50/50";

  return (
    <Card className={cn("border", toneCls)}>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5">{icon}</div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{title}</div>
              {subtitle ? <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div> : null}
            </div>
          </div>
          {hasConnected ? <SyncNowButton days={60} /> : null}

        </div>

        {activeJobs > 0 && jobs && jobs.total > 0 ? (
          <Progress value={Math.round((jobs.done / jobs.total) * 100)} className="h-1.5" />
        ) : null}

        {jobs && jobs.stuck > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              {jobs.stuck === 1 ? "Uma tarefa parece travada" : `${jobs.stuck} tarefas parecem travadas`} há mais de 5 minutos. Será{jobs.stuck > 1 ? "ão" : ""} reprocessada{jobs.stuck > 1 ? "s" : ""} automaticamente na próxima rodada.
            </span>
          </div>
        ) : null}

        {jobs && jobs.rateLimited > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-sky-300 bg-sky-50/70 px-3 py-2 text-xs text-sky-800">
            <RefreshCw className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              O Mercado Livre está limitando as requisições. A sincronização continua automaticamente em ritmo mais lento.
            </span>
          </div>
        ) : null}

        {jobs && jobs.failedMax > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50/70 px-3 py-2 text-xs text-red-800">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              {jobs.failedMax} tarefa{jobs.failedMax > 1 ? "s" : ""} falhou{jobs.failedMax > 1 ? "aram" : ""} após 3 tentativas.{" "}
              <Link to="/configuracoes" search={{ aba: "auditoria" } as never} className="underline underline-offset-2 hover:text-red-900">
                Ver na Auditoria
              </Link>
            </span>
          </div>
        ) : null}

        {jobs && jobs.incompletos.length > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              {jobs.incompletos.length === 1 ? "Um período do faturamento ficou" : `${jobs.incompletos.length} períodos do faturamento ficaram`} incompleto{jobs.incompletos.length > 1 ? "s" : ""}: {jobs.incompletos[0]}. Volta{jobs.incompletos.length > 1 ? "m" : ""} para a fila na próxima sincronização.
            </span>
          </div>
        ) : null}

        {hasConnected ? <BackfillPanel /> : null}

        {hasConnected ? (
          <Collapsible open={advOpen} onOpenChange={setAdvOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {advOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Opções avançadas
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-xs text-muted-foreground">Janela:</Label>
                <Select value={String(advDays)} onValueChange={(v) => setAdvDays(Number(v))}>
                  <SelectTrigger className="h-8 w-[180px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">Últimos 3 dias</SelectItem>
                    <SelectItem value="30">Últimos 30 dias</SelectItem>
                    <SelectItem value="90">Últimos 90 dias</SelectItem>
                  </SelectContent>
                </Select>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" disabled={forcing} className="text-red-700 hover:text-red-800 hover:bg-red-50">
                      <RotateCcw className={cn("mr-2 h-3.5 w-3.5", forcing && "animate-spin")} />
                      Forçar reprocessamento completo
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Forçar reprocessamento completo?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Isso busca de novo pedidos, faturamento, <strong>Ads</strong> e <strong>visitas</strong> dos últimos {advDays} dia{advDays > 1 ? "s" : ""} de todas as contas conectadas. Os dados atuais ficam até a nova busca trazer os de cada dia. O processamento continua em segundo plano.
                        <br /><br />
                        Use apenas se realmente desconfiar dos dados.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={runForce}>Reprocessar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Use apenas se desconfiar dos dados. O sistema já verifica e corrige automaticamente a cada 6 horas.
              </p>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </CardContent>
    </Card>
  );
}

const TIPO_SYNC: Record<string, string> = {
  orders: "Pedidos",
  items: "Itens",
  billing: "Faturamento",
  flex: "Flex",
  ads: "ADS",
  full: "Completa",
  audit: "Auditoria",
  token_refresh: "Renovação do token",
  periods: "Períodos",
  enqueue: "Sincronizar agora",
  backfill: "Carga histórica",
  worker: "Fila",
};

function HistoricoSincronizacoes({ accounts }: { accounts: AccountRow[] }) {
  const [account, setAccount] = useState("all");
  const [status, setStatus] = useState("all");

  const { data: logs } = useQuery({
    queryKey: ["sync-logs", account, status],
    queryFn: async () => {
      let q = supabase
        .from("sync_logs")
        .select("id, account_id, sync_type, started_at, finished_at, status, records_processed, error_message")
        .order("started_at", { ascending: false })
        .limit(100);
      if (account !== "all") q = q.eq("account_id", account);
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: (query) => {
      const rows = query.state.data as { status: string }[] | undefined;
      return rows?.some((r) => r.status === "executando") ? 10_000 : false;
    },
  });

  const nickById = new Map(accounts.map((a) => [a.id, a.trade_name?.trim() || a.nickname]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={account} onValueChange={setAccount}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Conta" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as contas</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.trade_name?.trim() || a.nickname}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="sucesso">Sucesso</SelectItem>
            <SelectItem value="parcial">Parcial</SelectItem>
            <SelectItem value="erro">Erro</SelectItem>
            <SelectItem value="executando">Executando</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!logs || logs.length === 0 ? (
        <EmptyState icon={RefreshCw} title="Nenhuma sincronização executada ainda" description="Assim que as sincronizações com o Mercado Livre forem ativadas, seus históricos aparecerão aqui." />
      ) : (
        <Card className="border-border/60 bg-card/60">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  <TableHead>Início</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Registros</TableHead>
                  <TableHead>Duração</TableHead>
                  <TableHead>Erro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => {
                  const duration = l.finished_at && l.started_at
                    ? `${Math.round((new Date(l.finished_at).getTime() - new Date(l.started_at).getTime()) / 1000)}s`
                    : "—";
                  return (
                    <TableRow key={l.id} className="text-sm">
                      <TableCell className="text-muted-foreground">{formatDateTime(l.started_at)}</TableCell>
                      <TableCell>{l.account_id ? nickById.get(l.account_id) ?? "—" : "—"}</TableCell>
                      <TableCell>{TIPO_SYNC[l.sync_type] ?? l.sync_type}</TableCell>
                      <TableCell><Badge variant="outline">{l.status}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{l.records_processed}</TableCell>
                      <TableCell className="text-muted-foreground">{duration}</TableCell>
                      <TableCell className="max-w-xs truncate text-red-700">{l.error_message ?? ""}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AccountDialog({ open, onOpenChange, editing, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: AccountRow | null;
  onSaved: () => void;
}) {
  const isEdit = !!editing;
  const [nickname, setNickname] = useState(editing?.nickname ?? "");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNickname(editing?.nickname ?? "");
      setClientId("");
      setClientSecret("");
    }
  }, [open, editing]);

  const save = async () => {
    setSaving(true);
    try {
      await saveMlAccount({
        data: {
          account_id: isEdit && editing ? editing.id : undefined,
          nickname,
          client_id: clientId || undefined,
          client_secret: clientSecret || undefined,
        },
      });
      toast.success(isEdit ? "Integração atualizada" : "Integração cadastrada");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar integração" : "Adicionar integração"}</DialogTitle>
          <DialogDescription>
            Informe as credenciais do app criado no portal de desenvolvedores do Mercado Livre.
            {isEdit ? " Deixe os campos em branco para manter os valores atuais." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="nickname">Apelido interno</Label>
            <Input id="nickname" placeholder="Ex.: Loja principal" value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client_id">Client ID</Label>
            <Input id="client_id" placeholder="1234567890" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client_secret">Client Secret</Label>
            <Input id="client_secret" type="password" placeholder="••••••••" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !nickname.trim()}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}