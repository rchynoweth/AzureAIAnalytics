import { describe, expect, it } from 'vitest';
import { summarize } from '../analytics/metrics';
import { loadSynthetic } from './synthetic';

const NOW = Date.parse('2026-10-14T12:00:00Z');

describe('synthetic provider', () => {
  const d = loadSynthetic(NOW);

  it('is labeled synthetic and aligned so the newest run starts now', () => {
    expect(d.mode).toBe('synthetic');
    expect(d.source_label).toBe('Synthetic sample data');
    expect(Math.max(...d.runs.map((r) => r.started_at ?? 0))).toBe(NOW);
  });

  it('contains the variation the product needs to demonstrate', () => {
    expect(d.agents.size).toBe(5);
    const s = summarize(d.runs, d.stepsByRun);
    expect(s.succeeded).toBeGreaterThan(0);
    expect(s.failed).toBeGreaterThan(0);
    expect(s.unknown).toBeGreaterThan(0);
    expect(s.inProgress).toBeGreaterThan(0);
    expect(s.runsWithRepeat).toBeGreaterThan(0);
    expect(d.runs.filter((r) => r.agent_id === 'agt-policy-qa').length).toBeLessThan(20); // small-sample agent
  });

  it('exercises every data-quality check', () => {
    const codes = new Set(d.issues.map((i) => i.code));
    for (const code of [
      'duplicate_agent', 'duplicate_run', 'duplicate_step', 'missing_agent', 'missing_run', 'missing_step_name',
      'duplicate_ordinal', 'invalid_timestamp_order', 'negative_duration', 'missing_status', 'unknown_status', 'invalid_foundry_link',
    ]) {
      expect(codes, code).toContain(code);
    }
  });

  it('keeps raw source names traceable after normalization', () => {
    const kb = [...d.stepsByRun.values()].flat().filter((s) => s.normalized_name === 'search_knowledge_base');
    expect(new Set(kb.map((s) => s.source_name))).toEqual(new Set(['Tool: search_kb', 'SearchKB', 'search-kb']));
  });

  it('every run step_count equals its normalized steps', () => {
    for (const r of d.runs) expect(r.step_count).toBe(d.stepsByRun.get(r.run_id)?.length ?? 0);
  });
});
