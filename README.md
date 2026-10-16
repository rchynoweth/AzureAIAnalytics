# Agent Behavior Intelligence

An open-source app for understanding **observable agent behavior**: how many steps runs take, which
steps and tools recur, where time accumulates, which step sequences are common, how behavior changes
over time, and which runs are worth a closer look.

It summarizes behavior and links out to Microsoft Foundry for detail. It is not a trace viewer, and
it does not rank agents, score quality, or infer reasoning.

The app ships as a **Microsoft Fabric App** (Fabric Apps preview, built on the Rayfin SDK): Fabric
hosts it, users sign in with Fabric single sign-on, and server-side functions read **Microsoft
Foundry** agent data and documents. It also runs locally on packaged **synthetic data** before any
connection exists.

## Pages

- **Analytics** — the portfolio dashboard, as tabs: Pulse, Complexity & outliers, Flow & steps,
  Trends, Data quality. Investigation candidates and the most complex runs are surfaced for drill-in.
- **Agents** — a searchable agent grid → Agent detail → Run summary.
- **Knowledge** — upload documents (indexed by Foundry file search) and chat with answers grounded
  only in them, with citations. The answering agent is created automatically on first use.
- **Settings** (under the avatar menu, top-right) — data mode, Foundry connection test and sync,
  Foundry link patterns, and owner-only **Usage**.

## Quick start (synthetic, no connection)

```sh
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
npm ci
npm run dev                 # http://localhost:5173
```

The defaults are Synthetic mode with no Foundry links. Production builds never show content without
Fabric sign-in.

## Deploy to Fabric

Prerequisites: Node 20/22/24 LTS; a Fabric workspace with capacity where you are Contributor+; the
**Fabric Apps (preview)** tenant setting enabled; and, for Live data and Knowledge, a Microsoft
Foundry project on which the deploying identity has the **Foundry User** role. The Azure CLI is not
required — deployment uses the Rayfin CLI's browser sign-in.

```sh
npx rayfin login                                   # once per machine
npm run deploy -- --workspace-id <workspace-id>    # create or update the Fabric App
npx rayfin secret set FOUNDRY_PROJECT_ENDPOINT     # https://<account>.services.ai.azure.com/api/projects/<project>
```

`rayfin up` rewrites `rayfin/rayfin.yml` with your tenant's hosting URL; don't commit that change
(`git checkout rayfin/rayfin.yml`). After deploying, open the hosting URL, confirm sign-in is
required, then use **Settings → Live connection** to test and sync.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local dev server (synthetic preview before the first deploy) |
| `npm run build` | Typecheck and production build to `dist/` |
| `npm test` | Unit and page-render tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run smoke` | Browser smoke test |
| `npm run deploy` | Deploy to Fabric (`rayfin up`) |

## How it fits together

- Synthetic and Live data both pass through one `normalize()` into a single `Dataset`; the analytics
  and pages have no source-specific code.
- Foundry is called only from `rayfin/functions`, with the app identity's token. The browser never
  holds a Foundry token.
- There is no background worker — sync runs when someone selects it.

```text
rayfin/data/schema.ts     Database tables (FoundryAgent, FoundryRun, FoundryStep, UsageEvent)
rayfin/functions/src/     function_app.ts (sync, connection test, knowledge), foundry.ts (mappings)
src/data/                 data contract, normalize(), synthetic + live providers
src/analytics/            stats, metrics, sequences (pure functions, tested)
src/pages/                Analytics, Agents, AgentDetail, RunSummary, Knowledge, Settings
src/ui.tsx                panels, cards, and inline SVG charts
```

## Usage telemetry

The app records basic usage so the workspace owner can see how it is used: who opened it, pages
viewed, and key actions (document added/removed, re-index, question asked, sync, agent saved or
deleted). Events are written to the app's own Fabric database (`UsageEvent`) and read back only by
the app — nothing leaves the tenant, and question text and document contents are never recorded.
Every signed-in user sees a footer notice; the owner views it in **Settings → Usage**.

The Inviso logo (`src/assets/inviso-logo.png`) is branding — replace that file to rebrand.

## Limitations

- Fabric Apps is a preview feature, available in limited regions.
- Any signed-in user can sync and manage knowledge documents; control access with Fabric item sharing.
- Foundry reports timing per run, not per step, so step-duration panels say so rather than show zeros.
- Live sync stores the most recent 1,000 Foundry runs per sync; times are shown in UTC.

## License

MIT. See [LICENSE](LICENSE). `src/auth.ts` and `src/AuthGate.tsx` are condensed from Microsoft's
MIT-licensed Rayfin universal-app template.
