import { Home, LayoutGrid, List, LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { AppView, SsMember, SsWeek } from '../lib/types'
import { shortDate } from '../lib/format'

interface Props {
  member: SsMember
  week: SsWeek | null
  view: AppView
  onChangeView: (v: AppView) => void
  children: ReactNode
}

export function Layout({ member, week, view, onChangeView, children }: Props) {
  return (
    <div className="min-h-dvh flex flex-col bg-zinc-950">
      <header className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur border-b border-zinc-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
          <div className="h-8 w-8 bg-emerald-400 text-black grid place-items-center font-bold text-[10px] tracking-tight shrink-0">
            CAC
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-tight truncate tracking-tight">CAC</h1>
            <p className="text-xs text-zinc-500 truncate">
              Clinically Addicted Challenge
              {' · '}
              {week ? shortDate(week.saturday_date) : 'CFB'}
              {' · '}
              {member.display_name}
            </p>
          </div>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="btn-ghost px-2"
            aria-label="Sign out"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-4 pb-28">{children}</main>

      <nav className="fixed bottom-0 inset-x-0 bg-zinc-900 border-t border-zinc-800 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-2xl mx-auto px-2 py-2 grid grid-cols-3">
          <NavButton
            label="Home"
            active={view === 'home'}
            onClick={() => onChangeView('home')}
            icon={<Home className="h-5 w-5" />}
          />
          <NavButton
            label="Markets"
            active={view === 'log'}
            onClick={() => onChangeView('log')}
            icon={<LayoutGrid className="h-5 w-5" />}
          />
          <NavButton
            label="Positions"
            active={view === 'bets'}
            onClick={() => onChangeView('bets')}
            icon={<List className="h-5 w-5" />}
          />
        </div>
      </nav>
    </div>
  )
}

function NavButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string
  active: boolean
  onClick: () => void
  icon: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 py-1 text-xs font-medium ${
        active ? 'text-emerald-400' : 'text-zinc-500'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
