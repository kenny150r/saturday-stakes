import { formatAmerican, formatCents, kalshiCentsToAmerican } from '../lib/odds'
import { money } from '../lib/format'
import { settleBet } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { PlayerAvatar } from '../components/PlayerAvatar'
import type { BetStatus, SsBet, SsMember, SsQuote, SsWeek } from '../lib/types'
import { useState } from 'react'

interface Props {
  member: SsMember
  week: SsWeek
  bets: SsBet[]
  quotes: SsQuote[]
  members: SsMember[]
  onChanged: () => Promise<void>
}

export function BetsView({ member, week, bets, quotes, members, onChanged }: Props) {
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const names = Object.fromEntries(members.map((m) => [m.user_id, m.display_name]))
  const colors = Object.fromEntries(members.map((m) => [m.user_id, m.color]))
  const qmap = Object.fromEntries(quotes.map((q) => [q.ticker, q]))
  const mineFirst = [...bets].sort((a, b) => {
    if (a.user_id === member.user_id && b.user_id !== member.user_id) return -1
    if (b.user_id === member.user_id && a.user_id !== member.user_id) return 1
    return a.placed_at < b.placed_at ? 1 : -1
  })

  async function settle(id: string, status: BetStatus) {
    setError('')
    setBusyId(id)
    try {
      await settleBet(id, status)
      await onChanged()
    } catch (e) {
      setError(friendlyError(e, 'Could not settle'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500">
        Open positions mark to Kalshi. Settle when the game’s over.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {mineFirst.length === 0 && <p className="text-sm text-zinc-500">No positions yet this week.</p>}
      {mineFirst.map((bet) => {
        const own = bet.user_id === member.user_id || member.is_admin
        const canSettle = own && bet.status === 'open' && week.status === 'open'
        const who = names[bet.user_id] ?? 'Friend'
        return (
          <article key={bet.id} className="card p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <PlayerAvatar name={who} color={colors[bet.user_id] ?? '#3f3f46'} size={28} />
                <div className="min-w-0">
                  <p className="text-xs text-zinc-500">{who}</p>
                  <p className="font-medium capitalize truncate">
                    {bet.kind} · {formatAmerican(Number(bet.combined_american))}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="font-semibold tabular-nums">{money(Number(bet.stake))}</p>
                <p
                  className={`text-xs uppercase ${
                    bet.status === 'won'
                      ? 'text-emerald-400'
                      : bet.status === 'lost'
                        ? 'text-red-400'
                        : 'text-zinc-500'
                  }`}
                >
                  {bet.status}
                </p>
              </div>
            </div>
            <ul className="text-sm space-y-1">
              {(bet.legs ?? []).map((leg) => {
                const q = leg.kalshi_ticker ? qmap[leg.kalshi_ticker] : null
                const liveCents =
                  q && leg.kalshi_side
                    ? leg.kalshi_side === 'yes'
                      ? Number(q.yes_cents)
                      : 100 - Number(q.yes_cents)
                    : null
                return (
                  <li key={leg.id} className="text-zinc-300 flex justify-between gap-2">
                    <span className="truncate">{leg.description}</span>
                    <span className="tabular-nums text-zinc-500 shrink-0">
                      {formatAmerican(Number(leg.american_odds))}
                      {liveCents != null && bet.status === 'open' && (
                        <span className="text-emerald-400">
                          {' · '}
                          {formatCents(liveCents)} {formatAmerican(kalshiCentsToAmerican(liveCents))}
                        </span>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
            {canSettle && (
              <div className="flex flex-wrap gap-2 pt-1">
                {(['won', 'lost', 'push', 'void'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busyId === bet.id}
                    className="btn-secondary text-xs py-1.5 capitalize"
                    onClick={() => settle(bet.id, s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
