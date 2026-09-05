import { supabase } from './supabase'
import { BUYIN, STARTING_BANKROLL } from './odds'
import { friendlyError } from './errors'
import type {
  AddMemberResult,
  BetKind,
  BetStatus,
  KalshiBoardEvent,
  KalshiMarketHit,
  SsBet,
  SsBetLeg,
  SsMember,
  SsPendingMember,
  SsRosterMember,
  SsQuote,
  SsSnapshot,
  SsWeek,
  SsWeekEntry,
} from './types'

function raise(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(friendlyError(error, error.message))
}

export async function fetchMyMember(): Promise<SsMember | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('ss_members')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  raise(error)
  return (data as SsMember | null) ?? null
}

export async function claimPending(): Promise<SsMember | null> {
  const { data, error } = await supabase.rpc('ss_claim_pending')
  raise(error)
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object' || !('user_id' in row) || !row.user_id) return null
  return row as SsMember
}

export async function addMember(email: string, displayName: string): Promise<AddMemberResult> {
  const { data, error } = await supabase.rpc('ss_add_member', {
    p_email: email.trim(),
    p_display_name: displayName.trim(),
  })
  raise(error)
  return data as AddMemberResult
}

export async function removeMember(userId: string): Promise<void> {
  const { error } = await supabase.rpc('ss_remove_member', { p_user_id: userId })
  raise(error)
}

export async function listRoster(): Promise<SsRosterMember[]> {
  const { data, error } = await supabase.rpc('ss_list_roster')
  raise(error)
  return (data ?? []) as SsRosterMember[]
}

export async function listPending(): Promise<SsPendingMember[]> {
  const { data, error } = await supabase.rpc('ss_list_pending')
  raise(error)
  return (data ?? []) as SsPendingMember[]
}

export async function removePending(email: string): Promise<void> {
  const { error } = await supabase.rpc('ss_remove_pending', { p_email: email })
  raise(error)
}

export async function deleteBet(betId: string): Promise<void> {
  const { error } = await supabase.rpc('ss_delete_bet', { p_bet_id: betId })
  raise(error)
}

export async function editBet(input: {
  betId: string
  stake: number
  legs: {
    description: string
    american_odds: number
    kalshi_ticker?: string | null
    kalshi_side?: string | null
    entry_yes_cents?: number | null
  }[]
}): Promise<SsBet> {
  const { data, error } = await supabase.rpc('ss_edit_bet', {
    p_bet_id: input.betId,
    p_stake: input.stake,
    p_legs: input.legs,
  })
  raise(error)
  return data as SsBet
}

export async function redeemInvite(code: string, displayName: string): Promise<SsMember> {
  const { data, error } = await supabase.rpc('ss_redeem_invite', {
    p_code: code.trim(),
    p_display_name: displayName.trim(),
  })
  raise(error)
  return data as SsMember
}

export async function ensureWeek(): Promise<SsWeek> {
  const { data, error } = await supabase.rpc('ss_current_week')
  raise(error)
  return data as SsWeek
}

export async function joinWeek(weekId: string): Promise<SsWeekEntry> {
  const { data, error } = await supabase.rpc('ss_join_week', { p_week_id: weekId })
  raise(error)
  return data as SsWeekEntry
}

export async function fetchMembers(): Promise<SsMember[]> {
  const { data, error } = await supabase
    .from('ss_members')
    .select('*')
    .order('created_at', { ascending: true })
  raise(error)
  return (data ?? []) as SsMember[]
}

export async function fetchEntries(weekId: string): Promise<SsWeekEntry[]> {
  const { data, error } = await supabase
    .from('ss_week_entries')
    .select('*')
    .eq('week_id', weekId)
  raise(error)
  return (data ?? []) as SsWeekEntry[]
}

