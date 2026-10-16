// Basic statistics. Every function returns null instead of inventing a value.

export function median(values: number[]): number | null {
  return percentile(values, 0.5);
}

/**
 * Linear-interpolation percentile (same method as Excel PERCENTILE.INC and
 * NumPy's default): rank = p × (n − 1) over the sorted values.
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** numerator / denominator, or null when the denominator is zero. */
export function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export interface Change {
  current: number | null;
  previous: number | null;
  difference: number | null;
  /** null = "Not comparable" (missing value or zero comparison value). */
  percentChange: number | null;
}

export function change(current: number | null, previous: number | null): Change {
  const both = current != null && previous != null;
  return {
    current,
    previous,
    difference: both ? current - previous : null,
    percentChange: both && previous !== 0 ? (current - previous) / previous : null,
  };
}
