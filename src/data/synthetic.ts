// Synthetic provider: packaged sample fixtures, clearly labeled, always available.

import agents from './synthetic/agents.json';
import runs from './synthetic/runs.json';
import steps from './synthetic/steps.json';
import type { Dataset } from './model';
import { normalize, parseTimestamp, type RawData } from './normalize';

export const SYNTHETIC_SOURCE = 'Synthetic sample data';

const fixtures = { agents, runs, steps } as RawData;

/**
 * Fixtures are generated around a fixed date. All timestamps are shifted by the
 * same offset so the newest run starts at `now`; relative timing is unchanged.
 */
export function shiftToNow(raw: RawData, now: number): RawData {
  const starts = raw.runs.map((r) => parseTimestamp(r.started_at)).filter((t): t is number => typeof t === 'number');
  const offset = starts.length ? now - Math.max(...starts) : 0;
  const shift = (value: string | null | undefined) => {
    const t = parseTimestamp(value);
    return typeof t === 'number' ? new Date(t + offset).toISOString() : value;
  };
  return {
    agents: raw.agents.map((a) => ({ ...a, created_at: shift(a.created_at) })),
    runs: raw.runs.map((r) => ({ ...r, started_at: shift(r.started_at), ended_at: shift(r.ended_at) })),
    steps: raw.steps.map((s) => ({ ...s, started_at: shift(s.started_at), ended_at: shift(s.ended_at) })),
  };
}

export function loadSynthetic(now = Date.now()): Dataset {
  const normalized = normalize(shiftToNow(fixtures, now), SYNTHETIC_SOURCE);
  return { mode: 'synthetic', source_label: SYNTHETIC_SOURCE, loaded_at: now, ...normalized };
}
