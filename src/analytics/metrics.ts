// Behavior metrics over normalized runs and steps. Plain functions, no hidden scores.
// Definitions shown in the UI live in ../definitions.ts and match these formulas.

import type { Run, Step } from '../data/model';
import { median, percentile, rate } from './stats';

/** Below these sample sizes percentile-based results are suppressed, not guessed. */
export const MIN_RUNS_FOR_QUARTILES = 8;
export const MIN_SAMPLE_FOR_P95 = 20;

export type StepsByRun = Map<string, Step[]>;
const stepsOf = (run: Run, stepsByRun: StepsByRun) => stepsByRun.get(run.run_id) ?? [];
/** In-progress runs have not finished producing steps, so they are left out of step-count distributions. */
export const completed = (runs: Run[]) => runs.filter((r) => r.status !== 'in_progress');
const DAY = 86_400_000;

// ---- Time windows ---------------------------------------------------------

export type WindowKey = '7d' | '30d' | '90d' | 'all';
export const WINDOWS: Record<WindowKey, { label: string; days: number | null }> = {
  '7d': { label: 'Last 7 days', days: 7 },
  '30d': { label: 'Last 30 days', days: 30 },
  '90d': { label: 'Last 90 days', days: 90 },
  all: { label: 'All loaded data', days: null },
};

export interface Period {
  start: number; // inclusive
  end: number; // exclusive
}

/** The selected window ending at `now`, and the immediately preceding window of equal length. */
export function windowPeriods(key: WindowKey, now: number, runs: Run[]) {
  const days = WINDOWS[key].days;
  const end = now + 1;
  if (days == null) {
    const starts = runs.map((r) => r.started_at).filter((t): t is number => t != null);
    return { current: { start: starts.length ? Math.min(...starts) : now, end }, previous: null };
  }
  const start = end - days * DAY;
  return { current: { start, end }, previous: { start: start - days * DAY, end: start } };
}

/** Runs without a start time cannot be placed in a window and are excluded (reported in data quality). */
export function runsIn(runs: Run[], period: Period): Run[] {
  return runs.filter((r) => r.started_at != null && r.started_at >= period.start && r.started_at < period.end);
}

// ---- Run-level shape ------------------------------------------------------

export const toolCallCount = (steps: Step[]) => steps.filter((s) => s.step_type === 'tool_call').length;
export const uniqueStepCount = (steps: Step[]) => new Set(steps.map((s) => s.normalized_name)).size;
/** Executions beyond the first of each normalized step in a run. */
export const repeatedStepCount = (steps: Step[]) => steps.length - uniqueStepCount(steps);

// ---- Behavior summary -----------------------------------------------------

export interface Summary {
  runCount: number;
  agentCount: number;
  stepSample: number; // runs used for step-count metrics (excludes in-progress runs)
  medianSteps: number | null;
  p75Steps: number | null; // null when stepSample < MIN_RUNS_FOR_QUARTILES
  p95Steps: number | null; // null when stepSample < MIN_SAMPLE_FOR_P95
  validDurationCount: number;
  excludedDurationCount: number;
  medianDuration: number | null;
  p95Duration: number | null; // null when validDurationCount < MIN_SAMPLE_FOR_P95
  succeeded: number;
  failed: number;
  inProgress: number;
  unknown: number;
  successRate: number | null; // succeeded / (succeeded + failed)
  runsWithRepeat: number;
  repeatRate: number | null; // runs with any repeated step / runs analyzed
  medianToolCalls: number | null; // per completed run
  totalToolCalls: number; // all observed tool calls
  medianUniqueSteps: number | null; // per completed run
}

export function summarize(runs: Run[], stepsByRun: StepsByRun): Summary {
  const done = completed(runs);
  const stepCounts = done.map((r) => r.step_count);
  const durations = runs.map((r) => r.duration_ms).filter((d): d is number => d != null);
  const count = (status: Run['status']) => runs.filter((r) => r.status === status).length;
  const succeeded = count('succeeded');
  const failed = count('failed');
  const runsWithRepeat = runs.filter((r) => repeatedStepCount(stepsOf(r, stepsByRun)) > 0).length;
  const doneShapes = done.map((r) => stepsOf(r, stepsByRun));
  return {
    runCount: runs.length,
    agentCount: new Set(runs.map((r) => r.agent_id)).size,
    stepSample: done.length,
    medianSteps: median(stepCounts),
    p75Steps: done.length >= MIN_RUNS_FOR_QUARTILES ? percentile(stepCounts, 0.75) : null,
    p95Steps: done.length >= MIN_SAMPLE_FOR_P95 ? percentile(stepCounts, 0.95) : null,
    validDurationCount: durations.length,
    excludedDurationCount: runs.length - durations.length,
    medianDuration: median(durations),
    p95Duration: durations.length >= MIN_SAMPLE_FOR_P95 ? percentile(durations, 0.95) : null,
    succeeded,
    failed,
    inProgress: count('in_progress'),
    unknown: count('unknown'),
    successRate: rate(succeeded, succeeded + failed),
    runsWithRepeat,
    repeatRate: rate(runsWithRepeat, runs.length),
    medianToolCalls: median(doneShapes.map(toolCallCount)),
    totalToolCalls: runs.reduce((sum, r) => sum + toolCallCount(stepsOf(r, stepsByRun)), 0),
    medianUniqueSteps: median(doneShapes.map(uniqueStepCount)),
  };
}

