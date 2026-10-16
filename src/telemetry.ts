// First-party usage telemetry. Records who uses the app and which actions they take, by calling
// the recordUsage function, which stores events in this app's own database. Nothing is sent to any
// external service. Users see a visible notice; the workspace owner reads the summary in Settings.
//
// Telemetry must never affect the experience: every call is fire-and-forget and swallows errors.

import type { AppClient } from './data/live';

export type UsageType =
  | 'app_opened' | 'page_view' | 'document_added' | 'document_removed' | 'reindex' | 'question_asked' | 'sync_run' | 'agent_saved' | 'agent_deleted';

export type Recorder = (type: UsageType, detail?: string) => void;

const noop: Recorder = () => {};

/** Builds a recorder bound to the signed-in client and identity. Returns a no-op before sign-in. */
export function createRecorder(client: AppClient | null, email: string | null): Recorder {
  if (!client) return noop;
  return (type, detail) => {
    void client.functions.recordUsage.invoke({ type, detail: detail ?? '', userEmail: email ?? '' }).catch(() => {
      // Telemetry failures are intentionally ignored so they never disrupt the app.
    });
  };
}
