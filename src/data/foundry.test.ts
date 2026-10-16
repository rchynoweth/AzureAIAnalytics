// Tests for the server-side Foundry mappings, using payload shapes observed from a real
// Foundry project (v1 agents + Responses API, 2026-10-14).

import { describe, expect, it } from 'vitest';
import {
  INSUFFICIENT_EVIDENCE, checkUpload, groundedAnswer, projectBase, toAgentRow, toRunRow, toStepRows,
} from '../../rayfin/functions/src/foundry';
import { normalize } from './normalize';
import { liveRawData } from './live';

const response = {
  id: 'resp_1',
  status: 'completed',
  created_at: 1791485684,
  completed_at: 1791485691,
  agent_reference: { name: 'Account-Research-Analyst', type: 'agent_reference', version: '1' },
  output: [
    { id: 'rfc_1', type: 'remote_function_call', name: 'bing_grounding', status: 'completed' },
    { id: 'rfo_1', type: 'remote_function_call_output', name: 'bing_grounding', status: 'completed' },
    { id: 'rs_1', type: 'reasoning', status: 'completed' },
    { id: 'fs_1', type: 'file_search_call', status: 'completed' },
    { id: 'msg_1', type: 'message', status: 'completed' },
  ],
};

describe('Foundry endpoint guard', () => {
  it('accepts only https Foundry project endpoints', () => {
    expect(projectBase('https://acct.services.ai.azure.com/api/projects/proj/')).toBe('https://acct.services.ai.azure.com/api/projects/proj');
    expect(() => projectBase('https://evil.example.com/api/projects/x')).toThrow();
    expect(() => projectBase('http://acct.services.ai.azure.com/api/projects/x')).toThrow();
    expect(() => projectBase('https://acct.services.ai.azure.com/other')).toThrow();
  });
});

describe('Foundry → database rows', () => {
  it('maps an agent, using metadata as tags', () => {
    const row = toAgentRow({ name: 'A', versions: { latest: { description: 'd', metadata: { team: 'sales' }, created_at: 1791486000 } } });
    expect(row).toEqual({ source_id: 'A', name: 'A', description: 'd', tags: '["team:sales"]', created_at: new Date(1791486000 * 1000) });
  });

  it('maps a response to a run with its duration timestamps', () => {
    expect(toRunRow(response)).toEqual({
      source_id: 'resp_1', agent_source_id: 'Account-Research-Analyst', status: 'completed',
      started_at: new Date(1791485684000), ended_at: new Date(1791485691000),
    });
  });

  it('maps output items to ordered steps, skipping call outputs and reasoning items', () => {
    expect(toStepRows(response).map((s) => [s.ordinal, s.name, s.type, s.tool ?? null])).toEqual([
      [1, 'bing_grounding', 'tool', 'bing_grounding'],
      [2, 'file_search', 'tool', 'file_search'],
      [3, 'message', 'llm', null],
    ]);
  });

  it('round-trips through the database shape into the same normalized model', () => {
    const run = toRunRow(response);
    const steps = toStepRows(response);
    const raw = liveRawData(
      [toAgentRow({ name: 'Account-Research-Analyst', versions: { latest: {} } })],
      [run],
      steps,
    );
    const n = normalize(raw, 'Microsoft Foundry');
    expect(n.runs[0]).toMatchObject({ run_id: 'resp_1', agent_id: 'Account-Research-Analyst', status: 'succeeded', step_count: 3, duration_ms: 7000 });
    expect(n.stepsByRun.get('resp_1')!.map((s) => s.step_type)).toEqual(['tool_call', 'tool_call', 'model_call']);
    expect(n.issues).toEqual([]);
  });
});

describe('knowledge answers', () => {
  const collection = new Set(['file-in']);
  const answer = (annotations: object[], results: object[], text = 'Kickoff is 30 minutes.') => ({
    output: [
      { type: 'file_search_call', results },
      { type: 'message', content: [{ type: 'output_text', text, annotations }] },
    ],
  });

  it('cites the document, section heading, and passage that support the answer', () => {
    const a = groundedAnswer(
      answer([{ type: 'file_citation', file_id: 'file-in', filename: 'playbook.md' }], [{ file_id: 'file-in', filename: 'playbook.md', text: '# Playbook\n## Kickoff\nEvery engagement starts with a 30-minute kickoff.' }]),
      collection,
    );
    expect(a.grounded).toBe(true);
    expect(a.citations).toEqual([{ fileId: 'file-in', document: 'playbook.md', section: 'Kickoff', passage: '## Kickoff\nEvery engagement starts with a 30-minute kickoff.' }]);
  });

  it('reports insufficient evidence when nothing is cited', () => {
    expect(groundedAnswer(answer([], [{ file_id: 'file-in', text: 'x' }], 'Parental leave is 12 weeks.'), collection)).toEqual({
      grounded: false, answer: INSUFFICIENT_EVIDENCE, citations: [],
    });
  });

  it('never cites files outside the selected collection', () => {
    const a = groundedAnswer(answer([{ type: 'file_citation', file_id: 'file-other', filename: 'other.md' }], [{ file_id: 'file-other', text: 'x' }]), collection);
    expect(a.grounded).toBe(false);
  });

  it('treats the model saying "not enough support" as insufficient evidence', () => {
    const a = groundedAnswer(answer([{ type: 'file_citation', file_id: 'file-in' }], [{ file_id: 'file-in', text: 'x' }], INSUFFICIENT_EVIDENCE), collection);
    expect(a.grounded).toBe(false);
  });

  it('validates uploads', () => {
    expect(checkUpload('notes.md', 10)).toBeNull();
    expect(checkUpload('virus.exe', 10)).toMatch(/Unsupported/);
    expect(checkUpload('big.pdf', 5 * 1024 * 1024)).toMatch(/4 MB/);
    expect(checkUpload('../x.md', 10)).toMatch(/Invalid/);
  });
});
