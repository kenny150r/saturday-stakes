import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Crown, Ticket } from 'lucide-react'
import { ChartAvatarDot, PlayerAvatar } from '../components/PlayerAvatar'
import { bankrollForUser, qualifyingBetCount } from '../lib/bankroll'
import { QUALIFYING_BETS } from '../lib/odds'
import { initials, money, shortDate, timeLabel } from '../lib/format'
import { createInvite, lockWeek, prizePool } from '../lib/api'
import { friendlyError } from '../lib/errors'
import type { SsBet, SsMember, SsQuote, SsSnapshot, SsWeek, SsWeekEntry } from '../lib/types'

interface Props {
  member: SsMember
  week: SsWeek
  members: SsMember[]
  entries: SsWeekEntry[]
  bets: SsBet[]
  quotes: SsQuote[]
  snapshots: SsSnapshot[]
  onRefresh: () => Promise<void>
}

const MAX_CHART_POINTS = 48

function thinTimes(times: string[], max: number): string[] {
  if (times.length <= max) return times
  const out: string[] = []
  const last = times.length - 1
  for (let i = 0; i < max - 1; i++) {
    const idx = Math.round((i * last) / (max - 1))
    const t = times[idx]
    if (out[out.length - 1] !== t) out.push(t)
  }
  if (out[out.length - 1] !== times[last]) out.push(times[last])
  return out
}

