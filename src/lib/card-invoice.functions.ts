import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { donoDaEquipe } from "./equipe";

const input = z.object({
  base64: z.string().min(100),
  banco: z.string().min(1).default("BTG"),
  senha: z.string().optional(),
});

/** Importa a fatura de cartão (Excel BTG) e classifica os itens. */
export const importarFaturaCartao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data, context }) => {
    const { importBtgInvoice } = await import("./card-invoice.server");
    const ownerId = await donoDaEquipe(context.supabase);
    return await importBtgInvoice(
      context.supabase,
      ownerId,
      data.base64,
      data.banco,
      data.senha,
    );
  });

const decisao = z.object({
  itemId: z.string().uuid(),
  expenseId: z.string().uuid().nullable(),
  ignorar: z.boolean(),
  usarCobrado: z.boolean(),
  criarRegra: z.boolean(),
});

/** Lança uma fatura em uma única transação, com livro para desfazer. */
export const lancarFaturaCartao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    invoiceId: z.string().uuid(),
    decisions: z.array(decisao),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("card_invoice_post", {
      _invoice_id: data.invoiceId,
      _decisions: data.decisions,
    });
    if (error) throw new Error(error.message);
    return result as { totalLancado: number; itens: number };
  });

/** Desfaz somente se as células lançadas continuam como foram deixadas. */
export const desfazerFaturaCartao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ invoiceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("card_invoice_undo", {
      _invoice_id: data.invoiceId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
