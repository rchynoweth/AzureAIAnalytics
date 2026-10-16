// Server-side functions. Foundry calls use the app identity's token (ctx.Tokens.AzureAI);
// database writes use the signed-in caller's permissions (ctx.getDataClient()).
// Configuration (never in source): the secret FOUNDRY_PROJECT_ENDPOINT.

import { AudienceType, UserDataFunctions, type RayfinContext } from '@microsoft/fabric-user-data-functions';
import {
  GROUNDING_INSTRUCTIONS, checkUpload, foundry, groundedAnswer, isFinished, listAll, projectBase,
  toAgentRow, toRunRow, toStepRows, type AgentRow, type Answer, type RunRow, type StepRow,
} from './foundry.js';
import { cleanEvent, summarizeUsage, type UsageRow, type UsageSummary } from './usage.js';

type Row<T> = T & { id: string };
type UsageEventRow = Row<{ at: Date; user_email?: string; type: string; detail?: string }>;
type Schema = { FoundryAgent: Row<AgentRow>; FoundryRun: Row<RunRow>; FoundryStep: Row<StepRow>; UsageEvent: UsageEventRow; AppConfig: Row<{ key: string; value: string }> };
// Handlers spell out RayfinContext<...> literally: the deploy metadata only recognizes the
// context parameter by that exact annotation (an alias is treated as a request input).
type Ctx = RayfinContext<Schema, AudienceType.AzureAI>;

const udf = new UserDataFunctions();
const MAX_RUNS = 1000;
const TIME_BUDGET_MS = 200_000; // stay inside the 250 s invocation limit
const COLLECTION = 'agent-behavior-intelligence'; // the one Foundry vector store this app uses
const KNOWLEDGE_ROLE = 'knowledge'; // metadata tag that marks this app's knowledge agent
const DEFAULT_AGENT_NAME = 'knowledge-assistant'; // auto-created on first use; no configuration needed

const connect = (ctx: Ctx) => ({ base: projectBase(ctx.Secrets.FOUNDRY_PROJECT_ENDPOINT), token: ctx.Tokens.AzureAI });

// ---- Agent behavior data ------------------------------------------------------

udf.func('testFoundryConnection', async (ctx: RayfinContext<Schema, AudienceType.AzureAI>): Promise<{ ok: boolean; message: string; project: string | null }> => {
  try {
    const { base, token } = connect(ctx);
    const page = await foundry(base, token, 'GET', '/agents?api-version=v1&limit=100');
    const project = new URL(base).hostname.split('.')[0] + base.slice(base.lastIndexOf('/'));
    return { ok: true, project, message: `Connected. ${page.data?.length ?? 0}${page.has_more ? '+' : ''} agents visible.` };
  } catch (error) {
    return { ok: false, project: null, message: error instanceof Error ? error.message : 'Connection failed.' };
  }
}, []);

export interface SyncResult { agents: number; runsSaved: number; runsSkipped: number; stepsSaved: number; partial: boolean }

/** Copies Foundry agents, runs (responses), and steps (output items) into the app database. Newest runs first. */
udf.func('syncFoundry', async (ctx: RayfinContext<Schema, AudienceType.AzureAI>): Promise<SyncResult> => {
  const started = Date.now();
  const { base, token } = connect(ctx);
  const db = ctx.getDataClient();

  const agents = (await listAll(base, token, '/agents?api-version=v1', 1000)).map(toAgentRow);
  const responses = (await listAll(base, token, '/openai/v1/responses?order=desc', MAX_RUNS)).filter((r) => r.agent_reference?.name);
  const storedAgents = new Map((await allRows(db.FoundryAgent, ['id', 'source_id'])).map((r) => [r.source_id, r.id]));
  const storedRuns = new Map((await allRows(db.FoundryRun, ['id', 'source_id', 'status'])).map((r) => [r.source_id, r]));
  const storedSteps = new Set((await allRows(db.FoundryStep, ['id', 'source_id'])).map((r) => r.source_id));

  for (const agent of agents) {
    const id = storedAgents.get(agent.source_id);
    if (id) await db.FoundryAgent.update({ id }, agent);
    else await db.FoundryAgent.create(agent);
  }

  const result: SyncResult = { agents: agents.length, runsSaved: 0, runsSkipped: 0, stepsSaved: 0, partial: false };
  for (const listed of responses) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      result.partial = true; // the next sync continues where this one stopped
      break;
    }
    const stored = storedRuns.get(listed.id);
    if (stored && isFinished(stored.status)) {
      result.runsSkipped++;
      continue;
    }
    // completed_at is only returned when fetching a single response.
    const full = await foundry(base, token, 'GET', `/openai/v1/responses/${encodeURIComponent(listed.id)}`);
    const run = toRunRow(full);
    if (stored) await db.FoundryRun.update({ id: stored.id }, run);
    else await db.FoundryRun.create(run);
    result.runsSaved++;
    for (const step of toStepRows(full)) {
      if (storedSteps.has(step.source_id)) continue;
      await db.FoundryStep.create(step);
      result.stepsSaved++;
    }
  }
  return result;
}, []);

