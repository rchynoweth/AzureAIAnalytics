// Microsoft Foundry access for the functions: endpoint validation, a small REST helper,
// and pure mappings from Foundry payloads to database rows / knowledge answers.
// Verified against the Foundry v1 API (agents + Responses) on 2026-10-14.

type Json = Record<string, any>;

/** Rows written to the database. They mirror rayfin/data/schema.ts. */
export interface AgentRow { source_id: string; name: string; description?: string; tags?: string; created_at?: Date }
export interface RunRow { source_id: string; agent_source_id: string; started_at?: Date; ended_at?: Date; status?: string }
export interface StepRow { source_id: string; run_source_id: string; ordinal: number; name: string; type: string; tool?: string; status?: string }

/**
 * The app identity's Foundry token is only ever sent to a Foundry project endpoint,
 * e.g. https://<account>.services.ai.azure.com/api/projects/<project>.
 */
export function projectBase(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new Error('FOUNDRY_PROJECT_ENDPOINT is not a valid URL.');
  }
  const okHost = url.protocol === 'https:' && url.hostname.endsWith('.services.ai.azure.com');
  if (!okHost || !/^\/api\/projects\/[^/]+\/?$/.test(url.pathname)) {
    throw new Error('FOUNDRY_PROJECT_ENDPOINT must look like https://<account>.services.ai.azure.com/api/projects/<project>.');
  }
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
}

