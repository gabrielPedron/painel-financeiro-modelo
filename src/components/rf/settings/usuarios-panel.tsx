import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Users, ShieldCheck, Copy, Lock, Trash2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/rf/empty-state";
import { SCREENS, CONFIG_TABS, configTabKey } from "@/hooks/use-screens";
import { SENHA_MINIMA } from "@/lib/senha";

type TeamUser = { member_id: string; email: string; display_name: string | null; is_admin: boolean };

async function adminPost(payload: Record<string, unknown>) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Entre novamente.");
  let res: Response;
  try {
    res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, access_token: token }),
    });
  } catch {
    throw new Error("Não foi possível contatar o servidor. Publique o app e tente novamente.");
  }
  let json: { ok?: boolean; error?: string; user_id?: string };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new Error(
      `Falha na comunicação com o servidor (${res.status}). Se você está no preview, publique o app para ativar as funções de servidor.`,
    );
  }
  if (!res.ok || !json.ok) throw new Error(json.error || `Falha na operação (${res.status}).`);
  return json;
}

function randomPassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const arr = new Uint32Array(Math.max(12, SENHA_MINIMA));
  crypto.getRandomValues(arr);
  for (const n of arr) out += chars[n % chars.length];
  return out;
}

export function UsuariosPanel() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<TeamUser | null>(null);
  const [novoOpen, setNovoOpen] = useState(false);

  const { data: isAdmin, isLoading: loadingAdmin } = useQuery({
    queryKey: ["is-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_admin");
      if (error) throw error;
      return Boolean(data);
    },
  });

  const { data: users } = useQuery({
    queryKey: ["team-users"],
    enabled: isAdmin === true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("team_users");
      if (error) throw error;
      return (data ?? []) as TeamUser[];
    },
  });

  if (loadingAdmin) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <header>
          <h2 className="text-xl font-semibold tracking-tight">Usuários</h2>
        </header>
        <EmptyState icon={Lock} title="Acesso restrito" description="Somente o administrador pode gerenciar usuários." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Usuários</h2>
          <p className="text-sm text-muted-foreground">Controle de acesso da equipe.</p>
        </div>
        <Button size="sm" onClick={() => setNovoOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Novo usuário
        </Button>
      </header>

      {!users || users.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum usuário" description="Crie o primeiro usuário da equipe." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {users.map((u) => (
            <Card
              key={u.member_id}
              onClick={() => { if (!u.is_admin) setEditing(u); }}
              className={
                "border-border/60 bg-card/60 " +
                (u.is_admin ? "opacity-90" : "cursor-pointer transition-colors hover:border-primary/50")
              }
            >
              <CardContent className="p-4 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{u.display_name || "Sem nome"}</span>
                  {u.is_admin ? (
                    <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" /> Admin</Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                <p className="text-xs text-muted-foreground">
                  {u.is_admin ? "Não editável" : "Clique para editar acessos"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NovoUsuarioDialog
        open={novoOpen}
        onOpenChange={setNovoOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: ["team-users"] })}
      />
      <EditarUsuarioDialog user={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function NovoUsuarioDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [criado, setCriado] = useState<{ email: string; senha: string } | null>(null);

  const create = useMutation({
    mutationFn: async () => adminPost({ action: "create_user", email, password: senha, display_name: nome }),
    onSuccess: () => {
      setCriado({ email, senha });
      setNome(""); setEmail(""); setSenha("");
      toast.success("Usuário criado.");
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const close = (v: boolean) => {
    if (!v) { setCriado(null); setNome(""); setEmail(""); setSenha(""); }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo usuário</DialogTitle></DialogHeader>
        {criado ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Guarde estes dados e envie ao funcionário — a senha não poderá ser consultada depois.
            </p>
            <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-sm font-mono break-all">
              Login: {criado.email}
              <br />
              Senha: {criado.senha}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(`Login: ${criado.email}\nSenha: ${criado.senha}`);
                toast.success("Copiado.");
              }}
            >
              <Copy className="mr-2 h-4 w-4" /> Copiar
            </Button>
            <DialogFooter>
              <Button onClick={() => close(false)}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Senha</Label>
              <div className="flex gap-2">
                <Input value={senha} onChange={(e) => setSenha(e.target.value)} placeholder={`mínimo ${SENHA_MINIMA} caracteres`} />
                <Button type="button" variant="outline" onClick={() => setSenha(randomPassword())}>Gerar</Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>Cancelar</Button>
              <Button onClick={() => create.mutate()} disabled={create.isPending || senha.length < SENHA_MINIMA}>
                {create.isPending ? "Criando..." : "Criar usuário"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditarUsuarioDialog({ user, onClose }: { user: TeamUser | null; onClose: () => void }) {
  const qc = useQueryClient();
  const memberId = user?.member_id ?? null;
  const [nome, setNome] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [nomeInit, setNomeInit] = useState<string | null>(null);

  if (user && nomeInit !== user.member_id) {
    setNomeInit(user.member_id);
    setNome(user.display_name || "");
    setNovaSenha("");
  }

  const { data: access } = useQuery({
    queryKey: ["screen-access", memberId],
    enabled: !!memberId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_screen_access")
        .select("screen_key")
        .eq("member_id", memberId!);
      if (error) throw error;
      return (data ?? []).map((r) => r.screen_key);
    },
  });

  const saveName = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("account_members")
        .update({ display_name: nome.trim() })
        .eq("member_id", memberId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nome atualizado.");
      qc.invalidateQueries({ queryKey: ["team-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setPassword = useMutation({
    mutationFn: async () => adminPost({ action: "update_password", member_id: memberId, password: novaSenha }),
    onSuccess: () => { toast.success("Senha alterada."); setNovaSenha(""); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleScreen = useMutation({
    mutationFn: async ({ add, del }: { add: string[]; del: string[] }) => {
      // As telas ficam na equipe do dono, mesmo quando quem libera é outro administrador.
      const { data: dono, error: erroDono } = await supabase.rpc("team_owner");
      if (erroDono || !dono) throw new Error("Sessão inválida.");
      if (del.length > 0) {
        const { error } = await supabase
          .from("user_screen_access")
          .delete()
          .eq("member_id", memberId!)
          .in("screen_key", del);
        if (error) throw error;
      }
      if (add.length > 0) {
        const { error } = await supabase
          .from("user_screen_access")
          .upsert(
            add.map((screen_key) => ({ root_owner_id: dono, member_id: memberId!, screen_key })),
            { onConflict: "member_id,screen_key", ignoreDuplicates: true },
          );
        if (error) throw error;
      }
    },
    onMutate: async ({ add, del }: { add: string[]; del: string[] }) => {
      await qc.cancelQueries({ queryKey: ["screen-access", memberId] });
      const previous = qc.getQueryData<string[]>(["screen-access", memberId]);
      qc.setQueryData<string[]>(["screen-access", memberId], (old) => {
        const list = (old ?? []).filter((k) => !del.includes(k));
        return Array.from(new Set([...list, ...add]));
      });
      return { previous };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["screen-access", memberId], ctx.previous);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["screen-access", memberId] }),
  });

  const keys = access ?? [];
  const allTabKeys = CONFIG_TABS.map((t) => configTabKey(t.key));

  const toggleTela = (key: string, on: boolean) => {
    if (key !== "configuracoes") {
      toggleScreen.mutate(on ? { add: [key], del: [] } : { add: [], del: [key] });
      return;
    }
    if (on) toggleScreen.mutate({ add: ["configuracoes", ...allTabKeys].filter((k) => !keys.includes(k)), del: [] });
    else toggleScreen.mutate({ add: [], del: ["configuracoes", ...allTabKeys] });
  };

  const toggleAba = (tabKey: string, on: boolean) => {
    const k = configTabKey(tabKey);
    if (on) {
      const add = [k, ...(keys.includes("configuracoes") ? [] : ["configuracoes"])];
      toggleScreen.mutate({ add: add.filter((x) => !keys.includes(x)), del: [] });
    } else {
      toggleScreen.mutate({ add: [], del: [k] });
    }
  };

  const remove = useMutation({
    mutationFn: async () => adminPost({ action: "delete_user", member_id: memberId }),
    onSuccess: () => {
      toast.success("Usuário excluído.");
      qc.invalidateQueries({ queryKey: ["team-users"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!user} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Editar usuário</DialogTitle></DialogHeader>
        {user ? (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <div className="flex gap-2">
                <Input value={nome} onChange={(e) => setNome(e.target.value)} />
                <Button variant="outline" onClick={() => saveName.mutate()} disabled={saveName.isPending}>Salvar</Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Email</Label>
              {/* Somente leitura. Trocar email exige uma nova action admin (updateUserById com email). */}
              <Input value={user.email} readOnly disabled />
            </div>

            <div className="space-y-1.5">
              <Label>Nova senha</Label>
              <div className="flex gap-2">
                <Input value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} placeholder={`mínimo ${SENHA_MINIMA} caracteres`} />
                <Button
                  variant="outline"
                  onClick={() => setPassword.mutate()}
                  disabled={setPassword.isPending || novaSenha.length < SENHA_MINIMA}
                >
                  Definir
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Telas permitidas</Label>
              <div className="rounded-md border border-border/60 divide-y divide-border/60">
                {SCREENS.map((s) => {
                  const on = keys.includes(s.key);
                  if (s.key !== "configuracoes") {
                    return (
                      <div key={s.key} className="flex items-center justify-between px-3 py-2">
                        <span className="text-sm">{s.label}</span>
                        <Switch checked={on} onCheckedChange={(v) => toggleTela(s.key, v)} />
                      </div>
                    );
                  }
                  return (
                    <div key={s.key} className="px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">{s.label}</span>
                        <Switch checked={on} onCheckedChange={(v) => toggleTela(s.key, v)} />
                      </div>
                      <div className="mt-2 space-y-1 border-l border-border/60 pl-6">
                        {CONFIG_TABS.map((t) => (
                          <div key={t.key} className="flex items-center justify-between py-1">
                            <span className="text-xs text-muted-foreground">{t.label}</span>
                            <Switch
                              checked={keys.includes(configTabKey(t.key))}
                              onCheckedChange={(v) => toggleAba(t.key, v)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="justify-between sm:justify-between">
              <Button
                variant="destructive"
                onClick={() => {
                  if (window.confirm("Excluir este usuário? Ele perderá o acesso ao sistema.")) remove.mutate();
                }}
                disabled={remove.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Excluir usuário
              </Button>
              <Button variant="outline" onClick={onClose}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
