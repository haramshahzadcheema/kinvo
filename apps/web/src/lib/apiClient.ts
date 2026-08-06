const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

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

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    credentials: 'include', // sends/receives the httpOnly refresh-token cookie
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

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
