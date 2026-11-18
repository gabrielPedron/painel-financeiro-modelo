import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { formatDate } from "@/lib/format";
import { useState } from "react";
import type { DateRange } from "react-day-picker";

export type PeriodKey = "hoje" | "ontem" | "7d" | "30d" | "90d" | "custom";

const OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "ontem", label: "Ontem" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "90d", label: "90 dias" },
  { key: "custom", label: "Personalizado" },
];

export interface PeriodFilterProps {
  value: PeriodKey;
  onChange: (v: PeriodKey) => void;
  customRange?: { from?: Date; to?: Date };
  onCustomRangeChange?: (r: { from?: Date; to?: Date }) => void;
  availableDates?: Set<string>;
  /** Adiciona a opção "Hoje" (usada só onde os dados do dia corrente existem). */
  includeToday?: boolean;
}

function toYMD(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function PeriodFilter({ value, onChange, customRange, onCustomRangeChange, availableDates, includeToday }: PeriodFilterProps) {
  const [open, setOpen] = useState(false);
  const options = includeToday ? [{ key: "hoje" as PeriodKey, label: "Hoje" }, ...OPTIONS] : OPTIONS;
  const sorted = availableDates ? Array.from(availableDates).sort() : [];
  const minStr = sorted[0];
  const maxStr = sorted[sorted.length - 1];

  const disabled = (date: Date) => {
    const ymd = toYMD(date);
    if (ymd > toYMD(new Date())) return true;
    if (availableDates && availableDates.size > 0 && !availableDates.has(ymd)) return true;
    return false;
  };

  const range: DateRange | undefined = customRange?.from ? { from: customRange.from, to: customRange.to } : undefined;

  const customLabel =
    value === "custom" && customRange?.from && customRange?.to
      ? `${formatDate(customRange.from)} — ${formatDate(customRange.to)}`
      : "Personalizado";

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className="inline-flex rounded-md border border-border bg-card/60 p-0.5">
        {options.map((opt) => {
          if (opt.key === "custom") {
            return (
              <Popover key={opt.key} open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn(
                      "h-7 px-3 text-xs font-medium",
                      value === "custom" && "bg-primary text-primary-foreground hover:bg-primary/90",
                    )}
                  >
                    {customLabel}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="range"
                    selected={range}
                    onSelect={(r) => {
                      onCustomRangeChange?.({ from: r?.from, to: r?.to });
                      if (r?.from) onChange("custom");
                      if (r?.from && r?.to) setOpen(false);
                    }}
                    disabled={disabled}
                    numberOfMonths={2}
                    className="p-3 pointer-events-auto"
                  />
                  {minStr && maxStr ? (
                    <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                      Dados disponíveis de {formatDate(minStr)} a {formatDate(maxStr)}
                    </div>
                  ) : (
                    <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                      Sem dados disponíveis
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            );
          }
          return (
            <Button
              key={opt.key}
              size="sm"
              variant="ghost"
              onClick={() => onChange(opt.key)}
              className={cn(
                "h-7 px-3 text-xs font-medium",
                value === opt.key && "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {opt.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}