import assert from "node:assert/strict";
import { test } from "node:test";
import type { HttpRequest } from "@azure/functions";
import { AuthenticationError } from "../src/auth.js";
import { dispatch, createOperations, type ApiDependencies } from "../src/api.js";
import { HistoryPreparingError, SessionRepository } from "../src/storage.js";
import type { BlobValue, JsonBlobStore } from "../src/contracts.js";
import { DailyQuotaRepository, QuotaUnavailableError } from "../src/quota.js";
import type { DiagnosticEvent } from "../src/diagnostics.js";
import { ReminderRepository } from "../src/reminders.js";
import { PianoRepository } from "../src/piano.js";
import { PreferencesRepository } from "../src/preferences.js";
import { QuizRepository } from "../src/quiz.js";
import { LessonRepository } from "../src/lessons.js";
import { QuizGenerationError } from "../src/quiz-model.js";
import { SocialDirectory } from "../src/social-directory.js";
import { SOCIAL_ADMIN, SOCIAL_PARENT, SOCIAL_STUDENT } from "../src/auth.js";

class MemoryBlobStore implements JsonBlobStore {
  private readonly values = new Map<string, { value: unknown; etag: string }>();
  failWritesContaining?: string;
  async read<T>(key: string): Promise<BlobValue<T> | null> {
    const item = this.values.get(key);
    return item ? { value: item.value as T, etag: item.etag } : null;
  }
  async create<T>(key: string, value: T): Promise<boolean> {
    if (this.failWritesContaining && key.includes(this.failWritesContaining)) throw new Error("Write failed");
    if (this.values.has(key)) return false;
    this.values.set(key, { value, etag: "1" });
    return true;
  }
  async replace<T>(key: string, value: T, etag: string): Promise<boolean> {
    if (this.failWritesContaining && key.includes(this.failWritesContaining)) throw new Error("Write failed");
    const old = this.values.get(key);
    if (!old || old.etag !== etag) return false;
    this.values.set(key, { value, etag: String(Number(etag) + 1) });
    return true;
  }
  async list(prefix: string, pageSize: number, continuationToken?: string, hierarchy = false) {
    const matches = [...this.values.keys()].filter((key) => key.startsWith(prefix));
    const keys = [...new Set(hierarchy
      ? matches.map((key) => `${prefix}${key.slice(prefix.length).split("/")[0]}/`)
      : matches)].filter((key) => !continuationToken || key > continuationToken).sort();
    return {
      keys: keys.slice(0, pageSize),
      ...(keys.length > pageSize ? { continuationToken: keys[pageSize - 1] } : {})
    };
  }
}

const config = {
  preferenceDefaults: { appearance: "rose", voice: "default", mood: "gentle" } as const,
  chatDailyLimit: 60,
  speechTokenDailyLimit: 200,
  tenantId: "11111111-1111-4111-8111-111111111111",
  audience: "api://studentiq",
  parentOid: "22222222-2222-4222-8222-222222222222",
  requiredScope: "StudentIQ.Access",
  githubPagesOrigin: "https://example.github.io",
  blobEndpoint: "https://example.blob.core.windows.net",
  blobContainer: "studentiq-private",
  foundryEndpoint: "https://example.services.ai.azure.com",
  foundryModel: "model-router",
  foundryApiVersion: "2024-10-21",
  speechIdentityClientId: "44444444-4444-4444-8444-444444444444",
  speechResourceId: "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/studentiq/providers/Microsoft.CognitiveServices/accounts/studentiq-speech",
  speechRegion: "eastus"
};

function dependencies(authorize: ApiDependencies["authorize"]): ApiDependencies {
  const blobs = new MemoryBlobStore();
  const quiz = new QuizRepository(blobs);
  return {
    config: { ...config },
    socialDirectory: new SocialDirectory(blobs, config.parentOid),
    repository: new SessionRepository(blobs),
    reminders: new ReminderRepository(blobs),
    piano: new PianoRepository(blobs),
    preferences: new PreferencesRepository(blobs, config.preferenceDefaults),
    quiz,
    lessons: new LessonRepository(blobs, quiz),
    quizGenerator: { generate: async () => ({
      question: "What is 2 + 2?", options: ["3", "4", "5", "6"], correctIndex: 1,
      explanation: "Adding two and two gives four."
    }) },
    quota: new DailyQuotaRepository(blobs, config),
    tutor: { reply: async () => "A helpful answer." },
    speech: { issue: async () => ({ token: "short-lived", region: "eastus" }) },
    authorize,
    logError: () => {}
  };
}

function request(path: string, init?: RequestInit): HttpRequest {
  const base = new Request(`https://function.example/api/${path}`, init);
  return Object.assign(base, { params: {} }) as HttpRequest;
}

test("all application routes require a successful token validator", async () => {
  const denied = dependencies(async () => { throw new AuthenticationError(401); });
  const response = await dispatch(request("sessions"), createOperations().listSessions, denied);
  assert.equal(response.status, 401);
  assert.deepEqual(response.jsonBody, { error: "Unauthorized." });

  const allowed = dependencies(async () => config.parentOid);
  const health = await dispatch(request("health"), createOperations().health, allowed, { authenticated: false });
  assert.equal(health.status, 200);
});

test("daily lessons authenticate, resume without generation, share family progress and reconcile ordinary saved grading", async () => {
  const operations = createOperations();
  const denied = dependencies(async () => { throw new AuthenticationError(401); });
  for (const operation of [operations.getLesson, operations.nextLesson, operations.answerLesson]) {
    assert.equal((await dispatch(request("lessons/daily?subject=maths&language=en"), operation, denied)).status, 401);
  }
  const deps = dependencies(async () => SOCIAL_STUDENT);
  let generationCalls = 0;
  const generator = deps.quizGenerator.generate;
  deps.quizGenerator.generate = async (...args) => { generationCalls++; return generator(...args); };
  const get = () => dispatch(request("lessons/daily?subject=maths&language=en"), operations.getLesson, deps);
  const next = () => dispatch(request("lessons/daily/next", {
    method: "POST", body: JSON.stringify({ subject: "maths", language: "en", supportsNumberLine: true })
  }), operations.nextLesson, deps);
  assert.equal((await get()).status, 200);
  assert.equal(generationCalls, 0);
  const started = (await next()).jsonBody as {
    date: string; current: { id: string; question: string }; completed: number; answer: unknown;
  };
  assert.ok(started.current.id);
  assert.equal("correctIndex" in started.current, false);
  assert.deepEqual((await next()).jsonBody, started);
  assert.equal(generationCalls, 1);
  deps.authorize = async () => SOCIAL_PARENT;
  assert.deepEqual((await get()).jsonBody, started);
  // An answer response lost before the lesson aggregate is saved is reconciled on GET.
  await deps.quiz.answer(config.parentOid, started.current.id, 1);
  const restored = await get();
  assert.equal((restored.jsonBody as { completed: number }).completed, 1);
  assert.equal(new Headers(restored.headers).get("Cache-Control"), "no-store");
  const submit = (answerIndex: number) => dispatch(request("lessons/daily/answer", {
    method: "POST", body: JSON.stringify({ subject: "maths", language: "en",
      date: started.date, quizId: started.current.id, answerIndex })
  }), operations.answerLesson, deps);
  assert.equal((await submit(1)).status, 200);
  assert.equal((await submit(0)).status, 409);
  assert.equal((await get()).jsonBody && ((await get()).jsonBody as { completed: number }).completed, 1);
  assert.equal(generationCalls, 1);
  const invalid = await dispatch(request("lessons/daily?subject=maths&language=en&date=2026-01-01"), operations.getLesson, deps);
  assert.equal(invalid.status, 400);
});

