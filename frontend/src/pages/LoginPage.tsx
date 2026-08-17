import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'

import { errorMessage } from '../api/client'
import { oauthStart } from '../api/auth'
import type { OAuthProvider } from '../api/auth'
import { IconGoogle, IconLark } from '../components/icons'
import { useLinkOAuth, useLogin, useMe, useSignup } from '../hooks/useAuth'

const INPUT = 'rounded-[8px] border border-line bg-surface px-2 py-1.5 text-sm text-ink'
const PRIMARY =
  'rounded-[8px] bg-[var(--pale)] px-3 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-50'
const PROVIDER_BUTTON =
  'flex w-full items-center justify-center gap-2 rounded-[8px] border border-line bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-[var(--pale)]/50 disabled:opacity-50'

function LabelledField({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-faint">{hint}</span>}
    </label>
  )
}

/**
 * The signed-out face of the app, at its own URL (`/login`). The AuthGate in App.tsx
 * redirects here whenever there is no session, and a successful sign-in redirects to
 * the dashboard (`/`) — the address bar always says which side of the gate you're on.
 *
 * Also hosts the OAuth link step: the backend's callback redirects to
 * `/login?link_token=...` (plus `provider` and `email_hint`), and the token in the
 * URL selects the link card instead of the sign-in form.
 */
export default function LoginPage() {
  const [params] = useSearchParams()
  const linkToken = params.get('link_token')

  // Already signed in — /login has nothing to offer; go to the dashboard. Covers
  // both a bookmarked /login and the moment right after a successful sign-in below.
  const me = useMe()
  if (me.data) return <Navigate to="/" replace />

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <img src="/avery-logo.png" alt="" width={48} height={48} />
          <span className="font-display text-2xl font-semibold tracking-tight">Avery</span>
        </div>
        <div className="rounded-[12px] border border-line bg-surface p-6">
          {linkToken ? (
            <LinkAccountCard
              linkToken={linkToken}
              provider={params.get('provider')}
              emailHint={params.get('email_hint') ?? ''}
            />
          ) : (
            <CredentialsCard />
          )}
        </div>
      </div>
    </div>
  )
}

function CredentialsCard() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // One note under the provider buttons, not one per provider — only one can have
  // been clicked last, and 501's detail already names which provider is unconfigured.
  const [oauthNote, setOauthNote] = useState<string | null>(null)
  const [oauthPending, setOauthPending] = useState<OAuthProvider | null>(null)

  const loginMutation = useLogin()
  const signupMutation = useSignup()
  const active = mode === 'signin' ? loginMutation : signupMutation

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (active.isPending) return
    // No explicit navigation on success: the mutations seed the `me` cache, and the
    // `me.data` redirect at the top of this component sends the user to the
    // dashboard on the very next render.
    if (mode === 'signin') loginMutation.mutate({ email, password })
    else signupMutation.mutate({ email, password, name })
  }

  const startOAuth = async (provider: OAuthProvider) => {
    setOauthNote(null)
    setOauthPending(provider)
    try {
      const { authorize_url } = await oauthStart(provider)
      window.location.assign(authorize_url)
      // Keep the button in its pending state while the browser navigates away.
    } catch (error) {
      // Most commonly a 501: credentials unconfigured, detail names the env vars.
      setOauthPending(null)
      setOauthNote(errorMessage(error))
    }
  }

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {mode === 'signup' && (
          <LabelledField label="Name">
            <input
              className={INPUT}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </LabelledField>
        )}
        <LabelledField label="Email">
          <input
            className={INPUT}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </LabelledField>
        <LabelledField label="Password">
          <input
            className={INPUT}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
          />
        </LabelledField>

        {active.isError && <p className="text-xs text-[var(--over)]">{errorMessage(active.error)}</p>}

        <button type="submit" className={PRIMARY} disabled={active.isPending}>
          {mode === 'signin'
            ? active.isPending
              ? 'Signing in…'
              : 'Sign in'
            : active.isPending
              ? 'Creating account…'
              : 'Create account'}
        </button>
      </form>

      <button
        type="button"
        className="mt-3 text-xs text-ink-muted underline-offset-2 hover:underline"
        onClick={() => {
          setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
          loginMutation.reset()
          signupMutation.reset()
        }}
      >
        {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
      </button>

      <div className="my-4 flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-[var(--line)]" />
        <span className="text-xs text-ink-faint">or</span>
        <span className="h-px flex-1 bg-[var(--line)]" />
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className={PROVIDER_BUTTON}
          disabled={oauthPending !== null}
          onClick={() => startOAuth('google')}
        >
          <IconGoogle />
          Continue with Google
        </button>
        <button
          type="button"
          className={PROVIDER_BUTTON}
          disabled={oauthPending !== null}
          onClick={() => startOAuth('lark')}
        >
          <IconLark />
          Continue with Lark
        </button>
        {oauthNote && <p className="text-xs text-ink-faint">{oauthNote}</p>}
      </div>
    </>
  )
}

/** The step after the OAuth provider redirects back: attach that identity to an
 *  email. Password only matters if the email already has one — the backend answers
 *  403 when it's wrong or missing in that case. */
function LinkAccountCard({
  linkToken,
  provider,
  emailHint,
}: {
  linkToken: string
  provider: string | null
  emailHint: string
}) {
  const [email, setEmail] = useState(emailHint)
  const linkMutation = useLinkOAuth()

  const providerName = provider === 'lark' ? 'Lark' : provider === 'google' ? 'Google' : 'your provider'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (linkMutation.isPending) return
    linkMutation.mutate(
      { link_token: linkToken, email },
      // Hard reload, not a router navigation: the cookie is now set, and a fresh
      // document drops both the ?link_token= URL and every trace of pre-login state.
      { onSuccess: () => window.location.assign('/') },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg">Link your account</h1>
        {/* Reached only when the provider would not vouch for an email address —
         *  when it does, the callback links silently and this card never appears.
         *  An address that already has an account is joined to it; one that doesn't
         *  starts a new one. Either way the user types an address and nothing else. */}
        <p className="mt-1 text-xs text-ink-muted">
          Signing in with {providerName}. {providerName} didn't tell us your email
          address, so enter it — we'll use it to find your account, or start one.
        </p>
      </div>
      <LabelledField label="Email">
        <input
          className={INPUT}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </LabelledField>

      {linkMutation.isError && (
        <p className="text-xs text-[var(--over)]">{errorMessage(linkMutation.error)}</p>
      )}

      <button type="submit" className={PRIMARY} disabled={linkMutation.isPending}>
        {linkMutation.isPending ? 'Creating…' : 'Continue'}
      </button>
    </form>
  )
}
