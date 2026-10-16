// The single normalization boundary. Providers map their payloads into the
// source-neutral Raw* shapes below; everything after this file sees only the model.

import { isHttpsUrl } from '../links';
import type { Agent, DataIssue, Run, Status, Step, StepType } from './model';

export interface RawAgent {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  tags?: string[] | null;
  foundry_url?: string | null;
  created_at?: string | null;
}

export interface RawRun {
  id?: string | null;
  agent_id?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_ms?: number | null; // used only when timestamps cannot provide a duration
  status?: string | null;
  source_url?: string | null;
}

export interface RawStep {
  id?: string | null;
  run_id?: string | null;
  ordinal?: number | null;
  name?: string | null;
  type?: string | null;
  tool?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_ms?: number | null;
  status?: string | null;
}

export interface RawData {
  agents: RawAgent[];
  runs: RawRun[];
  steps: RawStep[];
}

export interface Normalized {
  agents: Map<string, Agent>;
  runs: Run[];
  stepsByRun: Map<string, Step[]>;
  issues: DataIssue[];
}

/** Small, reviewable mapping from cleaned source names to normalized names. */
export const STEP_NAME_ALIASES: Record<string, string> = {
  search_kb: 'search_knowledge_base',
  kb_search: 'search_knowledge_base',
  erp_query: 'erp_lookup',
};

const STATUS_MAP: Record<string, Status> = {
  succeeded: 'succeeded', success: 'succeeded', completed: 'succeeded', complete: 'succeeded', ok: 'succeeded',
  failed: 'failed', failure: 'failed', error: 'failed', errored: 'failed',
  in_progress: 'in_progress', running: 'in_progress', queued: 'in_progress', pending: 'in_progress',
};

const STEP_TYPE_MAP: Record<string, StepType> = {
  tool: 'tool_call', tool_call: 'tool_call', function: 'tool_call', function_call: 'tool_call',
  llm: 'model_call', model: 'model_call', model_call: 'model_call', completion: 'model_call',
};

export const UNNAMED_STEP = 'unnamed_step';

/** Deterministic: trims prefixes like "Tool:", splits camelCase, snake_cases, then applies aliases. */
export function normalizeStepName(sourceName: string): string {
  const cleaned = sourceName
    .trim()
    .replace(/^(tool|function)\s*[:.]\s*/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned) return UNNAMED_STEP;
  return STEP_NAME_ALIASES[cleaned] ?? cleaned;
}

