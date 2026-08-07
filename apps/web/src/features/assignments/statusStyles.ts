import { humanLoggableAttemptOutcomeSchema } from '@kinvo/contracts';
import type {
  AssignmentStatusValue,
  AttemptOutcomeValue,
  HumanLoggableAttemptOutcomeValue,
} from '@kinvo/contracts';

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatusValue, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  WITHDRAWN: 'Withdrawn',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
  COMPLETED: 'Completed',
};

export const ASSIGNMENT_STATUS_STYLE: Record<AssignmentStatusValue, { bg: string; color: string }> = {
  PENDING: { bg: '#FDEFD9', color: '#B4762A' },
  CONFIRMED: { bg: '#E3F3DE', color: '#3D8A4E' },
  REJECTED: { bg: '#FBE6E1', color: '#C1503B' },
  EXPIRED: { bg: '#F1F1EE', color: '#8B9AA3' },
  WITHDRAWN: { bg: '#F1F1EE', color: '#8B9AA3' },
  CANCELLED: { bg: '#FBE6E1', color: '#C1503B' },
  NO_SHOW: { bg: '#FBE6E1', color: '#C1503B' },
  COMPLETED: { bg: '#DFF3EE', color: '#1E7A8C' },
};

export const ATTEMPT_OUTCOME_LABEL: Record<AttemptOutcomeValue, string> = {
  NO_ANSWER: 'No answer',
  BUSY: 'Busy',
  UNREACHABLE: 'Unreachable',
  WRONG_NUMBER: 'Wrong number',
  REJECTED: 'Rejected on call',
  CONFIRMED: 'Confirmed on call',
  SYSTEM_ERROR: 'System error',
};

// Manual outreach (Phase 3) never logs SYSTEM_ERROR — that outcome is
// reserved for Phase 4's CALL-E webhook to report a call-platform-side
// failure, not something a dispatcher observed on a call they made
// themselves. Derived from the same schema the backend validates
// POST /assignments/:id/attempts against (packages/contracts), rather than
// a separately hand-maintained list — the two must never drift apart, and
// this is now the one place SYSTEM_ERROR's exclusion is spelled out.
export const LOGGABLE_ATTEMPT_OUTCOMES: HumanLoggableAttemptOutcomeValue[] = [
  ...humanLoggableAttemptOutcomeSchema.options,
];
