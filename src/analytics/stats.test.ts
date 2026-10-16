import { describe, expect, it } from 'vitest';
import { change, median, percentile, rate } from './stats';

describe('median', () => {
  it('takes the middle value, or the mean of the two middle values', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('percentile (linear interpolation, rank = p × (n − 1))', () => {
  it('matches hand-worked values', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBeCloseTo(4.8); // rank 3.8 → 4 + 0.8 × 1
    expect(percentile([40, 10, 30, 20], 0.75)).toBeCloseTo(32.5); // rank 2.25 → 30 + 0.25 × 10
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([], 0.5)).toBeNull();
  });
  it('handles repeated values', () => {
    expect(percentile([5, 5, 5, 5], 0.95)).toBe(5);
  });
});

describe('rate and change', () => {
  it('returns null for a zero denominator', () => {
    expect(rate(3, 0)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
  });
  it('reports difference and percentage change', () => {
    expect(change(6, 4)).toEqual({ current: 6, previous: 4, difference: 2, percentChange: 0.5 });
  });
  it('is "not comparable" when the comparison value is zero or missing', () => {
    expect(change(5, 0)).toEqual({ current: 5, previous: 0, difference: 5, percentChange: null });
    expect(change(5, null).percentChange).toBeNull();
    expect(change(null, 3).difference).toBeNull();
  });
});