export function HomeView({
  member,
  week,
  members,
  entries,
  bets,
  quotes,
  snapshots,
  onRefresh,
}: Props) {
  const [invite, setInvite] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const memberById = useMemo(
    () => Object.fromEntries(members.map((m) => [m.user_id, m])),
    [members],
  )

  const rows = useMemo(() => {
    return entries
      .map((entry) => {
        const m = memberById[entry.user_id]
        const bankroll = bankrollForUser(entry, bets, quotes)
        const qualifying = qualifyingBetCount(bets, entry.user_id)
        return {
          entry,
          member: m,
          bankroll,
          qualifying,
          eligible: qualifying >= QUALIFYING_BETS,
        }
      })
      .sort((a, b) => b.bankroll - a.bankroll)
  }, [entries, bets, quotes, memberById])

  const eligibleRows = rows.filter((r) => r.eligible)
  const leadBankroll = eligibleRows[0]?.bankroll
  const leaders = eligibleRows.filter((r) => r.bankroll === leadBankroll)

  const chartData = useMemo(() => {
    const times = thinTimes([...new Set(snapshots.map((s) => s.captured_at))].sort(), MAX_CHART_POINTS)
    const points = times.map((t) => {
      const row: Record<string, string | number> = { t, label: timeLabel(t) }
      for (const e of entries) {
        const snap = snapshots
          .filter((s) => s.user_id === e.user_id && s.captured_at <= t)
          .at(-1)
        row[e.user_id] = snap ? Number(snap.bankroll) : Number(e.starting_bankroll)
      }
      return row
    })
    const live: Record<string, string | number> = { t: new Date().toISOString(), label: 'Now' }
    for (const r of rows) {
      live[r.entry.user_id] = Number(r.bankroll.toFixed(2))
    }
    return [...points, live]
  }, [snapshots, entries, memberById, rows])

  const lastIndex = Math.max(0, chartData.length - 1)

  async function onLock() {
    if (!confirm('Lock this week and crown the winner? New bets will be closed.')) return
    setMsg('')
    try {
      await lockWeek(week.id)
      await onRefresh()
    } catch (e) {
      setMsg(friendlyError(e, 'Could not lock'))
    }
  }

  async function onInvite() {
    setMsg('')
    try {
      const code = await createInvite(30)
      setInvite(code)
    } catch (e) {
      setMsg(friendlyError(e, 'Could not create invite'))
    }
  }

  const locked = week.status === 'locked'
  const winners = new Set(week.winner_user_ids ?? [])

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <p className="text-xs uppercase tracking-wide text-zinc-500">This Saturday</p>
        <h2 className="text-2xl font-semibold mt-1 tracking-tight">{shortDate(week.saturday_date)}</h2>
        <p className="text-zinc-400 text-sm mt-1">
          Prize pool <span className="text-emerald-400 font-semibold">{money(prizePool(entries.length))}</span>
          {' · '}$50 bankroll {' · '}$10 buy-in
        </p>
        {locked && (
          <p className="mt-2 text-sm text-gold-300">
            Week locked.{' '}
            {winners.size === 0
              ? 'No one hit 3 qualifying bets.'
              : `Winner${winners.size > 1 ? 's' : ''}: ${[...winners]
                  .map((id) => memberById[id]?.display_name ?? 'friend')
                  .join(', ')}`}
          </p>
        )}
      </section>

      <section className="card p-3">
        <div className="flex items-center justify-between px-1 pb-2">
          <h3 className="text-sm font-medium text-zinc-300">Bankroll</h3>
          <p className="text-[11px] text-zinc-500">Live · every few seconds</p>
        </div>
        <div className="h-60">
          {chartData.length === 0 ? (
            <p className="text-sm text-zinc-500 px-1">Log a bet to start the chart.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 18, right: 22, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 11 }} />
                <YAxis
                  tick={{ fill: '#71717a', fontSize: 11 }}
                  domain={['auto', 'auto']}
                  tickFormatter={(v: number) => `$${v}`}
                  width={42}
                />
                <Tooltip
                  contentStyle={{ background: '#111111', border: '1px solid #262626', borderRadius: 0 }}
                  formatter={(value) => money(Number(value))}
                />
                {rows.map((r) => {
                  const name = r.member?.display_name ?? 'Friend'
                  const color = r.member?.color ?? '#00d26a'
                  const letter = initials(name)
                  return (
                    <Line
                      key={r.entry.user_id}
                      type="monotone"
                      dataKey={r.entry.user_id}
                      name={name}
                      stroke={color}
                      strokeWidth={2}
                      isAnimationActive={false}
                      activeDot={false}
                      dot={(props) => {
                        const { cx, cy, index } = props
                        if (index !== lastIndex) return <g key={`${r.entry.user_id}-${index}`} />
                        return (
                          <ChartAvatarDot
                            key={`${r.entry.user_id}-now`}
                            cx={cx}
                            cy={cy}
                            letter={letter}
                            color={color}
                          />
                        )
                      }}
                    />
                  )
                })}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="flex flex-wrap gap-3 px-1 pt-2">
          {rows.map((r) => {
            const name = r.member?.display_name ?? 'Friend'
            return (
              <div key={r.entry.user_id} className="flex items-center gap-1.5 text-xs text-zinc-300">
                <PlayerAvatar name={name} color={r.member?.color ?? '#00d26a'} size={20} />
                {name}
              </div>
            )
          })}
        </div>
      </section>

      <section className="space-y-2">
        {rows.map((r, i) => {
          const isLead = r.eligible && leaders.some((l) => l.entry.user_id === r.entry.user_id)
          const won = winners.has(r.entry.user_id)
          const name = r.member?.display_name ?? 'Friend'
          return (
            <div key={r.entry.user_id} className="card p-3 flex items-center gap-3">
              <span className="text-zinc-600 w-4 text-sm tabular-nums">{i + 1}</span>
              <PlayerAvatar name={name} color={r.member?.color ?? '#3f3f46'} size={36} />
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate flex items-center gap-1">
                  {name}
                  {(isLead || won) && <Crown className="h-4 w-4 text-gold-400" />}
                </p>
                <p className="text-xs text-zinc-500">
                  {r.qualifying}/{QUALIFYING_BETS} qualifying
                  {r.eligible ? '' : ' · not eligible yet'}
                </p>
              </div>
              <p className="text-lg font-semibold tabular-nums">{money(r.bankroll)}</p>
            </div>
          )
        })}
        {rows.length === 0 && (
          <p className="text-sm text-zinc-500">Nobody has joined this week yet.</p>
        )}
      </section>

      {member.is_admin && (
        <section className="card p-4 space-y-3">
          <h3 className="font-medium flex items-center gap-2">
            <Ticket className="h-4 w-4 text-emerald-400" />
            Host tools
          </h3>
          {invite && (
            <p className="text-sm">
              New invite: <span className="font-mono text-emerald-400">{invite}</span>
            </p>
          )}
          {msg && <p className="text-sm text-red-400">{msg}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={onInvite}>
              New invite code
            </button>
            {!locked && (
              <button type="button" className="btn-secondary" onClick={onLock}>
                Lock week & crown
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
