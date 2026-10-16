// A summarized run: ordered steps and repetition. Deliberately not a trace viewer;
// detailed spans and timings live in Foundry.

import { useState } from 'react';
import { fmtDateTime, fmtDuration, fmtNum } from '../format';
import { ExternalLink, Metric, Notice, StatusBadge, href, runFoundryUrl } from '../ui';
import type { View } from '../view';

export function RunSummary({ view, agentId, runId }: { view: View; agentId: string; runId: string }) {
  const { dataset, settings } = view;
  const run = dataset.runs.find((r) => r.run_id === runId && r.agent_id === agentId);
  const agent = dataset.agents.get(agentId);
  const [copied, setCopied] = useState(false);
  if (!run || !agent) return <Notice kind="empty">This run is not in the loaded data. <a href={href('agents', agentId)}>Back to the agent</a></Notice>;

  const steps = dataset.stepsByRun.get(run.run_id) ?? [];
  const totals = new Map<string, number>();
  for (const s of steps) totals.set(s.normalized_name, (totals.get(s.normalized_name) ?? 0) + 1);
  const seen = new Map<string, number>();
  const tools = [...new Set(steps.map((s) => s.tool_name).filter(Boolean))];

  // Runs have no name in Foundry, so build a readable one from the agent and when it ran.
  const title = run.started_at ? `${agent.name} · ${fmtDateTime(run.started_at)}` : `${agent.name} run`;
  const copyId = () => {
    navigator.clipboard?.writeText(run.run_id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };

  return (
    <>
      <p className="breadcrumb">
        <a href={href('agents')}>Agents</a> / <a href={href('agents', agentId)}>{agent.name}</a> / Run
      </p>
      <div className="page-header">
        <div>
          <p className="eyebrow">Run summary</p>
          <h1>{title}</h1>
          <p className="run-id">
            <span className="muted">Run ID</span>
            <code>{run.run_id}</code>
            <button type="button" className="copy-btn" onClick={copyId}>{copied ? 'Copied' : 'Copy'}</button>
          </p>
        </div>
        <div className="page-actions"><StatusBadge status={run.status} /></div>
      </div>

      <div className="metrics">
        <Metric label="Steps" value={fmtNum(run.step_count)} definition="Observable steps recorded for this run." />
        <Metric
          label="Duration"
          value={run.duration_ms == null ? '—' : fmtDuration(run.duration_ms)}
          note={run.duration_ms == null ? 'in progress or not reported' : undefined}
          definition="Wall-clock time from start to end."
        />
        <Metric label="Tools used" value={fmtNum(tools.length)} note={tools.length ? tools.join(', ') : 'none'} definition="Distinct tools invoked in this run." />
      </div>

      <dl className="facts">
        <dt>Agent</dt><dd><a href={href('agents', agentId)}>{agent.name}</a></dd>
        <dt>Started</dt><dd>{fmtDateTime(run.started_at)}</dd>
        <dt>Ended</dt><dd>{fmtDateTime(run.ended_at)}</dd>
        <dt>Open in</dt><dd><ExternalLink url={runFoundryUrl(settings, run)} label={settings.foundryLinkLabel} /></dd>
        <dt>Source record</dt><dd><ExternalLink url={run.source_url} label="Open source record" /></dd>
      </dl>

      <h2 className="section-title">Ordered steps</h2>
      <p className="definition">The observable steps in recorded order. For spans, inputs, and outputs, open the run in Foundry.</p>
      {steps.length === 0 ? <Notice kind="empty">No steps were recorded for this run.</Notice> : (
        <table>
          <thead>
            <tr>
              <th scope="col">#</th><th scope="col">Step</th><th scope="col">Source name</th><th scope="col">Type</th>
              <th scope="col">Tool</th><th scope="col">Duration</th><th scope="col">Status</th><th scope="col">Repetition</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => {
              const nth = (seen.get(s.normalized_name) ?? 0) + 1;
              seen.set(s.normalized_name, nth);
              const total = totals.get(s.normalized_name)!;
              return (
                <tr key={s.step_id}>
                  <td>{s.ordinal ?? '—'}</td>
                  <th scope="row">{s.normalized_name}</th>
                  <td className="muted">{s.source_name === s.normalized_name ? '(same)' : s.source_name || '(missing)'}</td>
                  <td>{s.step_type.replace('_', ' ')}</td>
                  <td>{s.tool_name ?? '—'}</td>
                  <td>{fmtDuration(s.duration_ms)}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td>{total > 1 ? <span className="repeat">↻ {nth} of {total}</span> : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
