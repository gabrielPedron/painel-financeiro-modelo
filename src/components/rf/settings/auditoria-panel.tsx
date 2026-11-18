import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Play, ShieldCheck, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/rf/empty-state";
import { formatDateTime } from "@/lib/format";
import { useMyScreens } from "@/hooks/use-screens";
import { podeUsar } from "@/lib/equipe";
import { cn } from "@/lib/utils";
import { runAuditNow, ignoreFinding, autoFixFinding, reopenFinding, classifySubtype } from "@/lib/audit.functions";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tag } from "lucide-react";

type Finding = {
  id: string;
  account_id: string | null;
  check_code: string;
  severity: "critico" | "alerta" | "info";
  status: "aberto" | "corrigindo" | "resolvido" | "ignorado";
  title: string;
  detail: string | null;
  expected: number | null;
  actual: number | null;
  diff: number | null;
  context: Record<string, unknown>;
  auto_fixable: boolean;
  first_seen_at: string;
  last_seen_at: string;
};

export function AuditoriaPanel() {
  const { data: telas } = useMyScreens();
  const podeClassificar = podeUsar(telas?.keys ?? [], "configuracoes:regras");
  const qc = useQueryClient();
  const runFn = useServerFn(runAuditNow);
  const ignoreFn = useServerFn(ignoreFinding);
  const fixFn = useServerFn(autoFixFinding);
  const reopenFn = useServerFn(reopenFinding);
  const classifyFn = useServerFn(classifySubtype);
  const [showResolved, setShowResolved] = useState(false);
  const [classifyTarget, setClassifyTarget] = useState<null | { finding_id: string; sub_type: string; suggested_label: string }>(null);

  const { data: findings, isLoading } = useQuery({
    queryKey: ["audit-findings", showResolved],
    queryFn: async () => {
      const q = supabase
        .from("audit_findings")
        .select("id, account_id, check_code, severity, status, title, detail, expected, actual, diff, context, auto_fixable, first_seen_at, last_seen_at")
        .order("severity", { ascending: true })
        .order("last_seen_at", { ascending: false });
      if (!showResolved) q.in("status", ["aberto", "corrigindo"]);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Finding[];
    },
  });

  const { data: lastAudit } = useQuery({
    queryKey: ["audit-last-run"],
    queryFn: async () => {
      const { data } = await supabase
        .from("sync_logs")
        .select("started_at")
        .eq("sync_type", "audit")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.started_at ?? null;
    },
  });

  const runMut = useMutation({
    mutationFn: async () => await runFn({}),
    onSuccess: (r) => {
      toast.success(`Auditoria executada. ${r.findings} achado(s), ${r.resolved} resolvido(s).`);
      qc.invalidateQueries({ queryKey: ["audit-findings"] });
      qc.invalidateQueries({ queryKey: ["audit-last-run"] });
      qc.invalidateQueries({ queryKey: ["audit-open-count"] });
    },
    onError: (e: Error) => toast.error(`Falha: ${e.message}`),
  });

  const grouped = useMemo(() => {
    const g: Record<string, Finding[]> = { critico: [], alerta: [], info: [] };
    for (const f of findings ?? []) {
      if (f.status === "resolvido" || f.status === "ignorado") continue;
      g[f.severity].push(f);
    }
    return g;
  }, [findings]);

  const openCount = grouped.critico.length + grouped.alerta.length + grouped.info.length;
  const lastLabel = lastAudit ? formatDateTime(lastAudit) : "nunca";

  return (
    <div className="space-y-4">
      <Card className="border-border/60 bg-card/60">
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm">
              <span className="font-medium">Última verificação:</span>{" "}
              <span className="text-muted-foreground">{lastLabel}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs">
              <SeverityChip label="Críticos" count={grouped.critico.length} tone="critico" />
              <SeverityChip label="Alertas" count={grouped.alerta.length} tone="alerta" />
              <SeverityChip label="Informativos" count={grouped.info.length} tone="info" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
              Mostrar resolvidos/ignorados
            </label>
            <Button size="sm" onClick={() => runMut.mutate()} disabled={runMut.isPending}>
              <Play className={cn("mr-2 h-4 w-4", runMut.isPending && "animate-pulse")} />
              {runMut.isPending ? "Executando..." : "Executar auditoria agora"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando...</div>
      ) : openCount === 0 && !showResolved ? (
        <EmptyState
          icon={ShieldCheck}
          title="Nenhum problema detectado"
          description={`Última verificação: ${lastLabel}. Todos os dados batem com a API do Mercado Livre.`}
        />
      ) : (
        <div className="space-y-4">
          {(["critico", "alerta", "info"] as const).map((sev) => {
            const list = grouped[sev];
            if (list.length === 0 && !showResolved) return null;
            return (
              <section key={sev} className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <SeverityDot tone={sev} />
                  {sev === "critico" ? "Críticos" : sev === "alerta" ? "Alertas" : "Informativos"}
                  <span className="text-muted-foreground font-normal">({list.length})</span>
                </h3>
                <div className="space-y-2">
                  {list.map((f) => (
                    <FindingCard
                      key={f.id}
                      finding={f}
                      onFix={async () => {
                        try {
                          await fixFn({ data: { finding_id: f.id } });
                          toast.success("Correção enfileirada.");
                          qc.invalidateQueries({ queryKey: ["audit-findings"] });
                          qc.invalidateQueries({ queryKey: ["ads-queue"] });
                        } catch (e) { toast.error((e as Error).message); }
                      }}
                      onIgnore={async () => {
                        if (!confirm("Ignorar este achado? Ele deixará de aparecer até reaparecer com contexto diferente.")) return;
                        try {
                          await ignoreFn({ data: { finding_id: f.id } });
                          qc.invalidateQueries({ queryKey: ["audit-findings"] });
                          qc.invalidateQueries({ queryKey: ["audit-open-count"] });
                        } catch (e) { toast.error((e as Error).message); }
                      }}
                      onReopen={async () => {
                        try {
                          await reopenFn({ data: { finding_id: f.id } });
                          qc.invalidateQueries({ queryKey: ["audit-findings"] });
                        } catch (e) { toast.error((e as Error).message); }
                      }}
                      onClassify={
                        // Classificar muda o mapa global de tarifas: o servidor exige a aba Regras (seg-05).
                        f.check_code === "unclassified_subtype" && podeClassificar
                          ? () => {
                              const sub = String((f.context as { sub_type?: string })?.sub_type ?? "");
                              const label = (f.detail ?? "").split("Descrição:")[1]?.trim().replace(/\.$/, "") ?? "";
                              setClassifyTarget({ finding_id: f.id, sub_type: sub, suggested_label: label });
                            }
                          : undefined
                      }
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {showResolved ? <ResolvedList findings={findings ?? []} /> : null}
        </div>
      )}
      <ClassifyDialog
        target={classifyTarget}
        onClose={() => setClassifyTarget(null)}
        onSubmit={async ({ sub_type, category, label, escopo, conta_no_custo }) => {
          try {
            await classifyFn({ data: { sub_type, category, label: label || null, escopo, conta_no_custo } });
            toast.success(`"${sub_type}" classificado como ${category}.`);
            setClassifyTarget(null);
            qc.invalidateQueries({ queryKey: ["audit-findings"] });
            qc.invalidateQueries({ queryKey: ["audit-open-count"] });
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </div>
  );
}

function ResolvedList({ findings }: { findings: Finding[] }) {
  const list = findings.filter((f) => f.status === "resolvido" || f.status === "ignorado");
  if (list.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
        <CheckCircle2 className="h-4 w-4" /> Resolvidos / ignorados ({list.length})
      </h3>
      <div className="space-y-1.5">
        {list.map((f) => (
          <Card key={f.id} className="border-border/60 bg-muted/30">
            <CardContent className="p-3 text-xs flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate">{f.title}</div>
                <div className="text-muted-foreground">{f.status === "resolvido" ? "Resolvido" : "Ignorado"} · último em {formatDateTime(f.last_seen_at)}</div>
              </div>
              <Badge variant="outline" className="text-[10px]">{f.check_code}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function FindingCard({ finding, onFix, onIgnore, onReopen, onClassify }: {
  finding: Finding;
  onFix: () => Promise<void>;
  onIgnore: () => Promise<void>;
  onReopen: () => Promise<void>;
  onClassify?: () => void;
}) {
  void onReopen;
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<null | "fix" | "ignore">(null);
  const borderTone = finding.severity === "critico" ? "border-red-300 bg-red-50/60"
    : finding.severity === "alerta" ? "border-amber-300 bg-amber-50/60"
    : "border-border/60 bg-card/60";
  return (
    <Card className={cn("border", borderTone)}>
      <CardContent className="p-3 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <div className="text-sm font-medium">{finding.title}</div>
            {finding.detail ? (
              <div className="text-xs text-muted-foreground">{finding.detail}</div>
            ) : null}
            <div className="text-[11px] text-muted-foreground">
              Detectado em {formatDateTime(finding.first_seen_at)} · último em {formatDateTime(finding.last_seen_at)}
            </div>
            {finding.expected != null || finding.actual != null ? (
              <div className="text-[11px] tabular-nums text-muted-foreground">
                Esperado: {finding.expected ?? "—"} · Encontrado: {finding.actual ?? "—"}
                {finding.diff != null ? ` · Diferença: ${finding.diff}` : ""}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            {finding.status === "corrigindo" ? (
              <Badge className="bg-primary/15 text-primary">Corrigindo</Badge>
            ) : null}
            {onClassify ? (
              <Button size="sm" variant="secondary" onClick={onClassify}>
                <Tag className="mr-1.5 h-3.5 w-3.5" /> Classificar
              </Button>
            ) : null}
            {finding.auto_fixable && finding.status !== "corrigindo" ? (
              <Button size="sm" variant="default" disabled={busy !== null} onClick={async () => { setBusy("fix"); try { await onFix(); } finally { setBusy(null); } }}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Corrigir agora
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={async () => { setBusy("ignore"); try { await onIgnore(); } finally { setBusy(null); } }}>
              <X className="mr-1.5 h-3.5 w-3.5" /> Ignorar
            </Button>
          </div>
        </div>
        <button
          type="button" onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Ver detalhes
        </button>
        {expanded ? (
          <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-auto max-h-40">{JSON.stringify(finding.context, null, 2)}</pre>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SeverityChip({ label, count, tone }: { label: string; count: number; tone: "critico" | "alerta" | "info" }) {
  const cls = tone === "critico" ? "bg-red-100 text-red-700"
    : tone === "alerta" ? "bg-amber-100 text-amber-700"
    : "bg-blue-100 text-blue-700";
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5", cls)}>
    <SeverityDot tone={tone} /> {label}: <span className="tabular-nums font-medium">{count}</span>
  </span>;
}

function SeverityDot({ tone }: { tone: "critico" | "alerta" | "info" }) {
  const cls = tone === "critico" ? "bg-red-600" : tone === "alerta" ? "bg-amber-500" : "bg-blue-500";
  return <span className={cn("h-2 w-2 rounded-full", cls)} />;
}

export function useOpenFindingsCount() {
  return useQuery({
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
      return { critico, alerta, total: critico + alerta };
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

// unused imports guard
void AlertTriangle;

type Category =
  | "comissao"
  | "parcelamento"
  | "frete"
  | "full"
  | "ads"
  | "estorno"
  | "financiamento"
  | "outros";

type Escopo = "pedido" | "periodo";

const CATEGORY_OPTIONS: Array<{ value: Category; label: string }> = [
  { value: "comissao", label: "Comissão" },
  { value: "parcelamento", label: "Parcelamento (compõe comissão)" },
  { value: "frete", label: "Frete" },
  { value: "full", label: "Full (fulfillment)" },
  { value: "ads", label: "Ads" },
  { value: "estorno", label: "Estorno / bonificação" },
  { value: "financiamento", label: "Financiamento" },
  { value: "outros", label: "Outros" },
];

function ClassifyDialog({
  target,
  onClose,
  onSubmit,
}: {
  target: { finding_id: string; sub_type: string; suggested_label: string } | null;
  onClose: () => void;
  onSubmit: (v: { sub_type: string; category: Category; label: string; escopo: Escopo; conta_no_custo: boolean }) => Promise<void>;
}) {
  const [category, setCategory] = useState<Category>("outros");
  const [label, setLabel] = useState("");
  // Sem escopo a tarifa não entra em conta nenhuma: a escolha é obrigatória (aud-04).
  const [escopo, setEscopo] = useState<Escopo | "">("");
  const [contaNoCusto, setContaNoCusto] = useState(true);
  const [busy, setBusy] = useState(false);
  const open = target !== null;
  // Reset ao abrir
  useMemo(() => {
    if (target) {
      setCategory("outros");
      setLabel(target.suggested_label ?? "");
      setEscopo("");
      setContaNoCusto(true);
    }
  }, [target]);
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Classificar taxa</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Sub_type</Label>
            <Input value={target?.sub_type ?? ""} readOnly className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs">Categoria</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Como o ML cobra</Label>
            <Select value={escopo} onValueChange={(v) => setEscopo(v as Escopo)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pedido">Por pedido (entra na Conciliação, venda a venda)</SelectItem>
                <SelectItem value="periodo">Do período (entra nos custos do mês: Dashboard e tela ML)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {escopo === "periodo" ? (
            <div className="flex items-start gap-2">
              <Checkbox id="conta-no-custo" checked={contaNoCusto} onCheckedChange={(v) => setContaNoCusto(v === true)} className="mt-0.5" />
              <Label htmlFor="conta-no-custo" className="text-xs font-normal leading-snug">
                Conta no custo. Desmarque só se o valor já entra em outra conta (por exemplo, já descontado na venda).
              </Label>
            </div>
          ) : null}
          <div>
            <Label className="text-xs">Rótulo (opcional)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1" placeholder="Ex.: Tarifa de manutenção da Minha página" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button
            onClick={async () => {
              if (!target || !escopo) return;
              setBusy(true);
              try {
                await onSubmit({
                  sub_type: target.sub_type, category, label, escopo,
                  conta_no_custo: escopo === "pedido" || contaNoCusto,
                });
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy || !target?.sub_type || !escopo}
          >
            {busy ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}