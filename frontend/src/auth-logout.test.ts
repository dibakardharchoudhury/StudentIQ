import { afterEach, expect, it, vi } from 'vitest';
import { ParentAuth } from './auth';

const mocks = vi.hoisted(() => ({
  clearCache: vi.fn().mockResolvedValue(undefined),
  logoutPopup: vi.fn(), logoutRedirect: vi.fn(),
}));
vi.mock('@azure/msal-browser', async importOriginal => ({
  ...await importOriginal<typeof import('@azure/msal-browser')>(),
  PublicClientApplication: class {
    async initialize() {}
    async loginPopup() { return { account: { homeAccountId: 'fixture' } }; }
    setActiveAccount() {}
    clearCache = mocks.clearCache;
    logoutPopup = mocks.logoutPopup;
    logoutRedirect = mocks.logoutRedirect;
  },
}));
afterEach(() => vi.clearAllMocks());

it('signs the administrator out of StudentIQ without opening Microsoft logout or retaining API access', async () => {
  const auth = new ParentAuth({
    apiBaseUrl: 'https://test.example', tenantId: '11111111-1111-4111-8111-111111111111',
    clientId: '22222222-2222-4222-8222-222222222222', apiScope: 'api://fixture/access',
  });
  await auth.initialize();
  await auth.signIn();
  await auth.signOut();
  expect(mocks.clearCache).toHaveBeenCalledWith({ account: { homeAccountId: 'fixture' } });
  expect(mocks.logoutPopup).not.toHaveBeenCalled();
  expect(mocks.logoutRedirect).not.toHaveBeenCalled();
  await expect(auth.token()).rejects.toThrow('must sign in first');
});
