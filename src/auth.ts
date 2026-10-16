// Fabric SSO through the Rayfin SDK. Condensed from the official Rayfin
// "universal app" template (MIT, Microsoft); the sign-in flow is unchanged:
// embedded Fabric handoff → stored session → refresh → Rayfin CLI sign-in (dev only).

import type { OpaqueSession } from '@microsoft/rayfin-auth';
import {
  ensureSignedInWithFabric,
  initEmbeddedAuth,
  signInWithBrokeredToken,
  type FabricAuthOptions,
} from '@microsoft/rayfin-auth-provider-fabric';
import { RayfinClient, resolveRayfinConfig } from '@microsoft/rayfin-client';
import type { AppClient } from './data/live';

/** Whether the app can authenticate, and if not, why. */
export type AuthConfig =
  | { kind: 'ready' }
  | { kind: 'not-deployed' } // no Fabric item yet: expected before the first `rayfin up`
  | { kind: 'incomplete'; missing: string[] }
  | { kind: 'config-error'; message: string };

export interface AuthService {
  config: AuthConfig;
  client: AppClient | null; // typed data + functions client; null until deployed
  resolveSession(): Promise<OpaqueSession | null>;
  signIn(): Promise<OpaqueSession>; // call from a click handler so the popup is allowed
  signOut(): Promise<void>;
  onSessionChange(listener: (session: OpaqueSession | null) => void): () => void;
}

/**
 * Synthetic data may be viewed without signing in only on the local Vite dev
 * server, and only before the app has a Fabric deployment. Production builds
 * (`import.meta.env.DEV === false`) always require Fabric sign-in.
 */
export function allowsLocalPreview(config: AuthConfig, isDev: boolean): boolean {
  return isDev && (config.kind === 'not-deployed' || config.kind === 'incomplete');
}

/** Never throws: configuration problems become an AuthConfig the gate can explain. */
export async function bootstrapAuth(): Promise<AuthService> {
  let client: AppClient;
  try {
    const resolved = await resolveRayfinConfig({
      apiUrl: import.meta.env.VITE_RAYFIN_API_URL,
      publishableKey: import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY,
      workspaceId: import.meta.env.VITE_FABRIC_WORKSPACE_ID,
      itemId: import.meta.env.VITE_FABRIC_ITEM_ID,
      portalUrl: import.meta.env.VITE_FABRIC_PORTAL_URL,
    });
    const missing = [!resolved.baseUrl && 'apiUrl', !resolved.publishableKey && 'publishableKey'].filter(Boolean) as string[];
    if (missing.length) return unavailable({ kind: 'incomplete', missing });
    client = new RayfinClient({
      baseUrl: resolved.baseUrl!,
      publishableKey: resolved.publishableKey!,
      authStorage: true,
      runtimeConfig: resolved.runtimeConfig,
    });
  } catch {
    // Fail closed. The SDK message may contain endpoint details, so it is not shown.
    return unavailable({ kind: 'config-error', message: 'The deployed app configuration could not be read. Redeploy, then reload.' });
  }

  const { workspaceId, itemId, portalUrl } = client.runtimeConfig ?? {};
  if (!workspaceId || !itemId || !portalUrl) return unavailable({ kind: 'not-deployed' });

  const auth = client.auth;
  const fabric: FabricAuthOptions = {
    workspaceId,
    projectId: itemId,
    fabricPortalUrl: portalUrl,
    returnOrigin: window.location.origin,
  };

  return {
    config: { kind: 'ready' },
    client,
    async resolveSession() {
      // Let the SDK classify the host before trusting any stored session.
      const embedded = await initEmbeddedAuth(auth, fabric);
      if (embedded) return embedded;
      const current = auth.getSession();
      if (current.isAuthenticated && !current.isAnonymous) return current;
      if (current.isAnonymous) await auth.signOut();
      if (auth.hasRefreshToken()) {
        try {
          await auth.refreshSession();
          const refreshed = auth.getSession();
          if (refreshed.isAuthenticated && !refreshed.isAnonymous) return refreshed;
        } catch {
          // Expired refresh token: fall through to the remaining silent paths.
        }
      }
      if (import.meta.env.DEV) {
        // Rayfin CLI sign-in brokerage; excluded from production bundles.
        const localDev = await import('@microsoft/rayfin-local-dev');
        if (localDev.isRayfinLocalAutoLoginEnabled()) {
          const token = await localDev.fetchRayfinLocalSessionToken();
          if (token) return signInWithBrokeredToken(auth, token);
        }
      }
      return null;
    },
    async signIn() {
      if (auth.getSession().isAnonymous) await auth.signOut();
      return ensureSignedInWithFabric(auth, fabric);
    },
    signOut: () => auth.signOut(),
    onSessionChange: (listener) => auth.onSessionChange(listener),
  };
}

function unavailable(config: AuthConfig): AuthService {
  return {
    config,
    client: null,
    resolveSession: async () => null,
    signIn: () => Promise.reject(new Error('Sign-in is unavailable until the app is deployed to Fabric.')),
    signOut: async () => {},
    onSessionChange: () => () => {},
  };
}
