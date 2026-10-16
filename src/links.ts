// Foundry / source link validation and construction.
// Links are only built from templates the implementer configured; no URL pattern is assumed.

export const AGENT_PLACEHOLDERS = ['agent_id'];
export const RUN_PLACEHOLDERS = ['agent_id', 'run_id'];
export const INDEX_PLACEHOLDERS = ['index_id']; // Foundry vector store (knowledge index)

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Returns an error message, or null when the template is empty or valid. */
export function validateUrlTemplate(template: string, allowed: string[]): string | null {
  if (!template) return null;
  const used = [...template.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]);
  const unknown = used.filter((name) => !allowed.includes(name));
  if (unknown.length) {
    return `Unknown placeholder ${unknown.map((n) => `{${n}}`).join(', ')}. Allowed: ${allowed.map((n) => `{${n}}`).join(', ')}.`;
  }
  const sample = fillTemplate(template, Object.fromEntries(allowed.map((n) => [n, 'example'])));
  return isHttpsUrl(sample) ? null : 'Must be an https:// URL.';
}

/** Substitutes {placeholders} with URL-encoded values. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(values[name] ?? ''));
}

/** A configured, valid template wins; otherwise a validated source-provided URL; otherwise null. */
export function buildLink(
  template: string,
  allowed: string[],
  values: Record<string, string>,
  sourceUrl: string | null,
): string | null {
  if (template && validateUrlTemplate(template, allowed) === null) return fillTemplate(template, values);
  return sourceUrl;
}

/**
 * Derives this deployment's Foundry portal link patterns from one real portal link. An agent link
 * (…/build/agents/<name>/build) yields both the agent and the knowledge-index patterns, since they
 * share the subscription/resource-group/project/tenant prefix; an index link yields just the index.
 */
export function portalTemplates(url: string): { agent: string; index: string } | null {
  const u = url.trim();
  if (!isHttpsUrl(u)) return null;
  const agent = u.match(/^(.*)\/build\/agents\/[^/?#]+\/build(\?[^#]*)?$/);
  if (agent) {
    const base = agent[1];
    const query = agent[2] ?? '';
    return { agent: `${base}/build/agents/{agent_id}/build${query}`, index: `${base}/build/knowledge/indexes/project-vectorstore/{index_id}${query}` };
  }
  const index = u.match(/^(.*\/knowledge\/indexes\/[^/]+)\/[^/?#]+(\?[^#]*)?$/);
  if (index) return { agent: '', index: `${index[1]}/{index_id}${index[2] ?? ''}` };
  return null;
}
