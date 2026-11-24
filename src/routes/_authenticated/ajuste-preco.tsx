import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, RefreshCw, ShoppingCart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PeriodFilter, type PeriodKey } from "@/components/rf/period-filter";
import { EmptyState } from "@/components/rf/empty-state";
import { formatBRL, formatDate, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { lerPrecosAjuste } from "@/lib/ajuste-preco.functions";
import {
  FAIXA_FRETE, INTERVALO_DIAS, MARGEM_ALVO_PCT, MAX_PASSOS, MIN_UNIDADES, PASSO_PCT,
  avisoFaixaFrete, campanhaPropria, diaBR, etapa, inicioDaProgressao, progressao, somarDias,
  type Inicio, type Progressao,
} from "@/lib/ajuste-preco";

export const Route = createFileRoute("/_authenticated/ajuste-preco")({
  head: () => ({
    meta: [
      { title: "Ajuste de preço — Painel Financeiro" },
      { name: "description", content: "Aumento gradual do preço cheio até a margem mínima, por anúncio." },
    ],
  }),
  component: AjustePrecoPage,
});

type Account = { id: string; nickname: string; trade_name: string | null };

type Linha = {
  item_id: string;
  titulo: string;
  seller_sku: string | null;
  unidades: number;
  receita: number;
  margem: number;
  margem_pct: number | null;
  custo_faltando: boolean;
  preco_medio: number | null;
  pct_variavel: number | null;
  custo_un: number | null;
  frete_comprador_un: number | null;
  preco_alvo: number | null;
  motivo_sem_alvo: string | null;
  cheio_base: number | null;
  data_base: string | null;
  cheio_lido: number | null;
  cheio_alterado_em: string | null;
  promocao_preco: number | null;
  promocao_fim: string | null;
  promocao_campanha: string | null;
  lido_em: string | null;
  desconto_pct: number | null;
  cheio_alvo: number | null;
};

/** A leitura de preço do ML vale por 1 hora; depois disso, a tela lê de novo ao abrir. */
const LEITURA_VALE_MS = 60 * 60 * 1000;

const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

function periodo(period: PeriodKey, custom: { from?: Date; to?: Date }): { from: string; to: string; dias: number } {
  const hoje = diaBR(new Date());
  const ontem = somarDias(hoje, -1);
  if (period === "custom") {
    const from = custom.from ? diaBR(custom.from) : somarDias(ontem, -14);
    const to = custom.to ? diaBR(custom.to) : ontem;
    const dias = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
    return { from, to, dias };
  }
  const dias = period === "ontem" ? 1 : period === "7d" ? 7 : period === "90d" ? 90 : 30;
  return { from: somarDias(ontem, -(dias - 1)), to: ontem, dias };
}

const ddmm = (dia: string) => dia.split("-").reverse().slice(0, 2).join("/");
const ddmmaa = (dia: string) => dia.split("-").reverse().join("/");

const motivoInicio = (motivo: Inicio["motivo"], dias: number) =>
  motivo === "intervalo" ? `${dias} dias depois da última mudança do cheio` : "a partir de hoje";

function AjustePrecoPage() {
  const qc = useQueryClient();
  const lerPrecos = useServerFn(lerPrecosAjuste);
  const [period, setPeriod] = useState<PeriodKey>("custom");
  const [customRange, setCustomRange] = useState<{ from?: Date; to?: Date }>({});
  const [conta, setConta] = useState<string | null>(null);
  const [margemAlvo, setMargemAlvo] = useState(String(MARGEM_ALVO_PCT));
  const [passoPct, setPassoPct] = useState(String(PASSO_PCT));
  const [intervalo, setIntervalo] = useState(String(INTERVALO_DIAS));
  const [aberto, setAberto] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const tentou = useRef<string | null>(null);

  const { data: accounts } = useQuery({
    queryKey: ["accounts-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketplace_accounts")
        .select("id, nickname, trade_name")
        .eq("platform", "mercado_livre")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });
  const contaId = conta ?? accounts?.[0]?.id ?? null;
  const displayName = (a: Account) => a.trade_name?.trim() || a.nickname;

  const { from, to, dias } = useMemo(() => periodo(period, customRange), [period, customRange]);
  const margem = Math.min(49, Math.max(0.5, num(margemAlvo.replace(",", ".")) ?? MARGEM_ALVO_PCT));
  const passo = Math.min(10, Math.max(0.1, num(passoPct.replace(",", ".")) ?? PASSO_PCT));
  const intervaloDias = Math.min(90, Math.max(1, Math.round(num(intervalo) ?? INTERVALO_DIAS)));
  const hoje = diaBR(new Date());

  const chave = ["ajuste-preco", contaId, from, to, margem];
  const { data: linhas, isPending, error } = useQuery({
    queryKey: chave,
    enabled: !!contaId,
    queryFn: async () => {
      const { data, error: err } = await supabase.rpc("anuncios_preco_alvo", {
        _account_ids: [contaId!], _from: from, _to: to, _margem_alvo: margem,
      });
      if (err) throw err;
      return (data ?? []).map((r): Linha => ({
        item_id: r.item_id,
        titulo: r.titulo ?? r.item_id,
        seller_sku: r.seller_sku ?? null,
        unidades: Number(r.unidades) || 0,
        receita: Number(r.receita) || 0,
        margem: Number(r.margem) || 0,
        margem_pct: num(r.margem_pct),
        custo_faltando: !!r.custo_faltando,
        preco_medio: num(r.preco_medio),
        pct_variavel: num(r.pct_variavel),
        custo_un: num(r.custo_un),
        frete_comprador_un: num(r.frete_comprador_un),
        preco_alvo: num(r.preco_alvo),
        motivo_sem_alvo: r.motivo_sem_alvo ?? null,
        cheio_base: num(r.cheio_base),
        data_base: r.data_base ?? null,
        cheio_lido: num(r.cheio_lido),
        cheio_alterado_em: r.cheio_alterado_em ?? null,
        promocao_preco: num(r.promocao_preco),
        promocao_fim: r.promocao_fim ?? null,
        promocao_campanha: r.promocao_campanha ?? null,
        lido_em: r.lido_em ?? null,
        desconto_pct: num(r.desconto_pct),
        cheio_alvo: num(r.cheio_alvo),
      }));
    },
  });

  const lidoMaisAntigo = useMemo(() => {
    if (!linhas?.length) return null;
    const tempos = linhas.map((l) => (l.lido_em ? Date.parse(l.lido_em) : 0));
    return Math.min(...tempos);
  }, [linhas]);

  const lerAgora = async (automatico: boolean) => {
    if (!contaId || !linhas?.length) return;
    setLendo(true);
    try {
      const r = await lerPrecos({ data: { account_id: contaId, item_ids: linhas.map((l) => l.item_id) } });
      if (r.falhas.length) toast.warning(`Sem leitura do ML para ${r.falhas.length} anúncio(s): ${r.falhas.slice(0, 5).join(", ")}`);
      else if (!automatico) toast.success(`Preços de ${r.lidos} anúncio(s) lidos no ML.`);
      await qc.invalidateQueries({ queryKey: ["ajuste-preco", contaId] });
    } catch (e) {
      toast.error(`Não foi possível ler os preços no ML: ${(e as Error).message}`);
    } finally {
      setLendo(false);
    }
  };

  // Ao abrir (e ao trocar de conta ou período), lê de novo no ML se a leitura passou de 1 hora.
  useEffect(() => {
    if (!contaId || !linhas?.length || lendo || lidoMaisAntigo == null) return;
    const marca = `${contaId}|${from}|${to}`;
    if (tentou.current === marca) return;
    if (Date.now() - lidoMaisAntigo < LEITURA_VALE_MS) return;
    tentou.current = marca;
    void lerAgora(true);
    // lerAgora muda a cada render; a marca evita repetir a leitura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contaId, from, to, linhas, lidoMaisAntigo, lendo]);

  const hasAccounts = (accounts?.length ?? 0) > 0;

  return (
    <div className="p-6 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-primary">Ajuste de preço</h1>
          <p className="text-sm text-muted-foreground">
            Aumento gradual do preço cheio até a margem mínima, por anúncio
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-col items-end gap-1">
            <PeriodFilter value={period} onChange={setPeriod} customRange={customRange} onCustomRangeChange={setCustomRange} />
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {ddmmaa(from)} a {ddmmaa(to)} · {dias} {dias === 1 ? "dia" : "dias"}
            </p>
          </div>
          {hasAccounts ? (
            <Select value={contaId ?? undefined} onValueChange={setConta}>
              <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Conta" /></SelectTrigger>
              <SelectContent>
                {accounts?.map((a) => (<SelectItem key={a.id} value={a.id}>{displayName(a)}</SelectItem>))}
              </SelectContent>
            </Select>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void lerAgora(false)} disabled={lendo || !linhas?.length}>
            <RefreshCw className={cn("mr-2 h-4 w-4", lendo && "animate-spin")} /> Ler preços do ML
          </Button>
        </div>
      </header>

      {!hasAccounts && accounts ? (
        <EmptyState
          icon={ShoppingCart}
          title="Nenhuma conta do Mercado Livre conectada."
          description="Conecte uma conta para ver o ajuste de preço por anúncio."
          action={
            <Button asChild size="sm">
              <Link to="/configuracoes" search={{ aba: "integracoes" }}>Ir para Integrações</Link>
            </Button>
          }
        />
      ) : (
        <>
          <Card className="border-border/60 bg-card/60">
            <CardContent className="flex flex-wrap items-end gap-4 p-4 text-xs">
              <Campo rotulo="Margem mínima (% da receita)" valor={margemAlvo} onChange={setMargemAlvo} />
              <Campo rotulo="Passo máximo (% do cheio)" valor={passoPct} onChange={setPassoPct} />
              <Campo rotulo="Dias entre passos" valor={intervalo} onChange={setIntervalo} />
              <p className="min-w-[280px] flex-1 text-muted-foreground">
                <strong className="text-foreground">Estimativa, refeita a cada período.</strong> O preço-alvo é o preço praticado
                em que a margem do anúncio chega a {formatPercent(margem, 1)}, com o que o período mostra: comissão, imposto e
                Ads como % do preço; CMV, frete e rateio dos custos do período por unidade; o frete pago pelo comprador fixo
                por unidade. O cheio-alvo aplica o desconto da promoção ativa. Cada passo sobe até {formatPercent(passo, 1)} do
                cheio, arredondado para baixo no centavo, um a cada {intervaloDias} dias contados da última mudança do
                cheio, mesmo com campanha própria ativa: o preço da promoção fica como está na central de promoções.
                {lidoMaisAntigo ? <> Preços do ML lidos em {formatDateTime(new Date(lidoMaisAntigo))}.</> : null}
              </p>
            </CardContent>
          </Card>

          {error ? (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="space-y-1 p-4 text-sm">
                <p className="font-medium text-destructive">Não foi possível calcular o preço-alvo.</p>
                <p className="text-xs text-muted-foreground break-all">{(error as Error).message}</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/60 bg-card/60">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_tr]:border-b">
                      <TableRow className="border-b bg-card text-[11px] uppercase tracking-wider text-muted-foreground hover:bg-card">
                        <TableHead className="w-6"></TableHead>
                        <TableHead>Anúncio</TableHead>
                        <TableHead className="text-right">Un.</TableHead>
                        <TableHead className="text-right whitespace-nowrap" title="Preço standard do anúncio, lido no ML">Cheio hoje</TableHead>
                        <TableHead className="text-right" title="Preço da promoção ativa no marketplace e o desconto sobre o cheio">Promoção</TableHead>
                        <TableHead className="text-right whitespace-nowrap" title="Valor do produto ÷ unidades, sem o frete pago pelo comprador">Preço médio</TableHead>
                        <TableHead className="text-right whitespace-nowrap" title="Margem ÷ receita no período">Margem</TableHead>
                        <TableHead className="text-right whitespace-nowrap" title="Preço praticado em que a margem chega à mínima">Preço-alvo</TableHead>
                        <TableHead className="text-right whitespace-nowrap" title="Preço-alvo com o desconto da promoção ativa">Cheio-alvo</TableHead>
                        <TableHead className="whitespace-nowrap" title="Passos de aumento entre o cheio-base e o cheio de hoje">Etapa</TableHead>
                        <TableHead className="whitespace-nowrap">Próximo passo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isPending || !contaId
                        ? Array.from({ length: 6 }).map((_, i) => (
                            <TableRow key={i}><TableCell colSpan={11}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                          ))
                        : (linhas ?? []).length === 0
                          ? (
                              <TableRow>
                                <TableCell colSpan={11} className="py-10 text-center text-sm text-muted-foreground">
                                  Nenhuma venda no período.
                                </TableCell>
                              </TableRow>
                            )
                          : (linhas ?? []).map((l) => (
                              <LinhaAnuncio
                                key={l.item_id}
                                l={l}
                                hoje={hoje}
                                passo={passo}
                                intervaloDias={intervaloDias}
                                aberto={aberto === l.item_id}
                                alternar={() => setAberto(aberto === l.item_id ? null : l.item_id)}
                              />
                            ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Campo({ rotulo, valor, onChange }: { rotulo: string; valor: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-muted-foreground">
      {rotulo}
      <Input value={valor} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className="h-8 w-28 text-xs tabular-nums" />
    </label>
  );
}

function LinhaAnuncio({ l, hoje, passo, intervaloDias, aberto, alternar }: {
  l: Linha; hoje: string; passo: number; intervaloDias: number; aberto: boolean; alternar: () => void;
}) {
  const cheioHoje = l.cheio_lido;
  const inicio = inicioDaProgressao({ hoje, cheioAlteradoEm: l.cheio_alterado_em, intervaloDias });
  const prog: Progressao = cheioHoje
    ? progressao({ cheioAtual: cheioHoje, cheioAlvo: l.cheio_alvo, inicio: inicio.data, passoPct: passo, intervaloDias })
    : { passos: [], incompleta: false };
  const et = l.cheio_base && cheioHoje ? etapa(l.cheio_base, cheioHoje, passo) : null;
  const aviso = avisoFaixaFrete([[l.preco_medio, l.preco_alvo], [cheioHoje, l.cheio_alvo]]);
  const fraca = l.unidades < MIN_UNIDADES;
  const naMargem = l.preco_alvo != null && l.preco_medio != null && l.preco_alvo <= l.preco_medio;
  const margemClass = l.custo_faltando ? "text-muted-foreground"
    : (l.margem_pct ?? 0) < 0 ? "text-red-600"
      : naMargem ? "text-emerald-600" : "text-amber-500";

  return (
    <Fragment>
      <TableRow onClick={alternar} className="cursor-pointer hover:bg-muted/30">
        <TableCell className="text-muted-foreground">
          {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell className="max-w-[300px]">
          <p className="line-clamp-2 text-sm">{l.titulo}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <a
              href={`https://produto.mercadolivre.com.br/${l.item_id.replace(/^MLB/, "MLB-")}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              {l.item_id}<ExternalLink className="h-3 w-3" />
            </a>
            <span>SKU: {l.seller_sku || "—"}</span>
          </div>
          {fraca || aviso || l.motivo_sem_alvo || !l.lido_em ? (
            <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-amber-500">
              {l.motivo_sem_alvo ? <span>Sem alvo: {l.motivo_sem_alvo}.</span> : null}
              {fraca && !l.motivo_sem_alvo ? <span>Só {l.unidades} un. no período: estimativa fraca.</span> : null}
              {aviso ? <span className="inline-flex items-start gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />Cruza R$ {FAIXA_FRETE}: o frete muda.</span> : null}
              {!l.lido_em ? <span>Preço do ML ainda não lido.</span> : null}
            </div>
          ) : null}
        </TableCell>
        <TableCell className="text-right tabular-nums">{formatNumber(l.unidades)}</TableCell>
        <TableCell className="text-right tabular-nums">{formatBRL(cheioHoje)}</TableCell>
        <TableCell className="text-right tabular-nums">
          {l.promocao_preco != null ? (
            <div>
              <div>{formatBRL(l.promocao_preco)}</div>
              <div className="text-[11px] text-muted-foreground">
                −{formatPercent(l.desconto_pct, 1)}
                {l.promocao_fim ? ` · até ${ddmm(diaBR(l.promocao_fim))}` : ""}
                {campanhaPropria(l.promocao_campanha) ? " · própria" : ""}
              </div>
            </div>
          ) : l.lido_em ? <span className="text-muted-foreground">sem</span> : "—"}
        </TableCell>
        <TableCell className="text-right tabular-nums">{formatBRL(l.preco_medio)}</TableCell>
        <TableCell className={cn("text-right tabular-nums", margemClass)}>
          {l.custo_faltando ? "—" : formatPercent(l.margem_pct, 1)}
        </TableCell>
        <TableCell className="text-right tabular-nums font-medium">{formatBRL(l.preco_alvo)}</TableCell>
        <TableCell className="text-right tabular-nums font-medium">{formatBRL(l.cheio_alvo)}</TableCell>
        <TableCell className="whitespace-nowrap text-xs">
          {et == null ? "—" : et.abaixoDaBase ? (
            <span className="text-amber-500">abaixo da base</span>
          ) : (
            <span>
              {et.passos} {et.passos === 1 ? "passo" : "passos"}{et.parcial ? " e uma parte" : ""}
              {prog.passos.length > 0 ? <span className="text-muted-foreground"> · faltam {prog.passos.length}{prog.incompleta ? "+" : ""}</span> : null}
            </span>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap text-xs tabular-nums">
          {naMargem ? <span className="text-emerald-600">na margem</span>
            : prog.passos[0] ? <>{ddmm(prog.passos[0].data)} · {formatBRL(prog.passos[0].para)}</> : "—"}
        </TableCell>
      </TableRow>
      {aberto ? (
        <TableRow className="bg-muted/10 hover:bg-muted/10">
          <TableCell></TableCell>
          <TableCell colSpan={10} className="py-3">
            <Detalhe l={l} prog={prog} inicio={inicio} aviso={aviso} passo={passo} intervaloDias={intervaloDias} etapaBase={et} />
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
}

function Detalhe({ l, prog, inicio, aviso, passo, intervaloDias, etapaBase }: {
  l: Linha; prog: Progressao; inicio: Inicio; aviso: string | null; passo: number;
  intervaloDias: number; etapaBase: ReturnType<typeof etapa> | null;
}) {
  return (
    <div className="space-y-3 text-xs">
      <div className="grid gap-x-6 gap-y-1 text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
        <span>Comissão + imposto + Ads: <b className="text-foreground">{formatPercent(l.pct_variavel, 1)}</b> do preço</span>
        <span>CMV + frete + rateio: <b className="text-foreground">{formatBRL(l.custo_un)}</b> por unidade</span>
        <span>Frete pago pelo comprador: <b className="text-foreground">{formatBRL(l.frete_comprador_un)}</b> por unidade</span>
        <span>
          Cheio-base: <b className="text-foreground">{formatBRL(l.cheio_base)}</b>
          {l.data_base ? ` em ${formatDate(l.data_base)}` : ""}
          {etapaBase && !etapaBase.abaixoDaBase ? ` · etapa ${etapaBase.passos}${etapaBase.parcial ? "+" : ""}` : ""}
        </span>
        <span>
          Última mudança do cheio: <b className="text-foreground">{l.cheio_alterado_em ? formatDate(l.cheio_alterado_em) : "—"}</b>
        </span>
        <span>
          Promoção: <b className="text-foreground">
            {l.promocao_preco != null
              ? `${campanhaPropria(l.promocao_campanha) ? "campanha própria" : "promoção do ML"}${l.promocao_campanha ? ` (${l.promocao_campanha})` : ""}`
              : "nenhuma ativa"}
          </b>
        </span>
      </div>
      {aviso ? (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{aviso}
        </p>
      ) : null}
      {l.preco_alvo == null ? (
        <p className="text-muted-foreground">Sem preço-alvo: {l.motivo_sem_alvo ?? "dados insuficientes"}.</p>
      ) : prog.passos.length === 0 ? (
        <p className="text-muted-foreground">
          {l.cheio_alvo == null
            ? "Sem leitura do preço no ML: use “Ler preços do ML”."
            : `O cheio de hoje já está no cheio-alvo (${formatBRL(l.cheio_alvo)}): nenhum passo.`}
        </p>
      ) : (
        <div className="space-y-1">
          <p className="text-muted-foreground">
            Progressão prevista, {motivoInicio(inicio.motivo, intervaloDias)}: do cheio de {formatBRL(l.cheio_lido)} ao cheio-alvo de{" "}
            {formatBRL(l.cheio_alvo)}, até {formatPercent(passo, 1)} por passo.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full max-w-[640px] text-left tabular-nums">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Passo</th>
                  <th className="py-1 pr-3">Data prevista</th>
                  <th className="py-1 pr-3 text-right">Cheio</th>
                  <th className="py-1 pr-3 text-right">Aumento</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {prog.passos.map((p) => (
                  <tr key={p.n} className="border-t border-border/40">
                    <td className="py-1 pr-3">{p.n}</td>
                    <td className="py-1 pr-3">{formatDate(p.data)}</td>
                    <td className="py-1 pr-3 text-right">{formatBRL(p.de)} → <b>{formatBRL(p.para)}</b></td>
                    <td className="py-1 pr-3 text-right">+{formatPercent(p.pct, 2)}</td>
                    <td className="py-1 text-[11px] text-amber-500">
                      {p.cruzaFaixaFrete ? `cruza R$ ${FAIXA_FRETE}` : p.ultimo ? <span className="text-emerald-600">alvo</span> : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {prog.incompleta ? (
            <p className="text-amber-500">Parou em {MAX_PASSOS} passos sem chegar ao alvo: o alvo está longe demais para esta progressão.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
