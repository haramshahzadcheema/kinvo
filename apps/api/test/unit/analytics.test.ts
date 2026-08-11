import { describe, expect, it } from 'vitest';
import {
  addUTCDays,
  dateKey,
  dayRange,
  deltaPct,
  formatSeconds,
  startOfUTCDay,
} from '../../src/modules/analytics/analytics.service';

describe('dayRange', () => {
  it('includes today even when "now" is mid-day, not just midnight', () => {
    // The bug this guards against: if `end` were passed in as a raw
    // "now" timestamp (e.g. 14:00) instead of a UTC day boundary, the
    // loop's `cursor < end` would never reach a midnight-aligned cursor
    // stamped the same calendar day as `end`, silently dropping today
    // from the series. getSummary avoids this by always calling
    // dayRange with UTC day boundaries — this test locks in why that
    // matters.
    const today = startOfUTCDay(new Date('2026-08-11T14:32:00Z'));
    const windowEnd = addUTCDays(today, 1);
    const windowStart = addUTCDays(windowEnd, -7);

    const days = dayRange(windowStart, windowEnd);

    expect(days).toHaveLength(7);
    expect(days[days.length - 1]).toBe('2026-08-11');
  });

  it('produces exactly N consecutive days, oldest first, for an N-day window', () => {
    const windowEnd = new Date('2026-08-12T00:00:00Z');
    const windowStart = addUTCDays(windowEnd, -3);

    expect(dayRange(windowStart, windowEnd)).toEqual(['2026-08-09', '2026-08-10', '2026-08-11']);
  });

  it('is empty for a zero-width range', () => {
    const d = new Date('2026-08-11T00:00:00Z');
    expect(dayRange(d, d)).toEqual([]);
  });
});

describe('dateKey / startOfUTCDay / addUTCDays', () => {
  it('formats a UTC date as YYYY-MM-DD', () => {
    expect(dateKey(new Date('2026-08-11T23:59:59Z'))).toBe('2026-08-11');
  });

  it('truncates to UTC midnight', () => {
    expect(startOfUTCDay(new Date('2026-08-11T14:32:00Z')).toISOString()).toBe(
      '2026-08-11T00:00:00.000Z',
    );
  });

  it('steps forward and backward across a month boundary', () => {
    const d = new Date('2026-08-01T00:00:00Z');
    expect(addUTCDays(d, -1).toISOString()).toBe('2026-07-31T00:00:00.000Z');
  });
});

describe('deltaPct', () => {
  it('computes a positive percentage change', () => {
    expect(deltaPct(120, 100)).toBe(20);
  });

  it('computes a negative percentage change', () => {
    expect(deltaPct(80, 100)).toBe(-20);
  });

  it('is null when the prior period has zero — not Infinity, not 0%', () => {
    expect(deltaPct(5, 0)).toBeNull();
  });

  it('is null when both periods are zero', () => {
    expect(deltaPct(0, 0)).toBeNull();
  });
});

describe('formatSeconds', () => {
  it('formats sub-minute durations as seconds only', () => {
    expect(formatSeconds(42)).toBe('42s');
  });

  it('formats multi-minute durations as minutes and seconds', () => {
    expect(formatSeconds(108)).toBe('1m 48s');
  });

  it('never crashes on non-finite input (e.g. an empty-window average)', () => {
    expect(formatSeconds(NaN)).toBe('—');
  });
});
