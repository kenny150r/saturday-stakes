import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from './lib/supabase'
import { MissingConfig, Splash } from './components/MissingConfig'
import { SignIn } from './components/SignIn'
import { JoinClub } from './components/JoinClub'
import { Layout } from './components/Layout'
import { HomeView } from './views/HomeView'
import { LogBetView } from './views/LogBetView'
import { BetsView } from './views/BetsView'
import {
  claimPending,
  ensureWeek,
  fetchBets,
  fetchEntries,
  fetchMembers,
  fetchMyMember,
  fetchQuotes,
  fetchSnapshots,
  joinWeek,
  refreshKalshiQuotes,
} from './lib/api'
import { friendlyError } from './lib/errors'
import type { AppView, SsBet, SsMember, SsQuote, SsSnapshot, SsWeek, SsWeekEntry } from './lib/types'

function tickersFromBets(bets: SsBet[]): string[] {
  return [
    ...new Set(
      bets.flatMap((b) => (b.legs ?? []).map((l) => l.kalshi_ticker).filter((t): t is string => Boolean(t))),
    ),
  ]
}

export default function App() {
  const [bootstrapped, setBootstrapped] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [member, setMember] = useState<SsMember | null>(null)
  const [memberLoading, setMemberLoading] = useState(false)
  const [view, setView] = useState<AppView>('home')
  const [week, setWeek] = useState<SsWeek | null>(null)
  const [members, setMembers] = useState<SsMember[]>([])
  const [entries, setEntries] = useState<SsWeekEntry[]>([])
  const [bets, setBets] = useState<SsBet[]>([])
  const [quotes, setQuotes] = useState<SsQuote[]>([])
  const [snapshots, setSnapshots] = useState<SsSnapshot[]>([])
  const [error, setError] = useState('')

  const betsRef = useRef<SsBet[]>([])
  const weekRef = useRef<SsWeek | null>(null)
  const bootstrapLock = useRef<Promise<void> | null>(null)
  const clubLock = useRef(false)
  const quoteLock = useRef(false)

  betsRef.current = bets
  weekRef.current = week

  useEffect(() => {
    if (!supabaseConfigured) {
      setBootstrapped(true)
      return
    }
    let mounted = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setBootstrapped(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) {
      setMember(null)
      setWeek(null)
      return
    }
    let cancelled = false
    setMemberLoading(true)
    fetchMyMember()
      .then(async (m) => {
        if (m) return m
        return claimPending()
      })
      .then((m) => {
        if (!cancelled) setMember(m)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(friendlyError(e, 'Failed to load profile'))
      })
      .finally(() => {
        if (!cancelled) setMemberLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session])

  const refreshQuotes = useCallback(async () => {
    if (quoteLock.current) return
    const tickers = tickersFromBets(betsRef.current)
    if (tickers.length === 0) return
    quoteLock.current = true
    try {
      const live = await refreshKalshiQuotes(tickers)
      if (live.length) setQuotes(live)
    } catch {
      // Keep last stored quotes if Kalshi is unreachable.
    } finally {
      quoteLock.current = false
    }
  }, [])

  const refreshClub = useCallback(async (weekId: string) => {
    if (clubLock.current) return
    clubLock.current = true
    try {
      const tickers = tickersFromBets(betsRef.current)
      const [ms, es, bs, snaps, stored, me] = await Promise.all([
        fetchMembers(),
        fetchEntries(weekId),
        fetchBets(weekId),
        fetchSnapshots(weekId),
        fetchQuotes(tickers),
        fetchMyMember().catch(() => null),
      ])
      setMembers(ms)
      setEntries(es)
      setBets(bs)
      setSnapshots(snaps)
      if (me) setMember(me)
      if (stored.length) setQuotes(stored)
      const openTickers = tickersFromBets(bs)
      if (openTickers.length) {
        try {
          const live = await refreshKalshiQuotes(openTickers)
          if (live.length) setQuotes(live)
        } catch {
          /* last stored quotes */
        }
      }
    } finally {
      clubLock.current = false
    }
  }, [])

  const bootstrapWeek = useCallback(async () => {
    if (bootstrapLock.current) return bootstrapLock.current
    const run = (async () => {
      const w = await ensureWeek()
      await joinWeek(w.id)
      weekRef.current = w
      setWeek(w)
      await refreshClub(w.id)
    })()
    bootstrapLock.current = run
    try {
      await run
    } finally {
      bootstrapLock.current = null
    }
  }, [refreshClub])

  useEffect(() => {
    if (!member) return
    setError('')
    void bootstrapWeek().catch((e: unknown) =>
      setError(friendlyError(e, 'Failed to load this week')),
    )
  }, [member?.user_id, bootstrapWeek])

  useEffect(() => {
    if (!week) return
    const channel = supabase
      .channel(`ss-${week.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ss_bets' }, () => {
        void refreshClub(week.id).catch(() => undefined)
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ss_bankroll_snapshots' },
        () => {
          void refreshClub(week.id).catch(() => undefined)
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ss_market_quotes' }, () => {
        void refreshQuotes().catch(() => undefined)
      })
      .subscribe()
    const quotesPoll = window.setInterval(() => {
      void refreshQuotes()
    }, 5000)
    const clubPoll = window.setInterval(() => {
      void refreshClub(week.id).catch(() => undefined)
    }, 20000)
    return () => {
      void supabase.removeChannel(channel)
      window.clearInterval(quotesPoll)
      window.clearInterval(clubPoll)
    }
  }, [week?.id, refreshClub, refreshQuotes])

  if (!supabaseConfigured) return <MissingConfig />
  if (!bootstrapped) return <Splash />
  if (!session) return <SignIn />
  if (memberLoading) return <Splash />
  if (!member) return <JoinClub onJoined={setMember} />

  const myEntry = entries.find((e) => e.user_id === member.user_id) ?? null

  return (
    <Layout member={member} week={week} view={view} onChangeView={setView}>
      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
      {!week && <p className="text-sm text-zinc-400">Opening this Saturday’s challenge…</p>}
      {week && view === 'home' && (
        <HomeView
          member={member}
          week={week}
          members={members}
          entries={entries}
          bets={bets}
          quotes={quotes}
          snapshots={snapshots}
          onRefresh={() => refreshClub(week.id)}
        />
      )}
      {week && view === 'log' && (
        <LogBetView
          week={week}
          member={member}
          entry={myEntry}
          bets={bets}
          onPlaced={async () => {
            await refreshClub(week.id)
            setView('bets')
          }}
        />
      )}
      {week && view === 'bets' && (
        <BetsView
          member={member}
          week={week}
          bets={bets}
          quotes={quotes}
          members={members}
          onChanged={() => refreshClub(week.id)}
        />
      )}
    </Layout>
  )
}
