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
  it('creates preapprovals without a request and requires an actual one-time code in the response', async () => {
    const input = { provider: 'microsoft' as const, email: 'person@example.com', role: 'parent' as const, admin: true };
    fetchMock.mockResolvedValueOnce(json({ invitationCode: 'a'.repeat(32) })).mockResolvedValueOnce(json({}));
    expect(await api().saveSocialAccount(input)).toEqual({ invitationCode: 'a'.repeat(32) });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual(input);
    await expect(api().saveSocialAccount(input)).rejects.toThrow('API contract error');
  });
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
  it('loads durable UTC lessons and validates grading without an automatic answer retry', async () => {
    const lesson = { date: '2026-11-16', timeZone: 'UTC', subject: 'Maths', language: 'en',
      completed: 0, target: 10, current: { id: 'quiz', question: 'A fixture?', options: ['A', 'B', 'C', 'D'] }, answer: null };
    fetchMock.mockResolvedValueOnce(json(lesson)).mockResolvedValueOnce(json(lesson));
    const client = api();
    expect(await client.dailyLesson('maths', 'en')).toEqual(lesson);
    expect(fetchMock.mock.calls[0][0]).toBe('https://test.example/api/lessons/daily?subject=maths&language=en');
    expect(await client.nextLessonQuestion('maths', 'en')).toEqual(lesson);
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({ subject: 'maths', language: 'en', supportsNumberLine: true });
    const result = { correct: true, correctIndex: 0, explanation: 'A saved explanation.' };
    const graded = { ...lesson, completed: 1, answer: { ...result, answerIndex: 0 } };
    fetchMock.mockResolvedValueOnce(json({ result, lesson: graded }));
    expect(await client.answerLesson('maths', 'en', lesson.date, 'quiz', 0)).toEqual({ result, lesson: graded });
    expect(JSON.parse(fetchMock.mock.calls[2][1]!.body as string)).toEqual({
      subject: 'maths', language: 'en', date: lesson.date, quizId: 'quiz', answerIndex: 0
    });
    fetchMock.mockRejectedValueOnce(new Error('Lost response'));
    await expect(client.answerLesson('maths', 'en', lesson.date, 'quiz', 0)).rejects.toThrow('Cannot reach');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    fetchMock.mockResolvedValueOnce(json({ ...graded, answer: { ...graded.answer, correctIndex: 1 } }));
    await expect(client.dailyLesson('maths', 'en')).rejects.toThrow('API contract error');
    fetchMock.mockResolvedValueOnce(json({ ...lesson, completed: -1 }));
    await expect(client.dailyLesson('maths', 'en')).rejects.toThrow('API contract error');
  });
  it('distinguishes unavailable generation from an unsupported subject without exposing backend diagnostics', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      category: 'model', error: 'PRIVATE diagnostic must not be echoed',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    await expect(api().quiz('space', 'en')).rejects.toThrow('question generator is temporarily unavailable');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      category: 'PRIVATE unknown category', error: 'PRIVATE diagnostic',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    await expect(api().quiz('space', 'en')).rejects.toThrow('The question service is temporarily unavailable (503). Your previous answers are unchanged.');
    fetchMock.mockResolvedValueOnce(new Response('PRIVATE diagnostic', { status: 422 }));
    await expect(api().quiz('currentAffairs', 'en')).rejects.toThrow('not supported for this subject');
  });
  it('maps only fixed generation reason codes for regular and daily questions', async () => {
    const client = api();
    const failure = (reason: string) => new Response(JSON.stringify({
      category: 'model', reason, error: 'PRIVATE provider diagnostic',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    fetchMock.mockResolvedValueOnce(failure('completion-limit'));
    await expect(client.nextLessonQuestion('space', 'en')).rejects.toThrow('exceeded its response limit');
    fetchMock.mockResolvedValueOnce(failure('upstream-timeout'));
    await expect(client.quiz('space', 'en')).rejects.toThrow('took too long');
    fetchMock.mockResolvedValueOnce(failure('PRIVATE unknown reason'));
    await expect(client.nextLessonQuestion('space', 'en')).rejects.toThrow('question generator is temporarily unavailable');
    fetchMock.mockResolvedValueOnce(failure('toString'));
    await expect(client.quiz('space', 'en')).rejects.toThrow('question generator is temporarily unavailable');
  });
  it('rejects leaked keys, duplicate library IDs and inconsistent restored answers', async () => {
    const entry = { id: 'fixture', subject: 'Maths', level: 1, goal: 'A fixture goal', question: 'A fixture?' };
    fetchMock.mockResolvedValueOnce(json({ version: 1, questions: [{ ...entry, correctIndex: 0 }] }));
    await expect(api().library('en')).rejects.toThrow('API contract error');
    fetchMock.mockResolvedValueOnce(json({ version: 1, questions: [entry, entry] }));
    await expect(api().library('en')).rejects.toThrow('duplicate IDs');
    fetchMock.mockResolvedValueOnce(json({ id: 'wrong-id', answer: null }));
    await expect(api().quizState('quiz')).rejects.toThrow('inconsistent');
    fetchMock.mockResolvedValueOnce(json({ id: 'quiz', answer: { answerIndex: 0, correct: true, correctIndex: 1, explanation: 'Fixture' } }));
    await expect(api().quizState('quiz')).rejects.toThrow('inconsistent');
  });
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
