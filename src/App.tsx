import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import invisoLogo from './assets/inviso-logo.png';
const PRODUCT_NAME = 'Agent Behavior Intelligence';
import type { AuthInfo } from './AuthGate';
import { createRecorder } from './telemetry';
import { WINDOWS, type WindowKey } from './analytics/metrics';
import { LiveUnavailableError, loadLive } from './data/live';
import type { Dataset } from './data/model';
import { fmtDateTime } from './format';
import { AgentDetail } from './pages/AgentDetail';
import { Agents } from './pages/Agents';
import { Analytics, isSubView, type SubView } from './pages/Analytics';
import { Knowledge } from './pages/Knowledge';
import { RunSummary } from './pages/RunSummary';
import { Settings } from './pages/Settings';
import { loadSettings, type Settings as SettingsT } from './settings';
import { ErrorBoundary, Notice } from './ui';
import { makeView } from './view';

type Load = { status: 'loading'; dataset?: Dataset } | { status: 'ready'; dataset: Dataset } | { status: 'error'; message: string };

const NAV = [
  { section: 'analytics', label: 'Analytics', to: '#/analytics' },
  { section: 'agents', label: 'Agents', to: '#/agents' },
  { section: 'knowledge', label: 'Knowledge', to: '#/knowledge' },
];