export async function fetchBets(weekId: string): Promise<SsBet[]> {
  const { data: bets, error } = await supabase
    .from('ss_bets')
    .select('*')
    .eq('week_id', weekId)
    .order('placed_at', { ascending: true })
  raise(error)
  const list = (bets ?? []) as SsBet[]
  if (list.length === 0) return list
  const { data: legs, error: le } = await supabase
    .from('ss_bet_legs')
    .select('*')
    .in('bet_id', list.map((b) => b.id))
    .order('position', { ascending: true })
  raise(le)
  const byBet = new Map<string, SsBetLeg[]>()
  for (const leg of (legs ?? []) as SsBetLeg[]) {
    const arr = byBet.get(leg.bet_id) ?? []
    arr.push(leg)
    byBet.set(leg.bet_id, arr)
  }
  return list.map((b) => ({ ...b, legs: byBet.get(b.id) ?? [] }))
}

export async function fetchQuotes(tickers: string[]): Promise<SsQuote[]> {
  if (tickers.length === 0) return []
  const { data, error } = await supabase
    .from('ss_market_quotes')
    .select('*')
    .in('ticker', tickers)
  raise(error)
  return (data ?? []) as SsQuote[]
}

export async function fetchSnapshots(weekId: string): Promise<SsSnapshot[]> {
  const { data, error } = await supabase
    .from('ss_bankroll_snapshots')
    .select('*')
    .eq('week_id', weekId)
    .order('captured_at', { ascending: true })
  raise(error)
  return (data ?? []) as SsSnapshot[]
}

export async function placeBet(input: {
  weekId: string
  kind: BetKind
  stake: number
  legs: {
    description: string
    american_odds: number
    kalshi_ticker?: string | null
    kalshi_side?: string | null
    entry_yes_cents?: number | null
  }[]
}): Promise<SsBet> {
  const { data, error } = await supabase.rpc('ss_place_bet', {
    p_week_id: input.weekId,
    p_kind: input.kind,
    p_stake: input.stake,
    p_legs: input.legs,
  })
  raise(error)
  return data as SsBet
}

export async function settleBet(betId: string, status: BetStatus): Promise<SsBet> {
  const { data, error } = await supabase.rpc('ss_settle_bet', {
    p_bet_id: betId,
    p_status: status,
  })
  raise(error)
  return data as SsBet
}

export async function lockWeek(weekId: string): Promise<SsWeek> {
  const { data, error } = await supabase.rpc('ss_lock_week', { p_week_id: weekId })
  raise(error)
  return data as SsWeek
}

export async function createInvite(maxUses = 20): Promise<string> {
  const { data, error } = await supabase.rpc('ss_create_invite', {
    p_max_uses: maxUses,
    p_expires_at: null,
  })
  raise(error)
  return data as string
}

export async function searchKalshi(q: string): Promise<KalshiMarketHit[]> {
  const { data, error } = await supabase.functions.invoke('kalshi-cfb', {
    body: { action: 'search', q },
  })
  if (error) throw new Error(friendlyError(error, 'Kalshi search failed'))
  const payload = data as { markets?: KalshiMarketHit[]; error?: string }
  if (payload?.error) throw new Error(payload.error)
  return payload.markets ?? []
}

export async function fetchKalshiBoard(): Promise<KalshiBoardEvent[]> {
  const { data, error } = await supabase.functions.invoke('kalshi-cfb', {
    body: { action: 'board' },
  })
  if (error) throw new Error(friendlyError(error, 'Could not load matchups'))
  const payload = data as { events?: KalshiBoardEvent[]; error?: string }
  if (payload?.error) throw new Error(payload.error)
  return payload.events ?? []
}

export async function refreshKalshiQuotes(tickers: string[]): Promise<SsQuote[]> {
  if (tickers.length === 0) return []
  const { data, error } = await supabase.functions.invoke('kalshi-cfb', {
    body: { action: 'quotes', tickers },
  })
  if (error) throw new Error(friendlyError(error, 'Could not refresh prices'))
  const payload = data as { quotes?: SsQuote[]; error?: string }
  if (payload?.error) throw new Error(payload.error)
  return payload.quotes ?? []
}

export function prizePool(entryCount: number): number {
  return BUYIN * entryCount
}

export function startingBankroll(): number {
  return STARTING_BANKROLL
}
