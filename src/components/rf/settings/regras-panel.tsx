import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tag, Trash2, Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/rf/empty-state";

export function RegrasPanel() {
  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">Regras</h2>
        <p className="text-sm text-muted-foreground">
          Regras de nome dos lançamentos e tradução de SKU dos fornecedores.
        </p>
      </header>
      <NameRulesCard />
      <SkuRulesCard />
    </div>
  );
}

// -------- Card 4: Regras de nome --------

type Category = {
  id: string;
  name: string;
  parent_category_id: string | null;
  sort_order: number;
};

type Expense = {
  id: string;
  name: string;
  category_id: string;
  sort_order: number;
};

type NameRule = {
  id: string;
  match_text: string;
  expense_id: string | null;
  category_id: string | null;
  created_at: string;
};

type DropdownOption = {
  value: string; // "cat:<id>" or "exp:<id>"
  label: string; // hierarchical path
};

const RULES_KEY = ["expense_name_rules"] as const;
const TAX_KEY = ["expense_taxonomy"] as const;

function normText(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function buildPaths(categories: Category[], expenses: Expense[]): {
  options: DropdownOption[];
  catPathById: Map<string, string>;
  expPathById: Map<string, string>;
} {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const catPathById = new Map<string, string>();
  for (const c of categories) {
    const parts: string[] = [];
    let cur: Category | undefined = c;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parent_category_id ? byId.get(cur.parent_category_id) : undefined;
    }
    catPathById.set(c.id, parts.join(" › "));
  }

  const expPathById = new Map<string, string>();
  for (const e of expenses) {
    const catPath = catPathById.get(e.category_id) ?? "";
    expPathById.set(e.id, catPath ? `${catPath} › ${e.name}` : e.name);
  }

  // Build children maps for hierarchical ordering
  const childrenByParent = new Map<string | null, Category[]>();
  for (const c of categories) {
    const key = c.parent_category_id;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key)!.push(c);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }

  const expensesByCat = new Map<string, Expense[]>();
  for (const e of expenses) {
    if (!expensesByCat.has(e.category_id)) expensesByCat.set(e.category_id, []);
    expensesByCat.get(e.category_id)!.push(e);
  }
  for (const arr of expensesByCat.values()) {
    arr.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }

  const options: DropdownOption[] = [];
  const walk = (parentId: string | null) => {
    const kids = childrenByParent.get(parentId) ?? [];
    for (const c of kids) {
      options.push({ value: `cat:${c.id}`, label: catPathById.get(c.id) ?? c.name });
      // subcategories
      walk(c.id);
      // expenses under this category
      const exps = expensesByCat.get(c.id) ?? [];
      for (const e of exps) {
        options.push({ value: `exp:${e.id}`, label: expPathById.get(e.id) ?? e.name });
      }
    }
  };
  walk(null);

  return { options, catPathById, expPathById };
}

