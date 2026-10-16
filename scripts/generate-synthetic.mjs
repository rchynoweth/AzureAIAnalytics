// Generates the packaged synthetic fixtures in src/data/synthetic/.
// Deterministic (seeded) so the committed JSON can be regenerated and reviewed.
// Run: npm run generate:synthetic
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../src/data/synthetic/', import.meta.url);
const END = Date.parse('2026-10-01T12:00:00Z'); // the provider shifts all times so the latest run is "now"
const DAY = 86_400_000;

let seed = 42; // mulberry32
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const ms = (typical, spread = 0.5) => Math.round(typical * Math.exp((rand() * 2 - 1) * spread));
const step = (name, type, tool, typical, spread) => ({ name, type, tool, ms: ms(typical, spread) });

const agents = [
  { id: 'agt-support-triage', name: 'Support Triage', description: 'Classifies inbound support messages, searches the knowledge base, and drafts a reply.', tags: ['support', 'customer'], created_at: '2026-03-02T09:00:00Z' },
  { id: 'agt-invoice-recon', name: 'Invoice Reconciliation', description: 'Matches supplier invoices to ERP purchase orders and flags exceptions.', tags: ['finance', 'batch'], created_at: '2026-04-15T09:00:00Z' },
  { id: 'agt-research', name: 'Research Assistant', description: 'Plans a research question, searches and reads web sources, and writes a summary report.', tags: ['research'], created_at: '2026-05-20T09:00:00Z' },
  { id: 'agt-policy-qa', name: 'Policy Q&A', description: 'Answers employee questions about HR policy documents. Few runs: demonstrates small-sample suppression.', tags: ['support', 'hr'], created_at: '2026-09-01T09:00:00Z' },
  // Invalid link on purpose: normalization must reject it.
  { id: 'agt-dq-monitor', name: 'Data Quality Monitor', description: 'Daily profile of key tables compared with a baseline; alerts on drift.', tags: ['data', 'scheduled'], foundry_url: 'javascript:alert(1)', created_at: '2026-02-01T09:00:00Z' },
];

const plans = {
  'agt-support-triage': () => {
    const s = [step('receive_message', 'other', null, 300), step('ClassifyIntent', 'llm', null, 1200)];
    const searches = chance(0.18) ? pick([2, 2, 3]) : 1;
    for (let i = 0; i < searches; i++) s.push(step(pick(['Tool: search_kb', 'SearchKB', 'search-kb']), 'tool', 'search_kb', 900));
    if (chance(0.5)) s.push(step('lookup_customer', 'tool', 'crm_lookup', 700));
    s.push(step('draft_response', 'llm', null, 2500));
    if (chance(0.4)) s.push(step('policy_check', 'tool', 'policy_check', 400));
    s.push(step('send_response', 'tool', 'send_email', 300));
    return { steps: s, failP: 0.04 };
  },
  'agt-invoice-recon': () => {
    const s = [step('load_invoice', 'tool', 'blob_read', 600), step('extract_fields', 'llm', null, 3000)];
    const r = rand();
    const lookups = r < 0.55 ? 1 : r < 0.8 ? 2 : r < 0.92 ? 3 : pick([4, 5, 6]);
    for (let i = 0; i < lookups; i++) s.push(step(pick(['erp_lookup', 'ERP Query']), 'tool', 'erp_api', 4000, 0.8));
    s.push(step('match_line_items', 'llm', null, 2500));
    if (chance(0.2)) s.push(step('flag_exception', 'tool', 'ticket_create', 500));
    s.push(step('post_result', 'tool', 'erp_api', 800));
    return { steps: s, failP: lookups >= 3 ? 0.15 : 0.04 };
  },
  'agt-research': (start) => {
    const recent = start > END - 30 * DAY; // behavior change: more search loops in the last 30 days
    const loops = recent ? 2 + Math.floor(rand() * 5) : 1 + Math.floor(rand() * 3);
    const s = [step('plan', 'llm', null, 2000)];
    for (let i = 0; i < loops; i++) {
      s.push(step('web_search', 'tool', 'bing_search', 1500), step('read_page', 'tool', 'http_fetch', 3000, 0.9), step('summarize_source', 'llm', null, 4000));
    }
    s.push(step('write_report', 'llm', null, 9000));
    return { steps: s, failP: 0.06 };
  },
  'agt-policy-qa': () => ({
    steps: [step('receive_question', 'other', null, 200), step('search_policies', 'tool', 'search_kb', 1100), step('answer', 'llm', null, 2600)],
    failP: 0.05,
  }),
  'agt-dq-monitor': () => {
    const s = [];
    for (let i = 0; i < 3; i++) s.push(step('query_table', 'tool', 'sql_query', 5000, 0.4)); // repeats by design
    s.push(step('profile_columns', 'other', null, 2000), step('compare_baseline', 'other', null, 800));
    if (chance(0.1)) s.push(step('send_alert', 'tool', 'teams_post', 600));
    return { steps: s, failP: 0.03 };
  },
};

