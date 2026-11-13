import {
  PublicClientApplication, InteractionRequiredAuthError, BrowserCacheLocation,
  type AccountInfo,
} from '@azure/msal-browser';
import type { AppConfig } from './config';

export class ParentAuth {
  private client: PublicClientApplication;
  private account: AccountInfo | null = null;
  private scopes: string[];
  constructor(config: AppConfig) {
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
  }
  async initialize() { await this.client.initialize(); }
  async signIn() {
    const result = await this.client.loginPopup({ scopes: this.scopes, prompt: 'select_account' });
    if (!result.account) throw new Error('Parent sign-in did not return an account.');
    this.account = result.account;
    this.client.setActiveAccount(result.account);
  }
  async token() {
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
