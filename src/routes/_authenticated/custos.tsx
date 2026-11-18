import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, ChevronDown, Search, Pencil, History, Plus, Trash2, Check, X, Download, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBRL, formatDate } from "@/lib/format";
import { SkuCustosImportDialog, exportarModeloCustos } from "@/components/rf/costs/sku-custos-import-dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/custos")({
  validateSearch: (search): { sku?: string } => {
    const raw = (search as { sku?: unknown }).sku;
    return typeof raw === "string" && raw.trim() ? { sku: raw.trim() } : {};
  },
  head: () => ({
    meta: [
      { title: "Produtos / SKUs — Painel Financeiro" },
      { name: "description", content: "Catálogo de produtos da empresa com custo por SKU e receita dos kits." },
      { property: "og:title", content: "Produtos / SKUs — Painel Financeiro" },
      { property: "og:description", content: "Catálogo de produtos da empresa com custo por SKU e receita dos kits." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProdutosPage,
  errorComponent: ({ error }) => (
    <div className="p-6">
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="p-4 space-y-2">
          <h2 className="text-sm font-semibold text-destructive">Erro ao carregar Produtos / SKUs</h2>
          <p className="text-xs text-muted-foreground font-mono break-all">
            {error instanceof Error ? error.message : String(error)}
          </p>
        </CardContent>
      </Card>
    </div>
  ),
});

type Tipo = "todos" | "simples" | "kit";

const TIPOS: { value: Tipo; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "simples", label: "Simples" },
  { value: "kit", label: "Compostos" },
];

function useOwnerId() {
  return useQuery({
    queryKey: ["auth-user-id"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });
}

function ProdutosPage() {
  const { sku: skuParam } = Route.useSearch();
  const [tipo, setTipo] = useState<Tipo>("todos");
  const [custoFiltro, setCustoFiltro] = useState<"todos" | "com" | "sem">("todos");
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [buscaInput, setBuscaInput] = useState(skuParam ?? "");
  const [busca, setBusca] = useState(skuParam ?? "");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [novoOpen, setNovoOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBusca(buscaInput.trim()), 300);
    return () => clearTimeout(t);
  }, [buscaInput]);

  useEffect(() => {
    if (skuParam) {
      setBuscaInput(skuParam);
      setBusca(skuParam);
    }
  }, [skuParam]);

  const qc = useQueryClient();
  const { data: ownerId } = useOwnerId();

  const { data: produtos, isLoading } = useQuery({
    queryKey: ["product-catalog", tipo, busca, ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const PAGE = 1000;
      let from = 0;
      const todos: NonNullable<Awaited<ReturnType<typeof supabase.rpc<"product_catalog">>>["data"]> = [];
      for (;;) {
        const { data, error } = await supabase
          .rpc("product_catalog", {
            _owner: ownerId!,
            _tipo: tipo,
            _busca: busca || undefined,
          })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const bloco = data ?? [];
        todos.push(...bloco);
        if (bloco.length < PAGE) break;
        from += PAGE;
      }
      return todos;
    },
  });

  const produtosFiltrados = useMemo(() => {
    let lista = produtos ?? [];
    if (!mostrarInativos) lista = lista.filter((p) => p.ativo);
    if (custoFiltro !== "todos") {
      lista = lista.filter((p) => {
        if (p.is_kit) return false;
        const semCusto = !p.custo_efetivo || Number(p.custo_efetivo) === 0;
        return custoFiltro === "sem" ? semCusto : !semCusto;
      });
    }
    return lista;
  }, [produtos, mostrarInativos, custoFiltro]);

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-primary">Produtos / SKUs</h1>
        <p className="text-sm text-muted-foreground">
          Catálogo de produtos da empresa. Custos alimentam a margem por anúncio.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-border/60 bg-card/60 p-0.5">
          {TIPOS.map((t) => (
            <Button
              key={t.value}
              size="sm"
              variant="ghost"
              onClick={() => setTipo(t.value)}
              className={cn("h-8 px-3 text-sm", tipo === t.value && "bg-primary/15 text-primary hover:bg-primary/15")}
            >
              {t.label}
            </Button>
          ))}
        </div>
        <div className="inline-flex rounded-md border border-border/60 bg-card/60 p-0.5">
          {([
            { value: "todos", label: "Todos" },
            { value: "com", label: "Com custo" },
            { value: "sem", label: "Sem custo" },
          ] as const).map((c) => (
            <Button
              key={c.value}
              size="sm"
              variant="ghost"
              onClick={() => setCustoFiltro(c.value)}
              className={cn(
                "h-8 px-3 text-sm",
                custoFiltro === c.value && "bg-primary/15 text-primary hover:bg-primary/15",
              )}
            >
              {c.label}
            </Button>
          ))}
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={buscaInput}
            onChange={(e) => setBuscaInput(e.target.value)}
            placeholder="Buscar por SKU ou título"
            className="pl-8"
          />
        </div>
        <Button size="sm" onClick={() => setNovoOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Novo produto
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            exportarModeloCustos(
              produtosFiltrados.map((p) => ({
                sku: p.sku,
                titulo: p.titulo,
                is_kit: p.is_kit,
                custo_efetivo: p.custo_efetivo == null ? null : Number(p.custo_efetivo),
              })),
            )
          }
          disabled={produtosFiltrados.length === 0}
        >
          <Download className="h-4 w-4 mr-1.5" />
          Exportar custos
        </Button>
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} disabled={!ownerId}>
          <Upload className="h-4 w-4 mr-1.5" />
          Importar custos
        </Button>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={mostrarInativos} onCheckedChange={setMostrarInativos} />
          Mostrar inativos
        </label>
        <div className="ml-auto text-xs text-muted-foreground tabular-nums">
          {produtosFiltrados.length} produtos
        </div>
      </div>

      <NovoProdutoDialog open={novoOpen} onOpenChange={setNovoOpen} ownerId={ownerId} />
      {ownerId ? (
        <SkuCustosImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          ownerId={ownerId}
          onImported={() => {
            qc.invalidateQueries({ queryKey: ["product-catalog"] });
            qc.invalidateQueries({ queryKey: ["kit-recipe"] });
            qc.invalidateQueries({ queryKey: ["sku-cost-history"] });
          }}
        />
      ) : null}

      <Card className="border-border/60 bg-card/60">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <TableHead className="w-8" />
                <TableHead className="w-40">SKU</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="w-44">Tipo</TableHead>
                <TableHead className="w-32 text-right">Custo</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-16 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}><Skeleton className="h-5 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : produtosFiltrados.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                    Nenhum produto encontrado
                  </TableCell>
                </TableRow>
              ) : (
                produtosFiltrados.map((p) => {
                  const isOpen = expanded === p.sku;
                  return (
                    <ProdutoRow
                      key={p.id}
                      p={p}
                      ownerId={ownerId!}
                      isOpen={isOpen}
                      onToggle={() => setExpanded(isOpen ? null : p.sku)}
                    />
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

type Produto = {
  id: string;
  sku: string;
  titulo: string | null;
  is_kit: boolean;
  ativo: boolean;
  categoria: string | null;
  custo_efetivo: number | null;
  componentes: number | null;
};

function ExcluirSkuDialog({
  open,
  onOpenChange,
  sku,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sku: string;
}) {
  const queryClient = useQueryClient();

  const { data: impacto, isLoading } = useQuery({
    queryKey: ["sku-delete-impact", sku],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sku_delete_impact", { _sku: sku });
      if (error) throw error;
      return (data ?? [])[0] ?? null;
    },
  });

  const excluir = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("delete_sku", { _sku: sku });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`SKU ${sku} excluído`);
      onOpenChange(false);
      for (const key of ["produtos", "product-catalog", "kit-recipe", "mp-reconciliation", "mp-reconciliation-summary", "conc-divergencias", "anuncios", "anuncios-margem", "dashboard"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      queryClient.invalidateQueries();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível excluir"),
  });

  const vendas = Number(impacto?.vendas ?? 0);
  const receita = Number(impacto?.receita ?? 0);
  const kits = (impacto?.kits ?? []) as string[];
  // O banco recusa excluir SKU com venda (cus-04); aqui só explica antes de tentar.
  const bloqueado = vendas > 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{bloqueado ? `O SKU ${sku} não pode ser excluído` : `Excluir o SKU ${sku}?`}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              {isLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : bloqueado ? (
                <p>
                  Ele aparece em {vendas} venda(s), somando {formatBRL(receita)} de receita. O custo dessas vendas vem
                  deste cadastro: excluir tiraria o custo das contas e mudaria a margem dos meses passados. Para
                  corrigir o custo, edite o produto.
                </p>
              ) : (
                <>
                  <p>
                    Serão removidos: o produto, o histórico de custos ({Number(impacto?.historico ?? 0)} registro(s)) e
                    os vínculos com anúncios ({Number(impacto?.vinculos ?? 0)}). A ação não pode ser desfeita.
                  </p>
                  {kits.length > 0 ? (
                    <p className="text-amber-500">
                      Faz parte do(s) kit(s): {kits.join(", ")}. Se algum deles já vendeu, a exclusão é recusada; se não, o custo do kit é recalculado sem esta peça.
                    </p>
                  ) : (
                    <p className="text-muted-foreground">Nenhuma venda ou kit associado a este SKU.</p>
                  )}
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={excluir.isPending}>{bloqueado ? "Fechar" : "Cancelar"}</AlertDialogCancel>
          {!bloqueado && (
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={excluir.isPending || isLoading}
              onClick={(e) => { e.preventDefault(); excluir.mutate(); }}
            >
              {excluir.isPending ? "Excluindo…" : "Excluir SKU"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}


function ProdutoRow({
  p,
  ownerId,
  isOpen,
  onToggle,
}: {
  p: Produto;
  ownerId: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);

  const { data: recipe, isLoading } = useQuery({
    queryKey: ["kit-recipe", p.sku, ownerId],
    enabled: isOpen && p.is_kit && !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("kit_recipe", { _owner: ownerId, _kit_sku: p.sku });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <>
      <TableRow className={cn("text-sm", p.is_kit && "cursor-pointer")} onClick={p.is_kit ? onToggle : undefined}>
        <TableCell className="w-8">
          {p.is_kit ? (
            isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : null}
        </TableCell>
        <TableCell className="font-mono text-xs font-medium tabular-nums">{p.sku}</TableCell>
        <TableCell className="max-w-[420px] truncate">
          {p.titulo ?? <span className="text-muted-foreground italic">Sem título — {p.sku}</span>}
        </TableCell>
        <TableCell>
          {p.is_kit ? (
            <span className="flex items-center gap-1.5">
              <Badge className="bg-primary/15 text-primary hover:bg-primary/15">Composto</Badge>
              <span className="text-xs text-muted-foreground tabular-nums">({p.componentes ?? 0} itens)</span>
            </span>
          ) : (
            <Badge variant="secondary">Simples</Badge>
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {!p.is_kit && !p.custo_efetivo ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            formatBRL(p.custo_efetivo)
          )}
        </TableCell>
        <TableCell>
          {p.ativo ? (
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" title="Ativo" />
          ) : (
            <Badge variant="outline" className="text-muted-foreground">Inativo</Badge>
          )}
        </TableCell>
        <TableCell className="text-right whitespace-nowrap">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Histórico de custo"
            onClick={(e) => { e.stopPropagation(); setHistOpen(true); }}
          >
            <History className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Editar produto"
            onClick={(e) => { e.stopPropagation(); setEditOpen(true); }}
          >
            <Pencil className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Excluir SKU"
            onClick={(e) => { e.stopPropagation(); setDelOpen(true); }}
          >
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
          <CostHistoryDialog open={histOpen} onOpenChange={setHistOpen} sku={p.sku} ownerId={ownerId} />
          <EditProdutoDialog open={editOpen} onOpenChange={setEditOpen} p={p} ownerId={ownerId} />
          <ExcluirSkuDialog open={delOpen} onOpenChange={setDelOpen} sku={p.sku} />
        </TableCell>

      </TableRow>
      {isOpen && p.is_kit ? (
        <TableRow className="bg-background/40 hover:bg-background/40">
          <TableCell colSpan={7} className="p-0">
            <div className="px-12 py-3">
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : !recipe || recipe.length === 0 ? (
                <div className="py-2 text-sm text-muted-foreground">Kit sem componentes cadastrados.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      <TableHead>Componente</TableHead>
                      <TableHead className="w-20 text-right">Qtd</TableHead>
                      <TableHead className="w-36 text-right">Custo unitário</TableHead>
                      <TableHead className="w-36 text-right">Custo total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recipe.map((c) => (
                      <TableRow key={c.component_sku} className="text-sm">
                        <TableCell>
                          <div className="font-mono text-xs">{c.component_sku}</div>
                          {c.titulo ? <div className="text-xs text-muted-foreground">{c.titulo}</div> : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{c.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {c.custo_unit == null ? <span className="text-muted-foreground">—</span> : formatBRL(c.custo_unit)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(c.custo_total)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="text-sm">
                      <TableCell colSpan={3} className="text-right font-semibold">Custo do kit</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatBRL(recipe.reduce((s, c) => s + (Number(c.custo_total) || 0), 0))}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function parseBRL(v: string): number | null {
  const clean = v.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  if (!clean.trim()) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

type HistRow = {
  id: string;
  valor_unitario: number;
  origem: string;
  data_nota: string | null;
  numero_nota: string | null;
  registrado_em: string;
};

function CostHistoryDialog({
  open,
  onOpenChange,
  sku,
  ownerId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sku: string;
  ownerId: string;
}) {
  const qc = useQueryClient();
  const [editId, setEditId] = useState<string | null>(null);
  const [editValor, setEditValor] = useState("");
  const [editData, setEditData] = useState("");
  const [alvoExcluir, setAlvoExcluir] = useState<HistRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["sku-cost-history", sku, ownerId],
    enabled: open && !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sku_cost_history", { _owner: ownerId, _sku: sku });
      if (error) throw error;
      return (data ?? []) as HistRow[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["sku-cost-history"] });
    qc.invalidateQueries({ queryKey: ["product-catalog"] });
    qc.invalidateQueries({ queryKey: ["kit-recipe"] });
  };

  const salvar = useMutation({
    mutationFn: async () => {
      if (!editId) return;
      const valor = parseBRL(editValor);
      if (valor == null || valor < 0) throw new Error("Informe um valor válido");
      if (!editData) throw new Error("Informe a data");
      const { error } = await supabase.rpc("update_cost_history", {
        _id: editId,
        _valor: valor,
        _data: editData,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setEditId(null);
      invalidate();
      toast.success("Custo atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_cost_history", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      setAlvoExcluir(null);
      invalidate();
      toast.success("Registro excluído");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const iniciarEdicao = (h: HistRow) => {
    setEditId(h.id);
    setEditValor(String(h.valor_unitario).replace(".", ","));
    setEditData((h.data_nota ?? h.registrado_em).slice(0, 10));
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Histórico de custo — {sku}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !data || data.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Sem histórico de custo para este SKU.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <TableHead className="w-32">Data</TableHead>
                <TableHead className="w-32 text-right">Valor</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((h, i) => h.id === editId ? (
                <TableRow key={h.id} className="text-sm">
                  <TableCell>
                    <Input type="date" value={editData} onChange={(e) => setEditData(e.target.value)} className="h-8" />
                  </TableCell>
                  <TableCell>
                    <Input value={editValor} onChange={(e) => setEditValor(e.target.value)} className="h-8 text-right tabular-nums" inputMode="decimal" />
                  </TableCell>
                  <TableCell><Badge variant="secondary">Manual</Badge></TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={salvar.isPending} onClick={() => salvar.mutate()} aria-label="Salvar">
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditId(null)} aria-label="Cancelar">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={h.id} className={cn("text-sm", i === 0 && "bg-primary/5 font-medium")}>
                  <TableCell className="tabular-nums">
                    {h.origem === "nota" ? formatDate(h.data_nota) : formatDate(h.registrado_em)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatBRL(h.valor_unitario)}</TableCell>
                  <TableCell>
                    {h.origem === "nota" ? (
                      <Badge className="bg-primary/15 text-primary hover:bg-primary/15">
                        {h.numero_nota ? `Nota ${h.numero_nota}` : "Nota"}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Manual</Badge>
                    )}
                    {i === 0 ? (
                      <span className="ml-2 text-xs text-muted-foreground">vigente</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {h.origem === "manual" ? (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => iniciarEdicao(h)} aria-label="Editar registro">
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      ) : null}
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setAlvoExcluir(h)} aria-label="Excluir registro">
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>

    <AlertDialog open={alvoExcluir !== null} onOpenChange={(o) => { if (!o) setAlvoExcluir(null); }}>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir registro de custo?</AlertDialogTitle>
          <AlertDialogDescription>
            {alvoExcluir?.origem === "nota"
              ? `Esse custo veio da nota ${alvoExcluir?.numero_nota ?? "(sem número)"}. Excluir aqui não altera a nota no Contas a Pagar, e ele pode voltar se a nota for casada novamente. Deseja excluir mesmo assim?`
              : "O custo atual do SKU será recalculado com o que sobrar no histórico."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={excluir.isPending}
            onClick={(e) => { e.preventDefault(); if (alvoExcluir) excluir.mutate(alvoExcluir.id); }}
          >
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function EditProdutoDialog({
  open,
  onOpenChange,
  p,
  ownerId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  p: Produto;
  ownerId: string;
}) {
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState(p.titulo ?? "");
  const [custo, setCusto] = useState(
    p.custo_efetivo != null ? String(p.custo_efetivo).replace(".", ",") : "",
  );
  const [travado, setTravado] = useState(false);
  const [travadoInicial, setTravadoInicial] = useState(false);

  useEffect(() => {
    if (open) {
      setTitulo(p.titulo ?? "");
      setCusto(p.custo_efetivo != null ? String(p.custo_efetivo).replace(".", ",") : "");
      setTravado(false);
      setTravadoInicial(false);
      if (!p.is_kit) {
        void supabase
          .from("product_skus")
          .select("custo_travado")
          .eq("id", p.id)
          .single()
          .then(({ data }) => {
            const v = Boolean(data?.custo_travado);
            setTravado(v);
            setTravadoInicial(v);
          });
      }
    }
  }, [open, p.titulo, p.custo_efetivo, p.id, p.is_kit]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["product-catalog"] });
    qc.invalidateQueries({ queryKey: ["kit-recipe"] });
    qc.invalidateQueries({ queryKey: ["sku-cost-history"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const nome = titulo.trim();
      if (!nome) throw new Error("Informe o nome do produto");
      const { error } = await supabase.from("product_skus").update({ titulo: nome }).eq("id", p.id);
      if (error) throw error;
      if (!p.is_kit) {
        const valor = parseBRL(custo);
        const atual = p.custo_efetivo == null ? null : Number(p.custo_efetivo);
        const custoMudou = valor != null && valor !== atual;
        const travaMudou = travado !== travadoInicial;
        if (custoMudou || travaMudou) {
          // Sem custo não há o que travar: antes gravava 0 (cus-07).
          if (valor == null && atual == null) throw new Error("Informe o custo.");
          const digitado = valor ?? atual!;
          const { data: custoVigente, error: rpcErr } = await supabase.rpc("set_sku_cost_travado", {
            _owner: ownerId,
            _sku: p.sku,
            _valor: digitado,
            _travar: travado,
          });
          if (rpcErr) throw rpcErr;
          if (custoVigente != null && Number(custoVigente) !== digitado) {
            toast.warning(`O custo que vale continua ${formatBRL(Number(custoVigente))}, da nota mais recente. Para usar o valor digitado, ligue "Travar".`);
          }
        }
      }
    },
    onSuccess: () => {
      toast.success("Produto atualizado.");
      invalidate();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { count, error: cErr } = await supabase
        .from("kit_components")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .eq("component_sku", p.sku);
      if (cErr) throw cErr;
      const n = count ?? 0;
      const msg =
        n > 0
          ? `Este SKU é componente de ${n} kit(s). Excluir vai afetar o custo desses kits. Confirmar exclusão?`
          : "Excluir este produto?";
      if (!window.confirm(msg)) return false;
      const { error } = await supabase.rpc("delete_sku", { _sku: p.sku });
      if (error) throw error;
      return true;
    },
    onSuccess: (done) => {
      if (!done) return;
      toast.success("Produto excluído.");
      invalidate();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Editar produto</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">SKU</Label>
            <div className="font-mono text-sm">{p.sku}</div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prod-nome" className="text-sm">Nome</Label>
            <Input id="prod-nome" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          {p.is_kit ? (
            <div className="space-y-1.5">
              <Label className="text-sm">Custo</Label>
              <Input value={formatBRL(p.custo_efetivo)} disabled />
              <p className="text-xs text-muted-foreground">Custo calculado pelos componentes do kit.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="prod-custo" className="text-sm">Custo (R$)</Label>
                {travado ? (
                  <Badge variant="secondary" className="text-[10px]">Custo travado</Badge>
                ) : null}
              </div>
              <Input
                id="prod-custo"
                value={custo}
                onChange={(e) => setCusto(e.target.value)}
                placeholder="0,00"
                className="tabular-nums"
              />
              <div className="flex items-start gap-3 rounded-md border border-border/60 p-3">
                <Switch id="prod-travar" checked={travado} onCheckedChange={setTravado} />
                <div className="space-y-1">
                  <Label htmlFor="prod-travar" className="text-sm">
                    Travar este custo (ignorar valor das notas)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Use quando você compra em caixa/fardo e a nota traz o valor da caixa. O custo que
                    você digitar aqui será mantido mesmo que chegue nota nova.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
            Excluir produto
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !titulo.trim()}>
              {save.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NovoProdutoDialog({
  open,
  onOpenChange,
  ownerId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ownerId: string | null | undefined;
}) {
  const qc = useQueryClient();
  const [sku, setSku] = useState("");
  const [titulo, setTitulo] = useState("");
  const [custo, setCusto] = useState("");
  const [codigoBarras, setCodigoBarras] = useState("");

  useEffect(() => {
    if (open) {
      setSku("");
      setTitulo("");
      setCusto("");
      setCodigoBarras("");
    }
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Usuário não identificado");
      const skuClean = sku.trim();
      const nome = titulo.trim();
      if (!skuClean) {
        toast.error("Informe o SKU do produto.");
        throw new Error("SKU obrigatório");
      }
      if (!nome) {
        toast.error("Informe o nome do produto.");
        throw new Error("Nome obrigatório");
      }
      const valor = parseBRL(custo);
      // Antes do cadastro, para não criar o produto e depois recusar o custo (cus-07).
      if (valor != null && valor <= 0) throw new Error("O custo precisa ser maior que zero.");

      const { error: insertErr } = await supabase.from("product_skus").insert({
        owner_id: ownerId,
        sku: skuClean,
        titulo: nome,
        is_kit: false,
        ativo: true,
        codigo_barras: codigoBarras.trim() || null,
      });
      if (insertErr) {
        if (
          insertErr.code === "23505" ||
          insertErr.message?.includes("product_skus_owner_id_sku_key")
        ) {
          toast.error("Já existe um produto com esse SKU.");
        }
        throw insertErr;
      }

      if (valor != null) {
        const { error: rpcErr } = await supabase.rpc("set_manual_sku_cost", {
          _owner: ownerId,
          _sku: skuClean,
          _valor: valor,
        });
        if (rpcErr) throw rpcErr;
      }
    },
    onSuccess: () => {
      toast.success("Produto criado.");
      qc.invalidateQueries({ queryKey: ["product-catalog"] });
      onOpenChange(false);
    },
    onError: (e: Error) => {
      if (!e.message?.includes("obrigatório")) {
        toast.error(e.message || "Erro ao criar produto");
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Novo produto (SKU simples)</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="novo-sku" className="text-sm">
              SKU <span className="text-destructive">*</span>
            </Label>
            <Input
              id="novo-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="Ex: MLB-12345-ABC"
              className="font-mono tabular-nums"
            />
            <p className="text-xs text-muted-foreground">
              Deve ser igual ao SKU usado nos anúncios do ML/Shopee para casar as vendas.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="novo-nome" className="text-sm">
              Nome <span className="text-destructive">*</span>
            </Label>
            <Input
              id="novo-nome"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Nome do produto"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="novo-custo" className="text-sm">Custo (R$)</Label>
            <Input
              id="novo-custo"
              value={custo}
              onChange={(e) => setCusto(e.target.value)}
              placeholder="0,00"
              className="tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="novo-ean" className="text-sm">Código de barras</Label>
            <Input
              id="novo-ean"
              value={codigoBarras}
              onChange={(e) => setCodigoBarras(e.target.value)}
              placeholder="EAN / GTIN (opcional)"
              className="tabular-nums"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !sku.trim() || !titulo.trim()}
          >
            {create.isPending ? "Criando..." : "Criar produto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
