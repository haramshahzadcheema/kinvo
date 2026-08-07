import type {
  ActiveVoiceCallsResponse,
  AttemptOutcomeValue,
  VoiceCallListResponse,
} from '@kinvo/contracts';
import { apiGet } from '../../lib/apiClient';

export interface VoiceCallListParams {
  outcome?: AttemptOutcomeValue;
  page?: number;
  pageSize?: number;
}

function toQueryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

// Read-only by design — see voice.routes.ts's callsRouter comment. Placing
// a call stays an action on the Assignment resource (assignments/api.ts's
// placeVoiceCall), never duplicated here: offering a "call again" action
// from a historical call row would need this page to also know the
// assignment's *current* status (which can have changed since the call
// happened), and this list doesn't carry that — showing a stale action
// here would risk placing a call for an assignment that already moved on.
export const voiceCallsApi = {
  list: (params: VoiceCallListParams = {}) =>
    apiGet<VoiceCallListResponse>(`/api/v1/voice-calls${toQueryString(params)}`),
  listActive: () => apiGet<ActiveVoiceCallsResponse>('/api/v1/voice-calls/active'),
};
