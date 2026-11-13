import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Workspace } from './App';
import { Api, type Session } from './api';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

vi.mock('./Teacher', () => ({ default: () => <div>Animation test placeholder</div> }));
vi.mock('./speech', () => ({
  Speech: class {
    cancel = vi.fn();
    say = vi.fn();
  },
}));
const fixture: Session = {
  id: 'fixture-session', subject: 'maths', language: 'en', summary: 'Backend fixture summary', updatedAt: '2026-11-13T10:00:00Z',
};
async function setup(chat: ReturnType<typeof vi.fn>) {
  const api = {
    chat, sessions: vi.fn().mockResolvedValue([fixture]), session: vi.fn(),
    preferences: vi.fn().mockResolvedValue({ appearance: 'rose', voice: 'default', mood: 'gentle' }),
    pianoAttempts: vi.fn().mockResolvedValue([]), quizAttempts: vi.fn().mockResolvedValue([]),
  };
  render(<Workspace api={api as unknown as Api} initialSessions={[]} language="en" setLanguage={vi.fn()} online />);
  await waitFor(() => expect(screen.getByRole('button', { name: /New session/ })).toBeEnabled());
  return api;
}

describe('learning state', () => {
  it('keeps unsent text and does not invent a successful reply when the backend fails', async () => {
    await setup(vi.fn().mockRejectedValue(new Error('Service unavailable')));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'A test question' } });
    fireEvent.click(screen.getByRole('button', { name: /Send question/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
    expect(input).toHaveValue('A test question');
    expect(screen.queryByText('You', { selector: '.message-label' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send question/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh sessions' }));
    expect(await screen.findByText('Backend fixture summary')).toBeInTheDocument();
  });
  it('renders only the backend reply and uses its session ID on the next message', async () => {
    const chat = vi.fn().mockResolvedValue({ sessionId: 'server-session-id', reply: 'Verified backend test reply' });
    await setup(chat);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Question one' } });
    fireEvent.click(screen.getByRole('button', { name: /Send question/ }));
    expect(await screen.findByText('Verified backend test reply')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Question two' } });
    fireEvent.click(screen.getByRole('button', { name: /Send question/ }));
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(2));
    expect(chat.mock.calls[1][0]).toEqual({
      sessionId: 'server-session-id', subject: 'maths', language: 'en', message: 'Question two', mood: 'gentle',
    });
  });
  it('does not fabricate grades: progress is derived only from returned sessions', async () => {
    await setup(vi.fn());
    fireEvent.click(screen.getByRole('button', { name: /Progress/ }));
    expect(await screen.findByText('Sessions by subject')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('meter')).toHaveAttribute('value', '1'));
    expect(screen.getByText('Session counts describe activity, not ability. The service does not provide learning goals or lesson completion.')).toBeInTheDocument();
  });
  it('adds a visual question to the existing draft without submitting or inventing progress', async () => {
    const chat = vi.fn();
    const api = await setup(chat);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My existing question.' } });
    fireEvent.change(screen.getByLabelText('Equal parts (denominator)'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Filled parts (numerator)'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /Ask teacher about this fraction/ }));
    const draft = (screen.getByRole('textbox') as HTMLTextAreaElement).value;
    expect(draft).toContain('My existing question.\n\nI am exploring fractions.');
    expect(draft).toContain('3 of 8 equal parts filled (3/8)');
    expect(chat).not.toHaveBeenCalled();
    expect(api.sessions).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveFocus();
  });
  it('adds a subject-specific starter to the draft without sending, and keeps within the backend question limit', async () => {
    const chat = vi.fn();
    await setup(chat);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'My idea.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask me a question' }));
    expect((input as HTMLTextAreaElement).value).toContain('one question about Maths');
    expect(input).toHaveFocus();
    expect(chat).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'x'.repeat(1201) } });
    expect(screen.getByText(/at most 1,200 characters/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send question/ })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'x'.repeat(1190) } });
    fireEvent.click(screen.getByRole('button', { name: 'Give me a hint' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is too long');
    expect(input).toHaveValue('x'.repeat(1190));
    expect(chat).not.toHaveBeenCalled();
  });
  it('preserves a full draft instead of silently truncating it to add a visual question', async () => {
    const chat = vi.fn();
    await setup(chat);
    const text = 'x'.repeat(8000);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: /Ask teacher about this fraction/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is too long');
    expect(screen.getByRole('textbox')).toHaveValue(text);
    expect(chat).not.toHaveBeenCalled();
  });
  it('protects an unsent question when changing subjects or starting a new session', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await setup(vi.fn());
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Keep my question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Maths' }));
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Science' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(input).toHaveValue('Keep my question');
    expect(screen.getByRole('button', { name: 'Maths' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /New session/ }));
    expect(input).toHaveValue('Keep my question');
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Science' }));
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Science' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('does not open a saved session when discarding the draft is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const api = await setup(vi.fn());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep my question' } });
    fireEvent.click(screen.getByRole('button', { name: /Sessions/ }));
    const card = (await screen.findByText('Backend fixture summary')).closest('article')!;
    fireEvent.click(within(card).getByRole('button', { name: /Continue/ }));
    expect(api.session).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Learn/ }));
    expect(screen.getByRole('textbox')).toHaveValue('Keep my question');
  });
  it('retains the last complete snapshot and labels it stale when refresh fails', async () => {
    const api = await setup(vi.fn());
    fireEvent.click(screen.getByRole('button', { name: /Sessions/ }));
    await screen.findByText('Backend fixture summary');
    api.sessions.mockRejectedValue(new Error('History could not be fully loaded. No partial result was returned.'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh sessions' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Backend fixture summary')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(screen.getByText(/These are the last completely loaded results/)).toBeInTheDocument();
  });
  it('makes sessions and conversation events from later API pages visible', async () => {
    const finalSession = { ...fixture, id: 'later-session', summary: 'Later page session', subject: 'science' };
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input);
      const more = url.searchParams.has('cursor');
      if (url.pathname === '/api/preferences') return new Response(JSON.stringify({ appearance: 'rose', voice: 'default', mood: 'gentle' }));
      if (url.pathname === '/api/practice/piano' || url.pathname === '/api/quiz/attempts') return new Response(JSON.stringify({ attempts: [] }));
      const body = url.pathname.endsWith(`/${fixture.id}`)
        ? {
          id: fixture.id, subject: 'maths', language: 'en',
          events: [{
            id: more ? 'late-event' : 'early-event', role: more ? 'assistant' : 'user',
            text: more ? 'Event from the final page' : 'Event from the first page', at: fixture.updatedAt,
          }],
          ...(more ? {} : { nextCursor: 'more-events' }),
        }
        : { sessions: more ? [finalSession] : [fixture], ...(more ? {} : { nextCursor: 'more-sessions' }) };
      return new Response(JSON.stringify(body));
    }));
    const api = new Api({
      apiBaseUrl: 'https://test.example', tenantId: '', clientId: '', apiScope: '',
    }, async () => 'test-only-token');
    render(<Workspace api={api} initialSessions={[]} language="en" setLanguage={vi.fn()} online />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Sessions/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Sessions/ }));
    await screen.findByText('Later page session');
    const card = screen.getByText('Backend fixture summary').closest('article')!;
    fireEvent.click(within(card).getByRole('button', { name: /Continue/ }));
    expect(await screen.findByText('Event from the final page')).toBeInTheDocument();
    expect(screen.getByText('Event from the first page')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Conversation' })).toHaveAttribute('tabindex', '0');
    await waitFor(() => expect(screen.getByRole('button', { name: /Progress/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Progress/ }));
    await screen.findByText('Subjects explored');
    await waitFor(() => expect(screen.getByText('Saved sessions').closest('article')).toHaveTextContent('2'));
  });
  it('offers all requested subjects and a non-pressuring pause that retains the draft', async () => {
    await setup(vi.fn());
    for (const name of ['Maths', 'Norsk', 'Science', 'Current affairs', 'English', 'Geography', 'History', 'Piano', 'Other languages']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByText(/Your ideas are worth exploring/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Gentle encouragement (optional)'));
    expect(screen.getByText(/Your ideas are worth exploring/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep my question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Take a break' }));
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveValue('Keep my question');
    fireEvent.click(screen.getByRole('button', { name: 'Return when you feel ready' }));
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(screen.getByRole('textbox')).toHaveValue('Keep my question');
  });
});