const runCounts = { 'agt-support-triage': 140, 'agt-invoice-recon': 100, 'agt-research': 110, 'agt-policy-qa': 11 };
const starts = [];
for (const [agentId, n] of Object.entries(runCounts)) {
  for (let i = 0; i < n; i++) starts.push({ agentId, start: Math.round(END - rand() * 90 * DAY) });
}
for (let d = 89; d >= 0; d--) starts.push({ agentId: 'agt-dq-monitor', start: END - d * DAY - 6 * 3_600_000 });
starts.sort((a, b) => a.start - b.start);

const runs = [];
const steps = [];
const iso = (t) => new Date(t).toISOString();
let runSeq = 0;
let stepSeq = 0;

for (const { agentId, start } of starts) {
  const runId = `run-${String(++runSeq).padStart(4, '0')}`;
  const { steps: planned, failP } = plans[agentId](start);
  const failed = chance(failP);
  const used = failed ? planned.slice(0, Math.max(1, Math.ceil(planned.length * (0.4 + rand() * 0.6)))) : planned;
  let t = start + 50;
  used.forEach((s, i) => {
    const last = i === used.length - 1;
    steps.push({
      id: `stp-${String(++stepSeq).padStart(6, '0')}`, run_id: runId, ordinal: i + 1, name: s.name, type: s.type, tool: s.tool,
      started_at: iso(t), ended_at: iso(t + s.ms), status: failed && last ? 'error' : 'completed',
    });
    t += s.ms + Math.round(50 + rand() * 250);
  });
  const status = failed ? pick(['failed', 'error']) : pick(['completed', 'success', 'succeeded']);
  runs.push({ id: runId, agent_id: agentId, started_at: iso(start), ended_at: iso(t + 100), status });
}

// ---- Data-quality edge cases (each must be caught by normalization) ----
const byAgent = (id) => runs.filter((r) => r.agent_id === id);
const stepsOfRun = (id) => steps.filter((s) => s.run_id === id);

// In-progress research runs: newest three, no end time, final steps not yet reported.
for (const r of byAgent('agt-research').filter((r) => stepsOfRun(r.id).length >= 4).slice(-3)) {
  r.status = 'running';
  delete r.ended_at;
  const own = stepsOfRun(r.id);
  for (const s of own.slice(-2)) steps.splice(steps.indexOf(s), 1);
  const lastStep = own.at(-3);
  lastStep.status = 'running';
  delete lastStep.ended_at;
}
// Missing and unrecognized run statuses.
byAgent('agt-dq-monitor').slice(10, 13).forEach((r) => (r.status = null));
byAgent('agt-dq-monitor').slice(20, 22).forEach((r) => (r.status = 'skipped'));
// Run that ends before it starts.
const backwards = byAgent('agt-research')[5];
backwards.ended_at = iso(Date.parse(backwards.started_at) - 60_000);
// Duplicate run and duplicate step records.
runs.push({ ...byAgent('agt-support-triage')[3] });
steps.push({ ...steps[10] });
// Run for an agent that is not in the agent list, with its steps.
runs.push({ id: 'run-orphan', agent_id: 'agt-retired', started_at: iso(END - 2 * DAY), ended_at: iso(END - 2 * DAY + 5000), status: 'completed' });
steps.push({ id: 'stp-orphan-1', run_id: 'run-orphan', ordinal: 1, name: 'legacy_step', type: 'tool', tool: 'legacy', started_at: iso(END - 2 * DAY), ended_at: iso(END - 2 * DAY + 4000), status: 'completed' });
// Step for a run that does not exist.
steps.push({ id: 'stp-no-run', run_id: 'run-missing', ordinal: 1, name: 'lookup_customer', type: 'tool', tool: 'crm_lookup', started_at: iso(END - DAY), ended_at: iso(END - DAY + 500), status: 'completed' });
// Step with no name, and two steps sharing an ordinal.
const supportRun = byAgent('agt-support-triage')[7];
stepsOfRun(supportRun.id)[1].name = '';
const invoiceSteps = stepsOfRun(byAgent('agt-invoice-recon')[4].id);
invoiceSteps[2].ordinal = invoiceSteps[1].ordinal;
// Run without a source id (deduplicated by the fallback key agent_id + started_at), delivered twice.
const fbRun = { id: null, agent_id: 'agt-policy-qa', started_at: iso(END - 3 * DAY), ended_at: iso(END - 3 * DAY + 4200), status: 'completed' };
runs.push(fbRun, { ...fbRun });
// Steps without an id (fallback key run_id + ordinal + name), one with only a negative duration.
const qaRun = byAgent('agt-policy-qa')[0];
steps.push(
  { id: null, run_id: qaRun.id, ordinal: 4, name: 'answer_followup', type: 'llm', tool: null, started_at: qaRun.ended_at, ended_at: qaRun.ended_at, status: 'completed' },
  { id: null, run_id: qaRun.id, ordinal: 5, name: 'log_feedback', type: 'tool', tool: 'feedback_api', duration_ms: -50, status: 'completed' },
);

mkdirSync(OUT, { recursive: true });
const write = (file, rows) => writeFileSync(new URL(file, OUT), `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`);
write('agents.json', [...agents, { ...agents[0], name: 'Support Triage (duplicate record)' }]);
write('runs.json', runs);
write('steps.json', steps);
console.log(`Wrote ${agents.length + 1} agents, ${runs.length} runs, ${steps.length} steps to src/data/synthetic/`);
