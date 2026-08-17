import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '../api/client'
import {
  calendarAuthorize,
  disconnectCalendar,
  getIntegrations,
  getMe,
  login,
  logout,
  oauthLink,
  signup,
  updateMe,
  updatePassword,
} from '../api/auth'
import type { Me, OAuthProvider } from '../api/auth'
import type { Integrations } from '../api/integrations'

export const qkMe = ['auth', 'me'] as const
export const qkIntegrations = ['integrations'] as const

/**
 * The signed-in user, or `null` when there isn't one.
 *
 * A 401 here is the normal signed-out state, not a failure — so the queryFn maps it
 * to `null` instead of throwing, and the query resolves as a success. That keeps
 * `error` reserved for things that are actually wrong (server down, 500s) and stops
 * React Query from retry-hammering /auth/me three times just to learn the user is
 * logged out. `retry: false` for the same reason: the gate in App.tsx sits on this
 * query, and retries would only stretch the splash screen.
 */
export function useMe() {
  return useQuery<Me | null>({
    queryKey: qkMe,
    queryFn: async () => {
      try {
        return await getMe()
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    retry: false,
  })
}

/**
 * Crossing an auth boundary drops the ENTIRE cache — `invalidateQueries()` with no
 * filter, deliberately. The app's rule (see `src/api/invalidate.ts`) is to never
 * hand-roll a short invalidation list, because every bug in that file's history came
 * from invalidating a subset. Here the subset isn't just risky, it's a leak: after a
 * login/logout the session cookie names a different user, and any cached week, task,
 * or tag list still in memory belongs to the previous one. A blanket invalidation is
 * the only list that can't rot as new query keys are added.
 */
function invalidateEverything(queryClient: QueryClient) {
  queryClient.invalidateQueries()
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => login(body),
    onSuccess: (user) => {
      // Seed `me` synchronously so the gate flips to the app without waiting a
      // round-trip; the blanket invalidation still refetches it (and everything else).
      queryClient.setQueryData(qkMe, user)
      invalidateEverything(queryClient)
    },
  })
}

export function useSignup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; password: string; name: string }) => signup(body),
    onSuccess: (user) => {
      queryClient.setQueryData(qkMe, user)
      invalidateEverything(queryClient)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      // Flip the gate immediately — the refetch from the invalidation below would
      // land on 401 → null anyway, this just skips showing a signed-out user their
      // own stale screen for a beat.
      queryClient.setQueryData(qkMe, null)
      invalidateEverything(queryClient)
    },
  })
}

export function useUpdateMe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { name?: string; email?: string }) => updateMe(body),
    onSuccess: (user) => queryClient.setQueryData(qkMe, user),
  })
}

export function useUpdatePassword() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { current_password?: string; new_password: string }) =>
      updatePassword(body),
    // 204 carries no body, but `has_password` may have just flipped from false → true
    // (an OAuth-only account setting its first password), so refetch `me`.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qkMe }),
  })
}

export function useLinkOAuth() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { link_token: string; email: string; password?: string }) =>
      oauthLink(body),
    // The caller hard-reloads to `/` on success (the cookie is set and the URL still
    // carries ?link_token= junk), but invalidate anyway so nothing stale survives if
    // that reload is ever removed. Blanket for the same account-switch reason as login.
    onSuccess: () => invalidateEverything(queryClient),
  })
}

export function useIntegrations() {
  return useQuery<Integrations>({ queryKey: qkIntegrations, queryFn: getIntegrations })
}

/** Starts the *calendar* consent — a bigger ask than signing in, and a separate
 *  one: granting it does not make the provider a sign-in method. Returns the URL to
 *  send the browser to; a 501 means the server has no credentials configured. */
export function useCalendarAuthorize() {
  return useMutation({
    mutationFn: (provider: OAuthProvider) => calendarAuthorize(provider),
  })
}

export function useDisconnectCalendar() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (provider: OAuthProvider) => disconnectCalendar(provider),
    onSuccess: () => {
      // The connection state, and every view that overlays external events on the
      // calendar. Dropping the tokens must not leave those events on screen.
      queryClient.invalidateQueries({ queryKey: qkIntegrations })
      queryClient.invalidateQueries({ queryKey: ['google-events'] })
    },
  })
}
