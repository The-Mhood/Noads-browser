import { describe, expect, it } from 'vitest';
import type { BlockState } from '../shared/types';
import { shieldTooltip, totalBlocked } from '../src/selectors/browserSelectors';

const base: BlockState = {
  enabled: true,
  count: 0,
  lastBlocked: null,
  recentBlocked: [],
  popupsBlocked: 0,
  lastPopup: null,
  warning: null,
};

describe('selectors', () => {
  it('totalBlocked sums both counters', () => {
    expect(totalBlocked(base)).toBe(0);
    expect(totalBlocked({ ...base, count: 3, popupsBlocked: 2 })).toBe(5);
  });

  it('tooltip includes counts, last host, and warnings', () => {
    const t = shieldTooltip({
      ...base,
      count: 2,
      lastBlocked: 'doubleclick.net',
      popupsBlocked: 1,
      lastPopup: 'https://evil.example/pop',
    });
    expect(t).toContain('2 ad requests blocked');
    expect(t).toContain('doubleclick.net');
    expect(t).toContain('1 popup stopped');
    expect(t).toContain('evil.example/pop');
  });

  it('tooltip flags disabled blocking and warnings', () => {
    const t = shieldTooltip({ ...base, enabled: false, warning: 'list broken' });
    expect(t).toContain('blocking disabled');
    expect(t).toContain('list broken');
  });
});
