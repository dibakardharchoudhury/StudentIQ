import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExternalCalendars from './ExternalCalendars';
import { CalendarError, type CalendarConnection, type CalendarOccurrence } from './calendar-provider';
import { connectExternalCalendar, loadCalendarGoogleOAuth } from './calendar-oauth';
import { listCalendarOccurrences, listExternalCalendars } from './calendar-provider';

vi.mock('./calendar-oauth', async importOriginal => {
  const original = await importOriginal<typeof import('./calendar-oauth')>();
  return { ...original, connectExternalCalendar: vi.fn(), loadCalendarGoogleOAuth: vi.fn() };
});
vi.mock('./calendar-provider', async importOriginal => {
  const original = await importOriginal<typeof import('./calendar-provider')>();
  return { ...original, listExternalCalendars: vi.fn(), listCalendarOccurrences: vi.fn() };
});
const config = {
  apiBaseUrl: 'https://api.example', tenantId: '11111111-1111-4111-8111-111111111111',
  clientId: '22222222-2222-4222-8222-222222222222', apiScope: 'api://example/access',
  googleClientId: 'public.apps.googleusercontent.com', microsoftPersonalClientId: '33333333-3333-4333-8333-333333333333',
};
const props = { config, language: 'en' as const, online: true, year: 2026, month: 10 };
const occurrence: CalendarOccurrence = {
  id: 'fixture-event', title: 'Read-only fixture occurrence', allDay: true, start: '2026-11-03', end: '2026-11-04',
};
let connection: CalendarConnection;
beforeEach(() => {
  connection = { provider: 'google', accessToken: 'access-fixture', expiresAt: Date.now() + 60000,
    dispose: vi.fn(() => { connection.accessToken = ''; }) };
  vi.mocked(connectExternalCalendar).mockResolvedValue(connection);
  vi.mocked(loadCalendarGoogleOAuth).mockResolvedValue();
  vi.mocked(listExternalCalendars).mockResolvedValue([{ id: 'first', name: 'First fixture calendar' }, { id: 'second', name: 'Second fixture calendar' }]);
  vi.mocked(listCalendarOccurrences).mockResolvedValue([occurrence]);
});
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
async function connectGoogle() {
  const button = screen.getByRole('button', { name: 'Connect Google' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

describe('separate read-only calendar workspace', () => {
  it('does not pull child/social calendars automatically and explains absent configuration in both languages', async () => {
    const view = render(<ExternalCalendars {...props} config={undefined} />);
    expect(screen.getAllByText('Not connected')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Connect Google' })).toBeDisabled();
    expect(screen.getAllByText(/Not configured/)).toHaveLength(3);
    expect(connectExternalCalendar).not.toHaveBeenCalled();
    expect(listExternalCalendars).not.toHaveBeenCalled();
    view.rerender(<ExternalCalendars {...props} language="nb" config={undefined} />);
    expect(screen.getByRole('heading', { name: 'Eksterne kalendere · skrivebeskyttet' })).toBeInTheDocument();
    expect(screen.getAllByText(/Ikke konfigurert/)).toHaveLength(3);
  });
  it('shows all calendars separately, read-only occurrences, clear date window, and refreshes on month change', async () => {
    const view = render(<ExternalCalendars {...props} />);
    expect(listExternalCalendars).not.toHaveBeenCalled();
    await connectGoogle();
    await screen.findByRole('heading', { name: 'Second fixture calendar' });
    expect(connectExternalCalendar).toHaveBeenCalledWith(config, 'google');
    expect(screen.getAllByText(occurrence.title)).toHaveLength(2);
    expect(screen.getByText(/Visible month window/)).toHaveTextContent('start inclusive, end exclusive');
    expect(screen.getAllByText(/All day · calendar dates: 2026-11-03 → 2026-11-04 \(end exclusive\)/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const initialWindow = vi.mocked(listCalendarOccurrences).mock.calls[0][2];
    expect(new Date(initialWindow.start).getMonth()).toBe(10);
    view.rerender(<ExternalCalendars {...props} month={11} />);
    await waitFor(() => expect(listCalendarOccurrences).toHaveBeenCalledTimes(4));
    const nextWindow = vi.mocked(listCalendarOccurrences).mock.calls[2][2];
    expect(new Date(nextWindow.start).getMonth()).toBe(11);
    expect(listExternalCalendars).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh external calendars' }));
    await waitFor(() => expect(listExternalCalendars).toHaveBeenCalledTimes(3));
    await screen.findByRole('heading', { name: 'First fixture calendar' });
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Google' }));
    expect(screen.queryByText(occurrence.title)).not.toBeInTheDocument();
    expect(connection.dispose).toHaveBeenCalledOnce();
    expect(connection.accessToken).toBe('');
  });
  it('reports individual calendar failures without hiding another calendar, and clears on expiry', async () => {
    vi.mocked(listCalendarOccurrences).mockResolvedValueOnce([occurrence])
      .mockRejectedValueOnce(new CalendarError('pagination'));
    render(<ExternalCalendars {...props} />);
    await connectGoogle();
    await screen.findByText(occurrence.title);
    const second = screen.getByRole('region', { name: 'Second fixture calendar' });
    expect(within(second).getByRole('alert')).toHaveTextContent('Unsafe or invalid provider pagination');
    vi.mocked(listExternalCalendars).mockRejectedValueOnce(new CalendarError('expired'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh external calendars' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Calendar access expired');
    expect(screen.queryByText(occurrence.title)).not.toBeInTheDocument();
    expect(connection.dispose).toHaveBeenCalledOnce();
    expect(screen.getAllByText('Not connected')).toHaveLength(3);
  });
  it('aborts stale month responses and disconnect clears pending reads', async () => {
    let resolveOld!: (events: CalendarOccurrence[]) => void;
    vi.mocked(listCalendarOccurrences).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const view = render(<ExternalCalendars {...props} />);
    await connectGoogle();
    await waitFor(() => expect(listCalendarOccurrences).toHaveBeenCalledOnce());
    const oldSignal = vi.mocked(listCalendarOccurrences).mock.calls[0][3];
    view.rerender(<ExternalCalendars {...props} month={11} />);
    await screen.findByText('First fixture calendar');
    expect(oldSignal.aborted).toBe(true);
    await act(async () => resolveOld([{ ...occurrence, title: 'Stale old month' }]));
    expect(screen.queryByText('Stale old month')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Google' }));
    expect(screen.queryByText(occurrence.title)).not.toBeInTheDocument();
  });
  it('disposes late OAuth completion after cancellation and never fetches a calendar', async () => {
    let resolveConnection!: (value: CalendarConnection) => void;
    vi.mocked(connectExternalCalendar).mockImplementationOnce(() => new Promise(resolve => { resolveConnection = resolve; }));
    render(<ExternalCalendars {...props} />);
    await connectGoogle();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Google' }));
    await act(async () => resolveConnection(connection));
    expect(connection.dispose).toHaveBeenCalledOnce();
    expect(listExternalCalendars).not.toHaveBeenCalled();
    expect(screen.getAllByText('Not connected')).toHaveLength(3);
  });
  it('clears tokens on unmount and never fetches while offline', async () => {
    const view = render(<ExternalCalendars {...props} />);
    await connectGoogle();
    await screen.findByText('First fixture calendar');
    const requests = vi.mocked(listExternalCalendars).mock.calls.length;
    view.rerender(<ExternalCalendars {...props} online={false} />);
    expect(screen.queryByText(occurrence.title)).not.toBeInTheDocument();
    expect(listExternalCalendars).toHaveBeenCalledTimes(requests);
    view.unmount();
    expect(connection.dispose).toHaveBeenCalledOnce();
  });
  it('expires an idle connection without retaining calendar data or silently refreshing consent', async () => {
    vi.useFakeTimers();
    connection.expiresAt = Date.now() + 1000;
    render(<ExternalCalendars {...props} />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Connect Google' })); });
    expect(screen.getAllByText(occurrence.title)).toHaveLength(2);
    await act(async () => { vi.advanceTimersByTime(1001); });
    expect(screen.getByRole('alert')).toHaveTextContent('Calendar access expired');
    expect(screen.queryByText(occurrence.title)).not.toBeInTheDocument();
    expect(connection.dispose).toHaveBeenCalledOnce();
    expect(connectExternalCalendar).toHaveBeenCalledOnce();
  });
  it('reports the calendar-count cap instead of pretending the first calendars are the full result', async () => {
    vi.mocked(listExternalCalendars).mockResolvedValue(Array.from({ length: 101 }, (_, index) => ({ id: String(index), name: `Calendar ${index}` })));
    render(<ExternalCalendars {...props} />);
    await connectGoogle();
    expect(await screen.findByRole('alert')).toHaveTextContent('safety limit');
    expect(listCalendarOccurrences).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Calendar 0' })).not.toBeInTheDocument();
  });
});