/** Calls Foundry. Errors carry only the status code, never response bodies or tokens. */
export async function foundry(base: string, token: string, method: string, path: string, body?: Json | FormData): Promise<Json> {
  const isForm = body instanceof FormData;
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403
      ? ' (the app identity needs the Foundry User role on the project; uploading and indexing documents also need Storage Blob Data Contributor on the project\'s storage account)'
      : '';
    throw new Error(`Foundry returned HTTP ${res.status} for ${method} ${path.split('?')[0]}${hint}.`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

/** Follows Foundry's cursor pagination (limit / after / has_more) up to `max` items. */
export async function listAll(base: string, token: string, path: string, max: number): Promise<Json[]> {
  const items: Json[] = [];
  let after = '';
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await foundry(base, token, 'GET', `${path}${sep}limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    items.push(...(page.data ?? []));
    if (!page.has_more || !page.last_id || items.length >= max) return items.slice(0, max);
    after = page.last_id;
  }
}

const fromUnix = (seconds: unknown) => (typeof seconds === 'number' ? new Date(seconds * 1000) : undefined);

export function toAgentRow(agent: Json): AgentRow {
  const latest = agent.versions?.latest ?? {};
  // Show metadata as short "key:value" tags, but skip our own abi_* markers and any non-scalar
  // (object/array) or oversized values, which would render as an ugly JSON blob.
  const tags = Object.entries(latest.metadata ?? {})
    .filter(([k, v]) => !k.startsWith('abi_') && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
    .map(([k, v]) => `${k}:${v}`)
    .filter((t) => t.length <= 60);
  return {
    source_id: agent.name,
    name: agent.name,
    description: latest.description || undefined,
    tags: tags.length ? JSON.stringify(tags) : undefined,
    created_at: fromUnix(latest.created_at),
  };
}

/** A Foundry "response" is one agent run. `completed_at` is only present on GET /responses/{id}. */
export function toRunRow(response: Json): RunRow {
  return {
    source_id: response.id,
    agent_source_id: response.agent_reference?.name,
    started_at: fromUnix(response.created_at),
    ended_at: fromUnix(response.completed_at),
    status: response.status,
  };
}

/**
 * Ordered output items become steps. `*_output` items are the results of the preceding
 * call (not separate steps) and `reasoning` items are model-internal, so both are skipped.
 * Foundry reports no per-item timestamps, so steps carry no duration.
 */
export function toStepRows(response: Json): StepRow[] {
  const items = (response.output ?? []).filter((o: Json) => !String(o.type).endsWith('_output') && o.type !== 'reasoning');
  return items.map((o: Json, i: number) => {
    const isCall = String(o.type).endsWith('_call');
    const name = o.type === 'message' ? 'message' : (o.name ?? o.server_label ?? String(o.type).replace(/_call$/, ''));
    return {
      source_id: o.id,
      run_source_id: response.id,
      ordinal: i + 1,
      name,
      type: isCall ? 'tool' : o.type === 'message' ? 'llm' : 'other',
      tool: isCall ? name : undefined,
      status: o.status,
    };
  });
}

export const isFinished = (status: string | undefined) => status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'incomplete';

// ---- Knowledge --------------------------------------------------------------

export const INSUFFICIENT_EVIDENCE = 'I could not find enough support for that answer in the currently indexed collection.';

export const GROUNDING_INSTRUCTIONS =
  'Answer only from the file search results, and cite the documents you use. ' +
  'Give a thorough, in-depth answer, formatted in Markdown for easy reading: open with a one- or two-sentence summary, ' +
  'use "-" bullet points for lists of findings, steps, or items, use **bold** for key terms, and use "#" headings when the answer has several sections. ' +
  `If the results do not contain the answer, reply exactly: "${INSUFFICIENT_EVIDENCE}" ` +
  'Do not use general knowledge.';

export interface Citation { fileId: string; document: string; section: string | null; passage: string | null }
export interface Answer { grounded: boolean; answer: string; citations: Citation[] }

/**
 * Turns a Responses API result into an answer. An answer counts as grounded only if it
 * cites at least one retrieved file that belongs to this app's collection; otherwise the
 * standard insufficient-evidence message is returned. Relevance scores proved unreliable
 * for this, and agent-run results do not carry a vector store id, so membership is by file.
 */
export function groundedAnswer(response: Json, collectionFileIds: Set<string>): Answer {
  const results: Json[] = (response.output ?? [])
    .filter((o: Json) => o.type === 'file_search_call')
    .flatMap((o: Json) => o.results ?? [])
    .filter((r: Json) => collectionFileIds.has(r.file_id));
  const message = response.output?.find((o: Json) => o.type === 'message')?.content?.find((c: Json) => c.type === 'output_text');
  const cited = new Map<string, Citation>();
  for (const a of message?.annotations ?? []) {
    if (a.type !== 'file_citation' || cited.has(a.file_id)) continue;
    const hit = results.find((r) => r.file_id === a.file_id);
    if (!hit) continue; // only cite what was retrieved from this collection
    const best = bestSection(hit.text ?? '', message?.text ?? '');
    cited.set(a.file_id, {
      fileId: a.file_id,
      document: a.filename ?? hit.filename ?? a.file_id,
      section: best.heading,
      passage: best.text ? best.text.slice(0, 400) : null,
    });
  }
  const text: string = message?.text?.trim() ?? '';
  if (!cited.size || !text || text.includes(INSUFFICIENT_EVIDENCE)) {
    return { grounded: false, answer: INSUFFICIENT_EVIDENCE, citations: [] };
  }
  return { grounded: true, answer: text, citations: [...cited.values()] };
}

/**
 * Splits a retrieved chunk at Markdown headings and returns the section that shares the
 * most words with the answer, so the citation points at the supporting passage.
 */
export function bestSection(chunk: string, answer: string): { heading: string | null; text: string } {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const answerWords = words(answer);
  const sections: { heading: string | null; text: string }[] = [];
  for (const line of chunk.split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim();
    if (heading || !sections.length) sections.push({ heading: heading ?? null, text: '' });
    sections[sections.length - 1].text += `${line}\n`;
  }
  const score = (s: { text: string }) => [...words(s.text)].filter((w) => answerWords.has(w)).length;
  const best = sections.reduce((a, b) => (score(b) > score(a) ? b : a), sections[0] ?? { heading: null, text: '' });
  return { heading: best.heading, text: best.text.trim() };
}

export const ALLOWED_EXTENSIONS =['pdf', 'docx', 'pptx', 'md', 'txt', 'html', 'json'];
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // conservative: the function payload limit is not documented

export function checkUpload(fileName: string, bytes: number): string | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXTENSIONS.includes(ext)) return `Unsupported file type ".${ext}". Supported: ${ALLOWED_EXTENSIONS.join(', ')}.`;
  if (bytes === 0) return 'The file is empty.';
  if (bytes > MAX_UPLOAD_BYTES) return 'The file is larger than the 4 MB limit.';
  if (/[\\/]/.test(fileName) || fileName.length > 200) return 'Invalid file name.';
  return null;
}
