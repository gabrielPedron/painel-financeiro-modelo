import { useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

export type SkuExportRow = {
  sku: string;
  titulo: string | null;
  is_kit: boolean;
  custo_efetivo: number | null;
};

const HEADERS = ["SKU", "Produto", "Tipo", "Custo atual", "Novo custo"];

/** Aceita "1.234,56" e "1234.56". */
export function parseCustoFlexivel(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[R$\s]/gi, "");
  const temVirgula = s.includes(",");
  const temPonto = s.includes(".");
  if (temVirgula && temPonto) {
    // o último separador é o decimal
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (temVirgula) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function exportarModeloCustos(rows: SkuExportRow[]) {
  const data = rows.map((r) => ({
    SKU: r.sku,
    Produto: r.titulo ?? "",
    Tipo: r.is_kit ? "Kit" : "Simples",
    "Custo atual": r.custo_efetivo ?? "",
    "Novo custo": "",
  }));
  const ws = XLSX.utils.json_to_sheet(data, { header: HEADERS });
  ws["!cols"] = [{ wch: 20 }, { wch: 44 }, { wch: 10 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Custos");
  XLSX.writeFile(wb, `custos-skus-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

type Status = "ok" | "vazio" | "inexistente" | "erro" | "travado" | "kit" | "igual";

type Linha = {
  linha: number;
  sku: string;
  titulo: string;
  de: number | null;
  para: number | null;
  status: Status;
  detalhe: string;
};

const STATUS_LABEL: Record<Status, string> = {
  ok: "Vai atualizar",
  igual: "Sem mudança",
  vazio: "Em branco",
  inexistente: "SKU inexistente",
  erro: "Valor inválido",
  travado: "Custo travado (pulado)",
  kit: "Kit (pulado)",
};

export function SkuCustosImportDialog({
  open,
  onOpenChange,
  ownerId,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ownerId: string;
  onImported: () => void;
}) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const reset = () => {
    setLinhas(null);
    setArquivo(null);
  };

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

      const skus = raw
        .map((r) => String(r["SKU"] ?? r["sku"] ?? "").trim())
        .filter(Boolean);

      const { data: existentes, error } = await supabase
        .from("product_skus")
        .select("sku, titulo, is_kit, custo_base, custo_travado")
        .eq("owner_id", ownerId)
        .in("sku", skus.slice(0, 5000));
      if (error) throw error;
      const mapa = new Map((existentes ?? []).map((p) => [p.sku, p]));

      const parsed: Linha[] = raw.map((r, i) => {
        const sku = String(r["SKU"] ?? r["sku"] ?? "").trim();
        const novoRaw = r["Novo custo"] ?? r["novo custo"] ?? "";
        const base: Linha = {
          linha: i + 2,
          sku,
          titulo: String(r["Produto"] ?? ""),
          de: null,
          para: null,
          status: "vazio",
          detalhe: "",
        };
        if (!sku) return { ...base, status: "erro", detalhe: "Linha sem SKU" };
        const prod = mapa.get(sku);
        if (!prod) return { ...base, status: "inexistente", detalhe: "SKU não cadastrado — cadastre antes de importar" };
        base.titulo = prod.titulo ?? base.titulo;
        base.de = prod.custo_base == null ? null : Number(prod.custo_base);
        if (String(novoRaw).trim() === "") return { ...base, status: "vazio", detalhe: "Sem novo custo — mantém o atual" };
        const valor = parseCustoFlexivel(novoRaw);
        if (valor == null || valor < 0)
          return { ...base, status: "erro", detalhe: `Valor inválido: "${String(novoRaw)}"` };
        base.para = valor;
        if (prod.is_kit) return { ...base, status: "kit", detalhe: "Custo do kit vem dos componentes" };
        if (prod.custo_travado) return { ...base, status: "travado", detalhe: "Custo travado — destrave para alterar" };
        if (base.de != null && Math.abs(base.de - valor) < 0.005)
          return { ...base, status: "igual", detalhe: "Valor idêntico ao atual" };
        return { ...base, status: "ok", detalhe: "" };
      });

      setArquivo(file.name);
      setLinhas(parsed);
    } catch (e) {
      toast.error(`Não foi possível ler o arquivo: ${(e as Error).message}`);
    }
  };

  const aplicar = async () => {
    if (!linhas) return;
    const alvos = linhas.filter((l) => l.status === "ok");
    if (!alvos.length) return;
    setSalvando(true);
    let ok = 0;
    let comNota = 0;
    const erros: string[] = [];
    for (const l of alvos) {
      // Grava no histórico como custo manual sem mexer na trava (cus-03: antes destravava todos).
      const { data: custoVigente, error } = await supabase.rpc("set_manual_sku_cost", {
        _owner: ownerId,
        _sku: l.sku,
        _valor: l.para!,
      });
      if (error) erros.push(`${l.sku}: ${error.message}`);
      else {
        ok++;
        if (custoVigente != null && Number(custoVigente) !== l.para) comNota++;
      }
    }
    setSalvando(false);
    if (erros.length) toast.error(`${erros.length} erro(s). Primeiro: ${erros[0]}`);
    if (ok) toast.success(`${ok} custo(s) atualizado(s).`);
    if (comNota) toast.warning(`Em ${comNota} SKU(s) o custo que vale continua o da nota mais recente. Para usar o da planilha, trave o custo no produto.`);
    onImported();
    onOpenChange(false);
    reset();
  };

  const contagem = (s: Status) => linhas?.filter((l) => l.status === s).length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Importar custos de SKU</DialogTitle>
          <DialogDescription>
            Use o modelo exportado, preencha a coluna <strong>Novo custo</strong> e envie o arquivo. Aceita 1.234,56 e
            1234.56.
          </DialogDescription>
        </DialogHeader>

        {!linhas ? (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 py-12 text-sm text-muted-foreground hover:bg-muted/50">
            <FileSpreadsheet className="h-6 w-6" />
            Clique para escolher o arquivo .xlsx
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
          </label>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">{arquivo}</span>
              <Badge variant="secondary">{contagem("ok")} para atualizar</Badge>
              {contagem("vazio") > 0 && <Badge variant="outline">{contagem("vazio")} em branco</Badge>}
              {contagem("igual") > 0 && <Badge variant="outline">{contagem("igual")} sem mudança</Badge>}
              {contagem("inexistente") > 0 && (
                <Badge variant="outline" className="border-warning text-warning">
                  {contagem("inexistente")} SKU inexistente
                </Badge>
              )}
              {contagem("travado") > 0 && <Badge variant="outline">{contagem("travado")} travado</Badge>}
              {contagem("kit") > 0 && <Badge variant="outline">{contagem("kit")} kit</Badge>}
              {contagem("erro") > 0 && <Badge variant="destructive">{contagem("erro")} com erro</Badge>}
            </div>

            {contagem("travado") + contagem("kit") > 0 ? (
              <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                Custos travados e custos de kit não são sobrescritos: kits são calculados pelos componentes e SKUs
                travados precisam ser destravados na edição do produto.
              </p>
            ) : null}

            <div className="max-h-[45vh] overflow-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    <TableHead className="w-14">Linha</TableHead>
                    <TableHead className="w-36">SKU</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="w-28 text-right">De</TableHead>
                    <TableHead className="w-28 text-right">Para</TableHead>
                    <TableHead className="w-56">Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map((l) => (
                    <TableRow key={`${l.linha}-${l.sku}`} className="text-sm">
                      <TableCell className="text-muted-foreground tabular-nums">{l.linha}</TableCell>
                      <TableCell className="font-mono text-xs">{l.sku || "—"}</TableCell>
                      <TableCell className="max-w-[280px] truncate">{l.titulo || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.de == null ? "—" : formatBRL(l.de)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.para == null ? "—" : formatBRL(l.para)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-xs",
                          l.status === "ok" && "text-primary",
                          l.status === "erro" && "text-destructive",
                          (l.status === "travado" || l.status === "kit" || l.status === "inexistente") &&
                            "text-muted-foreground",
                        )}
                      >
                        {STATUS_LABEL[l.status]}
                        {l.detalhe ? <span className="block text-[11px] text-muted-foreground">{l.detalhe}</span> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter>
          {linhas ? <Button variant="ghost" onClick={reset}>Escolher outro arquivo</Button> : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={aplicar} disabled={!linhas || salvando || contagem("ok") === 0}>
            <Upload className="mr-1.5 h-4 w-4" />
            {salvando ? "Gravando..." : `Aplicar ${contagem("ok")} custo(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