function NameRulesCard() {
  const qc = useQueryClient();
  const [matchText, setMatchText] = useState("");
  const [target, setTarget] = useState<string>("");

  const taxQuery = useQuery({
    queryKey: TAX_KEY,
    queryFn: async (): Promise<{ categories: Category[]; expenses: Expense[] }> => {
      const { data: user } = await supabase.auth.getUser();
      const uid = user.user?.id;
      if (!uid) return { categories: [], expenses: [] };
      const [catRes, expRes] = await Promise.all([
        supabase
          .from("expense_categories")
          .select("id, name, parent_category_id, sort_order"),
        supabase
          .from("expenses")
          .select("id, name, category_id, sort_order"),
      ]);
      if (catRes.error) throw catRes.error;
      if (expRes.error) throw expRes.error;
      return {
        categories: (catRes.data as Category[]) ?? [],
        expenses: (expRes.data as Expense[]) ?? [],
      };
    },
  });

  const rulesQuery = useQuery({
    queryKey: RULES_KEY,
    queryFn: async (): Promise<NameRule[]> => {
      const { data: user } = await supabase.auth.getUser();
      const uid = user.user?.id;
      if (!uid) return [];
      const { data, error } = await supabase
        .from("expense_name_rules")
        .select("id, match_text, expense_id, category_id, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as NameRule[]) ?? [];
    },
  });

  const { options, catPathById, expPathById } = useMemo(() => {
    const cats = taxQuery.data?.categories ?? [];
    const exps = taxQuery.data?.expenses ?? [];
    return buildPaths(cats, exps);
  }, [taxQuery.data]);

  const create = useMutation({
    mutationFn: async (): Promise<{ skipped?: boolean }> => {
      const text = matchText.trim();
      if (!text) throw new Error("Informe o texto");
      if (!target) throw new Error("Selecione um destino");
      const { data: user } = await supabase.auth.getUser();
      const uid = user.user?.id;
      if (!uid) throw new Error("Sessão inválida");
      const [kind, id] = target.split(":");
      const payload = {
        owner_id: uid,
        match_text: text,
        expense_id: kind === "exp" ? id : null,
        category_id: kind === "cat" ? id : null,
      };

      const novoNorm = normText(text);
      const existentes = rulesQuery.data ?? [];
      for (const r of existentes) {
        const exNorm = normText(r.match_text);
        if (!exNorm) continue;
        const identico = exNorm === novoNorm;
        const contem = exNorm.includes(novoNorm) || novoNorm.includes(exNorm);
        if (!identico && !contem) continue;
        const mesmoDestino =
          (r.expense_id ?? null) === payload.expense_id && (r.category_id ?? null) === payload.category_id;
        if (mesmoDestino) {
          if (identico) {
            toast.info("Essa regra já existe.");
            return { skipped: true };
          }
          continue;
        }
        const destinoNovo =
          kind === "exp" ? (expPathById.get(id) ?? "(gasto)") : (catPathById.get(id) ?? "(categoria)");
        const ok = window.confirm(
          `Já existe a regra "${r.match_text}" → ${describeTarget(r)}. A nova "${text}" → ${destinoNovo} pode conflitar (o casamento é por trecho). Criar mesmo assim?`,
        );
        if (!ok) return { skipped: true };
        break;
      }

      const { error } = await supabase.from("expense_name_rules").insert(payload);
      if (error) throw error;
      return {};
    },
    onSuccess: (res) => {
      if (res?.skipped) return;
      toast.success("Regra adicionada");
      setMatchText("");
      setTarget("");
      qc.invalidateQueries({ queryKey: RULES_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("expense_name_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra removida");
      qc.invalidateQueries({ queryKey: RULES_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rules = rulesQuery.data ?? [];

  const describeTarget = (r: NameRule): string => {
    if (r.expense_id) return expPathById.get(r.expense_id) ?? "(gasto removido)";
    if (r.category_id) return catPathById.get(r.category_id) ?? "(categoria removida)";
    return "—";
  };

  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Tag className="h-4 w-4" /> Regras de nome
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Associe textos que aparecem na conta ou mensagem a um gasto ou categoria de destino.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] items-end">
          <div className="space-y-1.5">
            <Label htmlFor="rule-text" className="text-sm">
              Texto
            </Label>
            <Input
              id="rule-text"
              value={matchText}
              onChange={(e) => setMatchText(e.target.value)}
              placeholder="Texto que aparece na conta, ex.: COGRA COMERCIO LTDA"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-target" className="text-sm">
              Destino
            </Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id="rule-target">
                <SelectValue placeholder="Selecione categoria ou gasto" />
              </SelectTrigger>
              <SelectContent className="max-h-[320px]">
                {options.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Nenhuma categoria cadastrada
                  </div>
                ) : (
                  options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !matchText.trim() || !target}
          >
            {create.isPending ? "Salvando..." : "Adicionar regra"}
          </Button>
        </div>

        {rulesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : rules.length === 0 ? (
          <EmptyState
            icon={Tag}
            title="Nenhuma regra cadastrada"
            description="Adicione a primeira regra acima."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Texto</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs font-mono">{r.match_text}</TableCell>
                    <TableCell className="text-xs">{describeTarget(r)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (window.confirm(`Excluir a regra "${r.match_text}"?`)) {
                            remove.mutate(r.id);
                          }
                        }}
                        disabled={remove.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
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
// -------- Card B: Regras de SKU --------

type SkuRule = {
  id: string;
  fornecedor_sku: string;
  meu_sku: string;
  created_at: string;
};

type CatalogItem = {
  id: string;
  sku: string;
  titulo: string;
};

const SKU_RULES_KEY = ["sku_translation_rules"] as const;

function SkuRulesCard() {
  const qc = useQueryClient();
  const [fornecedorSku, setFornecedorSku] = useState("");
  const [meuSku, setMeuSku] = useState("");
  const [buscaSku, setBuscaSku] = useState("");
  const [openSug, setOpenSug] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBuscaSku(meuSku.trim()), 300);
    return () => clearTimeout(t);
  }, [meuSku]);

  const ownerQuery = useQuery({
    queryKey: ["auth-user-id"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });
  const ownerId = ownerQuery.data ?? null;

  const sugQuery = useQuery({
    queryKey: ["sku-suggestions", buscaSku, ownerId],
    enabled: !!ownerId && buscaSku.length >= 1,
    queryFn: async (): Promise<CatalogItem[]> => {
      const { data, error } = await supabase.rpc("product_catalog", {
        _owner: ownerId!,
        _tipo: "todos",
        _busca: buscaSku,
      });
      if (error) throw error;
      return ((data ?? []) as CatalogItem[]).slice(0, 8);
    },
  });

  const rulesQuery = useQuery({
    queryKey: SKU_RULES_KEY,
    queryFn: async (): Promise<SkuRule[]> => {
      const { data, error } = await supabase
        .from("sku_translation_rules")
        .select("id, fornecedor_sku, meu_sku, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as SkuRule[]) ?? [];
    },
  });

  const catalogQuery = useQuery({
    queryKey: ["product-catalog-all", ownerId],
    enabled: !!ownerId,
    queryFn: async (): Promise<CatalogItem[]> => {
      const { data, error } = await supabase.rpc("product_catalog", {
        _owner: ownerId!,
        _tipo: "todos",
      });
      if (error) throw error;
      return (data ?? []) as CatalogItem[];
    },
  });

  const tituloBySku = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of catalogQuery.data ?? []) m.set(p.sku, p.titulo);
    return m;
  }, [catalogQuery.data]);

  const meuSkuTitulo = tituloBySku.get(meuSku.trim()) ?? null;
  const skuDesconhecido = meuSku.trim().length > 0 && (catalogQuery.data ?? []).length > 0 && !meuSkuTitulo;

  const create = useMutation({
    mutationFn: async () => {
      const forn = fornecedorSku.trim();
      const meu = meuSku.trim();
      if (!forn || !meu) throw new Error("Preencha os dois campos");
      const { data: user } = await supabase.auth.getUser();
      const uid = user.user?.id;
      if (!uid) throw new Error("Sessão inválida");
      const { error } = await supabase
        .from("sku_translation_rules")
        .insert({ owner_id: uid, fornecedor_sku: forn, meu_sku: meu });
      if (error) {
        if (error.code === "23505") throw new Error("Já existe uma regra para esse SKU de fornecedor.");
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Regra adicionada");
      setFornecedorSku("");
      setMeuSku("");
      qc.invalidateQueries({ queryKey: SKU_RULES_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sku_translation_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra removida");
      qc.invalidateQueries({ queryKey: SKU_RULES_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rules = rulesQuery.data ?? [];
  const sugestoes = sugQuery.data ?? [];

  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Boxes className="h-4 w-4" /> Regras de SKU
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Quando uma nota chega com o SKU do fornecedor, o sistema usa o seu SKU correspondente.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] items-start">
          <div className="space-y-1.5">
            <Label htmlFor="sku-forn" className="text-sm">SKU do fornecedor</Label>
            <Input
              id="sku-forn"
              value={fornecedorSku}
              onChange={(e) => setFornecedorSku(e.target.value)}
              placeholder="Ex.: ABC-1234"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5 relative">
            <Label htmlFor="sku-meu" className="text-sm">Meu SKU</Label>
            <Input
              id="sku-meu"
              value={meuSku}
              onChange={(e) => { setMeuSku(e.target.value); setOpenSug(true); }}
              onFocus={() => setOpenSug(true)}
              onBlur={() => setTimeout(() => setOpenSug(false), 150)}
              placeholder="Digite para buscar no catálogo"
              className="font-mono"
              autoComplete="off"
            />
            {openSug && sugestoes.length > 0 ? (
              <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
                {sugestoes.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-accent"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setMeuSku(s.sku); setOpenSug(false); }}
                  >
                    <span className="font-mono text-xs">{s.sku}</span>
                    <span className="text-xs text-muted-foreground truncate max-w-full">{s.titulo}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {meuSkuTitulo ? (
              <p className="text-xs text-muted-foreground truncate">{meuSkuTitulo}</p>
            ) : skuDesconhecido ? (
              <p className="text-xs text-amber-500">SKU não encontrado no catálogo</p>
            ) : null}
          </div>
          <Button
            className="mt-6"
            onClick={() => create.mutate()}
            disabled={create.isPending || !fornecedorSku.trim() || !meuSku.trim()}
          >
            {create.isPending ? "Salvando..." : "Adicionar regra"}
          </Button>
        </div>

        {rulesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : rules.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="Nenhuma regra de SKU"
            description="Adicione a primeira regra acima."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU fornecedor</TableHead>
                  <TableHead>Meu SKU</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs font-mono">{r.fornecedor_sku}</TableCell>
                    <TableCell className="text-xs">
                      <div className="font-mono">{r.meu_sku}</div>
                      {tituloBySku.get(r.meu_sku) ? (
                        <div className="text-muted-foreground">{tituloBySku.get(r.meu_sku)}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (window.confirm(`Excluir a regra "${r.fornecedor_sku}"?`)) remove.mutate(r.id);
                        }}
                        disabled={remove.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
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