/** Reads every row of a table with cursor pagination (a single query returns at most one page). */
async function allRows(table: any, fields: string[]): Promise<any[]> {
  const rows: any[] = [];
  let after: string | undefined;
  do {
    // Order by the primary key `id`, which every entity has (not every table has source_id).
    let query = table.select(fields).orderBy({ id: 'asc' }).first(1000);
    if (after) query = query.after(after);
    const page = await query.executePaginated();
    rows.push(...page.items);
    after = page.hasNextPage ? page.endCursor : undefined;
  } while (after);
  return rows;
}

// ---- Knowledge: a Foundry prompt agent with file search over one vector store ----
// The app finds "its" agent by metadata, so the agent can be renamed from Settings.

export interface KnowledgeDocument { id: string; name: string; status: string; bytes: number | null; addedAt: number | null; error: string | null }
export interface KnowledgeAgent { name: string; model: string; instructions: string; version: string }
export interface KnowledgeStatus {
  collection: string;
  source: string;
  status: string; // "not_created" | Foundry vector store status
  vectorStoreId: string | null; // the Foundry vector store id, for a portal link
  lastActiveAt: number | null;
  documents: KnowledgeDocument[];
  agent: KnowledgeAgent | null;
  deployments: string[]; // chat model deployments in the Foundry project
  defaultInstructions: string;
}

async function findStore(base: string, token: string) {
  return (await listAll(base, token, '/openai/v1/vector_stores', 1000)).find((s) => s.name === COLLECTION) ?? null;
}

async function ensureStore(base: string, token: string) {
  return (await findStore(base, token)) ?? (await foundry(base, token, 'POST', '/openai/v1/vector_stores', { name: COLLECTION }));
}

async function storeFiles(base: string, token: string, storeId: string) {
  return listAll(base, token, `/openai/v1/vector_stores/${storeId}/files`, 10_000);
}

async function findAgent(base: string, token: string): Promise<KnowledgeAgent | null> {
  const agents = await listAll(base, token, '/agents?api-version=v1', 1000);
  const agent = agents.find((a) => a.versions?.latest?.metadata?.abi_role === KNOWLEDGE_ROLE);
  const latest = agent?.versions?.latest;
  if (!latest) return null;
  return { name: agent!.name, model: latest.definition?.model ?? '', instructions: latest.definition?.instructions ?? '', version: String(latest.version) };
}

/**
 * Returns this app's knowledge agent, creating a default one (first chat deployment, standard
 * grounding instructions, file search over the collection) if none exists. Zero configuration.
 */
async function ensureAgent(base: string, token: string, storeId: string): Promise<KnowledgeAgent | null> {
  const existing = await findAgent(base, token);
  if (existing) return existing;
  const models = await chatDeployments(base, token);
  if (!models.length) return null; // no chat model in the project; the UI explains this
  await foundry(base, token, 'POST', `/agents/${encodeURIComponent(DEFAULT_AGENT_NAME)}/versions?api-version=v1`, {
    description: 'Answers questions from the Agent Behavior Intelligence knowledge collection.',
    metadata: { abi_role: KNOWLEDGE_ROLE },
    definition: { kind: 'prompt', model: models[0], instructions: GROUNDING_INSTRUCTIONS, tools: [{ type: 'file_search', vector_store_ids: [storeId] }] },
  });
  return findAgent(base, token);
}

async function chatDeployments(base: string, token: string): Promise<string[]> {
  const page = await foundry(base, token, 'GET', '/deployments?api-version=v1');
  return (page.value ?? []).filter((d: any) => !/embedding/i.test(d.modelName ?? '')).map((d: any) => d.name);
}

