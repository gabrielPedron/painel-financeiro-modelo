// A busca de pagamentos do Mercado Pago traz também o que a própria conta pagou (compras,
// transferências). Só entra em mp_payments o que a conta recebeu: o recebedor é ela.
export function recebidoPelaConta(p: { collector_id?: number | string | null }, contaMl: number | string): boolean {
  return p.collector_id != null && String(p.collector_id) === String(contaMl);
}