test("daily question issuance enforces existing quota and exposes only safe persistence failures", async () => {
  const operations = createOperations();
  const deps = dependencies(async () => config.parentOid);
  deps.quota.consume = async () => { throw new QuotaUnavailableError(); };
  const next = () => dispatch(request("lessons/daily/next", {
    method: "POST", body: JSON.stringify({ subject: "maths", language: "en" })
  }), operations.nextLesson, deps);
  const unavailable = await next();
  assert.equal(unavailable.status, 503);
  assert.equal((unavailable.jsonBody as { category: string }).category, "quota-unavailable");
  deps.lessons.get = async () => { throw new Error("PRIVATE storage detail"); };
  const failed = await dispatch(request("lessons/daily?subject=maths&language=en"), operations.getLesson, deps);
  assert.equal(failed.status, 503);
  assert.equal((failed.jsonBody as { category: string }).category, "persistence");
  assert.equal(JSON.stringify(failed).includes("PRIVATE"), false);
});

test("regular and daily quiz failures expose fixed model reason codes, never raw exception text", async () => {
  const operations = createOperations();
  for (const [path, operation] of [["quiz", operations.createQuiz], ["lessons/daily/next", operations.nextLesson]] as const) {
    const deps = dependencies(async () => config.parentOid);
    deps.quizGenerator.generate = async () => {
      const error = new QuizGenerationError("completion-limit");
      error.message = "PRIVATE provider payload";
      throw error;
    };
    const response = await dispatch(request(path, { method: "POST",
      body: JSON.stringify({ subject: "space", language: "en" }) }), operation, deps);
    assert.equal(response.status, 503);
    assert.deepEqual(response.jsonBody, { error: "The request could not be completed. Please try again.",
      category: "model", reason: "completion-limit" });
    assert.equal(JSON.stringify(response).includes("PRIVATE"), false);
  }
});

test("library browsing, issuance, hints and grading need authorization but no model, context or quota calls", async () => {
  const operations = createOperations();
  const denied = dependencies(async () => { throw new AuthenticationError(401); });
  for (const operation of [operations.listLibrary, operations.createLibraryQuiz, operations.quizState, operations.quizHint]) {
    assert.equal((await dispatch(request("library?language=en"), operation, denied)).status, 401);
  }
  const deps = dependencies(async () => SOCIAL_STUDENT);
  deps.quizGenerator.generate = async () => { throw new Error("Model must not run"); };
  deps.quota.consume = async () => { throw new Error("Quota must not run"); };
  deps.repository.loadContext = async () => { throw new Error("Context must not load"); };
  const catalog = await dispatch(request("library?language=nb"), operations.listLibrary, deps);
  assert.equal(catalog.status, 200);
  assert.equal(catalog.headers && new Headers(catalog.headers).get("Cache-Control"), "no-store");
  const body = catalog.jsonBody as { questions: { id: string; subject: string }[] };
  assert.equal(body.questions.length, 138);
  assert.equal(JSON.stringify(body).includes("correctIndex"), false);
  const create = () => Object.assign(request("library/questions/math-book", {
    method: "POST", body: JSON.stringify({ language: "nb" })
  }), { params: { id: "maths-books" } });
  const created = await dispatch(create(), operations.createLibraryQuiz, deps);
  assert.equal(created.status, 200);
  const quiz = created.jsonBody as { id: string; options: string[] };
  assert.equal("explanation" in quiz, false);
  const state = () => Object.assign(request(`quiz/${quiz.id}`), { params: { id: quiz.id } });
  assert.deepEqual((await dispatch(state(), operations.quizState, deps)).jsonBody, { id: quiz.id, answer: null });
  assert.equal((await dispatch(state(), operations.quizHint, deps)).status, 200);
  const answer = Object.assign(request(`quiz/${quiz.id}/answer`, {
    method: "POST", body: JSON.stringify({ answerIndex: quiz.options.indexOf("25") })
  }), { params: { id: quiz.id } });
  assert.equal((await dispatch(answer, operations.answerQuiz, deps)).status, 200);
  assert.equal((await dispatch(state(), operations.quizState, deps)).status, 200);
  assert.equal((await dispatch(request("quiz/attempts"), operations.quizAttempts, deps)).status, 200);
  assert.equal((await dispatch(create(), operations.createLibraryQuiz, deps)).status, 200);
  for (const path of ["library", "library?language=fr", "library?language=en&language=nb", "library?language=en&extra=true"]) {
    assert.equal((await dispatch(request(path), operations.listLibrary, deps)).status, 400);
  }
  for (const invalid of [{ language: "fr" }, { language: "en", correctIndex: 0 }]) {
    const invalidRequest = Object.assign(request("library/questions/maths-books", {
      method: "POST", body: JSON.stringify(invalid)
    }), { params: { id: "maths-books" } });
    assert.equal((await dispatch(invalidRequest, operations.createLibraryQuiz, deps)).status, 400);
  }
  const blobs = new MemoryBlobStore();
  blobs.failWritesContaining = "/quiz/";
  deps.quiz = new QuizRepository(blobs);
  assert.equal((await dispatch(create(), operations.createLibraryQuiz, deps)).status, 503);
});

