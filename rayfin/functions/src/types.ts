/**
 * Function schema types for RayfinClient.
 *
 * AUTO-GENERATED — do not edit manually.
 * Re-generated automatically when function source files change.
 *
 * If this file is not updating automatically, run:
 *   rayfin dev functions apply
 *
 * The schema is a closed object type: only the function names listed
 * below are accepted by RayfinClient.functions.<name>.invoke(...).
 * Adding, renaming, or changing the signature of a udf.func() call
 * regenerates this file and surfaces type errors at every consumer.
 *
 * IMPORTANT: This file must NOT import any Node.js packages — it is
 * resolved by the frontend app's TypeScript compiler.
 */

export type AppFunctionsSchema = {
  testFoundryConnection: {
    input: Record<string, never>;
    output: { ok: boolean; message: string; project: null | string };
  };
  syncFoundry: {
    input: Record<string, never>;
    output: { agents: number; runsSaved: number; runsSkipped: number; stepsSaved: number; partial: boolean };
  };
  knowledgeStatus: {
    input: Record<string, never>;
    output: { collection: string; source: string; status: string; vectorStoreId: null | string; lastActiveAt: null | number; documents: { id: string; name: string; status: string; bytes: null | number; addedAt: null | number; error: null | string }[]; agent: null | { name: string; model: string; instructions: string; version: string }; deployments: string[]; defaultInstructions: string };
  };
  knowledgeDeleteAll: {
    input: Record<string, never>;
    output: { ok: boolean; message: string; agent: boolean; files: number; index: boolean };
  };
  getFoundryLinks: {
    input: Record<string, never>;
    output: { agent: string; index: string };
  };
  setFoundryLinks: {
    input: { agent: string; index: string };
    output: { ok: boolean };
  };
  knowledgeUpload: {
    input: { fileName: string; contentBase64: string };
    output: { ok: boolean; message: string };
  };
  knowledgeRemove: {
    input: { fileId: string };
    output: { ok: boolean };
  };
  knowledgeReindex: {
    input: Record<string, never>;
    output: { documents: number };
  };
  knowledgeAsk: {
    input: { question: string };
    output: { grounded: boolean; answer: string; citations: { fileId: string; document: string; section: null | string; passage: null | string }[] } & { agent: null | string };
  };
  recordUsage: {
    input: { type: string; detail: string; userEmail: string };
    output: { ok: boolean };
  };
  usageSummary: {
    input: Record<string, never>;
    output: { totalEvents: number; uniqueUsers: number; firstAt: null | number; lastAt: null | number; byType: { type: string; count: number }[]; byUser: { user: string; count: number; lastAt: null | number }[]; recent: { at: null | number; user: string; type: string; detail: null | string }[] };
  };
};
