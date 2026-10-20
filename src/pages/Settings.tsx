import { useEffect, useState } from 'react';
import type { AuthInfo } from '../AuthGate';
import type { AppClient } from '../data/live';
import type { AppFunctionsSchema } from '../../rayfin/functions/src/types';
import type { Recorder } from '../telemetry';
import { resetSettings, saveSettings, type Settings as SettingsT } from '../settings';
import { portalTemplates } from '../links';
import { fmtDate, fmtDateTime, fmtNum } from '../format';
import { Metric, Notice, PageHeader, Spinner, errorText } from '../ui';

interface Props {
  settings: SettingsT;
  onSaved: (settings: SettingsT) => void;
  auth: AuthInfo;
  onSynced: () => void;
  record: Recorder;
  onFoundryLinksChanged: () => void;
}

export function Settings({ settings, onSaved, auth, onSynced, record, onFoundryLinksChanged }: Props) {
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);
  const client = auth.kind === 'signed-in' ? auth.client : null;

  const setMode = (dataMode: SettingsT['dataMode']) => {
    setDraft({ ...draft, dataMode });
    setSaved(false);
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!saveSettings(draft).length) {
      onSaved(draft);
      setSaved(true);
    }
  };
  const reset = () => {
    const defaults = resetSettings();
    setDraft(defaults);
    onSaved(defaults);
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Connect to Microsoft Foundry and choose how this browser displays data." />

      <h2 className="group-title">Your account</h2>
      <section className="panel account" aria-label="Authentication">
        {auth.kind === 'signed-in' ? (
          <>
            <span>Signed in with Fabric single sign-on{auth.email ? <> as <strong>{auth.email}</strong></> : ''}.</span>
            <button type="button" onClick={() => void auth.signOut()}>Sign out</button>
          </>
        ) : (
          <span>Not signed in — local preview with synthetic data. Sign-in uses Fabric single sign-on in the deployed app.</span>
        )}
      </section>

      <h2 className="group-title">Shared with everyone using this app</h2>
      <LiveConnection client={client} onSynced={onSynced} record={record} />
      <FoundryLinks client={client} onChanged={onFoundryLinksChanged} />
      {client && <UsagePanel client={client} />}

      <h2 className="group-title">This browser</h2>
      <form onSubmit={save} className="panel" noValidate aria-label="Display settings">
        <fieldset>
          <legend>Data mode</legend>
          <label className="choice">
            <input type="radio" name="mode" checked={draft.dataMode === 'synthetic'} onChange={() => setMode('synthetic')} />
            <span><strong>Synthetic</strong> — packaged sample data, always available</span>
          </label>
          <label className="choice">
            <input type="radio" name="mode" disabled={!client} checked={draft.dataMode === 'live'} onChange={() => setMode('live')} />
            <span><strong>Live</strong> — Foundry data synced to this app's database</span>
          </label>
          {!client && <p className="meta">Live mode needs Fabric sign-in (the deployed app).</p>}
        </fieldset>
        <div className="actions">
          <button type="submit" className="primary">Save settings</button>
          <button type="button" onClick={reset}>Reset to deployment defaults</button>
          {saved && <span className="form-ok" role="status">Saved.</span>}
        </div>
      </form>
    </>
  );
}

