import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { editBet } from '../lib/api'
import { friendlyError } from '../lib/errors'
import {
  combineParlayAmerican,
  formatAmerican,
  isQualifyingAmerican,
  parseAmerican,
} from '../lib/odds'
import { money } from '../lib/format'
import type { SsBet, SsBetLeg } from '../lib/types'

interface DraftLeg {
  key: string
  description: string
  oddsDraft: string
  kalshiTicker: string | null
  kalshiSide: string | null
  entryYesCents: number | null
}

function fromBetLeg(leg: SsBetLeg): DraftLeg {
  return {
    key: leg.id,
    description: leg.description,
    oddsDraft: formatAmerican(Number(leg.american_odds)),
    kalshiTicker: leg.kalshi_ticker,
    kalshiSide: leg.kalshi_side,
    entryYesCents: leg.entry_yes_cents,
  }
}

interface Props {
  bet: SsBet
  busy: boolean
  onBusy: (busy: boolean) => void
  onCancel: () => void
  onSaved: () => Promise<void>
}

export function EditPosition({ bet, busy, onBusy, onCancel, onSaved }: Props) {
  const [stake, setStake] = useState(String(Number(bet.stake)))
  const [legs, setLegs] = useState<DraftLeg[]>(() => (bet.legs ?? []).map(fromBetLeg))
  const [error, setError] = useState('')

  const combined = useMemo(() => {
    const odds = legs.map((l) => parseAmerican(l.oddsDraft)).filter((n): n is number => n != null)
    if (odds.length === 0 || odds.length !== legs.length) return null
    if (odds.length === 1) return odds[0]
    return combineParlayAmerican(odds)
  }, [legs])

  function addLeg() {
    setLegs((prev) => [
      ...prev,
      {
        key: `new:${Date.now()}`,
        description: '',
        oddsDraft: '-110',
        kalshiTicker: null,
        kalshiSide: null,
        entryYesCents: null,
      },
    ])
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const stakeN = Number(stake)
    if (!Number.isFinite(stakeN) || stakeN <= 0) {
      setError('Enter a stake.')
      return
    }
    if (legs.length === 0) {
      setError('Need at least one pick.')
      return
    }
    const parsed = legs.map((l) => ({
      description: l.description.trim(),
      american: parseAmerican(l.oddsDraft),
      kalshi_ticker: l.kalshiTicker,
      kalshi_side: l.kalshiSide,
      entry_yes_cents: l.entryYesCents,
    }))
    if (parsed.some((l) => !l.description || l.american == null)) {
      setError('Every pick needs a description and American odds (like -110 or +150).')
      return
    }
    onBusy(true)
    try {
      await editBet({
        betId: bet.id,
        stake: stakeN,
        legs: parsed.map((l) => ({
          description: l.description,
          american_odds: l.american!,
          kalshi_ticker: l.kalshi_ticker,
          kalshi_side: l.kalshi_side,
          entry_yes_cents: l.entry_yes_cents,
        })),
      })
      await onSaved()
    } catch (err) {
      setError(friendlyError(err, 'Could not save'))
    } finally {
      onBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-3 pt-1">
      {legs.map((leg) => (
        <div key={leg.key} className="border border-zinc-800 p-2 space-y-2">
          <div className="flex items-start gap-2">
            <input
              className="input py-1.5"
              value={leg.description}
              maxLength={200}
              placeholder="Pick"
              onChange={(e) =>
                setLegs((prev) =>
                  prev.map((l) => (l.key === leg.key ? { ...l, description: e.target.value } : l)),
                )
              }
            />
            {legs.length > 1 && (
              <button
                type="button"
                className="text-zinc-500 shrink-0 pt-2"
                aria-label={`Remove ${leg.description || 'pick'}`}
                onClick={() => setLegs((prev) => prev.filter((l) => l.key !== leg.key))}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            Odds
            <input
              className="input py-1.5 text-sm w-24"
              inputMode="numeric"
              value={leg.oddsDraft}
              onChange={(e) =>
                setLegs((prev) =>
                  prev.map((l) => (l.key === leg.key ? { ...l, oddsDraft: e.target.value } : l)),
                )
              }
            />
          </label>
        </div>
      ))}
      <button type="button" className="btn-secondary text-xs py-1.5 w-full" onClick={addLeg}>
        Add a pick
      </button>
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
      <label className="flex items-center gap-2 text-xs text-zinc-500">
        Stake
        <input
          className="input py-1.5 text-sm w-24"
          inputMode="decimal"
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          aria-label="Stake"
        />
        <span className="text-zinc-400">{money(Number(stake) || 0)}</span>
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="btn-yes text-xs py-1.5">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" disabled={busy} className="btn-secondary text-xs py-1.5" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
