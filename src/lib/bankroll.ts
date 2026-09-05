import {
  americanToDecimal,
  payoutForWin,
} from './odds'
import type { SsBet, SsQuote, SsWeekEntry } from './types'

const quotesByTicker = (quotes: SsQuote[]) => {
  const map: Record<string, SsQuote> = {}
  for (const q of quotes) map[q.ticker] = q
  return map
}

function openMark(bet: SsBet, quotes: Record<string, SsQuote>): number {
  const legs = bet.legs ?? []
  const linked = legs.length > 0 && legs.every(
    (l) => l.kalshi_ticker && l.kalshi_side && l.entry_yes_cents != null,
  )
  if (!linked) return Number(bet.stake)

  const currentCents: number[] = []
  const entryCents: number[] = []
  for (const leg of legs) {
    const q = quotes[leg.kalshi_ticker!]
    if (!q) return Number(bet.stake)
    const entryYes = Number(leg.entry_yes_cents)
    const curYes = Number(q.yes_cents)
    const entry = leg.kalshi_side === 'yes' ? entryYes : 100 - entryYes
    const current = leg.kalshi_side === 'yes' ? curYes : 100 - curYes
    if (entry <= 0 || current < 0) return Number(bet.stake)
    entryCents.push(entry)
    currentCents.push(current)
  }

  if (bet.kind === 'straight') {
    const contracts = Number(bet.stake) / (entryCents[0] / 100)
    return contracts * (currentCents[0] / 100)
  }

  const entryProb = entryCents.reduce((p, c) => p * (c / 100), 1)
  const currentProb = currentCents.reduce((p, c) => p * (c / 100), 1)
  if (entryProb <= 0) return Number(bet.stake)
  return Number(bet.stake) * (currentProb / entryProb)
}

export function betReturn(bet: SsBet, quotes: Record<string, SsQuote>): number {
  if (bet.status === 'void' || bet.status === 'push') return Number(bet.stake)
  if (bet.status === 'lost') return 0
  if (bet.status === 'won') return payoutForWin(Number(bet.stake), Number(bet.combined_american))
  return openMark(bet, quotes)
}

export function bankrollForUser(
  entry: SsWeekEntry,
  bets: SsBet[],
  quotes: SsQuote[],
): number {
  const qmap = quotesByTicker(quotes)
  let value = Number(entry.starting_bankroll)
  for (const bet of bets) {
    if (bet.user_id !== entry.user_id) continue
    if (bet.status === 'void') continue
    value -= Number(bet.stake)
    value += betReturn(bet, qmap)
  }
  return value
}

export function cashOnHand(
  entry: SsWeekEntry,
  bets: SsBet[],
): number {
  let cash = Number(entry.starting_bankroll)
  for (const bet of bets) {
    if (bet.user_id !== entry.user_id) continue
    if (bet.status === 'void') continue
    cash -= Number(bet.stake)
    if (bet.status === 'won') {
      cash += payoutForWin(Number(bet.stake), Number(bet.combined_american))
    } else if (bet.status === 'push') {
      cash += Number(bet.stake)
    }
  }
  return cash
}

export function qualifyingBetCount(bets: SsBet[], userId: string): number {
  return bets.filter(
    (b) =>
      b.user_id === userId &&
      b.status !== 'void' &&
      americanToDecimal(Number(b.combined_american)) >= 1.25 - 1e-9,
  ).length
}
