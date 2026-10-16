// Display formatting. All dates are shown in UTC so every viewer sees the same window.

const DASH = '—';

export function fmtDuration(ms: number | null): string {
  if (ms == null) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${Math.round(s % 60)} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function fmtPct(value: number | null, digits = 0): string {
  return value == null ? DASH : `${(value * 100).toFixed(digits)}%`;
}

export function fmtNum(value: number | null, digits = 0): string {
  if (value == null) return DASH;
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtDate(ms: number | null): string {
  if (ms == null) return DASH;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function fmtDateTime(ms: number | null): string {
  if (ms == null) return DASH;
  return `${new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })} UTC`;
}

export function fmtSigned(value: number | null, format: (v: number) => string): string {
  if (value == null) return DASH;
  return `${value > 0 ? '+' : value < 0 ? '−' : '±'}${format(Math.abs(value))}`;
}
