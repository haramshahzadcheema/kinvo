import type { YellowZonePriorityValue, YellowZoneStatusValue } from '@kinvo/contracts';

export const YELLOW_ZONE_STATUS_LABEL: Record<YellowZoneStatusValue, string> = {
  PENDING: 'Needs attention',
  IN_REVIEW: 'In review',
  RESOLVED: 'Resolved',
  DISMISSED: 'Dismissed',
};

export const YELLOW_ZONE_STATUS_STYLE: Record<YellowZoneStatusValue, { bg: string; color: string }> = {
  PENDING: { bg: '#FDEFD9', color: '#B4762A' },
  IN_REVIEW: { bg: '#EAF3F1', color: '#1E7A8C' },
  RESOLVED: { bg: '#E3F3DE', color: '#3D8A4E' },
  DISMISSED: { bg: '#F1F1EE', color: '#8B9AA3' },
};

export const YELLOW_ZONE_PRIORITY_LABEL: Record<YellowZonePriorityValue, string> = {
  HIGH: 'High priority',
  MEDIUM: 'Medium priority',
  LOW: 'Low priority',
};

export const YELLOW_ZONE_PRIORITY_STYLE: Record<YellowZonePriorityValue, { bg: string; color: string }> = {
  HIGH: { bg: '#FBE6E1', color: '#C1503B' },
  MEDIUM: { bg: '#FDEFD9', color: '#B4762A' },
  LOW: { bg: '#F1F1EE', color: '#8B9AA3' },
};

// Priority must be distinguishable without relying on color alone (a
// dispatcher's product, used by more than one person, in more than one
// lighting condition) — a filled-dot count is a shape/quantity cue that
// survives grayscale or colorblind rendering the same way a signal-strength
// icon does. Always paired with the text label above, never shown alone.
export const YELLOW_ZONE_PRIORITY_DOTS: Record<YellowZonePriorityValue, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};
