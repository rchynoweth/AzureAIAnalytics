import { describe, expect, it } from 'vitest';
import { normalize, type RawStep } from '../data/normalize';
import {
  agentComplexity, agentTime, complexityBands, histogram, investigationCandidates, mostComplexRuns, runsIn, stepStats, stepsByAgent, summarize, trend, windowPeriods,
} from './metrics';
import { sequencePatterns } from './sequences';

const T0 = Date.parse('2026-01-01T00:00:00Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

/** Steps for one run from [name, durationSeconds | null] pairs, laid end to end. */
function stepsFor(runId: string, spec: [string, number | null][], type = 'tool'): RawStep[] {
  let t = 0;
  return spec.map(([name, seconds], i) => {
    const step: RawStep = { id: `${runId}-${i}`, run_id: runId, ordinal: i + 1, name, type, tool: name, started_at: at(t), status: 'ok' };
    if (seconds != null) step.ended_at = at(t + seconds);
    t += seconds ?? 0;
    return step;
  });
}

// Hand-worked fixture (one agent, four runs):
//   r1 succeeded, 10 s : a(1) b(2) a(3) c(4)   ← a repeats
//   r2 failed,    20 s : a(5) b(6)
//   r3 unknown, invalid: b(1) c(1) c(2)         ← c repeats; ends before it starts
//   r4 in progress     : a(no end)
const fixture = normalize(
  {
    agents: [{ id: 'A', name: 'A' }],
    runs: [
      { id: 'r1', agent_id: 'A', started_at: at(0), ended_at: at(10), status: 'succeeded' },
      { id: 'r2', agent_id: 'A', started_at: at(100), ended_at: at(120), status: 'failed' },
      { id: 'r3', agent_id: 'A', started_at: at(200), ended_at: at(150), status: 'weird' },
      { id: 'r4', agent_id: 'A', started_at: at(300), status: 'running' },
    ],
    steps: [
      ...stepsFor('r1', [['a', 1], ['b', 2], ['a', 3], ['c', 4]]),
      ...stepsFor('r2', [['a', 5], ['b', 6]]),
      ...stepsFor('r3', [['b', 1], ['c', 1], ['c', 2]]),
      ...stepsFor('r4', [['a', null]]),
    ],
  },
  'test',
);
const { runs, stepsByRun } = fixture;

describe('summarize', () => {
  const s = summarize(runs, stepsByRun);
  it('uses step count as the complexity measure, excluding unfinished runs', () => {
    expect(runs.map((r) => r.step_count)).toEqual([4, 2, 3, 1]);
    expect(s.stepSample).toBe(3); // r4 is still in progress
    expect(s.medianSteps).toBe(3); // median of 4, 2, 3
  });
  it('suppresses percentiles for small samples', () => {
    expect(s.p75Steps).toBeNull(); // 4 runs < 8
    expect(s.p95Steps).toBeNull(); // 4 runs < 20
    expect(s.p95Duration).toBeNull();
  });
  it('excludes invalid and missing durations and counts them', () => {
    expect(s.validDurationCount).toBe(2);
    expect(s.excludedDurationCount).toBe(2);
    expect(s.medianDuration).toBe(15_000);
  });
  it('computes success rate over known terminal statuses only', () => {
    expect([s.succeeded, s.failed, s.unknown, s.inProgress]).toEqual([1, 1, 1, 1]);
    expect(s.successRate).toBe(0.5);
  });
  it('computes the run-level repeated-step rate over all runs', () => {
    expect(s.runsWithRepeat).toBe(2);
    expect(s.repeatRate).toBe(0.5);
  });
  it('counts tool calls and unique steps', () => {
    expect(s.totalToolCalls).toBe(10);
    expect(s.medianUniqueSteps).toBe(2); // uniques per completed run: 3, 2, 2
  });
  it('handles zero runs without dividing by zero', () => {
    const empty = summarize([], stepsByRun);
    expect([empty.medianSteps, empty.successRate, empty.repeatRate]).toEqual([null, null, null]);
  });
});

describe('stepStats', () => {
  const stats = stepStats(runs, stepsByRun);
  const by = (name: string) => stats.find((x) => x.name === name)!;

  it('orders by execution count, then name', () => {
    expect(stats.map((x) => x.name)).toEqual(['a', 'b', 'c']);
  });
  it('counts a step once per run for penetration', () => {
    expect(by('a')).toMatchObject({ executions: 4, runCount: 3, penetration: 0.75 });
    expect(by('c')).toMatchObject({ executions: 3, runCount: 2, penetration: 0.5 });
  });
  it('keeps total and median step duration separate', () => {
    expect(by('a')).toMatchObject({ totalMs: 9000, medianMs: 3000, validDurationCount: 3 }); // 1, 3, 5 s; r4 has no end
    expect(by('b')).toMatchObject({ totalMs: 9000, medianMs: 2000 });
    expect(by('c')).toMatchObject({ totalMs: 7000, medianMs: 2000 });
    expect(by('a').timeShare).toBeCloseTo(9000 / 25000);
    expect(by('a').p95Ms).toBeNull(); // fewer than 20 executions
  });
  it('computes per-step repetition', () => {
    expect(by('a')).toMatchObject({ runsRepeating: 1, medianRepetitions: 2 });
    expect(by('a').repeatRate).toBeCloseTo(1 / 3);
    expect(by('b')).toMatchObject({ runsRepeating: 0, repeatRate: 0, medianRepetitions: null });
  });
  it('reports failure association, not causation', () => {
    expect(by('a')).toMatchObject({ failedRuns: 1, failureConcentration: 1 });
    expect(by('c')).toMatchObject({ failedRuns: 0, failureConcentration: 0 });
  });
});

describe('sequencePatterns', () => {
  it('counts exact two-step sequences', () => {
    const pairs = sequencePatterns('A', runs, stepsByRun, 2);
    const ab = pairs.find((p) => p.sequence.join('>') === 'a>b')!;
    expect(ab).toMatchObject({ occurrence_count: 2, run_count: 2, penetration: 0.5, median_run_duration: 15_000 });
    expect(pairs.map((p) => p.sequence.join('>')).sort()).toEqual(['a>b', 'a>c', 'b>a', 'b>c', 'c>c']);
  });
  it('counts exact three-step sequences', () => {
    const triples = sequencePatterns('A', runs, stepsByRun, 3);
    expect(triples.map((p) => p.sequence.join('>')).sort()).toEqual(['a>b>a', 'b>a>c', 'b>c>c']);
    expect(triples.every((p) => p.occurrence_count === 1 && p.sequence_length === 3)).toBe(true);
  });
  it('counts overlapping occurrences but each run once', () => {
    const loop = normalize(
      { agents: [{ id: 'A' }], runs: [{ id: 'x', agent_id: 'A', started_at: at(0), status: 'ok' }], steps: stepsFor('x', [['s', 1], ['s', 1], ['s', 1]]) },
      'test',
    );
    expect(sequencePatterns('A', loop.runs, loop.stepsByRun, 2)[0]).toMatchObject({ occurrence_count: 2, run_count: 1 });
  });
});

/** n runs of one agent with step counts 1..n (unique names, so no repeats) and durations 1..n seconds. */
function ladder(n: number) {
  const runsRaw = Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, agent_id: 'L', started_at: at(i * 100), ended_at: at(i * 100 + i + 1), status: 'ok' }));
  const steps = runsRaw.flatMap((r, i) => stepsFor(r.id, Array.from({ length: i + 1 }, (_, k) => [`s${k}`, 0] as [string, number])));
  return normalize({ agents: [{ id: 'L' }], runs: runsRaw, steps }, 'test');
}

