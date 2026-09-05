import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { fetchKalshiBoard } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { kickoffLabel } from '../lib/format'
import { formatAmerican, formatCents, kalshiCentsToAmerican } from '../lib/odds'
import type { KalshiBoardEvent, KalshiSeries, KalshiSide } from '../lib/types'

export interface TicketLeg {
  key: string
  description: string
  american: number
  /** Kalshi implied odds, if this pick came from the board. */
  quotedAmerican: number | null
  oddsDraft: string
  eventTitle: string
  kalshiTicker: string | null
  kalshiSide: KalshiSide | null
  entryYesCents: number | null
}

export function toggleLeg(prev: TicketLeg[], next: TicketLeg): TicketLeg[] {
  const exists = prev.some((p) => p.key === next.key)
  if (exists) return prev.filter((p) => p.key !== next.key)
  if (prev.some((p) => p.kalshiTicker && p.kalshiTicker === next.kalshiTicker)) {
    return [...prev.filter((p) => p.kalshiTicker !== next.kalshiTicker), next]
  }
  return [...prev, next]
}

function legFromMarket(
  event: KalshiBoardEvent,
  ticker: string,
  side: KalshiSide,
  yesCents: number,
  yesLabel: string,
  noLabel: string,
): TicketLeg {
  const cents = side === 'yes' ? yesCents : 100 - yesCents
  const label = side === 'yes' ? yesLabel : noLabel
  const american = kalshiCentsToAmerican(cents)
  return {
    key: `${ticker}:${side}`,
    description: `${label} (${side.toUpperCase()})`,
    american,
    quotedAmerican: american,
    oddsDraft: formatAmerican(american),
    eventTitle: event.title,
    kalshiTicker: ticker,
    kalshiSide: side,
    entryYesCents: yesCents,
  }
}

export function MarketBoard({
  legs,
  onToggle,
}: {
  legs: TicketLeg[]
  onToggle: (leg: TicketLeg) => void
}) {
  const [series, setSeries] = useState<KalshiSeries>('game')
  const [q, setQ] = useState('')
  const [events, setEvents] = useState<KalshiBoardEvent[]>([])
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load(initial: boolean) {
      if (initial) setBusy(true)
      try {
        const rows = await fetchKalshiBoard()
        if (!cancelled) {
          setEvents(rows)
          setErr('')
        }
      } catch (e) {
        if (!cancelled) setErr(friendlyError(e, 'Could not load matchups'))
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    void load(true)
    const poll = window.setInterval(() => void load(false), 12000)
    return () => {
      cancelled = true
      window.clearInterval(poll)
    }
  }, [])

  const selected = useMemo(() => new Set(legs.map((l) => l.key)), [legs])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return events.filter((ev) => {
      if (ev.series !== series) return false
      if (!needle) return true
      const blob = `${ev.title} ${ev.subtitle} ${ev.markets.map((m) => m.title).join(' ')}`.toLowerCase()
      return blob.includes(needle)
    })
  }, [events, series, q])

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search teams, spreads, totals…"
          className="input pl-9"
        />
      </div>
      <div className="grid grid-cols-3 gap-px bg-zinc-800 border border-zinc-800 text-sm">
        {(
          [
            ['game', 'Games'],
            ['spread', 'Spreads'],
            ['total', 'Totals'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSeries(id)}
            className={`py-2 font-medium ${
              series === id ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {busy && events.length === 0 && (
        <p className="text-sm text-zinc-500 px-1">Loading live CFB markets…</p>
      )}
      {err && <p className="text-sm text-red-400">{err}</p>}
      <p className="text-xs text-zinc-500 px-1">
        Tap a team to start a ticket. Tap more games to build a combo / parlay.
      </p>
      {!busy && !err && visible.length === 0 && (
        <p className="text-sm text-zinc-500">No matchups match that search.</p>
      )}
      <div className="space-y-2">
        {visible.map((ev) => (
          <article key={ev.eventTicker} className="card p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold leading-tight truncate">{ev.title}</h3>
                <p className="text-xs text-zinc-500">
                  {kickoffLabel(ev.startTime) || ev.subtitle}
                </p>
              </div>
            </div>
            {ev.series === 'game' && ev.markets.length >= 2 ? (
              <div className="grid grid-cols-2 gap-2">
                {ev.markets.map((m) => {
                  const key = `${m.ticker}:yes`
                  const on = selected.has(key)
                  return (
                    <button
                      key={m.ticker}
                      type="button"
                      onClick={() => onToggle(legFromMarket(ev, m.ticker, 'yes', m.yesCents, m.yesLabel, m.noLabel))}
                      className={`contract ${on ? 'contract-yes contract-selected' : 'hover:border-zinc-500'}`}
                    >
                      <span className="text-xs text-zinc-300 truncate w-full text-center">{m.yesLabel}</span>
                      <span className={`text-lg font-semibold tabular-nums ${on ? 'text-emerald-400' : 'text-white'}`}>
                        {formatCents(m.yesCents)}
                      </span>
                      <span className="text-[11px] text-zinc-500">
                        {formatAmerican(kalshiCentsToAmerican(m.yesCents))}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <ul className="space-y-2">
                {ev.markets.map((m) => {
                  const yesKey = `${m.ticker}:yes`
                  const noKey = `${m.ticker}:no`
                  const yesOn = selected.has(yesKey)
                  const noOn = selected.has(noKey)
                  return (
                    <li key={m.ticker} className="space-y-1.5">
                      <p className="text-xs text-zinc-400 truncate">{m.title}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            onToggle(legFromMarket(ev, m.ticker, 'yes', m.yesCents, m.yesLabel, m.noLabel))
                          }
                          className={`contract ${yesOn ? 'contract-yes contract-selected' : 'hover:border-zinc-500'}`}
                        >
                          <span className="text-[11px] uppercase tracking-wide text-emerald-400">Yes</span>
                          <span className="text-lg font-semibold tabular-nums">{formatCents(m.yesCents)}</span>
                          <span className="text-[11px] text-zinc-500">
                            {formatAmerican(kalshiCentsToAmerican(m.yesCents))}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onToggle(legFromMarket(ev, m.ticker, 'no', m.yesCents, m.yesLabel, m.noLabel))
                          }
                          className={`contract ${noOn ? 'contract-no contract-selected' : 'hover:border-zinc-500'}`}
                        >
                          <span className="text-[11px] uppercase tracking-wide text-red-400">No</span>
                          <span className="text-lg font-semibold tabular-nums">
                            {formatCents(100 - m.yesCents)}
                          </span>
                          <span className="text-[11px] text-zinc-500">
                            {formatAmerican(kalshiCentsToAmerican(100 - m.yesCents))}
                          </span>
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}
