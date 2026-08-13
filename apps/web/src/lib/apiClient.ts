import { refreshSession } from './sessionRefresh';

const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

// Never attempted, and never retried through — this IS the refresh call
// itself. Treating a 401 from it as "try to refresh" would be an infinite
// loop, and it never carries an Authorization header anyway (the refresh
// token lives in its own httpOnly cookie, not the access token).
const REFRESH_PATH = '/api/v1/auth/refresh';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// In-memory only, deliberately — an access token in a JS-readable store
// (localStorage/sessionStorage) is exactly what the refresh token's
// httpOnly cookie exists to avoid being. Losing it on a hard refresh is
// the accepted tradeoff; refreshAccessToken() (called once at app startup)
// is what recovers it from the still-valid refresh cookie.
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

// Registered by AuthProvider (see auth.tsx) so a request-level refresh
// failure — the refresh-token cookie itself is no longer valid, not just
// the access token — can clear the app's auth state exactly the way an
// explicit logout does. apiClient deliberately has no dependency on React/
// AuthContext of its own; this is the same "expose a setter, let the
// owning provider wire it up" shape setAccessToken already uses.
let onSessionExpired: (() => void) | null = null;

export function setOnSessionExpired(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

// Without this, a dead backend or a dropped connection left every in-flight
// query/mutation pending indefinitely — React Query never settles, and the
// UI has no way to tell the user anything went wrong (no error, no retry,
// just a permanently "loading" button). 15s comfortably covers this app's
// normal request latency (every endpoint is single-digit-ms in practice —
// see the integration test suite's timings) while still being short enough
// that a genuinely hung request resolves to a visible, actionable error.
const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  isRetry = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      credentials: 'include', // sends/receives the httpOnly refresh-token cookie
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // AbortSignal.timeout() aborts the fetch itself and rejects with a
      // DOMException named "TimeoutError" — distinct from a plain network
      // failure (DNS/connection refused, which fetch also rejects, but
      // without ever having sent anything). Both are translated to
      // ApiError below so every existing `isApiError(err) ? err.message :
      // ...` call site already gets a sensible message with no changes.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ApiError('The request took too long to respond. Please try again.', 0);
    }
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    // A 401 mid-session almost always means the ~15-minute access token
    // TTL expired, not that the request was never valid — the httpOnly
    // refresh cookie can silently redeem a new one. Attempted at most
    // once (`isRetry` guards against looping if the retried request
    // somehow 401s again), never for the refresh call itself, and never
    // when there was no access token to begin with (a 401 from
    // login/register-organization is a real "wrong credentials" answer,
    // not an expired session — there is nothing to refresh). refreshSession()
    // is already single-flight (see sessionRefresh.ts), so N simultaneous
    // 401s here share the one underlying refresh call, not N of them.
    if (response.status === 401 && !isRetry && path !== REFRESH_PATH && accessToken !== null) {
      try {
        const refreshed = await refreshSession();
        setAccessToken(refreshed.accessToken);
        return request<T>(method, path, body, true);
      } catch {
        // The refresh-token cookie itself is dead, not just the access
        // token — there is no session left to recover. Clear it and let
        // the app fall back to the login screen instead of leaving every
        // subsequent request silently failing against a token that will
        // never work again.
        setAccessToken(null);
        onSessionExpired?.();
      }
    }

    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? ((payload as { error?: { message?: string } }).error?.message ?? response.statusText)
        : response.statusText;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export const apiGet = <T>(path: string): Promise<T> => request<T>('GET', path);
export const apiPost = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>('POST', path, body);
export const apiPatch = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>('PATCH', path, body);
export const apiDelete = <T>(path: string): Promise<T> => request<T>('DELETE', path);