test("only the administrator can approve, list, or revoke parent and student accounts", async () => {
  const operations = createOperations();
  const deps = dependencies(async () => config.parentOid);
  const body = JSON.stringify({ provider: "google", subject: "subject-123", role: "parent" });
  const save = () => request("access/accounts", { method: "POST", headers: { "content-type": "application/json" }, body });
  for (const principal of [SOCIAL_STUDENT, SOCIAL_PARENT]) {
    deps.authorize = async () => principal;
    assert.equal((await dispatch(save(), operations.saveAccount, deps, { adminOnly: true })).status, 403);
    assert.equal((await dispatch(request("access/accounts"), operations.listAccounts, deps, { adminOnly: true })).status, 403);
  }
  deps.authorize = async () => config.parentOid;
  assert.equal((await dispatch(save(), operations.saveAccount, deps, { adminOnly: true })).status, 200);
  const listed = await dispatch(request("access/accounts"), operations.listAccounts, deps, { adminOnly: true });
  const account = (listed.jsonBody as { accounts: { id: string; role: string }[] }).accounts[0]!;
  assert.equal(account.role, "parent");
  const remove = request(`access/accounts/${account.id}`, { method: "DELETE" });
  remove.params.id = account.id;
  deps.authorize = async () => SOCIAL_PARENT;
  assert.equal((await dispatch(remove, operations.removeAccount, deps, { adminOnly: true })).status, 403);
  deps.authorize = async () => config.parentOid;
  assert.equal((await dispatch(remove, operations.removeAccount, deps, { adminOnly: true })).status, 200);
  assert.equal((await deps.socialDirectory!.list()).length, 0);
});

test("an explicitly granted social administrator can manage access and planning, but a parent cannot self-promote", async () => {
  const operations = createOperations();
  const deps = dependencies(async () => SOCIAL_PARENT);
  const body = JSON.stringify({ provider: "microsoft", subject: "parent-subject", role: "parent", admin: true });
  const requestBody = () => request("access/accounts", { method: "POST", body });
  assert.equal((await dispatch(requestBody(), operations.saveAccount, deps, { adminOnly: true })).status, 403);
  deps.authorize = async () => SOCIAL_ADMIN;
  assert.equal((await dispatch(requestBody(), operations.saveAccount, deps, { adminOnly: true })).status, 200);
  const access = await dispatch(request("access/accounts"), operations.listAccounts, deps, { adminOnly: true });
  assert.equal(access.status, 200);
  assert.deepEqual((access.jsonBody as { requests: unknown[] }).requests, []);
  assert.equal((await dispatch(request("planning/reminders"), operations.listReminders, deps, { adminOnly: true })).status, 200);
  assert.deepEqual((await dispatch(request("me"), operations.me, deps)).jsonBody, { role: "admin" });
});

test("only administrators can add accounts in advance, and listing never returns invitation secrets", async () => {
  const operations = createOperations();
  const deps = dependencies(async () => SOCIAL_PARENT);
  const save = () => request("access/accounts", { method: "POST", body: JSON.stringify({
    provider: "microsoft", email: "person@example.com", role: "parent", admin: true,
  }) });
  assert.equal((await dispatch(save(), operations.saveAccount, deps, { adminOnly: true })).status, 403);
  deps.authorize = async () => SOCIAL_ADMIN;
  const created = await dispatch(save(), operations.saveAccount, deps, { adminOnly: true });
  assert.equal(created.status, 200);
  const body = created.jsonBody as { preapproval: { id: string }; invitationCode: string };
  assert.match(body.invitationCode, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(created.headers?.["Cache-Control"], "no-store");
  const listed = await dispatch(request("access/accounts"), operations.listAccounts, deps, { adminOnly: true });
  const snapshot = listed.jsonBody as { accounts: unknown[]; preapprovals: unknown[] };
  assert.equal(snapshot.accounts.length, 0);
  assert.equal(snapshot.preapprovals.length, 1);
  assert.equal(JSON.stringify(snapshot).includes(body.invitationCode), false);
  assert.equal(JSON.stringify(snapshot).includes("codeHash"), false);
  const remove = request(`access/accounts/${body.preapproval.id}`, { method: "DELETE" });
  remove.params.id = body.preapproval.id;
  assert.equal((await dispatch(remove, operations.removeAccount, deps, { adminOnly: true })).status, 200);
  assert.equal((await deps.socialDirectory!.snapshot()).preapprovals.length, 0);
});

test("Speech response preserves contract and no-store, and cannot bypass parent authorization", async () => {
  const deps = dependencies(async () => config.parentOid);
  let calls = 0;
  const result = { token: `aad#${config.speechResourceId}#speech-only-token`, region: "eastus" };
  deps.speech = { issue: async () => { calls++; return result; } };
  const response = await dispatch(request("speech/token", { method: "POST" }), createOperations().speechToken, deps);
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, result);
  assert.equal((response.headers as Record<string, string>)["Cache-Control"], "no-store");

  deps.authorize = async () => { throw new AuthenticationError(403); };
  const denied = await dispatch(request("speech/token", { method: "POST" }), createOperations().speechToken, deps);
  assert.equal(denied.status, 403);
  assert.equal(calls, 1);
});

test("Speech identity failure returns a safe no-store error without credential details", async () => {
  const deps = dependencies(async () => config.parentOid);
  deps.speech = { issue: async () => { throw new Error("sensitive-token-details"); } };
  const response = await dispatch(request("speech/token", { method: "POST" }), createOperations().speechToken, deps);
  assert.equal(response.status, 503);
  assert.equal((response.headers as Record<string, string>)["Cache-Control"], "no-store");
  assert.equal(JSON.stringify(response.jsonBody).includes("sensitive-token-details"), false);
});

test("rejects malformed chat input without calling tutor or writing data", async () => {
  const deps = dependencies(async () => config.parentOid);
  let called = false;
  deps.tutor = { reply: async () => { called = true; return "unexpected"; } };
  const response = await dispatch(
    request("chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "Math", language: "fr", message: "Hi" })
    }),
    createOperations().chat,
    deps
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("replays idempotent chat requests without another model call", async () => {
  const deps = dependencies(async () => config.parentOid);
  let calls = 0;
  deps.tutor = { reply: async () => `Answer ${++calls}` };
  const makeRequest = () => request("chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "retry-key-123"
    },
    body: JSON.stringify({ subject: "Math", language: "en", message: "What is 1 + 1?" })
  });
  const first = await dispatch(makeRequest(), createOperations().chat, deps);
  const second = await dispatch(makeRequest(), createOperations().chat, deps);
  assert.equal(first.status, 200);
  assert.deepEqual(second.jsonBody, first.jsonBody);
  assert.equal(calls, 1);
});