export function App({ auth }: { auth: AuthInfo }) {
  const [settings, setSettings] = useState<SettingsT>(loadSettings);
  const [windowKey, setWindowKey] = useState<WindowKey>('30d');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [section = 'analytics', id, sub, runId] = useRoute();
  const subView: SubView = section === 'analytics' && isSubView(id ?? '') ? (id as SubView) : 'summary';
  const client = auth.kind === 'signed-in' ? auth.client : null;
  const email = auth.kind === 'signed-in' ? auth.email : null;
  const record = useMemo(() => createRecorder(client, email), [client, email]);
  const pageKey = section === 'analytics' ? `analytics:${subView}` : section;

  // Deployment-wide Foundry portal link patterns (shared by all users, set once by an admin).
  const [foundryLinks, setFoundryLinks] = useState<{ agent: string; index: string } | null>(null);
  const [foundryDismissed, setFoundryDismissed] = useState(false);
  const loadFoundryLinks = useCallback(async () => {
    if (!client) { setFoundryLinks(null); return; }
    try { setFoundryLinks(await client.functions.getFoundryLinks.invoke()); } catch { /* leave null — falls back to env defaults */ }
  }, [client]);
  useEffect(() => { void loadFoundryLinks(); }, [loadFoundryLinks]);

  // Deployment config (server) wins; otherwise the build-time env defaults in `settings`.
  const effectiveSettings = useMemo<SettingsT>(() => ({
    ...settings,
    foundryAgentUrlTemplate: foundryLinks?.agent || settings.foundryAgentUrlTemplate,
    foundryIndexUrlTemplate: foundryLinks?.index || settings.foundryIndexUrlTemplate,
  }), [settings, foundryLinks]);

  // Record one app_opened per sign-in, then a page_view whenever the viewed page changes.
  useEffect(() => record('app_opened'), [record]);
  useEffect(() => record('page_view', pageKey), [record, pageKey]);

  const refresh = useCallback(async () => {
    setLoad((prev) => ({ status: 'loading', dataset: prev.status === 'ready' ? prev.dataset : undefined }));
    try {
      // Fixtures are loaded on demand so live deployments do not download them.
      const dataset = settings.dataMode === 'live' ? await loadLive(client) : (await import('./data/synthetic')).loadSynthetic();
      setLoad({ status: 'ready', dataset });
    } catch (error) {
      // Only our own sanitized message is shown; anything else gets a generic one.
      const message = error instanceof LiveUnavailableError ? error.message : 'Data could not be loaded. Try Refresh; if it continues, check Settings.';
      setLoad({ status: 'error', message });
    }
  }, [settings.dataMode, client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const dataset = load.status === 'error' ? undefined : load.dataset;
  const view = useMemo(() => (dataset ? makeView(dataset, effectiveSettings, windowKey) : null), [dataset, effectiveSettings, windowKey]);
  const needsFoundrySetup = auth.kind === 'signed-in' && foundryLinks !== null && !effectiveSettings.foundryAgentUrlTemplate;

  let page;
  if (section === 'knowledge') page = <Knowledge client={client} record={record} settings={effectiveSettings} />;
  else if (section === 'settings') page = (
    <Settings settings={settings} onSaved={setSettings} auth={auth} onSynced={() => void refresh()} record={record} onFoundryLinksChanged={loadFoundryLinks} />
  );
  else if (load.status === 'error') page = <Notice kind="error">{load.message} <a href="#/settings">Open Settings</a> to switch to Synthetic mode.</Notice>;
  else if (!view) page = <Notice kind="loading">Loading agent behavior data…</Notice>;
  else if (section === 'agents' && id && sub === 'runs' && runId) page = <RunSummary view={view} agentId={id} runId={runId} />;
  else if (section === 'agents' && id) page = <AgentDetail view={view} agentId={id} />;
  else if (section === 'agents') page = <Agents view={view} />;
  else if (section === 'analytics') page = <Analytics view={view} subView={subView} />;
  else page = <Notice kind="empty">Page not found. <a href="#/analytics">Go to Analytics</a></Notice>;

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      {dataset?.mode === 'synthetic' && (
        <div className="banner banner-synthetic" role="note">
          Synthetic sample data — generated for demonstration, not client data.
        </div>
      )}
      {auth.kind === 'local-preview' && (
        <div className="banner banner-preview" role="note">Local preview — not signed in. Deployed builds always require Fabric sign-in.</div>
      )}
      {needsFoundrySetup && !foundryDismissed && section !== 'settings' && (
        <div className="banner banner-warn" role="note">
          Finish setup: paste a Foundry portal link in <a href="#/settings">Settings</a> to enable “Open in Foundry” links for everyone.
          <button type="button" className="banner-dismiss" onClick={() => setFoundryDismissed(true)} aria-label="Dismiss">✕</button>
        </div>
      )}
      <header className="topbar">
        <a className="brand" href="#/analytics">
          <img className="brand-logo" src={invisoLogo} alt="Inviso" width={117} height={35} />
          {PRODUCT_NAME}
        </a>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <a key={n.section} href={n.to} aria-current={section === n.section ? 'page' : undefined}>{n.label}</a>
          ))}
        </nav>
        <span className={`mode mode-${settings.dataMode}`} title={dataset?.source_label}>
          {settings.dataMode === 'synthetic' ? 'Synthetic data' : 'Live · Foundry'}
        </span>
        <UserMenu email={email} active={section === 'settings'} onSignOut={auth.kind === 'signed-in' ? () => void auth.signOut() : undefined} />
      </header>
      {(section === 'analytics' || section === 'agents') && (
        // The analysis window and refresh apply to the analytics pages only.
        <div className="contextbar">
          <label>
            Window
            <select value={windowKey} onChange={(e) => setWindowKey(e.target.value as WindowKey)}>
              {Object.entries(WINDOWS).map(([key, w]) => <option key={key} value={key}>{w.label}</option>)}
            </select>
          </label>
          {dataset && <span className="muted">Source: {dataset.source_label}</span>}
          <span className="muted">Last refresh: {dataset ? fmtDateTime(dataset.loaded_at) : '—'}</span>
          <button type="button" onClick={() => void refresh()} disabled={load.status === 'loading'} aria-busy={load.status === 'loading'}>
            {load.status === 'loading' ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      )}
      <main id="main" aria-busy={load.status === 'loading'}>
        <ErrorBoundary key={`${section}/${id}/${runId}/${subView}`} message="This page could not be displayed. Try Refresh or another page.">
          {page}
        </ErrorBoundary>
      </main>
      <footer className="app-footer">
        {auth.kind === 'signed-in' ? (
          <p>Usage of this app — who opens it and key actions — is recorded in this workspace's own database so the owner can see how it is used. It is not sent anywhere else. The owner can view it in <a href="#/settings">Settings</a>.</p>
        ) : (
          <p>Local preview — not signed in.</p>
        )}
        <p>
          Built by <strong>Inviso Corporation</strong> · Bellevue, WA. Questions or need anything? Contact{' '}
          <a href="mailto:info@invisocorp.com">info@invisocorp.com</a> or <a href="mailto:rchynoweth@invisocorp.com">rchynoweth@invisocorp.com</a>.
        </p>
      </footer>
    </>
  );
}

/** Account avatar (first initial) with a dropdown to Settings and sign-out. */
function UserMenu({ email, active, onSignOut }: { email: string | null; active: boolean; onSignOut?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const initial = (email?.trim()[0] ?? '?').toUpperCase();
  return (
    <div className="user-menu" ref={ref} data-active={active}>
      <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={open} title={email ?? 'Account'} onClick={() => setOpen((v) => !v)}>
        {initial}
      </button>
      {open && (
        <div className="menu" role="menu">
          {email && <span className="menu-email" title={email}>{email}</span>}
          <a role="menuitem" href="#/settings" onClick={() => setOpen(false)}>Settings</a>
          {onSignOut && <button type="button" role="menuitem" onClick={() => { setOpen(false); onSignOut(); }}>Sign out</button>}
        </div>
      )}
    </div>
  );
}

/** Hash routes: #/, #/agents, #/agents/:id, #/agents/:id/runs/:runId, #/knowledge, #/settings */
function useRoute(): string[] {
  const read = () => {
    try {
      return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      return ['not-found'];
    }
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