// ---- Step statistics ------------------------------------------------------

export interface StepStat {
  name: string; // normalized name
  sourceNames: string[]; // raw names mapped to this step that differ from `name`
  agentIds: string[];
  executions: number;
  runCount: number; // runs containing the step (counted once per run)
  penetration: number | null; // runCount / runs analyzed
  validDurationCount: number;
  totalMs: number; // sum of valid durations
  timeShare: number | null; // totalMs / total valid step time
  medianMs: number | null;
  p95Ms: number | null; // null when validDurationCount < MIN_SAMPLE_FOR_P95
  failedRuns: number; // failed runs containing the step ("failure association")
  failureConcentration: number | null; // failedRuns / failed runs analyzed
  runsRepeating: number; // runs where the step occurs more than once
  repeatRate: number | null; // runsRepeating / runCount
  medianRepetitions: number | null; // median executions per run, among runs where it repeats
  lastObserved: number | null;
}

/** Ordered by execution count (frequency), then name. */
export function stepStats(runs: Run[], stepsByRun: StepsByRun): StepStat[] {
  type Acc = {
    sourceNames: Set<string>; agentIds: Set<string>; durations: number[]; perRun: number[];
    executions: number; failedRuns: number; lastObserved: number | null;
  };
  const acc = new Map<string, Acc>();
  let totalFailed = 0;

  for (const run of runs) {
    if (run.status === 'failed') totalFailed++;
    const perRunCounts = new Map<string, number>();
    for (const step of stepsOf(run, stepsByRun)) {
      const name = step.normalized_name;
      const a = acc.get(name) ?? {
        sourceNames: new Set(), agentIds: new Set(), durations: [], perRun: [], executions: 0, failedRuns: 0, lastObserved: null,
      };
      acc.set(name, a);
      a.executions++;
      if (step.source_name && step.source_name !== name) a.sourceNames.add(step.source_name);
      a.agentIds.add(run.agent_id);
      if (step.duration_ms != null) a.durations.push(step.duration_ms);
      const seen = step.started_at ?? run.started_at;
      if (seen != null && (a.lastObserved == null || seen > a.lastObserved)) a.lastObserved = seen;
      perRunCounts.set(name, (perRunCounts.get(name) ?? 0) + 1);
    }
    for (const [name, n] of perRunCounts) {
      const a = acc.get(name)!;
      a.perRun.push(n);
      if (run.status === 'failed') a.failedRuns++;
    }
  }

  const totalTime = [...acc.values()].reduce((sum, a) => sum + a.durations.reduce((x, y) => x + y, 0), 0);
  return [...acc.entries()]
    .map(([name, a]) => {
      const totalMs = a.durations.reduce((x, y) => x + y, 0);
      const repeating = a.perRun.filter((n) => n > 1);
      return {
        name,
        sourceNames: [...a.sourceNames].sort(),
        agentIds: [...a.agentIds].sort(),
        executions: a.executions,
        runCount: a.perRun.length,
        penetration: rate(a.perRun.length, runs.length),
        validDurationCount: a.durations.length,
        totalMs,
        timeShare: rate(totalMs, totalTime),
        medianMs: median(a.durations),
        p95Ms: a.durations.length >= MIN_SAMPLE_FOR_P95 ? percentile(a.durations, 0.95) : null,
        failedRuns: a.failedRuns,
        failureConcentration: rate(a.failedRuns, totalFailed),
        runsRepeating: repeating.length,
        repeatRate: rate(repeating.length, a.perRun.length),
        medianRepetitions: median(repeating),
        lastObserved: a.lastObserved,
      };
    })
    .sort((x, y) => y.executions - x.executions || x.name.localeCompare(y.name));
}

// ---- Complexity distribution ----------------------------------------------

export type Band = 'lower' | 'typical' | 'higher' | 'unavailable';

/**
 * Bands each run against its own agent's step-count quartiles (within the runs given):
 * lower < Q1 ≤ typical ≤ Q3 < higher. Agents with fewer than MIN_RUNS_FOR_QUARTILES
 * completed runs get "unavailable" rather than an unstable band. In-progress runs are not banded.
 */
