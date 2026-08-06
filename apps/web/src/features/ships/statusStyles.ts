import type { ShipStatusValue } from '@kinvo/contracts';

export const SHIP_STATUS_LABEL: Record<ShipStatusValue, string> = {
  DRAFT: 'Draft',
  RECRUITING: 'Recruiting',
  CONFIRMED: 'Confirmed',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const SHIP_STATUS_STYLE: Record<ShipStatusValue, { bg: string; color: string }> = {
  DRAFT: { bg: '#F3EDDD', color: '#8B7A4A' },
  RECRUITING: { bg: '#FDEFD9', color: '#B4762A' },
  CONFIRMED: { bg: '#DFF3EE', color: '#1E7A8C' },
  IN_PROGRESS: { bg: '#E3EEFB', color: '#2A5DA6' },
  COMPLETED: { bg: '#E3F3DE', color: '#3D8A4E' },
  CANCELLED: { bg: '#FBE6E1', color: '#C1503B' },
};

// DRAFT -> RECRUITING -> CONFIRMED -> IN_PROGRESS -> COMPLETED, CANCELLED
// reachable from any pre-COMPLETED state — mirrors ships.service.ts's
// VALID_TRANSITIONS so the UI never offers a transition the API would
// reject; the API remains the actual source of truth/enforcement.
export const SHIP_NEXT_STATUSES: Record<ShipStatusValue, ShipStatusValue[]> = {
  DRAFT: ['RECRUITING', 'CANCELLED'],
  RECRUITING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