test("model failures leave the original user event in history and return a replay key", async () => {
  const deps = dependencies(async () => config.parentOid);
  deps.tutor = { reply: async () => { throw new Error("Model unavailable"); } };
  const makeRequest = (sessionId?: string, key?: string) => request("chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    body: JSON.stringify({ sessionId, subject: "Math", language: "en", message: "Please preserve my question" })
  });
  const failed = await dispatch(makeRequest(), createOperations().chat, deps);
  assert.equal(failed.status, 503);
  const recovery = failed.jsonBody as { category: string; sessionId: string; idempotencyKey: string };
  assert.equal(recovery.category, "model");
  assert.ok(recovery.sessionId);
  assert.ok(recovery.idempotencyKey);
  const history = await deps.repository.getSession(config.parentOid, recovery.sessionId);
  assert.equal(history?.events.length, 1);
  assert.equal(history?.events[0]?.text, "Please preserve my question");
  assert.equal((await deps.repository.listSessions(config.parentOid)).items.length, 1);

  deps.tutor = { reply: async () => "Recovered answer" };
  const retried = await dispatch(makeRequest(recovery.sessionId, recovery.idempotencyKey), createOperations().chat, deps);
  assert.equal(retried.status, 200);
  assert.equal((await deps.repository.getSession(config.parentOid, recovery.sessionId))?.events.length, 2);
});

test("post-model cache write failure is not reported as success and retry repairs without another model call", async () => {
  const blobs = new MemoryBlobStore();
  const deps = dependencies(async () => config.parentOid);
  deps.repository = new SessionRepository(blobs);
  let calls = 0;
  deps.tutor = { reply: async () => {
    calls++;
    blobs.failWritesContaining = "/subjects/";
    return "Durable answer";
  } };
  const makeRequest = () => request("chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "failed-write-retry" },
    body: JSON.stringify({ subject: "Math", language: "en", message: "A durable question" })
  });
  const failed = await dispatch(makeRequest(), createOperations().chat, deps);
  assert.equal(failed.status, 503);
  const { sessionId } = failed.jsonBody as { sessionId: string };
  assert.equal((await deps.repository.getSession(config.parentOid, sessionId))?.events.length, 2);
  blobs.failWritesContaining = undefined;
  const retry = await dispatch(makeRequest(), createOperations().chat, deps);
  assert.equal(retry.status, 200);
  assert.equal(calls, 1);
});

test("storage outage fails explicitly before model invocation without claiming the input was saved", async () => {
  const blobs = new MemoryBlobStore();
  blobs.failWritesContaining = "/interactions/";
  const deps = dependencies(async () => config.parentOid);
  deps.repository = new SessionRepository(blobs);
  let called = false;
  deps.tutor = { reply: async () => { called = true; return "Unexpected"; } };
  const response = await dispatch(request("chat", {
    method: "POST",
    body: JSON.stringify({ subject: "Math", language: "en", message: "Save this if possible" })
  }), createOperations().chat, deps);
  assert.equal(response.status, 503);
  const body = response.jsonBody as { error: string; sessionId: string; idempotencyKey: string };
  assert.match(body.error, /Saving could not be fully confirmed/);
  assert.ok(body.sessionId);
  assert.ok(body.idempotencyKey);
  assert.equal(called, false);
});

test("daily chat quota returns a generic 429 but completed replays do not consume quota", async () => {
  const deps = dependencies(async () => config.parentOid);
  deps.quota = new DailyQuotaRepository(new MemoryBlobStore(), { chatDailyLimit: 1, speechTokenDailyLimit: 1 });
  let calls = 0;
  const diagnostics: DiagnosticEvent[] = [];
  deps.logError = (event) => diagnostics.push(event);
  deps.tutor = { reply: async () => { calls++; return "A saved answer"; } };
  const makeRequest = (key: string) => request("chat", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify({ subject: "Math", language: "en", message: "Private question" })
  });
  const first = await dispatch(makeRequest("quota-first-key"), createOperations().chat, deps);
  const denied = await dispatch(makeRequest("quota-second-key"), createOperations().chat, deps);
  const replay = await dispatch(makeRequest("quota-first-key"), createOperations().chat, deps);
  assert.equal(first.status, 200);
  assert.equal(denied.status, 429);
  assert.deepEqual(denied.jsonBody, {
    error: "Daily request limit reached. Try again after the next UTC day begins."
  });
  assert.equal((denied.headers as Record<string, string>)["Cache-Control"], "no-store");
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.jsonBody, first.jsonBody);
  assert.equal(calls, 1);
  assert.deepEqual(diagnostics, []);
});

test("Speech quota prevents token issuance and authorization failures never reserve quota", async () => {
  const deps = dependencies(async () => config.parentOid);
  deps.quota = new DailyQuotaRepository(new MemoryBlobStore(), { chatDailyLimit: 1, speechTokenDailyLimit: 1 });
  let calls = 0;
  deps.speech = { issue: async () => { calls++; return { token: "private-token", region: "eastus" }; } };
  const first = await dispatch(request("speech/token", { method: "POST" }), createOperations().speechToken, deps);
  const denied = await dispatch(request("speech/token", { method: "POST" }), createOperations().speechToken, deps);
  assert.equal(first.status, 200);
  assert.equal(denied.status, 429);
  assert.equal(JSON.stringify(denied.jsonBody).includes("private-token"), false);
  assert.equal(calls, 1);
  deps.authorize = async () => { throw new AuthenticationError(401); };
  deps.quota = { consume: async () => { assert.fail("Unauthorized requests must not reserve quota"); } };
  const unauthorized = await dispatch(request("speech/token", { method: "POST" }), createOperations().speechToken, deps);
  assert.equal(unauthorized.status, 401);
});

test("failed upstream attempts consume quota, including retries of pending chats", async () => {
  const deps = dependencies(async () => config.parentOid);
  deps.quota = new DailyQuotaRepository(new MemoryBlobStore(), { chatDailyLimit: 1, speechTokenDailyLimit: 1 });
  let modelCalls = 0;
  let speechCalls = 0;
  deps.tutor = { reply: async () => { modelCalls++; throw new Error("Upstream failed"); } };
  deps.speech = { issue: async () => { speechCalls++; throw new Error("Token provider failed"); } };
  const chatRequest = () => request("chat", {
    method: "POST",
    headers: { "Idempotency-Key": "failed-attempt-key" },
    body: JSON.stringify({ subject: "Math", language: "en", message: "Pending question" })
  });
  assert.equal((await dispatch(chatRequest(), createOperations().chat, deps)).status, 503);
  assert.equal((await dispatch(chatRequest(), createOperations().chat, deps)).status, 429);
  assert.equal(modelCalls, 1);
  assert.equal((await dispatch(request("speech/token", { method: "POST" }), createOperations().speechToken, deps)).status, 503);
  assert.equal((await dispatch(request("speech/token", { method: "POST" }), createOperations().speechToken, deps)).status, 429);
  assert.equal(speechCalls, 1);
});

