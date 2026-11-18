import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpDown, Check, ChevronDown, ChevronRight, FileText, Plus, Repeat, ScanLine, Trash2, Truck, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/rf/empty-state";
import { formatBRL, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { imageFileTooLarge, IMAGE_TOO_LARGE_MESSAGE } from "@/lib/image-limit";
import { VencimentosDoDia } from "./-vencimentos-do-dia";
import { FaturaCartao } from "./-fatura-cartao";

export const Route = createFileRoute("/_authenticated/contas-a-pagar")({
  head: () => ({
    meta: [
      { title: "Contas a Pagar — Painel Financeiro" },
      { name: "description", content: "Importação de XML de NF-e, parcelas e produtos das notas de fornecedores." },
      { property: "og:title", content: "Contas a Pagar — Painel Financeiro" },
      { property: "og:description", content: "Importação de XML de NF-e, parcelas e produtos das notas de fornecedores." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContasAPagarPage,
});

type Destino = "ecommerce" | "locacao" | "nao_definido";
type DestinoFull = "ecommerce" | "locacao" | "rateio" | "nao_definido";
type View = "todas" | "ecommerce" | "locacao";

type SplitNote = {
  id: string;
  chave_nfe: string;
  numero_nota: string;
  fornecedor_nome: string;
  fornecedor_cnpj: string;
  data_emissao: string;
  valor_total: number;
  valor_produtos: number;
  valor_frete: number;
  valor_outros: number;
  destino: string;
  ecommerce_mode: string;
  ecommerce_percent: number;
  ecommerce_amount: number;
  status: string;
  created_at: string;
  parte_ecommerce: number;
  parte_locacao: number;
  parcelas_total: number;
  parcelas_pagas: number;
  recorrencia_id: string | null;
  competencia_mes: string | null;
};

function parseBRL(v: string): number {
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

type ParsedInstallment = { numero: string; vencimento: string | null; valor: number };
type ParsedItem = {
  fornecedor_sku: string;
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
};
type ParsedNote = {
  chave_nfe: string;
  numero_nota: string;
  fornecedor_nome: string;
  fornecedor_cnpj: string;
  destinatario_nome: string;
  data_emissao: string | null;
  valor_total: number;
  valor_produtos: number;
  valor_frete: number;
  valor_outros: number;
  parcelas: ParsedInstallment[];
  itens: ParsedItem[];
};

function txt(root: Element | Document | null | undefined, tag: string): string {
  if (!root) return "";
  const el = root.getElementsByTagName(tag)[0];
  return el?.textContent?.trim() ?? "";
}

function num(root: Element | Document | null | undefined, tag: string): number {
  const v = Number(txt(root, tag));
  return Number.isFinite(v) ? v : 0;
}

function onlyDigits(v: string): string {
  return v.replace(/\D+/g, "");
}

export function formatCnpj(v: string | null | undefined): string {
  const d = onlyDigits(v ?? "");
  if (d.length !== 14) return v ?? "—";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function parseNfeXml(xmlText: string): ParsedNote {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const infNFe = doc.getElementsByTagName("infNFe")[0];
  const emit = doc.getElementsByTagName("emit")[0];
  if (!infNFe || !emit) throw new Error("Arquivo não parece ser uma NF-e válida.");

  const idAttr = infNFe.getAttribute("Id") ?? "";
  let chave = onlyDigits(idAttr);
  if (chave.length !== 44) {
    chave = onlyDigits(txt(doc, "chNFe"));
  }
  if (chave.length !== 44) throw new Error("Arquivo não parece ser uma NF-e válida.");

  const ide = doc.getElementsByTagName("ide")[0];
  const dhEmi = txt(ide, "dhEmi") || txt(ide, "dEmi");
  const dataEmissao = dhEmi ? dhEmi.slice(0, 10) : null;

  const dest = doc.getElementsByTagName("dest")[0];
  const icmsTot = doc.getElementsByTagName("ICMSTot")[0];

  const itens: ParsedItem[] = Array.from(doc.getElementsByTagName("det")).map((det) => {
    const prod = det.getElementsByTagName("prod")[0];
    return {
      fornecedor_sku: txt(prod, "cProd"),
      descricao: txt(prod, "xProd"),
      quantidade: num(prod, "qCom"),
      valor_unitario: num(prod, "vUnCom"),
      valor_total: num(prod, "vProd"),
    };
  });

  const valorTotal = icmsTot ? num(icmsTot, "vNF") : 0;

  const cobr = doc.getElementsByTagName("cobr")[0];
  const dups = cobr ? Array.from(cobr.getElementsByTagName("dup")) : [];
  const parcelas: ParsedInstallment[] = dups.length
    ? dups.map((dup, i) => ({
        numero: txt(dup, "nDup") || String(i + 1).padStart(3, "0"),
        vencimento: txt(dup, "dVenc") || dataEmissao,
        valor: num(dup, "vDup"),
      }))
    : [{ numero: "001", vencimento: dataEmissao, valor: valorTotal }];

  return {
    chave_nfe: chave,
    numero_nota: txt(ide, "nNF"),
    fornecedor_nome: txt(emit, "xNome"),
    fornecedor_cnpj: onlyDigits(txt(emit, "CNPJ")),
    destinatario_nome: txt(dest, "xNome"),
    data_emissao: dataEmissao,
    valor_total: valorTotal,
    valor_produtos: icmsTot ? num(icmsTot, "vProd") : 0,
    valor_frete: icmsTot ? num(icmsTot, "vFrete") : 0,
    valor_outros: icmsTot ? num(icmsTot, "vOutro") : 0,
    parcelas,
    itens,
  };
}

const DESTINO_LABEL: Record<Destino, string> = {
  ecommerce: "E-commerce",
  locacao: "Locação",
  nao_definido: "Definir",
};

function destinoBadge(n: SplitNote): string {
  const d = (n.destino ?? "nao_definido") as DestinoFull;
  if (d === "ecommerce") return "E-commerce";
  if (d === "locacao") return "Locação";
  if (d === "rateio") {
    if (n.ecommerce_mode === "percent") {
      const p = Number(n.ecommerce_percent ?? 0);
      return `E-com ${p.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    }
    return `E-com ${formatBRL(Number(n.ecommerce_amount ?? 0))}`;
  }
  return "Definir";
}

type PayableItem = {
  id: string;
  fornecedor_sku: string | null;
  descricao: string | null;
  quantidade: number | null;
  valor_unitario: number | null;
  valor_total: number | null;
  meu_sku: string | null;
};

type CatalogItem = { id: string; sku: string; titulo: string };

function useOwnerId() {
  const q = useQuery({
    queryKey: ["auth-user-id"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });
  return q.data ?? null;
}

function invalidateMatchQueries(qc: ReturnType<typeof useQueryClient>, noteId: string) {
  qc.invalidateQueries({ queryKey: ["payable-note-detail", noteId] });
  qc.invalidateQueries({ queryKey: ["payable-notes"] });
  qc.invalidateQueries({ queryKey: ["sku_translation_rules"] });
  qc.invalidateQueries({
    predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("product-catalog"),
  });
  qc.invalidateQueries({ queryKey: ["sku-suggestions"] });
}

function ItemMatchRow({
  item,
  noteId,
  ownerId,
  sugeridoInicial,
  tituloBySku,
}: {
  item: PayableItem;
  noteId: string;
  ownerId: string | null;
  sugeridoInicial: string;
  tituloBySku: Map<string, string>;
}) {
  const qc = useQueryClient();
  const [sku, setSku] = useState(sugeridoInicial);
  const [skuSelecionado, setSkuSelecionado] = useState<string | null>(sugeridoInicial.trim() || null);
  const [busca, setBusca] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setSku(sugeridoInicial);
    setSkuSelecionado(sugeridoInicial.trim() || null);
  }, [sugeridoInicial]);

  useEffect(() => {
    const t = setTimeout(() => setBusca(sku.trim()), 300);
    return () => clearTimeout(t);
  }, [sku]);

  const sugQuery = useQuery({
    queryKey: ["sku-suggestions", busca, ownerId],
    enabled: !!ownerId && open && busca.length >= 1,
    queryFn: async (): Promise<CatalogItem[]> => {
      const { data, error } = await supabase.rpc("product_catalog", {
        _owner: ownerId!,
        _tipo: "todos",
        _busca: busca,
      });
      if (error) throw error;
      return ((data ?? []) as CatalogItem[]).slice(0, 8);
    },
  });

  const casadoSku = item.meu_sku?.trim() || "";
  const titulo = tituloBySku.get(sku.trim()) ?? null;
  const custo = Number(item.valor_unitario ?? 0);

  const match = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão inválida");
      const escolhido = (skuSelecionado ?? "").trim();
      if (!escolhido) throw new Error("Selecione um SKU da lista");
      const { data, error } = await supabase.rpc("match_payable_item", {
        _owner: ownerId,
        _item_id: item.id,
        _meu_sku: escolhido,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (novoCusto) => {
      toast.success(`Custo atualizado: ${formatBRL(novoCusto)}`);
      invalidateMatchQueries(qc, noteId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sugestoes = sugQuery.data ?? [];

  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-[220px] flex-1">
          <div className="font-mono text-xs text-muted-foreground">{item.fornecedor_sku || "sem SKU"}</div>
          <div className="text-sm">{item.descricao}</div>
        </div>
        <div className="text-right text-xs tabular-nums text-muted-foreground">
          <div>
            {Number(item.quantidade ?? 0)} × {formatBRL(custo)}
          </div>
          <div className="text-foreground">{formatBRL(Number(item.valor_total ?? 0))}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-start gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Input
            value={sku}
            onChange={(e) => {
              setSku(e.target.value);
              setSkuSelecionado(null);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Meu SKU — digite para buscar"
            className="h-9 font-mono text-xs"
            autoComplete="off"
          />
          {open && sugestoes.length > 0 ? (
            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
              {sugestoes.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-accent"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setSku(s.sku);
                    setSkuSelecionado(s.sku);
                    setOpen(false);
                  }}
                >
                  <span className="font-mono text-xs">{s.sku}</span>
                  <span className="max-w-full truncate text-xs text-muted-foreground">{s.titulo}</span>
                </button>
              ))}
            </div>
          ) : null}
          {titulo ? <p className="mt-1 truncate text-xs text-muted-foreground">{titulo}</p> : null}
        </div>
        <Button size="sm" className="h-9" onClick={() => match.mutate()} disabled={match.isPending || !skuSelecionado}>
          {match.isPending ? "Casando..." : casadoSku ? "Recasar" : "Casar"}
        </Button>
      </div>

      {!skuSelecionado && sku.trim() ? (
        <div className="mt-2 text-xs text-amber-600">Selecione um SKU da lista.</div>
      ) : null}

      {casadoSku ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">
            <Check className="mr-1 h-3 w-3" /> casado
          </Badge>
          <span className="font-mono">{casadoSku}</span>
          <span className="text-muted-foreground tabular-nums">custo aplicado: {formatBRL(custo)}</span>
        </div>
      ) : sku.trim() ? (
        <div className="mt-2 text-xs text-muted-foreground tabular-nums">
          Sugerido por regra · custo a aplicar: {formatBRL(custo)}
        </div>
      ) : null}
    </div>
  );
}

function PagarParcelaDialog({
  open,
  onOpenChange,
  parcela,
  noteId,
  categoriaId,
  gastoInicial,
  destinoLabel,
  ownerId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  parcela: { id: string; valor: number; vencimento: string | null } | null;
  noteId: string;
  categoriaId: string;
  gastoInicial: string | null;
  destinoLabel: string;
  ownerId: string | null;
}) {
  const qc = useQueryClient();
  const [pagoEm, setPagoEm] = useState(() => new Date().toISOString().slice(0, 10));
  const [gastoId, setGastoId] = useState<string>("");
  const [criando, setCriando] = useState(false);
  const [novoNome, setNovoNome] = useState("");

  useEffect(() => {
    if (open) {
      setPagoEm(new Date().toISOString().slice(0, 10));
      setGastoId(gastoInicial ?? "");
      setCriando(false);
      setNovoNome("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, gastoInicial]);

  const gastosQuery = useQuery({
    queryKey: ["gastos-sub", categoriaId, ownerId],
    enabled: open && !!ownerId && !!categoriaId,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabase.rpc("list_gastos_da_subcategoria", {
        _owner: ownerId!,
        _subcategoria_id: categoriaId,
      });
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const mesLabel = useMemo(() => {
    const [y, m] = pagoEm.split("-");
    return y && m ? `${m}/${y}` : "";
  }, [pagoEm]);

  const criarGasto = useMutation({
    mutationFn: async (nome: string) => {
      if (!ownerId) throw new Error("Sessão inválida");
      const { data, error } = await supabase
        .from("expenses")
        .insert({ owner_id: ownerId, category_id: categoriaId, name: nome.trim(), ecommerce_override: false })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      setGastoId(id);
      setCriando(false);
      setNovoNome("");
      qc.invalidateQueries({ queryKey: ["gastos-sub"] });
      toast.success("Gasto criado.");
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao criar o gasto."),
  });

  const confirmar = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão inválida");
      if (!parcela) throw new Error("Parcela inválida");
      const { error } = await supabase.rpc("pay_installment_to_planilha", {
        _owner: ownerId,
        _installment_id: parcela.id,
        _expense_id: gastoId,
        _pago_em: pagoEm,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Parcela paga e lançada na Planilha.");
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["payable-note-detail", noteId] });
      qc.invalidateQueries({ queryKey: ["payable-notes"] });
      qc.invalidateQueries({ queryKey: ["payable-notes-sub"] });
      qc.invalidateQueries({ queryKey: ["gastos-sub"] });
      qc.invalidateQueries({ queryKey: ["expense-sheet"] });
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao dar baixa na parcela."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dar baixa na parcela</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm">
            <div className="tabular-nums">
              Valor: <span className="font-semibold">{formatBRL(Number(parcela?.valor ?? 0))}</span>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              Vencimento: {parcela?.vencimento ? formatDate(parcela.vencimento) : "—"}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pago-em">Data do pagamento</Label>
            <Input id="pago-em" type="date" value={pagoEm} onChange={(e) => setPagoEm(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Será lançado na Planilha em {mesLabel} em {destinoLabel}.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Lançar no gasto</Label>
            {gastosQuery.isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <div className="max-h-44 space-y-1 overflow-y-auto">
                {(gastosQuery.data ?? []).length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">Nenhum gasto nesta categoria ainda.</p>
                ) : (
                  (gastosQuery.data ?? []).map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGastoId(g.id)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50",
                        g.id === gastoId && "bg-primary/10 text-primary",
                      )}
                    >
                      <span className="truncate">{g.name}</span>
                      {g.id === gastoId ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                    </button>
                  ))
                )}
              </div>
            )}

            {criando ? (
              <div className="space-y-2 rounded-md border border-border/60 p-2">
                <div className="flex flex-wrap gap-1">
                  {["Diversos", "Toners", "Peças", "Máquinas"].map((s) => (
                    <Button key={s} type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setNovoNome(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
                <Input
                  placeholder="Nome do gasto"
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!novoNome.trim() || criarGasto.isPending}
                    onClick={() => criarGasto.mutate(novoNome)}
                  >
                    Criar gasto
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCriando(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => setCriando(true)}>
                ＋ Novo gasto
              </Button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!gastoId || confirmar.isPending} onClick={() => confirmar.mutate()}>
            {confirmar.isPending ? "Confirmando..." : "Confirmar baixa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoteDetails({
  noteId,
  categoriaEfetiva,
  gastoId,
  tipoConta,
  destinoLabel,
  recorrenciaId,
}: {
  noteId: string;
  categoriaEfetiva: string | null;
  gastoId: string | null;
  tipoConta: "fornecedor" | "geral";
  destinoLabel: string;
  recorrenciaId?: string | null;
}) {
  const qc = useQueryClient();
  const ownerId = useOwnerId();
  const mostrarItens = tipoConta === "fornecedor";
  const [pagarParcela, setPagarParcela] = useState<{ id: string; valor: number; vencimento: string | null } | null>(
    null,
  );
  const [tornarAberto, setTornarAberto] = useState(false);
  const [recDia, setRecDia] = useState("10");
  const [recMeses, setRecMeses] = useState("12");

  const { data, isLoading } = useQuery({
    queryKey: ["payable-note-detail", noteId],
    queryFn: async () => {
      const [parc, itens] = await Promise.all([
        supabase
          .from("payable_installments")
          .select("id, numero, vencimento, valor, status, pago_em, planilha_lancado")
          .eq("note_id", noteId)
          .order("vencimento", { ascending: true }),
        supabase
          .from("payable_items")
          .select("id, fornecedor_sku, descricao, quantidade, valor_unitario, valor_total, meu_sku")
          .eq("note_id", noteId),
      ]);
      if (parc.error) throw parc.error;
      if (itens.error) throw itens.error;
      return { parcelas: parc.data ?? [], itens: (itens.data ?? []) as PayableItem[] };
    },
  });

  const rulesQuery = useQuery({
    queryKey: ["sku_translation_rules"],
    queryFn: async (): Promise<{ fornecedor_sku: string; meu_sku: string }[]> => {
      const { data, error } = await supabase.from("sku_translation_rules").select("fornecedor_sku, meu_sku");
      if (error) throw error;
      return data ?? [];
    },
  });

  const catalogQuery = useQuery({
    queryKey: ["product-catalog-all", ownerId],
    enabled: !!ownerId,
    queryFn: async (): Promise<CatalogItem[]> => {
      const { data, error } = await supabase.rpc("product_catalog", { _owner: ownerId!, _tipo: "todos" });
      if (error) throw error;
      return (data ?? []) as CatalogItem[];
    },
  });

  const tituloBySku = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of catalogQuery.data ?? []) m.set(p.sku, p.titulo);
    return m;
  }, [catalogQuery.data]);

  const ruleBySku = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rulesQuery.data ?? []) m.set(r.fornecedor_sku, r.meu_sku);
    return m;
  }, [rulesQuery.data]);

  const itens = data?.itens ?? [];
  const sugeridoFor = (i: PayableItem) =>
    i.meu_sku?.trim() || (i.fornecedor_sku ? ruleBySku.get(i.fornecedor_sku) ?? "" : "");

  const casarTodos = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão inválida");
      const alvos = itens.filter((i) => sugeridoFor(i));
      for (const i of alvos) {
        const { error } = await supabase.rpc("match_payable_item", {
          _owner: ownerId,
          _item_id: i.id,
          _meu_sku: sugeridoFor(i),
        });
        if (error) throw error;
      }
      return alvos.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} ${n === 1 ? "item casado" : "itens casados"}`);
      invalidateMatchQueries(qc, noteId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendentesCasarTodos = itens.filter((i) => sugeridoFor(i)).length;

  const reabrir = useMutation({
    mutationFn: async (id: string) => {
      if (!ownerId) throw new Error("Sessão inválida");
      const { error } = await supabase.rpc("reopen_installment", { _owner: ownerId, _installment_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Parcela reaberta e valor estornado da Planilha.");
      qc.invalidateQueries({ queryKey: ["payable-note-detail", noteId] });
      qc.invalidateQueries({ queryKey: ["payable-notes"] });
      qc.invalidateQueries({ queryKey: ["payable-notes-sub"] });
      qc.invalidateQueries({ queryKey: ["gastos-sub"] });
      qc.invalidateQueries({ queryKey: ["expense-sheet"] });
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao reabrir a parcela."),
  });

  const tornarRecorrenteMut = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão inválida");
      const { error } = await supabase.rpc("tornar_conta_recorrente", {
        _owner: ownerId,
        _note_id: noteId,
        _meses: Number(recMeses) || 12,
        _dia_vencimento: Number(recDia) || 10,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Conta agora é recorrente — meses gerados.");
      setTornarAberto(false);
      qc.invalidateQueries({ queryKey: ["payable-notes"] });
      qc.invalidateQueries({ queryKey: ["payable-notes-sub"] });
      qc.invalidateQueries({ queryKey: ["recorrencias"] });
      qc.invalidateQueries({ queryKey: ["payable-note-detail", noteId] });
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao tornar a conta recorrente."),
  });

  if (isLoading) {
    return (
      <div className="space-y-2 border-t border-border/60 bg-muted/20 px-4 py-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 border-t border-border/60 bg-muted/20 px-4 py-4">
      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Parcelas</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nº</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.parcelas ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell className="tabular-nums">{p.numero}</TableCell>
                <TableCell className="tabular-nums">{formatDate(p.vencimento)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatBRL(Number(p.valor ?? 0))}</TableCell>
                <TableCell>
                  {p.status === "paga" ? (
                    <span className="text-emerald-500">
                      Paga{p.pago_em ? ` em ${formatDate(p.pago_em)}` : ""}
                    </span>
                  ) : (
                    "Aberta"
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {p.status === "paga" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      disabled={reabrir.isPending}
                      onClick={() => reabrir.mutate(p.id)}
                    >
                      Reabrir
                    </Button>
                  ) : (
                  <div className="flex flex-col items-end gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={!categoriaEfetiva}
                      title={!categoriaEfetiva ? "Defina o destino (categoria) da conta antes de dar baixa" : undefined}
                      onClick={() =>
                        setPagarParcela({ id: p.id, valor: Number(p.valor ?? 0), vencimento: p.vencimento })
                      }
                    >
                      Marcar paga
                    </Button>
                    {!categoriaEfetiva ? (
                      <span className="text-[11px] text-muted-foreground">
                        Defina o destino da conta antes de dar baixa
                      </span>
                    ) : null}
                  </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {recorrenciaId ? (
        <p className="text-xs text-muted-foreground">Esta conta faz parte de uma recorrência.</p>
      ) : tornarAberto ? (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-border/60 bg-card/40 p-3">
          <div className="w-36">
            <Label className="text-xs text-muted-foreground">Dia do vencimento</Label>
            <Input
              type="number"
              min={1}
              max={31}
              value={recDia}
              onChange={(e) => setRecDia(e.target.value)}
              className="h-9 tabular-nums"
            />
          </div>
          <div className="w-44">
            <Label className="text-xs text-muted-foreground">Gerar por quantos meses</Label>
            <Input
              type="number"
              min={1}
              value={recMeses}
              onChange={(e) => setRecMeses(e.target.value)}
              className="h-9 tabular-nums"
            />
          </div>
          <Button
            size="sm"
            className="h-9"
            disabled={
              tornarRecorrenteMut.isPending ||
              Number(recDia) < 1 ||
              Number(recDia) > 31 ||
              Number(recMeses) < 1
            }
            onClick={() => tornarRecorrenteMut.mutate()}
          >
            {tornarRecorrenteMut.isPending ? "Criando..." : "Confirmar"}
          </Button>
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setTornarAberto(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => {
            const venc = data?.parcelas?.[0]?.vencimento;
            const dia = venc ? Number(String(venc).slice(8, 10)) : 10;
            setRecDia(String(dia >= 1 && dia <= 31 ? dia : 10));
            setTornarAberto(true);
          }}
        >
          <Repeat className="mr-2 h-4 w-4" /> Tornar recorrente
        </Button>
      )}
      {mostrarItens ? (
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Itens</div>
          {pendentesCasarTodos > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => casarTodos.mutate()}
              disabled={casarTodos.isPending}
            >
              {casarTodos.isPending ? "Casando..." : `Casar todos (${pendentesCasarTodos})`}
            </Button>
          ) : null}
        </div>
        <div className="space-y-2">
          {itens.map((i) => (
            <ItemMatchRow
              key={i.id}
              item={i}
              noteId={noteId}
              ownerId={ownerId}
              sugeridoInicial={sugeridoFor(i)}
              tituloBySku={tituloBySku}
            />
          ))}
        </div>
      </div>
      ) : null}
      {categoriaEfetiva ? (
        <PagarParcelaDialog
          open={!!pagarParcela}
          onOpenChange={(o) => !o && setPagarParcela(null)}
          parcela={pagarParcela}
          noteId={noteId}
          categoriaId={categoriaEfetiva}
          gastoInicial={gastoId}
          destinoLabel={destinoLabel}
          ownerId={ownerId}
        />
      ) : null}
    </div>
  );
}

function DestinoEditor({ note }: { note: SplitNote }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const initial = (note.destino ?? "nao_definido") as DestinoFull;
  const [choice, setChoice] = useState<DestinoFull>(initial === "nao_definido" ? "ecommerce" : initial);
  const [mode, setMode] = useState<"percent" | "fixed">(note.ecommerce_mode === "fixed" ? "fixed" : "percent");
  const [valor, setValor] = useState<string>(
    note.ecommerce_mode === "fixed"
      ? String(Number(note.ecommerce_amount ?? 0)).replace(".", ",")
      : String(Number(note.ecommerce_percent ?? 0)).replace(".", ","),
  );

  const total = Number(note.valor_total ?? 0);
  const parsed = parseBRL(valor);
  const partEcom =
    choice === "ecommerce"
      ? total
      : choice === "locacao"
        ? 0
        : mode === "percent"
          ? (total * Math.min(Math.max(parsed, 0), 100)) / 100
          : Math.min(Math.max(parsed, 0), total);
  const partLoc = total - partEcom;

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload =
        choice === "rateio"
          ? mode === "percent"
            ? {
                destino: "rateio",
                ecommerce_mode: "percent",
                ecommerce_percent: Math.min(Math.max(parsed, 0), 100),
                ecommerce_amount: 0,
              }
            : {
                destino: "rateio",
                ecommerce_mode: "fixed",
                ecommerce_amount: Math.min(Math.max(parsed, 0), total),
                ecommerce_percent: 0,
              }
          : { destino: choice };
      const { error } = await supabase.from("payable_notes").update(payload).eq("id", note.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Destino atualizado.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["payable-notes"] });
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao salvar destino."),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()}>
          {initial === "nao_definido" ? (
            <Badge
              variant="outline"
              className="border-amber-500/50 bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 cursor-pointer whitespace-nowrap font-medium"
            >
              <AlertTriangle size={12} className="mr-1" />
              Definir rateio
            </Badge>
          ) : (
            <Badge variant="secondary" className="cursor-pointer whitespace-nowrap">
              {destinoBadge(note)}
            </Badge>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,20rem)] max-w-[calc(100vw-1.5rem)] space-y-3" align="start" collisionPadding={12}>
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Destino da nota</div>
        <div className="inline-flex w-full rounded-md border border-border/60 bg-card/60 p-0.5">
          {([
            ["ecommerce", "E-commerce"],
            ["locacao", "Locação"],
            ["rateio", "Ratear"],
          ] as const).map(([v, label]) => (
            <Button
              key={v}
              size="sm"
              variant="ghost"
              onClick={() => setChoice(v)}
              className={cn("h-8 flex-1 px-2 text-xs", choice === v && "bg-primary/15 text-primary hover:bg-primary/15")}
            >
              {label}
            </Button>
          ))}
        </div>

        {choice === "rateio" ? (
          <div className="space-y-2">
            <div className="inline-flex rounded-md border border-border/60 bg-card/60 p-0.5">
              {([
                ["percent", "%"],
                ["fixed", "R$"],
              ] as const).map(([v, label]) => (
                <Button
                  key={v}
                  size="sm"
                  variant="ghost"
                  onClick={() => setMode(v)}
                  className={cn("h-7 px-3 text-xs", mode === v && "bg-primary/15 text-primary hover:bg-primary/15")}
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                {mode === "percent" ? "% do e-commerce (0 a 100)" : "Valor do e-commerce (R$)"}
              </Label>
              <Input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                inputMode="decimal"
                className="tabular-nums"
              />
            </div>
          </div>
        ) : null}

        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs tabular-nums">
          E-commerce: {formatBRL(partEcom)} · Locação: {formatBRL(partLoc)}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button size="sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PreviewItemRow({
  item,
  index,
  ownerId,
  selecionado,
  onSelect,
  tituloBySku,
}: {
  item: ParsedItem;
  index: number;
  ownerId: string | null;
  selecionado: string | null;
  onSelect: (index: number, sku: string | null, titulo: string | null) => void;
  tituloBySku: Map<string, string>;
}) {
  const [texto, setTexto] = useState(selecionado ?? "");
  const [busca, setBusca] = useState("");
  const [open, setOpen] = useState(false);
  const [tituloSel, setTituloSel] = useState<string | null>(
    selecionado ? (tituloBySku.get(selecionado) ?? null) : null,
  );

  useEffect(() => {
    if (selecionado) {
      setTexto(selecionado);
      setTituloSel(tituloBySku.get(selecionado) ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionado]);

  useEffect(() => {
    const t = setTimeout(() => setBusca(texto.trim()), 300);
    return () => clearTimeout(t);
  }, [texto]);

  const sugQuery = useQuery({
    queryKey: ["sku-suggestions", busca, ownerId],
    enabled: !!ownerId && open && busca.length >= 1,
    queryFn: async (): Promise<CatalogItem[]> => {
      const { data, error } = await supabase.rpc("product_catalog", {
        _owner: ownerId!,
        _tipo: "todos",
        _busca: busca,
      });
      if (error) throw error;
      return ((data ?? []) as CatalogItem[]).slice(0, 8);
    },
  });

  const sugestoes = sugQuery.data ?? [];
  const textoSujo = texto.trim().length > 0 && !selecionado;

  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-[220px] flex-1">
          <div className="font-mono text-xs text-muted-foreground">{item.fornecedor_sku || "sem SKU"}</div>
          <div className="text-sm">{item.descricao}</div>
        </div>
        <div className="text-right text-xs tabular-nums text-muted-foreground">
          <div>
            {item.quantidade} × {formatBRL(item.valor_unitario)}
          </div>
          <div className="text-foreground">{formatBRL(item.valor_total)}</div>
        </div>
      </div>

      <div className="relative mt-3">
        <Input
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setOpen(true);
            if (selecionado) onSelect(index, null, null);
            setTituloSel(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Meu SKU — digite e escolha na lista"
          className="h-9 font-mono text-xs"
          autoComplete="off"
        />
        {open && sugestoes.length > 0 ? (
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
            {sugestoes.map((s) => (
              <button
                key={s.id}
                type="button"
                className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-accent"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setTexto(s.sku);
                  setTituloSel(s.titulo);
                  setOpen(false);
                  onSelect(index, s.sku, s.titulo);
                }}
              >
                <span className="font-mono text-xs">{s.sku}</span>
                <span className="max-w-full truncate text-xs text-muted-foreground">{s.titulo}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {selecionado ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-emerald-600">
          <Check className="h-3.5 w-3.5" />
          <span className="font-mono">{selecionado}</span>
          {tituloSel ? <span className="truncate text-muted-foreground">{tituloSel}</span> : null}
          <span className="tabular-nums text-muted-foreground">
            custo a aplicar: {formatBRL(item.valor_unitario)}
          </span>
        </div>
      ) : textoSujo ? (
        <div className="mt-2 text-xs text-amber-600">Selecione um SKU da lista — texto livre não casa.</div>
      ) : null}
    </div>
  );
}

type Fornecedor = { id: string; name: string; cnpj: string | null };

function useFornecedores(ownerId: string | null) {
  return useQuery({
    queryKey: ["fornecedores", ownerId],
    enabled: !!ownerId,
    queryFn: async (): Promise<Fornecedor[]> => {
      const { data, error } = await supabase.rpc("list_fornecedores", { _owner: ownerId! });
      if (error) throw error;
      return (data ?? []) as Fornecedor[];
    },
    staleTime: 60_000,
  });
}

function FornecedorPicker({
  ownerId,
  value,
  label,
  sugestaoNome,
  sugestaoCnpj,
  onChange,
}: {
  ownerId: string | null;
  value: string | null;
  label?: string | null;
  sugestaoNome?: string;
  sugestaoCnpj?: string;
  onChange: (id: string, name: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [criando, setCriando] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoCnpj, setNovoCnpj] = useState("");
  const listQuery = useFornecedores(ownerId);

  const atual = useMemo(
    () => (listQuery.data ?? []).find((f) => f.id === value)?.name ?? label ?? null,
    [listQuery.data, value, label],
  );

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const all = listQuery.data ?? [];
    if (!t) return all.slice(0, 50);
    return all.filter((f) => (f.name ?? "").toLowerCase().includes(t)).slice(0, 50);
  }, [listQuery.data, busca]);

  const createMut = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão inválida");
      const nome = novoNome.trim();
      if (!nome) throw new Error("Informe o nome do fornecedor.");
      const { data, error } = await supabase.rpc("create_fornecedor", {
        _owner: ownerId,
        _nome: nome,
        _cnpj: onlyDigits(novoCnpj) || undefined,
      });
      if (error) throw error;
      return { id: data as unknown as string, name: nome };
    },
    onSuccess: ({ id, name }) => {
      qc.invalidateQueries({ queryKey: ["fornecedores"] });
      onChange(id, name);
      setCriando(false);
      setOpen(false);
      toast.success("Fornecedor vinculado.");
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao criar fornecedor."),
  });

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setCriando(false);
          setBusca("");
          setNovoNome(sugestaoNome ?? "");
          setNovoCnpj(sugestaoCnpj ?? "");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()}>
          <Badge variant={value ? "secondary" : "outline"} className="cursor-pointer whitespace-nowrap">
            {atual ? `Fornecedor: ${atual}` : "Vincular fornecedor"}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,20rem)] max-w-[calc(100vw-1.5rem)] space-y-3" align="start" collisionPadding={12}>
        {criando ? (
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Novo fornecedor</div>
            <div className="space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CNPJ (opcional)</Label>
              <Input value={novoCnpj} onChange={(e) => setNovoCnpj(e.target.value)} className="tabular-nums" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setCriando(false)}>
                Voltar
              </Button>
              <Button size="sm" disabled={createMut.isPending} onClick={() => createMut.mutate()}>
                {createMut.isPending ? "Criando…" : "Criar e vincular"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Input placeholder="Buscar fornecedor…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {listQuery.isLoading ? (
                <div className="px-2 py-1 text-xs text-muted-foreground">Carregando…</div>
              ) : filtrados.length === 0 ? (
                <div className="px-2 py-1 text-xs text-muted-foreground">Nenhum fornecedor encontrado.</div>
              ) : (
                filtrados.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      onChange(f.id, f.name);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50",
                      f.id === value && "bg-primary/10 text-primary",
                    )}
                  >
                    <span className="truncate">{f.name}</span>
                    {f.id === value ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                  </button>
                ))
              )}
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={() => setCriando(true)}>
              ＋ Criar fornecedor
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

type Categoria = {
  id: string;
  name: string;
  parent_id: string | null;
  parent_name: string | null;
  is_fornecedores: boolean;
  allow_subcategories: boolean;
  nivel: number;
};

type DestinoSel = {
  categoriaId: string | null;
  subcategoriaId: string | null;
  gastoId: string | null;
  tipoConta: "fornecedor" | "geral";
  categoriaLabel: string | null;
  subcategoriaLabel: string | null;
  gastoLabel: string | null;
};

const DESTINO_VAZIO: DestinoSel = {
  categoriaId: null,
  subcategoriaId: null,
  gastoId: null,
  tipoConta: "geral",
  categoriaLabel: null,
  subcategoriaLabel: null,
  gastoLabel: null,
};

function destinoTexto(v: DestinoSel): string {
  const partes = [v.categoriaLabel, v.subcategoriaLabel, v.gastoLabel].filter(Boolean);
  return partes.length ? partes.join(" › ") : "Definir destino";
}

/** Confirma pendências de categoria e/ou rateio antes de gravar. Retorna false se o usuário cancelar. */
function mensagensPendencias(dest: DestinoSel, destinoRateio: DestinoFull): string[] {
  const semCategoria = !dest.categoriaId && !dest.subcategoriaId;
  const semRateio = destinoRateio === "nao_definido";
  const pend: string[] = [];
  if (semCategoria) {
    pend.push(
      "• Você não selecionou categoria nem fornecedor para esta conta. Tem certeza que não sabe a qual categoria/fornecedor ela pertence? Você pode definir depois.",
    );
  }
  if (semRateio) {
    pend.push(
      '• Você não definiu o rateio (E-commerce / Locação) desta conta. Ela ficará marcada como "Definir rateio".',
    );
  }
  return pend;
}

function confirmarPendencias(dest: DestinoSel, destinoRateio: DestinoFull): boolean {
  const pend = mensagensPendencias(dest, destinoRateio);
  if (!pend.length) return true;
  return window.confirm(`${pend.join("\n\n")}\n\nDeseja salvar mesmo assim?`);
}

function useCategorias(ownerId: string | null) {
  return useQuery({
    queryKey: ["categorias-arvore", ownerId],
    enabled: !!ownerId,
    staleTime: 60_000,
    queryFn: async (): Promise<Categoria[]> => {
      const { data, error } = await supabase.rpc("list_categorias_arvore", { _owner: ownerId! });
      if (error) throw error;
      return (data ?? []) as Categoria[];
    },
  });
}

function DestinoPicker({
  ownerId,
  value,
  sugestaoNome,
  sugestaoCnpj,
  onChange,
}: {
  ownerId: string | null;
  value: DestinoSel;
  sugestaoNome?: string;
  sugestaoCnpj?: string;
  onChange: (v: DestinoSel) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [catId, setCatId] = useState<string | null>(value.categoriaId);
  const [subId, setSubId] = useState<string | null>(value.subcategoriaId);
  const [gastoId, setGastoId] = useState<string | null>(value.gastoId);
  const [buscaCat, setBuscaCat] = useState("");
  const [criandoCat, setCriandoCat] = useState(false);
  const [novaCat, setNovaCat] = useState("");
  const [criandoForn, setCriandoForn] = useState(false);
  const [novoForn, setNovoForn] = useState("");
  const [novoFornCnpj, setNovoFornCnpj] = useState("");
  const [criandoGasto, setCriandoGasto] = useState(false);
  const [novoGasto, setNovoGasto] = useState("");
  const [buscaGasto, setBuscaGasto] = useState("");
  const [buscaForn, setBuscaForn] = useState("");

  const catQuery = useCategorias(ownerId);
  const fornQuery = useFornecedores(ownerId);

  useEffect(() => {
    if (!open) return;
    setCatId(value.categoriaId);
    setSubId(value.subcategoriaId);
    setGastoId(value.gastoId);
    setBuscaCat("");
    setBuscaGasto("");
    setBuscaForn("");
    setCriandoCat(false);
    setCriandoForn(false);
    setCriandoGasto(false);
    setNovaCat("");
    setNovoForn(sugestaoNome ?? "");
    setNovoFornCnpj(sugestaoCnpj ?? "");
    setNovoGasto("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const topos = useMemo(() => {
    const t = buscaCat.trim().toLowerCase();
    const all = (catQuery.data ?? []).filter((c) => Number(c.nivel) === 0);
    if (!t) return all;
    return all.filter((c) => (c.name ?? "").toLowerCase().includes(t));
  }, [catQuery.data, buscaCat]);

  const cat = useMemo(() => (catQuery.data ?? []).find((c) => c.id === catId) ?? null, [catQuery.data, catId]);
  const ehFornecedores = !!cat?.is_fornecedores;
  const categoriaEfetiva = ehFornecedores ? subId : catId;

  const gastosQuery = useQuery({
    queryKey: ["gastos-sub", categoriaEfetiva, ownerId],
    enabled: open && !!ownerId && !!categoriaEfetiva,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabase.rpc("list_gastos_da_subcategoria", {
        _owner: ownerId!,
        _subcategoria_id: categoriaEfetiva!,
      });
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const gastosFiltrados = useMemo(() => {
    const t = buscaGasto.trim().toLowerCase();
    const all = gastosQuery.data ?? [];
    if (!t) return all;
    return all.filter((g) => (g.name ?? "").toLowerCase().includes(t));
  }, [gastosQuery.data, buscaGasto]);

  const fornecedoresFiltrados = useMemo(() => {
    const t = buscaForn.trim().toLowerCase();
    const all = fornQuery.data ?? [];
    if (!t) return all;
    return all.filter((f) => (f.name ?? "").toLowerCase().includes(t));
  }, [fornQuery.data, buscaForn]);

  const criarCat = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão inválida");
      const nome = novaCat.trim();
      if (!nome) throw new Error("Informe o nome da categoria.");
      const { data, error } = await supabase.rpc("create_categoria", { _owner: ownerId, _nome: nome });
      if (error) throw error;
      return { id: data as unknown as string, nome };
    },
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ["categorias-arvore"] });
      setCatId(id);
      setSubId(null);
      setGastoId(null);
      setCriandoCat(false);
      setNovaCat("");
      toast.success("Categoria criada.");
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao criar categoria."),
  });

  const criarForn = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão inválida");
      const nome = novoForn.trim();
      if (!nome) throw new Error("Informe o nome do fornecedor.");
      const { data, error } = await supabase.rpc("create_fornecedor", {
        _owner: ownerId,
        _nome: nome,
        _cnpj: onlyDigits(novoFornCnpj) || undefined,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["fornecedores"] });
      setSubId(id);
      setGastoId(null);
      setCriandoForn(false);
      toast.success("Fornecedor criado.");
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao criar fornecedor."),
  });

  const criarGasto = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão inválida");
      if (!categoriaEfetiva) throw new Error("Escolha a categoria antes.");
      const nome = novoGasto.trim();
      if (!nome) throw new Error("Informe o nome do gasto.");
      const { data, error } = await supabase.rpc("create_gasto", {
        _owner: ownerId,
        _categoria_id: categoriaEfetiva,
        _nome: nome,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["gastos-sub"] });
      setGastoId(id);
      setCriandoGasto(false);
      setNovoGasto("");
      toast.success("Gasto criado.");
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao criar gasto."),
  });

  const salvar = () => {
    if (!catId) {
      toast.error("Escolha uma categoria.");
      return;
    }
    if (ehFornecedores && !subId) {
      toast.error("Escolha o fornecedor.");
      return;
    }
    const gasto = (gastosQuery.data ?? []).find((g) => g.id === gastoId) ?? null;
    const sub = (fornQuery.data ?? []).find((f) => f.id === subId) ?? null;
    onChange({
      categoriaId: catId,
      subcategoriaId: ehFornecedores ? subId : null,
      gastoId: gastoId ?? null,
      tipoConta: ehFornecedores ? "fornecedor" : "geral",
      categoriaLabel: cat?.name ?? null,
      subcategoriaLabel: ehFornecedores ? (sub?.name ?? null) : null,
      gastoLabel: gasto?.name ?? null,
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()}>
          <Badge
            variant={value.categoriaId ? "secondary" : "outline"}
            className="max-w-[260px] cursor-pointer truncate whitespace-nowrap"
          >
            {destinoTexto(value)}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(92vw,640px)] max-w-[calc(100vw-1.5rem)] max-h-[min(80vh,var(--radix-popover-content-available-height))] overflow-y-auto p-0"
        align="start"
        collisionPadding={12}
      >
        <div className="border-b border-border/60 px-4 py-3">
          <div className="text-sm font-medium">Destino da conta</div>
          <p className="text-xs text-muted-foreground">
            Escolha a categoria (ou o fornecedor). O gasto é um detalhe opcional.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          {/* Coluna esquerda: categoria / fornecedor */}
          <div className="min-w-0 space-y-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Categoria ou subcategoria
              </span>
              <span className="text-xs text-muted-foreground">(recomendado)</span>
            </div>
            {criandoCat ? (
              <div className="space-y-2 rounded-md border border-border/60 p-2">
                <Input placeholder="Nome da categoria" value={novaCat} onChange={(e) => setNovaCat(e.target.value)} />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setCriandoCat(false)}>
                    Voltar
                  </Button>
                  <Button size="sm" disabled={criarCat.isPending} onClick={() => criarCat.mutate()}>
                    {criarCat.isPending ? "Criando…" : "Criar"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Input placeholder="Buscar categoria…" value={buscaCat} onChange={(e) => setBuscaCat(e.target.value)} />
                <div className="max-h-40 space-y-1 overflow-y-auto overscroll-contain" onWheelCapture={(e) => e.stopPropagation()}>
                  {catQuery.isLoading ? (
                    <div className="px-2 py-1 text-xs text-muted-foreground">Carregando…</div>
                  ) : topos.length === 0 ? (
                    <div className="px-2 py-1 text-xs text-muted-foreground">Nenhuma categoria encontrada.</div>
                  ) : (
                    topos.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setCatId(c.id);
                          setSubId(null);
                          setGastoId(null);
                          setBuscaGasto("");
                          setBuscaForn("");
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50",
                          c.id === catId && "bg-primary/10 text-primary",
                        )}
                      >
                        <span className="truncate">{c.name}</span>
                        {c.id === catId ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                      </button>
                    ))
                  )}
                </div>
                <Button variant="outline" size="sm" className="w-full" onClick={() => setCriandoCat(true)}>
                  ＋ Nova categoria
                </Button>
              </div>
            )}

          </div>

          {/* Coluna direita: fornecedor + gasto */}
          <div className="min-w-0 space-y-3 border-t border-border/60 pt-4 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
            {ehFornecedores ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fornecedor</div>
                  {criandoForn ? (
                    <div className="space-y-2 rounded-md border border-border/60 p-2">
                      <Input placeholder="Nome do fornecedor" value={novoForn} onChange={(e) => setNovoForn(e.target.value)} />
                      <Input
                        placeholder="CNPJ (opcional)"
                        value={novoFornCnpj}
                        onChange={(e) => setNovoFornCnpj(e.target.value)}
                        className="tabular-nums"
                      />
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setCriandoForn(false)}>
                          Voltar
                        </Button>
                        <Button size="sm" disabled={criarForn.isPending} onClick={() => criarForn.mutate()}>
                          {criarForn.isPending ? "Criando…" : "Criar"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Input
                        placeholder="Buscar fornecedor…"
                        value={buscaForn}
                        onChange={(e) => setBuscaForn(e.target.value)}
                      />
                      <div className="max-h-40 space-y-1 overflow-y-auto overscroll-contain" onWheelCapture={(e) => e.stopPropagation()}>
                        {fornecedoresFiltrados.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => {
                              setSubId(f.id);
                              setGastoId(null);
                              setBuscaGasto("");
                            }}
                            className={cn(
                              "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50",
                              f.id === subId && "bg-primary/10 text-primary",
                            )}
                          >
                            <span className="truncate">{f.name}</span>
                            {f.id === subId ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                          </button>
                        ))}
                      </div>
                      <Button variant="outline" size="sm" className="w-full" onClick={() => setCriandoForn(true)}>
                        ＋ Criar fornecedor
                      </Button>
                    </div>
                  )}
                </div>

                <div className="space-y-2 border-t border-border/60 pt-3">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Gasto</span>
                    <span className="text-xs text-muted-foreground">(opcional)</span>
                  </div>
                  {subId ? (
                    <div className="space-y-2">
                      <Input
                        placeholder="Buscar gasto…"
                        value={buscaGasto}
                        onChange={(e) => setBuscaGasto(e.target.value)}
                      />
                      <div className="max-h-40 space-y-1 overflow-y-auto overscroll-contain" onWheelCapture={(e) => e.stopPropagation()}>
                        {gastosQuery.isLoading ? (
                          <div className="px-2 py-1 text-xs text-muted-foreground">Carregando…</div>
                        ) : gastosFiltrados.length === 0 ? (
                          <div className="px-2 py-1 text-xs text-muted-foreground">
                            {buscaGasto.trim() ? "Nenhum gasto encontrado." : "Nenhum gasto nesta categoria ainda."}
                          </div>
                        ) : (
                          gastosFiltrados.map((g) => (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => setGastoId(g.id === gastoId ? null : g.id)}
                              className={cn(
                                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50",
                                g.id === gastoId && "bg-primary/10 text-primary",
                              )}
                            >
                              <span className="truncate">{g.name}</span>
                              {g.id === gastoId ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                            </button>
                          ))
                        )}
                      </div>
                      {criandoGasto ? (
                        <div className="space-y-2 rounded-md border border-border/60 p-2">
                          {ehFornecedores ? (
                            <div className="flex flex-wrap gap-1">
                              {["Diversos", "Toners", "Peças", "Máquinas"].map((s) => (
                                <Button
                                  key={s}
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => setNovoGasto(s)}
                                >
                                  {s}
                                </Button>
                              ))}
                            </div>
                          ) : null}
                          <Input placeholder="Nome do gasto" value={novoGasto} onChange={(e) => setNovoGasto(e.target.value)} />
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setCriandoGasto(false)}>
                              Voltar
                            </Button>
                            <Button size="sm" disabled={criarGasto.isPending} onClick={() => criarGasto.mutate()}>
                              {criarGasto.isPending ? "Criando…" : "Criar"}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button variant="outline" size="sm" className="w-full" onClick={() => setCriandoGasto(true)}>
                          ＋ Novo gasto
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
                      Selecione um fornecedor primeiro
                    </div>
                  )}
                </div>
              </div>
            ) : categoriaEfetiva ? (
              <div className="space-y-3">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Gasto</span>
                  <span className="text-xs text-muted-foreground">(opcional)</span>
                </div>
                <div className="space-y-2">
                  <Input
                    placeholder="Buscar gasto…"
                    value={buscaGasto}
                    onChange={(e) => setBuscaGasto(e.target.value)}
                  />
                  <div className="max-h-40 space-y-1 overflow-y-auto overscroll-contain" onWheelCapture={(e) => e.stopPropagation()}>
                    {gastosQuery.isLoading ? (
                      <div className="px-2 py-1 text-xs text-muted-foreground">Carregando…</div>
                    ) : gastosFiltrados.length === 0 ? (
                      <div className="px-2 py-1 text-xs text-muted-foreground">
                        {buscaGasto.trim() ? "Nenhum gasto encontrado." : "Nenhum gasto nesta categoria ainda."}
                      </div>
                    ) : (
                      gastosFiltrados.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => setGastoId(g.id === gastoId ? null : g.id)}
                          className={cn(
                            "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50",
                            g.id === gastoId && "bg-primary/10 text-primary",
                          )}
                        >
                          <span className="truncate">{g.name}</span>
                          {g.id === gastoId ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                        </button>
                      ))
                    )}
                  </div>
                  {criandoGasto ? (
                    <div className="space-y-2 rounded-md border border-border/60 p-2">
                      {ehFornecedores ? (
                        <div className="flex flex-wrap gap-1">
                          {["Diversos", "Toners", "Peças", "Máquinas"].map((s) => (
                            <Button
                              key={s}
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => setNovoGasto(s)}
                            >
                              {s}
                            </Button>
                          ))}
                        </div>
                      ) : null}
                      <Input placeholder="Nome do gasto" value={novoGasto} onChange={(e) => setNovoGasto(e.target.value)} />
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setCriandoGasto(false)}>
                          Voltar
                        </Button>
                        <Button size="sm" disabled={criarGasto.isPending} onClick={() => criarGasto.mutate()}>
                          {criarGasto.isPending ? "Criando…" : "Criar"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" className="w-full" onClick={() => setCriandoGasto(true)}>
                      ＋ Novo gasto
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
                Selecione uma categoria primeiro
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-border/60 bg-popover px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button size="sm" onClick={salvar}>
            Salvar destino
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type NoteMeta = {
  id: string;
  subcategoria_id: string | null;
  categoria_id: string | null;
  gasto_id: string | null;
  tipo_conta: string | null;
  recorrencia_id: string | null;
};

function useNotesMeta() {
  return useQuery({
    queryKey: ["payable-notes-sub"],
    queryFn: async (): Promise<NoteMeta[]> => {
      const { data, error } = await supabase
        .from("payable_notes")
        .select("id, subcategoria_id, categoria_id, gasto_id, tipo_conta, recorrencia_id");
      if (error) throw error;
      return (data ?? []) as NoteMeta[];
    },
  });
}

function NoteDestino({
  note,
  meta,
  ownerId,
}: {
  note: SplitNote;
  meta: NoteMeta | null;
  ownerId: string | null;
}) {
  const qc = useQueryClient();
  const catQuery = useCategorias(ownerId);
  const fornQuery = useFornecedores(ownerId);

  const categoriaEfetiva = meta?.tipo_conta === "fornecedor" ? meta?.subcategoria_id : meta?.categoria_id;

  const gastosQuery = useQuery({
    queryKey: ["gastos-sub", categoriaEfetiva, ownerId],
    enabled: !!ownerId && !!categoriaEfetiva,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabase.rpc("list_gastos_da_subcategoria", {
        _owner: ownerId!,
        _subcategoria_id: categoriaEfetiva!,
      });
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const value: DestinoSel = useMemo(() => {
    if (!meta) return DESTINO_VAZIO;
    const cat = (catQuery.data ?? []).find((c) => c.id === meta.categoria_id) ?? null;
    const sub = (fornQuery.data ?? []).find((f) => f.id === meta.subcategoria_id) ?? null;
    const gasto = (gastosQuery.data ?? []).find((g) => g.id === meta.gasto_id) ?? null;
    return {
      categoriaId: meta.categoria_id,
      subcategoriaId: meta.subcategoria_id,
      gastoId: meta.gasto_id,
      tipoConta: meta.tipo_conta === "fornecedor" ? "fornecedor" : "geral",
      categoriaLabel: cat?.name ?? null,
      subcategoriaLabel: sub?.name ?? null,
      gastoLabel: gasto?.name ?? null,
    };
  }, [meta, catQuery.data, fornQuery.data, gastosQuery.data]);

  const saveMut = useMutation({
    mutationFn: async (v: DestinoSel) => {
      const { error } = await supabase
        .from("payable_notes")
        .update({
          categoria_id: v.categoriaId,
          subcategoria_id: v.subcategoriaId,
          gasto_id: v.gastoId,
          tipo_conta: v.tipoConta,
        })
        .eq("id", note.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Destino da conta atualizado.");
      qc.invalidateQueries({ queryKey: ["payable-notes"] });
      qc.invalidateQueries({ queryKey: ["payable-notes-sub"] });
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao salvar o destino."),
  });

  return (
    <DestinoPicker
      ownerId={ownerId}
      value={value}
      sugestaoNome={note.fornecedor_nome}
      sugestaoCnpj={note.fornecedor_cnpj}
      onChange={(v) => saveMut.mutate(v)}
    />
  );
}

type ManualItem = {
  descricao: string;
  quantidade: string;
  valorUnit: string;
  sku: string | null;
  unidPorEmb: string;
};

const novoManualItem = (): ManualItem => ({
  descricao: "",
  quantidade: "1",
  valorUnit: "",
  sku: null,
  unidPorEmb: "1",
});

const fatorEmb = (it: ManualItem) => {
  const n = Number((it.unidPorEmb ?? "1").replace(",", ".")) || 1;
  return n > 0 ? n : 1;
};

// Custo por unidade de venda: (valor unitário + frete rateado por unidade) / unidades por embalagem
const custoPorUnidadeVenda = (it: ManualItem, freteItem: number) => {
  const qtd = Number(it.quantidade.replace(",", ".")) || 0;
  const comFrete = parseBRL(it.valorUnit) + (qtd > 0 ? freteItem / qtd : 0);
  return comFrete / fatorEmb(it);
};
type ManualParcela = { vencimento: string; valor: string };

function SkuAutocomplete({
  ownerId,
  value,
  onSelect,
}: {
  ownerId: string | null;
  value: string | null;
  onSelect: (sku: string | null) => void;
}) {
  const [texto, setTexto] = useState(value ?? "");
  const [busca, setBusca] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBusca(texto.trim()), 300);
    return () => clearTimeout(t);
  }, [texto]);

  const sugQuery = useQuery({
    queryKey: ["sku-suggestions", busca, ownerId],
    enabled: !!ownerId && open && busca.length >= 1,
    queryFn: async (): Promise<CatalogItem[]> => {
      const { data, error } = await supabase.rpc("product_catalog", {
        _owner: ownerId!,
        _tipo: "todos",
        _busca: busca,
      });
      if (error) throw error;
      return ((data ?? []) as CatalogItem[]).slice(0, 8);
    },
  });

  const sugestoes = sugQuery.data ?? [];
  const textoSujo = texto.trim().length > 0 && !value;

  return (
    <div className="relative">
      <Input
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setOpen(true);
          if (value) onSelect(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Meu SKU — digite e escolha na lista"
        className="h-9 font-mono text-xs"
        autoComplete="off"
      />
      {open && sugestoes.length > 0 ? (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {sugestoes.map((s) => (
            <button
              key={s.id}
              type="button"
              className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-accent"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setTexto(s.sku);
                setOpen(false);
                onSelect(s.sku);
              }}
            >
              <span className="font-mono text-xs">{s.sku}</span>
              <span className="max-w-full truncate text-xs text-muted-foreground">{s.titulo}</span>
            </button>
          ))}
        </div>
      ) : null}
      {value ? (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-600">
          <Check className="h-3.5 w-3.5" />
          <span className="font-mono">{value}</span>
        </div>
      ) : textoSujo ? (
        <div className="mt-1 text-xs text-amber-600">Selecione um SKU da lista — texto livre não casa.</div>
      ) : null}
    </div>
  );
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysISO(baseISO: string, dias: number): string {
  const [y, m, d] = baseISO.split("-").map((n) => Number(n));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + dias);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

type Recorrencia = {
  id: string;
  nome: string;
  valor: number;
  dia_vencimento: number;
  ativo: boolean;
  contas_geradas: number;
  contas_abertas: number;
};

function primeiroDiaMesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

type MesRecorrencia = {
  note_id: string;
  competencia_mes: string;
  vencimento: string | null;
  valor: number;
  status: string;
  pago_em: string | null;
  planilha_lancado: boolean;
};

function formatCompetencia(v: string | null | undefined): string {
  if (!v) return "—";
  const [y, m] = String(v).slice(0, 10).split("-");
  return `${m}/${y}`;
}

function RecorrenciasList({ ownerId }: { ownerId: string | null }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data: lista, isLoading } = useQuery({
    queryKey: ["recorrencias", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_recorrencias", { _owner: ownerId! });
      if (error) throw error;
      return (data ?? []) as unknown as Recorrencia[];
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!lista?.length) {
    return (
      <EmptyState
        icon={Repeat}
        title="Nenhuma recorrência criada"
        description="Crie uma recorrência ao lançar uma conta manual ou importada."
      />
    );
  }

  return (
    <div className="space-y-2">
      {lista.map((r) => (
        <RecorrenciaCard
          key={r.id}
          rec={r}
          ownerId={ownerId}
          open={expanded === r.id}
          onToggle={() => setExpanded((p) => (p === r.id ? null : r.id))}
        />
      ))}
    </div>
  );
}

function RecorrenciaCard({
  rec,
  ownerId,
  open,
  onToggle,
}: {
  rec: Recorrencia;
  ownerId: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const qc = useQueryClient();
  const [novoValor, setNovoValor] = useState("");
  const [aPartirDe, setAPartirDe] = useState(primeiroDiaMesAtual().slice(0, 7));
  const [editMes, setEditMes] = useState<string | null>(null);
  const [valorMes, setValorMes] = useState("");

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["recorrencias"] });
    qc.invalidateQueries({ queryKey: ["meses-recorrencia"] });
    qc.invalidateQueries({ queryKey: ["payable-notes"] });
    qc.invalidateQueries({ queryKey: ["payable-notes-sub"] });
  };

  const mesesQuery = useQuery({
    queryKey: ["meses-recorrencia", rec.id],
    enabled: !!ownerId && open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_meses_recorrencia", {
        _owner: ownerId!,
        _recorrencia_id: rec.id,
      });
      if (error) throw error;
      return (data ?? []) as unknown as MesRecorrencia[];
    },
  });

  const reajusteMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("atualizar_valor_recorrencia", {
        _owner: ownerId!,
        _recorrencia_id: rec.id,
        _novo_valor: parseBRL(novoValor),
        _a_partir_de: `${aPartirDe}-01`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Valores futuros atualizados.");
      setNovoValor("");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao reajustar."),
  });

  const mesMut = useMutation({
    mutationFn: async (v: { competencia: string; valor: number }) => {
      const { error } = await supabase.rpc("ajustar_mes_recorrencia", {
        _owner: ownerId!,
        _recorrencia_id: rec.id,
        _competencia: v.competencia,
        _novo_valor: v.valor,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mês ajustado.");
      setEditMes(null);
      setValorMes("");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao ajustar o mês."),
  });

  const gerarMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("gerar_contas_recorrencia", {
        _owner: ownerId!,
        _recorrencia_id: rec.id,
        _mes_inicial: primeiroDiaMesAtual(),
        _meses: 12,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (n) => {
      toast.success(`${n} ${n === 1 ? "nova conta gerada" : "novas contas geradas"}.`);
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao gerar contas."),
  });

  const toggleMut = useMutation({
    mutationFn: async (ativo: boolean) => {
      const { error } = await supabase.from("payable_recurrences").update({ ativo }).eq("id", rec.id);
      if (error) throw error;
    },
    onSuccess: () => invalidar(),
    onError: (e: Error) => toast.error(e.message || "Falha ao atualizar."),
  });

  const excluirMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("excluir_recorrencia", {
        _owner: ownerId!,
        _recorrencia_id: rec.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Recorrência excluída.");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao excluir."),
  });

  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{rec.nome}</span>
              {!rec.ativo ? <Badge variant="outline">inativa</Badge> : null}
            </div>
            <div className="text-xs text-muted-foreground">
              vence dia {rec.dia_vencimento} · {Number(rec.contas_geradas ?? 0)} conta(s) gerada(s) ·{" "}
              {Number(rec.contas_abertas ?? 0)} em aberto
            </div>
          </div>
          <div className="text-right text-base font-semibold tabular-nums">{formatBRL(Number(rec.valor ?? 0))}</div>
        </button>

        {open ? (
          <div className="space-y-4 border-t border-border/60 bg-muted/20 px-4 py-4">
            <div className="flex flex-wrap items-end gap-3 rounded-md border border-border/60 bg-card/40 p-3">
              <div className="w-36">
                <Label className="text-xs text-muted-foreground">Novo valor</Label>
                <Input
                  value={novoValor}
                  onChange={(e) => setNovoValor(e.target.value)}
                  placeholder="0,00"
                  className="h-9 tabular-nums"
                />
              </div>
              <div className="w-40">
                <Label className="text-xs text-muted-foreground">A partir do mês</Label>
                <Input
                  type="month"
                  value={aPartirDe}
                  onChange={(e) => setAPartirDe(e.target.value)}
                  className="h-9 tabular-nums"
                />
              </div>
              <Button
                size="sm"
                className="h-9"
                disabled={parseBRL(novoValor) <= 0 || !aPartirDe || reajusteMut.isPending}
                onClick={() => reajusteMut.mutate()}
              >
                {reajusteMut.isPending ? "Aplicando..." : "Reajustar meses seguintes"}
              </Button>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9"
                  disabled={gerarMut.isPending}
                  onClick={() => gerarMut.mutate()}
                >
                  {gerarMut.isPending ? "Gerando..." : "Gerar mais 12 meses"}
                </Button>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Ativa</Label>
                  <Switch
                    checked={rec.ativo}
                    disabled={toggleMut.isPending}
                    onCheckedChange={(v) => toggleMut.mutate(v)}
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 text-destructive"
                  disabled={excluirMut.isPending}
                  onClick={() => {
                    const ok = window.confirm(
                      "Excluir esta recorrência? As contas não pagas serão removidas; as pagas viram avulsas.",
                    );
                    if (ok) excluirMut.mutate();
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Excluir
                </Button>
              </div>
            </div>

            {mesesQuery.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !mesesQuery.data?.length ? (
              <p className="text-sm text-muted-foreground">Nenhum mês gerado ainda.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Competência</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mesesQuery.data.map((m) => {
                    const paga = m.status === "paga";
                    const editando = editMes === m.competencia_mes;
                    return (
                      <TableRow key={m.note_id}>
                        <TableCell className="tabular-nums">{formatCompetencia(m.competencia_mes)}</TableCell>
                        <TableCell className="tabular-nums">{formatDate(m.vencimento)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {editando ? (
                            <Input
                              value={valorMes}
                              onChange={(e) => setValorMes(e.target.value)}
                              className="h-8 w-28 tabular-nums"
                              placeholder="0,00"
                            />
                          ) : (
                            formatBRL(Number(m.valor ?? 0))
                          )}
                        </TableCell>
                        <TableCell>
                          {paga ? (
                            <span className="text-emerald-500">
                              Paga{m.pago_em ? ` em ${formatDate(m.pago_em)}` : ""}
                            </span>
                          ) : (
                            "Aberta"
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {paga ? null : editando ? (
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={parseBRL(valorMes) <= 0 || mesMut.isPending}
                                onClick={() =>
                                  mesMut.mutate({
                                    competencia: String(m.competencia_mes).slice(0, 10),
                                    valor: parseBRL(valorMes),
                                  })
                                }
                              >
                                Salvar
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setEditMes(null);
                                  setValorMes("");
                                }}
                              >
                                Cancelar
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => {
                                setEditMes(m.competencia_mes);
                                setValorMes(String(Number(m.valor ?? 0)).replace(".", ","));
                              }}
                            >
                              Editar valor
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ManualNoteDialog({
  open,
  onOpenChange,
  ownerId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ownerId: string | null;
}) {
  return <ManualNoteDialogInner open={open} onOpenChange={onOpenChange} ownerId={ownerId} />;
}

function ImportarContaDialog({
  open,
  onOpenChange,
  ownerId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ownerId: string | null;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [imagemDataUrl, setImagemDataUrl] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [lendo, setLendo] = useState(false);
  const [nome, setNome] = useState("");
  const [dest, setDest] = useState<DestinoSel>(DESTINO_VAZIO);
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState(todayISO());
  const [destinoEcom, setDestinoEcom] = useState<DestinoFull>("nao_definido");
  const [percentEcom, setPercentEcom] = useState("50");
  const [recorrente, setRecorrente] = useState(false);
  const [valorMensal, setValorMensal] = useState("");
  const [diaVenc, setDiaVenc] = useState("10");
  const [meses, setMeses] = useState("12");
  const [itens, setItens] = useState<ManualItem[]>([]);
  const [frete, setFrete] = useState("");

  const catQueryImp = useCategorias(ownerId);

  const reset = () => {
    setImagemDataUrl(null);
    setTexto("");
    setLendo(false);
    setNome("");
    setDest(DESTINO_VAZIO);
    setValor("");
    setVencimento(todayISO());
    setDestinoEcom("nao_definido");
    setPercentEcom("50");
    setRecorrente(false);
    setValorMensal("");
    setDiaVenc("10");
    setMeses("12");
    setItens([]);
    setFrete("");
  };

  const ehFornecedor = dest.tipoConta === "fornecedor";
  const somaItens = itens.reduce(
    (s, i) => s + (Number(i.quantidade.replace(",", ".")) || 0) * parseBRL(i.valorUnit),
    0,
  );
  const freteNum = parseBRL(frete);
  const freteDoItem = (it: ManualItem) => {
    const v = (Number(it.quantidade.replace(",", ".")) || 0) * parseBRL(it.valorUnit);
    return somaItens > 0 ? (freteNum * v) / somaItens : 0;
  };
  const mostrarItens = !recorrente && (ehFornecedor || itens.length > 0);
  const destinoOk = !!dest.categoriaId && (!ehFornecedor || !!dest.subcategoriaId);
  const destinoLiberado = destinoOk || (!dest.categoriaId && !dest.subcategoriaId);
  const valorNum = parseBRL(valor);
  const valorMensalNum = parseBRL(valorMensal);
  const pctNum = Math.min(100, Math.max(0, Number(String(percentEcom).replace(",", ".")) || 0));
  const baseRateio = recorrente ? valorMensalNum : valorNum;
  const destinoFields =
    destinoEcom === "rateio"
      ? {
          destino: "rateio",
          ecommerce_mode: "percent",
          ecommerce_percent: pctNum,
          ecommerce_amount: 0,
        }
      : { destino: destinoEcom };
  const mesesNum = Number(meses) || 0;
  const diaNum = Number(diaVenc) || 0;
  const podeGravar = recorrente
    ? destinoLiberado && valorMensalNum > 0 && mesesNum >= 1 && diaNum >= 1 && diaNum <= 31
    : destinoLiberado && valorNum > 0;

  const handleGravarImportar = () => {
    if (!confirmarPendencias(dest, destinoEcom)) return;
    if (recorrente) recorrenciaMut.mutate();
    else gravarMut.mutate();
  };

  const handleArquivo = (f: File) => {
    if (imageFileTooLarge(f)) {
      setImagemDataUrl(null);
      toast.error(IMAGE_TOO_LARGE_MESSAGE);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImagemDataUrl(String(reader.result ?? ""));
    reader.readAsDataURL(f);
  };

  const aplicarRegraDestino = async (beneficiario: string) => {
    if (!ownerId || !beneficiario.trim()) return;
    try {
      const { data: regras, error } = await supabase.rpc("resolve_name_rule", {
        _owner: ownerId,
        _text: beneficiario,
      });
      if (error) return;
      const regra = (regras ?? [])[0] as
        | { expense_id: string | null; category_id: string | null; matched_text: string | null }
        | undefined;
      if (!regra) return;

      let cats = catQueryImp.data ?? [];
      if (!cats.length) {
        const { data } = await supabase.rpc("list_categorias_arvore", { _owner: ownerId });
        cats = (data ?? []) as Categoria[];
      }

      let categoriaAlvo: string | null = regra.category_id;
      let gastoId: string | null = null;
      let gastoLabel: string | null = null;

      if (regra.expense_id) {
        const { data: gasto } = await supabase
          .from("expenses")
          .select("id, name, category_id")
          .eq("id", regra.expense_id)
          .maybeSingle();
        if (gasto) {
          gastoId = gasto.id;
          gastoLabel = gasto.name;
          categoriaAlvo = gasto.category_id ?? categoriaAlvo;
        }
      }
      if (!categoriaAlvo) return;

      const alvo = cats.find((c) => c.id === categoriaAlvo);
      if (!alvo) return;
      const pai = alvo.parent_id ? cats.find((c) => c.id === alvo.parent_id) ?? null : null;

      let novo: DestinoSel;
      if (pai?.is_fornecedores) {
        novo = {
          categoriaId: pai.id,
          subcategoriaId: alvo.id,
          gastoId,
          tipoConta: "fornecedor",
          categoriaLabel: pai.name,
          subcategoriaLabel: alvo.name,
          gastoLabel,
        };
      } else if (pai) {
        novo = {
          categoriaId: pai.id,
          subcategoriaId: alvo.id,
          gastoId,
          tipoConta: "geral",
          categoriaLabel: pai.name,
          subcategoriaLabel: alvo.name,
          gastoLabel,
        };
      } else {
        novo = {
          categoriaId: alvo.id,
          subcategoriaId: null,
          gastoId,
          tipoConta: "geral",
          categoriaLabel: alvo.name,
          subcategoriaLabel: null,
          gastoLabel,
        };
      }
      setDest(novo);
      toast.info(`Regra aplicada: destino ${destinoTexto(novo)} preenchido — confira.`);
    } catch {
      /* regra é apenas sugestão; ignora falhas */
    }
  };

  const lerDados = async () => {
    if (!imagemDataUrl && !texto.trim()) {
      toast.error("Envie uma imagem ou cole o texto da conta.");
      return;
    }
    setLendo(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const body = imagemDataUrl
        ? { access_token: token, image_base64: imagemDataUrl }
        : { access_token: token, texto: texto.trim() };
      const resp = await fetch("/api/contas/ler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await resp.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            aviso?: string;
            dados?: {
              beneficiario?: string | null;
              valor?: number | null;
              vencimento?: string | null;
              itens?: { descricao?: string | null; quantidade?: number | null; valor_unitario?: number | null }[] | null;
            };
          }
        | null;
      if (!resp.ok || !json?.ok) {
        toast.error(json?.error || "Não consegui ler a conta.");
        return;
      }
      const d = json.dados ?? {};
      if (d.beneficiario) {
        setNome(d.beneficiario);
        void aplicarRegraDestino(d.beneficiario);
      }
      if (typeof d.valor === "number" && d.valor > 0) {
        const v = formatBRL(d.valor).replace("R$", "").trim();
        setValor(v);
        setValorMensal(v);
      }
      if (d.vencimento) {
        setVencimento(d.vencimento);
        const dia = Number(d.vencimento.slice(8, 10));
        if (dia >= 1 && dia <= 31) setDiaVenc(String(dia));
      }
      if (json.aviso) toast.info("Não consegui interpretar tudo, complete manualmente.");
      else toast.success("Dados lidos.");
      const lidos = Array.isArray(d.itens) ? d.itens : [];
      if (lidos.length) {
        setItens(
          lidos.map((i) => ({
            descricao: String(i.descricao ?? "").trim(),
            quantidade: String(Number(i.quantidade) > 0 ? Number(i.quantidade) : 1),
            valorUnit: formatBRL(Number(i.valor_unitario) || 0).replace("R$", "").trim(),
            sku: null,
            unidPorEmb: "1",
          })),
        );
        toast.info(`Li ${lidos.length} ${lidos.length === 1 ? "produto" : "produtos"} do print — confira valores e vincule os SKUs.`);
      }
    } catch {
      toast.error("Não foi possível contatar o servidor. Se estiver no preview, publique o app.");
    } finally {
      setLendo(false);
    }
  };

  const gravarMut = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = ownerId ?? userData.user?.id;
      if (!uid) throw new Error("Sessão expirada. Entre novamente.");
      const nomeFinal =
        nome.trim() ||
        (ehFornecedor ? dest.subcategoriaLabel : dest.gastoLabel || dest.categoriaLabel) ||
        "Conta";
      const venc = vencimento || todayISO();
      const itensValidos = itens.filter(
        (i) => i.descricao.trim() !== "" && parseBRL(i.valorUnit) > 0,
      );
      const { data: nota, error } = await supabase
        .from("payable_notes")
        .insert({
          owner_id: uid,
          chave_nfe: null,
          numero_nota: null,
          fornecedor_nome: nomeFinal,
          fornecedor_cnpj: null,
          data_emissao: venc,
          valor_total: valorNum,
          valor_produtos: itensValidos.length ? somaItens : null,
          valor_frete: freteNum,
          valor_outros: 0,
          ...destinoFields,
          subcategoria_id: dest.subcategoriaId,
          categoria_id: dest.categoriaId,
          gasto_id: dest.gastoId,
          tipo_conta: dest.tipoConta,
        })
        .select("id")
        .single();
      if (error) throw error;
      const { error: pErr } = await supabase.from("payable_installments").insert({
        owner_id: uid,
        note_id: nota.id,
        numero: "001",
        vencimento: venc,
        valor: valorNum,
        status: "aberta",
      });
      if (pErr) throw pErr;
      let casados = 0;
      const falhas: string[] = [];
      for (let idx = 0; idx < itensValidos.length; idx++) {
        const i = itensValidos[idx];
        const qtd = Number(i.quantidade.replace(",", ".")) || 0;
        const unit = parseBRL(i.valorUnit);
        const { data: novoItem, error: iErr } = await supabase
          .from("payable_items")
          .insert({
            owner_id: uid,
            note_id: nota.id,
            fornecedor_sku: null,
            descricao: i.descricao.trim() || null,
            quantidade: qtd,
            valor_unitario: unit,
            valor_total: qtd * unit,
            frete_rateado: freteDoItem(i),
            unidades_por_embalagem: fatorEmb(i),
          })
          .select("id")
          .single();
        if (iErr) throw iErr;
        if (i.sku) {
          const { error: mErr } = await supabase.rpc("match_payable_item", {
            _owner: uid,
            _item_id: novoItem.id,
            _meu_sku: i.sku,
          });
          if (mErr) falhas.push(i.descricao || i.sku || `item ${idx + 1}`);
          else casados++;
        }
      }
      return { noteId: nota.id as string, casados, falhas };
    },
    onSuccess: ({ casados, falhas }) => {
      if (falhas.length) {
        toast.warning(
          `Conta lançada, mas não consegui casar: ${falhas.join(", ")}. Corrija na listagem (expanda a nota).`,
        );
      } else if (casados > 0) {
        toast.success(`Conta lançada e ${casados} ${casados === 1 ? "item casado" : "itens casados"}.`);
      } else {
        toast.success("Conta lançada.");
      }
      reset();
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["payable-notes"] });
      qc.invalidateQueries({ queryKey: ["payable-notes-sub"] });
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao lançar a conta."),
  });

  const recorrenciaMut = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = ownerId ?? userData.user?.id;
      if (!uid) throw new Error("Sessão expirada. Entre novamente.");
      const nomeFinal =
        nome.trim() ||
        (ehFornecedor ? dest.subcategoriaLabel : dest.gastoLabel || dest.categoriaLabel) ||
        "Conta";
      const { data: rec, error: recErr } = await supabase
        .from("payable_recurrences")
        .insert({
          owner_id: uid,
          nome: nomeFinal,
          categoria_id: dest.categoriaId,
          subcategoria_id: dest.subcategoriaId,
          gasto_id: dest.gastoId,
          tipo_conta: dest.tipoConta,
          ecommerce_mode: "percent",
          ecommerce_percent: 0,
          ecommerce_amount: 0,
          ...destinoFields,
          valor: valorMensalNum,
          dia_vencimento: diaNum,
          ativo: true,
        })
        .select("id")
        .single();
      if (recErr) throw recErr;
      const { data: geradas, error: genErr } = await supabase.rpc("gerar_contas_recorrencia", {
        _owner: uid,
        _recorrencia_id: rec.id,
        _mes_inicial: primeiroDiaMesAtual(),
        _meses: mesesNum,
      });
      if (genErr) throw genErr;
      return Number(geradas ?? 0);
    },
    onSuccess: (n) => {
      toast.success(`Recorrência criada — ${n} ${n === 1 ? "conta gerada" : "contas geradas"}.`);
      reset();
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["payable-notes"] });
      qc.invalidateQueries({ queryKey: ["payable-notes-sub"] });
      qc.invalidateQueries({ queryKey: ["recorrencias"] });
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao criar a recorrência."),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="flex flex-col w-[min(96vw,36rem)] max-w-[96vw] max-h-[90vh] p-0">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6">
          <DialogHeader>
            <DialogTitle>Importar conta</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="rounded-md border border-border/60 bg-card/40 p-3 space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Foto / print da conta</Label>
                <div className="mt-1 flex items-center gap-3">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleArquivo(f);
                      e.target.value = "";
                    }}
                  />
                  <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                    <Upload className="mr-2 h-4 w-4" /> Escolher imagem
                  </Button>
                  {imagemDataUrl ? (
                    <div className="flex items-center gap-2">
                      <img src={imagemDataUrl} alt="Prévia da conta" className="h-14 rounded border border-border/60" />
                      <Button size="icon" variant="ghost" onClick={() => setImagemDataUrl(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">ou cole o texto da conta</Label>
                <Textarea
                  className="mt-1"
                  rows={4}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder="Cole aqui o texto do boleto/conta"
                />
              </div>
              <Button size="sm" onClick={() => void lerDados()} disabled={lendo}>
                <ScanLine className="mr-2 h-4 w-4" /> {lendo ? "Lendo..." : "Ler dados"}
              </Button>
            </div>

            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Categoria / destino do gasto</Label>
                <div className="mt-1">
                  <DestinoPicker
                    ownerId={ownerId}
                    value={dest}
                    sugestaoNome={nome || undefined}
                    onChange={(v) => {
                      setDest(v);
                      if (!nome.trim()) {
                        setNome(
                          (v.tipoConta === "fornecedor" ? v.subcategoriaLabel : v.gastoLabel || v.categoriaLabel) ?? "",
                        );
                      }
                    }}
                  />
                </div>
              </div>
              <div className="max-w-sm">
                <Label className="text-xs text-muted-foreground">Nome / descrição da conta</Label>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Energia elétrica" />
              </div>
              <div className="flex flex-wrap gap-3">
                {!recorrente ? (
                  <>
                    <div className="w-full min-w-0 sm:w-36">
                      <Label className="text-xs text-muted-foreground">Valor</Label>
                      <Input
                        value={valor}
                        onChange={(e) => setValor(e.target.value)}
                        placeholder="0,00"
                        className="tabular-nums"
                      />
                    </div>
                    <div className="w-full min-w-0 sm:w-44">
                      <Label className="text-xs text-muted-foreground">Vencimento</Label>
                      <Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
                    </div>
                  </>
                ) : null}
                <div>
                  <Label className="text-xs text-muted-foreground">Destino</Label>
                  <div className="mt-1 inline-flex rounded-md border border-border/60 bg-card/60 p-0.5">
                    {([
                      ["ecommerce", "E-commerce"],
                      ["locacao", "Locação"],
                    ] as const).map(([v, label]) => (
                      <Button
                        key={v}
                        size="sm"
                        variant="ghost"
                        onClick={() => setDestinoEcom(destinoEcom === v ? "nao_definido" : v)}
                        className={cn(
                          "h-8 px-3 text-sm",
                          destinoEcom === v && "bg-primary/15 text-primary hover:bg-primary/15",
                        )}
                      >
                        {label}
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDestinoEcom(destinoEcom === "rateio" ? "nao_definido" : "rateio")}
                      className={cn(
                        "h-8 px-3 text-sm",
                        destinoEcom === "rateio" && "bg-primary/15 text-primary hover:bg-primary/15",
                      )}
                    >
                      Ratear
                    </Button>
                  </div>
                  {destinoEcom === "rateio" ? (
                    <div className="mt-2 space-y-1">
                      <Label className="text-xs text-muted-foreground">% e-commerce</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={percentEcom}
                        onChange={(e) => setPercentEcom(e.target.value)}
                        className="w-28 h-9"
                      />
                      <p className="text-xs text-muted-foreground">
                        E-commerce: {formatBRL((baseRateio * pctNum) / 100)} · Locação:{" "}
                        {formatBRL((baseRateio * (100 - pctNum)) / 100)}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
              {mostrarItens ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Produtos / itens</Label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      Produtos: {formatBRL(somaItens)}
                    </span>
                  </div>
                  <p className="text-xs text-amber-500">
                    Produtos lidos do print pela IA. Revise valores e quantidades antes de salvar — a IA pode errar.
                  </p>
                  <div className="w-full min-w-0 sm:w-40">
                    <Label className="text-xs text-muted-foreground">Frete pago (rateado entre os produtos)</Label>
                    <Input
                      value={frete}
                      onChange={(e) => setFrete(e.target.value)}
                      placeholder="0,00"
                      className="h-9 tabular-nums"
                    />
                  </div>
                  {itens.map((it, idx) => (
                    <div key={idx} className="rounded-md border border-border/60 bg-card/40 p-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-[180px] flex-1">
                          <Label className="text-xs text-muted-foreground">Descrição</Label>
                          <Input
                            value={it.descricao}
                            onChange={(e) =>
                              setItens((p) => p.map((x, i) => (i === idx ? { ...x, descricao: e.target.value } : x)))
                            }
                            className="h-9"
                          />
                        </div>
                        <div className="w-20">
                          <Label className="text-xs text-muted-foreground">Qtd</Label>
                          <Input
                            value={it.quantidade}
                            onChange={(e) =>
                              setItens((p) => p.map((x, i) => (i === idx ? { ...x, quantidade: e.target.value } : x)))
                            }
                            className="h-9 tabular-nums"
                          />
                        </div>
                        <div className="w-full min-w-0 sm:w-28">
                          <Label className="text-xs text-muted-foreground">Valor unit.</Label>
                          <Input
                            value={it.valorUnit}
                            onChange={(e) =>
                              setItens((p) => p.map((x, i) => (i === idx ? { ...x, valorUnit: e.target.value } : x)))
                            }
                            placeholder="0,00"
                            className="h-9 tabular-nums"
                          />
                        </div>
                        <div className="w-24 min-w-0">
                          <Label
                            className="text-xs text-muted-foreground"
                            title="Quantas unidades de venda vêm em cada unidade comprada (caixa/fardo). Deixe 1 se comprar por unidade."
                          >
                            Un/emb
                          </Label>
                          <Input
                            value={it.unidPorEmb}
                            onChange={(e) =>
                              setItens((p) => p.map((x, i) => (i === idx ? { ...x, unidPorEmb: e.target.value } : x)))
                            }
                            placeholder="1"
                            title="Quantas unidades de venda vêm em cada unidade comprada (caixa/fardo). Deixe 1 se comprar por unidade."
                            className="h-9 tabular-nums"
                          />
                        </div>
                        <div className="w-28 pb-2 text-right text-xs tabular-nums text-muted-foreground">
                          {formatBRL((Number(it.quantidade.replace(",", ".")) || 0) * parseBRL(it.valorUnit))}
                          {freteNum > 0 ? (
                            <div className="text-[11px] text-muted-foreground/80">
                              + frete {formatBRL(freteDoItem(it))}
                            </div>
                          ) : null}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Remover item"
                          onClick={() => setItens((p) => p.filter((_, i) => i !== idx))}
                        >
                          <X className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                      {fatorEmb(it) > 1 && parseBRL(it.valorUnit) > 0 ? (
                        <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                          Custo unitário: {formatBRL(custoPorUnidadeVenda(it, freteDoItem(it)))}
                        </p>
                      ) : null}
                      <div className="mt-2">
                        <SkuAutocomplete
                          ownerId={ownerId}
                          value={it.sku}
                          onSelect={(sku) => setItens((p) => p.map((x, i) => (i === idx ? { ...x, sku } : x)))}
                        />
                      </div>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setItens((p) => [...p, novoManualItem()])}
                  >
                    <Plus className="mr-2 h-4 w-4" /> Adicionar item
                  </Button>
                  {freteNum > 0 || somaItens > 0 ? (
                    <div className="space-y-1 text-xs tabular-nums text-muted-foreground">
                      <div>
                        Produtos: {formatBRL(somaItens)} · Frete: {formatBRL(freteNum)} · Total produtos+frete:{" "}
                        {formatBRL(somaItens + freteNum)}
                      </div>
                      {Math.abs(valorNum - (somaItens + freteNum)) > 0.01 ? (
                        <div className="text-amber-500">
                          O valor da conta ({formatBRL(valorNum)}) não bate com produtos + frete (
                          {formatBRL(somaItens + freteNum)}).
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-3 rounded-md border border-border/60 bg-card/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="text-sm">Repetir mensalmente</Label>
                    <p className="text-xs text-muted-foreground">
                      Gera uma conta prevista por mês (não lança na planilha; só ao pagar).
                    </p>
                  </div>
                  <Switch checked={recorrente} onCheckedChange={setRecorrente} />
                </div>
                {recorrente ? (
                  <div className="flex flex-wrap gap-3">
                    <div className="w-full min-w-0 sm:w-36">
                      <Label className="text-xs text-muted-foreground">Valor mensal</Label>
                      <Input
                        value={valorMensal}
                        onChange={(e) => setValorMensal(e.target.value)}
                        placeholder="0,00"
                        className="h-9 tabular-nums"
                      />
                    </div>
                    <div className="w-full min-w-0 sm:w-36">
                      <Label className="text-xs text-muted-foreground">Dia do vencimento</Label>
                      <Input
                        type="number"
                        min={1}
                        max={31}
                        value={diaVenc}
                        onChange={(e) => setDiaVenc(e.target.value)}
                        className="h-9 tabular-nums"
                      />
                    </div>
                    <div className="w-full min-w-0 sm:w-40">
                      <Label className="text-xs text-muted-foreground">Gerar por quantos meses</Label>
                      <Input
                        type="number"
                        min={1}
                        value={meses}
                        onChange={(e) => setMeses(e.target.value)}
                        className="h-9 tabular-nums"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
              {!recorrente ? (
                <p className="text-xs text-muted-foreground">
                  A conta é lançada em aberto com 1 parcela. Para parcelar, use "Lançar manual".
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t bg-background px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleGravarImportar}
            disabled={!podeGravar || gravarMut.isPending || recorrenciaMut.isPending}
          >
            {gravarMut.isPending || recorrenciaMut.isPending
              ? "Lançando..."
              : recorrente
                ? "Criar recorrência"
                : "Lançar conta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManualNoteDialogInner({
  open,
  onOpenChange,
  ownerId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ownerId: string | null;
}) {
  const qc = useQueryClient();
  const [dest, setDest] = useState<DestinoSel>(DESTINO_VAZIO);
  const [nomeConta, setNomeConta] = useState("");
  const [numero, setNumero] = useState("");
  const [data, setData] = useState(todayISO());
  const [destinoManual, setDestinoManual] = useState<DestinoFull>("nao_definido");
  const [percentEcom, setPercentEcom] = useState("50");
  const [itens, setItens] = useState<ManualItem[]>([]);
  const [frete, setFrete] = useState("");
  const [parcelas, setParcelas] = useState<ManualParcela[]>([{ vencimento: "", valor: "" }]);
  const [condValor, setCondValor] = useState("");
  const [cond, setCond] = useState<"avista" | "agendado" | "boleto">("avista");
  const [condBoleto, setCondBoleto] = useState<"30" | "15/30" | "15/30/45" | "30/60" | "30/60/90" | "30/60/90/120">("30/60/90");
  const [condData, setCondData] = useState("");
  // TODO: opção "já pago" exige expense_id — futuro.
  const [recorrente, setRecorrente] = useState(false);
  const [diaVenc, setDiaVenc] = useState("10");
  const [meses, setMeses] = useState("12");
  const [valorMensal, setValorMensal] = useState("");

  const ehFornecedor = dest.tipoConta === "fornecedor";
  const catQueryMan = useCategorias(ownerId);
  const [imagemDataUrl, setImagemDataUrl] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [destinoPorRegra, setDestinoPorRegra] = useState(false);
  const regraAplicadaRef = useRef<string | null>(null);

  // Conta de fornecedor espera produto: já deixa uma linha de item pronta.
  useEffect(() => {
    if (ehFornecedor) {
      setItens((p) => (p.length === 0 ? [novoManualItem()] : p));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ehFornecedor]);

  const reset = () => {
    setDest(DESTINO_VAZIO);
    setNomeConta("");
    setNumero("");
    setData(todayISO());
    setDestinoManual("nao_definido");
    setPercentEcom("50");
    setItens([]);
    setFrete("");
    setParcelas([{ vencimento: "", valor: "" }]);
    setCondValor("");
    setCond("avista");
    setCondBoleto("30/60/90");
    setCondData("");
    setRecorrente(false);
    setDiaVenc("10");
    setMeses("12");
    setValorMensal("");
    setImagemDataUrl(null);
    setLendo(false);
    setDestinoPorRegra(false);
    regraAplicadaRef.current = null;
  };

  const aplicarRegraDestinoMan = async (beneficiario: string) => {
    if (!ownerId || !beneficiario.trim()) return false;
    try {
      const { data: regras, error } = await supabase.rpc("resolve_name_rule", {
        _owner: ownerId,
        _text: beneficiario,
      });
      if (error) return false;
      const regra = (regras ?? [])[0] as
        | { expense_id: string | null; category_id: string | null; matched_text: string | null }
        | undefined;
      if (!regra) return false;

      let cats = catQueryMan.data ?? [];
      if (!cats.length) {
        const { data } = await supabase.rpc("list_categorias_arvore", { _owner: ownerId });
        cats = (data ?? []) as Categoria[];
      }

      let categoriaAlvo: string | null = regra.category_id;
      let gastoId: string | null = null;
      let gastoLabel: string | null = null;

      if (regra.expense_id) {
        const { data: gasto } = await supabase
          .from("expenses")
          .select("id, name, category_id")
          .eq("id", regra.expense_id)
          .maybeSingle();
        if (gasto) {
          gastoId = gasto.id;
          gastoLabel = gasto.name;
          categoriaAlvo = gasto.category_id ?? categoriaAlvo;
        }
      }
      if (!categoriaAlvo) return false;

      const alvo = cats.find((c) => c.id === categoriaAlvo);
      if (!alvo) return false;
      const pai = alvo.parent_id ? cats.find((c) => c.id === alvo.parent_id) ?? null : null;

      let novo: DestinoSel;
      if (pai?.is_fornecedores) {
        novo = {
          categoriaId: pai.id,
          subcategoriaId: alvo.id,
          gastoId,
          tipoConta: "fornecedor",
          categoriaLabel: pai.name,
          subcategoriaLabel: alvo.name,
          gastoLabel,
        };
      } else if (pai) {
        novo = {
          categoriaId: pai.id,
          subcategoriaId: alvo.id,
          gastoId,
          tipoConta: "geral",
          categoriaLabel: pai.name,
          subcategoriaLabel: alvo.name,
          gastoLabel,
        };
      } else {
        novo = {
          categoriaId: alvo.id,
          subcategoriaId: null,
          gastoId,
          tipoConta: "geral",
          categoriaLabel: alvo.name,
          subcategoriaLabel: null,
          gastoLabel,
        };
      }
      setDest(novo);
      toast.info(`Regra aplicada: destino ${destinoTexto(novo)} preenchido — confira.`);
      return true;
    } catch {
      /* regra é apenas sugestão; ignora falhas */
      return false;
    }
  };

  const tentarAplicarRegra = () => {
    const texto = nomeConta.trim();
    if (!texto || !ownerId) return;
    if (regraAplicadaRef.current === texto) return;
    const destVazio = !dest.categoriaId && !dest.subcategoriaId;
    if (!destVazio && !destinoPorRegra) return;
    regraAplicadaRef.current = texto;
    void aplicarRegraDestinoMan(texto).then((ok) => {
      if (ok) setDestinoPorRegra(true);
    });
  };

  // Aplica a regra de nome automaticamente ao digitar o nome da conta (debounce).
  useEffect(() => {
    let cancelado = false;
    const t = setTimeout(() => {
      if (!cancelado) tentarAplicarRegra();
    }, 800);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nomeConta, ownerId]);

  const lerImagem = async (dataUrl: string) => {
    setLendo(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const resp = await fetch("/api/contas/ler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token, image_base64: dataUrl }),
      });
      const json = (await resp.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            aviso?: string;
            dados?: {
              beneficiario?: string | null;
              valor?: number | null;
              vencimento?: string | null;
              itens?: { descricao?: string | null; quantidade?: number | null; valor_unitario?: number | null }[] | null;
            };
          }
        | null;
      if (!resp.ok || !json?.ok) {
        toast.error(json?.error || "Não consegui ler a conta.");
        return;
      }
      const d = json.dados ?? {};
      if (d.beneficiario) {
        setNomeConta(d.beneficiario);
        void aplicarRegraDestinoMan(d.beneficiario);
      }
      const valorLido = typeof d.valor === "number" && d.valor > 0 ? d.valor : 0;
      if (valorLido > 0 || d.vencimento) {
        const v = valorLido > 0 ? formatBRL(valorLido).replace("R$", "").trim() : "";
        setParcelas([{ vencimento: d.vencimento ?? "", valor: v }]);
        if (v) setCondValor(v);
        if (v) setValorMensal(v);
      }
      if (d.vencimento) {
        const dia = Number(d.vencimento.slice(8, 10));
        if (dia >= 1 && dia <= 31) setDiaVenc(String(dia));
      }
      if (json.aviso) toast.info("Não consegui interpretar tudo, complete manualmente.");
      else toast.success("Dados lidos.");
      const lidos = Array.isArray(d.itens) ? d.itens : [];
      if (lidos.length) {
        setItens(
          lidos.map((i) => ({
            descricao: String(i.descricao ?? "").trim(),
            quantidade: String(Number(i.quantidade) > 0 ? Number(i.quantidade) : 1),
            valorUnit: formatBRL(Number(i.valor_unitario) || 0).replace("R$", "").trim(),
            sku: null,
            unidPorEmb: "1",
          })),
        );
        toast.info(`Li ${lidos.length} ${lidos.length === 1 ? "produto" : "produtos"} do print — confira e vincule os SKUs.`);
      }
    } catch {
      toast.error("Não foi possível contatar o servidor. Se estiver no preview, publique o app.");
    } finally {
      setLendo(false);
    }
  };

  const escolherImagem = (f: File) => {
    if (imageFileTooLarge(f)) {
      setImagemDataUrl(null);
      toast.error(IMAGE_TOO_LARGE_MESSAGE);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      setImagemDataUrl(url);
      if (url) void lerImagem(url);
    };
    reader.readAsDataURL(f);
  };

  const somaParcelas = parcelas.reduce((s, p) => s + parseBRL(p.valor), 0);
  const somaItens = itens.reduce(
    (s, i) => s + (Number(i.quantidade.replace(",", ".")) || 0) * parseBRL(i.valorUnit),
    0,
  );
  const itensSemSku = itens.filter(
    (i) => !i.sku && (i.descricao.trim() !== "" || parseBRL(i.valorUnit) > 0),
  ).length;
  const freteNum = parseBRL(frete);
  const freteDoItem = (it: ManualItem) => {
    const v = (Number(it.quantidade.replace(",", ".")) || 0) * parseBRL(it.valorUnit);
    return somaItens > 0 ? (freteNum * v) / somaItens : 0;
  };
  const precisaAviso = !recorrente && ehFornecedor && (itens.length === 0 || itensSemSku > 0);
  const numeroBRL = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const gerarParcelas = () => {
    const total = parseBRL(condValor);
    if (total <= 0) {
      toast.error("Informe o valor total para gerar as parcelas.");
      return;
    }
    const base = data || todayISO();
    if (cond === "avista") {
      setParcelas([{ vencimento: base, valor: numeroBRL(total) }]);
      return;
    }
    if (cond === "agendado") {
      setParcelas([{ vencimento: condData || base, valor: numeroBRL(total) }]);
      return;
    }
    const dias = condBoleto.split("/").map((d) => Number(d));
    const n = dias.length;
    const parcial = Math.round((total / n) * 100) / 100;
    const geradas: ManualParcela[] = dias.map((d, i) => ({
      vencimento: addDaysISO(base, d),
      valor: numeroBRL(i === n - 1 ? Math.round((total - parcial * (n - 1)) * 100) / 100 : parcial),
    }));
    setParcelas(geradas);
  };
  const destinoOk = !!dest.categoriaId && (!ehFornecedor || !!dest.subcategoriaId);
  const destinoLiberado = destinoOk || (!dest.categoriaId && !dest.subcategoriaId);
  const valorMensalNum = parseBRL(valorMensal);
  const pctNum = Math.min(100, Math.max(0, Number(String(percentEcom).replace(",", ".")) || 0));
  const baseRateio = recorrente ? valorMensalNum : somaParcelas;
  const destinoFields =
    destinoManual === "rateio"
      ? {
          destino: "rateio",
          ecommerce_mode: "percent",
          ecommerce_percent: pctNum,
          ecommerce_amount: 0,
        }
      : { destino: destinoManual };
  const mesesNum = Number(meses) || 0;
  const diaNum = Number(diaVenc) || 0;
  const podeGravar = recorrente
    ? destinoLiberado && valorMensalNum > 0 && mesesNum >= 1 && diaNum >= 1 && diaNum <= 31
    : destinoLiberado && somaParcelas > 0;
  const nomeFinal =
    nomeConta.trim() ||
    (ehFornecedor ? dest.subcategoriaLabel : dest.gastoLabel || dest.categoriaLabel) ||
    "Conta";

  const recorrenciaMut = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada. Entre novamente.");

      const { data: rec, error: recErr } = await supabase
        .from("payable_recurrences")
        .insert({
          owner_id: uid,
          nome: nomeFinal,
          categoria_id: dest.categoriaId,
          subcategoria_id: dest.subcategoriaId,
          gasto_id: dest.gastoId,
          tipo_conta: dest.tipoConta,
          ecommerce_mode: "percent",
          ecommerce_percent: 0,
          ecommerce_amount: 0,
          ...destinoFields,
          valor: valorMensalNum,
          dia_vencimento: diaNum,
          ativo: true,
        })
        .select("id")
        .single();
      if (recErr) throw recErr;

      const hoje = new Date();
      const mesInicial = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
      const { data: geradas, error: genErr } = await supabase.rpc("gerar_contas_recorrencia", {
        _owner: uid,
        _recorrencia_id: rec.id,
        _mes_inicial: mesInicial,
        _meses: mesesNum,
      });
      if (genErr) throw genErr;
      return Number(geradas ?? 0);
    },
    onSuccess: (n) => {
      toast.success(`Recorrência criada — ${n} ${n === 1 ? "conta gerada" : "contas geradas"}.`);
      reset();
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["payable-notes"] });
      qc.invalidateQueries({ queryKey: ["payable-notes-sub"] });
      qc.invalidateQueries({ queryKey: ["recorrencias"] });
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao criar a recorrência."),
  });

  const manualImportMut = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada. Entre novamente.");

      const itensValidos = ehFornecedor
        ? itens.filter((i) => i.descricao.trim() !== "" || parseBRL(i.valorUnit) > 0 || i.sku)
        : [];
      const valorProdutos = itensValidos.reduce(
        (s, i) => s + (Number(i.quantidade.replace(",", ".")) || 0) * parseBRL(i.valorUnit),
        0,
      );

      const { data: inserted, error: insErr } = await supabase
        .from("payable_notes")
        .insert({
          owner_id: uid,
          chave_nfe: null,
          numero_nota: numero.trim() || null,
          fornecedor_nome: nomeFinal,
          fornecedor_cnpj: null,
          data_emissao: data || null,
          valor_total: somaParcelas,
          valor_produtos: itensValidos.length ? valorProdutos : null,
          valor_frete: freteNum,
          valor_outros: 0,
          ...destinoFields,
          subcategoria_id: dest.subcategoriaId,
          categoria_id: dest.categoriaId,
          gasto_id: dest.gastoId,
          tipo_conta: dest.tipoConta,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;
      const noteId = inserted.id;

      const parcelasValidas = parcelas.filter((p) => parseBRL(p.valor) > 0);
      if (parcelasValidas.length) {
        const { error } = await supabase.from("payable_installments").insert(
          parcelasValidas.map((p, idx) => ({
            owner_id: uid,
            note_id: noteId,
            numero: String(idx + 1).padStart(3, "0"),
            vencimento: p.vencimento || null,
            valor: parseBRL(p.valor),
            status: "aberta",
          })),
        );
        if (error) throw error;
      }

      let casados = 0;
      const falhas: string[] = [];
      for (let idx = 0; idx < itensValidos.length; idx++) {
        const i = itensValidos[idx];
        const qtd = Number(i.quantidade.replace(",", ".")) || 0;
        const unit = parseBRL(i.valorUnit);
        const { data: novoItem, error } = await supabase
          .from("payable_items")
          .insert({
            owner_id: uid,
            note_id: noteId,
            fornecedor_sku: null,
            descricao: i.descricao.trim() || null,
            quantidade: qtd,
            valor_unitario: unit,
            valor_total: qtd * unit,
            frete_rateado: freteDoItem(i),
            unidades_por_embalagem: fatorEmb(i),
          })
          .select("id")
          .single();
        if (error) throw error;
        if (i.sku) {
          const { error: mErr } = await supabase.rpc("match_payable_item", {
            _owner: uid,
            _item_id: novoItem.id,
            _meu_sku: i.sku,
          });
          if (mErr) falhas.push(i.descricao || i.sku || `item ${idx + 1}`);
          else casados++;
        }
      }
      return { noteId, casados, falhas };
    },
    onSuccess: ({ noteId, casados, falhas }) => {
      if (falhas.length) {
        toast.warning(
          `Nota manual lançada, mas não consegui casar: ${falhas.join(", ")}. Corrija na listagem (expanda a nota).`,
        );
      } else if (casados > 0) {
        toast.success(`Nota manual lançada e ${casados} ${casados === 1 ? "item casado" : "itens casados"}.`);
      } else {
        toast.success("Nota manual lançada.");
      }
      reset();
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["payable-notes-sub"] });
      invalidateMatchQueries(qc, noteId);
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao lançar a nota."),
  });

  const handleGravar = () => {
    const pend = mensagensPendencias(dest, destinoManual);
    if (!recorrente) {
      const itensValidos = itens.filter(
        (i) => i.descricao.trim() !== "" || parseBRL(i.valorUnit) > 0,
      );
      if (ehFornecedor && itensValidos.length === 0) {
        pend.push(
          "• Lançamento de fornecedor sem produto informado — o custo por SKU não será atualizado.",
        );
      } else if (ehFornecedor && itensSemSku > 0) {
        pend.push(
          "• Você está lançando sem detalhar SKU/produto de todos os itens. O custo por SKU não será atualizado para esses itens.",
        );
      }
      if (somaParcelas <= 0) {
        pend.push(
          "• Você não definiu o pagamento (parcelas/valor). A conta ficará sem valor a pagar.",
        );
      } else if (parcelas.some((p) => parseBRL(p.valor) > 0 && !p.vencimento)) {
        pend.push("• Uma ou mais parcelas estão sem data de vencimento.");
      }
    }
    if (pend.length && !window.confirm(`${pend.join("\n\n")}\n\nDeseja salvar mesmo assim?`)) return;
    if (recorrente) {
      recorrenciaMut.mutate();
      return;
    }
    manualImportMut.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="flex flex-col w-[min(96vw,42rem)] max-w-[96vw] max-h-[90vh] p-0">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6">
          <DialogHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <DialogTitle>Lançar nota manual</DialogTitle>
              <div className="flex flex-col items-end gap-1">
                <input
                  ref={imgInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) escolherImagem(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={lendo}
                  onClick={() => imgInputRef.current?.click()}
                >
                  <ScanLine className="mr-2 h-4 w-4" /> {lendo ? "Lendo..." : "Ler print"}
                </Button>
                <p className="max-w-[16rem] text-right text-[11px] text-amber-500">
                  A leitura por IA pode errar — revise tudo antes de salvar.
                </p>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Categoria / destino do gasto</Label>
                  {destinoPorRegra ? (
                    <span className="flex items-center gap-1">
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                        vinculado por regra
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-[11px]"
                        onClick={() => {
                          setDest(DESTINO_VAZIO);
                          setDestinoPorRegra(false);
                          regraAplicadaRef.current = null;
                        }}
                      >
                        <X className="mr-1 h-3 w-3" /> Desvincular
                      </Button>
                    </span>
                  ) : null}
                </div>
                <div className="mt-1">
                  <DestinoPicker
                    ownerId={ownerId}
                    value={dest}
                    onChange={(v) => {
                      setDest(v);
                      setDestinoPorRegra(false);
                      regraAplicadaRef.current = nomeConta.trim() || null;
                      if (!nomeConta.trim()) {
                        setNomeConta(
                          (v.tipoConta === "fornecedor" ? v.subcategoriaLabel : v.gastoLabel || v.categoriaLabel) ?? "",
                        );
                      }
                      if (v.tipoConta === "geral") setItens([]);
                    }}
                  />
                </div>
              </div>
              <div className="max-w-sm">
                <Label className="text-xs text-muted-foreground">Nome / descrição da conta</Label>
                <Input
                  value={nomeConta}
                  onChange={(e) => setNomeConta(e.target.value)}
                  onBlur={tentarAplicarRegra}
                  placeholder="Ex.: Aluguel loja"
                  className="h-9"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="w-full min-w-0 sm:w-40">
                  <Label className="text-xs text-muted-foreground">Número da nota</Label>
                  <Input
                    value={numero}
                    onChange={(e) => setNumero(e.target.value)}
                    placeholder="opcional"
                    className="h-9 tabular-nums"
                  />
                </div>
                <div className="w-full min-w-0 sm:w-44">
                  <Label className="text-xs text-muted-foreground">Data da compra</Label>
                  <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="h-9" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Destino</Label>
                  <div className="mt-1 inline-flex rounded-md border border-border/60 bg-card/60 p-0.5">
                    {([
                      ["ecommerce", "E-commerce"],
                      ["locacao", "Locação"],
                    ] as const).map(([v, label]) => (
                      <Button
                        key={v}
                        size="sm"
                        variant="ghost"
                        onClick={() => setDestinoManual(destinoManual === v ? "nao_definido" : v)}
                        className={cn(
                          "h-8 px-3 text-sm",
                          destinoManual === v && "bg-primary/15 text-primary hover:bg-primary/15",
                        )}
                      >
                        {label}
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDestinoManual(destinoManual === "rateio" ? "nao_definido" : "rateio")
                      }
                      className={cn(
                        "h-8 px-3 text-sm",
                        destinoManual === "rateio" && "bg-primary/15 text-primary hover:bg-primary/15",
                      )}
                    >
                      Ratear
                    </Button>
                  </div>
                  {destinoManual === "rateio" ? (
                    <div className="mt-2 space-y-1">
                      <Label className="text-xs text-muted-foreground">% e-commerce</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={percentEcom}
                        onChange={(e) => setPercentEcom(e.target.value)}
                        className="w-28 h-9"
                      />
                      <p className="text-xs text-muted-foreground">
                        E-commerce: {formatBRL((baseRateio * pctNum) / 100)} · Locação:{" "}
                        {formatBRL((baseRateio * (100 - pctNum)) / 100)}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border/60 bg-card/40 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Repetir mensalmente</Label>
                  <p className="text-xs text-muted-foreground">
                    Gera uma conta prevista por mês (não lança na planilha; só ao pagar).
                  </p>
                </div>
                <Switch checked={recorrente} onCheckedChange={setRecorrente} />
              </div>
              {recorrente ? (
                <div className="flex flex-wrap gap-3">
                  <div className="w-full min-w-0 sm:w-36">
                    <Label className="text-xs text-muted-foreground">Valor mensal</Label>
                    <Input
                      value={valorMensal}
                      onChange={(e) => setValorMensal(e.target.value)}
                      placeholder="0,00"
                      className="h-9 tabular-nums"
                    />
                  </div>
                  <div className="w-full min-w-0 sm:w-36">
                    <Label className="text-xs text-muted-foreground">Dia do vencimento</Label>
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={diaVenc}
                      onChange={(e) => setDiaVenc(e.target.value)}
                      className="h-9 tabular-nums"
                    />
                  </div>
                  <div className="w-full min-w-0 sm:w-40">
                    <Label className="text-xs text-muted-foreground">Gerar por quantos meses</Label>
                    <Input
                      type="number"
                      min={1}
                      value={meses}
                      onChange={(e) => setMeses(e.target.value)}
                      className="h-9 tabular-nums"
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {ehFornecedor && !recorrente ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Itens</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  Produtos: {formatBRL(somaItens)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-card/40 p-3">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-muted-foreground" />
                  <div className="leading-tight">
                    <Label className="text-sm font-medium">Frete pago</Label>
                    <p className="text-[11px] text-muted-foreground">rateado entre os produtos</p>
                  </div>
                </div>
                <div className="flex h-9 w-full min-w-0 items-center overflow-hidden rounded-md border border-input bg-background sm:w-40">
                  <span className="px-2 text-xs text-muted-foreground">R$</span>
                  <Input
                    value={frete}
                    onChange={(e) => setFrete(e.target.value)}
                    placeholder="0,00"
                    className="h-8 border-0 bg-transparent px-1 tabular-nums shadow-none focus-visible:ring-0"
                  />
                </div>
              </div>
              {itens.map((it, idx) => (
                <div key={idx} className="rounded-md border border-border/60 bg-card/40 p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[180px] flex-1">
                      <Label className="text-xs text-muted-foreground">Descrição</Label>
                      <Input
                        value={it.descricao}
                        onChange={(e) =>
                          setItens((p) => p.map((x, i) => (i === idx ? { ...x, descricao: e.target.value } : x)))
                        }
                        className="h-9"
                      />
                    </div>
                    <div className="w-20">
                      <Label className="text-xs text-muted-foreground">Qtd</Label>
                      <Input
                        value={it.quantidade}
                        onChange={(e) =>
                          setItens((p) => p.map((x, i) => (i === idx ? { ...x, quantidade: e.target.value } : x)))
                        }
                        className="h-9 tabular-nums"
                      />
                    </div>
                    <div className="w-full min-w-0 sm:w-28">
                      <Label className="text-xs text-muted-foreground">Valor unit.</Label>
                      <Input
                        value={it.valorUnit}
                        onChange={(e) =>
                          setItens((p) => p.map((x, i) => (i === idx ? { ...x, valorUnit: e.target.value } : x)))
                        }
                        placeholder="0,00"
                        className="h-9 tabular-nums"
                      />
                    </div>
                    <div className="w-24 min-w-0">
                      <Label
                        className="text-xs text-muted-foreground"
                        title="Quantas unidades de venda vêm em cada unidade comprada (caixa/fardo). Deixe 1 se comprar por unidade."
                      >
                        Un/emb
                      </Label>
                      <Input
                        value={it.unidPorEmb}
                        onChange={(e) =>
                          setItens((p) => p.map((x, i) => (i === idx ? { ...x, unidPorEmb: e.target.value } : x)))
                        }
                        placeholder="1"
                        title="Quantas unidades de venda vêm em cada unidade comprada (caixa/fardo). Deixe 1 se comprar por unidade."
                        className="h-9 tabular-nums"
                      />
                    </div>
                    <div className="w-28 pb-2 text-right text-xs tabular-nums text-muted-foreground">
                      {formatBRL((Number(it.quantidade.replace(",", ".")) || 0) * parseBRL(it.valorUnit))}
                      {freteNum > 0 ? (
                        <div className="text-[11px] text-muted-foreground/80">
                          + frete {formatBRL(freteDoItem(it))}
                        </div>
                      ) : null}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Remover item"
                      onClick={() => setItens((p) => p.filter((_, i) => i !== idx))}
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                  {fatorEmb(it) > 1 && parseBRL(it.valorUnit) > 0 ? (
                    <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                      Custo unitário: {formatBRL(custoPorUnidadeVenda(it, freteDoItem(it)))}
                    </p>
                  ) : null}
                  <div className="mt-2">
                    <SkuAutocomplete
                      ownerId={ownerId}
                      value={it.sku}
                      onSelect={(sku) => setItens((p) => p.map((x, i) => (i === idx ? { ...x, sku } : x)))}
                    />
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setItens((p) => [...p, novoManualItem()])
                }
              >
                <Plus className="mr-2 h-4 w-4" /> Adicionar item
              </Button>
              {freteNum > 0 || somaItens > 0 ? (
                <div className="space-y-1 text-xs tabular-nums text-muted-foreground">
                  <div>
                    Produtos: {formatBRL(somaItens)} · Frete: {formatBRL(freteNum)} · Total
                    produtos+frete: {formatBRL(somaItens + freteNum)}
                  </div>
                  {Math.abs(somaParcelas - (somaItens + freteNum)) > 0.01 ? (
                    <div className="text-amber-500">
                      As parcelas ({formatBRL(somaParcelas)}) não batem com produtos + frete (
                      {formatBRL(somaItens + freteNum)}).
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            ) : null}

            {!recorrente ? (
            <div className="rounded-md border border-border/60 bg-card/40 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Pagamento</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  Soma: {formatBRL(somaParcelas)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Gere pela condição abaixo ou edite manualmente. O total da nota será a soma das parcelas.
              </p>

              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground">Condição de pagamento</Label>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-full min-w-0 sm:w-40">
                    <Label className="text-xs text-muted-foreground">Valor total</Label>
                    <Input
                      value={condValor}
                      onChange={(e) => setCondValor(e.target.value)}
                      placeholder="0,00"
                      className="h-9 tabular-nums"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {([
                      ["avista", "À vista"],
                      ["agendado", "Agendado"],
                      ["boleto", "Boleto parcelado"],
                    ] as const).map(([v, label]) => (
                      <Button
                        key={v}
                        type="button"
                        size="sm"
                        variant={cond === v ? "default" : "outline"}
                        className="h-9"
                        onClick={() => setCond(v)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>

                {cond === "agendado" ? (
                  <div className="w-full min-w-0 sm:w-44">
                    <Label className="text-xs text-muted-foreground">Vencimento</Label>
                    <Input
                      type="date"
                      value={condData}
                      onChange={(e) => setCondData(e.target.value)}
                      className="h-9"
                    />
                  </div>
                ) : null}

                {cond === "boleto" ? (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Dias a partir da data da compra
                    </Label>
                    <div className="flex flex-wrap gap-1">
                      {(["30", "15/30", "15/30/45", "30/60", "30/60/90", "30/60/90/120"] as const).map((v) => (
                        <Button
                          key={v}
                          type="button"
                          size="sm"
                          variant={condBoleto === v ? "default" : "outline"}
                          className="h-8 tabular-nums"
                          onClick={() => setCondBoleto(v)}
                        >
                          {v}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <Button type="button" size="sm" variant="secondary" onClick={gerarParcelas}>
                  Gerar parcelas
                </Button>
              </div>

              <div className="space-y-2 border-t border-border/60 pt-3">
                <Label className="text-xs text-muted-foreground">Parcelas</Label>
              {parcelas.map((p, idx) => (
                <div key={idx} className="flex flex-wrap items-end gap-2">
                  <div className="w-full min-w-0 sm:w-44">
                    <Label className="text-xs text-muted-foreground">Vencimento</Label>
                    <Input
                      type="date"
                      value={p.vencimento}
                      onChange={(e) =>
                        setParcelas((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, vencimento: e.target.value } : x)),
                        )
                      }
                      className="h-9"
                    />
                  </div>
                  <div className="w-full min-w-0 sm:w-32">
                    <Label className="text-xs text-muted-foreground">Valor</Label>
                    <Input
                      value={p.valor}
                      onChange={(e) =>
                        setParcelas((prev) => prev.map((x, i) => (i === idx ? { ...x, valor: e.target.value } : x)))
                      }
                      placeholder="0,00"
                      className="h-9 tabular-nums"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remover parcela"
                    disabled={parcelas.length <= 1}
                    onClick={() => setParcelas((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setParcelas((p) => [...p, { vencimento: "", valor: "" }])}
              >
                <Plus className="mr-2 h-4 w-4" /> Adicionar parcela
              </Button>
              </div>
            </div>
            ) : null}

            {!destinoOk ? (
              <div className="text-xs text-amber-600">
                {ehFornecedor ? "Escolha o fornecedor." : "Escolha a categoria do gasto."}
              </div>
            ) : recorrente ? (
              !podeGravar ? (
                <div className="text-xs text-amber-600">
                  Informe valor mensal, dia do vencimento (1 a 31) e ao menos 1 mês.
                </div>
              ) : null
            ) : somaParcelas <= 0 ? (
              <div className="text-xs text-amber-600">Informe ao menos uma parcela com valor.</div>
            ) : precisaAviso ? (
              <div className="text-xs text-amber-600">
                {itens.length === 0
                  ? "Nenhum item detalhado — o custo por SKU não será atualizado."
                  : `${itensSemSku} item(ns) sem SKU selecionado — o custo por SKU não será atualizado para eles.`}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="border-t bg-background px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!podeGravar || manualImportMut.isPending || recorrenciaMut.isPending}
            onClick={handleGravar}
          >
            {manualImportMut.isPending || recorrenciaMut.isPending
              ? "Lançando…"
              : recorrente
                ? "Criar recorrência"
                : "Lançar nota"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContasAPagarPage() {
  const qc = useQueryClient();
  const [aba, setAba] = useState<"vencimentos" | "notas" | "cartao">("vencimentos");
  const [manualOpen, setManualOpen] = useState(false);
  const notesMetaQuery = useNotesMeta();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ParsedNote | null>(null);
  const [destino, setDestino] = useState<Destino>("nao_definido");
  const [previewRateio, setPreviewRateio] = useState(false);
  const [previewPct, setPreviewPct] = useState("50");
  const previewPctNum = Math.min(100, Math.max(0, Number(String(previewPct).replace(",", ".")) || 0));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [view, setView] = useState<View>("todas");
  const [fFornecedor, setFFornecedor] = useState("");
  const [fNumero, setFNumero] = useState("");
  const [fCnpj, setFCnpj] = useState("");
  const [fProduto, setFProduto] = useState("");
  const [statusPag, setStatusPag] = useState<"todas" | "pagas" | "nao_pagas" | "atrasadas" | "recorrentes">("todas");
  const [ordenacao, setOrdenacao] = useState<"lancamento" | "alfabetica" | "parcelas">("lancamento");
  const [expandedRec, setExpandedRec] = useState<string | null>(null);
  const [deb, setDeb] = useState({ fornecedor: "", numero: "", cnpj: "", produto: "" });
  const [selecoes, setSelecoes] = useState<Record<number, string>>({});
  const ownerId = useOwnerId();
  const [subFornecedor, setSubFornecedor] = useState<string | null>(null);
  const [subFornecedorLabel, setSubFornecedorLabel] = useState<string | null>(null);
  const fornecedoresQuery = useFornecedores(ownerId);
  const categoriasQuery = useCategorias(ownerId);
  const fornecedoresCatId = useMemo(
    () => (categoriasQuery.data ?? []).find((c) => c.is_fornecedores && Number(c.nivel) === 0)?.id ?? null,
    [categoriasQuery.data],
  );

  // Pré-selecionar fornecedor por CNPJ ao abrir a prévia
  useEffect(() => {
    if (!preview) {
      setSubFornecedor(null);
      setSubFornecedorLabel(null);
      setPreviewRateio(false);
      setPreviewPct("50");
      return;
    }
    let cancelado = false;
    const cnpj = onlyDigits(preview.fornecedor_cnpj);
    const hit = (fornecedoresQuery.data ?? []).find((f) => f.cnpj && onlyDigits(f.cnpj) === cnpj && cnpj);
    setSubFornecedor(hit?.id ?? null);
    setSubFornecedorLabel(hit?.name ?? null);
    if (hit || !ownerId || !preview.fornecedor_nome?.trim()) return;
    (async () => {
      const { data, error } = await supabase.rpc("resolve_name_rule", {
        _owner: ownerId,
        _text: preview.fornecedor_nome,
      });
      if (error || cancelado) return;
      const regra = ((data ?? []) as { expense_id: string | null; category_id: string | null }[])[0];
      if (!regra) return;
      let catId = regra.category_id ?? null;
      if (!catId && regra.expense_id) {
        const { data: exp } = await supabase
          .from("expenses")
          .select("category_id")
          .eq("id", regra.expense_id)
          .maybeSingle();
        catId = (exp as { category_id: string } | null)?.category_id ?? null;
      }
      if (!catId || cancelado) return;
      const f = (fornecedoresQuery.data ?? []).find((x) => x.id === catId);
      if (!f || cancelado) return;
      setSubFornecedor(f.id);
      setSubFornecedorLabel(f.name);
      toast.info("Fornecedor sugerido por regra — confira.");
    })();
    return () => {
      cancelado = true;
    };
  }, [preview, fornecedoresQuery.data, ownerId]);

  useEffect(() => {
    const t = setTimeout(
      () => setDeb({ fornecedor: fFornecedor.trim(), numero: fNumero.trim(), cnpj: fCnpj.trim(), produto: fProduto.trim() }),
      300,
    );
    return () => clearTimeout(t);
  }, [fFornecedor, fNumero, fCnpj, fProduto]);

  const rulesQuery = useQuery({
    queryKey: ["sku_translation_rules"],
    enabled: !!preview,
    queryFn: async () => {
      const { data, error } = await supabase.from("sku_translation_rules").select("fornecedor_sku, meu_sku");
      if (error) throw error;
      return (data ?? []) as { fornecedor_sku: string; meu_sku: string }[];
    },
  });

  const catalogQuery = useQuery({
    queryKey: ["product-catalog-preview", ownerId],
    enabled: !!ownerId && !!preview,
    queryFn: async (): Promise<CatalogItem[]> => {
      const { data, error } = await supabase.rpc("product_catalog", { _owner: ownerId!, _tipo: "todos" });
      if (error) throw error;
      return (data ?? []) as CatalogItem[];
    },
    staleTime: 60_000,
  });

  const tituloBySku = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of catalogQuery.data ?? []) m.set(c.sku, c.titulo);
    return m;
  }, [catalogQuery.data]);

  // Pré-preencher seleções pelas regras de tradução ao abrir a prévia
  useEffect(() => {
    if (!preview || !rulesQuery.data) return;
    const byFornecedor = new Map<string, string>();
    for (const r of rulesQuery.data) byFornecedor.set((r.fornecedor_sku ?? "").trim().toLowerCase(), r.meu_sku);
    const init: Record<number, string> = {};
    preview.itens.forEach((i, idx) => {
      const hit = byFornecedor.get((i.fornecedor_sku ?? "").trim().toLowerCase());
      if (hit) init[idx] = hit;
    });
    setSelecoes(init);
  }, [preview, rulesQuery.data]);

  const handleSelect = (index: number, sku: string | null) => {
    setSelecoes((prev) => {
      const next = { ...prev };
      if (sku) next[index] = sku;
      else delete next[index];
      return next;
    });
  };

  const { data: notas, isLoading } = useQuery({
    queryKey: ["payable-notes", deb.fornecedor, deb.numero, deb.cnpj, deb.produto, statusPag],
    enabled: statusPag !== "recorrentes",
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada. Entre novamente.");
      const { data, error } = await supabase.rpc("payable_notes_split", {
        _owner: uid,
        _fornecedor: deb.fornecedor || undefined,
        _numero: deb.numero || undefined,
        _cnpj: deb.cnpj || undefined,
        _produto: deb.produto || undefined,
        _status_pag: statusPag === "recorrentes" ? "todas" : statusPag,
      });
      if (error) throw error;
      return (data ?? []) as SplitNote[];
    },
  });

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseNfeXml(text);
      setDestino("nao_definido");
      setPreview(parsed);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ler o XML.");
    }
  };

  const importMut = useMutation({
    mutationFn: async ({
      note,
      destino,
      selecoes,
      subcategoriaId,
      rateioPct,
    }: {
      note: ParsedNote;
      destino: Destino;
      selecoes: Record<number, string>;
      subcategoriaId: string | null;
      rateioPct: number | null;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      const ownerId = userData.user?.id;
      if (!ownerId) throw new Error("Sessão expirada. Entre novamente.");

      const { data: existing, error: exErr } = await supabase
        .from("payable_notes")
        .select("id")
        .eq("chave_nfe", note.chave_nfe)
        .maybeSingle();
      if (exErr) throw exErr;
      if (existing) throw new Error("DUPLICADA");

      const { data: inserted, error: insErr } = await supabase
        .from("payable_notes")
        .insert({
          owner_id: ownerId,
          chave_nfe: note.chave_nfe,
          numero_nota: note.numero_nota,
          fornecedor_nome: note.fornecedor_nome,
          fornecedor_cnpj: note.fornecedor_cnpj,
          data_emissao: note.data_emissao,
          valor_total: note.valor_total,
          valor_produtos: note.valor_produtos,
          valor_frete: note.valor_frete,
          valor_outros: note.valor_outros,
          ...(rateioPct != null
            ? { destino: "rateio", ecommerce_mode: "percent", ecommerce_percent: rateioPct, ecommerce_amount: 0 }
            : { destino }),
          subcategoria_id: subcategoriaId,
          categoria_id: fornecedoresCatId,
          tipo_conta: "fornecedor",
        })
        .select("id")
        .single();
      if (insErr) {
        if ((insErr as { code?: string }).code === "23505") throw new Error("DUPLICADA");
        throw insErr;
      }
      const noteId = inserted.id;

      if (note.parcelas.length) {
        const { error } = await supabase.from("payable_installments").insert(
          note.parcelas.map((p) => ({
            owner_id: ownerId,
            note_id: noteId,
            numero: p.numero,
            vencimento: p.vencimento,
            valor: p.valor,
            status: "aberta",
          })),
        );
        if (error) throw error;
      }

      let casados = 0;
      const falhas: string[] = [];
      for (let idx = 0; idx < note.itens.length; idx++) {
        const i = note.itens[idx];
        const { data: novoItem, error } = await supabase
          .from("payable_items")
          .insert({
            owner_id: ownerId,
            note_id: noteId,
            fornecedor_sku: i.fornecedor_sku,
            descricao: i.descricao,
            quantidade: i.quantidade,
            valor_unitario: i.valor_unitario,
            valor_total: i.valor_total,
          })
          .select("id")
          .single();
        if (error) throw error;

        const escolhido = selecoes[idx];
        if (escolhido) {
          const { error: mErr } = await supabase.rpc("match_payable_item", {
            _owner: ownerId,
            _item_id: novoItem.id,
            _meu_sku: escolhido,
          });
          if (mErr) falhas.push(i.descricao || i.fornecedor_sku || `item ${idx + 1}`);
          else casados++;
        }
      }
      return { noteId, casados, falhas };
    },
    onSuccess: ({ noteId, casados, falhas }) => {
      if (falhas.length) {
        toast.warning(
          `Nota importada, mas não consegui casar: ${falhas.join(", ")}. Corrija na listagem (expanda a nota).`,
        );
      } else if (casados > 0) {
        toast.success(`Nota importada e ${casados} ${casados === 1 ? "item casado" : "itens casados"}.`);
      } else {
        toast.success("Nota importada.");
      }
      setPreview(null);
      setSelecoes({});
      qc.invalidateQueries({ queryKey: ["payable-notes-sub"] });
      invalidateMatchQueries(qc, noteId);
    },
    onError: (e: Error) => {
      if (e.message === "DUPLICADA") {
        toast.error("Esta nota já foi importada.");
        setPreview(null);
        return;
      }
      toast.error(e.message || "Falha ao importar a nota.");
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("payable_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nota excluída.");
      qc.invalidateQueries({ queryKey: ["payable-notes"] });
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao excluir."),
  });

  const somaParcelas = preview ? preview.parcelas.reduce((s, p) => s + p.valor, 0) : 0;
  const divergente = preview ? Math.abs(somaParcelas - preview.valor_total) > 0.01 : false;

  const recorrenciasQuery = useQuery({
    queryKey: ["recorrencias", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_recorrencias", { _owner: ownerId! });
      if (error) throw error;
      return (data ?? []) as unknown as Recorrencia[];
    },
  });

  const { lista, avulsas, recIdsNaLista, totalVisao } = useMemo(() => {
    const all = notas ?? [];
    const filtered = all.filter((n) => {
      const d = (n.destino ?? "nao_definido") as DestinoFull;
      if (view === "todas") return true;
      if (d === "nao_definido") return false;
      if (view === "ecommerce") return d === "ecommerce" || (d === "rateio" && Number(n.parte_ecommerce ?? 0) > 0);
      return d === "locacao" || (d === "rateio" && Number(n.parte_locacao ?? 0) > 0);
    });
    const valorDe = (n: SplitNote) =>
      view === "todas"
        ? Number(n.valor_total ?? 0)
        : view === "ecommerce"
          ? Number(n.parte_ecommerce ?? 0)
          : Number(n.parte_locacao ?? 0);
    const mapped = filtered.map((n) => ({ n, valor: valorDe(n) }));
    const recIds: string[] = [];
    for (const { n } of mapped) {
      if (n.recorrencia_id && !recIds.includes(n.recorrencia_id)) recIds.push(n.recorrencia_id);
    }
    let avulsas = mapped.filter(({ n }) => !n.recorrencia_id);
    if (ordenacao === "lancamento") {
      avulsas = avulsas.sort((a, b) => new Date(b.n.created_at).getTime() - new Date(a.n.created_at).getTime());
    } else if (ordenacao === "alfabetica") {
      avulsas = avulsas.sort((a, b) => {
        const na = a.n.fornecedor_nome || "";
        const nb = b.n.fornecedor_nome || "";
        if (!na && !nb) return 0;
        if (!na) return 1;
        if (!nb) return -1;
        return na.localeCompare(nb, "pt-BR", { sensitivity: "base" });
      });
    } else if (ordenacao === "parcelas") {
      avulsas = avulsas.sort((a, b) => {
        const pa = Number(a.n.parcelas_total ?? 0);
        const pb = Number(b.n.parcelas_total ?? 0);
        if (pb !== pa) return pb - pa;
        return new Date(b.n.created_at).getTime() - new Date(a.n.created_at).getTime();
      });
    }
    return {
      lista: mapped,
      avulsas,
      recIdsNaLista: recIds,
      totalVisao: filtered.reduce((s, n) => s + valorDe(n), 0),
    };
  }, [notas, view, ordenacao]);

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-primary">Contas a Pagar</h1>
        <p className="text-sm text-muted-foreground">
          Importe o XML da NF-e do fornecedor para registrar a nota, suas parcelas e os produtos.
        </p>
      </header>

      <div className="inline-flex rounded-md border border-border/60 bg-card/60 p-0.5">
        {([
          ["vencimentos", "Vencimentos do dia"],
          ["notas", "Lançamento de notas/contas"],
          ["cartao", "Importar fatura do cartão"],
        ] as const).map(([v, label]) => (
          <Button
            key={v}
            size="sm"
            variant="ghost"
            onClick={() => setAba(v)}
            className={cn("h-8 px-3 text-sm", aba === v && "bg-primary/15 text-primary hover:bg-primary/15")}
          >
            {label}
          </Button>
        ))}
      </div>

      {aba === "vencimentos" ? (
        <VencimentosDoDia ownerId={ownerId} onRegistrarPagamento={() => {}} />
      ) : aba === "cartao" ? (
        <FaturaCartao ownerId={ownerId} />
      ) : (
        <div className="space-y-6">
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".xml,text/xml,application/xml"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
        <Button onClick={() => inputRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" /> Importar XML
        </Button>
        <Button variant="outline" onClick={() => setManualOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Lançar manual
        </Button>
        <ManualNoteDialog open={manualOpen} onOpenChange={setManualOpen} ownerId={ownerId} />
        <div className="ml-auto inline-flex rounded-md border border-border/60 bg-card/60 p-0.5">
          {([
            ["todas", "Todas"],
            ["ecommerce", "E-commerce"],
            ["locacao", "Locação"],
          ] as const).map(([v, label]) => (
            <Button
              key={v}
              size="sm"
              variant="ghost"
              onClick={() => setView(v)}
              className={cn("h-8 px-3 text-sm", view === v && "bg-primary/15 text-primary hover:bg-primary/15")}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {statusPag !== "recorrentes" ? (
        <Card>
          <CardContent className="flex items-center justify-between px-4 py-3">
            <div className="text-xs text-muted-foreground">
              {view === "todas" ? "Total" : view === "ecommerce" ? "Total e-commerce" : "Total locação"} ·{" "}
              {lista.length} nota(s)
            </div>
            <div className="text-xl font-semibold tabular-nums">{formatBRL(totalVisao)}</div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 px-4 py-3">
          <div className="min-w-[180px] flex-1">
            <Label className="text-xs text-muted-foreground">Fornecedor</Label>
            <Input value={fFornecedor} onChange={(e) => setFFornecedor(e.target.value)} placeholder="Nome do fornecedor" className="h-9" />
          </div>
          <div className="w-32">
            <Label className="text-xs text-muted-foreground">Nº da nota</Label>
            <Input value={fNumero} onChange={(e) => setFNumero(e.target.value)} placeholder="0000" className="h-9 tabular-nums" />
          </div>
          <div className="w-44">
            <Label className="text-xs text-muted-foreground">CNPJ</Label>
            <Input value={fCnpj} onChange={(e) => setFCnpj(e.target.value)} placeholder="00.000.000/0000-00" className="h-9 tabular-nums" />
          </div>
          <div className="min-w-[180px] flex-1">
            <Label className="text-xs text-muted-foreground">Produto</Label>
            <Input value={fProduto} onChange={(e) => setFProduto(e.target.value)} placeholder="Descrição ou SKU do fornecedor" className="h-9" />
          </div>
          <div className="inline-flex rounded-md border border-border/60 bg-card/60 p-0.5">
            {([
              ["todas", "Todas"],
              ["pagas", "Pagas"],
              ["nao_pagas", "Não pagas"],
              ["atrasadas", "Atrasadas"],
              ["recorrentes", "Recorrentes"],
            ] as const).map(([v, label]) => (
              <Button
                key={v}
                size="sm"
                variant="ghost"
                onClick={() => setStatusPag(v)}
                className={cn(
                  "h-8 px-3 text-sm",
                  statusPag === v && "bg-primary/15 hover:bg-primary/15",
                  statusPag === v && v === "atrasadas" ? "text-red-500" : statusPag === v ? "text-primary" : ""
                )}
              >
                {label}
              </Button>
            ))}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                <ArrowUpDown className="h-3.5 w-3.5" /> Ordenar
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-52 max-w-[calc(100vw-1.5rem)] p-1" align="end" collisionPadding={12}>
              {([
                ["lancamento", "Últimas lançadas"],
                ["alfabetica", "Ordem alfabética"],
                ["parcelas", "Quantidade de parcelas"],
              ] as const).map(([v, label]) => (
                <Button
                  key={v}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start h-9 px-2 text-xs"
                  onClick={() => setOrdenacao(v)}
                >
                  <span className="flex-1 text-left">{label}</span>
                  {ordenacao === v && <Check className="h-3.5 w-3.5 text-primary" />}
                </Button>
              ))}
            </PopoverContent>
          </Popover>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs text-muted-foreground"
            onClick={() => {
              setFFornecedor("");
              setFNumero("");
              setFCnpj("");
              setFProduto("");
              setStatusPag("todas");
            }}
          >
            Limpar
          </Button>
        </CardContent>
      </Card>

      {statusPag === "recorrentes" ? (
        <RecorrenciasList ownerId={ownerId} />
      ) : isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : avulsas.length === 0 && recIdsNaLista.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nenhuma nota importada"
          description="Importe um XML para começar."
        />
      ) : (
        <div className="space-y-2">
          {recIdsNaLista.map((rid) => {
            const rec = (recorrenciasQuery.data ?? []).find((r) => r.id === rid);
            if (!rec) return null;
            return (
              <RecorrenciaCard
                key={rid}
                rec={rec}
                ownerId={ownerId}
                open={expandedRec === rid}
                onToggle={() => setExpandedRec((p) => (p === rid ? null : rid))}
              />
            );
          })}
          {avulsas.map(({ n, valor }) => {
            const pagas = Number(n.parcelas_pagas ?? 0);
            const totalParcelas = Number(n.parcelas_total ?? 0);
            const isOpen = expanded === n.id;
            const mostrarOriginal = view !== "todas" && Math.abs(valor - Number(n.valor_total ?? 0)) > 0.01;
            const meta = notesMetaQuery.data?.find((r) => r.id === n.id) ?? null;
            const tipoConta: "fornecedor" | "geral" = meta?.tipo_conta === "geral" ? "geral" : "fornecedor";
            const categoriaEfetiva =
              (tipoConta === "fornecedor" ? meta?.subcategoria_id : meta?.categoria_id) ?? null;
            const categoriaNome =
              (categoriasQuery.data ?? []).find((c) => c.id === meta?.categoria_id)?.name ?? null;
            const fornecedorSubNome =
              (fornecedoresQuery.data ?? []).find((f) => f.id === meta?.subcategoria_id)?.name ?? null;
            const destinoLabel =
              [categoriaNome, fornecedorSubNome].filter(Boolean).join(" › ") || n.fornecedor_nome || "destino";
            return (
              <Card key={n.id} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : n.id)}
                      className="flex flex-1 items-center gap-3 text-left"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{n.fornecedor_nome || "—"}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          NF {n.numero_nota || "—"} · {formatDate(n.data_emissao)} · {formatCnpj(n.fornecedor_cnpj)}
                        </div>
                      </div>
                      <div className="w-28 text-right text-xs text-muted-foreground tabular-nums">
                        {pagas} de {totalParcelas} pagas
                      </div>
                      <div className="w-40 text-right tabular-nums">
                        <div className="text-sm font-semibold">{formatBRL(valor)}</div>
                        {mostrarOriginal ? (
                          <div className="text-[11px] text-muted-foreground">
                            de {formatBRL(Number(n.valor_total ?? 0))}
                          </div>
                        ) : null}
                      </div>
                    </button>
                    <DestinoEditor note={n} />
                    <NoteDestino note={n} meta={meta} ownerId={ownerId} />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-red-600"
                      aria-label="Excluir nota"
                      onClick={() => {
                        if (window.confirm("Excluir esta nota e suas parcelas e itens?")) {
                          deleteMut.mutate(n.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {isOpen ? (
                    <NoteDetails
                      noteId={n.id}
                      categoriaEfetiva={categoriaEfetiva}
                      gastoId={meta?.gasto_id ?? null}
                      recorrenciaId={meta?.recorrencia_id ?? null}
                      tipoConta={tipoConta}
                      destinoLabel={destinoLabel}
                    />
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="flex flex-col w-[min(96vw,48rem)] max-w-[96vw] max-h-[90vh] p-0">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6">
          <DialogHeader>
            <DialogTitle>Prévia da nota</DialogTitle>
          </DialogHeader>
          {preview ? (
            <div className="space-y-5">
              <div className="rounded-md border border-border/60 p-4">
                <div className="text-sm font-medium">{preview.fornecedor_nome || "—"}</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  CNPJ {formatCnpj(preview.fornecedor_cnpj)} · NF {preview.numero_nota || "—"} ·{" "}
                  {formatDate(preview.data_emissao)}
                </div>
                <div className="mt-3 text-2xl font-semibold tabular-nums">{formatBRL(preview.valor_total)}</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  Produtos {formatBRL(preview.valor_produtos)} · Frete {formatBRL(preview.valor_frete)} · Outros{" "}
                  {formatBRL(preview.valor_outros)}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Vincular a fornecedor:</span>
                  <FornecedorPicker
                    ownerId={ownerId}
                    value={subFornecedor}
                    label={subFornecedorLabel}
                    sugestaoNome={preview.fornecedor_nome}
                    sugestaoCnpj={preview.fornecedor_cnpj}
                    onChange={(id, name) => {
                      setSubFornecedor(id);
                      setSubFornecedorLabel(name);
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Destino</div>
                <div className="inline-flex rounded-md border border-border/60 bg-card/60 p-0.5">
                  {(["ecommerce", "locacao"] as const).map((d) => (
                    <Button
                      key={d}
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setPreviewRateio(false);
                        setDestino(!previewRateio && destino === d ? "nao_definido" : d);
                      }}
                      className={cn(
                        "h-8 px-3 text-sm",
                        !previewRateio && destino === d && "bg-primary/15 text-primary hover:bg-primary/15",
                      )}
                    >
                      {DESTINO_LABEL[d]}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const novo = !previewRateio;
                      setPreviewRateio(novo);
                      if (novo) setDestino("nao_definido");
                    }}
                    className={cn("h-8 px-3 text-sm", previewRateio && "bg-primary/15 text-primary hover:bg-primary/15")}
                  >
                    Ratear
                  </Button>
                </div>
                {previewRateio ? (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">% e-commerce</span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={previewPct}
                        onChange={(e) => setPreviewPct(e.target.value)}
                        className="h-8 w-24 tabular-nums"
                      />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      E-commerce: {formatBRL((preview.valor_total * previewPctNum) / 100)} · Locação:{" "}
                      {formatBRL((preview.valor_total * (100 - previewPctNum)) / 100)}
                    </span>
                  </div>
                ) : null}
              </div>

              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Parcelas</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nº</TableHead>
                      <TableHead>Vencimento</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.parcelas.map((p, idx) => (
                      <TableRow key={`${p.numero}-${idx}`}>
                        <TableCell className="tabular-nums">{p.numero}</TableCell>
                        <TableCell className="tabular-nums">{formatDate(p.vencimento)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(p.valor)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="mt-1 text-right text-xs text-muted-foreground tabular-nums">
                  Soma das parcelas: {formatBRL(somaParcelas)}
                </div>
                {divergente ? (
                  <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
                    A soma das parcelas ({formatBRL(somaParcelas)}) difere do total da nota (
                    {formatBRL(preview.valor_total)}).
                  </div>
                ) : null}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Itens</div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {Object.keys(selecoes).length} de {preview.itens.length} com SKU escolhido
                  </div>
                </div>
                <div className="space-y-2">
                  {preview.itens.map((i, idx) => (
                    <PreviewItemRow
                      key={`${i.fornecedor_sku}-${idx}`}
                      item={i}
                      index={idx}
                      ownerId={ownerId}
                      selecionado={selecoes[idx] ?? null}
                      onSelect={handleSelect}
                      tituloBySku={tituloBySku}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          </div>
          <DialogFooter className="border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setPreview(null)}>
              Cancelar
            </Button>
            <Button
              disabled={importMut.isPending}
              onClick={() =>
                preview &&
                importMut.mutate({
                  note: preview,
                  destino,
                  selecoes,
                  subcategoriaId: subFornecedor,
                  rateioPct: previewRateio ? previewPctNum : null,
                })
              }
            >
              {importMut.isPending ? "Importando…" : "Importar nota"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </div>
      )}
    </div>
  );
}
