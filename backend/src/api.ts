import { randomUUID } from "node:crypto";
import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { authorizeRequest, AuthenticationError, requireAdmin, roleForOid } from "./auth.js";
import { getConfig } from "./config.js";
import {
  idempotentUuid,
  InputValidationError,
  PersistenceConflictError,
  requestFingerprint,
  validateChatInput,
  validateIdempotencyKey,
  validateSessionId,
  validatePreferences,
  type Interaction,
  type PendingInteraction,
} from "./contracts.js";
import { HistoryPreparingError, SessionRepository } from "./storage.js";
import type { SpeechTokenProvider, Tutor } from "./services.js";
import { DailyQuotaRepository, QuotaExceededError, QuotaUnavailableError } from "./quota.js";
import {
  logUnexpectedFailure,
  type DiagnosticLogger,
  type DiagnosticOperation,
  type ErrorCategory
} from "./diagnostics.js";
import {
  ReminderRepository, ReminderConflictError, ReminderLimitError, ReminderNotFoundError,
  validateReminderInput
} from "./reminders.js";
import { PianoRepository, validatePianoInput } from "./piano.js";
import { PreferencesRepository } from "./preferences.js";
import type { SocialAuth } from "./social-auth.js";
import type { SocialDirectory } from "./social-directory.js";
import { chooseLearningTopic } from "./curriculum.js";
import {
  QuizRepository, QuizAnswerConflictError, QuizDuplicateError, QuizNotFoundError,
  UnsupportedQuizSubjectError, validateQuizInput, validateQuizAnswer, chooseMathVisual, type QuizGenerator
} from "./quiz.js";

const MAX_BODY_BYTES = 8 * 1024;

export interface ApiDependencies {
  repository: SessionRepository;
  reminders: ReminderRepository;
  piano: PianoRepository;
  preferences: PreferencesRepository;
  quiz: QuizRepository;
  quizGenerator: QuizGenerator;
  tutor: Tutor;
  speech: SpeechTokenProvider;
  quota: Pick<DailyQuotaRepository, "consume">;
  config: ReturnType<typeof getConfig>;
  authorize?: typeof authorizeRequest;
  socialAuth?: SocialAuth;
  socialDirectory?: SocialDirectory;
  logError?: DiagnosticLogger;
}

export type Operation = (
  request: HttpRequest,
  principalOid: string,
  dependencies: ApiDependencies
) => Promise<HttpResponseInit>;

function json(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    jsonBody: body
  };
}

function corsHeaders(origin: string | null, configuredOrigin: string): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin === configuredOrigin) {
    headers["Access-Control-Allow-Origin"] = configuredOrigin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, Idempotency-Key";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

async function readJson(request: HttpRequest): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new PayloadTooLargeError();
  }
  if (!request.body) {
    throw new InputValidationError();
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new InputValidationError();
    }
    return value;
  } catch (error) {
    if (error instanceof InputValidationError) throw error;
    throw new InputValidationError();
  }
}

class PayloadTooLargeError extends Error {}

class OperationFailure extends Error {
  constructor(readonly category: ErrorCategory) {
    super("The operation did not complete.");
  }
}

class ChatPersistenceError extends OperationFailure {
  constructor(readonly sessionId: string, readonly idempotencyKey: string, category: ErrorCategory) {
    super(category);
  }
}

function historyQuery(request: HttpRequest, defaultPageSize: number): { cursor?: string; pageSize: number } {
  const query = new URL(request.url).searchParams;
  const rawPageSize = query.get("pageSize");
  if (rawPageSize !== null && !/^[1-9]\d{0,2}$/.test(rawPageSize)) throw new InputValidationError();
  return {
    ...(query.has("cursor") ? { cursor: query.get("cursor")! } : {}),
    pageSize: rawPageSize === null ? defaultPageSize : Number(rawPageSize)
  };
}

