import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CreditCard, Globe, Loader2, Plus, Search, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { importarFaturaCartao, lancarFaturaCartao, desfazerFaturaCartao } from "@/lib/card-invoice.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

type Resumo = {
  invoice_id: string;
  referencia: string | null;
  vencimento: string | null;
  total_fatura: number | null;
  total_itens: number;
  total_valor: number;
  casado_previsto: number;
  casado_valor_diferente: number;
  sem_destino: number;
  parcelas: number;
  creditos: number;
  duplicatas_suspeitas: number;
};

type Item = {
  id: string;
  data_compra: string | null;
  descricao: string;
  descricao_normalizada: string | null;
  valor: number;
  tipo_compra: string | null;
  parcela_atual: number | null;
  parcela_total: number | null;
  match_status: string;
  expense_id: string | null;
  valor_previsto: number | null;
  observacao: string | null;
};

type Decisao = {
  expenseId: string | null;
  ignorar: boolean;
  usarCobrado: boolean;
  criarRegra: boolean;
};

type GastoOpt = { id: string; nome: string; categoria: string; label: string };

function ddmm(v: string | null): string {
  if (!v) return "—";
  const [, m, d] = v.split("-");
  return m && d ? `${d}/${m}` : v;
}

function useGastos(ownerId: string | null) {
  return useQuery({
    enabled: !!ownerId,
    queryKey: ["fatura-gastos", ownerId],
    queryFn: async (): Promise<GastoOpt[]> => {
      const [{ data: exps, error: e1 }, { data: cats, error: e2 }] = await Promise.all([
        supabase.from("expenses").select("id,name,category_id"),
        supabase.from("expense_categories").select("id,name,parent_category_id"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const byId = new Map((cats ?? []).map((c) => [c.id, c]));
      const nomeCat = (id: string | null): string => {
        if (!id) return "Sem categoria";
        const c = byId.get(id);
        if (!c) return "Sem categoria";
        const pai = c.parent_category_id ? byId.get(c.parent_category_id) : null;
        return pai ? `${pai.name} › ${c.name}` : c.name;
      };
      return (exps ?? [])
        .map((e) => {
          const categoria = nomeCat(e.category_id);
          return { id: e.id, nome: e.name, categoria, label: `${categoria} › ${e.name}` };
        })
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    },
  });
}

function GastoPicker({
  gastos,
  value,
  onChange,
  ownerId,
}: {
  gastos: GastoOpt[];
  value: string | null;
  onChange: (id: string) => void;
  ownerId: string | null;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novaCat, setNovaCat] = useState("");
  const atual = gastos.find((g) => g.id === value) ?? null;

  const categorias = useQuery({
    enabled: open && !!ownerId,
    queryKey: ["fatura-categorias", ownerId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_categorias_arvore", { _owner: ownerId! });
      if (error) throw error;
      return (data ?? []).filter((c) => !c.is_fornecedores);
    },
  });

  const criar = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão expirada.");
      if (!novoNome.trim()) throw new Error("Informe o nome do gasto.");
      if (!novaCat) throw new Error("Escolha a categoria.");
      const { data, error } = await supabase.rpc("create_gasto", {
        _owner: ownerId,
        _nome: novoNome.trim(),
        _categoria_id: novaCat,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (id) => {
      await qc.invalidateQueries({ queryKey: ["fatura-gastos"] });
      onChange(id);
      setNovoNome("");
      setNovaCat("");
      setOpen(false);
      toast.success("Gasto criado.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao criar o gasto."),
  });

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const base = t ? gastos.filter((g) => g.label.toLowerCase().includes(t)) : gastos;
    return base.slice(0, 60);
  }, [gastos, busca]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 max-w-[320px] justify-start truncate">
          <Search className="mr-2 h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{atual ? atual.label : "Escolher gasto"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-2" align="start" collisionPadding={12}>
        <Input
          autoFocus
          placeholder="Buscar gasto..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="h-8"
        />
        <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
          {filtrados.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">Nenhum gasto encontrado.</p>
          ) : (
            filtrados.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  onChange(g.id);
                  setOpen(false);
                }}
                className={cn(
                  "w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted",
                  g.id === value && "bg-primary/15 text-primary",
                )}
              >
                {g.label}
              </button>
            ))
          )}
        </div>
        <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
          <p className="text-xs font-medium">Criar novo gasto</p>
          <Input
            placeholder="Nome do gasto"
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            className="h-8"
          />
          <select
            value={novaCat}
            onChange={(e) => setNovaCat(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">Categoria...</option>
            {(categorias.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.parent_name ? `${c.parent_name} › ${c.name}` : c.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            className="h-8 w-full"
            disabled={criar.isPending}
            onClick={() => criar.mutate()}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Criar e vincular
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FaturaCartao({ ownerId }: { ownerId: string | null }) {
  const qc = useQueryClient();
  const importar = useServerFn(importarFaturaCartao);
  const lancar = useServerFn(lancarFaturaCartao);
  const desfazer = useServerFn(desfazerFaturaCartao);
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [lancada, setLancada] = useState(false);
  const [decisoes, setDecisoes] = useState<Record<string, Decisao>>({});
  const [naoVieram, setNaoVieram] = useState<{ nome: string; valor: number }[] | null>(null);

  const gastosQuery = useGastos(ownerId);
  const gastos = gastosQuery.data ?? [];

  const concluidasQuery = useQuery({
    enabled: !!ownerId,
    queryKey: ["card-invoices-concluidas", ownerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("card_invoices")
        .select("id,banco,referencia,total_fatura")
        .eq("status", "concluida")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const itensQuery = useQuery({
    enabled: !!resumo?.invoice_id,
    queryKey: ["card-invoice-items", resumo?.invoice_id],
    queryFn: async (): Promise<Item[]> => {
      const { data, error } = await supabase
        .from("card_invoice_items")
        .select(
          "id,data_compra,descricao,descricao_normalizada,valor,tipo_compra,parcela_atual,parcela_total,match_status,expense_id,valor_previsto,observacao",
        )
        .eq("invoice_id", resumo!.invoice_id)
        .order("data_compra", { ascending: true });
      if (error) throw error;
      const itens = (data ?? []) as Item[];
      setDecisoes((prev) => {
        const next = { ...prev };
        for (const it of itens) {
          if (!next[it.id]) {
            next[it.id] = {
              expenseId: it.expense_id,
              ignorar: false,
              usarCobrado: true,
              criarRegra: false,
            };
          }
        }
        return next;
      });
      return itens;
    },
  });

  const enviar = useMutation({
    mutationFn: async () => {
      if (!arquivo) throw new Error("Selecione o arquivo .xlsx da fatura.");
      const buf = await arquivo.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 8192) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const base64 = btoa(bin);
      return (await importar({
        data: { base64, banco: "BTG", senha: senha.trim() || undefined },
      })) as Resumo;
    },
    onSuccess: (r) => {
      setErro(null);
      setNaoVieram(null);
      setLancada(false);
      setDecisoes({});
      setResumo(r);
      toast.success(`Fatura importada: ${r.total_itens} itens.`);
    },
    onError: (e: unknown) => setErro(e instanceof Error ? e.message : "Falha ao importar a fatura."),
  });

  const itens = itensQuery.data ?? [];
  const pendentes = itens.filter((it) => {
    const d = decisoes[it.id];
    if (!d) return true;
    return !d.ignorar && !d.expenseId;
  });

  const confirmar = useMutation({
    mutationFn: async () => {
      if (!resumo || !ownerId) throw new Error("Sessão expirada.");
      const mesBase = resumo.referencia ? `${resumo.referencia}-01` : null;
      if (!mesBase) throw new Error("Não consegui identificar o mês de referência da fatura.");

      const decisions = itens.map((it) => {
        const d = decisoes[it.id] ?? {
          expenseId: it.expense_id,
          ignorar: false,
          usarCobrado: true,
          criarRegra: false,
        };
        return {
          itemId: it.id,
          expenseId: d.expenseId,
          ignorar: d.ignorar,
          usarCobrado: d.usarCobrado,
          criarRegra: d.criarRegra,
        };
      });
      const usados = new Set(
        decisions.filter((d) => !d.ignorar && d.expenseId).map((d) => d.expenseId),
      );
      // A lista de previstos é consultada antes do lançamento; erro aqui não deixa
      // uma fatura lançada no banco com mensagem de falha no navegador.
      const { data: previstos, error: ePrev } = await supabase
        .from("expense_values")
        .select("expense_id,amount")
        .eq("month", mesBase)
        .gt("amount", 0);
      if (ePrev) throw ePrev;
      const faltantes = (previstos ?? [])
        .filter((p) => !usados.has(p.expense_id))
        .map((p) => ({
          nome: gastos.find((g) => g.id === p.expense_id)?.label ?? "Gasto",
          valor: Number(p.amount),
        }))
        .sort((a, b) => b.valor - a.valor);

      const result = await lancar({
        data: { invoiceId: resumo.invoice_id, decisions },
      });
      return { ...result, faltantes };
    },
    onSuccess: (r) => {
      setLancada(true);
      setNaoVieram(r.faltantes);
      qc.invalidateQueries({ queryKey: ["expense-sheet"] });
      qc.invalidateQueries({ queryKey: ["card-invoice-items"] });
      qc.invalidateQueries({ queryKey: ["card-invoices-concluidas"] });
      toast.success(`${r.itens} itens lançados — ${formatBRL(r.totalLancado)}.`);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao lançar."),
  });

  const desfazerLancamento = useMutation({
    mutationFn: async (invoiceId: string) => {
      await desfazer({ data: { invoiceId } });
    },
    onSuccess: () => {
      setResumo(null);
      setLancada(false);
      setNaoVieram(null);
      qc.invalidateQueries({ queryKey: ["expense-sheet"] });
      qc.invalidateQueries({ queryKey: ["card-invoices-concluidas"] });
      qc.invalidateQueries({ queryKey: ["card-invoice-items"] });
      toast.success("Lançamento desfeito. A fatura pode ser reimportada.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao desfazer."),
  });

  function confirmarDesfazer(invoiceId: string) {
    if (window.confirm("Desfazer o lançamento desta fatura na planilha e as regras criadas por ela?")) {
      desfazerLancamento.mutate(invoiceId);
    }
  }

  function setDec(id: string, patch: Partial<Decisao>) {
    setDecisoes((prev) => {
      const atual: Decisao = prev[id] ?? {
        expenseId: null,
        ignorar: false,
        usarCobrado: true,
        criarRegra: false,
      };
      return { ...prev, [id]: { ...atual, ...patch } };
    });
  }

  if (!resumo) {
    return (
      <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-medium">Importar fatura do cartão</h2>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              setArquivo(e.target.files?.[0] ?? null);
              setErro(null);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => inputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Selecionar arquivo
            </Button>
            <span className="text-sm text-muted-foreground">
              {arquivo ? arquivo.name : "Nenhum arquivo selecionado"}
            </span>
          </div>
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor="senha-fatura">Senha (CPF)</Label>
            <Input
              id="senha-fatura"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="Opcional"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              A fatura do BTG vem protegida. Informe o CPF do titular (com ou sem pontos).
            </p>
          </div>
          {erro ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erro}</span>
            </div>
          ) : null}
          <Button disabled={!arquivo || enviar.isPending} onClick={() => enviar.mutate()}>
            {enviar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Importar
          </Button>
        </CardContent>
      </Card>
      {(concluidasQuery.data ?? []).length > 0 ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            <p className="text-sm font-medium">Faturas já lançadas</p>
            <p className="text-xs text-muted-foreground">
              Para reimportar uma delas, primeiro desfaça o lançamento anterior.
              Se a planilha mudou depois, o sistema bloqueia o desfazer para evitar perda de dados.
            </p>
            {(concluidasQuery.data ?? []).map((f) => (
              <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-sm">
                <span>{f.banco} • {f.referencia ?? "sem referência"} • {f.total_fatura === null ? "—" : formatBRL(f.total_fatura)}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={desfazerLancamento.isPending}
                  onClick={() => confirmarDesfazer(f.id)}
                >
                  Desfazer lançamento
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      {concluidasQuery.isError ? (
        <p className="text-sm text-destructive">Não foi possível listar faturas já lançadas. Atualize a página antes de reimportar.</p>
      ) : null}
      </div>
    );
  }

  const cards: [string, string][] = [
    ["Total da fatura", formatBRL(resumo.total_fatura ?? resumo.total_valor)],
    ["Nº de itens", String(resumo.total_itens)],
    ["Casados", String(resumo.casado_previsto)],
    ["Valor diferente", String(resumo.casado_valor_diferente)],
    ["Sem destino", String(resumo.sem_destino)],
    ["Parcelas", String(resumo.parcelas)],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-sm font-medium">
            Fatura {resumo.referencia ?? "—"} {resumo.vencimento ? `• vence ${ddmm(resumo.vencimento)}` : ""}
          </h2>
          <p className="text-xs text-muted-foreground">
            {lancada ? "Lançamento concluído. Desfaça antes de reimportar." : "Confira item por item antes de lançar."}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => {
            setResumo(null);
            setArquivo(null);
            setNaoVieram(null);
          }}
        >
          Importar outra
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        {cards.map(([label, valor]) => (
          <Card key={label}>
            <CardContent className="p-3">
              <p className="text-[11px] text-muted-foreground">{label}</p>
              <p className="truncate text-base font-semibold tabular-nums">{valor}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            let n = 0;
            for (const it of itens) {
              if (it.match_status === "casado_previsto" && it.expense_id) {
                setDec(it.id, { expenseId: it.expense_id, ignorar: false });
                n++;
              }
            }
            toast.success(`${n} itens casados aceitos.`);
          }}
        >
          Aceitar todos os casados
        </Button>
        <span className="text-xs text-muted-foreground">
          {pendentes.length > 0
            ? `${pendentes.length} item(ns) ainda sem decisão — ficarão de fora.`
            : "Todos os itens têm decisão."}
        </span>
        <Button
          className="ml-auto"
          disabled={confirmar.isPending || lancada || itensQuery.isLoading}
          onClick={() => confirmar.mutate()}
        >
          {confirmar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {lancada ? "Fatura já lançada" : "Confirmar e lançar na planilha"}
        </Button>
        {lancada ? (
          <Button
            variant="outline"
            disabled={desfazerLancamento.isPending}
            onClick={() => confirmarDesfazer(resumo.invoice_id)}
          >
            Desfazer lançamento
          </Button>
        ) : null}
      </div>

      {itensQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-2">
          {itens.map((it) => {
            const d = decisoes[it.id] ?? {
              expenseId: it.expense_id,
              ignorar: false,
              usarCobrado: true,
              criarRegra: false,
            };
            const confirmado = it.match_status === "confirmado";
            return (
              <Card key={it.id} className={cn(d.ignorar && "opacity-60")}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">{ddmm(it.data_compra)}</span>
                    <span className="text-sm font-medium">{it.descricao}</span>
                    <span className="text-sm tabular-nums">{formatBRL(it.valor)}</span>
                    {confirmado ? (
                      <Badge className="bg-emerald-500/15 text-emerald-500">Lançado</Badge>
                    ) : it.match_status === "casado_previsto" ? (
                      <Badge className="bg-emerald-500/15 text-emerald-500">Casado</Badge>
                    ) : it.match_status === "casado_valor_diferente" ? (
                      <Badge className="bg-amber-500/15 text-amber-500">Valor diferente</Badge>
                    ) : (
                      <Badge variant="secondary">Sem destino</Badge>
                    )}
                    {(it.parcela_total ?? 0) > 1 ? (
                      <Badge variant="outline">
                        Parcela {it.parcela_atual}/{it.parcela_total}
                      </Badge>
                    ) : null}
                    {it.tipo_compra === "internacional" ? (
                      <Badge variant="outline" className="gap-1">
                        <Globe className="h-3 w-3" /> Internacional
                      </Badge>
                    ) : null}
                  </div>
                  {it.observacao ? (
                    <p className="text-[11px] text-muted-foreground">{it.observacao}</p>
                  ) : null}

                  {!confirmado ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <GastoPicker
                        gastos={gastos}
                        value={d.expenseId}
                        ownerId={ownerId}
                        onChange={(id) => setDec(it.id, { expenseId: id, ignorar: false })}
                      />
                      {it.match_status === "casado_valor_diferente" && it.valor_previsto ? (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-muted-foreground">
                            previsto {formatBRL(it.valor_previsto)}, cobrado {formatBRL(Math.abs(it.valor))}
                          </span>
                          <Button
                            size="sm"
                            variant={d.usarCobrado ? "default" : "outline"}
                            className="h-7"
                            onClick={() => setDec(it.id, { usarCobrado: true })}
                          >
                            Lançar o cobrado
                          </Button>
                          <Button
                            size="sm"
                            variant={!d.usarCobrado ? "default" : "outline"}
                            className="h-7"
                            onClick={() => setDec(it.id, { usarCobrado: false })}
                          >
                            Manter o previsto
                          </Button>
                        </div>
                      ) : null}
                      <label className="flex items-center gap-1.5 text-xs">
                        <Checkbox
                          checked={d.ignorar}
                          onCheckedChange={(v) => setDec(it.id, { ignorar: v === true })}
                        />
                        Ignorar
                      </label>
                      <label className="flex items-center gap-1.5 text-xs">
                        <Checkbox
                          checked={d.criarRegra}
                          onCheckedChange={(v) => setDec(it.id, { criarRegra: v === true })}
                        />
                        Criar regra para casar automaticamente
                      </label>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {naoVieram && naoVieram.length > 0 ? (
        <Card className="border-amber-500/40">
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-medium text-amber-500">Previstos que não apareceram na fatura</p>
            <p className="text-xs text-muted-foreground">
              Estava previsto mas não veio nesta fatura — confira se foi pago por outro meio ou se não foi cobrado.
            </p>
            <ul className="space-y-1 text-xs">
              {naoVieram.map((f) => (
                <li key={f.nome} className="flex justify-between gap-4">
                  <span className="truncate">{f.nome}</span>
                  <span className="tabular-nums">{formatBRL(f.valor)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
