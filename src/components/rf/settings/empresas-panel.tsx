import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Building2, Pencil, Percent, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/rf/empty-state";
import { formatDate, formatPercent } from "@/lib/format";
import { toast } from "sonner";

type AccountRow = {
  id: string;
  nickname: string;
  trade_name: string | null;
  cnpj: string | null;
  legal_name: string | null;
  tax_regime: string | null;
};

type TaxRateRow = {
  id: string;
  account_id: string;
  rate: number;
  valid_from: string;
  valid_to: string | null;
  note: string | null;
};

const REGIME_LABELS: Record<string, string> = {
  simples_nacional: "Simples",
  lucro_presumido: "Lucro presumido",
  lucro_real: "Lucro real",
  mei: "MEI",
};

function formatCnpj(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 14);
  const p1 = d.slice(0, 2);
  const p2 = d.slice(2, 5);
  const p3 = d.slice(5, 8);
  const p4 = d.slice(8, 12);
  const p5 = d.slice(12, 14);
  let out = p1;
  if (d.length > 2) out += "." + p2;
  if (d.length > 5) out += "." + p3;
  if (d.length > 8) out += "/" + p4;
  if (d.length > 12) out += "-" + p5;
  return out;
}

function parseRate(input: string): number {
  const normalized = input.replace(/\./g, "").replace(",", ".").trim();
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function EmpresasPanel({ onGoIntegracoes }: { onGoIntegracoes: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [rateDialog, setRateDialog] = useState<AccountRow | null>(null);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketplace_accounts")
        .select("id, nickname, trade_name, cnpj, legal_name, tax_regime")
        .eq("platform", "mercado_livre")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AccountRow[];
    },
  });

  const accountIds = (accounts ?? []).map((a) => a.id);
  const { data: currentRates } = useQuery({
    queryKey: ["current-tax-rates", accountIds.join(",")],
    enabled: accountIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_tax_rates")
        .select("id, account_id, rate, valid_from, valid_to, note")
        .in("account_id", accountIds)
        .is("valid_to", null);
      if (error) throw error;
      const map = new Map<string, TaxRateRow>();
      (data ?? []).forEach((r) => map.set(r.account_id, r as TaxRateRow));
      return map;
    },
  });

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando...</div>
      ) : !accounts || accounts.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nenhuma empresa cadastrada"
          description="As empresas são criadas junto com as contas de marketplace."
          action={
            <Button size="sm" onClick={onGoIntegracoes}>Ir para Integrações</Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((acc) => {
            const title = acc.trade_name?.trim() || acc.nickname;
            const rate = currentRates?.get(acc.id);
            const regimeLabel = REGIME_LABELS[acc.tax_regime ?? "simples_nacional"] ?? "Simples";
            return (
              <Card key={acc.id} className="border-border/60 bg-card/60">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {acc.cnpj ? formatCnpj(acc.cnpj) : "CNPJ: —"}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground/80">
                        {acc.legal_name ?? "Razão social: —"}
                      </div>
                    </div>
                    <Badge variant="outline" className="tabular-nums">
                      {regimeLabel} · {rate ? formatPercent(Number(rate.rate)) : "—"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-end gap-1 pt-1">
                    <Button size="sm" variant="ghost" onClick={() => setRateDialog(acc)}>
                      <Percent className="mr-2 h-4 w-4" /> Alíquotas
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(acc)}>
                      <Pencil className="mr-2 h-4 w-4" /> Editar dados fiscais
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <FiscalDialog
        account={editing}
        onOpenChange={(v) => { if (!v) setEditing(null); }}
        onSaved={() => qc.invalidateQueries({ queryKey: ["empresas"] })}
      />
      <TaxRateDialog
        account={rateDialog}
        onOpenChange={(v) => { if (!v) setRateDialog(null); }}
        onSaved={() => qc.invalidateQueries({ queryKey: ["current-tax-rates"] })}
      />
    </div>
  );
}

function FiscalDialog({ account, onOpenChange, onSaved }: {
  account: AccountRow | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const open = !!account;
  const [tradeName, setTradeName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [legalName, setLegalName] = useState("");
  const [taxRegime, setTaxRegime] = useState<string>("simples_nacional");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (account) {
      setTradeName(account.trade_name ?? "");
      setCnpj(account.cnpj ? formatCnpj(account.cnpj) : "");
      setLegalName(account.legal_name ?? "");
      setTaxRegime(account.tax_regime ?? "simples_nacional");
    }
  }, [account]);

  const save = async () => {
    if (!account) return;
    setSaving(true);
    try {
      const cnpjDigits = cnpj.replace(/\D/g, "") || null;
      const { error } = await supabase.from("marketplace_accounts").update({
        trade_name: tradeName.trim() || null,
        cnpj: cnpjDigits,
        legal_name: legalName.trim() || null,
        tax_regime: taxRegime,
      }).eq("id", account.id);
      if (error) throw error;
      toast.success("Dados fiscais atualizados");
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
          <DialogTitle>Editar dados fiscais</DialogTitle>
          <DialogDescription>Informe os dados da empresa vinculada a esta conta de marketplace.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="trade_name">Nome fantasia</Label>
            <Input id="trade_name" value={tradeName} onChange={(e) => setTradeName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cnpj">CNPJ</Label>
              <Input id="cnpj" placeholder="00.000.000/0000-00" value={cnpj} onChange={(e) => setCnpj(formatCnpj(e.target.value))} inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tax_regime">Regime tributário</Label>
              <Select value={taxRegime} onValueChange={setTaxRegime}>
                <SelectTrigger id="tax_regime"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="simples_nacional">Simples Nacional</SelectItem>
                  <SelectItem value="lucro_presumido">Lucro Presumido</SelectItem>
                  <SelectItem value="lucro_real">Lucro Real</SelectItem>
                  <SelectItem value="mei">MEI</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="legal_name">Razão social</Label>
            <Input id="legal_name" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaxRateDialog({ account, onOpenChange, onSaved }: {
  account: AccountRow | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const open = !!account;
  const qc = useQueryClient();
  const [rate, setRate] = useState("");
  const [validFrom, setValidFrom] = useState(todayIso());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [originalFrom, setOriginalFrom] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaxRateRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: history, isLoading } = useQuery({
    queryKey: ["tax-rates", account?.id],
    enabled: !!account,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_tax_rates")
        .select("id, account_id, rate, valid_from, valid_to, note")
        .eq("account_id", account!.id)
        .order("valid_from", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TaxRateRow[];
    },
  });

  const resetForm = () => {
    setRate(""); setNote(""); setValidFrom(todayIso());
    setEditingId(null); setOriginalFrom(null);
  };

  const invalidateAll = () => {
    if (!account) return;
    qc.invalidateQueries({ queryKey: ["tax-rates", account.id] });
    qc.invalidateQueries({ queryKey: ["current-tax-rates"] });
    qc.invalidateQueries({ queryKey: ["ml-tax-rates"] });
    qc.invalidateQueries({ queryKey: ["ml-metrics"] });
  };

  const startEdit = (h: TaxRateRow) => {
    setEditingId(h.id);
    setOriginalFrom(h.valid_from);
    setRate(String(Number(h.rate)).replace(".", ","));
    setValidFrom(h.valid_from);
    setNote(h.note ?? "");
  };

  const save = async () => {
    if (!account) return;
    const r = parseRate(rate);
    if (!Number.isFinite(r) || r < 0) { toast.error("Alíquota inválida"); return; }
    if (!validFrom) { toast.error("Informe a data de início"); return; }
    // Check for collision on valid_from within the same account
    const collision = (history ?? []).find(
      (h) => h.valid_from === validFrom && h.id !== editingId,
    );
    if (collision) {
      toast.error("Já existe uma alíquota com essa data de início");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase.from("account_tax_rates").update({
          rate: r,
          valid_from: validFrom,
          note: note.trim() || null,
        }).eq("id", editingId);
        if (error) throw error;
        if (originalFrom && originalFrom !== validFrom) {
          const { error: rpcErr } = await supabase.rpc("rebuild_tax_rate_periods", { _account_id: account.id });
          if (rpcErr) throw rpcErr;
        }
        toast.success("Alíquota atualizada");
      } else {
        const { error } = await supabase.from("account_tax_rates").insert({
          account_id: account.id,
          rate: r,
          valid_from: validFrom,
          note: note.trim() || null,
        });
        if (error) throw error;
        toast.success("Alíquota registrada");
      }
      resetForm();
      invalidateAll();
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!account || !deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("account_tax_rates").delete().eq("id", deleteTarget.id);
      if (error) throw error;
      const { error: rpcErr } = await supabase.rpc("rebuild_tax_rate_periods", { _account_id: account.id });
      if (rpcErr) throw rpcErr;
      toast.success("Alíquota excluída");
      if (editingId === deleteTarget.id) resetForm();
      setDeleteTarget(null);
      invalidateAll();
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const title = account?.trade_name?.trim() || account?.nickname || "";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Alíquotas — {title}</DialogTitle>
          <DialogDescription>
            Alíquotas passadas continuam valendo para o cálculo do imposto no período em que estavam vigentes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-md border border-border/60 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {editingId ? "Editar alíquota" : "Nova alíquota"}
            </div>
            {editingId ? (
              <Button size="sm" variant="ghost" onClick={resetForm}>Cancelar edição</Button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new_rate">Percentual (%)</Label>
              <Input id="new_rate" placeholder="Ex.: 8,5" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="valid_from">Início da vigência</Label>
              <Input id="valid_from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note">Observação</Label>
            <Textarea id="note" rows={2} placeholder="Opcional" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={saving || !rate.trim()}>
              {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Registrar alíquota"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Histórico</div>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Carregando...</div>
          ) : !history || history.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
              Nenhuma alíquota registrada.
            </div>
          ) : (
            <div className="divide-y divide-border/60 rounded-md border border-border/60">
              {history.map((h) => (
                <div key={h.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-semibold tabular-nums">{formatPercent(Number(h.rate))}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(h.valid_from)} — {h.valid_to ? formatDate(h.valid_to) : "vigente"}
                    </div>
                    {h.note ? <div className="mt-1 text-xs text-muted-foreground/90">{h.note}</div> : null}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {h.valid_to === null ? (
                      <Badge className="bg-primary/15 text-primary">Vigente</Badge>
                    ) : null}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(h)} aria-label="Editar">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(h)}
                      aria-label="Excluir"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>

        <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir esta alíquota?</AlertDialogTitle>
              <AlertDialogDescription>
                Os cálculos de imposto do período em que ela vigorava serão recalculados.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); confirmDelete(); }}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? "Excluindo..." : "Excluir"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}