udf.func('knowledgeStatus', async (ctx: RayfinContext<Schema, AudienceType.AzureAI>): Promise<KnowledgeStatus> => {
  const { base, token } = connect(ctx);
  const [store, agent, deployments] = await Promise.all([findStore(base, token), findAgent(base, token), chatDeployments(base, token)]);
  const documents: KnowledgeDocument[] = [];
  for (const f of store ? await storeFiles(base, token, store.id) : []) {
    const file = await foundry(base, token, 'GET', `/openai/v1/files/${encodeURIComponent(f.id)}`);
    documents.push({
      id: f.id,
      name: file.filename ?? f.id,
      status: f.status,
      bytes: file.bytes ?? null,
      addedAt: f.created_at ?? null,
      error: f.last_error?.code ?? null, // code only; messages may echo document content
    });
  }
  return {
    collection: COLLECTION,
    source: `Microsoft Foundry file search (${new URL(base).hostname.split('.')[0]})`,
    status: store?.status ?? 'not_created',
    vectorStoreId: store?.id ?? null,
    lastActiveAt: store?.last_active_at ?? null,
    documents,
    agent,
    deployments,
    defaultInstructions: GROUNDING_INSTRUCTIONS,
  };
}, []);

/** Full cleanup: deletes this app's knowledge agent, every document, and the vector store from Foundry. */
udf.func('knowledgeDeleteAll', async (ctx: RayfinContext<Schema, AudienceType.AzureAI>): Promise<{ ok: boolean; message: string; agent: boolean; files: number; index: boolean }> => {
  const { base, token } = connect(ctx);
  const [agent, store] = await Promise.all([findAgent(base, token), findStore(base, token)]);
  if (!agent && !store) return { ok: false, message: 'There is nothing to delete.', agent: false, files: 0, index: false };
  if (agent) await foundry(base, token, 'DELETE', `/agents/${encodeURIComponent(agent.name)}?api-version=v1`);
  let files = 0;
  if (store) {
    const list = await storeFiles(base, token, store.id); // list before deleting the store
    for (const f of list) await foundry(base, token, 'DELETE', `/openai/v1/files/${encodeURIComponent(f.id)}`);
    await foundry(base, token, 'DELETE', `/openai/v1/vector_stores/${store.id}`);
    files = list.length;
  }
  const parts = [agent && `agent "${agent.name}"`, files > 0 && `${files} document${files === 1 ? '' : 's'}`, store && 'the index'].filter(Boolean);
  return { ok: true, message: `Deleted ${parts.join(', ')} from Foundry.`, agent: Boolean(agent), files, index: Boolean(store) };
}, []);

udf.func('knowledgeUpload', async (fileName: string, contentBase64: string, ctx: RayfinContext<Schema, AudienceType.AzureAI>): Promise<{ ok: boolean; message: string }> => {
  const bytes = Buffer.from(contentBase64, 'base64');
  const invalid = checkUpload(fileName, bytes.length);
  if (invalid) return { ok: false, message: invalid };
  const { base, token } = connect(ctx);
  const form = new FormData();
  form.append('purpose', 'assistants');
  form.append('file', new Blob([bytes]), fileName);
  const file = await foundry(base, token, 'POST', '/openai/v1/files', form);
  const store = await ensureStore(base, token);
  await foundry(base, token, 'POST', `/openai/v1/vector_stores/${store.id}/files`, { file_id: file.id, attributes: { abi_collection: COLLECTION } });
  await ensureAgent(base, token, store.id); // provision the default answering agent on first upload
  return { ok: true, message: `Received ${fileName}. Foundry is extracting, chunking, embedding, and indexing it.` };
}, []);

udf.func('knowledgeRemove', async (fileId: string, ctx: RayfinContext<Schema, AudienceType.AzureAI>): Promise<{ ok: boolean }> => {
  const { base, token } = connect(ctx);
  const store = await findStore(base, token);
  const files = store ? await storeFiles(base, token, store.id) : [];
  if (!store || !files.some((f) => f.id === fileId)) return { ok: false }; // only files in this collection
  await foundry(base, token, 'DELETE', `/openai/v1/vector_stores/${store.id}/files/${encodeURIComponent(fileId)}`);
  await foundry(base, token, 'DELETE', `/openai/v1/files/${encodeURIComponent(fileId)}`);
  return { ok: true };
}, []);

/** Re-processes every document: detach and re-attach each file to the collection. */
udf.func('knowledgeReindex', async (ctx: RayfinContext<Schema, AudienceType.AzureAI>): Promise<{ documents: number }> => {
  const { base, token } = connect(ctx);
  const store = await findStore(base, token);
  if (!store) return { documents: 0 };
  const files = await storeFiles(base, token, store.id);
  for (const f of files) {
    await foundry(base, token, 'DELETE', `/openai/v1/vector_stores/${store.id}/files/${encodeURIComponent(f.id)}`);
    await foundry(base, token, 'POST', `/openai/v1/vector_stores/${store.id}/files`, { file_id: f.id, attributes: { abi_collection: COLLECTION } });
  }
  return { documents: files.length };
}, []);

