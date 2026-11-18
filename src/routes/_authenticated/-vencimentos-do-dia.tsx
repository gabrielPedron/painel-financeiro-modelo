import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/rf/empty-state";
import { toast } from "sonner";
import { formatBRL, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { imageFileTooLarge, IMAGE_TOO_LARGE_MESSAGE } from "@/lib/image-limit";
import { ChevronLeft, ChevronRight, Check, CalendarDays, Receipt, X, Upload, SkipForward } from "lucide-react";

function parseBRL(v: string): number {
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export type VencItem = {
  installment_id: string;
  note_id: string;
  numero_parcela: string;
  fornecedor_nome: string;
  numero_nota: string | null;
  vencimento: string;
  valor: number;
  status: string;
  pago_em: string | null;
  planilha_lancado: boolean;
  categoria_id: string | null;
  subcategoria_id: string | null;
  gasto_id: string | null;
  tipo_conta: string;
  destino: string | null;
  recorrencia_id: string | null;
  categoria_efetiva_id: string | null;
  atrasada: boolean;
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function shiftDay(iso: string, delta: number) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDayShort(iso: string | null | undefined) {
  if (!iso) return "";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

function porExtenso(iso: string) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(parseISO(iso));
  } catch {
    return "";
  }
}

type PayableResumo = {
  vencido_valor: number;
  vencido_qtd: number;
  hoje_valor: number;
  hoje_qtd: number;
  semana_valor: number;
  semana_qtd: number;
  mes_valor: number;
  mes_qtd: number;
  pago_mes_valor: number;
  pago_mes_qtd: number;
};

function ResumoCards({ ownerId, op }: { ownerId: string | null; op: "todas" | "ecommerce" | "locacao" }) {
  const { data, isLoading } = useQuery({
    queryKey: ["payable-resumo", ownerId, op],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("payable_resumo", { _owner: ownerId!, _op: op });
      if (error) throw error;
      return (data ?? []) as unknown as PayableResumo[];
    },
  });
  const r = data?.[0];
  const cards = [
    { label: "Vencido", valor: r?.vencido_valor ?? 0, qtd: r?.vencido_qtd ?? 0, critico: true },
    { label: "Vence hoje", valor: r?.hoje_valor ?? 0, qtd: r?.hoje_qtd ?? 0, critico: false },
    { label: "Vence em 7 dias", valor: r?.semana_valor ?? 0, qtd: r?.semana_qtd ?? 0, critico: false },
    { label: "Previsto no mês", valor: r?.mes_valor ?? 0, qtd: r?.mes_qtd ?? 0, critico: false },
    { label: "Pago no mês", valor: r?.pago_mes_valor ?? 0, qtd: r?.pago_mes_qtd ?? 0, realizado: true },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {isLoading
        ? Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="bg-card border-border/70">
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-3 w-16" />
              </CardContent>
            </Card>
          ))
        : cards.map((c) => (
            <Card
              key={c.label}
              className={cn("bg-card border-border/70", c.critico && c.qtd > 0 && "border-red-500/40")}
            >
              <CardContent className="p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</div>
                <div
                  className={cn(
                    "mt-2 text-2xl font-semibold tabular-nums tracking-tight",
                    c.critico && c.qtd > 0
                      ? "text-red-500"
                      : (c as { realizado?: boolean }).realizado
                        ? "text-emerald-500"
                        : "",
                  )}
                >
                  {formatBRL(c.valor)}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {c.qtd === 1 ? "1 conta" : `${c.qtd} contas`}
                </div>
              </CardContent>
            </Card>
          ))}
    </div>
  );
}

