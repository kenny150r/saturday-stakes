import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { MarketBoard, toggleLeg, type TicketLeg } from '../components/MarketBoard'
import { placeBet } from '../lib/api'
import { cashOnHand } from '../lib/bankroll'
import { friendlyError } from '../lib/errors'
import {
  combineParlayAmerican,
  formatAmerican,
  isQualifyingAmerican,
  parseAmerican,
} from '../lib/odds'
import { money } from '../lib/format'
import type { SsBet, SsMember, SsWeek, SsWeekEntry } from '../lib/types'

interface Props {
  week: SsWeek
  member: SsMember
  entry: SsWeekEntry | null
  bets: SsBet[]
  onPlaced: () => Promise<void>
}

export function LogBetView({ week, member, entry, bets, onPlaced }: Props) {
  const [tab, setTab] = useState<'board' | 'custom'>('board')
  const [legs, setLegs] = useState<TicketLeg[]>([])
  const [stake, setStake] = useState('10')
  const [customDesc, setCustomDesc] = useState('')
  const [customOdds, setCustomOdds] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const cash = entry ? cashOnHand(entry, bets.filter((b) => b.user_id === member.user_id)) : 50
  const locked = week.status !== 'open'
  const isCombo = legs.length > 1

  const combined = useMemo(() => {
    if (legs.length === 0) return null
    if (legs.length === 1) return legs[0].american
    return combineParlayAmerican(legs.map((l) => l.american))
  }, [legs])

  function setLegOdds(key: string, draft: string) {
    setLegs((prev) =>
      prev.map((leg) => {
        if (leg.key !== key) return leg
        const parsed = parseAmerican(draft)
        return { ...leg, oddsDraft: draft, american: parsed ?? leg.american }
      }),
    )
  }

  function addCustom() {
    setError('')
    const american = parseAmerican(customOdds)
    if (!customDesc.trim() || american == null) {
      setError('Need a pick and American odds (like -110 or +150).')
      return
    }
    const key = `custom:${customDesc.trim().toLowerCase()}:${Date.now()}`
    setLegs((prev) =>
      toggleLeg(prev, {
        key,
        description: customDesc.trim(),
        american,
        quotedAmerican: null,
        oddsDraft: formatAmerican(american),
        eventTitle: 'Sportsbook',
        kalshiTicker: null,
        kalshiSide: null,
        entryYesCents: null,
      }),
    )
    setCustomDesc('')
    setCustomOdds('')
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (locked) return
    setError('')
    const stakeN = Number(stake)
    if (!Number.isFinite(stakeN) || stakeN <= 0) {
      setError('Enter a stake.')
      return
    }
    if (legs.length === 0) {
      setError('Pick a team or add a sportsbook bet.')
      return
    }
    const parsedLegs = legs.map((l) => ({
      ...l,
      american: parseAmerican(l.oddsDraft) ?? l.american,
    }))
    if (parsedLegs.some((l) => !Number.isFinite(l.american) || l.american === 0)) {
      setError('Every pick needs valid American odds (like -110 or +150).')
      return
    }
    setBusy(true)
    try {
      await placeBet({
        weekId: week.id,
        kind: parsedLegs.length > 1 ? 'parlay' : 'straight',
        stake: stakeN,
        legs: parsedLegs.map((p) => ({
          description: p.description,
          american_odds: p.american,
          kalshi_ticker: p.kalshiTicker,
          kalshi_side: p.kalshiSide,
          entry_yes_cents: p.entryYesCents,
        })),
      })
      setLegs([])
      await onPlaced()
    } catch (err) {
      setError(friendlyError(err, 'Could not log bet'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 pb-52">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          Cash <span className="text-white font-semibold tabular-nums">{money(cash)}</span>
        </p>
        {locked && <p className="text-sm text-red-400">Week locked</p>}
      </div>

      <div className="grid grid-cols-2 gap-px bg-zinc-800 border border-zinc-800 text-sm">
        <button
          type="button"
          onClick={() => setTab('board')}
          className={`py-2 font-medium ${tab === 'board' ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-500'}`}
        >
          Matchups
        </button>
        <button
          type="button"
          onClick={() => setTab('custom')}
          className={`py-2 font-medium ${tab === 'custom' ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-500'}`}
        >
          Sportsbook
        </button>
      </div>

      {tab === 'board' && (
        <MarketBoard
          legs={legs}
          onToggle={(leg) => {
            setError('')
            setLegs((prev) => toggleLeg(prev, leg))
          }}
        />
      )}

      {tab === 'custom' && (
        <div className="card p-4 space-y-3">
          <p className="text-sm text-zinc-400">
            Log a ticket that isn’t on Kalshi, or add a sportsbook leg to a combo.
          </p>
          <div>
            <label className="label">Pick</label>
            <input
              className="input"
              value={customDesc}
              onChange={(e) => setCustomDesc(e.target.value)}
              placeholder="Alabama -7.5"
            />
          </div>
          <div>
            <label className="label">American odds</label>
            <input
              className="input"
              inputMode="numeric"
              value={customOdds}
              onChange={(e) => setCustomOdds(e.target.value)}
              placeholder="-110"
            />
          </div>
          <button type="button" className="btn-secondary w-full" onClick={addCustom}>
            {legs.length > 0 ? 'Add as combo leg' : 'Add to ticket'}
          </button>
        </div>
      )}

      {legs.length > 0 && (
        <div className="fixed bottom-[calc(3.75rem+env(safe-area-inset-bottom))] inset-x-0 z-30 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
          <div className="max-w-2xl mx-auto px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                {isCombo ? `Combo · ${legs.length} legs` : 'Straight'}
              </p>
              <button type="button" className="text-xs text-zinc-500" onClick={() => setLegs([])}>
                Clear
              </button>
            </div>
            {!isCombo && (
              <p className="text-xs text-zinc-500">Tap another matchup to turn this into a combo.</p>
            )}
            <ul className="space-y-2 max-h-40 overflow-auto">
              {legs.map((leg) => {
                const quoted = leg.quotedAmerican
                const overridden =
                  quoted != null && Number.isFinite(quoted) && quoted !== leg.american
                return (
                  <li key={leg.key} className="border border-zinc-800 p-2 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-100 truncate">{leg.description}</p>
                        <p className="text-[11px] text-zinc-500 truncate">{leg.eventTitle}</p>
                      </div>
                      <button
                        type="button"
                        className="text-zinc-500 shrink-0"
                        aria-label={`Remove ${leg.description}`}
                        onClick={() => setLegs((prev) => prev.filter((l) => l.key !== leg.key))}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-zinc-500">
                      Odds
                      <input
                        className="input py-1.5 text-sm w-24"
                        inputMode="numeric"
                        value={leg.oddsDraft}
                        onChange={(e) => setLegOdds(leg.key, e.target.value)}
                        aria-label={`Odds for ${leg.description}`}
                      />
                      {quoted != null && (
                        <span className={overridden ? 'text-emerald-400' : 'text-zinc-600'}>
                          {overridden
                            ? `book · Kalshi was ${formatAmerican(quoted)}`
                            : `Kalshi ${formatAmerican(quoted)}`}
                        </span>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
            {combined != null && (
              <p className="text-sm">
                Combined <span className="font-semibold">{formatAmerican(combined)}</span>
                {' · '}
                {isQualifyingAmerican(combined) ? (
                  <span className="text-emerald-400">counts toward 3 qualifying</span>
                ) : (
                  <span className="text-zinc-500">shorter than -400</span>
                )}
              </p>
            )}
            <div className="flex gap-2">
              <input
                className="input w-24"
                inputMode="decimal"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                aria-label="Stake"
              />
              <button type="submit" disabled={busy || locked} className="btn-yes flex-1">
                {busy ? 'Saving…' : `Place ${isCombo ? 'combo ' : ''}${money(Number(stake) || 0)}`}
              </button>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>
        </div>
      )}

      {legs.length === 0 && error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  )
}
