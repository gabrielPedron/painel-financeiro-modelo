// Cabeçalhos de proteção em toda resposta do Worker (seg-08). O principal: nenhum outro site pode
// embutir o Painel Financeiro num quadro (clickjacking). Os demais são o básico recomendado e não mudam
// nada na tela: o navegador não adivinha o tipo do arquivo, outro site não recebe o endereço
// completo da página, só HTTPS, e câmera, microfone e localização ficam bloqueados (nada usa).
const CABECALHOS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

// Não sobrescreve o que a resposta já trouxer.
export function comCabecalhosDeSeguranca(resposta: Response): Response {
  const r = new Response(resposta.body, resposta);
  for (const [nome, valor] of Object.entries(CABECALHOS)) {
    if (!r.headers.has(nome)) r.headers.set(nome, valor);
  }
  return r;
}
