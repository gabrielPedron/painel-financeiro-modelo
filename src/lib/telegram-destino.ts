// Destino de uma mensagem do Telegram, como fica salvo em telegram_config.alert_chat_id:
//   "-1001234567890"      → o chat (ou o tópico Geral de um grupo com tópicos)
//   "-1001234567890:146"  → o tópico 146 de um grupo com tópicos
//   "@canal"              → um canal público pelo nome
// O número do tópico é o do link de uma mensagem dele: t.me/c/<grupo>/<tópico>/<mensagem>.

export type DestinoTelegram = { chat_id: string; message_thread_id?: number };

export function destinoTelegram(texto: string | null | undefined): DestinoTelegram | null {
  const t = (texto ?? "").replace(/\s+/g, "");
  const m = /^(-?\d+|@[A-Za-z0-9_]{5,})(?::(\d+))?$/.exec(t);
  if (!m) return null;
  const topico = m[2] ? Number(m[2]) : null;
  // O tópico Geral (1) não aceita message_thread_id: vai para o chat sem tópico.
  return topico && topico > 1 ? { chat_id: m[1], message_thread_id: topico } : { chat_id: m[1] };
}
