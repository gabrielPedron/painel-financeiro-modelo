import { useMemo, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format";

// Primeiro mês com vendas no banco. O corte em 2026-05 escondia março e abril (ui-05).
export const MIN_DATE = "2025-09-01";

export function toYMDSP(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function todaySP(): string {
  return toYMDSP(new Date());
}

export function clampFrom(v: string): string {
  return v < MIN_DATE ? MIN_DATE : v;
}

export type PresetKey = "mes" | "30d" | "3m" | "6m" | "12m" | "custom";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "mes", label: "Este mês" },
  { key: "30d", label: "Últimos 30 dias" },
  { key: "3m", label: "Últimos 3 meses" },
  { key: "6m", label: "Últimos 6 meses" },
  { key: "12m", label: "Últimos 12 meses" },
  { key: "custom", label: "Personalizada" },
];

function monthsBackFirstDay(n: number): string {
  const hoje = todaySP();
  const y = Number(hoje.slice(0, 4));
  const m = Number(hoje.slice(5, 7));
  const total = y * 12 + (m - 1) - n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

function daysBack(n: number): string {
  const base = new Date(`${todaySP()}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() - n);
  return base.toISOString().slice(0, 10);
}

export function rangeForPreset(preset: Exclude<PresetKey, "custom">): { from: string; to: string } {
  const to = todaySP();
  switch (preset) {
    case "mes":
      return { from: clampFrom(to.slice(0, 8) + "01"), to };
    case "30d":
      return { from: clampFrom(daysBack(29)), to };
    case "3m":
      return { from: clampFrom(monthsBackFirstDay(2)), to };
    case "6m":
      return { from: clampFrom(monthsBackFirstDay(5)), to };
    case "12m":
      return { from: clampFrom(monthsBackFirstDay(11)), to };
  }
}

export const DEFAULT_RANGE = rangeForPreset("mes");

function DatePicker({
  label,
  value,
  onChange,
  max,
  min,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: string;
  min?: string;
}) {
  const [open, setOpen] = useState(false);
  const date = useMemo(() => new Date(`${value}T00:00:00-03:00`), [value]);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 justify-start gap-2 bg-card px-3 text-xs font-normal hover:bg-card/80"
          >
            <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{formatDate(value)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" collisionPadding={12}>
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => {
              if (d) {
                onChange(toYMDSP(d));
                setOpen(false);
              }
            }}
            disabled={(d) => {
              const ymd = toYMDSP(d);
              if (max && ymd > max) return true;
              if (min && ymd < min) return true;
              return false;
            }}
            initialFocus
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export interface PeriodSelectorProps {
  from: string;
  to: string;
  onChange: (r: { from: string; to: string }) => void;
}

export function PeriodSelector({ from, to, onChange }: PeriodSelectorProps) {
  const [preset, setPreset] = useState<PresetKey>("mes");

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        value={preset}
        onValueChange={(v) => {
          const k = v as PresetKey;
          setPreset(k);
          if (k !== "custom") onChange(rangeForPreset(k));
        }}
      >
        <SelectTrigger className="h-8 w-[180px] bg-card text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => (
            <SelectItem key={p.key} value={p.key} className="text-xs">
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {preset === "custom" ? (
        <>
          <DatePicker
            label="De"
            value={from}
            onChange={(v) => onChange({ from: clampFrom(v), to })}
            max={to}
            min={MIN_DATE}
          />
          <DatePicker
            label="Até"
            value={to}
            onChange={(v) => onChange({ from, to: v })}
            max={todaySP()}
            min={MIN_DATE}
          />
        </>
      ) : (
        <span className="text-xs text-muted-foreground">
          {formatDate(from)} — {formatDate(to)}
        </span>
      )}

      <span className="w-full text-[10px] text-muted-foreground/70 sm:w-auto">
        Dados a partir de maio/2026.
      </span>
    </div>
  );
}
