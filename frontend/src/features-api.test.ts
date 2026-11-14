import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';

const config = { apiBaseUrl: 'https://test.example', tenantId: '', clientId: '', apiScope: '' };
const fetchMock = vi.fn<typeof fetch>();
const json = (value: unknown) => new Response(JSON.stringify(value));
const at = '2026-11-13T10:00:00Z';
const api = () => new Api(config, async () => 'test-only-token');
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('backend roles, planning and preferences', () => {
  it('binds email approval to a selected request and refuses student administrator grants', async () => {
    const input = { provider: 'microsoft' as const, requestId: 'a'.repeat(64), email: 'person@example.com', role: 'parent' as const, admin: true };
    fetchMock.mockResolvedValue(new Response('{}'));
    await api().saveSocialAccount(input);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual(input);
    await expect(api().saveSocialAccount({ ...input, role: 'student' })).rejects.toThrow('Administrator rights');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('validates roles and never infers admin from an unknown role', async () => {
    fetchMock.mockResolvedValueOnce(json({ role: 'admin' })).mockResolvedValueOnce(json({ role: 'owner' }));
    expect(await api().me()).toEqual({ role: 'admin' });
    await expect(api().me()).rejects.toThrow('API contract error');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store', headers: { Authorization: 'Bearer test-only-token' } });
  });
  it('supports bodyless mutation responses, exact reminder payloads and encoded deletion IDs', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const client = api();
    const update = { id: 'item/1', title: 'Read a map', date: '2026-11-14', completed: true };
    await client.saveReminder(update);
    await client.deleteReminder('item/1');
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual(update);
    expect(fetchMock.mock.calls[1]).toEqual([
      'https://test.example/api/planning/reminders/item%2F1', expect.objectContaining({ method: 'DELETE', cache: 'no-store', credentials: 'omit' }),
    ]);
  });
  it('rejects invalid calendar dates and duplicate planning IDs instead of showing invented items', async () => {
    fetchMock.mockResolvedValueOnce(json({ reminders: [{ id: '1', title: 'Fixture', date: '2026-02-30', completed: false }] }));
    await expect(api().reminders()).rejects.toThrow('API contract error');
    const item = { id: '1', title: 'Fixture', date: '2026-11-14', completed: false };
    fetchMock.mockResolvedValueOnce(json({ reminders: [item, item] }));
    await expect(api().reminders()).rejects.toThrow('duplicate IDs');
  });
  it('PUTs exactly the canonical preference enums, then reads persisted preferences before returning success', async () => {
    const preferences = { appearance: 'mint', voice: 'alternate', mood: 'calm' } as const;
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(json(preferences));
    expect(await api().savePreferences(preferences)).toEqual(preferences);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: JSON.stringify(preferences) });
    expect(fetchMock.mock.calls[1][0]).toBe('https://test.example/api/preferences');
    fetchMock.mockResolvedValueOnce(json({ ...preferences, appearance: 'blue' }));
    await expect(api().preferences()).rejects.toThrow('appearance');
  });
});

describe('piano and quiz contracts', () => {
  it('uses only backend piano grading and traverses stored attempt pages', async () => {
    const attempt = { id: 'attempt-1', targetNote: 'C4', selectedNote: 'C4', correct: false, at };
    fetchMock.mockResolvedValueOnce(json({ correct: false }))
      .mockResolvedValueOnce(json({ attempts: [attempt], nextCursor: 'page/2' }))
      .mockResolvedValueOnce(json({ attempts: [{ ...attempt, id: 'attempt-2' }] }));
    expect(await api().pianoPractice({ targetNote: 'C4', selectedNote: 'C4' })).toEqual({ correct: false });
    expect(await api().pianoAttempts()).toHaveLength(2);
    expect(fetchMock.mock.calls[2][0]).toBe('https://test.example/api/practice/piano?cursor=page%2F2');
  });
  it('requires four quiz options and rejects contradictory grading', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'quiz', question: 'Fixture?', options: ['a', 'b', 'c'] }));
    await expect(api().quiz('geography', 'en')).rejects.toThrow('options');
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ subject: 'geography', language: 'en', supportsNumberLine: true });
    fetchMock.mockResolvedValueOnce(json({ correct: true, correctIndex: 2, explanation: 'Fixture' }));
    await expect(api().answerQuiz('quiz/1', 0)).rejects.toThrow('contradicts');
    expect(fetchMock.mock.calls[1][0]).toBe('https://test.example/api/quiz/quiz%2F1/answer');
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({ answerIndex: 0 });
  });
  it('rejects unsupported or oversized visual scenes instead of rendering them', async () => {
    const base = { id: 'quiz', question: 'Fixture?', options: ['a', 'b', 'c', 'd'] };
    fetchMock.mockResolvedValueOnce(json({ ...base, visual: { kind: 'array', rows: 9, columns: 2, icon: 'star' } }));
    await expect(api().quiz('maths', 'en')).rejects.toThrow('visual');
    fetchMock.mockResolvedValueOnce(json({ ...base, visual: { kind: 'cards', style: 'timeline', items: ['One', 'Two'], html: '<script>' } }));
    await expect(api().quiz('history', 'en')).rejects.toThrow('visual');
  });
  it('loads all persisted quiz attempts without silently returning a failed prefix', async () => {
    const attempt = { id: 'quiz-attempt', subject: 'geography', question: 'Fixture?', correct: true, at };
    fetchMock.mockResolvedValueOnce(json({ attempts: [attempt], nextCursor: 'next' }))
      .mockResolvedValueOnce(json({ attempts: [{ ...attempt, id: 'quiz-attempt-2', correct: false }] }));
    const result = await api().quizAttempts();
    expect(result).toHaveLength(2);
    expect(result.filter(item => item.correct)).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(json({ attempts: [attempt], nextCursor: 'next' }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(api().quizAttempts()).rejects.toThrow('No partial result');
  });
});
