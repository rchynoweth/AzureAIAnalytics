// Database tables for synced Microsoft Foundry records (Rayfin data service).
// Rayfin defines tables with decorators; this is the only file that uses them.
// Rows mirror the source-neutral shapes in src/data/normalize.ts (RawAgent / RawRun / RawStep),
// so Live mode reads them back and runs the same normalize() as Synthetic mode.
//
// Access: any signed-in user of the app can read. Writes come from the syncFoundry function,
// which uses the caller's database permissions; Rayfin has no narrower built-in role.

import { authenticated, date, entity, int, text } from '@microsoft/rayfin-core';

@entity()
@authenticated('*')
export class FoundryAgent {
  @text({ max: 200, unique: true }) source_id!: string; // Foundry agent name
  @text({ max: 200 }) name!: string;
  @text({ max: 2000, optional: true }) description?: string;
  @text({ max: 2000, optional: true }) tags?: string; // JSON array of "key:value" from agent metadata
  @date({ optional: true }) created_at?: Date;
}

@entity()
@authenticated('*')
export class FoundryRun {
  @text({ max: 200, unique: true }) source_id!: string; // Foundry response id
  @text({ max: 200 }) agent_source_id!: string;
  @date({ optional: true }) started_at?: Date; // response created_at
  @date({ optional: true }) ended_at?: Date; // response completed_at
  @text({ max: 50, optional: true }) status?: string; // raw Foundry status
}

@entity()
@authenticated('*')
export class FoundryStep {
  @text({ max: 200, unique: true }) source_id!: string; // Foundry output item id
  @text({ max: 200 }) run_source_id!: string;
  @int() ordinal!: number;
  @text({ max: 200 }) name!: string;
  @text({ max: 50 }) type!: string; // "tool" | "llm" | "other"
  @text({ max: 200, optional: true }) tool?: string;
  @text({ max: 50, optional: true }) status?: string;
}

// Usage telemetry: one row per recorded action. Transparent, first-party, and kept inside
// this app's own database (never sent anywhere external). Users are told it is recorded.
// `user_email` is the signed-in Fabric identity; events belong to the workspace, not to Inviso.
@entity()
@authenticated('*')
export class UsageEvent {
  @date() at!: Date;
  @text({ max: 200, optional: true }) user_email?: string;
  @text({ max: 50 }) type!: string; // app_opened | page_view | document_added | document_removed | reindex | question_asked | sync_run | agent_saved
  @text({ max: 300, optional: true }) detail?: string; // page name, document count, etc. — never document contents
}

// Deployment-wide settings shared by every user (for example the Foundry portal link pattern,
// which needs the subscription and resource group that the Foundry API does not expose).
@entity()
@authenticated('*')
export class AppConfig {
  @text({ max: 100, unique: true }) key!: string;
  @text({ max: 2000 }) value!: string;
}

export type AppSchema = {
  FoundryAgent: FoundryAgent;
  FoundryRun: FoundryRun;
  FoundryStep: FoundryStep;
  UsageEvent: UsageEvent;
  AppConfig: AppConfig;
};