test("quota storage outage fails closed for both upstreams and logs only fixed diagnostic labels", async () => {
  const deps = dependencies(async () => config.parentOid);
  let modelCalls = 0;
  let speechCalls = 0;
  const diagnostics: DiagnosticEvent[] = [];
  deps.logError = (event) => diagnostics.push(event);
  deps.quota = { consume: async () => { throw new QuotaUnavailableError("credential-and-transcript-must-not-leak"); } };
  deps.tutor = { reply: async () => { modelCalls++; return "Unexpected"; } };
  deps.speech = { issue: async () => { speechCalls++; return { token: "secret", region: "eastus" }; } };
  const chat = await dispatch(request("chat", {
    method: "POST",
    body: JSON.stringify({ subject: "Math", language: "en", message: "Private child text" })
  }), createOperations().chat, deps, { operationName: "chat-post" });
  const speech = await dispatch(request("speech/token", { method: "POST" }), createOperations().speechToken, deps,
    { operationName: "speech-token-post" });
  assert.equal(chat.status, 503);
  assert.equal(speech.status, 503);
  assert.equal(modelCalls, 0);
  assert.equal(speechCalls, 0);
  assert.deepEqual(diagnostics, [
    { operation: "chat-post", category: "quota-unavailable" },
    { operation: "speech-token-post", category: "quota-unavailable" }
  ]);
  assert.equal(JSON.stringify([chat.jsonBody, speech.jsonBody]).includes("must-not-leak"), false);
});

test("unexpected model and Speech failures log no request text, credentials, exception messages, or stacks", async () => {
  const deps = dependencies(async () => config.parentOid);
  const diagnostics: DiagnosticEvent[] = [];
  deps.logError = (event) => diagnostics.push(event);
  deps.tutor = { reply: async () => { throw new Error("PRIVATE-TRANSCRIPT-AND-MODEL-CREDENTIAL"); } };
  deps.speech = { issue: async () => { throw new Error("PRIVATE-SPEECH-TOKEN"); } };
  const model = await dispatch(request("chat", {
    method: "POST",
    headers: { Authorization: "Bearer PRIVATE-API-CREDENTIAL" },
    body: JSON.stringify({ subject: "Math", language: "en", message: "PRIVATE-CHILD-TEXT" })
  }), createOperations().chat, deps, { operationName: "chat-post" });
  const speech = await dispatch(request("speech/token", { method: "POST" }), createOperations().speechToken, deps,
    { operationName: "speech-token-post" });
  assert.equal(model.status, 503);
  assert.equal(speech.status, 503);
  assert.deepEqual(diagnostics, [
    { operation: "chat-post", category: "model" },
    { operation: "speech-token-post", category: "speech" }
  ]);
  assert.equal(JSON.stringify([diagnostics, model.jsonBody, speech.jsonBody]).includes("PRIVATE-"), false);
});

test("history pagination exposes continuation and rejects excessive page sizes", async () => {
  const deps = dependencies(async () => config.parentOid);
  for (let i = 0; i < 2; i++) {
    await dispatch(request("chat", {
      method: "POST",
      body: JSON.stringify({ subject: "Math", language: "en", message: `Question ${i}` })
    }), createOperations().chat, deps);
  }
  const first = await dispatch(request("sessions?pageSize=1"), createOperations().listSessions, deps);
  const body = first.jsonBody as { sessions: { id: string }[]; nextCursor: string };
  assert.equal(body.sessions.length, 1);
  assert.ok(body.nextCursor);
  const second = await dispatch(request(`sessions?pageSize=1&cursor=${body.nextCursor}`), createOperations().listSessions, deps);
  const secondBody = second.jsonBody as { sessions: { id: string }[]; nextCursor?: string };
  assert.equal(secondBody.sessions.length, 1);
  assert.notEqual(body.sessions[0]?.id, secondBody.sessions[0]?.id);
  assert.equal(secondBody.nextCursor, undefined);
  assert.equal((await dispatch(request("sessions?pageSize=101"), createOperations().listSessions, deps)).status, 400);
});

test("chronological history preparation is an explicit retryable no-store error, not partial success", async () => {
  const deps = dependencies(async () => config.parentOid);
  const diagnostics: DiagnosticEvent[] = [];
  deps.logError = (event) => diagnostics.push(event);
  deps.repository.getSession = async () => { throw new HistoryPreparingError(); };
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const req = request(`sessions/${id}`);
  req.params.id = id;
  const response = await dispatch(req, createOperations().getSession, deps);
  assert.equal(response.status, 503);
  assert.deepEqual(response.jsonBody, {
    error: "Chronological history is being prepared. Retry this request to continue."
  });
  assert.equal((response.headers as Record<string, string>)["Retry-After"], "1");
  assert.equal((response.headers as Record<string, string>)["Cache-Control"], "no-store");
  assert.deepEqual(diagnostics, []);
});

test("rejects unconfigured origins and answers exact-origin preflight", async () => {
  const deps = dependencies(async () => config.parentOid);
  const denied = await dispatch(
    request("sessions", { headers: { Origin: "https://evil.example" } }),
    createOperations().listSessions,
    deps
  );
  assert.equal(denied.status, 403);
  const preflight = await dispatch(
    request("chat", { method: "OPTIONS", headers: { Origin: config.githubPagesOrigin } }),
    null,
    deps,
    { preflight: true, authenticated: false }
  );
  assert.equal(preflight.status, 204);
  assert.equal((preflight.headers as Record<string, string>)["Access-Control-Allow-Origin"], config.githubPagesOrigin);
});

test("me reports only allowlisted roles and rejects a student when no student identity is configured", async () => {
  const studentOid = "33333333-3333-4333-8333-333333333333";
  const deps = dependencies(async () => config.parentOid);
  assert.deepEqual((await dispatch(request("me"), createOperations().me, deps)).jsonBody, { role: "admin" });
  deps.authorize = async () => studentOid;
  assert.equal((await dispatch(request("me"), createOperations().me, deps)).status, 403);
  deps.config.studentOid = studentOid;
  assert.deepEqual((await dispatch(request("me"), createOperations().me, deps)).jsonBody, { role: "student" });
  deps.authorize = async () => "66666666-6666-4666-8666-666666666666";
  assert.equal((await dispatch(request("me"), createOperations().me, deps)).status, 403);
});

test("every admin operation rejects students before reading bodies or touching reminder storage", async () => {
  const studentOid = "33333333-3333-4333-8333-333333333333";
  const deps = dependencies(async () => studentOid);
  deps.config.studentOid = studentOid;
  deps.reminders.list = async () => assert.fail("Student must not list planning data");
  deps.reminders.save = async () => assert.fail("Student must not write planning data");
  deps.reminders.delete = async () => assert.fail("Student must not delete planning data");
  const ops = createOperations();
  for (const [operation, method] of [
    [ops.listReminders, "GET"], [ops.saveReminder, "POST"], [ops.deleteReminder, "DELETE"]
  ] as const) {
    const response = await dispatch(request("planning/reminders", {
      method, headers: { "X-Role": "admin", "X-MS-CLIENT-PRINCIPAL": "admin" }
    }), operation, deps);
    assert.equal(response.status, 403);
    assert.deepEqual(response.jsonBody, { error: "Forbidden." });
  }
});

