export type BetKind = 'straight' | 'parlay'
export type BetStatus = 'open' | 'won' | 'lost' | 'push' | 'void'
export type KalshiSide = 'yes' | 'no'
export type WeekStatus = 'open' | 'locked'
export type AppView = 'home' | 'log' | 'bets'

export interface SsMember {
  user_id: string
  display_name: string
  color: string
  is_admin: boolean
  created_at: string
}

export interface SsPendingMember {
  email: string
  display_name: string
  created_at: string
}

export interface SsRosterMember {
  user_id: string
  display_name: string
  email: string
  is_admin: boolean
  created_at: string
}

export type AddMemberResult =
  | { status: 'joined'; display_name: string }
  | { status: 'pending'; email: string; display_name: string }

export interface SsWeek {
  id: string
  saturday_date: string
  opens_at: string
  closes_at: string
  status: WeekStatus
  winner_user_ids: string[]
  locked_at: string | null
}

export interface SsWeekEntry {
  week_id: string
  user_id: string
  starting_bankroll: number
  buyin: number
  created_at: string
}

export interface SsBetLeg {
  id: string
  bet_id: string
  position: number
  description: string
  american_odds: number
  kalshi_ticker: string | null
  kalshi_side: KalshiSide | null
  entry_yes_cents: number | null
}

export interface SsBet {
  id: string
  week_id: string
  user_id: string
  kind: BetKind
  stake: number
  combined_american: number
  status: BetStatus
  placed_at: string
  settled_at: string | null
  legs?: SsBetLeg[]
}

export interface SsQuote {
  ticker: string
  yes_cents: number
  as_of: string
  title: string | null
}

export interface SsSnapshot {
  id: string
  week_id: string
  user_id: string
  captured_at: string
  bankroll: number
}

export interface KalshiMarketHit {
  ticker: string
  title: string
  eventTitle: string
  yesCents: number
  closeTime: string | null
}

export type KalshiSeries = 'game' | 'spread' | 'total'

export interface KalshiBoardMarket {
  ticker: string
  title: string
  yesLabel: string
  noLabel: string
  yesCents: number
}

export interface KalshiBoardEvent {
  eventTicker: string
  title: string
  subtitle: string
  startTime: string | null
  series: KalshiSeries
  markets: KalshiBoardMarket[]
}

export interface LegDraft {
  description: string
  american: string
  kalshiTicker: string
  kalshiSide: KalshiSide
  entryYesCents: string
}