describe('complexityBands', () => {
  it("bands runs against their own agent's quartiles", () => {
    // step counts 1..8: Q1 = 2.75, Q3 = 6.25 → lower {1,2}, typical {3..6}, higher {7,8}
    expect(complexityBands(ladder(8).runs).counts).toEqual({ lower: 2, typical: 4, higher: 2, unavailable: 0 });
  });
  it('does not band in-progress runs', () => {
    expect(complexityBands(runs).byRun.has('r4')).toBe(false);
  });
  it('does not band agents below the minimum sample', () => {
    expect(complexityBands(ladder(7).runs).counts).toEqual({ lower: 0, typical: 0, higher: 0, unavailable: 7 });
  });
});

describe('investigationCandidates', () => {
  it("flags runs above the agent's own 95th percentile", () => {
    const d = ladder(20); // p95 of 1..20 = 19.05
    const { candidates, notEvaluated } = investigationCandidates(d.runs, d.stepsByRun);
    expect(notEvaluated).toEqual([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].run.run_id).toBe('r20');
    expect(candidates[0].reasons.map((r) => r.metric)).toEqual(['Step count', 'Run duration']);
    expect(candidates[0].reasons[0]).toMatchObject({ value: 20, sample: 20 });
    expect(candidates[0].reasons[0].threshold).toBeCloseTo(19.05);
  });
  it('states insufficient history instead of applying a threshold', () => {
    const d = ladder(19);
    expect(investigationCandidates(d.runs, d.stepsByRun)).toEqual({ candidates: [], notEvaluated: [{ agentId: 'L', runCount: 19 }] });
  });
});

