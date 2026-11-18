import { createFileRoute } from "@tanstack/react-router";
import { imageBase64TooLarge, IMAGE_TOO_LARGE_MESSAGE } from "@/lib/image-limit";

type Body = {
  access_token?: string;
  image_base64?: string;
  mime_type?: string;
  texto?: string;
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

const SYSTEM_PROMPT =
  'Você extrai dados de uma conta, boleto ou pedido de compra brasileiro. Responda APENAS um JSON válido, sem markdown, sem comentários, no formato exato: {"beneficiario": string|null, "valor": number|null, "vencimento": string|null, "itens": [{"descricao": string, "quantidade": number, "valor_unitario": number}]|null}. \'beneficiario\' é o nome de quem recebe o pagamento (cedente/beneficiário/fornecedor). \'valor\' é o valor total a pagar em reais como número (use ponto decimal, ex.: 1234.56). \'vencimento\' é a data de vencimento no formato YYYY-MM-DD. \'itens\' é a lista de produtos do pedido, cada um com descrição, quantidade e valor unitário em reais (ponto decimal). Se for um boleto simples sem lista de produtos, retorne itens: null ou []. Não invente itens; extraia só o que estiver visível. Se houver frete destacado no pedido, NÃO o inclua como item. Se algum campo não for encontrado, use null. Não invente dados.';

function normalizaValor(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const limpo = v.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
    const n = Number(limpo);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizaData(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

function normalizaTexto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

type ItemLido = { descricao: string; quantidade: number; valor_unitario: number };

function normalizaItens(v: unknown): ItemLido[] {
  if (!Array.isArray(v)) return [];
  const itens: ItemLido[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const descricao = normalizaTexto(o["descricao"]);
    const unit = normalizaValor(o["valor_unitario"]);
    if (!descricao || !unit || unit <= 0) continue;
    const qtd = normalizaValor(o["quantidade"]);
    itens.push({
      descricao,
      quantidade: qtd && qtd > 0 ? qtd : 1,
      valor_unitario: unit,
    });
  }
  return itens;
}

export const Route = createFileRoute("/api/contas/ler")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as Body;
          const token = body.access_token;
          if (!token) return json({ ok: false, error: "Sessão inválida." }, 401);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
          if (userErr || !userData?.user?.id) {
            return json({ ok: false, error: "Sessão inválida." }, 401);
          }

          const apiKey = process.env["OPENAI_API_KEY"];
          if (!apiKey) return json({ ok: false, error: "OPENAI_API_KEY ausente." }, 500);

          const imagem = (body.image_base64 || "").trim();
          const texto = (body.texto || "").trim();
          if (!imagem && !texto) {
            return json({ ok: false, error: "Envie uma imagem ou um texto da conta." }, 400);
          }
          if (imagem && imageBase64TooLarge(imagem)) {
            return json({ ok: false, error: IMAGE_TOO_LARGE_MESSAGE }, 413);
          }

          const userContent = imagem
            ? [
                { type: "text", text: "Extraia os dados desta conta." },
                {
                  type: "image_url",
                  image_url: {
                    url: imagem.startsWith("data:")
                      ? imagem
                      : `data:${body.mime_type || "image/jpeg"};base64,${imagem}`,
                  },
                },
              ]
            : `Extraia os dados desta conta:\n\n${texto}`;

          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userContent },
              ],
              max_tokens: 1500,
              temperature: 0,
              response_format: { type: "json_object" },
            }),
          });

          if (!res.ok) {
            console.error("OpenAI ler conta:", res.status, await res.text());
            return json({ ok: false, error: "Falha ao ler a conta." }, 500);
          }

          const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
          const content = data.choices?.[0]?.message?.content ?? "";

          let parsed: Record<string, unknown> | null = null;
          try {
            parsed = JSON.parse(content) as Record<string, unknown>;
          } catch {
            parsed = null;
          }
          if (!parsed) {
            return json({
              ok: true,
              dados: { beneficiario: null, valor: null, vencimento: null, itens: [] },
              aviso: "Não consegui interpretar.",
            });
          }

          return json({
            ok: true,
            dados: {
              beneficiario: normalizaTexto(parsed["beneficiario"]),
              valor: normalizaValor(parsed["valor"]),
              vencimento: normalizaData(parsed["vencimento"]),
              itens: normalizaItens(parsed["itens"]),
            },
          });
        } catch (e) {
          console.error("Erro ao ler conta:", e);
          return json({ ok: false, error: "Falha ao ler a conta." }, 500);
        }
      },
    },
  },
});
