import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function AuditBanner({ accountIds }: { accountIds: string[] }) {
  const { data } = useQuery({
    queryKey: ["audit-banner", accountIds.join(",")],
    enabled: accountIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_findings")
        .select("id, severity, title")
        .in("account_id", accountIds)
        .in("status", ["aberto", "corrigindo"])
        .eq("severity", "critico")
        .limit(3);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 5 * 60 * 1000,
  });
  if (!data || data.length === 0) return null;
  return (
    <Card className="border-red-300 bg-red-50/60">
      <CardContent className="p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <AlertTriangle className="h-4 w-4 text-red-700 mt-0.5" />
          <div className="text-sm text-red-900 min-w-0">
            <div className="font-medium">Estas métricas podem estar incorretas.</div>
            <div className="text-xs opacity-90 truncate">
              {data.length} problema(s) crítico(s) detectado(s): {data.map((f) => (f as { title: string }).title).join(" · ")}
            </div>
          </div>
        </div>
        <Button asChild size="sm" variant="outline" className="border-red-300 text-red-800 hover:bg-red-100">
          <Link to="/configuracoes" search={{ aba: "auditoria" } as never}>Ver auditoria</Link>
        </Button>
      </CardContent>
    </Card>
  );
}