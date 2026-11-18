// Comparação de segredo em tempo constante (seg-10): o tempo da resposta não diz quantos
// caracteres do palpite estavam certos. Compara o SHA-256 dos dois lados, que têm sempre o mesmo
// tamanho, byte a byte sem parar no primeiro diferente.
export async function segredoConfere(recebido: string | null | undefined, esperado: string | null | undefined): Promise<boolean> {
  if (!recebido || !esperado) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(recebido)),
    crypto.subtle.digest("SHA-256", enc.encode(esperado)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diferenca = 0;
  for (let i = 0; i < x.length; i++) diferenca |= x[i] ^ y[i];
  return diferenca === 0;
}

// Os ganchos agendados (pg_cron) mandam o segredo no cabeçalho x-cron-secret.
export function cronAutorizado(request: Request): Promise<boolean> {
  return segredoConfere(request.headers.get("x-cron-secret"), process.env.ML_CRON_SECRET);
}
