import { useState } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup'

export function SignIn() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [infoMsg, setInfoMsg] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) return
    setSubmitting(true)
    setErrorMsg('')
    setInfoMsg('')
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) setErrorMsg(error.message)
    } else {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: window.location.href },
      })
      if (error) {
        setErrorMsg(error.message)
      } else {
        setInfoMsg(
          'Account created. If email confirmation is on, check your inbox — otherwise you can sign in now.',
        )
        setMode('signin')
      }
    }
    setSubmitting(false)
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-4 py-8 bg-zinc-950">
      <div className="w-full max-w-sm card p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 bg-emerald-400 text-black grid place-items-center font-bold text-xs tracking-tight">
            CAC
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-tight tracking-tight">CAC</h1>
            <p className="text-sm text-zinc-500">Clinically Addicted Challenge</p>
          </div>
        </div>

        <div role="tablist" className="grid grid-cols-2 gap-px bg-zinc-800 border border-zinc-800 mb-4 text-sm">
          {(
            [
              { id: 'signin', label: 'Sign in' },
              { id: 'signup', label: 'Create account' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={mode === t.id}
              onClick={() => {
                setMode(t.id)
                setErrorMsg('')
                setInfoMsg('')
              }}
              className={`py-1.5 font-medium transition-colors ${
                mode === t.id ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
            />
          </div>
          {errorMsg && <p className="text-sm text-red-400">{errorMsg}</p>}
          {infoMsg && <p className="text-sm text-emerald-400">{infoMsg}</p>}
          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
