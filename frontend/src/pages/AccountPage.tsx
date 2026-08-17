import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'

import { errorMessage } from '../api/client'
import type { Me, OAuthProvider } from '../api/auth'
import type { ProviderIntegration } from '../api/integrations'
import { IconGoogle, IconLark } from '../components/icons'
import { InlineText } from '../components/InlineText'
import {
  useCalendarAuthorize,
  useDisconnectCalendar,
  useIntegrations,
  useLogout,
  useMe,
  useUpdateMe,
  useUpdatePassword,
} from '../hooks/useAuth'
import { avatarColor, avatarInitial } from '../lib/avatar'

const INPUT = 'rounded-[8px] border border-line bg-surface px-2 py-1.5 text-sm text-ink'
const BUTTON =
  'rounded-[8px] bg-[var(--pale)] px-3 py-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-50'

export default function AccountPage() {
  const me = useMe()

  // The AuthGate in App.tsx only renders the app when a user exists, so this is a
  // formality for the type system — not a state a signed-in user can reach.
  if (!me.data) return null

  return (
    <div className="mx-auto max-w-2xl p-6">
      <ProfileCard user={me.data} />
      <SignInMethodsCard />
      <CalendarCard />
    </div>
  )
}

function ProfileCard({ user }: { user: Me }) {
  const updateMe = useUpdateMe()
  const logoutMutation = useLogout()
  const [passwordOpen, setPasswordOpen] = useState(false)

  const memberSince = new Date(user.created_at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <section className="rounded-[12px] border border-line bg-surface p-5">
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold text-ink"
          style={{ background: avatarColor(user.id) }}
        >
          {avatarInitial(user.name, user.email)}
        </span>
        <div className="min-w-0 flex-1">
          <InlineText
            value={user.name}
            ariaLabel="Name"
            className="text-base font-semibold"
            onCommit={(name) => updateMe.mutate({ name })}
          />
          <InlineText
            value={user.email}
            ariaLabel="Email"
            className="text-sm text-ink-muted"
            onCommit={(email) => updateMe.mutate({ email })}
          />
        </div>
      </div>

      {updateMe.isError && (
        <p className="mt-2 text-xs text-[var(--over)]">{errorMessage(updateMe.error)}</p>
      )}

      <p className="mt-3 text-xs text-ink-faint">Member since {memberSince}</p>

      <div className="mt-4 border-t border-line pt-4">
        <button
          type="button"
          className="text-sm font-medium text-ink-muted transition-colors hover:text-ink"
          aria-expanded={passwordOpen}
          onClick={() => setPasswordOpen((v) => !v)}
        >
          {passwordOpen ? '▾' : '▸'} {user.has_password ? 'Change password' : 'Set a password'}
        </button>
        {passwordOpen && <PasswordForm hasPassword={user.has_password} />}
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <button
          type="button"
          className={BUTTON}
          disabled={logoutMutation.isPending}
          // No navigation on success: logout clears the `me` cache and the AuthGate
          // swaps the whole app for LoginPage by itself.
          onClick={() => logoutMutation.mutate()}
        >
          {logoutMutation.isPending ? 'Signing out…' : 'Sign out'}
        </button>
        {logoutMutation.isError && (
          <p className="mt-2 text-xs text-[var(--over)]">{errorMessage(logoutMutation.error)}</p>
        )}
      </div>
    </section>
  )
}

/** `hasPassword` decides whether a current-password field appears — an account
 *  created purely via OAuth has none to confirm. */
