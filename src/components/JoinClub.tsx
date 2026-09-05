import { useState } from 'react'
import { redeemInvite } from '../lib/api'
import { friendlyError } from '../lib/errors'
import type { SsMember } from '../lib/types'

export function JoinClub({ onJoined }: { onJoined: (m: SsMember) => void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const member = await redeemInvite(code, name)
      onJoined(member)
    } catch (err) {
      setError(friendlyError(err, 'Could not join'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-4 py-8 bg-zinc-950">
      <div className="w-full max-w-sm card p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 bg-emerald-400 text-black grid place-items-center font-bold text-xs tracking-tight">
            CAC
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Join CAC</h1>
            <p className="text-sm text-zinc-500">Clinically Addicted Challenge · ask a friend for the invite.</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="name">What should we call you?</label>
            <input
              id="name"
              required
              maxLength={32}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Kenny"
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="code">Invite code</label>
            <input
              id="code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="SAT-••••••"
              className="input font-mono tracking-wide"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Joining…' : 'Join the challenge'}
          </button>
        </form>
      </div>
    </div>
  )
}
