import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const KALSHI = "https://external-api.kalshi.com/trade-api/v2";
const SERIES = ["KXNCAAFGAME", "KXNCAAFSPREAD", "KXNCAAFTOTAL"] as const;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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
  if (ask != null && ask > 0 && ask <= 1) return Math.round(ask * 100);
  if (bid != null && bid > 0 && bid <= 1) return Math.round(bid * 100);
  return 50;
}

type SeriesKind = "game" | "spread" | "total";

type BoardMarket = {
  ticker: string;
  title: string;
  yesLabel: string;
  noLabel: string;
  yesCents: number;
};

type BoardEvent = {
  eventTicker: string;
  title: string;
  subtitle: string;
  startTime: string | null;
  series: SeriesKind;
  markets: BoardMarket[];
};

type Hit = {
  ticker: string;
  title: string;
  eventTitle: string;
  yesCents: number;
  closeTime: string | null;
};

async function kalshiJson(path: string) {
  const res = await fetch(`${KALSHI}${path}`);
  if (!res.ok) throw new Error(`Kalshi ${res.status}`);
  return await res.json();
}

async function fetchSeriesEvents(series: string): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  let cursor = "";
  for (let page = 0; page < 2; page++) {
    const qs = new URLSearchParams({
      series_ticker: series,
      status: "open",
      with_nested_markets: "true",
      limit: "200",
    });
    if (cursor) qs.set("cursor", cursor);
    const data = await kalshiJson(`/events?${qs.toString()}`);
    events.push(...((data.events ?? []) as Record<string, unknown>[]));
    cursor = String(data.cursor ?? "");
    if (!cursor) break;
  }
  return events;
}

function slimMarkets(ev: Record<string, unknown>, series: SeriesKind): BoardMarket[] {
  const markets = (ev.markets ?? []) as Record<string, unknown>[];
  const mapped = markets.map((m) => {
    const title = String(m.title ?? m.yes_sub_title ?? "");
    const yesLabel = String(m.yes_sub_title ?? title ?? "Yes");
    return {
      ticker: String(m.ticker),
      title,
      yesLabel,
      noLabel: series === "game" ? "No" : `Not ${yesLabel}`,
      yesCents: yesCentsFromMarket(m),
      startTime: (m.occurrence_datetime as string) ?? null,
    };
  });
  if (series === "game") return mapped.map(({ startTime: _s, ...rest }) => rest);
  return [...mapped]
    .sort((a, b) => Math.abs(a.yesCents - 50) - Math.abs(b.yesCents - 50))
    .slice(0, 4)
    .map(({ startTime: _s, ...rest }) => rest);
}

function slimEvent(ev: Record<string, unknown>, series: SeriesKind): BoardEvent {
  const markets = (ev.markets ?? []) as Record<string, unknown>[];
  const startTime =
    markets.map((m) => m.occurrence_datetime as string | undefined).find(Boolean) ?? null;
  return {
    eventTicker: String(ev.event_ticker ?? ""),
    title: String(ev.title ?? ""),
    subtitle: String(ev.sub_title ?? ""),
    startTime,
    series,
    markets: slimMarkets(ev, series),
  };
}

async function buildBoard(): Promise<BoardEvent[]> {
  const [games, spreads, totals] = await Promise.all([
    fetchSeriesEvents("KXNCAAFGAME"),
    fetchSeriesEvents("KXNCAAFSPREAD"),
    fetchSeriesEvents("KXNCAAFTOTAL"),
  ]);
  const events = [
    ...games.map((e) => slimEvent(e, "game")),
    ...spreads.map((e) => slimEvent(e, "spread")),
    ...totals.map((e) => slimEvent(e, "total")),
  ].filter((e) => e.markets.length > 0);
  events.sort((a, b) => {
    if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
    if (a.startTime) return -1;
    if (b.startTime) return 1;
    return a.title.localeCompare(b.title);
  });
  return events;
}

async function searchMarkets(q: string): Promise<Hit[]> {
  const needle = q.trim().toLowerCase();
  const hits: Hit[] = [];
  for (const series of SERIES) {
    const data = await kalshiJson(
      `/events?series_ticker=${series}&status=open&with_nested_markets=true&limit=200`,
    );
    const events = (data.events ?? []) as Record<string, unknown>[];
    for (const ev of events) {
      const eventTitle = String(ev.title ?? ev.sub_title ?? "");
      const markets = (ev.markets ?? []) as Record<string, unknown>[];
      for (const m of markets) {
        const title = String(m.title ?? m.yes_sub_title ?? "");
        const blob = `${eventTitle} ${title} ${m.ticker}`.toLowerCase();
        if (needle && !blob.includes(needle)) continue;
        hits.push({
          ticker: String(m.ticker),
          title: title || eventTitle,
          eventTitle,
          yesCents: yesCentsFromMarket(m),
          closeTime: (m.close_time as string) ?? null,
        });
        if (hits.length >= 40) return hits;
      }
    }
  }
  return hits;
}

async function fetchQuotes(tickers: string[]) {
  if (tickers.length === 0) return [];
  const unique = [...new Set(tickers)].slice(0, 50);
  const data = await kalshiJson(`/markets?tickers=${encodeURIComponent(unique.join(","))}`);
  const markets = (data.markets ?? []) as Record<string, unknown>[];
  return markets.map((m) => ({
    ticker: String(m.ticker),
    yes_cents: yesCentsFromMarket(m),
    as_of: new Date().toISOString(),
    title: String(m.title ?? ""),
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const url = new URL(req.url);
    const action = String(body.action ?? url.searchParams.get("action") ?? "search");

    if (action === "search") {
      const q = String(body.q ?? url.searchParams.get("q") ?? "");
      const markets = await searchMarkets(q);
      return json({ markets });
    }

    if (action === "board") {
      const events = await buildBoard();
      return json({ events });
    }

    if (action === "quotes") {
      const tickers = Array.isArray(body.tickers)
        ? body.tickers.map(String)
        : String(url.searchParams.get("tickers") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      const quotes = await fetchQuotes(tickers);
      const service = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );
      if (quotes.length) {
        await service.from("ss_market_quotes").upsert(
          quotes.map((q) => ({
            ticker: q.ticker,
            yes_cents: q.yes_cents,
            as_of: q.as_of,
            title: q.title,
          })),
        );
      }
      return json({ quotes });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Kalshi proxy failed";
    return json({ error: message }, 500);
  }
});