/** Asks the knowledge agent. Its conversations are stored in Foundry, so they appear in the behavior analytics. */
udf.func('knowledgeAsk', async (question: string, ctx: RayfinContext<Schema, AudienceType.AzureAI>): Promise<Answer & { agent: string | null }> => {
  const q = question.trim().slice(0, 1000);
  const { base, token } = connect(ctx);
  const store = await findStore(base, token);
  if (!q || !store) return { ...groundedAnswer({}, new Set()), agent: null };
  const agent = await ensureAgent(base, token, store.id); // create the default agent on first use
  if (!agent) return { ...groundedAnswer({}, new Set()), agent: null };
  const fileIds = new Set((await storeFiles(base, token, store.id)).map((f) => f.id));
  const response = await foundry(base, token, 'POST', '/openai/v1/responses', {
    agent_reference: { name: agent.name, type: 'agent_reference' },
    input: q,
    include: ['file_search_call.results'],
    metadata: { abi_role: KNOWLEDGE_ROLE, abi_collection: COLLECTION }, // groups knowledge chats under this app in Foundry
  });
  return { ...groundedAnswer(response, fileIds), agent: agent.name };
}, []);

// ---- Deployment-wide config (shared by all users) -----------------------------
// Holds the Foundry portal link patterns. The portal URL needs the subscription and resource
// group, which the Foundry data-plane API does not return, so an admin sets them once (by pasting
// one portal link) and every user gets working "Open in Foundry" links.

/** Returns the saved Foundry portal link patterns (empty strings when not configured). */
udf.func('getFoundryLinks', async (ctx: RayfinContext<Schema, AudienceType.AzureAI>): Promise<{ agent: string; index: string }> => {
  const byKey = new Map((await allRows(ctx.getDataClient().AppConfig, ['key', 'value'])).map((r) => [r.key, r.value]));
  return { agent: byKey.get('foundry_agent_url') ?? '', index: byKey.get('foundry_index_url') ?? '' };
}, []);

/** Saves the Foundry portal link patterns for the whole deployment. Empty values clear them. */
udf.func('setFoundryLinks', async (agent: string, index: string, ctx: RayfinContext<Schema, AudienceType.AzureAI>): Promise<{ ok: boolean }> => {
  const db = ctx.getDataClient();
  const ids = new Map((await allRows(db.AppConfig, ['id', 'key'])).map((r) => [r.key, r.id]));
  const clean = (s: string, placeholder: string) => {
    const v = (s ?? '').trim().slice(0, 2000);
    return !v || (v.startsWith('https://') && v.includes(placeholder)) ? v : ''; // reject anything that is not a valid template
  };
  const save = async (key: string, value: string) => {
    const id = ids.get(key);
    if (id) await db.AppConfig.update({ id }, { key, value });
    else await db.AppConfig.create({ key, value });
  };
  await save('foundry_agent_url', clean(agent, '{agent_id}'));
  await save('foundry_index_url', clean(index, '{index_id}'));
  return { ok: true };
}, []);

// ---- Usage telemetry ----------------------------------------------------------
// First-party and transparent: events stay in this app's database and are shown to users
// (a visible notice) and to the workspace owner (Settings → Usage). Nothing is sent externally.

/** Records one usage event. `userEmail` is the signed-in Fabric identity passed by the frontend. */
udf.func('recordUsage', async (type: string, detail: string, userEmail: string, ctx: RayfinContext<Schema, AudienceType.AzureAI>): Promise<{ ok: boolean }> => {
  const event = cleanEvent(type, detail);
  await ctx.getDataClient().UsageEvent.create({
    at: new Date(),
    user_email: userEmail ? userEmail.trim().slice(0, 200) : undefined,
    type: event.type,
    detail: event.detail,
  });
  return { ok: true };
}, []);

/** Returns a usage summary for the workspace owner. Reads only this app's own events. */
udf.func('usageSummary', async (ctx: RayfinContext<Schema, AudienceType.AzureAI>): Promise<UsageSummary> => {
  const rows = (await allRows(ctx.getDataClient().UsageEvent, ['at', 'user_email', 'type', 'detail'])) as UsageRow[];
  return summarizeUsage(rows);
}, []);
