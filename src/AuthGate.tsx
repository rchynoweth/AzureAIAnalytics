// Nothing renders until the user is signed in through Fabric, except the
// local-preview case defined by `allowsLocalPreview` (dev server, before deploy).

import { useEffect, useState, type ReactNode } from 'react';
import type { OpaqueSession } from '@microsoft/rayfin-auth';
import { allowsLocalPreview, type AuthService } from './auth';
import type { AppClient } from './data/live';

export type AuthInfo =
  | { kind: 'signed-in'; email: string | null; signOut: () => Promise<void>; client: AppClient | null }
  | { kind: 'local-preview' };

export function AuthGate({ service, children }: { service: AuthService; children: (auth: AuthInfo) => ReactNode }) {
  const [session, setSession] = useState<OpaqueSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const signedIn = session?.isAuthenticated === true && !session.isAnonymous;

  useEffect(() => {
    let cancelled = false;
    service
      .resolveSession()
      .then((s) => !cancelled && setSession(s))
      .catch(() => !cancelled && setError('Automatic sign-in did not complete.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [service]);

  useEffect(() => (signedIn ? service.onSessionChange(setSession) : undefined), [service, signedIn]);

  const signIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      setSession(await service.signIn());
    } catch {
      setError('Sign-in did not complete. Allow pop-ups for this site and try again.');
    } finally {
      setSigningIn(false);
    }
  };

  if (loading) return <Screen title="Connecting to Fabric…" />;
  if (signedIn) return <>{children({ kind: 'signed-in', email: session.user?.email ?? null, signOut: service.signOut, client: service.client })}</>;
  if (allowsLocalPreview(service.config, import.meta.env.DEV)) return <>{children({ kind: 'local-preview' })}</>;

  switch (service.config.kind) {
    case 'not-deployed':
      return <Screen title="This app is not deployed yet">Deploy it with <code>npm run deploy</code>, then reload.</Screen>;
    case 'incomplete':
      return <Screen title="This app is missing its Fabric configuration">Missing: {service.config.missing.join(', ')}. Deploy with <code>npm run deploy</code>, which supplies these values, then reload.</Screen>;
    case 'config-error':
      return <Screen title="Could not load this app's configuration">{service.config.message}</Screen>;
  }
  return (
    <Screen title="Sign in to Agent Behavior Intelligence">
      <p>Use your Microsoft account with access to this Fabric app.</p>
      {error && <p role="alert" className="field-error">{error}</p>}
      <button type="button" className="primary" disabled={signingIn} onClick={() => void signIn()}>
        {signingIn ? 'Signing in…' : 'Sign in with Microsoft'}
      </button>
    </Screen>
  );
}

function Screen({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="screen">
      <div className="panel">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
