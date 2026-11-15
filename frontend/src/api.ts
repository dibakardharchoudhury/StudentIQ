import { z } from 'zod';
import type { AppConfig } from './config';

export const languageSchema = z.enum(['en', 'nb']);
const subjectSchema = z.string().min(1);
const id = z.string().min(1);
const timestamp = z.string().datetime({ offset: true });
export const sessionSchema = z.object({
  id, subject: subjectSchema, language: languageSchema, updatedAt: timestamp, summary: z.string(),
});
export const eventSchema = z.object({
  id, role: z.enum(['user', 'assistant']), text: z.string(), at: timestamp,
});
const detailSchema = z.object({
  id, subject: subjectSchema, language: languageSchema, events: z.array(eventSchema),
});
const nextCursor = z.string().min(1).max(8192).nullish();
const sessionsPageSchema = z.object({ sessions: z.array(sessionSchema), nextCursor });
const detailPageSchema = detailSchema.extend({ nextCursor });
const replySchema = z.object({ sessionId: id, reply: z.string().min(1) });
const speechSchema = z.object({ token: z.string().min(1), region: z.string().regex(/^[a-z0-9-]+$/) });
const meSchema = z.object({ role: z.enum(['admin', 'parent', 'student']) });
const socialAccountSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  provider: z.enum(['google', 'microsoft']),
  subject: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/),
  role: z.enum(['parent', 'student']),
  admin: z.boolean().default(false),
  email: z.string().email().max(254).optional(),
}).refine(account => !account.admin || account.role === 'parent', 'Only parents can have administrator rights.');
const accessRequestSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/), provider: z.enum(['google', 'microsoft']),
  subject: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/), email: z.string().email().max(254).optional(),
  requestedAt: timestamp,
});
const preapprovalSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/), provider: z.enum(['google', 'microsoft']),
  email: z.string().email().max(254), role: z.enum(['parent', 'student']),
  admin: z.boolean(), expiresAt: timestamp,
}).refine(account => !account.admin || account.role === 'parent', 'Only parents can have administrator rights.');
const accountInputSchema = z.union([
  z.object({ provider: z.enum(['google', 'microsoft']), subject: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/),
    role: z.enum(['parent', 'student']), admin: z.boolean().optional() }).strict(),
  z.object({ provider: z.enum(['google', 'microsoft']), requestId: z.string().regex(/^[a-f0-9]{64}$/),
    email: z.string().trim().email().max(254), role: z.enum(['parent', 'student']), admin: z.boolean().optional() }).strict(),
  z.object({ provider: z.enum(['google', 'microsoft']), email: z.string().trim().email().max(254),
    role: z.enum(['parent', 'student']), admin: z.boolean().optional() }).strict(),
]).refine(account => !account.admin || account.role === 'parent', 'Only parents can have administrator rights.');
const reminderSchema = z.object({
  id, title: z.string().min(1), date: z.iso.date(), completed: z.boolean(),
});
const reminderInputSchema = z.object({ title: z.string().trim().min(1).max(200), date: z.iso.date() });
export const targetNotes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'] as const;
export const pianoNotes = ['C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4', 'C5'] as const;
const pianoInputSchema = z.object({ targetNote: z.enum(targetNotes), selectedNote: z.enum(pianoNotes) });
const pianoAttemptSchema = pianoInputSchema.extend({ id, correct: z.boolean(), at: timestamp });
const preferencesSchema = z.object({
  appearance: z.enum(['rose', 'sunny', 'mint']),
  voice: z.enum(['default', 'alternate']),
  mood: z.enum(['gentle', 'cheerful', 'calm']),
});
const quizVisualSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('array'), rows: z.number().int().min(1).max(8), columns: z.number().int().min(1).max(8),
    icon: z.enum(['star', 'apple', 'leaf', 'note', 'drop']) }).strict(),
  z.object({ kind: z.literal('fraction'), parts: z.number().int().min(2).max(12), filled: z.number().int().min(0).max(12) }).strict()
    .refine(visual => visual.filled <= visual.parts, { path: ['filled'] }),
  z.object({ kind: z.literal('numberLine'), from: z.number().int().min(0).max(9), to: z.number().int().min(1).max(10) }).strict()
    .refine(visual => visual.from < visual.to, { path: ['to'] }),
  z.object({ kind: z.literal('cards'), style: z.enum(['sequence', 'timeline', 'words', 'places']),
    items: z.array(z.string().trim().min(1).max(48)).min(2).max(4) }).strict(),
]);
const quizSchema = z.object({ id, question: z.string().min(1), options: z.array(z.string().min(1)).length(4),
  lesson: z.string().trim().min(1).max(360).optional(), topic: z.string().trim().min(1).max(80).optional(),
  visual: quizVisualSchema.optional(), source: z.literal('library').optional(),
  libraryId: z.string().regex(/^[a-z0-9-]{1,60}$/).optional(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() });
const quizAnswerSchema = z.object({
  correct: z.boolean(), correctIndex: z.number().int().min(0).max(3), explanation: z.string(),
});
const quizAttemptSchema = z.object({ id, subject: subjectSchema, question: z.string(), correct: z.boolean(), at: timestamp });
const libraryEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  subject: z.enum(['Maths', 'Norsk', 'Science', 'Geography', 'History', 'English', 'Piano', 'Music theory',
    'French', 'Spanish', 'German', 'Coding', 'Space', 'Nature', 'Art', 'Media literacy']),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  goal: z.string().trim().min(1).max(160), question: z.string().trim().min(1).max(320),
}).strict();
const librarySchema = z.object({ version: z.literal(1), questions: z.array(libraryEntrySchema).min(1).max(500) }).strict();
const quizStateSchema = z.object({
  id, answer: quizAnswerSchema.extend({ answerIndex: z.number().int().min(0).max(3),
    explanation: z.string().trim().min(1).max(600) }).strict().nullable(),
}).strict();
export type Language = z.infer<typeof languageSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type SessionDetail = z.infer<typeof detailSchema>;
export type ChatEvent = z.infer<typeof eventSchema>;
export type ChatInput = { sessionId?: string; subject: string; language: Language; message: string; mood?: Preferences['mood'] };
export type SpeechToken = z.infer<typeof speechSchema>;
export type Role = z.infer<typeof meSchema>['role'];
export type SocialAccount = z.infer<typeof socialAccountSchema>;
export type SocialAccessRequest = z.infer<typeof accessRequestSchema>;
export type SocialPreapproval = z.infer<typeof preapprovalSchema>;
export type SocialAccountInput = z.infer<typeof accountInputSchema>;
export type Reminder = z.infer<typeof reminderSchema>;
export type ReminderInput = Pick<Reminder, 'title' | 'date'> | Reminder;
export type PianoNote = typeof pianoNotes[number];
export type TargetNote = typeof targetNotes[number];
export type PianoInput = z.infer<typeof pianoInputSchema>;
export type PianoAttempt = z.infer<typeof pianoAttemptSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type QuizQuestion = z.infer<typeof quizSchema>;
export type QuizAnswer = z.infer<typeof quizAnswerSchema>;
export type QuizAttempt = z.infer<typeof quizAttemptSchema>;
export type LibraryEntry = z.infer<typeof libraryEntrySchema>;

