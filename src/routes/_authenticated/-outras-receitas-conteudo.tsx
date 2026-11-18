import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Store, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/rf/empty-state";
import { formatBRL } from "@/lib/format";


const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const YEARS = [2024, 2025, 2026, 2027];
const CANAIS = [
  { v: "shopee", label: "Shopee" },
  { v: "balcao", label: "Balcão (loja física)" },
  { v: "tiktok", label: "TikTok Shop" },
  { v: "outro", label: "Outro" },
];
const canalLabel = (v: string) => CANAIS.find((c) => c.v === v)?.label ?? v;

function parseBRL(v: string): number | null {
  const clean = v.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  if (!clean.trim()) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function monthKey(year: number, m: number) {
  return `${year}-${String(m + 1).padStart(2, "0")}-01`;
}

type Lancamento = {
  id: string;
  empresa_id: string;
  canal: string;
  month: string;
  valor: number;
  empresas: { nome: string } | null;
};

export function OutrasReceitasPage() {
  const qc = useQueryClient();
  const [year, setYear] = useState<number>(2026);
  const [empresaId, setEmpresaId] = useState<string>("");
  const [canal, setCanal] = useState<string>("shopee");

  const empresas = useQuery({
    queryKey: ["empresas-ativas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("id, nome, cnpj")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const lancamentos = useQuery({
    queryKey: ["faturamento-externo", year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("faturamento_externo")
        .select("id, empresa_id, canal, month, valor, empresas(nome)")
        .gte("month", `${year}-01-01`)
        .lte("month", `${year}-12-01`)
        .order("month");
      if (error) throw error;
      return (data ?? []) as unknown as Lancamento[];
    },
  });

  useEffect(() => {
    if (!empresaId && empresas.data && empresas.data.length > 0) setEmpresaId(empresas.data[0].id);
  }, [empresas.data, empresaId]);

  const salvar = useMutation({
    mutationFn: async (p: { month: string; valor: number }) => {
      const { error } = await supabase.rpc("set_faturamento_externo", {
        _empresa_id: empresaId,
        _canal: canal,
        _month: p.month,
        _valor: p.valor,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["faturamento-externo"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_faturamento_externo", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lançamento excluído.");
      qc.invalidateQueries({ queryKey: ["faturamento-externo"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const valoresGrade = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lancamentos.data ?? []) {
      if (l.empresa_id === empresaId && l.canal === canal) map.set(l.month.slice(0, 10), Number(l.valor));
    }
    return map;
  }, [lancamentos.data, empresaId, canal]);

  const resumo = useMemo(() => {
    const map = new Map<string, { empresa: string; canal: string; total: number }>();
    for (const l of lancamentos.data ?? []) {
      const k = `${l.empresa_id}|${l.canal}`;
      const cur = map.get(k) ?? { empresa: l.empresas?.nome ?? "—", canal: l.canal, total: 0 };
      cur.total += Number(l.valor);
      map.set(k, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [lancamentos.data]);

  const totalAno = resumo.reduce((a, b) => a + b.total, 0);

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-primary">Outras receitas</h1>
          <p className="text-sm text-muted-foreground">
            Faturamento manual de canais sem integração: Shopee, balcão e TikTok Shop.
          </p>
        </div>
        <NovaEmpresaDialog onCreated={() => qc.invalidateQueries({ queryKey: ["empresas-ativas"] })} />
      </header>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="text-sm font-semibold">Empresas</h2>
          {empresas.data && empresas.data.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {empresas.data.map((e) => (
                <div key={e.id} className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{e.nome}</div>
                    <div className="truncate text-xs text-muted-foreground tabular-nums">{e.cnpj || "sem CNPJ"}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhuma empresa cadastrada.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Empresa</Label>
              <Select value={empresaId} onValueChange={setEmpresaId}>
                <SelectTrigger className="h-9 w-56"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {(empresas.data ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Canal</Label>
              <Select value={canal} onValueChange={setCanal}>
                <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CANAIS.map((c) => <SelectItem key={c.v} value={c.v}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Ano</Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!empresaId ? (
            <EmptyState icon={Store} title="Cadastre ou selecione uma empresa" description="Escolha a empresa e o canal para lançar o faturamento mês a mês." />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {MESES.map((m, i) => {
                const key = monthKey(year, i);
                return (
                  <MesInput
                    key={key}
                    label={m}
                    value={valoresGrade.get(key) ?? null}
                    onSave={(valor) => salvar.mutate({ month: key, valor })}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Resumo {year}</h2>
            <span className="text-sm tabular-nums font-semibold">{formatBRL(totalAno)}</span>
          </div>
          {resumo.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum lançamento no ano selecionado.</p>
          ) : (
            <div className="space-y-1">
              {resumo.map((r) => (
                <div key={`${r.empresa}-${r.canal}`} className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-sm">
                  <span className="truncate">{r.empresa} <span className="text-muted-foreground">· {canalLabel(r.canal)}</span></span>
                  <span className="tabular-nums shrink-0">{formatBRL(r.total)}</span>
                </div>
              ))}
            </div>
          )}

          {(lancamentos.data ?? []).length > 0 && (
            <div className="pt-2">
              <h3 className="text-xs uppercase text-muted-foreground mb-2">Lançamentos</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1.5 pr-3">Empresa</th>
                      <th className="py-1.5 pr-3">Canal</th>
                      <th className="py-1.5 pr-3">Mês</th>
                      <th className="py-1.5 pr-3 text-right">Valor</th>
                      <th className="py-1.5 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {(lancamentos.data ?? []).map((l) => (
                      <tr key={l.id} className="border-t border-border/50">
                        <td className="py-1.5 pr-3">{l.empresas?.nome ?? "—"}</td>
                        <td className="py-1.5 pr-3">{canalLabel(l.canal)}</td>
                        <td className="py-1.5 pr-3 tabular-nums">
                          {MESES[Number(l.month.slice(5, 7)) - 1]}/{l.month.slice(0, 4)}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{formatBRL(Number(l.valor))}</td>
                        <td className="py-1.5">
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => excluir.mutate(l.id)}
                            aria-label="Excluir lançamento"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MesInput({ label, value, onSave }: { label: string; value: number | null; onSave: (v: number) => void }) {
  const [text, setText] = useState(value != null ? formatBRL(value) : "");
  useEffect(() => {
    setText(value != null ? formatBRL(value) : "");
  }, [value]);

  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        className="h-9 text-right tabular-nums"
        value={text}
        placeholder="—"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = parseBRL(text);
          const next = parsed ?? 0;
          if (next !== (value ?? 0)) onSave(next);
          setText(parsed != null ? formatBRL(next) : value != null ? formatBRL(value) : "");
        }}
      />
    </div>
  );
}

function NovaEmpresaDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [razao, setRazao] = useState("");

  const criar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("create_empresa", {
        _nome: nome.trim(),
        _cnpj: cnpj.trim(),
        _razao: razao.trim(),
        _regime: "simples",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Empresa cadastrada.");
      setNome(""); setCnpj(""); setRazao("");
      setOpen(false);
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Nova empresa</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Nova empresa</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Nome *</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Loja da Tatiana" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">CNPJ</Label>
            <Input value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Razão social</Label>
            <Input value={razao} onChange={(e) => setRazao(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button disabled={!nome.trim() || criar.isPending} onClick={() => criar.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}