import { describe, expect, it } from 'vitest'

import { ApiError, apiSend, errorMessage } from './client'

describe('errorMessage', () => {
  it('is null when there is nothing to show', () => {
    expect(errorMessage(null)).toBeNull()
    expect(errorMessage(undefined)).toBeNull()
  })

  it("prefers an ApiError's detail — the backend's own message", () => {
    expect(errorMessage(new ApiError(422, 'task_name is required'))).toBe('task_name is required')
  })

  it('falls back to a plain Error message, e.g. a rejected fetch when offline', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe('Failed to fetch')
  })

  it('never returns null for a real, non-Error failure', () => {
    expect(errorMessage('network down')).not.toBeNull()
    expect(typeof errorMessage('network down')).toBe('string')
  })

  // The general invariant: for any non-null input, errorMessage must hand the
  // caller something to render — never '' and never null. `{error && (...)}`
  // in JSX treats an empty string exactly like null, so a falsy-but-defined
  // message is the same silent-failure bug as returning null outright.
  it.each([
    ['an ApiError with a detail', new ApiError(422, 'task_name is required')],
    // unwrap() falls back to res.statusText when a failed response's body
    // isn't {detail: string}-shaped, and every HTTP/2 response has
    // statusText === '' (HTTP/2 dropped the reason phrase from the
    // protocol) — so an ApiError with an empty detail is a real case, not a
    // hypothetical one.
    ['an ApiError with an empty detail (HTTP/2 statusText)', new ApiError(500, '')],
    ['a plain Error with a message', new TypeError('Failed to fetch')],
    ['a plain Error with an empty message', new Error('')],
    ['a non-Error throw', 'network down'],
  ])('returns a non-empty string for %s', (_label, error) => {
    const message = errorMessage(error)
    expect(message).not.toBeNull()
    expect(message).not.toBe('')
  })
})

// ---------------------------------------------------------------- unwrap

/** A CDN in front of the API replaces error bodies with its own HTML page.
 *  Observed in production: Cloudflare turns the backend's
 *  `{"detail":"lark write-back is not implemented yet"}` 502 into
 *  `<!DOCTYPE html>...`, and parsing it before checking `res.ok` threw
 *  `SyntaxError: Unexpected token '<'` — which reached the UI *instead of*
 *  the failure it was hiding. */
const CDN_ERROR_PAGE = '<!DOCTYPE html>\n<html><head><title>502</title></head></html>'

function respondWith(status: number, body: string, contentType: string) {
  globalThis.fetch = (async () =>
    new Response(body, {
      status,
      headers: { 'Content-Type': contentType },
    })) as typeof fetch
}

describe('apiSend error handling', () => {
  it('reports the HTTP failure when the body is a CDN HTML page, not a parse error', async () => {
    respondWith(502, CDN_ERROR_PAGE, 'text/html')

    const error = await apiSend('PATCH', '/events/91', { title: 'x' }).catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(502)
    expect(errorMessage(error)).not.toMatch(/JSON|token/i)
  })

  it('still surfaces the backend detail when the body IS json', async () => {
    respondWith(502, JSON.stringify({ detail: 'lark write-back is not implemented yet' }), 'application/json')

    const error = await apiSend('PATCH', '/events/91', { title: 'x' }).catch((e) => e)

    expect((error as ApiError).detail).toBe('lark write-back is not implemented yet')
  })

  it('does not mask a malformed body on a successful response', async () => {
    respondWith(200, 'not json at all', 'application/json')

    const error = await apiSend('PATCH', '/events/91', { title: 'x' }).catch((e) => e)

    expect(error).toBeInstanceOf(Error)
  })
})
