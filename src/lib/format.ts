// Valor ausente (null, undefined, NaN) vira traço, nunca zero: zero parece um número
// verdadeiro (regra 6 do CONTEXTO-IA, ui-04). Quem quer zero passa 0.
const ausente = (value: number | null | undefined): value is null | undefined =>
  typeof value !== "number" || Number.isNaN(value);

export function formatBRL(value: number | null | undefined, opts?: { showSign?: boolean }): string {
  if (ausente(value)) return "—";
  const v = value;
  const formatted = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(v));
  if (opts?.showSign) {
    if (v > 0) return `+${formatted}`;
    if (v < 0) return `-${formatted}`;
  } else if (v < 0) {
    return `-${formatted}`;
  }
  return formatted;
}

export function formatNumber(value: number | null | undefined): string {
  if (ausente(value)) return "—";
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function formatBRLCompact(value: number | null | undefined): string {
  if (ausente(value)) return "—";
  const v = value;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs < 1000) {
    return `${sign}${abs.toFixed(0)}`;
  }
  const fmt = (n: number, suffix: string) => {
    const rounded = n < 10 ? n.toFixed(1) : n.toFixed(0);
    return `${sign}${rounded.replace(".", ",")}${suffix}`;
  };
  if (abs < 1_000_000) return fmt(abs / 1000, "k");
  if (abs < 1_000_000_000) return fmt(abs / 1_000_000, "M");
  return fmt(abs / 1_000_000_000, "B");
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (ausente(value)) return "—";
  return `${value.toFixed(digits).replace(".", ",")}%`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  // Data sem hora ("2026-09-17") é dia de calendário: new Date() a leria como
  // meia-noite UTC, que em São Paulo ainda é o dia anterior (ui-02).
  const dia = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (dia) return `${dia[3]}/${dia[2]}/${dia[1]}`;
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(d);
}

export function signClass(value: number): string {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-red-700";
  return "text-muted-foreground";
}