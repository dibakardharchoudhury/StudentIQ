import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { parseConfig } from './config';

const config = {
  apiBaseUrl: 'https://tutor.example.test', tenantId: '11111111-1111-4111-8111-111111111111',
  clientId: '22222222-2222-4222-8222-222222222222', apiScope: 'api://example/access',
};
const fixture = {
  id: 'test-session', subject: 'maths', language: 'en', updatedAt: '2026-11-13T10:00:00Z', summary: 'Test fixture',
};
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });

describe('backend adapter', () => {
  it('uses bearer authentication, no cookies and no HTTP cache', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ sessions: [fixture] })));
    const api = new Api(config, async () => 'test-only-access-token');
    expect(await api.sessions()).toEqual([fixture]);
    expect(fetchMock).toHaveBeenCalledWith('https://tutor.example.test/api/sessions', expect.objectContaining({
      headers: { Authorization: 'Bearer test-only-access-token', Accept: 'application/json' },
      cache: 'no-store', credentials: 'omit', redirect: 'error',
    }));
  });
  it('encodes session IDs and rejects a mismatched session', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'wrong', subject: 'maths', language: 'en', events: [] })));
    const api = new Api(config, async () => 'token');
    await expect(api.session('a/b?c')).rejects.toThrow('session ID does not match');
    expect(fetchMock.mock.calls[0][0]).toBe('https://tutor.example.test/api/sessions/a%2Fb%3Fc');
  });
  it.each([401, 403, 500])('never treats HTTP %i as success or echoes backend content', async status => {
    fetchMock.mockResolvedValue(new Response('private backend diagnostics', { status }));
    await expect(new Api(config, async () => 'token').sessions()).rejects.toThrow();
  });
  it('reports malformed contracts rather than returning an empty history', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ sessions: [{ ...fixture, language: 'no' }] })));
    await expect(new Api(config, async () => 'token').sessions()).rejects.toThrow('API contract error');
  });
  it('does not accept an invalid timestamp or non-JSON success', async () => {
    const api = new Api(config, async () => 'token');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ sessions: [{ ...fixture, updatedAt: 'yesterday' }] })));
    await expect(api.sessions()).rejects.toThrow('updatedAt');
    fetchMock.mockResolvedValueOnce(new Response('<html>Not an API</html>'));
    await expect(api.sessions()).rejects.toThrow('did not return JSON');
  });
  it('sends the exact chat contract and rejects a changed conversation ID', async () => {
    const api = new Api(config, async () => 'token');
    const input = { sessionId: 'existing', subject: 'science', language: 'nb' as const, message: 'Test question' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ sessionId: 'different', reply: 'Fixture reply' })));
    await expect(api.chat(input)).rejects.toThrow('different session ID');
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify(input));
  });
  it('does not send a request if authentication fails or the caller cancels during token acquisition', async () => {
    const controller = new AbortController();
    const api = new Api(config, async () => { controller.abort(); return 'token'; });
    await expect(api.sessions(controller.signal)).rejects.toThrow();
    await expect(new Api(config, async () => { throw new Error('Parent required'); }).sessions()).rejects.toThrow('Authentication failed or expired');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('runtime configuration', () => {
  it('fails closed for missing public setup and insecure/credentialed URLs', () => {
    expect(() => parseConfig({})).toThrow('Parent setup needed');
    for (const apiBaseUrl of ['http://example.test', 'https://user:password@example.test', 'https://example.test/?secret=value']) {
      expect(() => parseConfig({ ...config, apiBaseUrl })).toThrow('HTTPS URL');
    }
    expect(parseConfig({ ...config, apiBaseUrl: 'http://localhost:5000/' }).apiBaseUrl).toBe('http://localhost:5000');
  });

  describe('complete cursor-paginated history', () => {
    const json = (value: unknown) => new Response(JSON.stringify(value));
    const detail = { id: fixture.id, subject: 'maths', language: 'en' };
    const event = { id: 'event-1', role: 'user', text: 'First fixture event', at: fixture.updatedAt };

    it('collects all sessions, encodes opaque cursors, and deduplicates identical overlaps', async () => {
      const cursor = 'opaque+/=?&cursor=other#private';
      const second = { ...fixture, id: 'session-2', summary: 'Last page fixture' };
      fetchMock.mockResolvedValueOnce(json({ sessions: [fixture], nextCursor: cursor }))
        .mockResolvedValueOnce(json({ sessions: [], nextCursor: 'empty-page-continuation' }))
        .mockResolvedValueOnce(json({ sessions: [fixture, second], nextCursor: null }));
      expect(await new Api(config, async () => 'token').sessions()).toEqual([fixture, second]);
      expect(fetchMock.mock.calls[1][0]).toBe(`${config.apiBaseUrl}/api/sessions?${new URLSearchParams({ cursor })}`);
      expect(fetchMock.mock.calls[2][0]).toBe(`${config.apiBaseUrl}/api/sessions?cursor=empty-page-continuation`);
      for (const [, options] of fetchMock.mock.calls) {
        expect(options).toMatchObject({ cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer token' } });
      }
    });
    it('loads all conversation events in backend order without duplicate event IDs', async () => {
      const second = { ...event, id: 'event-2', role: 'assistant', text: 'Later fixture event' };
      fetchMock.mockResolvedValueOnce(json({ ...detail, events: [event], nextCursor: 'more/events' }))
        .mockResolvedValueOnce(json({ ...detail, events: [event, second] }));
      expect(await new Api(config, async () => 'token').session(fixture.id)).toEqual({ ...detail, events: [event, second] });
      expect(fetchMock.mock.calls[1][0]).toBe(`${config.apiBaseUrl}/api/sessions/${fixture.id}?cursor=more%2Fevents`);
    });
    it('rejects a later HTTP error instead of returning the successful prefix', async () => {
      fetchMock.mockResolvedValueOnce(json({ sessions: [fixture], nextCursor: 'second' }))
        .mockResolvedValueOnce(new Response('private diagnostics', { status: 500 }));
      await expect(new Api(config, async () => 'token').sessions()).rejects.toThrow('No partial result was returned.');
    });
    it('rejects a cursor cycle, including cycles through empty pages', async () => {
      fetchMock.mockResolvedValueOnce(json({ sessions: [fixture], nextCursor: 'a' }))
        .mockResolvedValueOnce(json({ sessions: [], nextCursor: 'b' }))
        .mockResolvedValueOnce(json({ sessions: [], nextCursor: 'a' }));
      await expect(new Api(config, async () => 'token').sessions()).rejects.toThrow('repeated a history cursor');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    it('fails explicitly at the page safety limit rather than silently truncating', async () => {
      let page = 0;
      fetchMock.mockImplementation(async () => json({ sessions: [], nextCursor: `unique-${++page}` }));
      await expect(new Api(config, async () => 'token').sessions()).rejects.toThrow('1,000-page safety limit');
      expect(fetchMock).toHaveBeenCalledTimes(1000);
    });
    it.each(['', 42])('rejects malformed continuation cursors (%s)', async nextCursor => {
      fetchMock.mockResolvedValueOnce(json({ sessions: [fixture], nextCursor }));
      await expect(new Api(config, async () => 'token').sessions()).rejects.toThrow('nextCursor');
    });
    it('validates later session metadata and conflicting duplicate event content', async () => {
      const api = new Api(config, async () => 'token');
      for (const secondPage of [
        { ...detail, language: 'nb', events: [] },
        { ...detail, id: 'wrong-session', events: [] },
        { ...detail, events: [{ ...event, text: 'Conflicting fixture version' }] },
      ]) {
        fetchMock.mockResolvedValueOnce(json({ ...detail, events: [event], nextCursor: 'more' }))
          .mockResolvedValueOnce(json(secondPage));
        await expect(api.session(fixture.id)).rejects.toThrow('No partial result was returned.');
      }
    });
    it('does not expose opaque cursors in diagnostics from a malformed later page', async () => {
      fetchMock.mockResolvedValueOnce(json({ sessions: [], nextCursor: 'private-cursor-value' }))
        .mockResolvedValueOnce(json({ invalid: true }));
      const error = await new Api(config, async () => 'token').sessions().catch(error => error);
      expect(error.message).toContain('API contract error');
      expect(error.message).not.toContain('private-cursor-value');
    });
    it('honors cancellation between pages without fetching or returning a partial history', async () => {
      const controller = new AbortController();
      let tokens = 0;
      const api = new Api(config, async () => { if (++tokens === 2) controller.abort(); return 'token'; });
      fetchMock.mockResolvedValueOnce(json({ sessions: [fixture], nextCursor: 'more' }));
      await expect(api.sessions(controller.signal)).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });
});
