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
  async signIn() {
    this.socialToken = null;
    this.socialExpires = 0;
    const result = await this.client.loginPopup({ scopes: this.scopes, prompt: 'select_account' });
    if (!result.account) throw new Error('Parent sign-in did not return an account.');
    this.account = result.account;
    this.client.setActiveAccount(result.account);
  }
  async signInMicrosoft(invitationCode?: string) {
    if (!this.personal) throw new Error('Microsoft personal sign-in is not configured.');
    const nonce = makeNonce();
    const result = await this.personal.loginPopup({ scopes: ['openid', 'profile', 'email'], prompt: 'select_account', nonce });
    await this.exchange('microsoft', result.idToken, nonce, invitationCode);
  }
  async exchange(provider: 'google' | 'microsoft', idToken: string, nonce: string, invitationCode?: string) {
    this.account = null;
    this.client.setActiveAccount(null);
    this.socialToken = null;
    this.socialExpires = 0;
    const response = await fetch(`${this.apiBaseUrl}/api/social/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, idToken, nonce, ...(invitationCode ? { invitationCode } : {}) }),
      cache: 'no-store', credentials: 'omit', redirect: 'error',
    });
    if (!response.ok) {
      if (response.status === 403) {
        const body: unknown = await response.json();
        if (body && typeof body === 'object' && 'code' in body && body.code === 'approval_required') {
          throw new Error('Your sign-in request was sent to the administrator. Ask them to approve your account in People & access, then sign in again.');
        }
        if (body && typeof body === 'object' && 'code' in body && body.code === 'invalid_invitation') {
          throw new Error('The access code is invalid, expired, or for a different account or sign-in provider. Check the code with your administrator, or remove it to send a sign-in request.');
        }
        throw new Error('This account is not allowed. Ask the administrator to check your access and the sign-in configuration.');
      }
      throw new Error('Social sign-in could not be verified. Please try again.');
    }
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || !('token' in value) || !('expiresAt' in value) ||
        typeof value.token !== 'string' || !/^s1\.[A-Za-z0-9_-]{43}$/.test(value.token) ||
        typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) {
      throw new Error('Social sign-in returned an invalid session.');
    }
    this.socialToken = value.token;
    this.socialExpires = Date.parse(value.expiresAt);
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
  }
}

export function makeNonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}
