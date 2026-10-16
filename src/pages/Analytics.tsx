// Analytics: the portfolio dashboard. One focused sub-view at a time (chosen from a dropdown) keeps
// it readable for a data analyst and leaves room for more views later. The KPI strip is always on top.

import { agentComplexity, agentTime, completed, mostComplexRuns, stepStats, summarize, trend } from '../analytics/metrics';
import { DEF } from '../definitions';
import { fmtDateTime, fmtDuration, fmtNum, fmtPct } from '../format';
import { InlineBar, Metric, Panel, ScatterChart, StatusBadge, TimeSeries, href } from '../ui';
import type { View } from '../view';
import {
  AgentTimePanel, CandidatesPanel, ComplexityPanel, FailurePanel, PathsPanel,
  StepAgentHeatPanel, TrendsPanel, noRuns, runsMeta,
} from './shared';

export type SubView = 'summary' | 'complexity' | 'steps' | 'trends' | 'quality';
export const SUB_VIEWS: { key: SubView; label: string }[] = [
  { key: 'summary', label: 'Pulse' },
  { key: 'complexity', label: 'Complexity & outliers' },
  { key: 'steps', label: 'Flow & steps' },
  { key: 'trends', label: 'Trends' },
  { key: 'quality', label: 'Data quality' },
];
export const isSubView = (v: string): v is SubView => SUB_VIEWS.some((x) => x.key === v);
const TOP = 10;