export async function dispatch(
  request: HttpRequest,
  operation: Operation | null,
  dependencies: ApiDependencies,
  options: { authenticated?: boolean; preflight?: boolean; adminOnly?: boolean; operationName?: DiagnosticOperation } = {}
): Promise<HttpResponseInit> {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin, dependencies.config.githubPagesOrigin);
  if (origin && origin !== dependencies.config.githubPagesOrigin) {
    return { ...json(403, { error: "Forbidden." }), headers: { ...json(403, {}).headers, ...headers } };
  }
  if (options.preflight) {
    if (!origin) {
      return { status: 204, headers: { ...headers, Allow: "GET, POST, PUT, DELETE, OPTIONS" } };
    }
    return { status: 204, headers };
  }
  if (!operation) {
    return { status: 204, headers };
  }

  try {
    let principalOid = "";
    if (options.authenticated !== false) {
      const authorize = dependencies.authorize ?? authorizeRequest;
      principalOid = await authorize(request.headers.get("authorization"), dependencies.config);
      roleForOid(principalOid, dependencies.config);
      if (options.adminOnly) requireAdmin(principalOid, dependencies.config);
    }
    const response = await operation(request, principalOid, dependencies);
    return { ...response, headers: { ...headers, ...(response.headers ?? {}) } };
  } catch (error) {
    let response: HttpResponseInit;
    if (error instanceof AuthenticationError) {
      response = json(error.status, { error: error.status === 401 ? "Unauthorized." : "Forbidden." });
    } else if (error instanceof InputValidationError) {
      response = json(400, { error: "Invalid request." });
    } else if (error instanceof PayloadTooLargeError) {
      response = json(413, { error: "Request is too large." });
    } else if (error instanceof PersistenceConflictError) {
      response = json(409, { error: "The session conflicts with this request." });
    } else if (error instanceof ReminderNotFoundError) {
      response = json(404, { error: "Reminder not found." });
    } else if (error instanceof ReminderLimitError) {
      response = json(409, { error: "Reminder limit reached. Delete an item before adding another." });
    } else if (error instanceof ReminderConflictError) {
      response = json(409, { error: "The reminder conflicts with this request." });
    } else if (error instanceof UnsupportedQuizSubjectError) {
      response = json(422, { error: "This quiz subject is unsupported. Live current-affairs quizzes are unavailable." });
    } else if (error instanceof QuizNotFoundError) {
      response = json(404, { error: "Quiz not found." });
    } else if (error instanceof QuizAnswerConflictError) {
      response = json(409, { error: "This quiz already has a different saved answer." });
    } else if (error instanceof QuizDuplicateError) {
      response = json(409, { error: "A recent quiz question was repeated. Try another subject or try later." });
    } else if (error instanceof QuotaExceededError) {
      response = json(429, { error: "Daily request limit reached. Try again after the next UTC day begins." });
    } else if (error instanceof HistoryPreparingError) {
      response = json(503, { error: "Chronological history is being prepared. Retry this request to continue." });
      response.headers = { ...response.headers, "Retry-After": "1" };
    } else if (error instanceof ChatPersistenceError) {
      logUnexpectedFailure(dependencies.logError, options.operationName ?? "chat-post", error.category);
      response = json(503, {
        error: "Chat did not complete. Saving could not be fully confirmed. Check session history and retry with this sessionId and the same Idempotency-Key.",
        category: error.category,
        sessionId: error.sessionId,
        idempotencyKey: error.idempotencyKey
      });
    } else {
      const category = error instanceof QuotaUnavailableError
        ? "quota-unavailable"
        : error instanceof OperationFailure ? error.category : "unexpected";
      logUnexpectedFailure(dependencies.logError, options.operationName ?? "api", category);
      response = json(503, { error: "The request could not be completed. Please try again." });
    }
    return { ...response, headers: { ...headers, ...(response.headers ?? {}) } };
  }
}

