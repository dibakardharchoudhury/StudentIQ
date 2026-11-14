import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarProviderConfigured, connectExternalCalendar, googleCalendarScopes } from './calendar-oauth';

const msal = vi.hoisted(() => ({
  options: vi.fn(), initialize: vi.fn().mockResolvedValue(undefined), popup: vi.fn(), clearCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@azure/msal-browser', () => ({
  BrowserCacheLocation: { MemoryStorage: 'memoryStorage' },
  PublicClientApplication: class {
    constructor(options: unknown) { msal.options(options); }
    initialize = msal.initialize;
    acquireTokenPopup = msal.popup;
    clearCache = msal.clearCache;
  },
}));
const config = {
  apiBaseUrl: 'https://api.example', tenantId: '11111111-1111-4111-8111-111111111111',
  clientId: '22222222-2222-4222-8222-222222222222', apiScope: 'api://example/access',
  googleClientId: 'public.apps.googleusercontent.com', microsoftPersonalClientId: '33333333-3333-4333-8333-333333333333',
};
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('calendar-specific consent, never sign-in assertions', () => {
  it.each([
    ['microsoft-work', config.clientId, config.tenantId, 'Calendars.Read.Shared'],
    ['microsoft-personal', config.microsoftPersonalClientId, 'consumers', 'Calendars.ReadBasic'],
  ] as const)('uses separate memory-only %s OAuth with read-only scope and clears tokens on disconnect', async (provider, id, tenant, scope) => {
    msal.popup.mockResolvedValue({ accessToken: 'access-only', expiresOn: new Date(Date.now() + 60000), scopes: [scope] });
    const result = await connectExternalCalendar(config, provider);
    expect(msal.options).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({ clientId: id, authority: `https://login.microsoftonline.com/${tenant}` }),
      cache: { cacheLocation: 'memoryStorage', temporaryCacheLocation: 'memoryStorage', storeAuthStateInCookie: false },
    }));
    expect(msal.popup).toHaveBeenCalledWith({ scopes: [`https://graph.microsoft.com/${scope}`], prompt: 'consent' });
    expect(result.accessToken).toBe('access-only');
    result.dispose();
    expect(result.accessToken).toBe('');
    expect(msal.clearCache).toHaveBeenCalledOnce();
  });
  it('rejects a Microsoft sign-in response with only an ID token or missing calendar scopes', async () => {
    msal.popup.mockResolvedValue({ idToken: 'not-an-access-token', expiresOn: new Date(Date.now() + 60000), scopes: ['openid'] });
    await expect(connectExternalCalendar(config, 'microsoft-work')).rejects.toThrow('consent');
    expect(msal.clearCache).toHaveBeenCalledOnce();
  });
  it('requests Google account choice and explicit, granular read-only consent, rejecting partial grants', async () => {
    let response: { access_token?: string; scope?: string; expires_in?: number } = {
      access_token: 'google-calendar-access', scope: googleCalendarScopes.join(' '), expires_in: 60,
    };
    const request = vi.fn();
    const initialize = vi.fn(options => ({
      requestAccessToken: (optionsRequest: unknown) => { request(optionsRequest); options.callback(response); },
    }));
    vi.stubGlobal('google', { accounts: { oauth2: { initTokenClient: initialize } } });
    const result = await connectExternalCalendar(config, 'google');
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      client_id: config.googleClientId, include_granted_scopes: false, scope: googleCalendarScopes.join(' '),
    }));
    expect(request).toHaveBeenCalledWith({ prompt: 'select_account consent' });
    result.dispose();
    expect(result.accessToken).toBe('');
    response = { ...response, scope: googleCalendarScopes[0] };
    await expect(connectExternalCalendar(config, 'google')).rejects.toThrow('consent');
  });
  it('does not claim configured providers or request consent when configuration is absent', async () => {
    expect(calendarProviderConfigured(undefined, 'microsoft-work')).toBe(false);
    const noSocial = { ...config, googleClientId: undefined, microsoftPersonalClientId: undefined };
    expect(calendarProviderConfigured(noSocial, 'google')).toBe(false);
    expect(calendarProviderConfigured(noSocial, 'microsoft-personal')).toBe(false);
    await expect(connectExternalCalendar(noSocial, 'google')).rejects.toThrow('configuration');
    expect(msal.popup).not.toHaveBeenCalled();
  });
});
