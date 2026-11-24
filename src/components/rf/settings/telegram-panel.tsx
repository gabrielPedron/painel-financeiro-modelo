import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Bell, MessageCircle, RefreshCw, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/rf/empty-state";
import { cn } from "@/lib/utils";
import { telegramRunAlertsNow, telegramTestMessage } from "@/lib/telegram-alerts.functions";
import { donoDaEquipe } from "@/lib/equipe";

type TgConfig = {
  id?: string;
  owner_id: string;
  allowed_chat_id: string | null;
  alert_chat_id: string | null;
  is_active: boolean;
  alert_margem_baixa: boolean;
  alert_prejuizo: boolean;
  alert_anuncio_negativo: boolean;
  alert_sem_custo_resumo: boolean;
  margem_minima_pct: number;
  max_alertas_hora: number;
  alerts_started_at: string | null;
};

type AlertRow = {
  id: string;
  created_at: string;
  sent_at: string | null;
  alert_type: string;
  ref_key: string;
  status: string;
  attempts: number;
  last_error: string | null;
  message: string | null;
};

const CFG_KEY = ["telegram_config"] as const;
const LOG_KEY = ["telegram_alert_log"] as const;

const TIPO_LABEL: Record<string, string> = {
  margem_baixa: "Margem baixa",
  prejuizo: "Prejuízo",
  anuncio_negativo: "Anúncio negativo",
  sem_custo_resumo: "Sem custo",
};

export function TelegramPanel() {
  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">Telegram</h2>
        <p className="text-sm text-muted-foreground">
          Canal de alertas: o sistema avisa no grupo quando uma venda ou anúncio sai da margem
          esperada. O bot não recebe mais lançamentos.
        </p>
      </header>
      <ConfigCard />
      <HistoryCard />
    </div>
  );
}

