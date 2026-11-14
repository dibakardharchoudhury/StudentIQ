import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api, type LibraryEntry } from './api';
import QuestionLibrary from './QuestionLibrary';

const fetchMock = vi.fn<typeof fetch>();
const entries: LibraryEntry[] = [
  ...Array.from({ length: 13 }, (_, index): LibraryEntry => ({
    id: `maths-fixture-${index}`, subject: 'Maths', level: 1, goal: 'Count a group',
    question: `Counting fixture ${index}?`,
  })),
  { id: 'space-fixture', subject: 'Space', level: 2, goal: 'Explain an orbit', question: 'Orbit fixture?' },
];
const json = (data: unknown) => new Response(JSON.stringify(data));
const client = () => new Api({ apiBaseUrl: 'https://test.example', tenantId: '', clientId: '', apiScope: '' }, async () => 'fixture');
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('question library', () => {
  it('stops a stalled catalog wait and allows an explicit successful retry', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValueOnce(json({ version: 1, questions: entries }));
      const busy = vi.fn();
      render(<QuestionLibrary api={client()} language="en" active disabled={false} online onBusyChange={busy} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(screen.getByRole('alert')).toHaveTextContent('took too long');
      expect(busy).toHaveBeenLastCalledWith(false);
      const retry = screen.getByRole('button', { name: 'Reload the library' });
      expect(retry).toBeEnabled();
      await act(async () => { fireEvent.click(retry); });
      expect(screen.getByText('Counting fixture 0?')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });
  it('loads on first activation only, pages a bounded number of cards, and filters locally', async () => {
    fetchMock.mockResolvedValue(json({ version: 1, questions: entries }));
    const props = { api: client(), language: 'en' as const, disabled: false, online: true, onBusyChange: vi.fn() };
    const view = render(<QuestionLibrary {...props} active={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
    view.rerender(<QuestionLibrary {...props} active />);
    await screen.findByText('Counting fixture 0?');
    expect(screen.getAllByRole('article')).toHaveLength(12);
    fireEvent.click(screen.getByRole('button', { name: /Next page/ }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText(/14 matching questions/)).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Library subject'), { target: { value: 'Space' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Orbit fixture?')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Find a question or topic'), { target: { value: 'not in this library' } });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByText(/No matches/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    view.rerender(<QuestionLibrary {...props} active={false} />);
    view.rerender(<QuestionLibrary {...props} active />);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('starts the selected authored question only on demand, reveals a clue and trusts saved server grading', async () => {
    fetchMock.mockResolvedValueOnce(json({ version: 1, questions: [entries[0]] }))
      .mockResolvedValueOnce(json({ id: 'backend-q', source: 'library', libraryId: entries[0].id, level: 1,
        question: 'A server fixture?', options: ['A', 'B', 'C', 'D'], lesson: 'A server goal.' }))
      .mockResolvedValueOnce(json({ hint: 'A stored reasoning clue.' }))
      .mockResolvedValueOnce(json({ correct: false, correctIndex: 1, explanation: 'A stored explanation.' }))
      .mockResolvedValueOnce(json({ attempts: [{ id: 'backend-q', subject: 'Maths', question: 'A server fixture?',
        correct: false, at: '2026-11-14T12:00:00Z' }] }));
    render(<QuestionLibrary api={client()} language="en" active disabled={false} online onBusyChange={vi.fn()} />);
    const open = await screen.findByRole('button', { name: /Open question:/ });
    fireEvent.click(open);
    expect(fetchMock).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /Start this question/ }));
    await screen.findByText('A server fixture?');
    expect(fetchMock.mock.calls[1][0]).toBe('https://test.example/api/library/questions/maths-fixture-0');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', body: '{"language":"en"}', cache: 'no-store' });
    fireEvent.click(screen.getByRole('button', { name: 'Show a reasoning clue' }));
    expect(await screen.findByText('A stored reasoning clue.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check my choice' }));
    expect(await screen.findByText('A stored explanation.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Try this question again/ })).toBeEnabled());
    expect(screen.getByText('1 stored quiz attempts · 0 recorded correct')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url) === 'https://test.example/api/quiz' && init?.method === 'POST')).toBe(false);
  });

  it('surfaces expired access and clears stale catalog data instead of presenting a successful refresh', async () => {
    fetchMock.mockResolvedValueOnce(json({ version: 1, questions: [entries[0]] }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    render(<QuestionLibrary api={client()} language="en" active disabled={false} online onBusyChange={vi.fn()} />);
    await screen.findByText('Counting fixture 0?');
    fireEvent.click(screen.getByRole('button', { name: 'Reload the library' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('sign-in has expired');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
