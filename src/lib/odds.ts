/** -400 American == 1.25 decimal. Longer odds have a higher decimal. */
export const QUALIFYING_DECIMAL = 1.25
export const QUALIFYING_BETS = 3
export const STARTING_BANKROLL = 50
export const BUYIN = 10

export function americanToDecimal(american: number): number {
  if (american > 0) return american / 100 + 1
  if (american < 0) return 100 / Math.abs(american) + 1
  return NaN
}

export function decimalToAmerican(decimal: number): number {
  if (!Number.isFinite(decimal) || decimal <= 1) return 0
  if (decimal >= 2) return Math.round((decimal - 1) * 100)
  return Math.round(-100 / (decimal - 1))
}

export function isQualifyingAmerican(american: number): boolean {
  return americanToDecimal(american) >= QUALIFYING_DECIMAL - 1e-9
}

export function combineParlayAmerican(odds: number[]): number {
  if (odds.length === 0) return 0
  const dec = odds.reduce((p, a) => p * americanToDecimal(a), 1)
  return decimalToAmerican(dec)
}

export function payoutForWin(stake: number, american: number): number {
  return stake * americanToDecimal(american)
}

export function formatAmerican(american: number): string {
  if (!Number.isFinite(american) || american === 0) return '—'
  return american > 0 ? `+${Math.round(american)}` : `${Math.round(american)}`
}

export function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) return '—'
  return `${Math.round(Math.min(100, Math.max(0, cents)))}¢`
}

export function kalshiCentsToAmerican(cents: number): number {
  if (cents <= 0 || cents >= 100) return 0
  return decimalToAmerican(1 / (cents / 100))
}

export function parseAmerican(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\+/, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n === 0) return null
  if (Math.abs(n) < 100) return null
  return n
}

export function parseDollarsToCents(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  const cents = Math.round(n * 100)
  if (cents < 0 || cents > 100) return null
  return cents
}
