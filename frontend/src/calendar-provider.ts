export type CalendarProvider = 'google' | 'microsoft-work' | 'microsoft-personal';
export type CalendarConnection = {
  provider: CalendarProvider;
  accessToken: string;
  expiresAt: number;
  dispose(): void;
};
export type ExternalCalendar = { id: string; name: string };
export type CalendarOccurrence = {
  id: string; title: string; start: string; end: string; allDay: boolean;
};
export type CalendarWindow = { start: string; end: string; timeZone: string };
export type CalendarFailure = 'consent' | 'expired' | 'request' | 'pagination' | 'limit' | 'format' | 'configuration';
export class CalendarError extends Error {
  constructor(public readonly code: CalendarFailure) { super(code); }
}

export function calendarMonthWindow(year: number, month: number): CalendarWindow {
  const date = new Date(0);
  date.setFullYear(year, month, 1);
  date.setHours(0, 0, 0, 0);
  const start = date.toISOString();
  date.setMonth(date.getMonth() + 1);
  return { start, end: date.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

type Json = Record<string, unknown>;
function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CalendarError('format');
  return value as Json;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new CalendarError('format');
  return value;
}
function optionalText(value: unknown): string | undefined {
  return value === undefined ? undefined : text(value);
}

// A nextLink is untrusted provider data. Never forward a bearer token to another
// origin, resource, redirect, or credential-bearing URL.
export function safeCalendarNextLink(next: string, initial: string): string {
  let url: URL;
  const expected = new URL(initial);
  try { url = new URL(next); } catch { throw new CalendarError('pagination'); }
  if (url.protocol !== 'https:' || url.origin !== expected.origin || url.pathname !== expected.pathname
    || url.username || url.password || url.hash) throw new CalendarError('pagination');
  return url.href;
}

async function pages(connection: CalendarConnection, initial: URL, signal: AbortSignal): Promise<Json[]> {
  const google = connection.provider === 'google';
  const rows: Json[] = [];
  const seen = new Set<string>();
  let next: string | undefined = initial.href;
  for (let page = 0; next; page++) {
    if (page >= 100 || seen.has(next)) throw new CalendarError('limit');
    seen.add(next);
    if (Date.now() >= connection.expiresAt || !connection.accessToken) throw new CalendarError('expired');
    const response = await fetch(safeCalendarNextLink(next, initial.href), {
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        ...(google ? {} : { Prefer: 'outlook.timezone="UTC"' }),
      },
      signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
    });
    if (!response.ok) throw new CalendarError(response.status === 401 ? 'expired'
      : response.status === 403 ? 'consent' : 'request');
    const body = object(await response.json());
    const values = body[google ? 'items' : 'value'] ?? (google ? [] : undefined);
    if (!Array.isArray(values)) throw new CalendarError('format');
    if (rows.length + values.length > 10000) throw new CalendarError('limit');
    rows.push(...values.map(object));
    const continuation = optionalText(body[google ? 'nextPageToken' : '@odata.nextLink']);
    if (continuation) {
      if (google) {
        const url = new URL(initial);
        url.searchParams.set('pageToken', continuation);
        next = url.href;
      } else next = safeCalendarNextLink(continuation, initial.href);
    } else next = undefined;
  }
  return rows;
}

export async function listExternalCalendars(connection: CalendarConnection, signal: AbortSignal): Promise<ExternalCalendar[]> {
  const url = new URL(connection.provider === 'google'
    ? 'https://www.googleapis.com/calendar/v3/users/me/calendarList'
    : 'https://graph.microsoft.com/v1.0/me/calendars');
  if (connection.provider === 'google') {
    url.searchParams.set('maxResults', '250');
    url.searchParams.set('showHidden', 'true');
    url.searchParams.set('fields', 'items(id,summary,summaryOverride),nextPageToken');
  } else {
    url.searchParams.set('$select', 'id,name');
    url.searchParams.set('$top', '100');
  }
  const result = await pages(connection, url, signal);
  const calendars = new Map<string, ExternalCalendar>();
  for (const row of result) {
    const id = text(row.id);
    calendars.set(id, {
      id,
      name: optionalText(connection.provider === 'google' ? row.summaryOverride ?? row.summary : row.name) || '—',
    });
  }
  return [...calendars.values()];
}

function googleTime(value: unknown): { value: string; allDay: boolean } {
  const time = object(value);
  if (typeof time.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(time.date)) return { value: time.date, allDay: true };
  const valueText = text(time.dateTime);
  // Calendar API supplies an RFC3339 offset; never interpret an offsetless value
  // in the browser's timezone.
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(valueText) || !Number.isFinite(Date.parse(valueText))) throw new CalendarError('format');
  return { value: valueText, allDay: false };
}
function microsoftTime(value: unknown, allDay: boolean): string {
  const time = object(value);
  const dateTime = text(time.dateTime);
  if (allDay) {
    if (!/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?(?:Z|[+-]00:00)?$/.test(dateTime)) throw new CalendarError('format');
    return dateTime.slice(0, 10);
  }
  const offset = /(Z|[+-]\d{2}:\d{2})$/i.test(dateTime);
  if (!offset && time.timeZone !== 'UTC' && time.timeZone !== 'Etc/UTC') throw new CalendarError('format');
  const result = offset ? dateTime : `${dateTime}Z`;
  if (!Number.isFinite(Date.parse(result))) throw new CalendarError('format');
  return result;
}

export async function listCalendarOccurrences(connection: CalendarConnection, calendarId: string,
  window: CalendarWindow, signal: AbortSignal): Promise<CalendarOccurrence[]> {
  const google = connection.provider === 'google';
  const id = encodeURIComponent(calendarId);
  const url = new URL(google ? `https://www.googleapis.com/calendar/v3/calendars/${id}/events`
    : `https://graph.microsoft.com/v1.0/me/calendars/${id}/calendarView`);
  if (google) {
    for (const [key, value] of Object.entries({
      timeMin: window.start, timeMax: window.end, timeZone: window.timeZone,
      singleEvents: 'true', showDeleted: 'false', orderBy: 'startTime', maxResults: '250',
      fields: 'items(id,summary,status,start,end),nextPageToken',
    })) url.searchParams.set(key, value);
  } else {
    for (const [key, value] of Object.entries({
      startDateTime: window.start, endDateTime: window.end, '$top': '250',
      '$select': 'id,subject,start,end,isAllDay,isCancelled',
    })) url.searchParams.set(key, value);
  }
  const rows = await pages(connection, url, signal);
  const result = new Map<string, CalendarOccurrence>();
  for (const row of rows) {
    if (google ? row.status === 'cancelled' : row.isCancelled === true) {
      result.delete(text(row.id));
      continue;
    }
    const start = google ? googleTime(row.start) : undefined;
    const end = google ? googleTime(row.end) : undefined;
    const allDay = google ? start!.allDay : row.isAllDay === true;
    const event: CalendarOccurrence = {
      id: text(row.id), title: optionalText(google ? row.summary : row.subject) || '—',
      start: google ? start!.value : microsoftTime(row.start, allDay),
      end: google ? end!.value : microsoftTime(row.end, allDay), allDay,
    };
    if (google && start!.allDay !== end!.allDay) throw new CalendarError('format');
    result.set(event.id, event);
  }
  return [...result.values()].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