function LiveConnection({ client, onSynced, record }: { client: AppClient | null; onSynced: () => void; record: Recorder }) {
  const [busy, setBusy] = useState<'test' | 'sync' | 'endpoint' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [hasSecret, setHasSecret] = useState(false);
  const [savedEndpoint, setSavedEndpoint] = useState('');
  const [identity, setIdentity] = useState<{ name: string; objectId: string; appId: string; kind: string } | null>(null);

  useEffect(() => {
    if (!client) return;
    client.functions.getFoundryEndpoint.invoke().then(
      (r) => { setEndpoint(r.endpoint); setSavedEndpoint(r.endpoint); setHasSecret(r.hasSecret); },
      () => {},
    );
    client.functions.foundryIdentity.invoke().then(setIdentity, () => {});
  }, [client]);

  const saveEndpoint = async () => {
    setBusy('endpoint');
    try {
      const r = await client!.functions.setFoundryEndpoint.invoke({ endpoint: endpoint.trim() });
      setResult({ ok: r.ok, text: r.message });
      if (r.ok) setSavedEndpoint(endpoint.trim());
    } catch (e) {
      setResult({ ok: false, text: errorText(e) });
    }
    setBusy(null);
  };

  const connected = Boolean(endpoint.trim() || hasSecret);

  const test = async () => {
    setBusy('test');
    try {
      const r = await client!.functions.testFoundryConnection.invoke();
      setResult({ ok: r.ok, text: r.ok ? `${r.message} Project: ${r.project}.` : r.message });
    } catch (e) {
      setResult({ ok: false, text: errorText(e) });
    }
    setBusy(null);
  };
  const sync = async () => {
    setBusy('sync');
    try {
      const r = await client!.functions.syncFoundry.invoke(undefined, { timeoutMs: 250_000 });
      setResult({
        ok: true,
        text: `Synced ${r.agents} agents and ${r.runsSaved} new or updated runs (${r.stepsSaved} steps); ${r.runsSkipped} finished runs were already stored.` +
          (r.partial ? ' More runs remain — select Sync again to continue.' : ''),
      });
      record('sync_run', `${r.runsSaved} runs saved`);
      onSynced();
    } catch (e) {
      setResult({ ok: false, text: errorText(e) });
    }
    setBusy(null);
  };

  return (
    <section className="panel" aria-label="Live connection">
      <h2>Live connection</h2>
      <p>
        Connect to your Microsoft Foundry project, then sync: it copies agents, runs, and their steps into this app's database,
        which Live mode reads from.
      </p>
      {!client ? <p className="meta">Available in the deployed app after Fabric sign-in.</p> : (
        <>
          <div className="field">
            <label htmlFor="foundry-endpoint">Foundry project endpoint</label>
            <div className="inline-form">
              <input
                id="foundry-endpoint"
                type="url"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://<account>.services.ai.azure.com/api/projects/<project>"
                aria-describedby="foundry-endpoint-hint"
              />
              <button type="button" onClick={() => void saveEndpoint()} disabled={busy !== null || endpoint.trim() === savedEndpoint}>
                {busy === 'endpoint' ? 'Saving…' : 'Save'}
              </button>
            </div>
            <small id="foundry-endpoint-hint">
              Copy it from your Foundry project's overview. Saved for the whole deployment.
              {hasSecret && !endpoint.trim() && ' A deployment secret is set and will be used until you enter one here.'}
            </small>
          </div>
          <div className="actions">
            <button type="button" onClick={() => void test()} disabled={busy !== null || !connected}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
            <button type="button" className="primary" onClick={() => void sync()} disabled={busy !== null || !connected}>{busy === 'sync' ? 'Syncing… (up to 4 min)' : 'Sync from Foundry'}</button>
          </div>
          {!connected && <p className="meta">Enter your Foundry project endpoint above to enable Test and Sync.</p>}
          {identity && (identity.objectId || identity.name) && (
            <details className="manage">
              <summary>App identity (grant this principal the Foundry + storage roles)</summary>
              <dl className="facts">
                <dt>Name</dt><dd>{identity.name || <span className="muted">—</span>} <span className="muted">({identity.kind})</span></dd>
                <dt>Object ID</dt><dd><code>{identity.objectId || '—'}</code></dd>
                <dt>App ID</dt><dd><code>{identity.appId || '—'}</code></dd>
              </dl>
              <p className="meta">
                This is the identity the app presents to Foundry. In the Foundry project, give it the <strong>Foundry User</strong> role; on the
                project's storage account, give it <strong>Storage Blob Data Contributor</strong> (uploads and indexing). Search by the Object ID in Azure RBAC.
              </p>
            </details>
          )}
        </>
      )}
      {result && <div className={`notice ${result.ok ? 'notice-info' : 'notice-error'}`} role="status">{result.text}</div>}
    </section>
  );
}

/** Deployment-wide "Open in Foundry" links. An admin pastes one portal link once; everyone gets it. */
function FoundryLinks({ client, onChanged }: { client: AppClient | null; onChanged: () => void }) {
  const [current, setCurrent] = useState<{ agent: string; index: string } | null>(null);
  const [link, setLink] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (client) client.functions.getFoundryLinks.invoke().then(setCurrent, () => {});
  }, [client]);

  const run = async (agent: string, index: string, ok: string) => {
    setBusy(true);
    try {
      await client!.functions.setFoundryLinks.invoke({ agent, index });
      setCurrent({ agent, index });
      setMessage({ ok: true, text: ok });
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    }
    setBusy(false);
  };
  const apply = () => {
    const t = portalTemplates(link);
    if (!t || !t.agent) {
      setMessage({ ok: false, text: 'Paste an agent link from your Foundry portal, for example https://ai.azure.com/…/build/agents/<name>/build.' });
      return;
    }
    setLink('');
    void run(t.agent, t.index, 'Saved for everyone on this deployment. Open in Foundry links are enabled.');
  };

  return (
    <section className="panel" aria-label="Open in Foundry links">
      <h2>Open in Foundry links</h2>
      <p className="definition">
        Deep links to the Foundry portal need your subscription and resource group, which the Foundry API does not expose.
        Paste one agent link from your portal and the app builds the pattern for every agent and knowledge index. Saved for the whole deployment.
      </p>
      {!client ? <p className="meta">Available in the deployed app after Fabric sign-in.</p> : (
        <>
          <p className="meta">{current === null ? 'Checking…' : current.agent ? 'Configured ✓ — links are enabled for everyone.' : 'Not configured — Open in Foundry buttons stay hidden until you add a link.'}</p>
          <div className="field">
            <label htmlFor="portal-link">Paste an agent link from the Foundry portal</label>
            <div className="inline-form">
              <input id="portal-link" type="url" value={link} onChange={(e) => { setLink(e.target.value); setMessage(null); }} placeholder="https://ai.azure.com/…/build/agents/…" />
              <button type="button" className="primary" onClick={apply} disabled={busy || !link.trim()}>Save</button>
            </div>
            <small>Open any agent in your Foundry portal and copy the browser address.</small>
          </div>
          {current?.agent && <button type="button" onClick={() => void run('', '', 'Cleared.')} disabled={busy}>Clear</button>}
          {message && <div className={`notice ${message.ok ? 'notice-info' : 'notice-error'}`} role="status">{message.text}</div>}
        </>
      )}
    </section>
  );
}

