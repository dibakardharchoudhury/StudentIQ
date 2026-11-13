import { afterEach, describe, expect, it, vi } from 'vitest';
import { ParentAuth, makeNonce } from './auth';

const config = {
  apiBaseUrl: 'https://api.example',
  tenantId: '11111111-1111-4111-8111-111111111111',
  clientId: '22222222-2222-4222-8222-222222222222',
  apiScope: 'api://example/access',
};
const idToken = `header.${btoa(JSON.stringify({ sub: 'student-subject' }))}.signature`;
const sessionToken = `s1.${'a'.repeat(43)}`;

afterEach(() => vi.unstubAllGlobals());

describe('social sign-in', () => {
  it('exchanges the provider assertion for an in-memory session and revokes it on sign-out', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: sessionToken, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const auth = new ParentAuth(config);
    await auth.initialize();
    const nonce = makeNonce();
    await auth.exchange('google', idToken, nonce);
    expect(await auth.token()).toBe(sessionToken);
    expect(auth.identityForSetup()).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ provider: 'google', idToken, nonce });
    await auth.signOut();
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${sessionToken}`);
    await expect(auth.token()).rejects.toThrow();
  });

  it('does not open a session when the backend rejects the account', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
    const auth = new ParentAuth(config);
    await auth.initialize();
    await expect(auth.exchange('google', idToken, makeNonce())).rejects.toThrow('not been approved');
    expect(auth.identityForSetup()).toEqual({ provider: 'google', subject: 'student-subject' });
    await expect(auth.token()).rejects.toThrow();
  });
});
