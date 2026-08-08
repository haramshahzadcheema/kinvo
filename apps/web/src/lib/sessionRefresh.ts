import type { AuthResponse } from '@kinvo/contracts';
import { apiPost } from './apiClient';

// Split out of auth.tsx (which otherwise exports only the AuthProvider
// component) purely to satisfy react-refresh/only-export-components —
// Fast Refresh only works reliably for files that export just components.
// No behavioral change from being in its own module.
//
// Module-scoped, not component-scoped: React 18 StrictMode (dev only) runs
// AuthProvider's mount effect twice in immediate succession (mount ->
// cleanup -> mount), and the refresh-token cookie is single-use/rotating —
// two concurrent POST /auth/refresh calls would race for the same cookie,
// with only one able to redeem it (200) and the other getting a spurious
// 401. Since request/response ordering isn't guaranteed to match effect
// ordering, the *live* effect instance (the one StrictMode didn't discard)
// could be the one that loses the race, incorrectly signing the user out
// on a hard reload despite a perfectly valid session. Sharing one in-flight
// promise across both invocations means the second one just awaits the
// first's real network call instead of firing its own.
//
// Also used by RealtimeProvider.tsx's socket connect_error handler — the
// realtime layer's reconnect-with-a-stale-token recovery reuses this exact
// function rather than a second refresh implementation, so there is still
// only one place that knows how to redeem the refresh-token cookie.
let refreshInFlight: Promise<AuthResponse> | null = null;

export function refreshSession(): Promise<AuthResponse> {
  if (!refreshInFlight) {
    refreshInFlight = apiPost<AuthResponse>('/api/v1/auth/refresh').finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}