test("admin calendar CRUD persists manual planning items and validates dates", async () => {
  const deps = dependencies(async () => config.parentOid);
  const ops = createOperations();
  const created = await dispatch(request("planning/reminders", {
    method: "POST",
    body: JSON.stringify({ title: "Draw a map", date: "2026-11-20" })
  }), ops.saveReminder, deps);
  assert.equal(created.status, 201);
  const reminder = (created.jsonBody as { reminder: { id: string; title: string; date: string; completed: boolean } }).reminder;
  assert.equal(reminder.completed, false);
  assert.deepEqual((await dispatch(request("planning/reminders"), ops.listReminders, deps)).jsonBody, { reminders: [reminder] });
  const updated = await dispatch(request("planning/reminders", {
    method: "POST",
    body: JSON.stringify({ ...reminder, completed: true })
  }), ops.saveReminder, deps);
  assert.equal(updated.status, 200);
  assert.equal((updated.jsonBody as { reminder: { completed: boolean } }).reminder.completed, true);
  const invalid = await dispatch(request("planning/reminders", {
    method: "POST", body: JSON.stringify({ title: "Impossible date", date: "2026-02-30" })
  }), ops.saveReminder, deps);
  assert.equal(invalid.status, 400);
  const deleteRequest = request(`planning/reminders/${reminder.id}`, { method: "DELETE" });
  deleteRequest.params.id = reminder.id;
  assert.equal((await dispatch(deleteRequest, ops.deleteReminder, deps)).status, 204);
  assert.deepEqual((await dispatch(request("planning/reminders"), ops.listReminders, deps)).jsonBody, { reminders: [] });
});

test("student and admin share tutoring, history, piano evidence, and one family quota", async () => {
  const studentOid = "33333333-3333-4333-8333-333333333333";
  const deps = dependencies(async () => studentOid);
  deps.config.studentOid = studentOid;
  const quotaParents: string[] = [];
  deps.quota = { consume: async (oid) => { quotaParents.push(oid); } };
  const ops = createOperations();
  const chat = await dispatch(request("chat", {
    method: "POST", body: JSON.stringify({ subject: "Piano", language: "en", message: "What is middle C?" })
  }), ops.chat, deps);
  assert.equal(chat.status, 200);
  const { sessionId } = chat.jsonBody as { sessionId: string };
  assert.equal((await deps.repository.listSessions(studentOid)).items.length, 0);
  assert.equal((await deps.repository.listSessions(config.parentOid)).items.length, 1);
  const answer = await dispatch(request("practice/piano", {
    method: "POST", body: JSON.stringify({ targetNote: "C4", selectedNote: "D4" })
  }), ops.recordPiano, deps);
  assert.deepEqual(answer.jsonBody, { correct: false });
  await dispatch(request("speech/token", { method: "POST" }), ops.speechToken, deps);
  deps.authorize = async () => config.parentOid;
  const detailRequest = request(`sessions/${sessionId}`);
  detailRequest.params.id = sessionId;
  assert.equal((await dispatch(detailRequest, ops.getSession, deps)).status, 200);
  const piano = (await dispatch(request("practice/piano"), ops.listPiano, deps)).jsonBody as {
    attempts: { correct: boolean; targetNote: string }[];
  };
  assert.equal(piano.attempts.length, 1);
  assert.equal(piano.attempts[0]?.targetNote, "C4");
  assert.equal(piano.attempts[0]?.correct, false);
  assert.deepEqual(quotaParents, [config.parentOid, config.parentOid]);
});

test("new routes require authentication and support exact-origin CORS including DELETE", async () => {
  const deps = dependencies(async () => { throw new AuthenticationError(401); });
  const ops = createOperations();
  for (const operation of [
    ops.me, ops.listReminders, ops.saveReminder, ops.deleteReminder, ops.recordPiano, ops.listPiano,
    ops.getPreferences, ops.putPreferences, ops.createQuiz, ops.answerQuiz, ops.quizAttempts
  ]) {
    assert.equal((await dispatch(request("me"), operation, deps)).status, 401);
  }
  const preflight = await dispatch(request("planning/reminders/id", {
    method: "OPTIONS", headers: { Origin: config.githubPagesOrigin, "Access-Control-Request-Method": "DELETE" }
  }), null, deps, { preflight: true });
  assert.equal(preflight.status, 204);
  assert.match((preflight.headers as Record<string, string>)["Access-Control-Allow-Methods"]!, /DELETE/);
  assert.equal((preflight.headers as Record<string, string>)["Access-Control-Allow-Origin"], config.githubPagesOrigin);
});

test("calendar and piano writes fail with 503 rather than returning success-shaped data", async () => {
  const blobs = new MemoryBlobStore();
  const deps = dependencies(async () => config.parentOid);
  deps.reminders = new ReminderRepository(blobs);
  deps.piano = new PianoRepository(blobs);
  const diagnostics: DiagnosticEvent[] = [];
  deps.logError = (event) => diagnostics.push(event);
  blobs.failWritesContaining = "/admin/";
  const calendar = await dispatch(request("planning/reminders", {
    method: "POST", body: JSON.stringify({ title: "Manual note", date: "2026-11-20" })
  }), createOperations().saveReminder, deps, { operationName: "admin-reminders-save" });
  assert.equal(calendar.status, 503);
  assert.equal("reminder" in (calendar.jsonBody as object), false);
  blobs.failWritesContaining = "/practice/piano/";
  const piano = await dispatch(request("practice/piano", {
    method: "POST", body: JSON.stringify({ targetNote: "C4", selectedNote: "C4" })
  }), createOperations().recordPiano, deps, { operationName: "piano-practice-post" });
  assert.equal(piano.status, 503);
  assert.equal("correct" in (piano.jsonBody as object), false);
  assert.deepEqual(diagnostics, [
    { operation: "admin-reminders-save", category: "persistence" },
    { operation: "piano-practice-post", category: "persistence" }
  ]);
});