export class ApiError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); }
}

function addUnique<T extends { id: string }>(items: Map<string, T>, incoming: T[]) {
  for (const item of incoming) {
    const previous = items.get(item.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(item)) {
      throw new ApiError('History changed between pages. Refresh to load a consistent history.');
    }
    if (!previous) items.set(item.id, item);
  }
}

export class Api {
  constructor(private config: AppConfig, private accessToken: () => Promise<string>) {}

  private async response(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', signal?: AbortSignal, body?: unknown): Promise<Response> {
    let token: string;
    try { token = await this.accessToken(); }
    catch { throw new ApiError('Authentication failed or expired. Sign out and sign in again.'); }
    signal?.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(`${this.config.apiBaseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`, Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ApiError('Cannot reach the tutoring service. Check your connection and backend CORS configuration.');
    }
    if (!response.ok) {
      if (response.status === 401) throw new ApiError('Your sign-in has expired. Sign out and sign in again.', 401);
      if (response.status === 403) throw new ApiError('This account is not allowed by the tutoring service. Contact the account administrator.', 403);
      throw new ApiError(`Tutoring service error (${response.status}). Nothing has been marked successful.`, response.status);
    }
    return response;
  }

  private async request<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal, body?: unknown): Promise<T> {
    const response = await this.response(path, body === undefined ? 'GET' : 'POST', signal, body);
    const endpoint = path.split('?')[0];
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new ApiError(`API contract error: ${endpoint} did not return JSON.`); }
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new ApiError(`API contract error: ${endpoint} returned invalid fields (${result.error.issues.map(issue => issue.path.join('.')).join(', ')}).`);
    }
    return result.data;
  }

  private async historyPages<T extends { nextCursor?: string | null }>(
    path: string, schema: z.ZodType<T>, accept: (page: T) => void, signal?: AbortSignal,
  ): Promise<void> {
    const seen = new Set<string>();
    let cursor: string | undefined;
    try {
      for (let page = 0; page < 1000; page++) {
        signal?.throwIfAborted();
        const query = cursor === undefined ? '' : `?${new URLSearchParams({ cursor })}`;
        const result = await this.request(`${path}${query}`, schema, signal);
        signal?.throwIfAborted();
        accept(result);
        if (result.nextCursor == null) return;
        if (seen.has(result.nextCursor)) throw new ApiError('The service repeated a history cursor.');
        seen.add(result.nextCursor);
        cursor = result.nextCursor;
      }
      throw new ApiError('History exceeded the 1,000-page safety limit. Contact the service administrator.');
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ApiError(
        `History could not be fully loaded. No partial result was returned. ${error instanceof ApiError ? error.message : 'Please retry the history request.'}`,
        error instanceof ApiError ? error.status : undefined,
      );
    }
  }

  async sessions(signal?: AbortSignal): Promise<Session[]> {
    const items = new Map<string, Session>();
    await this.historyPages('/api/sessions', sessionsPageSchema, page => addUnique(items, page.sessions), signal);
    return [...items.values()];
  }
  async session(sessionId: string, signal?: AbortSignal): Promise<SessionDetail> {
    const events = new Map<string, ChatEvent>();
    let first: SessionDetail | undefined;
    await this.historyPages(`/api/sessions/${encodeURIComponent(sessionId)}`, detailPageSchema, page => {
      if (page.id !== sessionId) throw new ApiError('API contract error: session ID does not match the requested session.');
      if (first && (page.subject !== first.subject || page.language !== first.language)) {
        throw new ApiError('API contract error: session metadata changed between history pages.');
      }
      first ??= { id: page.id, subject: page.subject, language: page.language, events: [] };
      addUnique(events, page.events);
    }, signal);
    return { ...first!, events: [...events.values()] };
  }
  chat(input: ChatInput, signal?: AbortSignal) {
    return this.request('/api/chat', replySchema, signal, input).then(reply => {
      if (input.sessionId && input.sessionId !== reply.sessionId) {
        throw new ApiError('API contract error: chat returned a different session ID. Reload history before continuing.');
      }
      return reply;
    });
  }
  speechToken(signal?: AbortSignal) { return this.request('/api/speech/token', speechSchema, signal, {}); }
  me(signal?: AbortSignal) { return this.request('/api/me', meSchema, signal); }
  async socialAccounts(signal?: AbortSignal) {
    const result = await this.request('/api/access/accounts', z.object({ accounts: z.array(socialAccountSchema).max(20) }), signal);
    if (new Set(result.accounts.map(account => account.id)).size !== result.accounts.length) {
      throw new ApiError('API contract error: duplicate accounts.');
    }
    return result.accounts;
  }
  async accessDirectory(signal?: AbortSignal) {
    const result = await this.request('/api/access/accounts', z.object({
      accounts: z.array(socialAccountSchema).max(20), requests: z.array(accessRequestSchema).max(50),
      preapprovals: z.array(preapprovalSchema).max(20).default([]),
    }), signal);
    for (const rows of [result.accounts, result.requests, result.preapprovals]) {
      if (new Set(rows.map(row => row.id)).size !== rows.length) throw new ApiError('API contract error: duplicate accounts or requests.');
    }
    return result;
  }
  async saveSocialAccount(input: SocialAccountInput, signal?: AbortSignal) {
    const result = accountInputSchema.safeParse(input);
    if (!result.success) throw new ApiError('Enter a valid account or sign-in request. Administrator rights are available only for parents.');
    if (!('subject' in result.data) && !('requestId' in result.data)) {
      return this.request('/api/access/accounts', z.object({ invitationCode: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }), signal, result.data);
    }
    return this.request('/api/access/accounts', z.object({ invitationCode: z.string().regex(/^[A-Za-z0-9_-]{32}$/).optional() }), signal, result.data);
  }
  async removeSocialAccount(accountId: string, signal?: AbortSignal) {
    if (!/^[a-f0-9]{64}$/.test(accountId)) throw new ApiError('Invalid account identifier.');
    await this.response(`/api/access/accounts/${accountId}`, 'DELETE', signal);
  }
  async reminders(signal?: AbortSignal): Promise<Reminder[]> {
    const result = await this.request('/api/planning/reminders', z.object({ reminders: z.array(reminderSchema) }), signal);
    if (new Set(result.reminders.map(item => item.id)).size !== result.reminders.length) {
      throw new ApiError('API contract error: planning items contain duplicate IDs.');
    }
    return result.reminders;
  }
  async saveReminder(input: ReminderInput, signal?: AbortSignal): Promise<void> {
    const schema = 'id' in input
      ? reminderInputSchema.extend({ id, completed: z.boolean() })
      : reminderInputSchema;
    const result = schema.safeParse(input);
    if (!result.success) throw new ApiError('Enter a title (1–200 characters) and a valid calendar date.');
    // Mutation response bodies are unspecified. The UI always refetches canonical items.
    await this.response('/api/planning/reminders', 'POST', signal, result.data);
  }
  async deleteReminder(reminderId: string, signal?: AbortSignal): Promise<void> {
    if (!reminderId) throw new ApiError('A planning item ID is required.');
    await this.response(`/api/planning/reminders/${encodeURIComponent(reminderId)}`, 'DELETE', signal);
  }
  pianoPractice(input: PianoInput, signal?: AbortSignal) {
    const result = pianoInputSchema.safeParse(input);
    if (!result.success) throw new ApiError('Choose a supported target and piano key.');
    return this.request('/api/practice/piano', z.object({ correct: z.boolean() }), signal, result.data);
  }
  async pianoAttempts(signal?: AbortSignal): Promise<PianoAttempt[]> {
    const attempts = new Map<string, PianoAttempt>();
    await this.historyPages('/api/practice/piano', z.object({
      attempts: z.array(pianoAttemptSchema), nextCursor,
    }), page => addUnique(attempts, page.attempts), signal);
    return [...attempts.values()];
  }
  preferences(signal?: AbortSignal) { return this.request('/api/preferences', preferencesSchema, signal); }
  async savePreferences(input: Preferences, signal?: AbortSignal): Promise<Preferences> {
    const result = preferencesSchema.safeParse(input);
    if (!result.success) throw new ApiError('API contract error: choose supported appearance, voice and mood presets.');
    await this.response('/api/preferences', 'PUT', signal, result.data);
    return this.preferences(signal);
  }
  quiz(subject: string, language: Language, signal?: AbortSignal) {
    return this.request('/api/quiz', quizSchema, signal, { subject, language, supportsNumberLine: true });
  }
  async library(language: Language, signal?: AbortSignal): Promise<LibraryEntry[]> {
    const result = await this.request(`/api/library?${new URLSearchParams({ language })}`, librarySchema, signal);
    if (new Set(result.questions.map(question => question.id)).size !== result.questions.length) {
      throw new ApiError('API contract error: the question library contains duplicate IDs.');
    }
    return result.questions;
  }
  async libraryQuiz(questionId: string, language: Language, signal?: AbortSignal): Promise<QuizQuestion> {
    if (!/^[a-z0-9-]{1,60}$/.test(questionId)) throw new ApiError('Choose a question from the library.');
    const result = await this.request(`/api/library/questions/${encodeURIComponent(questionId)}`, quizSchema, signal, { language });
    if (result.source !== 'library' || result.libraryId !== questionId || result.level === undefined) {
      throw new ApiError('API contract error: the service returned a different library question.');
    }
    return result;
  }
  quizHint(quizId: string, signal?: AbortSignal) {
    return this.request(`/api/quiz/${encodeURIComponent(quizId)}/hint`,
      z.object({ hint: z.string().trim().min(1).max(320) }).strict(), signal);
  }
  async quizState(quizId: string, signal?: AbortSignal) {
    const result = await this.request(`/api/quiz/${encodeURIComponent(quizId)}`, quizStateSchema, signal);
    if (result.id !== quizId || (result.answer && result.answer.correct !==
        (result.answer.answerIndex === result.answer.correctIndex))) {
      throw new ApiError('API contract error: the stored quiz result is inconsistent.');
    }
    return result;
  }
  async answerQuiz(quizId: string, answerIndex: number, signal?: AbortSignal): Promise<QuizAnswer> {
    if (!quizId || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) {
      throw new ApiError('Choose one of the four answers.');
    }
    const result = await this.request(`/api/quiz/${encodeURIComponent(quizId)}/answer`, quizAnswerSchema, signal, { answerIndex });
    if (result.correct !== (result.correctIndex === answerIndex)) {
      throw new ApiError('API contract error: quiz correctness contradicts the supplied correct answer index.');
    }
    return result;
  }
  async quizAttempts(signal?: AbortSignal): Promise<QuizAttempt[]> {
    const attempts = new Map<string, QuizAttempt>();
    await this.historyPages('/api/quiz/attempts', z.object({
      attempts: z.array(quizAttemptSchema), nextCursor,
    }), page => addUnique(attempts, page.attempts), signal);
    return [...attempts.values()];
  }
}