export function Analytics({ view, subView }: { view: View; subView: SubView }) {
  const { runs, dataset } = view;
  const s = summarize(runs, dataset.stepsByRun);
  const agentName = (id: string) => dataset.agents.get(id)?.name ?? id;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <p className="subtitle">How your agents behave: run complexity, which steps and tools they use, where time goes, and what is changing.</p>
        </div>
      </div>
      <nav className="tabs" aria-label="Analytics views">
        {SUB_VIEWS.map((v) => (
          <a key={v.key} href={`#/analytics/${v.key}`} className="tab" aria-current={v.key === subView ? 'page' : undefined}>{v.label}</a>
        ))}
      </nav>

      <div className="metrics">
        <Metric label="Agents" value={fmtNum(s.agentCount)} note="with runs in window" definition={DEF.agents} />
        <Metric label="Runs" value={fmtNum(s.runCount)} note={view.windowLabel} definition={DEF.runs} />
        <Metric label="Median steps per run" value={fmtNum(s.medianSteps, 1)} note={`${fmtNum(s.stepSample)} completed runs`} definition={DEF.medianSteps} />
        <Metric label="Median run duration" value={fmtDuration(s.medianDuration)} note={`${fmtNum(s.validDurationCount)} valid · ${fmtNum(s.excludedDurationCount)} excluded`} definition={DEF.medianDuration} />
        <Metric label="Successful run rate" value={fmtPct(s.successRate)} note={`${s.succeeded} of ${s.succeeded + s.failed} finished`} definition={DEF.successRate} />
      </div>

      <div className="grid">
        {subView === 'summary' && <><PulseTrend view={view} /><HighlightsPanel view={view} /><CandidatesPanel view={view} limit={8} /></>}

        {subView === 'complexity' && (
          <>
            <CandidatesPanel view={view} featured />
            <ScatterPanel view={view} />
            <ComplexityPanel view={view} wide />
            <MostComplexRunsPanel view={view} />
            <AgentComplexityPanel view={view} />
          </>
        )}

        {subView === 'steps' && (
          <>
            <Panel title="Most used steps and tools" definition={DEF.stepUsage} meta={runsMeta(view)} empty={noRuns(view)} wide>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th scope="col">Step or tool</th><th scope="col">Executions</th><th scope="col">Runs containing it</th><th scope="col">Share of runs</th><th scope="col">Agents</th></tr>
                  </thead>
                  <tbody>
                    {stepStats(runs, dataset.stepsByRun).slice(0, TOP).map((x) => (
                      <tr key={x.name}>
                        <th scope="row">{x.name}</th>
                        <td>{fmtNum(x.executions)}</td>
                        <td>{fmtNum(x.runCount)}</td>
                        <td><InlineBar value={x.penetration ?? 0} /> {fmtPct(x.penetration)}</td>
                        <td>{x.agentIds.map((id, i) => <span key={id}>{i > 0 && ', '}<a href={href('agents', id)}>{agentName(id)}</a></span>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <StepAgentHeatPanel view={view} />
            <RepeatedStepsPanel view={view} />
            <div className="row-2">
              <PathsPanel view={view} />
              <FailurePanel view={view} />
            </div>
          </>
        )}

        {subView === 'trends' && (
          <>
            <TrendsPanel view={view} />
            <AgentTimePanel view={view} />
          </>
        )}

        {subView === 'quality' && <DataQualityPanel view={view} />}
      </div>
    </>
  );
}

/** At-a-glance callouts that answer "which single run / agent is the most complex, and where does time go?" */
function HighlightsPanel({ view }: { view: View }) {
  const complexRun = mostComplexRuns(view.runs, 1)[0];
  const complexAgent = agentComplexity(view.runs)[0];
  const busiest = agentTime(view.runs).find((a) => a.timedRuns > 0);
  const name = (id: string) => view.dataset.agents.get(id)?.name ?? id;
  return (
    <Panel
      title="Highlights"
      definition="The most complex single run and agent (by step count) and where run time concentrates. Complexity describes execution shape, not quality. Select an item to drill in."
      meta={runsMeta(view)}
      empty={noRuns(view)}
      wide
    >
      <div className="highlights">
        <div className="highlight">
          <span className="highlight-label">Most complex run</span>
          {complexRun ? (
            <>
              <a className="highlight-value" href={href('agents', complexRun.agent_id, 'runs', complexRun.run_id)}>{complexRun.step_count} steps</a>
              <span className="meta">{name(complexRun.agent_id)} · {complexRun.run_id} · {fmtDuration(complexRun.duration_ms)}</span>
            </>
          ) : <span className="muted">No completed runs.</span>}
        </div>
        <div className="highlight">
          <span className="highlight-label">Most complex agent (median steps)</span>
          {complexAgent ? (
            <>
              <a className="highlight-value" href={href('agents', complexAgent.agentId)}>{fmtNum(complexAgent.medianSteps, 1)} steps</a>
              <span className="meta">{name(complexAgent.agentId)} · max {complexAgent.maxSteps} · {complexAgent.runCount} runs</span>
            </>
          ) : <span className="muted">No completed runs.</span>}
        </div>
        <div className="highlight">
          <span className="highlight-label">Most run time</span>
          {busiest ? (
            <>
              <a className="highlight-value" href={href('agents', busiest.agentId)}>{fmtDuration(busiest.totalMs)}</a>
              <span className="meta">{name(busiest.agentId)} · {fmtPct(busiest.share)} of run time · {busiest.timedRuns} runs</span>
            </>
          ) : <span className="muted">No valid run timing.</span>}
        </div>
      </div>
    </Panel>
  );
}

/** The heaviest runs by step count, with a drill-through to each run summary. */
function MostComplexRunsPanel({ view }: { view: View }) {
  const runs = mostComplexRuns(view.runs, 15);
  const name = (id: string) => view.dataset.agents.get(id)?.name ?? id;
  return (
    <Panel
      title="Most complex runs"
      definition={`${DEF.stepCount} These are the completed runs with the most steps. Open one to see its ordered steps. Most steps is not worse — it reflects what the run did.`}
      meta={runsMeta(view)}
      empty={noRuns(view)}
      wide
    >
      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Run</th><th scope="col">Agent</th><th scope="col">Steps</th><th scope="col">Duration</th><th scope="col">Status</th><th scope="col">Started</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.run_id}>
                <td><a href={href('agents', r.agent_id, 'runs', r.run_id)}>{r.run_id}</a></td>
                <td><a href={href('agents', r.agent_id)}>{name(r.agent_id)}</a></td>
                <td><strong>{r.step_count}</strong></td>
                <td>{fmtDuration(r.duration_ms)}</td>
                <td><StatusBadge status={r.status} /></td>
                <td>{fmtDateTime(r.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Per-agent complexity, most complex first. Explicitly descriptive, not a quality ranking. */
function AgentComplexityPanel({ view }: { view: View }) {
  const rows = agentComplexity(view.runs);
  const name = (id: string) => view.dataset.agents.get(id)?.name ?? id;
  return (
    <Panel
      title="Agents by typical complexity"
      definition="Each agent's step count per run (median, 95th percentile, max), most complex first. This describes execution shape, not quality — a higher step count does not mean an agent is worse."
      meta={runsMeta(view)}
      empty={noRuns(view)}
      wide
    >
      <table>
        <thead><tr><th scope="col">Agent</th><th scope="col">Completed runs</th><th scope="col">Median steps</th><th scope="col">95th pct.</th><th scope="col">Max</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.agentId}>
              <th scope="row"><a href={href('agents', a.agentId)}>{name(a.agentId)}</a></th>
              <td>{fmtNum(a.runCount)}</td>
              <td>{fmtNum(a.medianSteps, 1)}</td>
              <td>{a.p95Steps == null ? <span className="muted">needs 20+</span> : fmtNum(a.p95Steps, 1)}</td>
              <td>{a.maxSteps}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/** A compact trend strip for the Pulse landing: volume, complexity, and success over the window. */
function PulseTrend({ view }: { view: View }) {
  const { grain, buckets } = trend(view.runs, view.dataset.stepsByRun, view.period);
  const series = (pick: (b: (typeof buckets)[number]) => number | null) => buckets.map((b) => ({ t: b.start, v: pick(b) }));
  return (
    <Panel title="Portfolio over time" definition={`Run volume, typical complexity, and success per ${grain}. ${DEF.trends}`} meta={runsMeta(view)} empty={noRuns(view)} wide>
      <div className="charts">
        <TimeSeries title={`Runs per ${grain}`} kind="bar" points={series((b) => b.runCount)} format={(v) => fmtNum(v)} />
        <TimeSeries title="Median steps per run" kind="line" points={series((b) => b.medianSteps)} format={(v) => fmtNum(v, 1)} />
        <TimeSeries title="Successful run rate" kind="line" points={series((b) => b.successRate)} format={(v) => fmtPct(v)} />
      </div>
    </Panel>
  );
}

/** Steps × run duration, one dot per completed run. Outliers read top-right; a dot opens its run. */
function ScatterPanel({ view }: { view: View }) {
  const runs = completed(view.runs).filter((r) => r.duration_ms != null);
  const maxSteps = Math.max(0, ...runs.map((r) => r.step_count));
  const name = (id: string) => view.dataset.agents.get(id)?.name ?? id;
  const points = runs.map((r) => ({
    x: r.step_count,
    y: r.duration_ms as number,
    label: `${name(r.agent_id)} · ${r.run_id}`,
    href: href('agents', r.agent_id, 'runs', r.run_id),
    highlight: maxSteps > 0 && r.step_count === maxSteps,
  }));
  return (
    <Panel
      title="Runs by complexity and duration"
      definition="Each dot is a completed run: steps (x) against run duration (y). Outliers sit toward the top-right; select a dot to open the run. Complexity is execution shape, not quality."
      meta={`${runsMeta(view)} · ${fmtNum(points.length)} runs with valid timing`}
      empty={noRuns(view)}
      insufficient={view.runs.length && points.length === 0 ? 'No run in this window has valid timing.' : null}
      wide
    >
      <ScatterChart points={points} xLabel="Steps" yLabel="Run duration" xFormat={(v) => fmtNum(v)} yFormat={(v) => fmtDuration(v)} />
    </Panel>
  );
}

function RepeatedStepsPanel({ view }: { view: View }) {
  const s = summarize(view.runs, view.dataset.stepsByRun);
  const steps = stepStats(view.runs, view.dataset.stepsByRun).filter((x) => x.runsRepeating > 0).sort((a, b) => b.runsRepeating - a.runsRepeating).slice(0, TOP);
  return (
    <Panel
      title="Repeated steps"
      definition={`${DEF.stepRepeatRate} Overall: ${DEF.repeatRate}`}
      meta={`${runsMeta(view)} · overall repeated-step rate ${fmtPct(s.repeatRate)} (${s.runsWithRepeat} of ${s.runCount} runs)`}
      empty={noRuns(view)}
      wide
    >
      {steps.length === 0 ? <p>No step ran more than once within a run in this window.</p> : (
        <table>
          <thead>
            <tr><th scope="col">Step</th><th scope="col">Runs containing it</th><th scope="col">Runs where it repeats</th><th scope="col">Repeated-step rate</th><th scope="col">Median executions when repeated</th></tr>
          </thead>
          <tbody>
            {steps.map((x) => (
              <tr key={x.name}>
                <th scope="row">{x.name}</th>
                <td>{fmtNum(x.runCount)}</td>
                <td>{fmtNum(x.runsRepeating)}</td>
                <td>{fmtPct(x.repeatRate)}</td>
                <td>{fmtNum(x.medianRepetitions, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function DataQualityPanel({ view }: { view: View }) {
  const { dataset, runs } = view;
  const s = summarize(runs, dataset.stepsByRun);
  const counts = new Map<string, number>();
  for (const issue of dataset.issues) counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  const unplaced = dataset.runs.filter((r) => r.started_at == null).length;
  return (
    <Panel
      title="Data quality"
      definition="What was analyzed, what was excluded, and why. Invalid records are excluded from the affected calculations only."
      meta={`Mode: ${dataset.mode === 'synthetic' ? 'Synthetic' : 'Live'} · Source: ${dataset.source_label} · Refreshed ${fmtDateTime(dataset.loaded_at)}`}
      wide
    >
      <dl className="facts">
        <dt>Filter window</dt><dd>{view.windowLabel}</dd>
        <dt>Agents / runs analyzed</dt><dd>{fmtNum(s.agentCount)} / {fmtNum(s.runCount)}</dd>
        <dt>Valid run durations</dt><dd>{fmtNum(s.validDurationCount)}</dd>
        <dt>Excluded run durations</dt><dd>{fmtNum(s.excludedDurationCount)} (in progress, missing, or invalid timing)</dd>
        <dt>Unknown-status runs</dt><dd>{fmtNum(s.unknown)} (plus {fmtNum(s.inProgress)} in progress) — not counted as failures</dd>
        <dt>Runs without a start time</dt><dd>{fmtNum(unplaced)} (cannot be placed in any window)</dd>
      </dl>
      <h3>Issues found while loading (all loaded data)</h3>
      {counts.size === 0 ? (
        <p>No data-quality issues were found.</p>
      ) : (
        <table>
          <thead><tr><th scope="col">Issue</th><th scope="col">Records</th></tr></thead>
          <tbody>
            {[...counts].sort((a, b) => b[1] - a[1]).map(([code, n]) => (
              <tr key={code}><th scope="row">{code.replace(/_/g, ' ')}</th><td>{n}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
