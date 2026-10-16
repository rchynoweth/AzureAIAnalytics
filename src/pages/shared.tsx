// Sections used by both Overview and Agent detail.

import {
  MIN_SAMPLE_FOR_P95, agentTime, completed, complexityBands, histogram, investigationCandidates, stepStats, stepsByAgent,
  summarize, trend, type Summary,
} from '../analytics/metrics';
import { sequencePatterns } from '../analytics/sequences';
import { change } from '../analytics/stats';
import { DEF } from '../definitions';
import { fmtDateTime, fmtDuration, fmtNum, fmtPct, fmtSigned } from '../format';
import { BarList, HeatMap, Histogram, InlineBar, Panel, TimeSeries, href } from '../ui';
import type { View } from '../view';

export const runsMeta = (view: View, n = view.runs.length) => `${view.windowLabel} · ${fmtNum(n)} runs`;
export const noRuns = (view: View) => (view.runs.length ? null : `No runs started in ${view.windowLabel}. Try a longer window.`);

type Kind = 'count' | 'steps' | 'ms' | 'rate';
const ROWS: { label: string; pick: (s: Summary) => number | null; kind: Kind }[] = [
  { label: 'Run volume', pick: (s) => s.runCount, kind: 'count' },
  { label: 'Median steps per run', pick: (s) => s.medianSteps, kind: 'steps' },
  { label: 'Median run duration', pick: (s) => s.medianDuration, kind: 'ms' },
  { label: 'Successful run rate', pick: (s) => s.successRate, kind: 'rate' },
  { label: 'Repeated-step rate', pick: (s) => s.repeatRate, kind: 'rate' },
];

const show = (v: number | null, kind: Kind) =>
  kind === 'ms' ? fmtDuration(v) : kind === 'rate' ? fmtPct(v) : fmtNum(v, kind === 'steps' ? 1 : 0);
const showDiff = (v: number | null, kind: Kind) =>
  kind === 'rate' ? fmtSigned(v == null ? null : v * 100, (x) => `${x.toFixed(0)} pts`) : fmtSigned(v, (x) => show(x, kind));