test("piano API records chromatic/octave choices as wrong and correct natural choices as right for the shared family", async () => {
  const deps = dependencies(async () => config.parentOid);
  deps.config.studentOid = "33333333-3333-4333-8333-333333333333";
  deps.authorize = async () => deps.config.studentOid!;
  const ops = createOperations();
  for (const [selectedNote, correct] of [["C#4", false], ["C5", false], ["C4", true]] as const) {
    const response = await dispatch(request("practice/piano", {
      method: "POST", body: JSON.stringify({ targetNote: "C4", selectedNote }),
      headers: { Origin: config.githubPagesOrigin }
    }), ops.recordPiano, deps);
    assert.equal(response.status, 200);
    assert.deepEqual(response.jsonBody, { correct });
    assert.equal((response.headers as Record<string, string>)["Access-Control-Allow-Origin"], config.githubPagesOrigin);
  }
  for (const targetNote of ["C#4", "C5"]) {
    const response = await dispatch(request("practice/piano", {
      method: "POST", body: JSON.stringify({ targetNote, selectedNote: "C4" })
    }), ops.recordPiano, deps);
    assert.equal(response.status, 400);
  }
  deps.authorize = async () => config.parentOid;
  const response = await dispatch(request("practice/piano"), ops.listPiano, deps);
  assert.equal(response.status, 200);
  const { attempts } = response.jsonBody as { attempts: { selectedNote: string; correct: boolean }[] };
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts.filter((attempt) => !attempt.correct).map((attempt) => attempt.selectedNote).sort(), ["C#4", "C5"]);
  assert.equal(attempts.find((attempt) => attempt.correct)?.selectedNote, "C4");
});

test("family roles share durable preferences with exact choices and PUT CORS", async () => {
  const deps = dependencies(async () => config.parentOid);
  const ops = createOperations();
  assert.deepEqual((await dispatch(request("preferences"), ops.getPreferences, deps)).jsonBody, config.preferenceDefaults);
  const chosen = { appearance: "sunny", voice: "alternate", mood: "calm" };
  const saved = await dispatch(request("preferences", { method: "PUT", body: JSON.stringify(chosen) }), ops.putPreferences, deps);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.jsonBody, chosen);
  deps.config.studentOid = "33333333-3333-4333-8333-333333333333";
  deps.authorize = async () => deps.config.studentOid!;
  assert.deepEqual((await dispatch(request("preferences"), ops.getPreferences, deps)).jsonBody, chosen);
  const updated = { appearance: "mint", voice: "default", mood: "cheerful" };
  assert.equal((await dispatch(request("preferences", {
    method: "PUT", body: JSON.stringify(updated)
  }), ops.putPreferences, deps)).status, 200);
  deps.authorize = async () => config.parentOid;
  assert.deepEqual((await dispatch(request("preferences"), ops.getPreferences, deps)).jsonBody, updated);
  for (const invalid of [{ mood: "calm" }, { ...updated, mood: "focused" }, { ...updated, eyeContactScore: 90 }]) {
    assert.equal((await dispatch(request("preferences", {
      method: "PUT", body: JSON.stringify(invalid)
    }), ops.putPreferences, deps)).status, 400);
  }
  const preflight = await dispatch(request("preferences", {
    method: "OPTIONS", headers: { Origin: config.githubPagesOrigin, "Access-Control-Request-Method": "PUT" }
  }), null, deps, { preflight: true });
  assert.match((preflight.headers as Record<string, string>)["Access-Control-Allow-Methods"]!, /PUT/);
});

test("preference storage errors surface as errors, not configured-default or write-success responses", async () => {
  const deps = dependencies(async () => config.parentOid);
  deps.preferences.get = async () => { throw new Error("private exception"); };
  deps.preferences.put = async () => { throw new Error("private exception"); };
  const get = await dispatch(request("preferences"), createOperations().getPreferences, deps);
  const put = await dispatch(request("preferences", {
    method: "PUT", body: JSON.stringify(config.preferenceDefaults)
  }), createOperations().putPreferences, deps);
  assert.equal(get.status, 503);
  assert.equal(put.status, 503);
  assert.equal("appearance" in (get.jsonBody as object), false);
  assert.equal("appearance" in (put.jsonBody as object), false);
});

test("chat uses saved or explicit validated moods while completed replays bypass preference and model retrieval", async () => {
  const deps = dependencies(async () => config.parentOid);
  const moods: (string | undefined)[] = [];
  deps.tutor = { reply: async (input) => { moods.push(input.mood); return "Durable answer"; } };
  await deps.preferences.put(config.parentOid, { appearance: "mint", voice: "alternate", mood: "calm" });
  const makeRequest = (key: string, extra = {}) => request("chat", {
    method: "POST", headers: { "Idempotency-Key": key },
    body: JSON.stringify({ subject: "Maths", language: "en", message: "Help with fractions", ...extra })
  });
  const first = await dispatch(makeRequest("mood-replay-key"), createOperations().chat, deps);
  assert.equal(first.status, 200);
  deps.preferences.get = async () => { throw new Error("Must not reload preferences for saved answers"); };
  const replay = await dispatch(makeRequest("mood-replay-key"), createOperations().chat, deps);
  assert.deepEqual(replay.jsonBody, first.jsonBody);
  const overridden = await dispatch(makeRequest("explicit-mood-key", { mood: "cheerful" }), createOperations().chat, deps);
  assert.equal(overridden.status, 200);
  assert.equal((await dispatch(makeRequest("explicit-mood-key", { mood: "gentle" }), createOperations().chat, deps)).status, 409);
  for (const invalid of [{ mood: "focused" }, { eyeContactScore: 50 }]) {
    assert.equal((await dispatch(makeRequest("invalid-mood-key", invalid), createOperations().chat, deps)).status, 400);
  }
  assert.deepEqual(moods, ["calm", "cheerful"]);
});

test("quiz creation hides the key; either family role can submit one real, durable and replay-safe answer", async () => {
  const deps = dependencies(async () => config.parentOid);
  const ops = createOperations();
  deps.config.studentOid = "33333333-3333-4333-8333-333333333333";
  const created = await dispatch(request("quiz", {
    method: "POST", body: JSON.stringify({ subject: "Maths", language: "en" })
  }), ops.createQuiz, deps);
  assert.equal(created.status, 200);
  const body = created.jsonBody as { id: string; question: string; options: string[] };
  assert.deepEqual(Object.keys(body).sort(), ["id", "options", "question", "topic"]);
  assert.equal(body.options.length, 4);
  deps.authorize = async () => deps.config.studentOid!;
  const answerRequest = (answerIndex: number) => {
    const req = request(`quiz/${body.id}/answer`, { method: "POST", body: JSON.stringify({ answerIndex }) });
    req.params.id = body.id;
    return req;
  };
  const answered = await dispatch(answerRequest(0), ops.answerQuiz, deps);
  assert.deepEqual(answered.jsonBody, {
    correct: false, correctIndex: 1, explanation: "Adding two and two gives four."
  });
  assert.deepEqual((await dispatch(answerRequest(0), ops.answerQuiz, deps)).jsonBody, answered.jsonBody);
  assert.equal((await dispatch(answerRequest(1), ops.answerQuiz, deps)).status, 409);
  const history = (await dispatch(request("quiz/attempts"), ops.quizAttempts, deps)).jsonBody as {
    attempts: { id: string; correct: boolean }[];
  };
  assert.equal(history.attempts.length, 1);
  assert.equal(history.attempts[0]?.id, body.id);
  assert.equal(history.attempts[0]?.correct, false);
});

