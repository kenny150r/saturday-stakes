export function MissingConfig() {
  return (
    <div className="min-h-dvh grid place-items-center px-4 bg-zinc-950">
      <div className="card p-8 max-w-md">
        <h1 className="text-xl font-semibold mb-2">Supabase isn’t configured</h1>
        <p className="text-sm text-zinc-400">
          Copy <code className="text-emerald-400">.env.example</code> to{' '}
          <code className="text-emerald-400">.env.local</code> with the House Fund Tracker URL and
          publishable key.
        </p>
      </div>
    </div>
  )
}

export function Splash() {
  return (
    <div className="min-h-dvh grid place-items-center bg-zinc-950 text-zinc-500 text-sm">Loading…</div>
  )
}
