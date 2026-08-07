import { ATTEMPT_OUTCOME_LABEL } from '../assignments/statusStyles';

// A call's displayed status is either the synthetic "still ringing" state
// (no AssignmentAttempt exists yet — see ActiveVoiceCallDto) or one of the
// real AttemptOutcome values once resolved. Reuses ATTEMPT_OUTCOME_LABEL
// rather than inventing separate terminology — a dispatcher who already
// knows what "Rejected on call" means on the Assignments screen shouldn't
// have to learn a second vocabulary here for the exact same fact.
export const CALL_STATUS_LABEL: Record<'CALLING' | keyof typeof ATTEMPT_OUTCOME_LABEL, string> = {
  CALLING: 'Calling…',
  ...ATTEMPT_OUTCOME_LABEL,
};

export const CALL_STATUS_STYLE: Record<
  'CALLING' | keyof typeof ATTEMPT_OUTCOME_LABEL,
  { bg: string; color: string }
> = {
  CALLING: { bg: '#EAF3F1', color: '#1E7A8C' },
  CONFIRMED: { bg: '#E3F3DE', color: '#3D8A4E' },
  REJECTED: { bg: '#FBE6E1', color: '#C1503B' },
  UNREACHABLE: { bg: '#F1F1EE', color: '#8B9AA3' },
  NO_ANSWER: { bg: '#F1F1EE', color: '#8B9AA3' },
  BUSY: { bg: '#F1F1EE', color: '#8B9AA3' },
  WRONG_NUMBER: { bg: '#F1F1EE', color: '#8B9AA3' },
  SYSTEM_ERROR: { bg: '#FDEFD9', color: '#B4762A' },
};
