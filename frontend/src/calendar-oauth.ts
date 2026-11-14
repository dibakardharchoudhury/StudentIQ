import { BrowserCacheLocation, PublicClientApplication } from '@azure/msal-browser';
import type { AppConfig } from './config';
import { CalendarError, type CalendarConnection, type CalendarProvider } from './calendar-provider';

export const googleCalendarScopes = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
];
export function calendarProviderConfigured(config: AppConfig | undefined, provider: CalendarProvider): boolean {
  return !!(provider === 'google' ? config?.googleClientId : provider === 'microsoft-personal'
    ? config?.microsoftPersonalClientId : config?.clientId && config?.tenantId);
}
type GoogleOAuth = {
  initTokenClient(options: {
    client_id: string; scope: string; include_granted_scopes: boolean;
    callback(response: { access_token?: string; expires_in?: number; scope?: string; error?: string }): void;
    error_callback(): void;
  }): { requestAccessToken(options: { prompt: string }): void };
};
function googleOAuth(): GoogleOAuth | undefined {
  // Keep the OAuth API separate from the ID-token-only GoogleSignIn type.
  return (window as unknown as { google?: { accounts?: { oauth2?: GoogleOAuth } } }).google?.accounts?.oauth2;
}
let googleLoading: Promise<void> | undefined;
export function loadCalendarGoogleOAuth(): Promise<void> {
  if (googleOAuth()) return Promise.resolve();
  if (googleLoading) return googleLoading;
  googleLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    const script = existing || document.createElement('script');
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
      if (ok) resolve();
      else { if (!existing) script.remove(); reject(new CalendarError('configuration')); }
    };
    const loaded = () => finish(!!googleOAuth());
    const failed = () => finish(false);
    const timer = window.setTimeout(failed, 15000);
    script.addEventListener('load', loaded);
    script.addEventListener('error', failed);
    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch(error => { googleLoading = undefined; throw error; });
  return googleLoading;
}

export async function connectExternalCalendar(config: AppConfig, provider: CalendarProvider): Promise<CalendarConnection> {
  if (!calendarProviderConfigured(config, provider)) throw new CalendarError('configuration');
  if (provider === 'google') {
    const oauth = googleOAuth();
    if (!oauth) throw new CalendarError('configuration');
    return new Promise((resolve, reject) => {
      const client = oauth.initTokenClient({
        client_id: config.googleClientId!, scope: googleCalendarScopes.join(' '),
        include_granted_scopes: false,
        callback: response => {
          const granted = new Set(response.scope?.split(' '));
          if (response.error || !response.access_token || !googleCalendarScopes.every(scope => granted.has(scope))
            || !response.expires_in || !Number.isFinite(response.expires_in)
            || response.expires_in <= 0 || response.expires_in > 86400) { reject(new CalendarError('consent')); return; }
          const connection: CalendarConnection = {
            provider, accessToken: response.access_token, expiresAt: Date.now() + response.expires_in * 1000,
            dispose() { connection.accessToken = ''; },
          };
          resolve(connection);
        },
        error_callback: () => reject(new CalendarError('consent')),
      });
      client.requestAccessToken({ prompt: 'select_account consent' });
    });
  }
  const personal = provider === 'microsoft-personal';
  const scope = personal ? 'Calendars.ReadBasic' : 'Calendars.Read.Shared';
  const client = new PublicClientApplication({
    auth: {
      clientId: personal ? config.microsoftPersonalClientId! : config.clientId,
      authority: `https://login.microsoftonline.com/${personal ? 'consumers' : config.tenantId}`,
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
  try {
    await client.initialize();
    const result = await client.acquireTokenPopup({
      scopes: [`https://graph.microsoft.com/${scope}`], prompt: 'consent',
    });
    const expiresAt = result.expiresOn?.getTime();
    const acceptedScopes = [scope.toLowerCase(), `https://graph.microsoft.com/${scope}`.toLowerCase()];
    if (!result.accessToken || !expiresAt || !Number.isFinite(expiresAt) || expiresAt <= Date.now()
      || !result.scopes.some(value => acceptedScopes.includes(value.toLowerCase()))) throw new CalendarError('consent');
    const connection: CalendarConnection = {
      provider, accessToken: result.accessToken, expiresAt,
      dispose() { connection.accessToken = ''; void client.clearCache().catch(() => {}); },
    };
    return connection;
  } catch {
    await client.clearCache().catch(() => {});
    throw new CalendarError('consent');
  }
}
