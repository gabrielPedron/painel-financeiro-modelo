import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { exigirTela } from "./equipe";

const entrada = z.object({
  account_id: z.string().uuid(),
  item_ids: z.array(z.string().regex(/^MLB\d+$/)).min(1).max(200),
});

/**
 * Lê no Mercado Livre o preço cheio e a promoção ativa dos anúncios da tela Ajuste de preço e grava a
 * leitura (ajuste_preco). Só lê o ML: nenhum preço da conta muda.
 */
export const lerPrecosAjuste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => entrada.parse(d))
  .handler(async ({ data, context }) => {
    await exigirTela(context.supabase, "ajuste-preco");
    const { data: dono, error } = await context.supabase.rpc("owns_account", { _account_id: data.account_id });
    if (error || dono !== true) throw new Error("Conta indisponível.");
    const { atualizarLeiturasDaConta } = await import("./ajuste-preco.server");
    return atualizarLeiturasDaConta(data.account_id, data.item_ids);
  });