export function complexityBands(runs: Run[]): { byRun: Map<string, Band>; counts: Record<Band, number> } {
  const byRun = new Map<string, Band>();
  const counts: Record<Band, number> = { lower: 0, typical: 0, higher: 0, unavailable: 0 };
  for (const agentRuns of groupByAgent(completed(runs)).values()) {
    const steps = agentRuns.map((r) => r.step_count);
    const enough = agentRuns.length >= MIN_RUNS_FOR_QUARTILES;
    const q1 = percentile(steps, 0.25)!;
    const q3 = percentile(steps, 0.75)!;
    for (const run of agentRuns) {
      const band: Band = !enough ? 'unavailable' : run.step_count < q1 ? 'lower' : run.step_count > q3 ? 'higher' : 'typical';
      byRun.set(run.run_id, band);
      counts[band]++;
    }
  }
  return { byRun, counts };
}

export interface Bin {
  from: number;
  to: number; // inclusive
  count: number;
}

/** Integer histogram with at most `maxBins` equal-width bins. */
export function histogram(values: number[], maxBins = 12): Bin[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = Math.max(1, Math.ceil((max - min + 1) / maxBins));
  const bins: Bin[] = [];
  for (let from = min; from <= max; from += width) bins.push({ from, to: from + width - 1, count: 0 });
  for (const v of values) bins[Math.floor((v - min) / width)].count++;
  return bins;
}

// ---- Investigation candidates ---------------------------------------------

export interface Reason {
  metric: 'Step count' | 'Run duration' | 'Repeated steps';
  value: number;
  threshold: number; // the agent's 95th percentile
  sample: number; // observations used to compute the threshold
}

export interface Candidate {
  run: Run;
  reasons: Reason[];
}

/**
 * A run is a candidate when it exceeds its own agent's 95th percentile for step
 * count, run duration, or repeated-step count. Agents with fewer than
 * MIN_SAMPLE_FOR_P95 completed runs are not evaluated. In-progress runs are not
 * evaluated. Not a severity score.
 */
export function investigationCandidates(runs: Run[], stepsByRun: StepsByRun) {
  const candidates: Candidate[] = [];
  const notEvaluated: { agentId: string; runCount: number }[] = [];

  for (const [agentId, agentRuns] of groupByAgent(completed(runs))) {
    if (agentRuns.length < MIN_SAMPLE_FOR_P95) {
      notEvaluated.push({ agentId, runCount: agentRuns.length });
      continue;
    }
    const repeats = new Map(agentRuns.map((r) => [r.run_id, repeatedStepCount(stepsOf(r, stepsByRun))]));
    const durations = agentRuns.map((r) => r.duration_ms).filter((d): d is number => d != null);
    const stepP95 = percentile(agentRuns.map((r) => r.step_count), 0.95)!;
    const repeatP95 = percentile([...repeats.values()], 0.95)!;
    const durationP95 = durations.length >= MIN_SAMPLE_FOR_P95 ? percentile(durations, 0.95) : null;

    for (const run of agentRuns) {
      const reasons: Reason[] = [];
      if (run.step_count > stepP95) {
        reasons.push({ metric: 'Step count', value: run.step_count, threshold: stepP95, sample: agentRuns.length });
      }
      if (durationP95 != null && run.duration_ms != null && run.duration_ms > durationP95) {
        reasons.push({ metric: 'Run duration', value: run.duration_ms, threshold: durationP95, sample: durations.length });
      }
      const repeated = repeats.get(run.run_id)!;
      if (repeated > repeatP95) {
        reasons.push({ metric: 'Repeated steps', value: repeated, threshold: repeatP95, sample: agentRuns.length });
      }
      if (reasons.length) candidates.push({ run, reasons });
    }
  }
  // Most recent first: the list is an investigation queue, not a ranking.
  candidates.sort((a, b) => (b.run.started_at ?? 0) - (a.run.started_at ?? 0));
  return { candidates, notEvaluated };
}

// ---- Trends ---------------------------------------------------------------

export interface TrendBucket {
  start: number;
  runCount: number;
  medianSteps: number | null;
  medianDuration: number | null;
  successRate: number | null;
  repeatRate: number | null;
}

/** Time buckets for a period: daily up to 31 days, otherwise 7-day buckets aligned to the period start. */
export function timeBuckets(period: Period) {
  const grain = period.end - period.start <= 31 * DAY ? 'day' : 'week';
  const size = grain === 'day' ? DAY : 7 * DAY;
  const buckets: Period[] = [];
  for (let start = period.start; start < period.end; start += size) buckets.push({ start, end: Math.min(start + size, period.end) });
  return { grain, buckets } as const;
}