function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const updatePassword = useUpdatePassword()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [saved, setSaved] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (updatePassword.isPending) return
    setSaved(false)
    updatePassword.mutate(
      { current_password: hasPassword ? current : undefined, new_password: next },
      {
        onSuccess: () => {
          setCurrent('')
          setNext('')
          setSaved(true)
        },
      },
    )
  }

  return (
    <form onSubmit={submit} className="mt-3 flex max-w-xs flex-col gap-2">
      {hasPassword && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Current password</span>
          <input
            className={INPUT}
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-muted">New password</span>
        <input
          className={INPUT}
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      {updatePassword.isError && (
        <p className="text-xs text-[var(--over)]">{errorMessage(updatePassword.error)}</p>
      )}
      {saved && <p className="text-xs text-[var(--pass)]">Password updated.</p>}
      <button type="submit" className={`${BUTTON} self-start`} disabled={updatePassword.isPending}>
        {updatePassword.isPending ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
      </button>
    </form>
  )
}

const PROVIDERS: { key: OAuthProvider; name: string; Icon: typeof IconGoogle }[] = [
  { key: 'google', name: 'Google', Icon: IconGoogle },
  { key: 'lark', name: 'Lark', Icon: IconLark },
]

/** Identity only: which providers can put you through the front door.
 *
 *  Deliberately its own card, apart from Calendar below. Signing in with Google and
 *  letting Avery read your Google Calendar are separate consents with separate
 *  lifetimes — one switch for both would make it impossible to tell which you have,
 *  or to give up one without the other. */
function SignInMethodsCard() {
  const integrations = useIntegrations()

  return (
    <section className="mt-5 rounded-[12px] border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink">Sign-in methods</h2>
      <p className="mt-1 text-xs text-ink-faint">
        Ways to get into this account. These grant no access to your calendars.
      </p>
      {integrations.isLoading && <p className="mt-3 text-xs text-ink-faint">Checking…</p>}
      {integrations.isError && (
        <p className="mt-3 text-xs text-ink-faint">Couldn't load sign-in methods.</p>
      )}
      {integrations.data && (
        <ul className="mt-3">
          {PROVIDERS.map(({ key, name, Icon }) => {
            const status = integrations.data[key]
            return (
              <li
                key={key}
                className="flex items-start justify-between gap-3 border-t border-line py-3 first:border-t-0"
              >
                <div className="flex items-center gap-2.5">
                  <Icon />
                  <span className="text-sm font-medium">{name}</span>
                </div>
                <div className="flex max-w-[60%] flex-col items-end gap-1 text-right">
                  {status.signin_connected ? (
                    <span className="rounded-full bg-[var(--pale)] px-2.5 py-0.5 text-xs font-medium text-ink">
                      Enabled
                    </span>
                  ) : status.configured ? (
                    <span className="text-xs text-ink-faint">
                      Sign out and use “Continue with {name}” to enable it.
                    </span>
                  ) : (
                    <>
                      <span className="text-xs text-ink-faint">Not configured</span>
                      <span className="text-xs text-ink-faint">
                        The server has no {name} credentials yet.
                      </span>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** The bigger ask: permission to read and edit an external calendar. */
function CalendarCard() {
  const integrations = useIntegrations()
  const [params, setParams] = useSearchParams()
  const justConnected = params.get('connected')

  // The backend lands here after the consent round-trip. Strip the param once seen,
  // with `replace`, so a reload does not re-announce a connection made minutes ago.
  useEffect(() => {
    if (!justConnected) return
    const timer = window.setTimeout(() => {
      setParams(
        (prev) => {
          prev.delete('connected')
          return prev
        },
        { replace: true },
      )
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [justConnected, setParams])

  // Driven by what the server reports rather than a hardcoded list: a provider
  // appears here the moment its backend spec declares a calendar scope.
  const providers = ([
    { key: 'google', name: 'Google Calendar', Icon: IconGoogle },
    { key: 'lark', name: 'Lark Calendar', Icon: IconLark },
  ] as const).filter(({ key }) => integrations.data?.[key]?.calendar)

  return (
    <section className="mt-5 rounded-[12px] border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink">Calendar</h2>
      <p className="mt-1 text-xs text-ink-faint">
        Permission to read and edit an external calendar, so its events can appear
        alongside your week. Separate from signing in — you can grant one without the
        other, and revoke either on its own.
      </p>

      {justConnected && (
        <p className="mt-3 text-xs" style={{ color: 'var(--pass)' }}>
          Calendar connected.
        </p>
      )}
      {integrations.isLoading && <p className="mt-3 text-xs text-ink-faint">Checking…</p>}
      {integrations.isError && (
        <p className="mt-3 text-xs text-ink-faint">Couldn't load calendar status.</p>
      )}

      {providers.length > 0 && (
        <ul className="mt-3">
          {providers.map(({ key, name, Icon }) => (
            <CalendarRow
              key={key}
              provider={key}
              name={name}
              Icon={Icon}
              status={integrations.data![key]}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function CalendarRow({
  provider,
  name,
  Icon,
  status,
}: {
  provider: OAuthProvider
  name: string
  Icon: typeof IconGoogle
  status: ProviderIntegration
}) {
  const authorize = useCalendarAuthorize()
  const disconnect = useDisconnectCalendar()
  // Two-step, like VersionDeleteButton: revoking access is not something to do on a
  // stray click, and an undo would mean re-running the whole consent round-trip.
  const [armed, setArmed] = useState(false)

  const calendar = status.calendar

  return (
    <li className="flex items-start justify-between gap-3 border-t border-line py-3 first:border-t-0">
      <div className="flex items-center gap-2.5">
        <Icon />
        <div>
          <div className="text-sm font-medium">{name}</div>
          {calendar?.connected && calendar.account_email && (
            <div className="text-xs text-ink-faint">{calendar.account_email}</div>
          )}
        </div>
      </div>

      <div className="flex max-w-[60%] flex-col items-end gap-1 text-right">
        {!status.configured ? (
          <>
            <span className="text-xs text-ink-faint">Not configured</span>
            <span className="text-xs text-ink-faint">
              The server has no {name} credentials yet.
            </span>
          </>
        ) : calendar?.connected ? (
          <>
            <span className="rounded-full bg-[var(--pale)] px-2.5 py-0.5 text-xs font-medium text-ink">
              Connected
            </span>
            <button
              type="button"
              className="text-xs text-ink-faint transition-colors hover:text-[var(--over)]"
              disabled={disconnect.isPending}
              onClick={() => (armed ? disconnect.mutate(provider) : setArmed(true))}
              onBlur={() => setArmed(false)}
            >
              {disconnect.isPending ? 'Disconnecting…' : armed ? 'Click again to confirm' : 'Disconnect'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className={BUTTON}
            disabled={authorize.isPending}
            onClick={() =>
              authorize.mutate(provider, {
                onSuccess: ({ authorize_url }) => window.location.assign(authorize_url),
              })
            }
          >
            {authorize.isPending ? 'Opening…' : 'Connect'}
          </button>
        )}
        {authorize.isError && (
          <span className="text-xs text-ink-faint">{errorMessage(authorize.error)}</span>
        )}
        {disconnect.isError && (
          <span className="text-xs text-ink-faint">{errorMessage(disconnect.error)}</span>
        )}
      </div>
    </li>
  )
}
