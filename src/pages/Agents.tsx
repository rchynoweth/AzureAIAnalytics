import { useState } from 'react';
import { runsIn, summarize, timeBuckets } from '../analytics/metrics';
import { fmtDate, fmtNum, fmtPct } from '../format';
import { ExternalLink, MiniBars, PageHeader, Tags, agentFoundryUrl, href } from '../ui';
import { forAgent, type View } from '../view';

type SortKey = 'name' | 'last' | 'runs' | 'steps' | 'duration';
const SORTS: Record<SortKey, string> = {
  name: 'Name (A–Z)',
  last: 'Last observed run (newest first)',
  runs: 'Runs analyzed (most first)',
  steps: 'Median steps (most first)',
  duration: 'Median duration (longest first)',
};

export function Agents({ view }: { view: View }) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState<SortKey>('name'); // alphabetical by default: no implied ranking
  const [runQuery, setRunQuery] = useState('');
  const [runMessage, setRunMessage] = useState<string | null>(null);

  /** Opens the run summary for a pasted run ID (exact match, or a unique prefix). */
  const findRun = (event: React.FormEvent) => {
    event.preventDefault();
    const q = runQuery.trim();
    const matches = view.dataset.runs.filter((r) => r.run_id === q || r.run_id.startsWith(q));
    const run = matches.find((r) => r.run_id === q) ?? (matches.length === 1 ? matches[0] : undefined);
    if (run) location.hash = href('agents', run.agent_id, 'runs', run.run_id);
    else setRunMessage(matches.length > 1 ? `${matches.length} runs start with that ID — paste more of it.` : 'No run with that ID in the loaded data.');
  };
  const { agents } = view.dataset;
  const allTags = [...new Set([...agents.values()].flatMap((a) => a.tags))].sort();

  const { grain, buckets } = timeBuckets(view.period);
  const rows = [...agents.values()]
    .filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()) && (!tag || a.tags.includes(tag)))
    .map((agent) => {
      const agentRuns = forAgent(view, agent.agent_id).runs;
      return { agent, s: summarize(agentRuns, view.dataset.stepsByRun), counts: buckets.map((b) => runsIn(agentRuns, b).length) };
    });
  // Numeric sorts are descending; ties (and "name") fall back to name order.
  const sortValue: Record<SortKey, (r: (typeof rows)[number]) => number> = {
    name: () => 0,
    last: (r) => r.agent.last_observed_at ?? -Infinity,
    runs: (r) => r.s.runCount,
    steps: (r) => r.s.medianSteps ?? -Infinity,
    duration: (r) => r.s.medianDuration ?? -Infinity,
  };
  rows.sort((a, b) => sortValue[sort](b) - sortValue[sort](a) || a.agent.name.localeCompare(b.agent.name));

  return (
    <>
      <PageHeader title="Agents" subtitle={<>Each agent's observable behavior in {view.windowLabel}. Sorting helps you find agents; it is not a ranking of quality.</>} />
      <div className="filters" role="search">
        <label>Search by name <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        {allTags.length > 0 && (
          <label>Tag
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">All tags</option>
              {allTags.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
        )}
        <label>Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {Object.entries(SORTS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <form className="find-run" onSubmit={findRun}>
          <label>Find a run by ID
            <span className="inline-form">
              <input value={runQuery} onChange={(e) => { setRunQuery(e.target.value); setRunMessage(null); }} placeholder="resp_… or run ID" />
              <button type="submit" disabled={!runQuery.trim()}>Open</button>
            </span>
          </label>
          {runMessage && <span className="field-error" role="status">{runMessage}</span>}
        </form>
      </div>

      {rows.length === 0 ? (
        <p className="notice notice-empty" role="status">No agents match these filters.</p>
      ) : (
        <div className="agent-grid">
          {rows.map(({ agent, s, counts }) => (
            <div className="agent-card" key={agent.agent_id}>
              <div className="agent-card-head">
                <a href={href('agents', agent.agent_id)}><strong>{agent.name}</strong></a>
                <Tags tags={agent.tags} />
              </div>
              {agent.description && <p className="agent-desc muted">{agent.description}</p>}
              <MiniBars values={counts} label={`${agent.name}: runs per ${grain}`} />
              <span className="meta">Runs per {grain} · last run {fmtDate(agent.last_observed_at)}</span>
              <dl className="agent-stats">
                <div><dt>Runs</dt><dd>{fmtNum(s.runCount)}</dd></div>
                <div><dt>Median steps</dt><dd>{fmtNum(s.medianSteps, 1)}</dd></div>
                <div><dt>Success</dt><dd>{fmtPct(s.successRate)}</dd></div>
                <div><dt>95th steps</dt><dd>{s.p95Steps == null ? <span className="muted">—</span> : fmtNum(s.p95Steps, 1)}</dd></div>
              </dl>
              <div className="agent-card-foot">
                <a href={href('agents', agent.agent_id)}>View details →</a>
                <ExternalLink url={agentFoundryUrl(view.settings, agent.agent_id, agent.foundry_url)} label={view.settings.foundryLinkLabel} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
