// Tests for the usage-telemetry summarization (pure logic in rayfin/functions/src/usage.ts).

import { describe, expect, it } from 'vitest';
import { cleanEvent, summarizeUsage } from '../../rayfin/functions/src/usage';

const t = (iso: string) => new Date(iso);

describe('summarizeUsage', () => {
  const rows = [
    { at: t('2026-10-10T09:00:00Z'), user_email: 'a@x.com', type: 'app_opened' },
    { at: t('2026-10-10T09:01:00Z'), user_email: 'a@x.com', type: 'page_view', detail: 'knowledge' },
    { at: t('2026-10-11T12:00:00Z'), user_email: 'b@x.com', type: 'app_opened' },
    { at: t('2026-10-11T12:05:00Z'), user_email: 'b@x.com', type: 'question_asked' },
    { at: t('2026-10-09T08:00:00Z'), user_email: '', type: 'app_opened' }, // unknown user
  ];

  it('counts events, distinct known users, and the time span', () => {
    const s = summarizeUsage(rows);
    expect(s.totalEvents).toBe(5);
    expect(s.uniqueUsers).toBe(2); // the blank email is not a known user
    expect(s.firstAt).toBe(Date.parse('2026-10-09T08:00:00Z'));
    expect(s.lastAt).toBe(Date.parse('2026-10-11T12:05:00Z'));
  });

  it('ranks users by activity with their last-seen time', () => {
    const s = summarizeUsage(rows);
    expect(s.byUser[0]).toEqual({ user: 'a@x.com', count: 2, lastAt: Date.parse('2026-10-10T09:01:00Z') });
    expect(s.byUser.find((u) => u.user === '(unknown)')).toMatchObject({ count: 1 });
  });

  it('counts actions by type and lists recent activity newest first', () => {
    const s = summarizeUsage(rows);
    expect(s.byType.find((x) => x.type === 'app_opened')).toEqual({ type: 'app_opened', count: 3 });
    expect(s.recent[0]).toMatchObject({ user: 'b@x.com', type: 'question_asked' });
  });

  it('handles an empty log', () => {
    expect(summarizeUsage([])).toMatchObject({ totalEvents: 0, uniqueUsers: 0, firstAt: null, lastAt: null, recent: [] });
  });
});

describe('cleanEvent', () => {
  it('keeps known types and caps the detail, mapping anything else to "other"', () => {
    expect(cleanEvent('question_asked')).toEqual({ type: 'question_asked' });
    expect(cleanEvent('page_view', '  knowledge  ')).toEqual({ type: 'page_view', detail: 'knowledge' });
    expect(cleanEvent('evil', 'x'.repeat(500)).type).toBe('other');
    expect(cleanEvent('page_view', 'x'.repeat(500)).detail!.length).toBe(300);
  });
});
