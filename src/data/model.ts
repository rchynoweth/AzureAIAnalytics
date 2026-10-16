// The normalized internal data contract. Analytics and pages consume only these
// types; provider payloads are converted by `normalize()` and never travel further.
// Timestamps are epoch milliseconds (UTC); null means missing or unparseable.

export type Status = 'succeeded' | 'failed' | 'in_progress' | 'unknown';
export type StepType = 'model_call' | 'tool_call' | 'other';
export type DataMode = 'synthetic' | 'live';

export interface Agent {
  agent_id: string;
  name: string;
  description: string;
  foundry_url: string | null; // source-provided link, validated https or null
  tags: string[];
  source_name: string; // the data source the agent was read from
  created_at: number | null;
  last_observed_at: number | null; // latest run start in the loaded data
}

export interface Run {
  run_id: string;
  agent_id: string;
  started_at: number | null;
  ended_at: number | null;
  duration_ms: number | null; // null when missing or invalid
  status: Status;
  step_count: number; // always the number of normalized steps for this run
  source_url: string | null;
  source_name: string;
}

export interface Step {
  step_id: string;
  run_id: string;
  ordinal: number | null;
  source_name: string; // raw step name exactly as the source reported it
  normalized_name: string;
  step_type: StepType;
  tool_name: string | null;
  started_at: number | null;
  ended_at: number | null;
  duration_ms: number | null; // null when missing or invalid
  status: Status;
}

/** A sanitized data-quality finding produced during normalization. */
export interface DataIssue {
  code: string;
  entity: 'agent' | 'run' | 'step';
  entity_id: string;
  detail: string;
}

/** Everything one provider load produced, already normalized. */
export interface Dataset {
  mode: DataMode;
  source_label: string;
  agents: Map<string, Agent>;
  runs: Run[];
  stepsByRun: Map<string, Step[]>; // each list ordered by ordinal
  issues: DataIssue[];
  loaded_at: number;
}