export function trend(runs: Run[], stepsByRun: StepsByRun, period: Period) {
  const { grain, buckets: periods } = timeBuckets(period);
  const buckets: TrendBucket[] = [];
  for (const { start, end } of periods) {
    const s = summarize(runsIn(runs, { start, end }), stepsByRun);
    buckets.push({
      start,
      runCount: s.runCount,
      medianSteps: s.medianSteps,
      medianDuration: s.medianDuration,
      successRate: s.successRate,
      repeatRate: s.repeatRate,
    });
  }
  return { grain, buckets } as const;
}

export function groupByAgent(runs: Run[]): Map<string, Run[]> {
  const groups = new Map<string, Run[]>();
  for (const run of runs) groups.set(run.agent_id, [...(groups.get(run.agent_id) ?? []), run]);
  return groups;
}

// ---- Run time by agent ------------------------------------------------------

export interface AgentTime {
  agentId: string;
  totalMs: number; // sum of valid run durations
  share: number | null; // totalMs / total valid run time in the window
  timedRuns: number; // runs with a valid duration
  medianMs: number | null;
}

/** Where run time accumulates across agents. Descriptive only: more time is not worse. */
export function agentTime(runs: Run[]): AgentTime[] {
  const rows = [...groupByAgent(runs)].map(([agentId, agentRuns]) => {
    const durations = agentRuns.map((r) => r.duration_ms).filter((d): d is number => d != null);
    return { agentId, totalMs: durations.reduce((a, b) => a + b, 0), timedRuns: durations.length, medianMs: median(durations) };
  });
  const total = rows.reduce((sum, r) => sum + r.totalMs, 0);
  return rows
    .map((r) => ({ ...r, share: rate(r.totalMs, total) }))
    .sort((a, b) => b.totalMs - a.totalMs || a.agentId.localeCompare(b.agentId));
}

// ---- Step heat maps -----------------------------------------------------------

export interface Heat {
  columns: string[]; // column keys (bucket start as string, or agent id)
  rows: { name: string; counts: number[] }[]; // executions per column
  max: number;
}

/** The most-used steps as rows; `columnOf` assigns each run to a column (or -1 to skip it). */
function stepHeat(runs: Run[], stepsByRun: StepsByRun, columns: string[], columnOf: (run: Run) => number, top: number): Heat {
  const names = stepStats(runs, stepsByRun).slice(0, top).map((s) => s.name);
  const rows = names.map((name) => ({ name, counts: columns.map(() => 0) }));
  const index = new Map(names.map((n, i) => [n, i]));
  for (const run of runs) {
    const col = columnOf(run);
    if (col < 0) continue;
    for (const step of stepsOf(run, stepsByRun)) {
      const row = index.get(step.normalized_name);
      if (row != null) rows[row].counts[col]++;
    }
  }
  return { columns, rows, max: Math.max(0, ...rows.flatMap((r) => r.counts)) };
}

/** Executions of the most-used steps per agent (agents ordered by name). */
export function stepsByAgent(runs: Run[], stepsByRun: StepsByRun, agentName: (id: string) => string, top = 10): Heat {
  const agents = [...new Set(runs.map((r) => r.agent_id))].sort((a, b) => agentName(a).localeCompare(agentName(b)));
  return stepHeat(runs, stepsByRun, agents, (run) => agents.indexOf(run.agent_id), top);
}

// ---- Complexity drill-in (step count is the complexity measure) ----------------

/** Completed runs ordered by step count (most complex first), for drilling into the heaviest runs. */
export function mostComplexRuns(runs: Run[], n = 15): Run[] {
  return completed(runs)
    .slice()
    .sort((a, b) => b.step_count - a.step_count || (b.duration_ms ?? 0) - (a.duration_ms ?? 0) || (b.started_at ?? 0) - (a.started_at ?? 0))
    .slice(0, n);
}

export interface AgentComplexity {
  agentId: string;
  runCount: number;
  medianSteps: number | null;
  p95Steps: number | null; // null below MIN_SAMPLE_FOR_P95
  maxSteps: number;
}

/**
 * Per-agent step-count complexity, most complex first (by median, then 95th percentile).
 * Describes execution shape, not quality — never a quality ranking.
 */
export function agentComplexity(runs: Run[]): AgentComplexity[] {
  return [...groupByAgent(completed(runs))]
    .map(([agentId, agentRuns]) => {
      const steps = agentRuns.map((r) => r.step_count);
      return {
        agentId,
        runCount: agentRuns.length,
        medianSteps: median(steps),
        p95Steps: agentRuns.length >= MIN_SAMPLE_FOR_P95 ? percentile(steps, 0.95) : null,
        maxSteps: Math.max(0, ...steps),
      };
    })
    .sort((a, b) => (b.medianSteps ?? 0) - (a.medianSteps ?? 0) || (b.p95Steps ?? b.maxSteps) - (a.p95Steps ?? a.maxSteps) || a.agentId.localeCompare(b.agentId));
}
