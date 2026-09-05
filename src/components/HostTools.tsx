import { useEffect, useState } from 'react'
import { Ticket, Users } from 'lucide-react'
import {
  addMember,
  createInvite,
  listPending,
  listRoster,
  lockWeek,
  removeMember,
  removePending,
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import { PlayerAvatar } from './PlayerAvatar'
import type { SsMember, SsPendingMember, SsRosterMember, SsWeek } from '../lib/types'

interface Props {
  member: SsMember
  week: SsWeek
  members: SsMember[]
  onRefresh: () => Promise<void>
}

export function HostTools({ member, week, members, onRefresh }: Props) {
  const [invite, setInvite] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [pending, setPending] = useState<SsPendingMember[]>([])
  const [roster, setRoster] = useState<SsRosterMember[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([listPending(), listRoster()])
      .then(([pendingRows, rosterRows]) => {
        if (cancelled) return
        setPending(pendingRows)
        setRoster(rosterRows)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [members.length])

  async function refreshLists() {
    try {
      const [pendingRows, rosterRows] = await Promise.all([listPending(), listRoster()])
      setPending(pendingRows)
      setRoster(rosterRows)
    } catch {
      /* keep last list */
    }
  }

  async function onInvite() {
    setMsg('')
    setOk('')
    try {
      const code = await createInvite(30)
      setInvite(code)
    } catch (e) {
      setMsg(friendlyError(e, 'Could not create invite'))
    }
  }

  async function onLock() {
    if (!confirm('Lock this week and crown the winner? New bets will be closed.')) return
    setMsg('')
    setOk('')
    try {
      await lockWeek(week.id)
      await onRefresh()
    } catch (e) {
      setMsg(friendlyError(e, 'Could not lock'))
    }
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    setOk('')
    try {
      const result = await addMember(email, displayName)
      setEmail('')
      setDisplayName('')
      if (result.status === 'joined') {
        setOk(`${result.display_name} is in the club.`)
      } else {
        setOk(`${result.display_name} will join the next time they sign in.`)
      }
      await onRefresh()
      await refreshLists()
    } catch (err) {
      setMsg(friendlyError(err, 'Could not add member'))
    } finally {
      setBusy(false)
    }
  }

  async function onRemove(m: { user_id: string; display_name: string }) {
    if (
      !confirm(
        `Remove ${m.display_name} from the club? Their bets this week will be deleted.`,
      )
    ) {
      return
    }
    setMsg('')
    setOk('')
    try {
      await removeMember(m.user_id)
      await onRefresh()
      await refreshLists()
    } catch (err) {
      setMsg(friendlyError(err, 'Could not remove member'))
    }
  }

  async function onRemovePending(p: SsPendingMember) {
    if (!confirm(`Drop the pending invite for ${p.display_name}?`)) return
    setMsg('')
    setOk('')
    try {
      await removePending(p.email)
      await refreshLists()
    } catch (err) {
      setMsg(friendlyError(err, 'Could not drop pending member'))
    }
  }

  const locked = week.status === 'locked'

  return (
    <section className="card p-4 space-y-4">
      <h3 className="font-medium flex items-center gap-2">
        <Ticket className="h-4 w-4 text-emerald-400" />
        Host tools
      </h3>
      {invite && (
        <p className="text-sm">
          New invite: <span className="font-mono text-emerald-400">{invite}</span>
        </p>
      )}
      {ok && <p className="text-sm text-emerald-400">{ok}</p>}
      {msg && <p className="text-sm text-red-400">{msg}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => void onInvite()}>
          New invite code
        </button>
        {!locked && (
          <button type="button" className="btn-secondary" onClick={() => void onLock()}>
            Lock week & crown
          </button>
        )}
      </div>

      <div className="border-t border-zinc-800 pt-4 space-y-3">
        <h4 className="text-sm font-medium flex items-center gap-2 text-zinc-300">
          <Users className="h-4 w-4 text-emerald-400" />
          Members
        </h4>
        <ul className="space-y-2">
          {(roster.length > 0 ? roster : members.map((m) => ({ ...m, email: '' }))).map((m) => {
            const self = m.user_id === member.user_id
            const color = members.find((x) => x.user_id === m.user_id)?.color ?? '#3f3f46'
            return (
              <li key={m.user_id} className="flex items-center gap-2">
                <PlayerAvatar name={m.display_name} color={color} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">
                    {m.display_name}
                    {self ? ' · you' : ''}
                    {m.is_admin ? ' · admin' : ''}
                  </p>
                  {m.email && <p className="text-xs text-zinc-500 truncate">{m.email}</p>}
                </div>
                {!self && (
                  <button
                    type="button"
                    className="btn-danger text-xs py-1.5 px-3"
                    onClick={() => void onRemove(m)}
                  >
                    Remove
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        {pending.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Waiting to sign in</p>
            {pending.map((p) => (
              <div key={p.email} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{p.display_name}</p>
                  <p className="text-xs text-zinc-500 truncate">{p.email}</p>
                </div>
                <button
                  type="button"
                  className="btn-secondary text-xs py-1.5 px-3"
                  onClick={() => void onRemovePending(p)}
                >
                  Drop
                </button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={(e) => void onAdd(e)} className="space-y-2">
          <p className="text-xs text-zinc-500">
            Add someone by email. If they already have an account, they join now. Otherwise they
            skip the invite code the first time they sign in.
          </p>
          <input
            className="input"
            type="email"
            required
            autoComplete="off"
            placeholder="friend@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="input"
            required
            maxLength={32}
            placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <button type="submit" disabled={busy} className="btn-secondary w-full">
            {busy ? 'Adding…' : 'Add member'}
          </button>
        </form>
      </div>
    </section>
  )
}
