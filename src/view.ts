// The filter context every page renders from: dataset + settings + selected window.

import type { Dataset, Run } from './data/model';
import { runsIn, windowPeriods, WINDOWS, type Period, type WindowKey } from './analytics/metrics';
import { fmtDate } from './format';
import type { Settings } from './settings';

export interface View {
  dataset: Dataset;
  settings: Settings;
  windowKey: WindowKey;
  period: Period;
  previousPeriod: Period | null;
  runs: Run[]; // runs in the selected window
  previousRuns: Run[]; // runs in the preceding window of equal length
  windowLabel: string; // e.g. "Last 30 days (Sep 15 – Oct 14, 2026 UTC)"
}

export function makeView(dataset: Dataset, settings: Settings, windowKey: WindowKey): View {
  const { current, previous } = windowPeriods(windowKey, dataset.loaded_at, dataset.runs);
  return {
    dataset,
    settings,
    windowKey,
    period: current,
    previousPeriod: previous,
    runs: runsIn(dataset.runs, current),
    previousRuns: previous ? runsIn(dataset.runs, previous) : [],
    windowLabel: `${WINDOWS[windowKey].label} (${fmtDate(current.start)} – ${fmtDate(current.end - 1)} UTC)`,
  };
}

/** The same view narrowed to one agent's runs. */
export function forAgent(view: View, agentId: string): View {
  return {
    ...view,
    runs: view.runs.filter((r) => r.agent_id === agentId),
    previousRuns: view.previousRuns.filter((r) => r.agent_id === agentId),
  };
}
