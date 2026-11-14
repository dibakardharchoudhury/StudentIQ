import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calendarMonthWindow, listCalendarOccurrences, listExternalCalendars, safeCalendarNextLink,
  type CalendarConnection,
} from './calendar-provider';

const signal = new AbortController().signal;
const connection = (provider: CalendarConnection['provider']): CalendarConnection => ({
  provider, accessToken: 'fixture-calendar-access', expiresAt: Date.now() + 60000, dispose() {},
});
const window = { start: '2026-11-01T00:00:00.000Z', end: '2026-12-01T00:00:00.000Z', timeZone: 'UTC' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());

describe('read-only provider calendars', () => {
  it('uses the entire local visible month, including the exclusive next-month boundary', () => {
    const result = calendarMonthWindow(2026, 10);
    expect(new Date(result.start).getFullYear()).toBe(2026);
    expect(new Date(result.start).getMonth()).toBe(10);
    expect(new Date(result.start).getDate()).toBe(1);
    expect(new Date(result.end).getMonth()).toBe(11);
    expect(new Date(result.end).getDate()).toBe(1);
    expect(new Date(calendarMonthWindow(1, 0).start).getFullYear()).toBe(1);
    expect(new Date(calendarMonthWindow(9999, 11).end).getFullYear()).toBe(10000);
  });
  it('loads all Google calendar and occurrence pages, includes hidden calendars, expands recurrences, and ignores cancellations', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ items: [{ id: 'one@example.test', summary: 'First' }], nextPageToken: 'opaque + / ?' }))
      .mockResolvedValueOnce(json({ items: [{ id: 'second', summary: 'Second' }] }))
      .mockResolvedValueOnce(json({ items: [
        { id: 'cancelled', status: 'cancelled' },
        { id: 'all-day', summary: 'Holiday', start: { date: '2026-11-05' }, end: { date: '2026-11-07' } },
      ], nextPageToken: 'events-next' }))
      .mockResolvedValueOnce(json({ items: [{
        id: 'occurrence-2', summary: 'Weekly', start: { dateTime: '2026-11-08T10:00:00+02:00' },
        end: { dateTime: '2026-11-08T11:00:00+02:00' },
      }] }));
    vi.stubGlobal('fetch', fetchMock);
    const account = connection('google');
    expect(await listExternalCalendars(account, signal)).toEqual([
      { id: 'one@example.test', name: 'First' }, { id: 'second', name: 'Second' },
    ]);
    const result = await listCalendarOccurrences(account, 'one@example.test', window, signal);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ title: 'Holiday', allDay: true, start: '2026-11-05', end: '2026-11-07' });
    expect(result[1].start).toBe('2026-11-08T10:00:00+02:00');
    const calendarUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calendarUrl.searchParams.get('showHidden')).toBe('true');
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('pageToken')).toBe('opaque + / ?');
    const eventUrl = new URL(fetchMock.mock.calls[2][0]);
    expect(eventUrl.pathname).toContain('one%40example.test');
    expect(eventUrl.searchParams.get('singleEvents')).toBe('true');
    expect(eventUrl.searchParams.get('showDeleted')).toBe('false');
    expect(eventUrl.searchParams.get('timeMin')).toBe(window.start);
    expect(eventUrl.searchParams.get('timeMax')).toBe(window.end);
    expect(new URL(fetchMock.mock.calls[3][0]).searchParams.get('pageToken')).toBe('events-next');
    expect(fetchMock.mock.calls.every(([, options]) => options.redirect === 'error'
      && options.credentials === 'omit' && options.cache === 'no-store')).toBe(true);
  });
  it('paginates Graph calendarView and interprets UTC timed events and all-day exclusive dates', async () => {
    const next = 'https://graph.microsoft.com/v1.0/me/calendars/shared/calendarView?$skiptoken=opaque';
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ value: [{
      id: 'timed', subject: 'Meeting', start: { dateTime: '2026-11-03T08:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-11-03T09:00:00.0000000', timeZone: 'UTC' }, isAllDay: false,
    }], '@odata.nextLink': next })).mockResolvedValueOnce(json({ value: [
      { id: 'deleted', isCancelled: true },
      { id: 'day', isAllDay: true, start: { dateTime: '2026-11-04T00:00:00', timeZone: 'UTC' },
        end: { dateTime: '2026-11-05T00:00:00', timeZone: 'UTC' } },
    ] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await listCalendarOccurrences(connection('microsoft-work'), 'shared', window, signal);
    expect(result).toHaveLength(2);
    expect(result[0].start).toBe('2026-11-03T08:00:00.0000000Z');
    expect(result[1]).toMatchObject({ start: '2026-11-04', end: '2026-11-05', allDay: true });
    expect(fetchMock.mock.calls[1][0]).toBe(next);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('startDateTime')).toBe(window.start);
    expect(fetchMock.mock.calls[0][1].headers.Prefer).toBe('outlook.timezone="UTC"');
  });
  it('enumerates Graph work and personal calendar pages instead of only the default calendar', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ value: [{ id: 'one', name: 'Work' }],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=next' }))
      .mockResolvedValueOnce(json({ value: [{ id: 'two', name: 'Shared' }] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await listExternalCalendars(connection('microsoft-work'), signal)).toEqual([
      { id: 'one', name: 'Work' }, { id: 'two', name: 'Shared' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValue(json({ value: [{ id: 'personal', name: 'Personal' }] }));
    expect(await listExternalCalendars(connection('microsoft-personal'), signal)).toEqual([{ id: 'personal', name: 'Personal' }]);
  });
  it('removes a cancelled duplicate occurrence and accepts an empty Google calendar response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ items: [{
        id: 'removed', start: { date: '2026-11-03' }, end: { date: '2026-11-04' },
      }], nextPageToken: 'next' }))
      .mockResolvedValueOnce(json({ items: [{ id: 'removed', status: 'cancelled' }] }))
      .mockResolvedValueOnce(json({}));
    vi.stubGlobal('fetch', fetchMock);
    expect(await listCalendarOccurrences(connection('google'), 'calendar', window, signal)).toEqual([]);
    expect(await listExternalCalendars(connection('google'), signal)).toEqual([]);
  });
  it.each([
    'https://evil.example/v1.0/me/calendars?$skip=1',
    'https://graph.microsoft.com/evil',
    'http://graph.microsoft.com/v1.0/me/calendars',
    'https://user:pass@graph.microsoft.com/v1.0/me/calendars',
    'https://graph.microsoft.com/v1.0/me/calendars#fragment',
    '/v1.0/me/calendars?$skip=1',
  ])('blocks unsafe pagination before another token-bearing fetch: %s', async next => {
    expect(() => safeCalendarNextLink(next, 'https://graph.microsoft.com/v1.0/me/calendars')).toThrow('pagination');
    const fetchMock = vi.fn().mockResolvedValue(json({ value: [], '@odata.nextLink': next }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listExternalCalendars(connection('microsoft-work'), signal)).rejects.toThrow('pagination');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('reports repeated pagination, row limits, provider errors, expiry, and unsupported offsetless dates', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ items: [], nextPageToken: 'repeat' })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listExternalCalendars(connection('google'), signal)).rejects.toThrow('limit');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValue(json({ value: Array.from({ length: 10001 }, () => ({ id: 'calendar' })) }));
    await expect(listExternalCalendars(connection('microsoft-personal'), signal)).rejects.toThrow('limit');
    fetchMock.mockResolvedValue(json({}, 403));
    await expect(listExternalCalendars(connection('google'), signal)).rejects.toThrow('consent');
    fetchMock.mockResolvedValue(json({}, 429));
    await expect(listExternalCalendars(connection('google'), signal)).rejects.toThrow('request');
    const expired = { ...connection('google'), expiresAt: 0 };
    fetchMock.mockClear();
    await expect(listExternalCalendars(expired, signal)).rejects.toThrow('expired');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(json({ items: [{ id: 'bad', start: { dateTime: '2026-11-04T10:00:00' } }] }));
    await expect(listCalendarOccurrences(connection('google'), 'one', window, signal)).rejects.toThrow('format');
  });
  it('does not silently truncate at the page cap even when every provider page is empty', async () => {
    let page = 0;
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ items: [], nextPageToken: String(++page) })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listExternalCalendars(connection('google'), signal)).rejects.toThrow('limit');
    expect(fetchMock).toHaveBeenCalledTimes(100);
  });
});
