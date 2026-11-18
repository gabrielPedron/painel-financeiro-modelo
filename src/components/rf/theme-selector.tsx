import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { applyTheme, getStoredTheme, setStoredTheme, type ThemeChoice } from "@/lib/theme";

const OPTIONS: { key: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { key: "light", label: "Claro", icon: Sun },
  { key: "dark", label: "Escuro", icon: Moon },
  { key: "system", label: "Sistema", icon: Monitor },
];

export function ThemeSelector() {
  const [theme, setTheme] = useState<ThemeChoice>("system");

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (getStoredTheme() === "system") applyTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const choose = (next: ThemeChoice) => {
    setTheme(next);
    setStoredTheme(next);
  };

  return (
    <div className="inline-flex gap-1 rounded-lg border border-border/60 bg-muted/40 p-1">
      {OPTIONS.map((o) => {
        const active = theme === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => choose(o.key)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-background border border-border/60 text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/60",
            )}
          >
            <o.icon className="h-4 w-4" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
