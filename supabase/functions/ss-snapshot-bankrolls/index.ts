import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const KALSHI = "https://external-api.kalshi.com/trade-api/v2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", Connection: "keep-alive" },
  });
}

function parseDollars(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function yesCentsFromMarket(m: Record<string, unknown>): number {
  const last = parseDollars(m.last_price_dollars);
  if (last && last > 0 && last < 1) return Math.round(last * 100);
  const bid = parseDollars(m.yes_bid_dollars);
  const ask = parseDollars(m.yes_ask_dollars);
  if (bid != null && ask != null) return Math.round(((bid + ask) / 2) * 100);
  if (ask != null && ask > 0) return Math.round(ask * 100);
  if (bid != null && bid > 0) return Math.round(bid * 100);
  return 50;
}

function contestSaturday(now = new Date()): { date: string; inWindow: boolean; pastClose: boolean } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const y = Number(parts.year);
  const mo = Number(parts.month);
  const d = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday] ?? 0;
  const utc = Date.UTC(y, mo - 1, d);
  let sat = utc;
  if (dow === 0) {
    sat = hour * 60 + minute < 120 ? utc - 86400000 : utc + 6 * 86400000;
  } else if (dow !== 6) {
    sat = utc + (6 - dow) * 86400000;
  }
  const date = new Date(sat).toISOString().slice(0, 10);
  const inWindow = dow === 6 || (dow === 0 && hour * 60 + minute < 120);
  const pastClose = dow === 0 && hour * 60 + minute >= 120;
  return { date, inWindow, pastClose };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const service = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const { date, inWindow, pastClose } = contestSaturday();
    const { data: week, error: werr } = await service
      .from("ss_weeks")
      .select("*")
      .eq("saturday_date", date)
      .maybeSingle();
    if (werr) throw werr;
    if (!week) return json({ skipped: true, reason: "no week" });

    if (pastClose && week.status === "open") {
      await service.rpc("ss_lock_week", { p_week_id: week.id });
    }

    if (!inWindow && week.status === "locked") {
      return json({ skipped: true, reason: "outside window" });
    }

    const { data: legs } = await service
      .from("ss_bet_legs")
      .select("kalshi_ticker, bet_id, ss_bets!inner(week_id, status)")
      .not("kalshi_ticker", "is", null);

    const tickers = [
      ...new Set(
        (legs ?? [])
          .filter((row) => {
            const bet = row.ss_bets as { week_id: string; status: string } | { week_id: string; status: string }[] | null;
            const b = Array.isArray(bet) ? bet[0] : bet;
            return b?.week_id === week.id && b?.status === "open";
          })
          .map((row) => String(row.kalshi_ticker)),
      ),
    ];

    if (tickers.length) {
      const data = await fetch(
        `${KALSHI}/markets?tickers=${encodeURIComponent(tickers.join(","))}`,
      ).then((r) => r.json());
      const markets = (data.markets ?? []) as Record<string, unknown>[];
      const quotes = markets.map((m) => ({
        ticker: String(m.ticker),
        yes_cents: yesCentsFromMarket(m),
        as_of: new Date().toISOString(),
        title: String(m.title ?? ""),
      }));
      if (quotes.length) await service.from("ss_market_quotes").upsert(quotes);
    }

    const { data: n, error: serr } = await service.rpc("ss_record_snapshots", {
      p_week_id: week.id,
    });
    if (serr) throw serr;
    return json({ ok: true, snapshots: n, tickers: tickers.length, inWindow });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "snapshot failed" }, 500);
  }
});
