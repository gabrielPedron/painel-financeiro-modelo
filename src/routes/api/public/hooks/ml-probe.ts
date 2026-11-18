import { createFileRoute } from "@tanstack/react-router";
import { cronAutorizado } from "@/lib/segredo";

type Body = { account_id?: string } | null;
type Probe = { name: string; url: string; status?: number; body?: unknown; error?: string };

async function probe(name: string, url: string, headers: Record<string, string>): Promise<Probe> {
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep as text
    }
    let body: unknown = parsed;
    if (typeof parsed === "string" && parsed.length > 4000) {
      body = parsed.slice(0, 4000) + "...[truncated]";
    } else {
      const serialized = JSON.stringify(parsed);
      if (serialized && serialized.length > 4000) {
        body = serialized.slice(0, 4000) + "...[truncated]";
      }
    }
    return { name, url, status: res.status, body };
  } catch (e) {
    return { name, url, error: (e as Error).message };
  }
}

function isoDaysAgo(days: number, endOfDay = false): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  if (endOfDay) {
    d.setUTCHours(23, 59, 59, 0);
  } else {
    d.setUTCHours(0, 0, 0, 0);
  }
  return d.toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export const Route = createFileRoute("/api/public/hooks/ml-probe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await cronAutorizado(request))) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin, readVaultSecret } = await import("@/lib/ml-oauth.server");

        let body: Body = null;
        try {
          const text = await request.text();
          body = text ? (JSON.parse(text) as Body) : null;
        } catch {
          body = null;
        }

        const base = supabaseAdmin
          .from("marketplace_accounts")
          .select("id, access_token_id, external_user_id, advertiser_id, status");
        const { data: accounts, error } = await (body?.account_id
          ? base.eq("id", body.account_id).limit(1)
          : base.eq("status", "conectada").not("access_token_id", "is", null).limit(1));
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        const account = accounts?.[0];
        if (!account || !account.access_token_id) {
          return Response.json({ ok: false, error: "conta conectada não encontrada" }, { status: 404 });
        }
        const accessToken = await readVaultSecret(account.access_token_id);
        if (!accessToken) {
          return Response.json({ ok: false, error: "access token não encontrado no Vault" }, { status: 404 });
        }

        const auth = { Authorization: `Bearer ${accessToken}` };
        const authV2 = { ...auth, "api-version": "2", "Api-Version": "2" };
        const probes: Probe[] = [];

        // 1. periods
        const periodsUrl =
          "https://api.mercadolibre.com/billing/integration/monthly/periods?group=ML&document_type=BILL";
        const periodsProbe = await probe("periods", periodsUrl, auth);
        probes.push(periodsProbe);

        // extract key
        let key: string | null = null;
        const pb = periodsProbe.body as { results?: Array<{ key?: string }> } | undefined;
        if (pb && Array.isArray(pb.results) && pb.results[0]?.key) {
          key = pb.results[0].key!;
        }

        if (key) {
          // 2. period details
          probes.push(
            await probe(
              "period_details",
              `https://api.mercadolibre.com/billing/integration/periods/key/${key}/group/ML/full/details?document_type=BILL&limit=5`,
              auth,
            ),
          );
          // 3. summary
          probes.push(
            await probe(
              "period_summary",
              `https://api.mercadolibre.com/billing/integration/periods/key/${key}/group/ML/summary`,
              auth,
            ),
          );
        } else {
          probes.push({ name: "period_details", url: "(skipped: no key)", error: "no period key" });
          probes.push({ name: "period_summary", url: "(skipped: no key)", error: "no period key" });
        }

        // 4. orders
        if (account.external_user_id) {
          const from = isoDaysAgo(30, false);
          const to = isoDaysAgo(1, true);
          probes.push(
            await probe(
              "orders",
              `https://api.mercadolibre.com/orders/search?seller=${account.external_user_id}&order.date_created.from=${from}&order.date_created.to=${to}&limit=3&sort=date_desc`,
              auth,
            ),
          );
        } else {
          probes.push({ name: "orders", url: "(skipped: no external_user_id)", error: "missing external_user_id" });
        }

        // 5 & 6. ads
        if (account.advertiser_id) {
          probes.push(
            await probe(
              "ads_campaigns",
              "https://api.mercadolibre.com/advertising/product_ads/campaigns?limit=5",
              authV2,
            ),
          );
          probes.push(
            await probe(
              "ads_metrics",
              `https://api.mercadolibre.com/advertising/advertisers/${account.advertiser_id}/product_ads/metrics?date_from=${ymdDaysAgo(8)}&date_to=${ymdDaysAgo(1)}&aggregation_type=DAILY`,
              { Authorization: `Bearer ${accessToken}`, "api-version": "2" },
            ),
          );
        } else {
          probes.push({ name: "ads_campaigns", url: "(skipped: no advertiser_id)", error: "no advertiser_id" });
          probes.push({ name: "ads_metrics", url: "(skipped: no advertiser_id)", error: "no advertiser_id" });
        }

        return Response.json({
          account: {
            id: account.id,
            external_user_id: account.external_user_id,
            advertiser_id: account.advertiser_id,
          },
          probes,
        });
      },
    },
  },
});