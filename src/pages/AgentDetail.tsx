import { MIN_SAMPLE_FOR_P95, complexityBands, stepStats, summarize } from '../analytics/metrics';
import { sequencePatterns } from '../analytics/sequences';
import { DEF } from '../definitions';
import { fmtDateTime, fmtDuration, fmtNum, fmtPct } from '../format';
import { Notice, Panel, StatusBadge, Tags, agentFoundryUrl, href } from '../ui';
import { forAgent, type View } from '../view';
import { CandidatesPanel, ComplexityPanel, DurationPanel, TrendsPanel, noRuns, runsMeta } from './shared';

/** One compact stat in the behavior-profile strip (label above a value, with optional note). */
function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

export function AgentDetail({ view: all, agentId }: { view: View; agentId: string }) {
  const agent = all.dataset.agents.get(agentId);
  if (!agent) return <Notice kind="empty">This agent is not in the loaded data. <a href={href('agents')}>Back to Agents</a></Notice>;

  const view = forAgent(all, agentId);
  const { stepsByRun } = view.dataset;
  const s = summarize(view.runs, stepsByRun);
  const steps = stepStats(view.runs, stepsByRun);
  const empty = noRuns(view);
  const foundryUrl = agentFoundryUrl(view.settings, agent.agent_id, agent.foundry_url);
  const anyStepTiming = steps.some((x) => x.validDurationCount > 0);

  return (
    <>
      <p className="breadcrumb"><a href={href('agents')}>Agents</a> / {agent.name}</p>
      <div className="page-header">
        <div>
          <h1>{agent.name}</h1>
          <p className="subtitle">{agent.description || <span className="muted">No description provided.</span>}</p>
          <Tags tags={agent.tags} />
        </div>
        <div className="page-actions">
          {foundryUrl
            ? <a className="button primary" href={foundryUrl} target="_blank" rel="noopener noreferrer">{view.settings.foundryLinkLabel} ↗</a>
            : <a className="button" href="#/settings" title="Add a Foundry link pattern in Settings to open agents in the portal">Set up Foundry links</a>}
        </div>
      </div>
      <p className="meta">{view.windowLabel} · {fmtNum(s.runCount)} runs analyzed · last run {fmtDateTime(agent.last_observed_at)} · refreshed {fmtDateTime(view.dataset.loaded_at)}</p>

      {empty ? <Notice kind="empty">{empty}</Notice> : (
        <section className="panel profile-panel" aria-label="Behavior profile">
          <div className="profile">
            <Stat label="Median steps" value={fmtNum(s.medianSteps, 1)} note={`n = ${s.stepSample}`} />
            <Stat label="75th pct. steps" value={fmtNum(s.p75Steps, 1)} />
            <Stat label="95th pct. steps" value={fmtNum(s.p95Steps, 1)} note={s.p95Steps == null ? `needs ${MIN_SAMPLE_FOR_P95}+` : undefined} />
            <Stat label="Median duration" value={fmtDuration(s.medianDuration)} />
            <Stat label="95th pct. duration" value={fmtDuration(s.p95Duration)} note={s.p95Duration == null ? `needs ${MIN_SAMPLE_FOR_P95}+` : undefined} />
            <Stat label="Success rate" value={fmtPct(s.successRate)} note={`${s.succeeded} ok · ${s.failed} failed · ${s.unknown + s.inProgress} other`} />
            <Stat label="Repeated-step rate" value={fmtPct(s.repeatRate)} note={`${s.runsWithRepeat} of ${s.runCount} runs`} />
            <Stat label="Median tool calls" value={fmtNum(s.medianToolCalls, 1)} note="per run" />
            <Stat label="Median unique steps" value={fmtNum(s.medianUniqueSteps, 1)} note="per run" />
          </div>
        </section>
      )}

      <div className="grid">
        <TrendsPanel view={view} />
        <ComplexityPanel view={view} />
        <DurationPanel view={view} />

        <Panel title="Steps and tools" definition={`${DEF.stepUsage} ${DEF.failureAssociation}`} meta={`${runsMeta(view)}${anyStepTiming ? '' : ' · this source reports no per-step timing (duration columns are blank)'}`} empty={empty} wide>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Step or tool</th><th scope="col">Executions</th>
                  <th scope="col">Runs containing</th><th scope="col">% of runs</th>
                  {anyStepTiming && <><th scope="col">Median duration</th><th scope="col" title={`Needs ${MIN_SAMPLE_FOR_P95}+ timed executions`}>95th pct.</th><th scope="col">Total duration</th></>}
                  <th scope="col">Failed runs</th><th scope="col">Repeated-step rate</th><th scope="col">Last observed</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((x) => (
                  <tr key={x.name}>
                    <th scope="row">{x.name}{x.sourceNames.length > 0 && <span className="muted"> ({x.sourceNames.join(', ')})</span>}</th>
                    <td>{fmtNum(x.executions)}</td>
                    <td>{fmtNum(x.runCount)}</td>
                    <td>{fmtPct(x.penetration)}</td>
                    {anyStepTiming && (
                      <>
                        <td>{fmtDuration(x.medianMs)} {x.validDurationCount > 0 && <span className="muted">n={x.validDurationCount}</span>}</td>
                        <td>{x.p95Ms == null ? <span className="muted">—</span> : fmtDuration(x.p95Ms)}</td>
                        <td>{x.validDurationCount ? fmtDuration(x.totalMs) : <span className="muted">—</span>}</td>
                      </>
                    )}
                    <td>{fmtNum(x.failedRuns)}</td>
                    <td>{fmtPct(x.repeatRate)}</td>
                    <td>{fmtDateTime(x.lastObserved)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <SequencesPanel view={view} agentId={agentId} />
        <CandidatesPanel view={view} limit={25} />
        <RecentRunsPanel view={view} />
      </div>
    </>
  );
}

/** Common two- and three-step sequences, side by side in one panel. */
function SequencesPanel({ view, agentId }: { view: View; agentId: string }) {
  const table = (length: 2 | 3) => {
    const patterns = sequencePatterns(agentId, view.runs, view.dataset.stepsByRun, length).slice(0, 8);
    return (
      <div>
        <h3>{length === 2 ? 'Two-step' : 'Three-step'}</h3>
        {patterns.length === 0 ? <p className="meta">No run has {length} or more steps.</p> : (
          <table>
            <thead><tr><th scope="col">Ordered sequence</th><th scope="col">Runs</th><th scope="col">% of runs</th></tr></thead>
            <tbody>
              {patterns.map((p) => (
                <tr key={p.pattern_id}>
                  <th scope="row">{p.sequence.join(' → ')}</th>
                  <td>{fmtNum(p.run_count)}</td>
                  <td>{fmtPct(p.penetration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };
  return (
    <Panel title="Common execution paths" definition={`${DEF.sequences} Derived data.`} meta={runsMeta(view)} empty={noRuns(view)} wide>
      <div className="two-col">{table(2)}{table(3)}</div>
    </Panel>
  );
}

function RecentRunsPanel({ view }: { view: View }) {
  const bands = complexityBands(view.runs).byRun;
  const recent = [...view.runs].sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0)).slice(0, 25);
  return (
    <Panel title="Recent runs" definition="The most recent runs in the window. Open one for its summarized step sequence." meta={`${runsMeta(view)} · showing ${recent.length}`} empty={noRuns(view)} wide>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th scope="col">Run</th><th scope="col">Started</th><th scope="col">Status</th><th scope="col">Steps</th><th scope="col">Complexity</th><th scope="col">Duration</th></tr>
          </thead>
          <tbody>
            {recent.map((run) => (
              <tr key={run.run_id}>
                <td><a href={href('agents', run.agent_id, 'runs', run.run_id)}>{run.run_id}</a></td>
                <td>{fmtDateTime(run.started_at)}</td>
                <td><StatusBadge status={run.status} /></td>
                <td>{run.step_count}</td>
                <td>{bands.get(run.run_id) === 'unavailable' ? <span className="muted">—</span> : bands.get(run.run_id) ?? <span className="muted">—</span>}</td>
                <td>{fmtDuration(run.duration_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