type Usage = AppFunctionsSchema['usageSummary']['output'];
const EVENT_LABELS: Record<string, string> = {
  app_opened: 'App opened', page_view: 'Page viewed', document_added: 'Document added', document_removed: 'Document removed',
  reindex: 'Re-indexed', question_asked: 'Question asked', sync_run: 'Sync run', agent_saved: 'Agent saved', agent_deleted: 'Agent deleted', other: 'Other',
};
const eventLabel = (type: string) => EVENT_LABELS[type] ?? type;

/** Owner-facing usage: who has used this app and what they did. Reads only this app's own events. */
function UsagePanel({ client }: { client: AppClient }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!show || usage) return;
    client.functions.usageSummary.invoke().then(setUsage, (e) => setError(errorText(e)));
  }, [show, usage, client]);

  return (
    <section className="panel usage" aria-label="Usage">
      <div className="panel-title">
        <h2>Usage</h2>
        <button type="button" onClick={() => setShow((v) => !v)} aria-expanded={show}>{show ? 'Hide' : 'Show usage'}</button>
      </div>
      <p className="meta">
        Who opens this app and which actions they take are recorded in this workspace's own database (never sent anywhere external) so you can
        see how it is used. Question text and document contents are never recorded. Everyone using the app sees a notice that usage is recorded.
      </p>
      {show && error && <Notice kind="error">{error}</Notice>}
      {show && !usage && !error && <p className="loading-line"><Spinner /> Loading usage…</p>}
      {show && usage && (usage.totalEvents === 0 ? <p>No usage recorded yet.</p> : (
        <>
          <div className="metrics">
            <Metric label="Events" value={fmtNum(usage.totalEvents)} definition="Recorded actions in total." />
            <Metric label="People" value={fmtNum(usage.uniqueUsers)} definition="Distinct signed-in users seen." />
            <Metric label="First seen" value={usage.firstAt ? fmtDate(usage.firstAt) : '—'} definition="Earliest recorded event." />
            <Metric label="Last seen" value={usage.lastAt ? fmtDateTime(usage.lastAt) : '—'} definition="Most recent recorded event." />
          </div>
          <div className="grid">
            <div>
              <h3>People</h3>
              <table>
                <thead><tr><th scope="col">User</th><th scope="col">Events</th><th scope="col">Last seen</th></tr></thead>
                <tbody>
                  {usage.byUser.slice(0, 25).map((u) => (
                    <tr key={u.user}><th scope="row">{u.user}</th><td>{fmtNum(u.count)}</td><td>{u.lastAt ? fmtDateTime(u.lastAt) : '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3>Actions</h3>
              <table>
                <thead><tr><th scope="col">Action</th><th scope="col">Count</th></tr></thead>
                <tbody>
                  {usage.byType.map((t) => <tr key={t.type}><th scope="row">{eventLabel(t.type)}</th><td>{fmtNum(t.count)}</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
          <h3>Recent activity</h3>
          <div className="table-scroll">
            <table>
              <thead><tr><th scope="col">When</th><th scope="col">User</th><th scope="col">Action</th><th scope="col">Detail</th></tr></thead>
              <tbody>
                {usage.recent.map((e, i) => (
                  <tr key={i}>
                    <td>{e.at ? fmtDateTime(e.at) : '—'}</td>
                    <td>{e.user}</td>
                    <td>{eventLabel(e.type)}{e.type === 'page_view' && e.detail ? `: ${e.detail}` : ''}</td>
                    <td>{e.type === 'page_view' ? '' : e.detail ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ))}
    </section>
  );
}
