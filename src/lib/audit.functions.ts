import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { donoDaEquipe, exigirTela } from "./equipe";

// Roda a auditoria de todos os donos: só quem tem a aba Auditoria (seg-05).
export const runAuditNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirTela(context.supabase, "configuracoes:auditoria");
    const { runAudit } = await import("./audit.server");
    return await runAudit();
  });

const idInput = z.object({ finding_id: z.string().uuid() });

export const ignoreFinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data, context }) => {
    await exigirTela(context.supabase, "configuracoes:auditoria");
    const { error } = await context.supabase
      .from("audit_findings")
      .update({ status: "ignorado" })
      .eq("id", data.finding_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reopenFinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data, context }) => {
    await exigirTela(context.supabase, "configuracoes:auditoria");
    const { error } = await context.supabase
      .from("audit_findings")
      .update({ status: "aberto", resolved_at: null })
      .eq("id", data.finding_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const autoFixFinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data, context }) => {
    await exigirTela(context.supabase, "configuracoes:auditoria");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: f, error } = await supabaseAdmin
      .from("audit_findings").select("*").eq("id", data.finding_id).maybeSingle();
    if (error || !f) throw new Error("Achado não encontrado.");
    // Achado é da equipe: membro também corrige (aud-08).
    if (f.owner_id !== (await donoDaEquipe(context.supabase))) throw new Error("Sem permissão.");
    if (!f.auto_fixable) throw new Error("Este achado não é corrigível automaticamente.");
    const {
      enqueueAdsJobs, enqueueVisitsJobs, enqueueBillingJobs, enqueueOrdersJobs,
    } = await import("./ml-sync.server");
    const ctx = (f.context ?? {}) as Record<string, unknown>;
    switch (f.check_code) {
      case "orders_completeness":
      case "orders_without_items":
      case "null_sale_fee": {
        const from = String(ctx.from ?? "");
        const to = String(ctx.to ?? "");
        if (!from || !to) throw new Error("Contexto insuficiente.");
        await enqueueOrdersJobs(f.account_id!, f.owner_id!, from, to);
        break;
      }
      case "billing_completeness": {
        const key = String(ctx.period_key ?? "");
        if (!key) throw new Error("period_key ausente.");
        await enqueueBillingJobs(f.account_id!, f.owner_id!, [key]);
        break;
      }
      // missing_sample vem em ordem crescente: de = primeiro, até = último (aud-05).
      case "ads_days_missing": {
        const sample = (ctx.missing_sample as string[]) ?? [];
        if (sample.length === 0) throw new Error("Sem dias faltantes.");
        const from = sample[0];
        const to = sample[sample.length - 1];
        await enqueueAdsJobs(f.account_id!, f.owner_id!, from, to);
        break;
      }
      case "visits_days_missing": {
        const sample = (ctx.missing_sample as string[]) ?? [];
        if (sample.length === 0) throw new Error("Sem dias faltantes.");
        const from = sample[0];
        const to = sample[sample.length - 1];
        await enqueueVisitsJobs(f.account_id!, f.owner_id!, from, to);
        break;
      }
      default:
        throw new Error(`Sem correção automática para "${f.check_code}".`);
    }
    await supabaseAdmin
      .from("audit_findings")
      .update({ status: "corrigindo" })
      .eq("id", f.id);
    return { ok: true };
  });

const classifyInput = z.object({
  sub_type: z.string().min(1).max(64),
  category: z.enum([
    "comissao",
    "parcelamento",
    "frete",
    "full",
    "ads",
    "estorno",
    "financiamento",
    "outros",
  ]),
  label: z.string().max(200).optional().nullable(),
  // Por pedido entra na Conciliação, venda a venda; do período entra nos custos do período (aud-04).
  escopo: z.enum(["pedido", "periodo"]),
  conta_no_custo: z.boolean(),
});

export const classifySubtype = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => classifyInput.parse(d))
  .handler(async ({ data, context }) => {
    // O mapa de tarifas é global e muda a margem de todos: só quem tem a aba Regras (seg-05).
    await exigirTela(context.supabase, "configuracoes:regras");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("billing_subtype_map")
      .upsert(
        {
          sub_type: data.sub_type,
          category: data.category,
          label: data.label ?? null,
          escopo: data.escopo,
          conta_no_custo: data.conta_no_custo,
        } as never,
        { onConflict: "sub_type" },
      );
    if (error) throw new Error(error.message);
    // Resolve os achados abertos deste sub_type.
    await supabaseAdmin
      .from("audit_findings")
      .update({ status: "resolvido", resolved_at: new Date().toISOString() })
      .eq("check_code", "unclassified_subtype")
      .in("status", ["aberto", "corrigindo"])
      .contains("context", { sub_type: data.sub_type } as never);
    return { ok: true };
  });