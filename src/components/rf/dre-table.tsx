import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";

export interface DreRow {
  secao: string;
  secao_ord: number;
  grupo: string;
  grupo_ord: number;
  item: string;
  item_ord: number;
  valor: number;
}

interface Grupo {
  nome: string;
  ord: number;
  total: number;
  itens: { nome: string; ord: number; valor: number }[];
}

interface Secao {
  nome: string;
  ord: number;
  total: number;
  grupos: Grupo[];
}

function buildTree(rows: DreRow[]): Secao[] {
  const secoes = new Map<string, Secao>();
  for (const r of rows ?? []) {
    let s = secoes.get(r.secao);
    if (!s) {
      s = { nome: r.secao, ord: r.secao_ord ?? 0, total: 0, grupos: [] };
      secoes.set(r.secao, s);
    }
    let g = s.grupos.find((x) => x.nome === r.grupo);
    if (!g) {
      g = { nome: r.grupo, ord: r.grupo_ord ?? 0, total: 0, itens: [] };
      s.grupos.push(g);
    }
    const valor = Number(r.valor) || 0;
    if (r.item) g.itens.push({ nome: r.item, ord: r.item_ord ?? 0, valor });
    g.total += valor;
    s.total += valor;
  }
  const list = [...secoes.values()].sort((a, b) => a.ord - b.ord);
  for (const s of list) {
    s.grupos.sort((a, b) => a.ord - b.ord);
    for (const g of s.grupos) g.itens.sort((a, b) => a.ord - b.ord);
  }
  return list;
}

function isEntrada(nome: string) {
  return nome.toUpperCase().startsWith("ENTRADA");
}

export function DreTable({ rows, loading }: { rows: DreRow[] | undefined; loading?: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const secoes = useMemo(() => buildTree(rows ?? []), [rows]);

  const totalEntradas = secoes.filter((s) => isEntrada(s.nome)).reduce((a, s) => a + s.total, 0);
  const totalSaidas = secoes.filter((s) => !isEntrada(s.nome)).reduce((a, s) => a + s.total, 0);
  const resultado = totalEntradas - totalSaidas;

  return (
    <Card className="bg-card border-border/70 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">DRE do período</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : secoes.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Sem dados no período. Total R$ 0,00.</div>
        ) : (
          <div className="divide-y divide-border/60">
            {secoes.map((s) => {
              const entrada = isEntrada(s.nome);
              return (
                <div key={s.nome}>
                  <div className="flex items-center justify-between gap-3 bg-muted/30 px-4 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.nome}</span>
                    <span className={cn("tabular-nums text-sm font-semibold", entrada ? "text-emerald-500" : "text-red-500")}>
                      {formatBRL(s.total)}
                    </span>
                  </div>
                  {s.grupos.map((g) => {
                    const key = `${s.nome}::${g.nome}`;
                    const expanded = !!open[key];
                    return (
                      <div key={key}>
                        <button
                          type="button"
                          onClick={() => setOpen((p) => ({ ...p, [key]: !p[key] }))}
                          className="flex w-full items-center justify-between gap-3 px-4 py-2 pl-6 text-left transition-colors hover:bg-muted/40"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <ChevronRight
                              className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
                            />
                            <span className="min-w-0 truncate text-sm">{g.nome}</span>
                          </span>
                          <span className={cn("shrink-0 tabular-nums text-sm", entrada ? "text-emerald-500" : "text-red-500")}>
                            {formatBRL(g.total)}
                          </span>
                        </button>
                        {expanded
                          ? g.itens.map((it) => (
                              <div
                                key={`${key}::${it.nome}`}
                                className="flex items-center justify-between gap-3 px-4 py-1.5 pl-14 text-sm text-muted-foreground"
                              >
                                <span className="min-w-0 truncate">{it.nome}</span>
                                <span className="shrink-0 tabular-nums">{formatBRL(it.valor)}</span>
                              </div>
                            ))
                          : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-3 bg-muted/50 px-4 py-3">
              <span className="text-sm font-semibold uppercase tracking-wide">Resultado</span>
              <span className={cn("tabular-nums text-base font-semibold", resultado >= 0 ? "text-emerald-500" : "text-red-500")}>
                {formatBRL(resultado)}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
