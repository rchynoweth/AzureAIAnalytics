// Plain-language metric definitions shown next to every metric and chart.
// They must match the formulas in src/analytics.

import { MIN_RUNS_FOR_QUARTILES, MIN_SAMPLE_FOR_P95 } from './analytics/metrics';

export const DEF = {
  agents: 'Distinct agents with at least one run in the selected window.',
  runs: 'Runs that started in the selected window.',
  stepCount: 'Step count is the number of observable steps recorded for a run. It describes execution shape, not quality. In-progress runs are left out of step-count statistics because their steps are incomplete.',
  medianSteps: 'The middle step count across completed runs; less affected by unusually long runs than an average.',
  medianDuration: 'The middle run duration (end − start) across runs with valid timing. Includes any waiting, retries, and tool latency inside the run.',
  successRate: 'Succeeded runs ÷ runs that finished with a known status (succeeded or failed). In-progress and unknown runs are excluded and counted separately — never counted as failures.',
  repeatRate: 'Runs in which any step ran more than once ÷ runs analyzed. Repetition can be intentional (retries, loops) and is a signal to look at, not a defect.',
  stepRepeatRate: 'Runs in which this step ran more than once ÷ runs containing this step.',
  complexity: `Each run's step count compared with its own agent's runs in this window: lower (below the agent's 25th percentile), typical (25th–75th), higher (above the 75th). Agents with fewer than ${MIN_RUNS_FOR_QUARTILES} completed runs are not banded.`,
  stepUsage: 'How often each normalized step or tool ran, and the share of runs that contain it (a step counts once per run).',
  failureAssociation: 'Failed runs that contain this step. Association only — it does not show the step caused the failure.',
  sequences: 'Exact ordered runs of consecutive normalized steps, counted as observed. These are execution paths, not reasoning.',
  trends: 'The selected window compared with the immediately preceding window of the same length. Percentage change is shown only when the earlier value is not zero.',
  candidates: `Runs above their own agent's 95th percentile for step count, run duration, or repeated steps (agents need at least ${MIN_SAMPLE_FOR_P95} runs). A prompt to look closer, not a severity score.`,
} as const;