export function VencimentosDoDia({
  ownerId,
  onRegistrarPagamento,
}: {
  ownerId: string | null;
  onRegistrarPagamento?: () => void;
}) {
  const qc = useQueryClient();
  const [dia, setDia] = useState<string>(todayISO());
  const [filtro, setFiltro] = useState<"aberto" | "pago" | "ambas">("aberto");
  const [op, setOp] = useState<"todas" | "ecommerce" | "locacao">("todas");
  const [pagando, setPagando] = useState<VencItem | null>(null);
  const [registrarOpen, setRegistrarOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["vencimentos-dia", dia, ownerId, op],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("vencimentos_do_dia", {
        _owner: ownerId!,
        _dia: dia,
        _op: op,
      } as unknown as { _owner: string; _dia: string });
      if (error) throw error;
      return (data ?? []) as unknown as VencItem[];
    },
  });

  const itens = useMemo(() => {
    const all = data ?? [];
    const filtrados =
      filtro === "ambas"
        ? [...all]
        : all.filter((i) => (filtro === "aberto" ? i.status === "aberta" : i.status === "paga"));
    return filtrados.sort((a, b) => Number(!!b.atrasada) - Number(!!a.atrasada));
  }, [data, filtro]);

  const total = useMemo(() => itens.reduce((acc, i) => acc + Number(i.valor || 0), 0), [itens]);
  const qtdAtrasadas = useMemo(() => itens.filter((i) => i.atrasada).length, [itens]);

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-md border border-border/60 bg-card/60 p-0.5">
        {([
          ["todas", "Todas"],
          ["ecommerce", "E-commerce"],
          ["locacao", "Locação"],
        ] as const).map(([v, label]) => (
          <Button
            key={v}
            size="sm"
            variant="ghost"
            onClick={() => setOp(v)}
            className={cn("h-8 px-3 text-sm", op === v && "bg-primary/15 text-primary hover:bg-primary/15")}
          >
            {label}
          </Button>
        ))}
      </div>

      <ResumoCards ownerId={ownerId} op={op} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setDia((d) => shiftDay(d, -1))} aria-label="Dia anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={dia}
            onChange={(e) => e.target.value && setDia(e.target.value)}
            className="w-[160px]"
          />
          <Button variant="outline" size="icon" onClick={() => setDia((d) => shiftDay(d, 1))} aria-label="Próximo dia">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDia(todayISO())}>
            Hoje
          </Button>
          <span className="text-sm capitalize text-muted-foreground">{porExtenso(dia)}</span>
        </div>
        <Button
          size="sm"
          onClick={() => {
            onRegistrarPagamento?.();
            setRegistrarOpen(true);
          }}
        >
          <CalendarDays className="mr-2 h-4 w-4" />
          Registrar pagamento
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Mostra o que venceu até o dia (em aberto) e o que foi pago no dia.
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant={filtro === "aberto" ? "default" : "outline"}
          size="sm"
          onClick={() => setFiltro("aberto")}
        >
          Em aberto
        </Button>
        <Button variant={filtro === "pago" ? "default" : "outline"} size="sm" onClick={() => setFiltro("pago")}>
          Pagas
        </Button>
        <Button variant={filtro === "ambas" ? "default" : "outline"} size="sm" onClick={() => setFiltro("ambas")}>
          Ambas
        </Button>
      </div>

      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div className="text-sm text-muted-foreground">
            {itens.length} {itens.length === 1 ? "conta" : "contas"} ·{" "}
            {filtro === "ambas" ? "abertas e pagas" : filtro === "aberto" ? "em aberto" : "pagas"}
            {qtdAtrasadas > 0 ? (
              <span className="ml-1 text-red-500">
                (inclui {qtdAtrasadas} atrasada{qtdAtrasadas === 1 ? "" : "s"})
              </span>
            ) : null}
          </div>
          <div className={cn("text-lg font-semibold tabular-nums", filtro === "pago" && "text-emerald-500")}>
            {formatBRL(total)}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : itens.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nada por aqui"
          description={
            filtro === "ambas"
              ? "Nada em aberto ou pago neste dia."
              : filtro === "aberto"
                ? "Nada em aberto ou vencido até este dia."
                : "Nada pago neste dia."
          }
        />
      ) : (
        <div className="space-y-2">
          {itens.map((item) => {
            const semCategoria = !item.categoria_efetiva_id;
            return (
              <Card key={item.installment_id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{item.fornecedor_nome}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {item.numero_nota ? `NF ${item.numero_nota} · ` : ""}
                      {item.atrasada ? "venceu" : "vence"} {formatDate(item.vencimento)}
                      {item.numero_parcela ? ` · parcela ${item.numero_parcela}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-base font-semibold tabular-nums">{formatBRL(Number(item.valor || 0))}</div>
                    {item.atrasada ? (
                      <Badge className="border-red-500/30 bg-red-500/15 text-red-500">Atrasada</Badge>
                    ) : null}
                    {item.status === "paga" ? (
                      <div className="flex items-center gap-2">
                        <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-500">Paga</Badge>
                        {item.pago_em ? (
                          <span className="text-xs text-muted-foreground">em {formatDayShort(item.pago_em)}</span>
                        ) : null}
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        disabled={semCategoria}
                        title={semCategoria ? "Defina o destino da conta em Contas a Pagar" : undefined}
                        onClick={() => setPagando(item)}
                      >
                        <Check className="mr-2 h-4 w-4" />
                        Pagar
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {pagando ? (
        <PagarDialog ownerId={ownerId} item={pagando} onClose={() => setPagando(null)} />
      ) : null}

      <p className="text-xs text-muted-foreground">
        Resumo considera parcelas pelo vencimento; pago no mês pela data de pagamento.
      </p>

      {registrarOpen ? (
        <RegistrarPagamentoDialog
          ownerId={ownerId}
          onClose={() => {
            setRegistrarOpen(false);
            for (const key of ["vencimentos-dia", "payable-notes", "payable-notes-sub", "expense-sheet"]) {
              qc.invalidateQueries({ queryKey: [key] });
            }
          }}
        />
      ) : null}
    </div>
  );
}

type BoletoLido = { beneficiario: string; valor: string; data_pagamento: string };
type LinhaStatus = "pendente" | "casada" | "pulada" | "lancada";
type Linha = BoletoLido & { status: LinhaStatus };

type Candidato = {
  installment_id: string;
  note_id: string;
  fornecedor_nome: string;
  numero_nota: string | null;
  vencimento: string;
  valor: number;
  categoria_id: string | null;
  subcategoria_id: string | null;
  gasto_id: string | null;
  tipo_conta: string;
  destino: string | null;
  diff_valor: number;
  diff_dias: number;
};

type CategoriaMini = {
  id: string;
  name: string;
  parent_id: string | null;
  is_fornecedores: boolean;
  nivel: number;
};

function RegistrarPagamentoDialog({
  ownerId,
  onClose,
}: {
  ownerId: string | null;
  onClose: () => void;
}) {
  const [imagemDataUrl, setImagemDataUrl] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [lendo, setLendo] = useState(false);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [atual, setAtual] = useState(0);
  const [metodo, setMetodo] = useState<"print" | "manual">("print");
  const [fase, setFase] = useState<"captura" | "preanalise" | "revisao">("captura");

  function escolherArquivo(file: File | null) {
    if (!file) return;
    if (imageFileTooLarge(file)) {
      setImagemDataUrl(null);
      toast.error(IMAGE_TOO_LARGE_MESSAGE);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImagemDataUrl(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  }

  async function lerBoletos() {
    if (!imagemDataUrl && !texto.trim()) {
      toast.error("Escolha um print ou cole o texto dos boletos.");
      return;
    }
    setLendo(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Entre novamente.");
      const res = await fetch("/api/contas/ler-boletos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          imagemDataUrl
            ? { access_token: token, image_base64: imagemDataUrl }
            : { access_token: token, texto: texto.trim() },
        ),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; boletos?: BoletoLido[]; error?: string }
        | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Falha ao ler os boletos.");
      const boletos = json.boletos ?? [];
      if (!boletos.length) {
        toast.error("Nenhum boleto encontrado.");
        return;
      }
      setLinhas(
        boletos.map((b) => ({
          beneficiario: String(b.beneficiario ?? ""),
          valor: formatBRL(Number(b.valor ?? 0)).replace("R$", "").trim(),
          data_pagamento: String(b.data_pagamento ?? "").slice(0, 10) || todayISO(),
          status: "pendente" as LinhaStatus,
        })),
      );
      setAtual(0);
      setFase("preanalise");
    } catch (e) {
      toast.error(
        (e instanceof Error ? e.message : "Falha ao ler os boletos.") +
          " Se estiver no preview, publique o app e tente de novo.",
      );
    } finally {
      setLendo(false);
    }
  }

  const fim = fase === "revisao" && linhas.length > 0 && atual >= linhas.length;
  const casados = linhas.filter((l) => l.status === "casada" || l.status === "lancada").length;
  const pulados = linhas.filter((l) => l.status === "pulada").length;
  const totalRegistrado = linhas
    .filter((l) => l.status === "casada" || l.status === "lancada")
    .reduce((s, l) => s + parseBRL(l.valor), 0);

  function atualizarLinha(patch: Partial<Linha>) {
    setLinhas((prev) => prev.map((l, i) => (i === atual ? { ...l, ...patch } : l)));
  }

  function proximaPendente(lista: Linha[], desde: number) {
    for (let i = desde; i < lista.length; i++) {
      if (lista[i]!.status === "pendente") return i;
    }
    return lista.length;
  }

  function avancar(status: LinhaStatus) {
    setLinhas((prev) => {
      const next = prev.map((l, i) => (i === atual ? { ...l, status } : l));
      setAtual(proximaPendente(next, atual + 1));
      return next;
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col p-0 sm:max-w-2xl">
        <div className="flex-1 overflow-y-auto px-6 pt-6">
        <DialogHeader>
          <DialogTitle>Registrar pagamento de boletos</DialogTitle>
          <DialogDescription>
            {fase === "captura"
              ? metodo === "print"
                ? "Envie o print dos boletos pagos ou cole o texto."
                : "Registre um pagamento já feito, manualmente."
              : fase === "preanalise"
                ? "Pré-análise: veja o que casa sozinho antes de revisar."
                : fim
                  ? "Revisão final."
                  : `Boleto ${atual + 1} de ${linhas.length}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {fase === "captura" ? (
            <div className="flex w-fit items-center gap-1 rounded-md border border-border/60 p-1">
              {([
                ["print", "Por print/texto"],
                ["manual", "Manual"],
              ] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMetodo(v)}
                  className={cn(
                    "rounded px-3 py-1.5 text-sm transition-colors",
                    metodo === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          {fase === "captura" && metodo === "manual" ? (
            <RegistrarManual ownerId={ownerId} onGravado={onClose} />
          ) : null}

          {fase === "captura" && metodo === "print" ? (
            <>
              <div className="space-y-2">
                <Label>Print dos boletos</Label>
                {imagemDataUrl ? (
                  <div className="relative w-fit">
                    <img
                      src={imagemDataUrl}
                      alt="Print dos boletos"
                      className="max-h-64 rounded-md border border-border/60"
                    />
                    <Button
                      size="icon"
                      variant="secondary"
                      className="absolute right-1 top-1 h-7 w-7"
                      onClick={() => setImagemDataUrl(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <label className="flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border/60 py-8 text-sm transition-colors hover:bg-muted/40">
                    <Upload className="mb-1 h-5 w-5 text-muted-foreground" />
                    <span className="font-medium">Escolher print</span>
                    <span className="text-xs text-muted-foreground">PNG, JPG do seu banco</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => escolherArquivo(e.target.files?.[0] ?? null)}
                    />
                  </label>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border/60" />
                <span className="text-xs text-muted-foreground">ou</span>
                <div className="h-px flex-1 bg-border/60" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="txt-boletos">Cole o texto dos boletos</Label>
                <Textarea
                  id="txt-boletos"
                  rows={5}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder="Cole aqui o comprovante ou a lista de boletos"
                />
              </div>
            </>
          ) : fase === "preanalise" ? (
            <PreAnalise
              ownerId={ownerId}
              linhas={linhas}
              onAplicar={(indicesCasados) => {
                setLinhas((prev) => {
                  const next = prev.map((l, i) =>
                    indicesCasados.includes(i) ? { ...l, status: "casada" as LinhaStatus } : l,
                  );
                  setAtual(proximaPendente(next, 0));
                  return next;
                });
                setFase("revisao");
              }}
              onRevisarTudo={() => {
                setAtual(proximaPendente(linhas, 0));
                setFase("revisao");
              }}
            />
          ) : fim ? (
            <div className="space-y-2 text-sm">
              <p className="text-foreground">
                {casados} {casados === 1 ? "casado" : "casados"} · {pulados}{" "}
                {pulados === 1 ? "pulado" : "pulados"}
              </p>
              <p className="text-base font-semibold text-emerald-500 tabular-nums">
                Total registrado: {formatBRL(totalRegistrado)}
              </p>
              <div className="space-y-1">
                {linhas.map((l, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                    <span className="truncate">{l.beneficiario || "(sem nome)"}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{formatBRL(parseBRL(l.valor))}</span>
                      <Badge
                        className={cn(
                          l.status === "pulada"
                            ? "border-muted-foreground/30 bg-muted text-muted-foreground"
                            : "border-emerald-500/30 bg-emerald-500/15 text-emerald-500",
                        )}
                      >
                        {l.status === "pulada" ? "Pulado" : "Registrado"}
                      </Badge>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : !linhas[atual] ? null : (
            <LinhaBoleto
              key={atual}
              ownerId={ownerId}
              linha={linhas[atual]!}
              onChange={atualizarLinha}
              onFeito={(status) => avancar(status)}
            />
          )}
        </div>
        </div>

        <DialogFooter className="border-t bg-background px-6 py-4">
          {fase === "captura" && metodo === "manual" ? (
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
          ) : fase === "captura" ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button onClick={() => void lerBoletos()} disabled={lendo}>
                {lendo ? "Lendo..." : "Ler boletos"}
              </Button>
            </>
          ) : fase === "preanalise" ? (
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
          ) : fim ? (
            <Button onClick={onClose}>Concluir</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Fechar
              </Button>
              <Button
                variant="ghost"
                onClick={() => avancar("pulada")}
              >
                <SkipForward className="mr-2 h-4 w-4" />
                Pular este
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type TipoPre = "auto" | "ambiguo" | "sem_match";

function PreAnalise({
  ownerId,
  linhas,
  onAplicar,
  onRevisarTudo,
}: {
  ownerId: string | null;
  linhas: Linha[];
  onAplicar: (indicesCasados: number[]) => void;
  onRevisarTudo: () => void;
}) {
  const chave = linhas.map((l) => `${l.valor}|${l.data_pagamento}`).join(";");

  const preQuery = useQuery({
    queryKey: ["pre-analise-boletos", ownerId, chave],
    enabled: !!ownerId && linhas.length > 0,
    queryFn: async (): Promise<Candidato[][]> => {
      return await Promise.all(
        linhas.map(async (l): Promise<Candidato[]> => {
          const valorNum = parseBRL(l.valor);
          if (valorNum <= 0 || !l.data_pagamento) return [];
          const { data, error } = await supabase.rpc("match_installments_by_approx", {
            _owner: ownerId!,
            _valor: valorNum,
            _data: l.data_pagamento,
          });
          if (error) throw error;
          return (data ?? []) as unknown as Candidato[];
        }),
      );
    },
  });

  const resultados = preQuery.data ?? [];

  const classificacao: TipoPre[] = linhas.map((_, i) => {
    const cands = resultados[i] ?? [];
    if (cands.length === 0) return "sem_match";
    if (cands.length === 1 && cands[0]!.gasto_id) return "auto";
    return "ambiguo";
  });

  const indicesAuto = classificacao.flatMap((t, i) => (t === "auto" ? [i] : []));
  const qtdAuto = indicesAuto.length;
  const qtdAmbiguo = classificacao.filter((t) => t === "ambiguo").length;
  const qtdSem = classificacao.filter((t) => t === "sem_match").length;

  const casarLoteMut = useMutation({
    mutationFn: async (): Promise<number[]> => {
      if (!ownerId) throw new Error("Sessão inválida.");
      const feitos: number[] = [];
      for (const i of indicesAuto) {
        const linha = linhas[i]!;
        const cand = (resultados[i] ?? [])[0];
        if (!cand?.gasto_id) continue;
        const { error } = await supabase.rpc("pay_installment_to_planilha", {
          _owner: ownerId,
          _installment_id: cand.installment_id,
          _expense_id: cand.gasto_id,
          _pago_em: linha.data_pagamento,
          _valor_pago: parseBRL(linha.valor),
        });
        if (error) throw error;
        feitos.push(i);
      }
      return feitos;
    },
    onSuccess: (feitos) => {
      toast.success(`${feitos.length} ${feitos.length === 1 ? "boleto casado" : "boletos casados"}.`);
      onAplicar(feitos);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao casar em lote."),
  });

  if (preQuery.isLoading) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Analisando os boletos...</p>
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (preQuery.isError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-amber-500">Não foi possível pré-analisar os boletos.</p>
        <Button size="sm" variant="outline" onClick={onRevisarTudo}>
          Revisar manualmente
        </Button>
      </div>
    );
  }

  const selo: Record<TipoPre, { label: string; cls: string }> = {
    auto: { label: "Casa sozinho", cls: "border-emerald-500/30 bg-emerald-500/15 text-emerald-500" },
    ambiguo: { label: "Precisa revisar", cls: "border-amber-500/30 bg-amber-500/15 text-amber-500" },
    sem_match: { label: "Sem correspondência", cls: "border-muted-foreground/30 bg-muted text-muted-foreground" },
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-foreground">
        {qtdAuto} {qtdAuto === 1 ? "casa automaticamente" : "casam automaticamente"} · {qtdAmbiguo}{" "}
        {qtdAmbiguo === 1 ? "precisa" : "precisam"} de revisão · {qtdSem} sem correspondência
      </p>

      <div className="space-y-1">
        {linhas.map((l, i) => {
          const s = selo[classificacao[i]!];
          return (
            <div key={i} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
              <span className="truncate">{l.beneficiario || "(sem nome)"}</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{formatBRL(parseBRL(l.valor))}</span>
                <Badge className={cn(s.cls)}>{s.label}</Badge>
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {qtdAuto > 0 ? (
          <Button size="sm" disabled={casarLoteMut.isPending} onClick={() => casarLoteMut.mutate()}>
            {casarLoteMut.isPending ? "Casando..." : `Casar automáticos (${qtdAuto})`}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={onRevisarTudo}>
          {qtdAuto > 0 ? "Revisar tudo manualmente" : "Revisar"}
        </Button>
      </div>
    </div>
  );
}

function RegistrarManual({
  ownerId,
  onGravado,
}: {
  ownerId: string | null;
  onGravado: () => void;
}) {
  const [alvo, setAlvo] = useState<"conta" | "avulso">("conta");

  // modo "conta"
  const [buscaValor, setBuscaValor] = useState("");
  const [buscaData, setBuscaData] = useState(todayISO());
  const [buscou, setBuscou] = useState(false);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [gastoEscolhido, setGastoEscolhido] = useState<string | null>(null);
  const [valorPago, setValorPago] = useState("");
  const [dataPagamento, setDataPagamento] = useState(todayISO());

  // modo "avulso"
  const [avBeneficiario, setAvBeneficiario] = useState("");
  const [avValor, setAvValor] = useState("");
  const [avData, setAvData] = useState(todayISO());

  const buscaValorNum = parseBRL(buscaValor);

  const matchQuery = useQuery({
    queryKey: ["match-parcelas-manual", ownerId, buscaValorNum, buscaData],
    enabled: false,
    queryFn: async (): Promise<Candidato[]> => {
      const { data, error } = await supabase.rpc("match_installments_by_approx", {
        _owner: ownerId!,
        _valor: buscaValorNum,
        _data: buscaData,
        _tol_percent: 100,
        _tol_dias: 365,
      });
      if (error) throw error;
      return (data ?? []) as unknown as Candidato[];
    },
  });

  const candidatos = matchQuery.data ?? [];
  const escolhido = candidatos.find((c) => c.installment_id === selecionado) ?? null;
  const escolhidoId = escolhido?.installment_id ?? null;

  useEffect(() => {
    setGastoEscolhido(null);
    if (escolhido) {
      setValorPago(formatBRL(Number(escolhido.valor || 0)).replace("R$", "").trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escolhidoId]);

  const catEfetiva = escolhido
    ? escolhido.tipo_conta === "fornecedor"
      ? escolhido.subcategoria_id
      : escolhido.categoria_id
    : null;
  const expenseIdFinal = escolhido?.gasto_id ?? gastoEscolhido;
  const valorPagoNum = parseBRL(valorPago);

  const baixarMut = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão inválida.");
      if (!escolhido) throw new Error("Escolha a parcela.");
      if (!expenseIdFinal) throw new Error("Escolha o gasto.");
      if (valorPagoNum <= 0) throw new Error("Valor pago inválido.");
      const { error } = await supabase.rpc("pay_installment_to_planilha", {
        _owner: ownerId,
        _installment_id: escolhido.installment_id,
        _expense_id: expenseIdFinal,
        _pago_em: dataPagamento,
        _valor_pago: valorPagoNum,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Baixa registrada e lançada na Planilha.");
      onGravado();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao registrar a baixa."),
  });

  if (!ownerId) {
    return <p className="text-sm text-muted-foreground">Sessão expirada. Entre novamente.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex w-fit items-center gap-1 rounded-md border border-border/60 p-1">
        {([
          ["conta", "Pagar conta existente"],
          ["avulso", "Pagamento avulso"],
        ] as const).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setAlvo(v)}
            className={cn(
              "rounded px-3 py-1.5 text-sm transition-colors",
              alvo === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {alvo === "conta" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Valor aproximado</Label>
              <Input
                value={buscaValor}
                onChange={(e) => setBuscaValor(e.target.value)}
                placeholder="0,00"
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data de referência</Label>
              <Input type="date" value={buscaData} onChange={(e) => setBuscaData(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                className="w-full"
                disabled={buscaValorNum <= 0 || matchQuery.isFetching}
                onClick={() => {
                  setBuscou(true);
                  setSelecionado(null);
                  void matchQuery.refetch();
                }}
              >
                {matchQuery.isFetching ? "Buscando..." : "Buscar"}
              </Button>
            </div>
          </div>

          {matchQuery.isFetching ? (
            <Skeleton className="h-24 w-full" />
          ) : buscou && candidatos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma parcela em aberto encontrada. Use o modo "Pagamento avulso".
            </p>
          ) : candidatos.length > 0 ? (
            <div className="flex max-h-56 flex-col gap-1 overflow-y-auto overscroll-contain">
              {candidatos.map((c) => (
                <button
                  key={c.installment_id}
                  type="button"
                  onClick={() => setSelecionado(c.installment_id)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    selecionado === c.installment_id
                      ? "border-primary bg-primary/10"
                      : "border-border/60 hover:bg-muted/50",
                  )}
                >
                  <span className="truncate">
                    {c.fornecedor_nome}
                    {c.numero_nota ? ` · NF ${c.numero_nota}` : ""} · vence {formatDate(c.vencimento)} ·{" "}
                    <span className="tabular-nums">{formatBRL(Number(c.valor || 0))}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {escolhido ? (
            <Card>
              <CardContent className="space-y-3 py-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Valor pago</Label>
                    <Input
                      value={valorPago}
                      onChange={(e) => setValorPago(e.target.value)}
                      placeholder="0,00"
                      className="tabular-nums"
                    />
                    <p className="text-xs text-muted-foreground">Ajuste se pagou com juros/desconto.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Data do pagamento</Label>
                    <Input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
                  </div>
                </div>

                {!escolhido.gasto_id ? (
                  catEfetiva ? (
                    <GastoInlinePicker
                      ownerId={ownerId}
                      categoriaId={catEfetiva}
                      value={gastoEscolhido}
                      onChange={setGastoEscolhido}
                    />
                  ) : (
                    <p className="text-xs text-amber-500">
                      Esta nota não tem fornecedor/categoria definidos. Use o modo "Pagamento avulso" ou defina o
                      destino em Notas e contas.
                    </p>
                  )
                ) : null}

                <Button
                  disabled={!expenseIdFinal || valorPagoNum <= 0 || baixarMut.isPending}
                  onClick={() => baixarMut.mutate()}
                >
                  <Check className="mr-2 h-4 w-4" />
                  Registrar baixa
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Beneficiário</Label>
              <Input
                value={avBeneficiario}
                onChange={(e) => setAvBeneficiario(e.target.value)}
                placeholder="Nome de quem recebeu"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Valor pago</Label>
              <Input
                value={avValor}
                onChange={(e) => setAvValor(e.target.value)}
                placeholder="0,00"
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data do pagamento</Label>
              <Input type="date" value={avData} onChange={(e) => setAvData(e.target.value)} />
            </div>
          </div>

          {parseBRL(avValor) > 0 ? (
            <LancarDiretoInline
              ownerId={ownerId}
              beneficiario={avBeneficiario}
              valor={avValor}
              dataPagamento={avData}
              onFeito={() => onGravado()}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Informe o valor pago para escolher o destino.</p>
          )}
        </div>
      )}
    </div>
  );
}

function LinhaBoleto({
  ownerId,
  linha,
  onChange,
  onFeito,
}: {
  ownerId: string | null;
  linha: Linha;
  onChange: (patch: Partial<Linha>) => void;
  onFeito: (status: LinhaStatus) => void;
}) {
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [verOutras, setVerOutras] = useState(false);
  const [tolerante, setTolerante] = useState(false);
  const [lancarDireto, setLancarDireto] = useState(false);

  const valorNum = parseBRL(linha.valor);

  const matchQuery = useQuery({
    queryKey: ["match-parcelas", ownerId, valorNum, linha.data_pagamento, tolerante],
    enabled: false,
    queryFn: async (): Promise<Candidato[]> => {
      const { data, error } = await supabase.rpc("match_installments_by_approx", {
        _owner: ownerId!,
        _valor: valorNum,
        _data: linha.data_pagamento,
        ...(tolerante ? { _tol_dias: 60, _tol_percent: 50 } : {}),
      });
      if (error) throw error;
      return (data ?? []) as unknown as Candidato[];
    },
  });

  const refetchMatch = matchQuery.refetch;
  const podeBuscar = !!ownerId && valorNum > 0 && !!linha.data_pagamento;
  const jaBuscouRef = useRef(false);
  useEffect(() => {
    if (jaBuscouRef.current) return;
    if (!podeBuscar) return;
    jaBuscouRef.current = true;
    void refetchMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (tolerante && podeBuscar) void refetchMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tolerante]);

  const candidatos = matchQuery.data ?? [];
  const escolhido = candidatos.find((c) => c.installment_id === selecionado) ?? candidatos[0] ?? null;
  const [gastoEscolhido, setGastoEscolhido] = useState<string | null>(null);
  const escolhidoId = escolhido?.installment_id ?? null;
  useEffect(() => {
    setGastoEscolhido(null);
  }, [escolhidoId]);

  const catEfetivaCandidato = escolhido
    ? escolhido.tipo_conta === "fornecedor"
      ? escolhido.subcategoria_id
      : escolhido.categoria_id
    : null;
  const expenseIdFinal = escolhido?.gasto_id ?? gastoEscolhido;

  const casarMut = useMutation({
    mutationFn: async () => {
      if (!ownerId || !escolhido) throw new Error("Nenhuma parcela selecionada.");
      if (!expenseIdFinal) throw new Error("Escolha o gasto.");
      const { error } = await supabase.rpc("pay_installment_to_planilha", {
        _owner: ownerId,
        _installment_id: escolhido.installment_id,
        _expense_id: expenseIdFinal,
        _pago_em: linha.data_pagamento,
        _valor_pago: valorNum,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Parcela baixada e lançada na Planilha.");
      onFeito("casada");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao casar a parcela."),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-1">
          <Label>Beneficiário</Label>
          <Input value={linha.beneficiario} onChange={(e) => onChange({ beneficiario: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Valor pago</Label>
          <Input
            value={linha.valor}
            onChange={(e) => onChange({ valor: e.target.value })}
            placeholder="0,00"
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Data do pagamento</Label>
          <Input
            type="date"
            value={linha.data_pagamento}
            onChange={(e) => onChange({ data_pagamento: e.target.value })}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void matchQuery.refetch()}>
          Buscar parcela
        </Button>
        {matchQuery.isFetching ? <span className="text-xs text-muted-foreground">Buscando...</span> : null}
      </div>

      {matchQuery.isFetching ? (
        <Skeleton className="h-20 w-full" />
      ) : !matchQuery.isFetched ? (
        <p className="text-xs text-muted-foreground">Clique em "Buscar parcela" para procurar.</p>
      ) : escolhido ? (
        <Card>
          <CardContent className="space-y-3 py-4">
            <div>
              <div className="text-sm text-foreground">
                Casar com: {escolhido.fornecedor_nome}
                {escolhido.numero_nota ? ` · NF ${escolhido.numero_nota}` : ""} · vence{" "}
                {formatDate(escolhido.vencimento)} · {formatBRL(Number(escolhido.valor || 0))}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {formatBRL(Math.abs(Number(escolhido.diff_valor || 0)))} de diferença ·{" "}
                {Math.abs(Number(escolhido.diff_dias || 0))} dia(s)
              </div>
            </div>

            {!escolhido.gasto_id ? (
              catEfetivaCandidato ? (
                <GastoInlinePicker
                  ownerId={ownerId}
                  categoriaId={catEfetivaCandidato}
                  value={gastoEscolhido}
                  onChange={setGastoEscolhido}
                />
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-amber-500">
                    Esta nota não tem fornecedor/categoria definidos. Use "Lançar direto na Planilha" ou defina o
                    destino em Notas e contas.
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setLancarDireto(true)} disabled={lancarDireto}>
                    Lançar direto na Planilha
                  </Button>
                  {lancarDireto ? (
                    <LancarDiretoInline
                      ownerId={ownerId}
                      beneficiario={linha.beneficiario}
                      valor={linha.valor}
                      dataPagamento={linha.data_pagamento}
                      onFeito={onFeito}
                    />
                  ) : null}
                </div>
              )
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!expenseIdFinal || casarMut.isPending} onClick={() => casarMut.mutate()}>
                {casarMut.isPending ? "Salvando..." : "Casar"}
              </Button>
              {candidatos.length > 1 ? (
                <Button size="sm" variant="outline" onClick={() => setVerOutras((v) => !v)}>
                  {verOutras ? "Ocultar outras" : "Ver outras"}
                </Button>
              ) : null}
            </div>
            {verOutras ? (
              <div className="max-h-52 space-y-1 overflow-y-auto overscroll-contain">
                {candidatos.map((c) => (
                  <button
                    key={c.installment_id}
                    type="button"
                    onClick={() => setSelecionado(c.installment_id)}
                    className={cn(
                      "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      escolhido.installment_id === c.installment_id
                        ? "border-primary bg-primary/10"
                        : "border-border/60 hover:bg-muted/50",
                    )}
                  >
                    <div className="truncate">
                      {c.fornecedor_nome}
                      {c.numero_nota ? ` · NF ${c.numero_nota}` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      vence {formatDate(c.vencimento)} · {formatBRL(Number(c.valor || 0))} ·{" "}
                      {formatBRL(Math.abs(Number(c.diff_valor || 0)))} dif · {Math.abs(Number(c.diff_dias || 0))} dia(s)
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-amber-500/30">
          <CardContent className="space-y-3 py-4">
            <p className="text-sm text-amber-500">Nenhuma parcela em aberto casa com este boleto.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setTolerante(true)} disabled={tolerante}>
                Escolher parcela manualmente
              </Button>
              <Button size="sm" variant="outline" onClick={() => setLancarDireto(true)} disabled={lancarDireto}>
                Lançar direto na Planilha
              </Button>
            </div>
            {tolerante ? (
              <p className="text-xs text-muted-foreground">
                Busca ampliada (60 dias / 50% de tolerância). Se ainda não aparecer nada, pule este boleto.
              </p>
            ) : null}
            {lancarDireto ? (
              <LancarDiretoInline
                ownerId={ownerId}
                beneficiario={linha.beneficiario}
                valor={linha.valor}
                dataPagamento={linha.data_pagamento}
                onFeito={onFeito}
              />
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function GastoInlinePicker({
  ownerId,
  categoriaId,
  value,
  onChange,
}: {
  ownerId: string | null;
  categoriaId: string;
  value: string | null;
  onChange: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [criando, setCriando] = useState(false);
  const [novoNome, setNovoNome] = useState("");

  const gastosQuery = useQuery({
    queryKey: ["gastos-subcategoria", categoriaId, ownerId],
    enabled: !!ownerId,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabase.rpc("list_gastos_da_subcategoria", {
        _owner: ownerId!,
        _subcategoria_id: categoriaId,
      });
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; name: string }[];
    },
  });

  const criarMut = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão inválida.");
      const nome = novoNome.trim();
      if (!nome) throw new Error("Informe o nome do gasto.");
      const { data, error } = await supabase.rpc("create_gasto", {
        _owner: ownerId,
        _categoria_id: categoriaId,
        _nome: nome,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["gastos-subcategoria", categoriaId, ownerId] });
      setCriando(false);
      setNovoNome("");
      onChange(id);
      toast.success("Gasto criado.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao criar o gasto."),
  });

  const gastos = gastosQuery.data ?? [];

  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3">
      <Label className="text-xs">Esta parcela não tem gasto definido — escolha onde lançar</Label>
      {gastosQuery.isLoading ? (
        <Skeleton className="h-9 w-full" />
      ) : gastos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum gasto nesta categoria ainda.</p>
      ) : (
        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto overscroll-contain">
          {gastos.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onChange(g.id)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-left text-sm transition-colors",
                value === g.id ? "border-primary bg-primary/10" : "border-border/60 hover:bg-muted/50",
              )}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}
      {criando ? (
        <div className="flex items-center gap-2">
          <Input
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            placeholder="Nome do gasto"
            className="h-8"
          />
          <Button size="sm" disabled={criarMut.isPending} onClick={() => criarMut.mutate()}>
            Criar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCriando(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setCriando(true)}>
          ＋ Novo gasto
        </Button>
      )}
    </div>
  );
}

function LancarDiretoInline({
  ownerId,
  beneficiario,
  valor,
  dataPagamento,
  onFeito,
}: {
  ownerId: string | null;
  beneficiario: string;
  valor: string;
  dataPagamento: string;
  onFeito: (status: LinhaStatus) => void;
}) {
  const [catId, setCatId] = useState<string | null>(null);
  const [fornId, setFornId] = useState<string | null>(null);
  const [gastoId, setGastoId] = useState<string | null>(null);
  const [buscaCat, setBuscaCat] = useState("");
  const [buscaForn, setBuscaForn] = useState(beneficiario ?? "");
  const [destino, setDestino] = useState<"ecommerce" | "locacao" | "rateio">("ecommerce");
  const [percentEcom, setPercentEcom] = useState("50");
  const qc = useQueryClient();
  const [criandoCat, setCriandoCat] = useState(false);
  const [novaCat, setNovaCat] = useState("");
  const [criandoForn, setCriandoForn] = useState(false);
  const [novoFornNome, setNovoFornNome] = useState("");
  const [novoFornCnpj, setNovoFornCnpj] = useState("");
  const [criandoGasto, setCriandoGasto] = useState(false);
  const [novoGasto, setNovoGasto] = useState("");

  const valorNum = parseBRL(valor);
  const pctNum = Math.min(100, Math.max(0, Number(percentEcom.replace(",", ".")) || 0));
  const parteEcom = destino === "rateio" ? (valorNum * pctNum) / 100 : destino === "ecommerce" ? valorNum : 0;
  const parteLoc = valorNum - parteEcom;

  const catQuery = useQuery({
    queryKey: ["categorias-arvore", ownerId],
    enabled: !!ownerId,
    staleTime: 60_000,
    queryFn: async (): Promise<CategoriaMini[]> => {
      const { data, error } = await supabase.rpc("list_categorias_arvore", { _owner: ownerId! });
      if (error) throw error;
      return (data ?? []) as unknown as CategoriaMini[];
    },
  });

  const fornQuery = useQuery({
    queryKey: ["fornecedores", ownerId],
    enabled: !!ownerId,
    staleTime: 60_000,
    queryFn: async (): Promise<{ id: string; name: string; cnpj: string | null }[]> => {
      const { data, error } = await supabase.rpc("list_fornecedores", { _owner: ownerId! });
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; name: string; cnpj: string | null }[];
    },
  });

  const cat = (catQuery.data ?? []).find((c) => c.id === catId) ?? null;
  const ehFornecedores = !!cat?.is_fornecedores;
  const categoriaEfetiva = ehFornecedores ? fornId : catId;

  const regraAplicadaRef = useRef(false);
  useEffect(() => {
    if (regraAplicadaRef.current) return;
    if (!ownerId || !beneficiario?.trim()) return;
    if (catId) return;
    const cats = catQuery.data;
    if (!cats || cats.length === 0) return;
    regraAplicadaRef.current = true;
    void (async () => {
      const { data, error } = await supabase.rpc("resolve_name_rule", {
        _owner: ownerId,
        _text: beneficiario,
      });
      if (error) return;
      const regra = ((data ?? []) as unknown as {
        expense_id: string | null;
        category_id: string | null;
        matched_text: string | null;
      }[])[0];
      if (!regra) return;

      let alvoId = regra.category_id ?? null;
      let gasto: string | null = regra.expense_id ?? null;
      if (gasto) {
        const { data: exp } = await supabase
          .from("expenses")
          .select("id, name, category_id")
          .eq("id", gasto)
          .maybeSingle();
        if (exp?.category_id) alvoId = exp.category_id as string;
      }
      if (!alvoId) return;

      const alvo = cats.find((c) => c.id === alvoId);
      if (!alvo) return;
      const pai = alvo.parent_id ? cats.find((c) => c.id === alvo.parent_id) : null;

      if (pai?.is_fornecedores) {
        setCatId(pai.id);
        setFornId(alvo.id);
        setBuscaForn(alvo.name ?? beneficiario);
      } else if (!pai) {
        setCatId(alvo.id);
        setFornId(null);
      } else {
        return;
      }
      setGastoId(gasto);
      toast.info("Destino sugerido pela regra — confira antes de lançar.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, beneficiario, catQuery.data]);

  const gastosQuery = useQuery({
    queryKey: ["gastos-subcategoria", categoriaEfetiva, ownerId],
    enabled: !!ownerId && !!categoriaEfetiva,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabase.rpc("list_gastos_da_subcategoria", {
        _owner: ownerId!,
        _subcategoria_id: categoriaEfetiva!,
      });
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; name: string }[];
    },
  });

  const topos = useMemo(() => {
    const t = buscaCat.trim().toLowerCase();
    const all = (catQuery.data ?? []).filter((c) => Number(c.nivel) === 0);
    return t ? all.filter((c) => (c.name ?? "").toLowerCase().includes(t)) : all;
  }, [catQuery.data, buscaCat]);

  const fornecedores = useMemo(() => {
    const t = buscaForn.trim().toLowerCase();
    const all = fornQuery.data ?? [];
    return t ? all.filter((f) => (f.name ?? "").toLowerCase().includes(t)) : all;
  }, [fornQuery.data, buscaForn]);

  const lancarMut = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão inválida.");
      if (!catId || !gastoId) throw new Error("Escolha a categoria e o gasto.");
      if (valorNum <= 0) throw new Error("Valor inválido.");

      const { data: nota, error: notaErr } = await supabase
        .from("payable_notes")
        .insert({
          owner_id: ownerId,
          chave_nfe: null,
          numero_nota: null,
          fornecedor_nome: beneficiario.trim() || "(avulso)",
          fornecedor_cnpj: null,
          data_emissao: dataPagamento,
          valor_total: valorNum,
          valor_produtos: null,
          valor_frete: 0,
          valor_outros: 0,
          ...(destino === "rateio"
            ? {
                destino: "rateio",
                ecommerce_mode: "percent",
                ecommerce_percent: pctNum,
                ecommerce_amount: 0,
              }
            : { destino }),
          categoria_id: catId,
          subcategoria_id: ehFornecedores ? fornId : null,
          gasto_id: gastoId,
          tipo_conta: ehFornecedores ? "fornecedor" : "geral",
        })
        .select("id")
        .single();
      if (notaErr) throw notaErr;

      const { data: parcela, error: parcErr } = await supabase
        .from("payable_installments")
        .insert({
          owner_id: ownerId,
          note_id: nota.id,
          numero: "001",
          vencimento: dataPagamento,
          valor: valorNum,
          status: "aberta",
        })
        .select("id")
        .single();
      if (parcErr) throw parcErr;

      const { error } = await supabase.rpc("pay_installment_to_planilha", {
        _owner: ownerId,
        _installment_id: parcela.id,
        _expense_id: gastoId,
        _pago_em: dataPagamento,
        _valor_pago: valorNum,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Conta criada e lançada na Planilha.");
      onFeito("lancada");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao lançar na Planilha."),
  });

  const criarCatMut = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão inválida.");
      const nome = novaCat.trim();
      if (!nome) throw new Error("Informe o nome da categoria.");
      const { data, error } = await supabase.rpc("create_categoria", { _owner: ownerId, _nome: nome });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["categorias-arvore", ownerId] });
      setCriandoCat(false);
      setNovaCat("");
      setCatId(id);
      setFornId(null);
      setGastoId(null);
      toast.success("Categoria criada.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao criar a categoria."),
  });

  const criarFornMut = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão inválida.");
      const nome = novoFornNome.trim();
      if (!nome) throw new Error("Informe o nome do fornecedor.");
      const digitos = novoFornCnpj.replace(/\D/g, "");
      const { data, error } = await supabase.rpc("create_fornecedor", {
        _owner: ownerId,
        _nome: nome,
        _cnpj: digitos || undefined,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["fornecedores", ownerId] });
      setCriandoForn(false);
      setNovoFornNome("");
      setNovoFornCnpj("");
      setFornId(id);
      setGastoId(null);
      toast.success("Fornecedor criado.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao criar o fornecedor."),
  });

  const criarGastoMut = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão inválida.");
      if (!categoriaEfetiva) throw new Error("Escolha a categoria primeiro.");
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
      qc.invalidateQueries({ queryKey: ["gastos-subcategoria", categoriaEfetiva, ownerId] });
      setCriandoGasto(false);
      setNovoGasto("");
      setGastoId(id);
      toast.success("Gasto criado.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao criar o gasto."),
  });


  return (
    <div className="space-y-3 rounded-md border border-border/60 p-3">
      <div className="space-y-1.5">
        <Label>Categoria</Label>
        <Input
          value={buscaCat}
          onChange={(e) => setBuscaCat(e.target.value)}
          placeholder="Buscar categoria"
          className="h-8"
        />
        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto overscroll-contain">
          {topos.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setCatId(c.id);
                setFornId(null);
                setGastoId(null);
              }}
              className={cn(
                "rounded-md border px-3 py-1.5 text-left text-sm transition-colors",
                catId === c.id ? "border-primary bg-primary/10" : "border-border/60 hover:bg-muted/50",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
        {criandoCat ? (
          <div className="flex items-center gap-2">
            <Input
              value={novaCat}
              onChange={(e) => setNovaCat(e.target.value)}
              placeholder="Nome da categoria"
              className="h-8"
            />
            <Button size="sm" disabled={criarCatMut.isPending} onClick={() => criarCatMut.mutate()}>
              Criar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCriandoCat(false)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setCriandoCat(true)}>
            ＋ Nova categoria
          </Button>
        )}
      </div>

      {ehFornecedores ? (
        <div className="space-y-1.5">
          <Label>Fornecedor</Label>
          <Input
            value={buscaForn}
            onChange={(e) => setBuscaForn(e.target.value)}
            placeholder="Buscar fornecedor"
            className="h-8"
          />
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto overscroll-contain">
            {fornecedores.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum fornecedor encontrado.</p>
            ) : (
              fornecedores.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setFornId(f.id);
                    setGastoId(null);
                  }}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-left text-sm transition-colors",
                    fornId === f.id ? "border-primary bg-primary/10" : "border-border/60 hover:bg-muted/50",
                  )}
                >
                  {f.name}
                </button>
              ))
            )}
          </div>
          {criandoForn ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={novoFornNome}
                onChange={(e) => setNovoFornNome(e.target.value)}
                placeholder="Nome do fornecedor"
                className="h-8 flex-1"
              />
              <Input
                value={novoFornCnpj}
                onChange={(e) => setNovoFornCnpj(e.target.value)}
                placeholder="CNPJ (opcional)"
                className="h-8 w-40"
              />
              <Button size="sm" disabled={criarFornMut.isPending} onClick={() => criarFornMut.mutate()}>
                Criar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCriandoForn(false)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setCriandoForn(true)}>
              ＋ Novo fornecedor
            </Button>
          )}
        </div>
      ) : null}

      {categoriaEfetiva ? (
        <div className="space-y-1.5">
          <Label>Gasto</Label>
          {gastosQuery.isLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : (gastosQuery.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum gasto nesta categoria ainda.</p>
          ) : (
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto overscroll-contain">
              {(gastosQuery.data ?? []).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGastoId(g.id)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-left text-sm transition-colors",
                    gastoId === g.id ? "border-primary bg-primary/10" : "border-border/60 hover:bg-muted/50",
                  )}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
          {criandoGasto ? (
            <div className="flex items-center gap-2">
              <Input
                value={novoGasto}
                onChange={(e) => setNovoGasto(e.target.value)}
                placeholder="Nome do gasto"
                className="h-8"
              />
              <Button size="sm" disabled={criarGastoMut.isPending} onClick={() => criarGastoMut.mutate()}>
                Criar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCriandoGasto(false)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setCriandoGasto(true)}>
              ＋ Novo gasto
            </Button>
          )}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label>Destino</Label>
        <div className="flex flex-wrap gap-1">
          {([
            ["ecommerce", "E-commerce"],
            ["locacao", "Locação"],
            ["rateio", "Ratear"],
          ] as const).map(([v, rotulo]) => (
            <button
              key={v}
              type="button"
              onClick={() => setDestino(v)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm transition-colors",
                destino === v ? "border-primary bg-primary/10" : "border-border/60 hover:bg-muted/50",
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>
        {destino === "rateio" ? (
          <div className="space-y-1.5 pt-1">
            <Label htmlFor="pct-ecom">% e-commerce</Label>
            <Input
              id="pct-ecom"
              type="number"
              min={0}
              max={100}
              value={percentEcom}
              onChange={(e) => setPercentEcom(e.target.value)}
              className="h-8 w-28"
            />
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground tabular-nums">
          E-commerce: {formatBRL(parteEcom)} · Locação: {formatBRL(parteLoc)}
        </p>
      </div>

      <Button size="sm" disabled={!gastoId || lancarMut.isPending} onClick={() => lancarMut.mutate()}>
        {lancarMut.isPending ? "Lançando..." : `Lançar ${formatBRL(valorNum)}`}
      </Button>
    </div>
  );
}

function PagarDialog({
  ownerId,
  item,
  onClose,
}: {
  ownerId: string | null;
  item: VencItem;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [pagoEm, setPagoEm] = useState<string>(todayISO());
  const [gastoId, setGastoId] = useState<string | null>(item.gasto_id ?? null);
  const [valorPago, setValorPago] = useState<string>(
    formatBRL(Number(item.valor || 0)).replace("R$", "").trim(),
  );
  const valorPagoNum = parseBRL(valorPago);

  const gastosQuery = useQuery({
    queryKey: ["gastos-subcategoria", item.categoria_efetiva_id, ownerId],
    enabled: !!ownerId && !!item.categoria_efetiva_id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_gastos_da_subcategoria", {
        _owner: ownerId!,
        _subcategoria_id: item.categoria_efetiva_id!,
      });
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; name: string }[];
    },
  });

  const gastos = gastosQuery.data ?? [];

  const payMut = useMutation({
    mutationFn: async () => {
      if (!ownerId || !gastoId) throw new Error("Selecione o gasto.");
      const { error } = await supabase.rpc("pay_installment_to_planilha", {
        _owner: ownerId,
        _installment_id: item.installment_id,
        _expense_id: gastoId,
        _pago_em: pagoEm,
        _valor_pago: valorPagoNum,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Baixa registrada e lançada na Planilha.");
      for (const key of [
        "vencimentos-dia",
        "payable-notes",
        "payable-notes-sub",
        "expense-sheet",
        "recorrencias",
        "meses-recorrencia",
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Não foi possível dar baixa.");
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dar baixa na parcela</DialogTitle>
          <DialogDescription>
            {item.fornecedor_nome} · {formatBRL(Number(item.valor || 0))} · vence {formatDate(item.vencimento)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="valor-pago">Valor pago</Label>
            <Input
              id="valor-pago"
              className="tabular-nums"
              value={valorPago}
              onChange={(e) => setValorPago(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Ajuste se pagou com juros/desconto.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pago-em">Data do pagamento</Label>
            <Input
              id="pago-em"
              type="date"
              value={pagoEm}
              onChange={(e) => setPagoEm(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Será lançado na Planilha no mês da data escolhida.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Gasto</Label>
            {gastosQuery.isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : gastos.length === 0 ? (
              <p className="text-sm text-amber-500">
                Nenhum gasto nesta categoria. Crie um em Contas a Pagar.
              </p>
            ) : (
              <div className="flex max-h-52 flex-col gap-1 overflow-y-auto overscroll-contain">
                {gastos.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGastoId(g.id)}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      gastoId === g.id
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/60 hover:bg-muted/50",
                    )}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => payMut.mutate()}
            disabled={!gastoId || gastos.length === 0 || valorPagoNum <= 0 || payMut.isPending}
          >
            {payMut.isPending ? "Salvando..." : "Confirmar baixa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
