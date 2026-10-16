// Renders every page from the real synthetic dataset to catch broken pages and
// check required content, without a browser.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { loadSynthetic } from '../data/synthetic';
import { defaultSettings } from '../settings';
import { makeView } from '../view';
import { AgentDetail } from './AgentDetail';
import { Agents } from './Agents';
import { Analytics } from './Analytics';
import { Knowledge, Markdown } from './Knowledge';
import { RunSummary } from './RunSummary';
import { Settings } from './Settings';

const dataset = loadSynthetic(Date.parse('2026-10-14T12:00:00Z'));
const settings = { ...defaultSettings({}), foundryAgentUrlTemplate: 'https://foundry.example.com/agents/{agent_id}' };
const view = makeView(dataset, settings, '30d');
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('pages render from synthetic data', () => {
  it('Analytics shows the KPI strip and the view picker on every sub-view', () => {
    const out = html(<Analytics view={view} subView="summary" />);
    for (const text of ['Analytics', 'Agents', 'Median steps per run', 'Median run duration', 'Successful run rate', 'Last 30 days', 'Portfolio over time', 'Highlights', 'Most complex run', 'Investigation candidates', 'Complexity &amp; outliers']) {
      expect(out, text).toContain(text);
    }
    expect(out).not.toMatch(/Could not calculate/);
  });

  it('Analytics sub-views each render their required sections', () => {
    const sections: Record<string, string[]> = {
      complexity: ['Recommended to review', 'Investigation candidates', 'behaved unusually for their own agent', 'Runs by complexity and duration', 'Run complexity (steps per run)', 'Most complex runs', 'Agents by typical complexity'],
      steps: ['Most used steps and tools', 'Which agents use which steps', 'Repeated steps', 'Common execution paths', 'Steps and tools in failed runs'],
      trends: ['Behavior over time', 'Where run time accumulates'],
      quality: ['Data quality'],
    };
    for (const [subView, texts] of Object.entries(sections)) {
      const out = html(<Analytics view={view} subView={subView as 'complexity'} />);
      for (const text of texts) expect(out, `${subView}: ${text}`).toContain(text);
    }
  });

  it('the agent step table explains when the source reports no step durations (Foundry)', () => {
    const untimed = new Map([...dataset.stepsByRun].map(([id, steps]) => [id, steps.map((s) => ({ ...s, duration_ms: null }))]));
    const out = html(<AgentDetail view={makeView({ ...dataset, stepsByRun: untimed }, settings, '30d')} agentId="agt-support-triage" />);
    expect(out).toContain('this source reports no per-step timing');
  });

  it('Analytics shows an empty state when the window has no runs', () => {
    const empty = makeView({ ...dataset, runs: [] }, settings, '7d');
    expect(html(<Analytics view={empty} subView="complexity" />)).toContain('No runs started in Last 7 days');
  });

  it('Agents lists every agent with a configured Foundry link and no ranking language', () => {
    const out = html(<Agents view={view} />);
    for (const a of dataset.agents.values()) expect(out).toContain(a.name.replace('&', '&amp;'));
    expect(out).toContain('https://foundry.example.com/agents/agt-research');
    expect(out).not.toMatch(/\b(best|worst|rank(ed|ing)?|leaderboard)\b(?! of quality)/i);
  });

  it('Agent detail shows the profile, step table, sequences, and suppresses small-sample percentiles', () => {
    const out = html(<AgentDetail view={view} agentId="agt-support-triage" />);
    for (const text of ['Behavior profile', '95th pct. steps', 'Run complexity (steps per run)', 'Run duration distribution', 'Steps and tools', 'Common execution paths', 'Two-step', 'Three-step', 'Recent runs', 'Tool: search_kb']) {
      expect(out, text).toContain(text);
    }
    expect(out).toContain('https://foundry.example.com/agents/agt-support-triage'); // Open in Foundry action
    const small = html(<AgentDetail view={view} agentId="agt-policy-qa" />);
    expect(small).toContain('needs 20+');
  });

  it('Run summary lists ordered steps with repetition indicators', () => {
    const repeated = dataset.runs.find((r) => {
      const names = (dataset.stepsByRun.get(r.run_id) ?? []).map((s) => s.normalized_name);
      return new Set(names).size < names.length;
    })!;
    const out = html(<RunSummary view={view} agentId={repeated.agent_id} runId={repeated.run_id} />);
    expect(out).toContain('Ordered steps');
    expect(out).toContain('↻ 2 of');
  });

  it('Knowledge explains that it needs Fabric sign-in when signed out', () => {
    expect(html(<Knowledge client={null} />)).toContain('needs Fabric sign-in');
  });

  it('Settings renders every section; Live and agent editing need sign-in', () => {
    const out = html(<Settings settings={settings} onSaved={() => {}} onSynced={() => {}} record={() => {}} auth={{ kind: 'local-preview' }} onFoundryLinksChanged={() => {}} />);
    for (const text of ['Your account', 'Shared with everyone', 'This browser', 'Data mode', 'Live connection']) {
      expect(out, text).toContain(text);
    }
    expect(out).toContain('Live mode needs Fabric sign-in');
  });
});

describe('answer formatting', () => {
  it('renders lists and bold safely, without Foundry citation markers', () => {
    const out = html(<Markdown text={'### Key points\n1. **Kickoff**: 30 minutes【4:0†source】\n   - with the sponsor\n2. Reports <script>x</script> on Friday'} />);
    expect(out).toContain('<p class="md-heading">Key points</p>');
    expect(out).toContain('<span class="md-marker">1.</span><span><strong>Kickoff</strong>: 30 minutes</span>');
    expect(out).toContain('class="md-item nested"');
    expect(out).not.toContain('【');
    expect(out).toContain('&lt;script&gt;'); // escaped, never injected
  });
});
