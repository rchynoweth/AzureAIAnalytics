// Pure helpers for usage telemetry. The event list is written by the app's own functions and
// stays in the app database; nothing here sends data anywhere. Kept pure so it can be unit-tested.

export interface UsageRow {
  at: Date | string;
  user_email?: string | null;
  type: string;
  detail?: string | null;
}

export interface UsageSummary {
  totalEvents: number;
  uniqueUsers: number;
  firstAt: number | null;
  lastAt: number | null;
  byType: { type: string; count: number }[];
  byUser: { user: string; count: number; lastAt: number | null }[]; // most active first
  recent: { at: number | null; user: string; type: string; detail: string | null }[]; // newest first
}

export const KNOWN_EVENTS = [
  'app_opened', 'page_view', 'document_added', 'document_removed', 'reindex', 'question_asked', 'sync_run', 'agent_saved', 'agent_deleted',
] as const;

const ms = (v: Date | string) => {
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

export function summarizeUsage(rows: UsageRow[], recentLimit = 50): UsageSummary {
  const times = rows.map((r) => ms(r.at)).filter((t): t is number => t != null);
  const typeCounts = new Map<string, number>();
  const userCounts = new Map<string, { count: number; lastAt: number | null }>();
  for (const r of rows) {
    typeCounts.set(r.type, (typeCounts.get(r.type) ?? 0) + 1);
    const user = r.user_email?.trim() || '(unknown)';
    const at = ms(r.at);
    const prev = userCounts.get(user) ?? { count: 0, lastAt: null };
    userCounts.set(user, { count: prev.count + 1, lastAt: Math.max(prev.lastAt ?? 0, at ?? 0) || null });
  }
  return {
    totalEvents: rows.length,
    uniqueUsers: [...userCounts.keys()].filter((u) => u !== '(unknown)').length,
    firstAt: times.length ? Math.min(...times) : null,
    lastAt: times.length ? Math.max(...times) : null,
    byType: [...typeCounts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    byUser: [...userCounts.entries()].map(([user, v]) => ({ user, ...v })).sort((a, b) => b.count - a.count || a.user.localeCompare(b.user)),
    recent: [...rows]
      .sort((a, b) => (ms(b.at) ?? 0) - (ms(a.at) ?? 0))
      .slice(0, recentLimit)
      .map((r) => ({ at: ms(r.at), user: r.user_email?.trim() || '(unknown)', type: r.type, detail: r.detail ?? null })),
  };
}

/** Keeps a recorded event small and safe: a known type and a trimmed, length-capped detail. */
export function cleanEvent(type: string, detail?: string): { type: string; detail?: string } {
  const t = (KNOWN_EVENTS as readonly string[]).includes(type) ? type : 'other';
  const d = detail?.trim().slice(0, 300);
  return d ? { type: t, detail: d } : { type: t };
}