/** Time-series charts per day/week, then this window compared with the previous one. */
export function TrendsPanel({ view }: { view: View }) {
  const { stepsByRun } = view.dataset;
  const current = summarize(view.runs, stepsByRun);
  const previous = view.previousPeriod ? summarize(view.previousRuns, stepsByRun) : null;
  const { grain, buckets } = trend(view.runs, stepsByRun, view.period);
  const series = (pick: (b: (typeof buckets)[number]) => number | null) => buckets.map((b) => ({ t: b.start, v: pick(b) }));
  return (
    <Panel
      title="Behavior over time"
      definition={`${DEF.trends} Charts show one point per ${grain}; gaps mean no runs (or no valid values) that ${grain}.`}
      meta={`${runsMeta(view)}${previous ? ` · previous window ${fmtNum(previous.runCount)} runs` : ''} · ${grain === 'day' ? 'daily' : 'weekly'} points`}
      empty={noRuns(view)}
      wide
    >
      <div className="charts">
        <TimeSeries title={`Runs per ${grain}`} kind="bar" points={series((b) => b.runCount)} format={(v) => fmtNum(v)} />
        <TimeSeries title="Median steps per run" kind="line" points={series((b) => b.medianSteps)} format={(v) => fmtNum(v, 1)} />
        <TimeSeries title="Median run duration" kind="line" points={series((b) => b.medianDuration)} format={fmtDuration} />
        <TimeSeries title="Successful run rate" kind="line" points={series((b) => b.successRate)} format={(v) => fmtPct(v)} />
      </div>
      <h3>This window compared with the previous one</h3>
      {!previous && <p className="meta">"All loaded data" has no earlier window to compare with; choose a fixed window to see changes.</p>}
      <table>
        <thead>
          <tr>
            <th scope="col">Measure</th><th scope="col">This window</th><th scope="col">Previous window</th>
            <th scope="col">Change</th><th scope="col">% change</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const c = change(row.pick(current), previous ? row.pick(previous) : null);
            return (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{show(c.current, row.kind)}</td>
                <td>{previous ? show(c.previous, row.kind) : '—'}</td>
                <td>{previous ? showDiff(c.difference, row.kind) : '—'}</td>
                <td>{!previous ? '—' : c.percentChange == null ? <span className="muted">Not comparable</span> : fmtSigned(c.percentChange * 100, (x) => `${x.toFixed(0)}%`)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

/** Heat map: which agents use which steps and tools. */
export function StepAgentHeatPanel({ view }: { view: View }) {
  const name = (id: string) => view.dataset.agents.get(id)?.name ?? id;
  const heat = stepsByAgent(view.runs, view.dataset.stepsByRun, name);
  return (
    <Panel
      title="Which agents use which steps"
      definition="Executions of the most-used steps and tools, split by agent. Darker cells mean more executions; hover a cell for its count. Select an agent name for its details."
      meta={`${runsMeta(view)} · ${heat.columns.length} agents`}
      empty={noRuns(view)}
      wide
    >
      <HeatMap
        rows={heat.rows}
        columns={heat.columns}
        max={heat.max}
        unit="executions"
        columnLabel={(id) => <a href={href('agents', id)} className="heat-agent">{name(id)}</a>}
      />
    </Panel>
  );
}

/** Where run time accumulates across agents (run durations; Foundry reports no per-step timing). */
export function AgentTimePanel({ view }: { view: View }) {
  const rows = agentTime(view.runs).filter((r) => r.timedRuns > 0);
  const name = (id: string) => view.dataset.agents.get(id)?.name ?? id;
  return (
    <Panel
      title="Where run time accumulates, by agent"
      definition="Sum of valid run durations per agent, and its share of all run time in the window, with the median run for context. More time is not worse: it reflects how often and how long an agent runs."
      meta={runsMeta(view)}
      empty={noRuns(view)}
      insufficient={view.runs.length && !rows.length ? 'No run in this window has valid timing.' : null}
      wide
    >
      <BarList
        rows={rows.slice(0, 10).map((r) => ({
          key: r.agentId,
          label: <a href={href('agents', r.agentId)}>{name(r.agentId)}</a>,
          value: r.totalMs,
          display: `${fmtDuration(r.totalMs)} · ${fmtPct(r.share)}`,
          detail: `${r.timedRuns} timed runs · median ${fmtDuration(r.medianMs)}`,
        }))}
      />
    </Panel>
  );
}

/** The most common exact two- and three-step paths, across agents. */
export function PathsPanel({ view }: { view: View }) {
  const { stepsByRun, agents } = view.dataset;
  const byAgent = new Map<string, typeof view.runs>();
  for (const run of view.runs) byAgent.set(run.agent_id, [...(byAgent.get(run.agent_id) ?? []), run]);
  const paths = [...byAgent].flatMap(([agentId, runs]) => [...sequencePatterns(agentId, runs, stepsByRun, 2), ...sequencePatterns(agentId, runs, stepsByRun, 3)])
    .sort((a, b) => b.run_count - a.run_count || b.sequence_length - a.sequence_length || b.occurrence_count - a.occurrence_count)
    .slice(0, 10);
  return (
    <Panel title="Common execution paths" definition={`${DEF.sequences} Derived data; open an agent for all of its paths.`} meta={runsMeta(view)} empty={noRuns(view)}>
      {paths.length === 0 ? <p>No run has two or more steps.</p> : (
        <table>
          <thead><tr><th scope="col">Ordered path</th><th scope="col">Agent</th><th scope="col">Runs</th><th scope="col">% of agent's runs</th></tr></thead>
          <tbody>
            {paths.map((p) => (
              <tr key={p.pattern_id}>
                <th scope="row">{p.sequence.join(' → ')}</th>
                <td><a href={href('agents', p.agent_id)}>{agents.get(p.agent_id)?.name ?? p.agent_id}</a></td>
                <td>{fmtNum(p.run_count)}</td>
                <td>{fmtPct(p.penetration)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/** Steps and tools present in failed runs (association, not cause). */
export function FailurePanel({ view }: { view: View }) {
  const s = summarize(view.runs, view.dataset.stepsByRun);
  const steps = stepStats(view.runs, view.dataset.stepsByRun).filter((x) => x.failedRuns > 0).sort((a, b) => b.failedRuns - a.failedRuns).slice(0, 10);
  return (
    <Panel
      title="Steps and tools in failed runs"
      definition={`${DEF.failureAssociation} Share of failures: failed runs containing the step ÷ all failed runs.`}
      meta={`${runsMeta(view)} · ${fmtNum(s.failed)} failed runs`}
      empty={noRuns(view)}
    >
      {s.failed === 0 ? <p>No failed runs in this window.</p> : (
        <table>
          <thead><tr><th scope="col">Step or tool</th><th scope="col">Failed runs containing it</th><th scope="col">Share of failures</th></tr></thead>
          <tbody>
            {steps.map((x) => (
              <tr key={x.name}>
                <th scope="row">{x.name}</th>
                <td>{fmtNum(x.failedRuns)}</td>
                <td><InlineBar value={x.failureConcentration ?? 0} /> {fmtPct(x.failureConcentration)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

export function CandidatesPanel({ view, limit = 10, featured }: { view: View; limit?: number; featured?: boolean }) {
  const { candidates, notEvaluated } = investigationCandidates(view.runs, view.dataset.stepsByRun);
  const agentName = (id: string) => view.dataset.agents.get(id)?.name ?? id;
  const allSkipped = view.runs.length > 0 && notEvaluated.length === new Set(view.runs.map((r) => r.agent_id)).size;
  const top = candidates[0];
  return (
    <Panel
      title="Investigation candidates"
      definition={DEF.candidates}
      meta={`${runsMeta(view)} · ${fmtNum(candidates.length)} candidates, most recent first`}
      empty={noRuns(view)}
      insufficient={allSkipped ? `Every agent here has fewer than ${MIN_SAMPLE_FOR_P95} runs in this window, so no agent-relative threshold is applied.` : null}
      wide
      featured={featured}
      badge={featured ? 'Recommended to review' : undefined}
    >
      {featured && !allSkipped && (
        <p className="recommendation">
          {candidates.length === 0 ? (
            <>Nothing stands out: no run in this window went beyond its agent's own 95th percentile for steps or duration.</>
          ) : (
            <>
              <strong>{fmtNum(candidates.length)} {candidates.length === 1 ? 'run' : 'runs'}</strong> behaved unusually for their own agent — each exceeded that agent's 95th percentile for steps or run duration. These are the best places to start a review.
              {top && <> Start with the most recent: <a href={href('agents', top.run.agent_id, 'runs', top.run.run_id)}>{agentName(top.run.agent_id)} · {top.run.run_id}</a>.</>}
            </>
          )}
        </p>
      )}
      {candidates.length === 0 ? (
        <p>No run exceeds its agent's 95th percentile in this window.</p>
      ) : (
        <table>
          <thead>
            <tr><th scope="col">Run</th><th scope="col">Agent</th><th scope="col">Started</th><th scope="col">Why it is listed</th></tr>
          </thead>
          <tbody>
            {candidates.slice(0, limit).map(({ run, reasons }) => (
              <tr key={run.run_id}>
                <td><a href={href('agents', run.agent_id, 'runs', run.run_id)}>{run.run_id}</a></td>
                <td><a href={href('agents', run.agent_id)}>{agentName(run.agent_id)}</a></td>
                <td>{fmtDateTime(run.started_at)}</td>
                <td>
                  {reasons.map((r) => (
                    <div key={r.metric}>
                      {r.metric}: {r.metric === 'Run duration' ? fmtDuration(r.value) : r.value} — above this agent's 95th percentile of{' '}
                      {r.metric === 'Run duration' ? fmtDuration(r.threshold) : fmtNum(r.threshold, 1)} (n = {r.sample})
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {candidates.length > limit && <p className="meta">Showing {limit} of {candidates.length}. Open an agent to see all of its candidates.</p>}
      {notEvaluated.length > 0 && !allSkipped && (
        <p className="meta">
          Not evaluated (fewer than {MIN_SAMPLE_FOR_P95} runs in window):{' '}
          {notEvaluated.map((n, i) => (
            <span key={n.agentId}>{i > 0 && ', '}<a href={href('agents', n.agentId)}>{agentName(n.agentId)}</a> ({n.runCount})</span>
          ))}
        </p>
      )}
    </Panel>
  );
}

export function ComplexityPanel({ view, wide }: { view: View; wide?: boolean }) {
  const done = completed(view.runs);
  const bands = complexityBands(view.runs);
  return (
    <Panel title="Run complexity (steps per run)" definition={`${DEF.stepCount} ${DEF.complexity}`} meta={`${runsMeta(view, done.length)} (completed)`} empty={noRuns(view)} wide={wide}>
      <Histogram bins={histogram(done.map((r) => r.step_count))} label="Histogram of steps per run" xLabel="Steps per run" />
      <BarList
        rows={(['lower', 'typical', 'higher', 'unavailable'] as const).map((band) => ({
          key: band,
          label: band === 'unavailable' ? 'No band (small sample)' : `${band[0].toUpperCase()}${band.slice(1)} for its agent`,
          value: bands.counts[band],
          display: `${bands.counts[band]} runs`,
        }))}
      />
    </Panel>
  );
}

export function DurationPanel({ view }: { view: View }) {
  const seconds = view.runs.map((r) => r.duration_ms).filter((d): d is number => d != null).map((d) => Math.round(d / 1000));
  return (
    <Panel
      title="Run duration distribution"
      definition={DEF.medianDuration}
      meta={`${view.windowLabel} · ${fmtNum(seconds.length)} runs with valid timing · ${fmtNum(view.runs.length - seconds.length)} excluded`}
      empty={noRuns(view)}
      insufficient={view.runs.length && !seconds.length ? 'No run in this window has valid timing.' : null}
    >
      <Histogram bins={histogram(seconds)} label="Histogram of run duration in seconds" xLabel="Run duration (seconds)" />
    </Panel>
  );
}

