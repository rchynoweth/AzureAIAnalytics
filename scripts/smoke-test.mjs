// Application smoke test: starts the real app and loads each page in headless
// Edge or Chrome, then checks the rendered DOM. Also checks that the production
// build refuses to show content without Fabric sign-in.
// Run: npm run smoke   (set BROWSER=/path/to/chrome-or-edge to choose a browser)
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join } from 'node:path';

const BROWSERS = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const browser = BROWSERS.find((b) => existsSync(b));
if (!browser) {
  console.error('No Edge or Chrome found. Set BROWSER=/path/to/browser and rerun.');
  process.exit(2);
}

const vite = join('node_modules', 'vite', 'bin', 'vite.js');
const profile = mkdtempSync(join(tmpdir(), 'abi-smoke-'));
const failures = [];

/** An unused local port, so the test never talks to some other app's server. */
const freePort = () =>
  new Promise((resolve) => {
    const srv = createServer().listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

/** Starts Vite (dev or preview) and resolves once it serves this app's page. */
async function start(args) {
  const port = await freePort();
  // Run as an undeployed build in Synthetic mode, whatever .env / .env.local say.
  const env = { ...process.env, VITE_RAYFIN_API_URL: '', VITE_RAYFIN_PUBLISHABLE_KEY: '', VITE_DATA_MODE: 'synthetic' };
  const child = spawn(process.execPath, [vite, ...args, '--port', String(port), '--strictPort'], { stdio: 'ignore', env });
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode != null) throw new Error(`Vite exited early (${args.join(' ') || 'dev'}).`);
    try {
      if ((await (await fetch(url)).text()).includes('<title>Agent Behavior Intelligence</title>')) return { child, url };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`Server did not start: ${url}`);
}

function render(url) {
  return execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`,
    '--virtual-time-budget=20000', '--dump-dom', url,
  ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
}

function check(name, dom, mustContain, mustNotContain = []) {
  const missing = mustContain.filter((t) => !dom.includes(t));
  const present = mustNotContain.filter((t) => dom.includes(t));
  const ok = !missing.length && !present.length;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures.push({ name, missing, present });
}

const sampleRun = JSON.parse(readFileSync('src/data/synthetic/runs.json', 'utf8')).find((r) => r.agent_id === 'agt-invoice-recon');
const ERRORS = ['Could not calculate', 'could not be displayed', 'Page not found'];

// 1. Dev server, local preview with synthetic data (no Fabric deployment).
const { child: dev, url: base } = await start([]);
try {
  check('Analytics summary', render(`${base}#/`), ['Synthetic sample data', 'Local preview', 'Analytics', 'Median steps per run', 'Highlights', 'Most complex run', 'Investigation candidates'], ERRORS);
  check('Analytics complexity', render(`${base}#/analytics/complexity`), ['Run complexity', 'Most complex runs', 'Agents by typical complexity'], ERRORS);
  check('Analytics steps', render(`${base}#/analytics/steps`), ['Most used steps and tools', 'Which agents use which steps', 'Common execution paths'], ERRORS);
  check('Analytics trends', render(`${base}#/analytics/trends`), ['Behavior over time', 'Where run time accumulates'], ERRORS);
  check('Agents', render(`${base}#/agents`), ['Support Triage', 'Research Assistant', 'Sort by'], ERRORS);
  check('Agent detail', render(`${base}#/agents/agt-research`), ['Behavior profile', 'Common execution paths', 'Three-step', 'Recent runs'], ERRORS);
  check('Run summary', render(`${base}#/agents/agt-invoice-recon/runs/${sampleRun.id}`), ['Run summary', 'Run ID', 'Ordered steps'], ERRORS);
  check('Knowledge (signed out)', render(`${base}#/knowledge`), ['needs Fabric sign-in'], ERRORS);
  check('Settings', render(`${base}#/settings`), ['Data mode', 'Live connection'], ERRORS);
  check('Unknown route', render(`${base}#/nope`), ['Page not found']);
} finally {
  dev.kill();
}

// 2. Production build: without a Fabric deployment it must show the gate, not data.
execFileSync(process.execPath, [join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'error'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_RAYFIN_API_URL: '', VITE_RAYFIN_PUBLISHABLE_KEY: '', VITE_DATA_MODE: 'synthetic' },
});
const { child: preview, url: previewUrl } = await start(['preview']);
try {
  // Any gate screen is acceptable; what matters is that no app content renders.
  check('Production build requires sign-in', render(`${previewUrl}#/`), ['class="screen"'], ['Synthetic sample data', 'Median steps per run', 'Agents</a>']);
} finally {
  preview.kill();
}

rmSync(profile, { recursive: true, force: true });
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log('Smoke test passed.');