test("successive generated lessons rotate topics and visual types from stored history", async () => {
  const deps = dependencies(async () => config.parentOid);
  const ops = createOperations();
  const seen: string[] = [];
  deps.quizGenerator = { generate: async (_input, _recent, _context, visual, topic) => {
    assert.ok(topic && visual);
    seen.push(topic.id);
    return {
      lesson: "Let's explore an idea.", question: `Question ${seen.length}?`,
      options: ["1", "2", "3", "4"], correctIndex: 0, explanation: "A fixture explanation.", visual
    };
  } };
  const create = (supportsNumberLine?: unknown) => dispatch(request("quiz", {
    method: "POST", body: JSON.stringify({ subject: "Maths", language: "en", ...(supportsNumberLine !== undefined ? { supportsNumberLine } : {}) })
  }), ops.createQuiz, deps);
  const first = await create();
  const second = await create();
  const third = await create(true);
  const fourth = await create();
  const fifth = await create(false);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 200);
  assert.equal(fourth.status, 200);
  assert.equal(fifth.status, 200);
  assert.deepEqual(seen, ["equal-groups", "fractions", "number-line", "equal-groups", "fractions"]);
  assert.equal((first.jsonBody as { visual: { kind: string }; lesson: string }).visual.kind, "array");
  assert.equal((second.jsonBody as { visual: { kind: string } }).visual.kind, "fraction");
  assert.equal((third.jsonBody as { visual: { kind: string } }).visual.kind, "numberLine");
  assert.equal((fourth.jsonBody as { visual: { kind: string } }).visual.kind, "array");
  assert.equal((fifth.jsonBody as { visual: { kind: string } }).visual.kind, "fraction");
  assert.equal((await create("true")).status, 400);
  assert.equal((await create(null)).status, 400);
  assert.equal(seen.length, 5);
  assert.equal((first.jsonBody as { lesson: string }).lesson, "Let's explore an idea.");

  deps.quizGenerator = { generate: async () => ({
    lesson: "A line has steps.", question: "How many hops?", options: ["1", "2", "3", "4"],
    correctIndex: 1, explanation: "Two hops.", visual: { kind: "numberLine", from: 0, to: 2 }
  }) };
  assert.equal((await create()).status, 503);
});

test("quiz generation shares the model quota and unsupported current affairs never invoke a model", async () => {
  const deps = dependencies(async () => config.parentOid);
  deps.quota = new DailyQuotaRepository(new MemoryBlobStore(), { chatDailyLimit: 1, speechTokenDailyLimit: 1 });
  let generated = 0;
  const original = deps.quizGenerator;
  deps.quizGenerator = { generate: async (...args) => { generated++; return original.generate(...args); } };
  for (const subject of ["Current Affairs", "Current Events", "Nyheter"]) {
    const result = await dispatch(request("quiz", {
      method: "POST", body: JSON.stringify({ subject, language: "en" })
    }), createOperations().createQuiz, deps);
    assert.equal(result.status, 422);
  }
  assert.equal(generated, 0);
  assert.equal((await dispatch(request("quiz", {
    method: "POST", body: JSON.stringify({ subject: "Maths", language: "en" })
  }), createOperations().createQuiz, deps)).status, 200);
  assert.equal((await dispatch(request("quiz", {
    method: "POST", body: JSON.stringify({ subject: "Science", language: "en" })
  }), createOperations().createQuiz, deps)).status, 429);
  assert.equal((await dispatch(request("chat", {
    method: "POST", body: JSON.stringify({ subject: "Maths", language: "en", message: "More help" })
  }), createOperations().chat, deps)).status, 429);
  assert.equal(generated, 1);
});

test("visual quiz generation receives bounded earlier conversation context for the selected subject", async () => {
  const deps = dependencies(async () => config.parentOid);
  const ops = createOperations();
  const chat = request("chat", { method: "POST", body: JSON.stringify({
    subject: "norwegian", language: "en", message: "How do Norwegian verbs work?"
  }) });
  assert.equal((await dispatch(chat, ops.chat, deps)).status, 200);
  const original = deps.quizGenerator;
  let context: { subjectSummary: string; recentQuestions: string[] } | undefined;
  deps.quizGenerator = { generate: async (input, recent, prior) => {
    context = prior;
    return original.generate(input, recent, prior);
  } };
  const result = await dispatch(request("quiz", {
    method: "POST", body: JSON.stringify({ subject: "norwegian", language: "en" })
  }), ops.createQuiz, deps);
  assert.equal(result.status, 200);
  assert.ok(context?.recentQuestions.includes("How do Norwegian verbs work?"));
  assert.ok(context.subjectSummary.length <= 1200);
});

test("quiz storage and model errors never fabricate questions or grades", async () => {
  const deps = dependencies(async () => config.parentOid);
  const blobs = new MemoryBlobStore();
  deps.quiz = new QuizRepository(blobs);
  const createRequest = () => request("quiz", {
    method: "POST", body: JSON.stringify({ subject: "Maths", language: "en" })
  });
  blobs.failWritesContaining = "/quiz/questions/";
  const failedCreation = await dispatch(createRequest(), createOperations().createQuiz, deps);
  assert.equal(failedCreation.status, 503);
  assert.equal((failedCreation.jsonBody as { category: string }).category, "persistence");
  assert.equal("question" in (failedCreation.jsonBody as object), false);
  blobs.failWritesContaining = undefined;
  deps.quizGenerator = { generate: async () => ({
    question: "What is 3 + 3?", options: ["4", "5", "6", "7"], correctIndex: 2, explanation: "Three plus three is six."
  }) };
  const created = await dispatch(createRequest(), createOperations().createQuiz, deps);
  const id = (created.jsonBody as { id: string }).id;
  blobs.failWritesContaining = "/quiz/questions/";
  const answer = request(`quiz/${id}/answer`, { method: "POST", body: JSON.stringify({ answerIndex: 2 }) });
  answer.params.id = id;
  const failedAnswer = await dispatch(answer, createOperations().answerQuiz, deps);
  assert.equal(failedAnswer.status, 503);
  assert.equal("correct" in (failedAnswer.jsonBody as object), false);
  deps.quizGenerator = { generate: async () => { throw new Error("private model exception"); } };
  const modelFailure = await dispatch(createRequest(), createOperations().createQuiz, deps);
  assert.equal(modelFailure.status, 503);
  assert.equal((modelFailure.jsonBody as { category: string }).category, "model");
  assert.equal(JSON.stringify(modelFailure.jsonBody).includes("private model exception"), false);
  assert.equal("question" in (modelFailure.jsonBody as object), false);
});
