// App settings: build-time defaults from VITE_* environment values, optionally
// overridden in the Settings page. Overrides are saved in this browser only.
// No setting is secret; never put secrets in VITE_* values (they ship to the browser).

import type { DataMode } from './data/model';
import { AGENT_PLACEHOLDERS, INDEX_PLACEHOLDERS, RUN_PLACEHOLDERS, validateUrlTemplate } from './links';

export interface Settings {
  dataMode: DataMode;
  foundryAgentUrlTemplate: string; // placeholders: {agent_id}
  foundryRunUrlTemplate: string; // placeholders: {agent_id}, {run_id}
  foundryIndexUrlTemplate: string; // placeholder: {index_id} (knowledge vector store)
  foundryLinkLabel: string;
}

export interface ConfigIssue {
  field: keyof Settings;
  severity: 'error' | 'info';
  message: string;
  feature: string; // the feature affected
}

const STORAGE_KEY = 'abi.settings.v1';

export function defaultSettings(env: Record<string, string | undefined> = import.meta.env): Settings {
  return {
    dataMode: env.VITE_DATA_MODE === 'live' ? 'live' : 'synthetic',
    foundryAgentUrlTemplate: env.VITE_FOUNDRY_AGENT_URL_TEMPLATE ?? '',
    foundryRunUrlTemplate: env.VITE_FOUNDRY_RUN_URL_TEMPLATE ?? '',
    foundryIndexUrlTemplate: env.VITE_FOUNDRY_INDEX_URL_TEMPLATE ?? '',
    foundryLinkLabel: env.VITE_FOUNDRY_LINK_LABEL || 'Open in Foundry',
  };
}

export function loadSettings(): Settings {
  const defaults = defaultSettings();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>;
    const merged = { ...defaults, ...pickKnown(saved) };
    // Ignore saved overrides that no longer validate (for example after an upgrade).
    return validateSettings(merged).some((i) => i.severity === 'error') ? defaults : merged;
  } catch {
    return defaults; // storage blocked or unreadable
  }
}

/** Saves only valid settings. Returns the issues that blocked saving, if any. */
export function saveSettings(settings: Settings): ConfigIssue[] {
  const errors = validateSettings(settings).filter((i) => i.severity === 'error');
  if (errors.length) return errors;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    return [{ field: 'dataMode', severity: 'error', message: 'This browser blocked saving settings.', feature: 'Settings' }];
  }
  return [];
}

export function resetSettings(): Settings {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing saved, or storage blocked
  }
  return defaultSettings();
}

export function validateSettings(s: Settings): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const foundry = 'Open in Foundry links';

  const agentError = validateUrlTemplate(s.foundryAgentUrlTemplate, AGENT_PLACEHOLDERS);
  if (agentError) issues.push({ field: 'foundryAgentUrlTemplate', severity: 'error', feature: foundry, message: agentError });
  const runError = validateUrlTemplate(s.foundryRunUrlTemplate, RUN_PLACEHOLDERS);
  if (runError) issues.push({ field: 'foundryRunUrlTemplate', severity: 'error', feature: foundry, message: runError });
  const indexError = validateUrlTemplate(s.foundryIndexUrlTemplate, INDEX_PLACEHOLDERS);
  if (indexError) issues.push({ field: 'foundryIndexUrlTemplate', severity: 'error', feature: foundry, message: indexError });
  if (!s.foundryLinkLabel.trim() || s.foundryLinkLabel.length > 40) {
    issues.push({ field: 'foundryLinkLabel', severity: 'error', feature: foundry, message: 'Enter a label of 1–40 characters.' });
  }
  if (!s.foundryAgentUrlTemplate && !s.foundryRunUrlTemplate) {
    issues.push({ field: 'foundryAgentUrlTemplate', severity: 'info', feature: foundry, message: 'No Foundry link templates configured; Open in Foundry actions are hidden unless the source provides a valid link.' });
  }
  return issues;
}

function pickKnown(saved: Partial<Settings>): Partial<Settings> {
  const keys: (keyof Settings)[] = ['dataMode', 'foundryAgentUrlTemplate', 'foundryRunUrlTemplate', 'foundryIndexUrlTemplate', 'foundryLinkLabel'];
  return Object.fromEntries(keys.filter((k) => typeof saved[k] === 'string').map((k) => [k, saved[k]]));
}
