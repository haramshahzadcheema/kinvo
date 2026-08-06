import type { DriverAvailabilityValue } from '@kinvo/contracts';

export const AVAILABILITY_LABEL: Record<DriverAvailabilityValue, string> = {
  IDLE: 'Idle',
  ON_CALL: 'On call',
  CONFIRMED: 'Confirmed',
  ESCALATED: 'Escalated',
};

export const AVAILABILITY_STYLE: Record<DriverAvailabilityValue, { bg: string; color: string }> = {
  CONFIRMED: { bg: '#E3F3DE', color: '#3D8A4E' },
  ON_CALL: { bg: '#FDEFD9', color: '#B4762A' },
  ESCALATED: { bg: '#FBE6E1', color: '#C1503B' },
  IDLE: { bg: '#F1F1EE', color: '#8B9AA3' },
};
