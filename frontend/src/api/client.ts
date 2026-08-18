export class ApiError extends Error {
  readonly status: number
  readonly detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
    this.detail = detail
  }
}

/**
 * A human-readable message for anything that can come back as a mutation's
 * `error`, or `null` when there is nothing to show.
 *
 * `unwrap` below only throws `ApiError` when the response completed but was
 * not ok. A `fetch()` that never gets a response — offline, DNS failure,
 * CORS, a timeout — rejects with a plain `TypeError` (or something else
 * entirely), not an `ApiError`. An `instanceof ApiError` check alone treats
 * that case as "no error" and the UI shows nothing while quietly failing to
 * save, so every non-`ApiError` branch below must still return a string.
 * Do not collapse this back to a single `instanceof` check.
 *
 * `error.detail` is also guarded for emptiness, not just checked with
 * `instanceof`: `unwrap` falls back to `res.statusText` when a failed
 * response's body isn't `{detail: string}`-shaped, and browsers set
 * `statusText` to `''` for every HTTP/2 response — HTTP/2 dropped the reason
 * phrase from the protocol entirely. So a 500 behind an HTTP/2 proxy with an
 * unparseable body is a perfectly real `ApiError` whose `detail` is `''`.
 * Without this guard that falls through to the caller as `''`, which a
 * `{error && (...)}` check in JSX treats exactly like `null` — the popover
 * shows nothing again, for a narrower class of failure. Every branch that
 * has nothing useful to say ends at the same fallback string, deliberately:
 * one message, not a second ad hoc one per empty-string case.
 */
export function errorMessage(error: unknown): string | null {
  if (error == null) return null
  if (error instanceof ApiError && error.detail) return error.detail
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong. Please try again.'
}

async function unwrap<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T
  const text = await res.text()
  // Parse defensively on the failure path: a CDN or load balancer between the
  // browser and the API answers 5xx with its own HTML page, not the backend's
  // {detail}. Parsing that before the `res.ok` check threw a SyntaxError which
  // *replaced* the real failure — "Unexpected token '<'" is what reached the UI
  // when Cloudflare rewrote a 502. An unparseable body on a failed response is
  // simply a response with no detail; the status still says what happened.
  // A malformed body on a *successful* response is a genuine bug and still throws.
  let body: any = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch (error) {
      if (res.ok) throw error
    }
  }
  if (!res.ok) {
    // FastAPI sends {detail: string} for HTTPException and
    // {detail: [{loc, msg, ...}]} for validation failures.
    const detail = body?.detail
    const message = Array.isArray(detail)
      ? detail.map((d: { msg: string }) => d.msg).join('; ')
      : typeof detail === 'string'
        ? detail
        : res.statusText
    throw new ApiError(res.status, message)
  }
  return body as T
}

export async function apiGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const qs = params
    ? '?' +
      new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)]),
      )
    : ''
  return unwrap<T>(await fetch(`/api${path}${qs}`))
}

export async function apiSend<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  return unwrap<T>(
    await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}
