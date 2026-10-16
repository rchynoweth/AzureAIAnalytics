// Exact ordered n-step sequences (derived patterns). Transparent frequency counts only:
// no clustering, scoring, or inferred reasoning.

import type { Run } from '../data/model';
import type { StepsByRun } from './metrics';
import { median, rate } from './stats';

export interface Pattern {
  pattern_id: string;
  agent_id: string;
  sequence: string[];
  sequence_length: number;
  occurrence_count: number; // every position the sequence appears, overlaps included
  run_count: number; // runs containing it at least once
  penetration: number | null; // run_count / runs analyzed
  first_seen: number | null;
  last_seen: number | null;
  median_run_duration: number | null; // over runs containing it, valid durations only
}

export function sequencePatterns(agentId: string, runs: Run[], stepsByRun: StepsByRun, length: 2 | 3): Pattern[] {
  type Acc = { sequence: string[]; occurrences: number; runs: Run[] };
  const acc = new Map<string, Acc>();
  for (const run of runs) {
    const names = (stepsByRun.get(run.run_id) ?? []).map((s) => s.normalized_name);
    const seenInRun = new Set<string>();
    for (let i = 0; i + length <= names.length; i++) {
      const sequence = names.slice(i, i + length);
      const key = sequence.join(' → ');
      const a = acc.get(key) ?? { sequence, occurrences: 0, runs: [] };
      acc.set(key, a);
      a.occurrences++;
      if (!seenInRun.has(key)) {
        seenInRun.add(key);
        a.runs.push(run);
      }
    }
  }
  return [...acc.entries()]
    .map(([key, a]) => {
      const starts = a.runs.map((r) => r.started_at).filter((t): t is number => t != null);
      return {
        pattern_id: `${agentId}:${key}`,
        agent_id: agentId,
        sequence: a.sequence,
        sequence_length: length,
        occurrence_count: a.occurrences,
        run_count: a.runs.length,
        penetration: rate(a.runs.length, runs.length),
        first_seen: starts.length ? Math.min(...starts) : null,
        last_seen: starts.length ? Math.max(...starts) : null,
        median_run_duration: median(a.runs.map((r) => r.duration_ms).filter((d): d is number => d != null)),
      };
    })
    .sort((x, y) => y.occurrence_count - x.occurrence_count || x.pattern_id.localeCompare(y.pattern_id));
}
