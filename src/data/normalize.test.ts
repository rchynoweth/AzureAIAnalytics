import { describe, expect, it } from 'vitest';
import { normalize, normalizeStepName, parseTimestamp, type RawData } from './normalize';

const T0 = '2026-01-01T00:00:00Z';
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();
const codes = (raw: RawData) => normalize(raw, 'test').issues.map((i) => i.code);
const agent = { id: 'a1', name: 'Agent One' };

describe('normalizeStepName', () => {
  it('is deterministic and maps source variants to one name', () => {
    expect(normalizeStepName('Tool: search_kb')).toBe('search_knowledge_base');
    expect(normalizeStepName('SearchKB')).toBe('search_knowledge_base');
    expect(normalizeStepName('search-kb')).toBe('search_knowledge_base');
    expect(normalizeStepName('ERP Query')).toBe('erp_lookup');
    expect(normalizeStepName('ClassifyIntent')).toBe('classify_intent');
    expect(normalizeStepName('   ')).toBe('unnamed_step');
  });
});

describe('parseTimestamp', () => {
  it('treats timestamps without an offset as UTC and flags garbage', () => {
    expect(parseTimestamp('2026-01-01T00:00:00')).toBe(Date.parse(T0));
    expect(parseTimestamp('not a date')).toBe('invalid');
    expect(parseTimestamp(null)).toBeNull();
  });
});

describe('normalize', () => {
  it('derives step_count from steps and preserves raw source names', () => {
    const { runs, stepsByRun } = normalize(
      {
        agents: [agent],
        runs: [{ id: 'r1', agent_id: 'a1', started_at: at(0), ended_at: at(10), status: 'Completed' }],
        steps: [
          { id: 's2', run_id: 'r1', ordinal: 2, name: 'SearchKB', type: 'tool', tool: 'search_kb', started_at: at(2), ended_at: at(3), status: 'ok' },
          { id: 's1', run_id: 'r1', ordinal: 1, name: 'Plan', type: 'llm', started_at: at(0), ended_at: at(2), status: 'ok' },
        ],
      },
      'test',
    );
    expect(runs[0]).toMatchObject({ step_count: 2, status: 'succeeded', duration_ms: 10_000 });
    const steps = stepsByRun.get('r1')!;
    expect(steps.map((s) => s.step_id)).toEqual(['s1', 's2']); // ordered by ordinal
    expect(steps[1]).toMatchObject({ source_name: 'SearchKB', normalized_name: 'search_knowledge_base', step_type: 'tool_call', duration_ms: 1000 });
  });

  it('keeps the first of duplicate agents, runs, and steps', () => {
    const run = { id: 'r1', agent_id: 'a1', started_at: at(0), ended_at: at(1), status: 'failed' };
    const step = { id: 's1', run_id: 'r1', ordinal: 1, name: 'x', status: 'ok' };
    const raw = { agents: [agent, { ...agent, name: 'Dup' }], runs: [run, { ...run }], steps: [step, { ...step, name: 'y' }] };
    const result = normalize(raw, 'test');
    expect(result.agents.get('a1')!.name).toBe('Agent One');
    expect(result.runs).toHaveLength(1);
    expect(result.stepsByRun.get('r1')!.map((s) => s.normalized_name)).toEqual(['x']);
    expect(codes(raw)).toEqual(['duplicate_agent', 'duplicate_run', 'duplicate_step']);
  });

  it('excludes runs with a missing agent and steps with a missing run', () => {
    const raw = {
      agents: [agent],
      runs: [{ id: 'r9', agent_id: 'ghost', started_at: at(0), status: 'ok' }],
      steps: [{ id: 's9', run_id: 'r9', ordinal: 1, name: 'x', status: 'ok' }],
    };
    const result = normalize(raw, 'test');
    expect(result.runs).toHaveLength(0);
    expect(result.stepsByRun.size).toBe(0);
    expect(codes(raw)).toEqual(['missing_agent', 'missing_run']);
  });

  it('excludes invalid durations and records why', () => {
    const raw = {
      agents: [agent],
      runs: [{ id: 'r1', agent_id: 'a1', started_at: at(10), ended_at: at(5), status: 'ok' }],
      steps: [{ id: 's1', run_id: 'r1', ordinal: 1, name: 'x', duration_ms: -5, status: 'ok' }],
    };
    const result = normalize(raw, 'test');
    expect(result.runs[0].duration_ms).toBeNull();
    expect(result.stepsByRun.get('r1')![0].duration_ms).toBeNull();
    expect(codes(raw)).toEqual(['invalid_timestamp_order', 'negative_duration']);
  });

  it('counts missing and unrecognized statuses as unknown, never as failed', () => {
    const raw = {
      agents: [agent],
      runs: [
        { id: 'r1', agent_id: 'a1', started_at: at(0), status: null },
        { id: 'r2', agent_id: 'a1', started_at: at(1), status: 'paused' },
        { id: 'r3', agent_id: 'a1', started_at: at(2), status: 'Running' },
      ],
      steps: [],
    };
    expect(normalize(raw, 'test').runs.map((r) => r.status)).toEqual(['unknown', 'unknown', 'in_progress']);
    expect(codes(raw)).toEqual(['missing_status', 'unknown_status']);
  });

  it('uses the documented fallback keys when source ids are missing', () => {
    const run = { id: null, agent_id: 'a1', started_at: at(0), ended_at: at(4), status: 'ok' };
    const runId = `fallback|a1|${at(0)}`;
    const raw = {
      agents: [agent],
      runs: [run, { ...run }], // the same run delivered twice
      steps: [{ id: null, run_id: runId, ordinal: 1, name: 'Plan', status: 'ok' }],
    };
    const result = normalize(raw, 'test');
    expect(result.runs.map((r) => r.run_id)).toEqual([runId]);
    expect(result.stepsByRun.get(runId)![0].step_id).toBe(`fallback|${runId}|1|Plan`);
    expect(codes(raw)).toEqual(['duplicate_run']);
  });

  it('flags duplicate ordinals, missing step names, and unsafe links', () => {
    const raw = {
      agents: [{ ...agent, foundry_url: 'javascript:alert(1)' }],
      runs: [{ id: 'r1', agent_id: 'a1', started_at: at(0), status: 'ok', source_url: 'http://insecure.example' }],
      steps: [
        { id: 's1', run_id: 'r1', ordinal: 1, name: 'a', status: 'ok' },
        { id: 's2', run_id: 'r1', ordinal: 1, name: '', status: 'ok' },
      ],
    };
    const result = normalize(raw, 'test');
    expect(result.agents.get('a1')!.foundry_url).toBeNull();
    expect(result.runs[0].source_url).toBeNull();
    expect(result.stepsByRun.get('r1')!.map((s) => s.normalized_name)).toEqual(['a', 'unnamed_step']);
    expect(codes(raw).sort()).toEqual(['duplicate_ordinal', 'invalid_foundry_link', 'invalid_source_link', 'missing_step_name']);
  });

  it('sets last_observed_at from the latest run start', () => {
    const raw = {
      agents: [agent],
      runs: [
        { id: 'r1', agent_id: 'a1', started_at: at(5), status: 'ok' },
        { id: 'r2', agent_id: 'a1', started_at: at(50), status: 'ok' },
      ],
      steps: [],
    };
    expect(normalize(raw, 'test').agents.get('a1')!.last_observed_at).toBe(Date.parse(at(50)));
  });
});
