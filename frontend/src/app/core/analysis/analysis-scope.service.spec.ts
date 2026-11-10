import { afterEach, describe, expect, it, vi } from 'vitest';

import { presetRange } from './analysis-scope.service';

describe('analysis scope date presets', () => {
  afterEach(() => vi.useRealTimers());

  it('uses an inclusive seven-day window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 10));

    expect(presetRange('last7')).toEqual({ from: '2026-11-04', to: '2026-11-10' });
    expect(presetRange('last30')).toEqual({ from: '2026-10-12', to: '2026-11-10' });
  });

  it('starts month, quarter and year to date at their boundaries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 10));

    expect(presetRange('mtd')).toEqual({ from: '2026-11-01', to: '2026-11-10' });
    expect(presetRange('qtd')).toEqual({ from: '2026-10-01', to: '2026-11-10' });
    expect(presetRange('ytd')).toEqual({ from: '2026-01-01', to: '2026-11-10' });
  });

  it('does not invent dates for all-time or custom ranges', () => {
    expect(presetRange('all')).toBeNull();
    expect(presetRange('custom')).toBeNull();
  });
});
