// Live provider: reads Foundry agents, runs, and steps that the syncFoundry function copied
// into the app database, maps them to the source-neutral Raw* shapes, and normalizes them
// exactly like Synthetic data. Analytics and pages need no source-specific code.

import type { RayfinClient } from '@microsoft/rayfin-client';
import type { AppSchema } from '../../rayfin/data/schema';
import type { AppFunctionsSchema } from '../../rayfin/functions/src/types';
import type { Dataset } from './model';
import { normalize, type RawData } from './normalize';

export type AppClient = RayfinClient<AppSchema, AppFunctionsSchema>;
export const LIVE_SOURCE = 'Microsoft Foundry (synced to the app database)';

export class LiveUnavailableError extends Error {}

type Dateish = Date | string | null | undefined;
const iso = (v: Dateish) => (v instanceof Date ? v.toISOString() : v ?? null);

type AgentRow = { source_id: string; name: string; description?: string | null; tags?: string | null; created_at?: Dateish };
type RunRow = { source_id: string; agent_source_id: string; started_at?: Dateish; ended_at?: Dateish; status?: string | null };
type StepRow = { source_id: string; run_source_id: string; ordinal: number; name: string; type: string; tool?: string | null; status?: string | null };

export function liveRawData(agents: AgentRow[], runs: RunRow[], steps: StepRow[]): RawData {
  const tags = (json: string | null | undefined): string[] => {
    try {
      const parsed = json ? JSON.parse(json) : [];
      // Keep short, simple "key:value" tags; drop JSON-looking or oversized metadata values.
      return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string' && t.length <= 60 && !/[{}[\]]/.test(t)) : [];
    } catch {
      return [];
    }
  };
  return {
    agents: agents.map((a) => ({ id: a.source_id, name: a.name, description: a.description, tags: tags(a.tags), created_at: iso(a.created_at) })),
    runs: runs.map((r) => ({ id: r.source_id, agent_id: r.agent_source_id, started_at: iso(r.started_at), ended_at: iso(r.ended_at), status: r.status })),
    steps: steps.map((s) => ({ id: s.source_id, run_id: s.run_source_id, ordinal: s.ordinal, name: s.name, type: s.type, tool: s.tool, status: s.status })),
  };
}

export async function loadLive(client: AppClient | null, now = Date.now()): Promise<Dataset> {
  if (!client) {
    throw new LiveUnavailableError('Live data needs Fabric sign-in. Open the deployed app from Fabric, or switch to Synthetic mode in Settings.');
  }
  const [agents, runs, steps] = await Promise.all([
    readAll(client.data.FoundryAgent, ['source_id', 'name', 'description', 'tags', 'created_at']),
    readAll(client.data.FoundryRun, ['source_id', 'agent_source_id', 'started_at', 'ended_at', 'status']),
    readAll(client.data.FoundryStep, ['source_id', 'run_source_id', 'ordinal', 'name', 'type', 'tool', 'status']),
  ]);
  const normalized = normalize(liveRawData(agents, runs, steps), LIVE_SOURCE);
  return { mode: 'live', source_label: LIVE_SOURCE, loaded_at: now, ...normalized };
}

/** Reads a whole table; a single query returns at most one page. */
async function readAll(table: any, fields: string[]): Promise<any[]> {
  const rows: any[] = [];
  let after: string | undefined;
  do {
    let query = table.select(fields).orderBy({ source_id: 'asc' }).first(1000);
    if (after) query = query.after(after);
    const page = await query.executePaginated();
    rows.push(...page.items);
    after = page.hasNextPage ? page.endCursor : undefined;
  } while (after);
  return rows;
}
