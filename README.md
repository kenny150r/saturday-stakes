# CAC — Clinically Addicted Challenge

Private college-football Saturday pool for friends. Everyone starts with a **$50** bankroll and a **$10** honor-system buy-in for that week’s prize. Highest eligible bankroll when Saturday ends (Sunday 2:00 AM Pacific) takes the pool.

Eligibility: at least **3 bets at -400 or longer**. A combo / parlay counts as one bet. You can override Kalshi odds if you placed the ticket at a sportsbook.

Live site: https://kenny150r.github.io/saturday-stakes/

## Stack

- Vite + React + TypeScript + Tailwind + Recharts
- Auth and data on the existing **House Fund Tracker** Supabase project (`gcqjjpbshoogojsozflp`) — no new paid project
- Kalshi public NCAAF prices via Edge Function `kalshi-cfb` (search + mark-to-market). No in-app trading in v1.

## Local

```bash
cp .env.example .env.local
# fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from House Fund Tracker
npm install
npm run dev
```

Open http://localhost:5173. Create an account, then join with the invite code (first member becomes the host).

Schema: [`supabase/schema.sql`](supabase/schema.sql). Re-apply in the SQL editor if you need a fresh install.

## GitHub Pages

1. Push to a GitHub repo named `saturday-stakes`.
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
4. In Supabase **Authentication → URL configuration**, **add** (do not replace the existing Site URL):
   - `http://localhost:5173/**`
   - `https://kenny150r.github.io/saturday-stakes/**`

## Kalshi

College football series used: `KXNCAAFGAME`, `KXNCAAFSPREAD`, `KXNCAAFTOTAL`. Linking a market is optional; unlinked sportsbook bets sit at cost until you tap Won / Lost / Push.
