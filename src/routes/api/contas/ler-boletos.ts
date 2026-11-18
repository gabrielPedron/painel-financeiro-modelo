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
  'Você extrai uma lista de boletos/pagamentos de um print de tela de pagamento de banco brasileiro. Responda APENAS JSON no formato exato {"boletos":[{"beneficiario": string|null, "valor": number|null, "data_pagamento": string|null}]}. \'beneficiario\' é o nome de quem recebe (cedente/beneficiário). \'valor\' é o valor pago em reais como número com ponto decimal (ex.: 1234.56) — use o valor efetivamente pago (com juros/multa se houver). \'data_pagamento\' é a data do pagamento/agendamento no formato YYYY-MM-DD. Ignore cabeçalhos, saldos e totais. Máximo 100 boletos. Não invente dados; se um campo não aparecer, use null.';

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

export const Route = createFileRoute("/api/contas/ler-boletos")({
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
            return json({ ok: false, error: "Envie uma imagem ou um texto dos boletos." }, 400);
          }
          if (imagem && imageBase64TooLarge(imagem)) {
            return json({ ok: false, error: IMAGE_TOO_LARGE_MESSAGE }, 413);
          }

          const userContent = imagem
            ? [
                { type: "text", text: "Extraia a lista de boletos deste print." },
                {
                  type: "image_url",
                  image_url: {
                    url: imagem.startsWith("data:")
                      ? imagem
                      : `data:${body.mime_type || "image/jpeg"};base64,${imagem}`,
                  },
                },
              ]
            : `Extraia a lista de boletos deste texto:\n\n${texto}`;

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
              max_tokens: 2000,
              temperature: 0,
              response_format: { type: "json_object" },
            }),
          });

          if (!res.ok) {
            console.error("OpenAI ler boletos:", res.status, await res.text());
            return json({ ok: false, error: "Falha ao ler os boletos." }, 500);
          }

          const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
          const content = data.choices?.[0]?.message?.content ?? "";

          let parsed: Record<string, unknown> | null = null;
          try {
            parsed = JSON.parse(content) as Record<string, unknown>;
          } catch {
            parsed = null;
          }

          const lista = parsed && Array.isArray(parsed["boletos"]) ? (parsed["boletos"] as unknown[]) : null;
          if (!lista) {
            return json({ ok: true, boletos: [], aviso: "Não consegui interpretar." });
          }

          const boletos = lista.slice(0, 100).map((item) => {
            const o = (item ?? {}) as Record<string, unknown>;
            return {
              beneficiario: normalizaTexto(o["beneficiario"]),
              valor: normalizaValor(o["valor"]),
              data_pagamento: normalizaData(o["data_pagamento"]),
            };
          });

          return json({ ok: true, boletos });
        } catch (e) {
          console.error("Erro ao ler boletos:", e);
          return json({ ok: false, error: "Falha ao ler os boletos." }, 500);
        }
      },
    },
  },
});