export function createOperations() {
  const health: Operation = async () => ({ status: 200, body: "ok", headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });

  const me: Operation = async (_request, principalOid, { config }) =>
    json(200, { role: roleForOid(principalOid, config) });

  const socialSession: Operation = async (request, _principalOid, { socialAuth, config }) => {
    if (!socialAuth) throw new Error("Social authentication is unavailable.");
    return json(200, await socialAuth.exchange(await readJson(request), config));
  };

  const socialLogout: Operation = async (request, _principalOid, { socialAuth }) => {
    if (!socialAuth) throw new Error("Social authentication is unavailable.");
    await socialAuth.revoke(request.headers.get("authorization"));
    return json(200, { signedOut: true });
  };

  const listAccounts: Operation = async (_request, principalOid, { socialDirectory, config }) => {
    requireAdmin(principalOid, config);
    if (!socialDirectory) throw new Error("Access directory is unavailable.");
    return json(200, { accounts: await socialDirectory.list() });
  };
  const saveAccount: Operation = async (request, principalOid, { socialDirectory, config }) => {
    requireAdmin(principalOid, config);
    if (!socialDirectory) throw new Error("Access directory is unavailable.");
    return json(200, { account: await socialDirectory.save(await readJson(request)) });
  };
  const removeAccount: Operation = async (request, principalOid, { socialDirectory, config }) => {
    requireAdmin(principalOid, config);
    if (!socialDirectory) throw new Error("Access directory is unavailable.");
    await socialDirectory.remove(request.params.id ?? "");
    return json(200, { removed: true });
  };

  const getPreferences: Operation = async (_request, _principalOid, { config, preferences }) => {
    try {
      return json(200, await preferences.get(config.parentOid));
    } catch {
      throw new OperationFailure("persistence");
    }
  };

  const putPreferences: Operation = async (request, _principalOid, { config, preferences }) => {
    const value = validatePreferences(await readJson(request));
    try {
      return json(200, await preferences.put(config.parentOid, value));
    } catch {
      throw new OperationFailure("persistence");
    }
  };

  const createQuiz: Operation = async (request, _principalOid, { config, quiz, quizGenerator, quota, repository }) => {
    const body = await readJson(request) as Record<string, unknown>;
    const { supportsNumberLine, ...quizInput } = body;
    if (supportsNumberLine !== undefined && typeof supportsNumberLine !== "boolean") throw new InputValidationError();
    const input = validateQuizInput(quizInput);
    let category: ErrorCategory = "context";
    try {
      const contextSubject = ({ Norsk: "norwegian", Spanish: "otherLanguages", French: "otherLanguages", German: "otherLanguages" } as Record<string, string>)[input.subject] ?? input.subject.toLowerCase();
      const [recent, context] = await Promise.all([
        quiz.recent(config.parentOid, input),
        repository.loadContext(config.parentOid, undefined, contextSubject, input.language)
      ]);
      category = "quota-unavailable";
      await quota.consume(config.parentOid, "chat");
      category = "model";
      const topic = chooseLearningTopic(input.subject, recent.topics, supportsNumberLine === true);
      const target = input.subject === "Maths" ? chooseMathVisual(recent.visuals, topic.mathVisual) : undefined;
      const generated = await quizGenerator.generate(input, recent.questions, context, target, topic);
      if (generated.visual?.kind === "numberLine" && supportsNumberLine !== true) throw new Error("Unsupported client visual.");
      category = "persistence";
      return json(200, await quiz.create(config.parentOid, input, generated, topic));
    } catch (error) {
      if (error instanceof QuotaExceededError || error instanceof QuizDuplicateError) throw error;
      throw new OperationFailure(category);
    }
  };

  const answerQuiz: Operation = async (request, _principalOid, { config, quiz }) => {
    const answerIndex = validateQuizAnswer(await readJson(request));
    try {
      return json(200, await quiz.answer(config.parentOid, request.params.id ?? "", answerIndex));
    } catch (error) {
      if (error instanceof InputValidationError || error instanceof QuizNotFoundError ||
          error instanceof QuizAnswerConflictError) throw error;
      throw new OperationFailure("persistence");
    }
  };

  const quizAttempts: Operation = async (request, _principalOid, { config, quiz }) => {
    const { cursor, pageSize } = historyQuery(request, 50);
    try {
      const page = await quiz.attempts(config.parentOid, cursor, pageSize);
      return json(200, { attempts: page.items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) });
    } catch (error) {
      if (error instanceof InputValidationError) throw error;
      throw new OperationFailure("persistence");
    }
  };

  const listReminders: Operation = async (_request, principalOid, { config, reminders }) => {
    requireAdmin(principalOid, config);
    try {
      return json(200, { reminders: await reminders.list(config.parentOid) });
    } catch {
      throw new OperationFailure("persistence");
    }
  };

  const saveReminder: Operation = async (request, principalOid, { config, reminders }) => {
    requireAdmin(principalOid, config);
    const input = validateReminderInput(await readJson(request));
    const idempotencyKey = validateIdempotencyKey(request.headers.get("idempotency-key"));
    try {
      const saved = await reminders.save(config.parentOid, input, idempotencyKey);
      return json(saved.created ? 201 : 200, { reminder: saved.reminder });
    } catch (error) {
      if (error instanceof ReminderNotFoundError || error instanceof ReminderLimitError ||
          error instanceof ReminderConflictError) throw error;
      throw new OperationFailure("persistence");
    }
  };

  const deleteReminder: Operation = async (request, principalOid, { config, reminders }) => {
    requireAdmin(principalOid, config);
    const id = validateSessionId(request.params.id ?? "");
    try {
      await reminders.delete(config.parentOid, id);
      return { status: 204, headers: { "Cache-Control": "no-store" } };
    } catch {
      throw new OperationFailure("persistence");
    }
  };

  const recordPiano: Operation = async (request, _principalOid, { config, piano }) => {
    const input = validatePianoInput(await readJson(request));
    try {
      return json(200, { correct: await piano.record(config.parentOid, input) });
    } catch {
      throw new OperationFailure("persistence");
    }
  };

  const listPiano: Operation = async (request, _principalOid, { config, piano }) => {
    const { cursor, pageSize } = historyQuery(request, 50);
    try {
      const page = await piano.list(config.parentOid, cursor, pageSize);
      return json(200, { attempts: page.items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) });
    } catch (error) {
      if (error instanceof InputValidationError) throw error;
      throw new OperationFailure("persistence");
    }
  };

  const listSessions: Operation = async (request, _principalOid, { repository, config }) => {
    const { cursor, pageSize } = historyQuery(request, 100);
    const page = await repository.listSessions(config.parentOid, cursor, pageSize);
    return json(200, { sessions: page.items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) });
  };

  const getSession: Operation = async (request, _principalOid, { repository, config }) => {
    const id = validateSessionId(request.params.id ?? "");
    const { cursor, pageSize } = historyQuery(request, 40);
    const session = await repository.getSession(config.parentOid, id, cursor, pageSize);
    return session ? json(200, session) : json(404, { error: "Session not found." });
  };

  const chat: Operation = async (request, _principalOid, { repository, tutor, quota, config, preferences }) => {
    const parentOid = config.parentOid;
    const input = validateChatInput(await readJson(request));
    const idempotencyKey = validateIdempotencyKey(request.headers.get("idempotency-key")) ?? randomUUID();
    const sessionId = input.sessionId ??
      idempotentUuid(parentOid, "session", idempotencyKey);
    const interactionId = idempotentUuid(parentOid, `interaction:${sessionId}`, idempotencyKey);
    const fingerprint = requestFingerprint(input);
    const at = new Date().toISOString();
    const pending: PendingInteraction = {
      id: interactionId,
      sessionId,
      subject: input.subject,
      language: input.language,
      fingerprint,
      updatedAt: at,
      summary: "",
      ...(input.mood ? { mood: input.mood } : {}),
      events: [{ id: randomUUID(), role: "user", text: input.message, at }]
    };
    let category: ErrorCategory = "persistence";
    try {
      const existing = await repository.beginInteraction(parentOid, pending);
      if (existing.events.length === 2) {
        const saved = await repository.persistInteraction(parentOid, existing as Interaction);
        return json(200, { sessionId: saved.sessionId, reply: saved.events[1].text });
      }

      category = "context";
      const context = await repository.loadContext(parentOid, sessionId, input.subject, input.language);
      const mood = input.mood ?? (await preferences.get(parentOid)).mood;
      category = "quota-unavailable";
      await quota.consume(parentOid, "chat");
      category = "model";
      const reply = await tutor.reply({
        subject: input.subject,
        language: input.language,
        message: input.message,
        mood,
        context
      });
      const interaction: Interaction = {
        ...pending,
        mood,
        updatedAt: new Date().toISOString(),
        events: [
          existing.events[0],
          { id: randomUUID(), role: "assistant", text: reply, at: new Date().toISOString() }
        ]
      };
      category = "persistence";
      const saved = await repository.persistInteraction(parentOid, interaction);
      return json(200, { sessionId: saved.sessionId, reply: saved.events[1].text });
    } catch (error) {
      if (error instanceof PersistenceConflictError || error instanceof QuotaExceededError) throw error;
      throw new ChatPersistenceError(sessionId, idempotencyKey, category);
    }
  };

  const speechToken: Operation = async (_request, _principalOid, { speech, quota, config }) => {
    await quota.consume(config.parentOid, "speechToken");
    try {
      return json(200, await speech.issue());
    } catch {
      throw new OperationFailure("speech");
    }
  };

  return {
    health, me, socialSession, socialLogout, listAccounts, saveAccount, removeAccount,
    getPreferences, putPreferences, createQuiz, answerQuiz, quizAttempts,
    listReminders, saveReminder, deleteReminder,
    recordPiano, listPiano, listSessions, getSession, chat, speechToken
  };
}
