import { apiGet, apiSend } from './client'
import type { OAuthProvider } from './auth'

/**
 * A provider's *calendar* grant, which is a strictly bigger ask than signing in:
 * reading and editing the user's calendar. `null` on a provider that has no
 * calendar integration at all (Lark, today), which is why the Account page can tell
 * "this provider has no calendar to offer" apart from "connected: false".
 */
export interface CalendarConnection {
  connected: boolean
  account_email: string | null
  /** The scope string actually granted, verbatim from the provider. */
  scopes: string
}

/**
 * One provider's two independent facts. `signin_connected` is identity only — it
 * says nothing about the calendar, and the Account page must never let the two
 * read as one switch.
 */
export interface ProviderIntegration {
  /** The server has OAuth credentials for this provider (env vars set). */
  configured: boolean
  /** This user can sign in with this provider. */
  signin_connected: boolean
  calendar: CalendarConnection | null
}

export interface Integrations {
  google: ProviderIntegration
  lark: ProviderIntegration
}

/** One event read from a connected external calendar. Deliberately *not* an
 *  `AveryEvent`: it has no id, no tags, no completion, and nothing about it may
 *  ever be written back or counted. See `lib/externalEvents.ts`. */
export interface ExternalEvent {
  external_id: string
  title: string
  /** Naive local `YYYY-MM-DDTHH:MM:SS` (or `YYYY-MM-DD` for an all-day event). */
  start_at: string
  /** Exclusive, same as everywhere else in this app. */
  end_at: string
  all_day: boolean
  calendar_name: string
  account_email: string
}

export const getIntegrations = () => apiGet<Integrations>('/integrations')

/** 501 when the server has no Google credentials — the detail names the missing
 *  env vars, and the Account page shows it inline rather than as a failure. */
export const googleAuthorizeUrl = () =>
  apiGet<{ authorize_url: string }>('/integrations/google/authorize')

export const disconnectGoogleCalendar = () =>
  apiSend<void>('DELETE', '/integrations/google/calendar')

/** 409 when the calendar isn't connected — a state, not an error. `useGoogleEvents`
 *  maps it to an empty list. */
export const getGoogleEvents = (start: string, end: string) =>
  apiGet<ExternalEvent[]>('/integrations/google/events', { start, end })

export type { OAuthProvider }

/** Mirrors the provider's events for [start, end) into Avery's events table.
 *  409 when no calendar is connected. */
export const syncExternalCalendar = (
  provider: 'google' | 'lark',
  start: string,
  end: string,
) =>
  apiSend<{ created: number; updated: number; pruned: number }>(
    'POST',
    `/integrations/${provider}/sync?${new URLSearchParams({ start, end })}`,
  )
