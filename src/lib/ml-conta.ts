// Uma integração é de uma conta do ML só (sync-08): reconectar com outra conta misturaria os pedidos
// das duas no mesmo histórico. Integração nova (sem conta ainda) aceita qualquer uma.
export function mesmaContaDoMl(anterior: number | string | null | undefined, nova: number | string): boolean {
  return anterior == null || String(anterior) === String(nova);
}