describe('windows and trends', () => {
  const now = T0 + 30 * 86_400_000;
  it('compares the window with the immediately preceding window', () => {
    const { current, previous } = windowPeriods('7d', now, runs);
    expect(current.end - current.start).toBe(7 * 86_400_000);
    expect(previous!.end).toBe(current.start);
    expect(windowPeriods('all', now, runs).previous).toBeNull();
  });
  it('excludes runs outside the period', () => {
    expect(runsIn(runs, { start: T0, end: T0 + 150_000 }).map((r) => r.run_id)).toEqual(['r1', 'r2']);
  });
  it('uses daily buckets up to 31 days and weekly beyond', () => {
    expect(trend(runs, stepsByRun, { start: T0, end: T0 + 7 * 86_400_000 })).toMatchObject({ grain: 'day' });
    expect(trend(runs, stepsByRun, { start: T0, end: T0 + 30 * 86_400_000 }).buckets).toHaveLength(30);
    expect(trend(runs, stepsByRun, { start: T0, end: T0 + 56 * 86_400_000 })).toMatchObject({ grain: 'week' });
    expect(trend(runs, stepsByRun, { start: T0, end: T0 + 56 * 86_400_000 }).buckets).toHaveLength(8);
    expect(trend(runs, stepsByRun, { start: T0, end: T0 + 86_400_000 }).buckets[0].runCount).toBe(4);
  });
});

describe('histogram', () => {
  it('bins integers into equal-width bins', () => {
    expect(histogram([1, 2, 2, 3])).toEqual([
      { from: 1, to: 1, count: 1 }, { from: 2, to: 2, count: 2 }, { from: 3, to: 3, count: 1 },
    ]);
    expect(histogram([1, 30], 3).map((b) => b.count)).toEqual([1, 0, 1]);
    expect(histogram([])).toEqual([]);
  });
});

describe('agentTime', () => {
  it('sums valid run durations per agent and their share of all run time', () => {
    // Fixture agent A: valid durations 10 s (r1) and 20 s (r2); r3 invalid, r4 in progress.
    expect(agentTime(runs)).toEqual([{ agentId: 'A', totalMs: 30_000, timedRuns: 2, medianMs: 15_000, share: 1 }]);
    expect(agentTime([])).toEqual([]);
  });
});

describe('step heat maps', () => {
  it('counts executions of each step per agent', () => {
    const h = stepsByAgent(runs, stepsByRun, (id) => id);
    expect(h.columns).toEqual(['A']);
    expect(h.rows[0]).toEqual({ name: 'a', counts: [4] });
  });
});

describe('complexity drill-in', () => {
  it('orders completed runs by step count, most complex first', () => {
    // fixture step counts: r1=4, r2=2, r3=3 (r4 in progress excluded)
    expect(mostComplexRuns(runs).map((r) => r.run_id)).toEqual(['r1', 'r3', 'r2']);
    expect(mostComplexRuns(runs, 2).map((r) => r.run_id)).toEqual(['r1', 'r3']);
  });
  it('summarizes per-agent complexity, suppressing p95 for small samples', () => {
    const c = agentComplexity(runs);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ agentId: 'A', runCount: 3, medianSteps: 3, p95Steps: null, maxSteps: 4 });
  });
});