function ConfigCard() {
  const qc = useQueryClient();
  const testFn = useServerFn(telegramTestMessage);
  const runFn = useServerFn(telegramRunAlertsNow);

  const { data, isLoading } = useQuery({
    queryKey: CFG_KEY,
    queryFn: async (): Promise<TgConfig | null> => {
      // A configuração é da equipe (do dono), não de quem está logado (int-03).
      const dono = await donoDaEquipe(supabase);
      const { data, error } = await supabase
        .from("telegram_config")
        .select(
          "id, owner_id, allowed_chat_id, alert_chat_id, is_active, alert_margem_baixa, alert_prejuizo, alert_anuncio_negativo, alert_sem_custo_resumo, margem_minima_pct, max_alertas_hora, alerts_started_at",
        )
        .eq("owner_id", dono)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as TgConfig | null) ?? null;
    },
  });

  const [form, setForm] = useState<TgConfig | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setForm(
      data ?? {
        owner_id: "",
        allowed_chat_id: null,
        alert_chat_id: null,
        is_active: false,
        alert_margem_baixa: false,
        alert_prejuizo: false,
        alert_anuncio_negativo: false,
        alert_sem_custo_resumo: false,
        margem_minima_pct: 10,
        max_alertas_hora: 20,
        alerts_started_at: null,
      },
    );
  }, [data, dirty]);

  const set = <K extends keyof TgConfig>(k: K, v: TgConfig[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const dono = await donoDaEquipe(supabase);
      const anyAlert =
        form.alert_margem_baixa ||
        form.alert_prejuizo ||
        form.alert_anuncio_negativo ||
        form.alert_sem_custo_resumo;
      const payload = {
        owner_id: dono,
        allowed_chat_id: (form.allowed_chat_id ?? "").replace(/\s+/g, "") || null,
        alert_chat_id: (form.alert_chat_id ?? "").replace(/\s+/g, "") || null,
        is_active: form.is_active,
        alert_margem_baixa: form.alert_margem_baixa,
        alert_prejuizo: form.alert_prejuizo,
        alert_anuncio_negativo: form.alert_anuncio_negativo,
        alert_sem_custo_resumo: form.alert_sem_custo_resumo,
        margem_minima_pct: Number(form.margem_minima_pct) || 0,
        max_alertas_hora: Number(form.max_alertas_hora) || 20,
        // Só vendas a partir da ativação geram alerta.
        alerts_started_at:
          form.alerts_started_at ?? (anyAlert && form.is_active ? new Date().toISOString() : null),
      };
      const { error } = await supabase
        .from("telegram_config")
        .upsert(payload, { onConflict: "owner_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configuração salva");
      setDirty(false);
      qc.invalidateQueries({ queryKey: CFG_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: async () => await testFn({}),
    onSuccess: (r) =>
      r?.ok ? toast.success("Mensagem de teste enviada") : toast.error(r?.error ?? "Falhou"),
    onError: (e: Error) => toast.error(e.message),
  });

  const runNow = useMutation({
    mutationFn: async () => await runFn({ data: { mode: "sales" } }),
    onSuccess: (r) => {
      toast.success(`${r.enfileirados} novo(s) alerta(s), ${r.enviados} enviado(s)`);
      qc.invalidateQueries({ queryKey: LOG_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !form) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  const chat = form.alert_chat_id || form.allowed_chat_id || "";

  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Bell className="h-4 w-4" /> Alertas
        </CardTitle>
        {form.is_active ? <Badge>Ativo</Badge> : <Badge variant="secondary">Inativo</Badge>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="tg-chat">Chat / grupo de destino</Label>
          <Input
            id="tg-chat"
            value={form.alert_chat_id ?? form.allowed_chat_id ?? ""}
            onChange={(e) => set("alert_chat_id", e.target.value)}
            placeholder="-1001234567890"
          />
          <p className="text-xs text-muted-foreground">
            Adicione o bot ao grupo e cole aqui o ID (grupos têm ID negativo). Para mandar a um tópico do grupo,
            acrescente dois-pontos e o número do tópico (o do meio no link de uma mensagem dele): -1001234567890:146.
          </p>
        </div>

        <ToggleRow
          id="tg-active"
          label="Ativar envio de alertas"
          hint="Só vendas posteriores à ativação são consideradas."
          checked={form.is_active}
          onChange={(v) => set("is_active", v)}
        />
        <ToggleRow
          id="tg-prej"
          label="Venda com prejuízo"
          hint="Margem de contribuição negativa."
          checked={form.alert_prejuizo}
          onChange={(v) => set("alert_prejuizo", v)}
        />
        <ToggleRow
          id="tg-baixa"
          label="Venda com margem abaixo do esperado"
          hint="Usa o limite configurado abaixo."
          checked={form.alert_margem_baixa}
          onChange={(v) => set("alert_margem_baixa", v)}
        />
        <ToggleRow
          id="tg-ads"
          label="Anúncio com MC% negativa"
          hint="Verificado uma vez por dia, sem repetir enquanto continuar negativo."
          checked={form.alert_anuncio_negativo}
          onChange={(v) => set("alert_anuncio_negativo", v)}
        />
        <ToggleRow
          id="tg-semcusto"
          label="Resumo de vendas sem custo cadastrado"
          hint="Vendas sem custo nunca geram alerta de margem; este resumo avisa quantas são."
          checked={form.alert_sem_custo_resumo}
          onChange={(v) => set("alert_sem_custo_resumo", v)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tg-min">Margem mínima (%)</Label>
            <Input
              id="tg-min"
              type="number"
              step="0.5"
              value={form.margem_minima_pct}
              onChange={(e) => set("margem_minima_pct", Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tg-max">Máximo de mensagens por hora</Label>
            <Input
              id="tg-max"
              type="number"
              value={form.max_alertas_hora}
              onChange={(e) => set("max_alertas_hora", Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Se estourar, os alertas viram uma única mensagem de resumo.
            </p>
          </div>
        </div>

        {form.alerts_started_at ? (
          <p className="text-xs text-muted-foreground">
            Alertas valendo desde {new Date(form.alerts_started_at).toLocaleString("pt-BR")}.
            Pedidos anteriores foram marcados como já notificados.
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => test.mutate()}
            disabled={test.isPending || !chat}
          >
            <Send className="mr-2 h-4 w-4" />
            {test.isPending ? "Enviando..." : "Enviar teste"}
          </Button>
          <Button variant="outline" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
            <RefreshCw className={cn("mr-2 h-4 w-4", runNow.isPending && "animate-spin")} />
            Verificar agora
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
            {save.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border/60 bg-background/60 p-3">
      <div>
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "enviado"
      ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30"
      : status === "erro"
        ? "bg-red-500/15 text-red-700 border-red-500/30"
        : status === "pendente"
          ? "bg-amber-500/15 text-amber-700 border-amber-500/30"
          : "bg-muted text-muted-foreground border-border/60";
  return (
    <Badge variant="outline" className={cn("border", cls)}>
      {status}
    </Badge>
  );
}

function HistoryCard() {
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: LOG_KEY,
    queryFn: async (): Promise<AlertRow[]> => {
      const { data, error } = await supabase
        .from("telegram_alert_log")
        .select("id, created_at, sent_at, alert_type, ref_key, status, attempts, last_error, message")
        .neq("status", "suprimido")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data as unknown as AlertRow[]) ?? [];
    },
  });

  const rows = data ?? [];

  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <MessageCircle className="h-4 w-4" /> Alertas recentes
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => qc.invalidateQueries({ queryKey: LOG_KEY })}
          disabled={isFetching}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />
          Atualizar
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title="Nenhum alerta ainda"
            description="Assim que uma venda ficar abaixo da margem, ela aparece aqui."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Quando</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Referência</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Detalhe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap tabular-nums text-xs">
                      {new Date(r.sent_at ?? r.created_at).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {TIPO_LABEL[r.alert_type] ?? r.alert_type}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.ref_key}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="max-w-[320px] text-xs text-muted-foreground">
                      {r.last_error ?? (r.attempts > 1 ? `${r.attempts} tentativas` : "—")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