/** ISO 8601 → epoch ms. A timestamp without an offset is treated as UTC. */
export function parseTimestamp(value: string | null | undefined): number | null | 'invalid' {
  if (value == null || value === '') return null;
  const withZone = /([zZ]|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`;
  const ms = Date.parse(withZone);
  return Number.isNaN(ms) ? 'invalid' : ms;
}

const iso = (ms: number) => new Date(ms).toISOString();

export function normalize(raw: RawData, sourceName: string): Normalized {
  const issues: DataIssue[] = [];
  const issue = (code: string, entity: DataIssue['entity'], entity_id: string, detail: string) =>
    issues.push({ code, entity, entity_id, detail });

  const time = (value: string | null | undefined, entity: DataIssue['entity'], id: string) => {
    const t = parseTimestamp(value);
    if (t === 'invalid') {
      issue('invalid_timestamp', entity, id, 'Timestamp could not be parsed; treated as missing.');
      return null;
    }
    return t;
  };

  const status = (value: string | null | undefined, entity: DataIssue['entity'], id: string): Status => {
    if (value == null || value === '') {
      issue('missing_status', entity, id, 'No status reported; counted as unknown.');
      return 'unknown';
    }
    const mapped = STATUS_MAP[value.trim().toLowerCase().replace(/[\s-]+/g, '_')];
    if (!mapped) issue('unknown_status', entity, id, `Unrecognized status "${value.slice(0, 40)}"; counted as unknown.`);
    return mapped ?? 'unknown';
  };

  const duration = (
    start: number | null, end: number | null, rawMs: number | null | undefined,
    entity: DataIssue['entity'], id: string,
  ): number | null => {
    if (start != null && end != null) {
      if (end < start) {
        issue('invalid_timestamp_order', entity, id, 'Ends before it starts; duration excluded.');
        return null;
      }
      return end - start;
    }
    if (rawMs != null) {
      if (rawMs < 0) {
        issue('negative_duration', entity, id, 'Negative duration; excluded.');
        return null;
      }
      return rawMs;
    }
    return null;
  };

  // Agents: first occurrence of each id wins.
  const agents = new Map<string, Agent>();
  for (const a of raw.agents) {
    if (!a.id) {
      issue('missing_agent_id', 'agent', '(none)', 'Agent without an id was excluded.');
      continue;
    }
    if (agents.has(a.id)) {
      issue('duplicate_agent', 'agent', a.id, 'Duplicate agent id; first record kept.');
      continue;
    }
    let foundry_url = a.foundry_url ?? null;
    if (foundry_url && !isHttpsUrl(foundry_url)) {
      issue('invalid_foundry_link', 'agent', a.id, 'Foundry link is not a valid https URL; link hidden.');
      foundry_url = null;
    }
    agents.set(a.id, {
      agent_id: a.id,
      name: a.name?.trim() || a.id,
      description: a.description?.trim() ?? '',
      foundry_url,
      tags: (a.tags ?? []).filter(Boolean),
      source_name: sourceName,
      created_at: time(a.created_at, 'agent', a.id),
      last_observed_at: null,
    });
  }

  // Runs: stable id, or the documented fallback key agent_id + started_at.
  const runs = new Map<string, Run>();
  for (const r of raw.runs) {
    const agentId = r.agent_id ?? '';
    const started = time(r.started_at, 'run', r.id ?? agentId);
    const runId = r.id || (agentId && started != null ? `fallback|${agentId}|${iso(started)}` : '');
    if (!runId) {
      issue('missing_run_id', 'run', '(none)', 'Run without an id or start time could not be keyed; excluded.');
      continue;
    }
    if (runs.has(runId)) {
      issue('duplicate_run', 'run', runId, 'Duplicate run; first record kept.');
      continue;
    }
    if (!agents.has(agentId)) {
      issue('missing_agent', 'run', runId, 'Run refers to an agent that was not loaded; excluded.');
      continue;
    }
    const ended = time(r.ended_at, 'run', runId);
    const runStatus = status(r.status, 'run', runId);
    let source_url = r.source_url ?? null;
    if (source_url && !isHttpsUrl(source_url)) {
      issue('invalid_source_link', 'run', runId, 'Run link is not a valid https URL; link hidden.');
      source_url = null;
    }
    runs.set(runId, {
      run_id: runId,
      agent_id: agentId,
      started_at: started,
      ended_at: ended,
      duration_ms: duration(started, ended, r.duration_ms, 'run', runId),
      status: runStatus,
      step_count: 0, // set from normalized steps below
      source_url,
      source_name: sourceName,
    });
  }

  // Steps: stable id, or the documented fallback key run_id + (ordinal or started_at) + source name.
  const steps = new Map<string, Step>();
  for (const s of raw.steps) {
    const runId = s.run_id ?? '';
    const sourceStepName = s.name?.trim() ?? '';
    const started = time(s.started_at, 'step', s.id ?? runId);
    const position = s.ordinal ?? (started != null ? iso(started) : null);
    const stepId = s.id || (runId && position != null ? `fallback|${runId}|${position}|${sourceStepName}` : '');
    if (!stepId) {
      issue('missing_step_id', 'step', '(none)', 'Step without an id, ordinal, or start time could not be keyed; excluded.');
      continue;
    }
    if (steps.has(stepId)) {
      issue('duplicate_step', 'step', stepId, 'Duplicate step; first record kept.');
      continue;
    }
    if (!runs.has(runId)) {
      issue('missing_run', 'step', stepId, 'Step refers to a run that was not loaded or was excluded; excluded.');
      continue;
    }
    if (!sourceStepName) issue('missing_step_name', 'step', stepId, `Step has no name; shown as "${UNNAMED_STEP}".`);
    const ended = time(s.ended_at, 'step', stepId);
    const type = STEP_TYPE_MAP[(s.type ?? '').trim().toLowerCase()] ?? 'other';
    steps.set(stepId, {
      step_id: stepId,
      run_id: runId,
      ordinal: s.ordinal ?? null,
      source_name: sourceStepName,
      normalized_name: normalizeStepName(sourceStepName),
      step_type: type,
      tool_name: s.tool?.trim() || null,
      started_at: started,
      ended_at: ended,
      duration_ms: duration(started, ended, s.duration_ms, 'step', stepId),
      status: status(s.status, 'step', stepId),
    });
  }

  // Group and order steps; derive step_count from them (the only step-count calculation).
  const stepsByRun = new Map<string, Step[]>();
  for (const step of steps.values()) {
    const list = stepsByRun.get(step.run_id) ?? [];
    list.push(step);
    stepsByRun.set(step.run_id, list);
  }
  for (const [runId, list] of stepsByRun) {
    list.sort(compareSteps);
    const ordinals = list.map((s) => s.ordinal).filter((o) => o != null);
    if (new Set(ordinals).size !== ordinals.length) {
      issue('duplicate_ordinal', 'run', runId, 'Two or more steps share an ordinal; ordered by start time, then id.');
    }
  }

  const runList = [...runs.values()].map((run) => ({ ...run, step_count: stepsByRun.get(run.run_id)?.length ?? 0 }));
  for (const run of runList) {
    const agent = agents.get(run.agent_id)!;
    if (run.started_at != null && (agent.last_observed_at == null || run.started_at > agent.last_observed_at)) {
      agent.last_observed_at = run.started_at;
    }
  }

  return { agents, runs: runList, stepsByRun, issues };
}

function compareSteps(a: Step, b: Step): number {
  const byOrdinal = (a.ordinal ?? Infinity) - (b.ordinal ?? Infinity);
  if (byOrdinal) return byOrdinal;
  const byStart = (a.started_at ?? Infinity) - (b.started_at ?? Infinity);
  if (byStart) return byStart;
  return a.step_id < b.step_id ? -1 : a.step_id > b.step_id ? 1 : 0;
}
