import { describe, expect, it } from 'vitest';
import { allowsLocalPreview } from './auth';
import { buildLink, portalTemplates, validateUrlTemplate } from './links';
import { defaultSettings, saveSettings, validateSettings } from './settings';

const valid = { ...defaultSettings({}), foundryAgentUrlTemplate: 'https://foundry.example.com/agents/{agent_id}' };
const errors = (s: typeof valid) => validateSettings(s).filter((i) => i.severity === 'error').map((i) => i.field);

describe('settings validation', () => {
  it('defaults to Synthetic mode with no Foundry links', () => {
    const d = defaultSettings({});
    expect(d.dataMode).toBe('synthetic');
    expect(validateSettings(d)).toEqual([expect.objectContaining({ severity: 'info', feature: 'Open in Foundry links' })]);
  });
  it('accepts a valid https template', () => {
    expect(errors(valid)).toEqual([]);
  });
  it('accepts live mode (whether it can load depends on sign-in)', () => {
    expect(errors({ ...valid, dataMode: 'live' })).toEqual([]);
  });
  it('rejects non-https URLs, unknown placeholders, and bad labels', () => {
    expect(errors({ ...valid, foundryAgentUrlTemplate: 'javascript:alert({agent_id})' })).toEqual(['foundryAgentUrlTemplate']);
    expect(errors({ ...valid, foundryRunUrlTemplate: 'https://x.example/{trace}' })).toEqual(['foundryRunUrlTemplate']);
    expect(errors({ ...valid, foundryIndexUrlTemplate: 'http://x.example/{index_id}' })).toEqual(['foundryIndexUrlTemplate']);
    expect(errors({ ...valid, foundryLinkLabel: '' })).toEqual(['foundryLinkLabel']);
  });
  it('does not save invalid settings', () => {
    expect(saveSettings({ ...valid, foundryAgentUrlTemplate: 'ftp://nope/{agent_id}' })).toHaveLength(1);
  });
});

describe('links', () => {
  it('URL-encodes placeholder values', () => {
    expect(buildLink('https://f.example/a/{agent_id}', ['agent_id'], { agent_id: 'a b/c' }, null)).toBe('https://f.example/a/a%20b%2Fc');
  });
  it('falls back to a validated source link, otherwise nothing', () => {
    expect(buildLink('', ['agent_id'], { agent_id: 'x' }, 'https://src.example/x')).toBe('https://src.example/x');
    expect(buildLink('', ['agent_id'], { agent_id: 'x' }, null)).toBeNull();
    expect(buildLink('notaurl/{agent_id}', ['agent_id'], { agent_id: 'x' }, null)).toBeNull();
  });
  it('reports which placeholders are allowed', () => {
    expect(validateUrlTemplate('https://f.example/{run}', ['agent_id', 'run_id'])).toMatch(/Unknown placeholder \{run\}/);
  });
});

describe('local preview without sign-in', () => {
  it('is only allowed on the dev server before deployment', () => {
    expect(allowsLocalPreview({ kind: 'not-deployed' }, true)).toBe(true);
    expect(allowsLocalPreview({ kind: 'incomplete', missing: ['apiUrl'] }, true)).toBe(true);
    expect(allowsLocalPreview({ kind: 'ready' }, true)).toBe(false);
    expect(allowsLocalPreview({ kind: 'config-error', message: 'x' }, true)).toBe(false);
    expect(allowsLocalPreview({ kind: 'not-deployed' }, false)).toBe(false); // production build
  });
});

describe('Foundry links build from a configured template', () => {
  it('fills the agent and index templates with live ids', () => {
    const agent = 'https://ai.azure.com/nextgen/r/PFX/build/agents/{agent_id}/build?tid=T';
    expect(buildLink(agent, ['agent_id'], { agent_id: 'Inviso-Engagement-AI-Agent' }, null))
      .toBe('https://ai.azure.com/nextgen/r/PFX/build/agents/Inviso-Engagement-AI-Agent/build?tid=T');
    const index = 'https://ai.azure.com/nextgen/r/PFX/build/knowledge/indexes/project-vectorstore/{index_id}?tid=T';
    expect(buildLink(index, ['index_id'], { index_id: 'vs_abc' }, null))
      .toBe('https://ai.azure.com/nextgen/r/PFX/build/knowledge/indexes/project-vectorstore/vs_abc?tid=T');
  });
});

describe('portalTemplates (derive deployment link patterns from one pasted portal link)', () => {
  it('derives both agent and index patterns from one agent link', () => {
    const link = 'https://ai.azure.com/nextgen/r/AY_lAOSPQNObfFS6zZYH3Q,rg_invisoos,,invisoos-prj-resource,invisoos-prj/build/agents/Inviso-Engagement-AI-Agent/build?tid=ca9ebe88-c751-4d5b-88c8-1471413e3b44';
    expect(portalTemplates(link)).toEqual({
      agent: 'https://ai.azure.com/nextgen/r/AY_lAOSPQNObfFS6zZYH3Q,rg_invisoos,,invisoos-prj-resource,invisoos-prj/build/agents/{agent_id}/build?tid=ca9ebe88-c751-4d5b-88c8-1471413e3b44',
      index: 'https://ai.azure.com/nextgen/r/AY_lAOSPQNObfFS6zZYH3Q,rg_invisoos,,invisoos-prj-resource,invisoos-prj/build/knowledge/indexes/project-vectorstore/{index_id}?tid=ca9ebe88-c751-4d5b-88c8-1471413e3b44',
    });
  });
  it('derives the index pattern from an index link, and rejects unrelated links', () => {
    expect(portalTemplates('https://ai.azure.com/nextgen/r/PFX/build/knowledge/indexes/project-vectorstore/vs_1?tid=T')?.index)
      .toBe('https://ai.azure.com/nextgen/r/PFX/build/knowledge/indexes/project-vectorstore/{index_id}?tid=T');
    expect(portalTemplates('https://ai.azure.com/home')).toBeNull();
    expect(portalTemplates('http://ai.azure.com/build/agents/x/build')).toBeNull();
  });
});
