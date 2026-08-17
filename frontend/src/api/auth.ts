import { apiGet, apiSend } from './client'
import type { Integrations } from './integrations'

export type OAuthProvider = 'google' | 'lark'

export interface Me {
  id: number
  email: string
  name: string
  /** False for accounts created purely via OAuth — they have no password to "change",
   *  so the password form offers "set" instead and skips the current-password field. */
  has_password: boolean
  providers: OAuthProvider[]
  created_at: string
}

// The integrations shape lives in `api/integrations.ts` — one definition, because
// two drifted apart the moment sign-in and calendar became separate facts.

/** 401 means "not logged in" — see useMe, which maps it to `null` rather than an error. */
export const getMe = () => apiGet<Me>('/auth/me')

export const signup = (body: { email: string; password: string; name: string }) =>
  apiSend<Me>('POST', '/auth/signup', body)

export const login = (body: { email: string; password: string }) =>
  apiSend<Me>('POST', '/auth/login', body)

export const logout = () => apiSend<void>('POST', '/auth/logout')

export const updateMe = (body: { name?: string; email?: string }) =>
  apiSend<Me>('PATCH', '/auth/me', body)

/** `current_password` is only required when the account already has one
 *  (`Me.has_password`) — an OAuth-only account sets its first password without it. */
export const updatePassword = (body: { current_password?: string; new_password: string }) =>
  apiSend<void>('PATCH', '/auth/me/password', body)

/** 501 when the server has no credentials for this provider — the detail names the
 *  missing env vars, and the login page surfaces it as a quiet inline note. */
export const oauthStart = (provider: OAuthProvider) =>
  apiGet<{ authorize_url: string }>(`/auth/oauth/${provider}/start`)

/** Finishes an OAuth signup when the provider gave no verified email: exchanges the
 *  `link_token` plus an address for a session cookie.
 *
 *  No password, deliberately. A verified address is auto-linked in the callback and
 *  never reaches here; an unverified one proves nothing about who typed it, so the
 *  server answers 409 rather than accepting a password as a substitute for proof. */
export const oauthLink = (body: { link_token: string; email: string }) =>
  apiSend<Me>('POST', '/auth/oauth/link', body)

export const getIntegrations = () => apiGet<Integrations>('/integrations')

/** Calendar sync is a later phase — the backend answers 501 for now, and the
 *  Connections card shows that detail inline. */
/** Starts the calendar consent. 501 when the server has no credentials. */
export const calendarAuthorize = (provider: OAuthProvider) =>
  apiGet<{ authorize_url: string }>(`/integrations/${provider}/authorize`)

/** Drops the stored calendar tokens. Sign-in is untouched — the two are separate
 *  consents, and this is the one the user chose to revoke. */
export const disconnectCalendar = (provider: OAuthProvider) =>
  apiSend<void>('DELETE', `/integrations/${provider}/calendar`)
