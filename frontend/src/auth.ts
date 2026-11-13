import {
  PublicClientApplication, InteractionRequiredAuthError, BrowserCacheLocation,
  type AccountInfo,
} from '@azure/msal-browser';
import type { AppConfig } from './config';

export class ParentAuth {
  private client: PublicClientApplication;
  private personal?: PublicClientApplication;
  private account: AccountInfo | null = null;
  private socialToken: string | null = null;
  private socialExpires = 0;
  private apiBaseUrl: string;
  private pendingIdentity: { provider: string; subject: string } | null = null;
  private scopes: string[];
  constructor(config: AppConfig) {
    this.apiBaseUrl = config.apiBaseUrl;
    this.scopes = [config.apiScope];
    this.client = new PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        redirectUri: new URL(`${import.meta.env.BASE_URL}auth.html`, window.location.origin).href,
        navigateToLoginRequestUrl: false,
      },
      cache: {
        cacheLocation: BrowserCacheLocation.MemoryStorage,
        temporaryCacheLocation: BrowserCacheLocation.MemoryStorage,
        storeAuthStateInCookie: false,
      },
      system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } },
    });
    if (config.microsoftPersonalClientId) {
      this.personal = new PublicClientApplication({
        auth: {
          clientId: config.microsoftPersonalClientId,
          authority: 'https://login.microsoftonline.com/consumers',
          redirectUri: new URL(`${import.meta.env.BASE_URL}auth.html`, window.location.origin).href,
          navigateToLoginRequestUrl: false,
        },
        cache: { cacheLocation: BrowserCacheLocation.MemoryStorage, temporaryCacheLocation: BrowserCacheLocation.MemoryStorage },
        system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } },
      });
    }
  }
  async initialize() {
    await this.client.initialize();
    if (this.personal) await this.personal.initialize();
  }
  identityForSetup() { return this.pendingIdentity; }
  async signIn() {
    this.pendingIdentity = null;
    this.socialToken = null;
    this.socialExpires = 0;
    const result = await this.client.loginPopup({ scopes: this.scopes, prompt: 'select_account' });
    if (!result.account) throw new Error('Parent sign-in did not return an account.');
    this.account = result.account;
    this.client.setActiveAccount(result.account);
  }
  async signInMicrosoft() {
    if (!this.personal) throw new Error('Microsoft personal sign-in is not configured.');
    this.pendingIdentity = null;
    const nonce = makeNonce();
    const result = await this.personal.loginPopup({ scopes: ['openid', 'profile', 'email'], prompt: 'select_account', nonce });
    await this.exchange('microsoft', result.idToken, nonce);
  }
  async exchange(provider: 'google' | 'microsoft', idToken: string, nonce: string) {
    this.account = null;
    this.client.setActiveAccount(null);
    this.pendingIdentity = null;
    this.pendingIdentity = { provider, subject: readSubject(idToken) };
    const response = await fetch(`${this.apiBaseUrl}/api/social/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, idToken, nonce }),
      cache: 'no-store', credentials: 'omit', redirect: 'error',
    });
    if (!response.ok) throw new Error(response.status === 403
      ? 'This account has not been approved by the parent.'
      : 'Social sign-in could not be verified. Please try again.');
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || !('token' in value) || !('expiresAt' in value) ||
        typeof value.token !== 'string' || !/^s1\.[A-Za-z0-9_-]{43}$/.test(value.token) ||
        typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) {
      throw new Error('Social sign-in returned an invalid session.');
    }
    this.socialToken = value.token;
    this.socialExpires = Date.parse(value.expiresAt);
    this.pendingIdentity = null;
  }
  async token() {
    if (this.socialToken) {
      if (Date.now() >= this.socialExpires) throw new Error('Sign-in expired. Sign out and sign in again.');
      return this.socialToken;
    }
    if (!this.account) throw new Error('A parent must sign in first.');
    try {
      const result = await this.client.acquireTokenSilent({ account: this.account, scopes: this.scopes });
      return result.accessToken;
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        throw new Error('Parent sign-in needs attention. Sign out, then sign in again.');
      }
      throw new Error('Could not obtain an API access token. Please sign in again.');
    }
  }
  async signOut() {
    this.pendingIdentity = null;
    if (this.socialToken) {
      const token = this.socialToken;
      this.socialToken = null;
      this.socialExpires = 0;
      if (this.personal) await this.personal.clearCache();
      const response = await fetch(`${this.apiBaseUrl}/api/social/logout`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store', credentials: 'omit', redirect: 'error',
      });
      if (!response.ok && response.status !== 401) throw new Error('Session revocation failed.');
      return;
    }
    const account = this.account;
    this.account = null;
    this.client.setActiveAccount(null);
    await this.client.clearCache({ account: account ?? undefined });
    // End the provider session as well; the app clears its data before opening this popup.
    if (account) {
      await this.client.logoutPopup({
        account,
        postLogoutRedirectUri: new URL(`${import.meta.env.BASE_URL}auth.html`, window.location.origin).href,
      });
    }
  }

}

export function makeNonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function readSubject(token: string): string {
  const part = token.split('.')[1];
  if (!part) throw new Error('Sign-in returned an invalid identity token.');
  try {
    const payload: unknown = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload && typeof payload === 'object' && 'sub' in payload &&
        typeof payload.sub === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(payload.sub)) return payload.sub;
  } catch {
    throw new Error('Sign-in returned an invalid identity token.');
  }
  throw new Error('Sign-in returned no usable account identifier.');
}
