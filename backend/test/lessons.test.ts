import assert from "node:assert/strict";
import { test } from "node:test";
import { InputValidationError, PersistenceConflictError, type BlobValue, type JsonBlobStore } from "../src/contracts.js";
import { LessonRepository } from "../src/lessons.js";
import { QuizAnswerConflictError, QuizRepository } from "../src/quiz.js";

class MemoryBlobs implements JsonBlobStore {
  readonly values = new Map<string, { value: unknown; etag: string }>();
  failLessonWrites = false;
  async read<T>(key: string): Promise<BlobValue<T> | null> {
    const stored = this.values.get(key);
    return stored ? { value: structuredClone(stored.value) as T, etag: stored.etag } : null;
  }
  async create<T>(key: string, value: T) {
    if (this.failLessonWrites && key.includes("/lessons/")) throw new Error("Unavailable");
    if (this.values.has(key)) return false;
    this.values.set(key, { value: structuredClone(value), etag: "1" });
    return true;
  }
  async replace<T>(key: string, value: T, etag: string) {
    if (this.failLessonWrites && key.includes("/lessons/")) throw new Error("Unavailable");
    const stored = this.values.get(key);
    if (!stored || stored.etag !== etag) return false;
    this.values.set(key, { value: structuredClone(value), etag: String(Number(etag) + 1) });
    return true;
  }
  async list() { return { keys: [] }; }
}

const parent = "22222222-2222-4222-8222-222222222222";
const input = { subject: "Maths", language: "en" as const };
function setup() {
  const blobs = new MemoryBlobs();
  const quiz = new QuizRepository(blobs);
  let date = new Date("2026-11-16T23:59:00Z");
  let number = 0;
  const now = () => date;
  const lessons = new LessonRepository(blobs, quiz, now);
  const generate = () => quiz.create(parent, input, {
    question: `Question ${++number}?`, options: ["One", "Two", "Three", "Four"],
    correctIndex: 1, explanation: "Two is the saved answer."
  });
  return { blobs, quiz, lessons, now, generate, tomorrow: () => { date = new Date("2026-11-17T00:00:00Z"); } };
}

test("daily lessons survive repository restart and early ending with the exact unanswered question", async () => {
  const { blobs, quiz, lessons, now, generate } = setup();
  const started = await lessons.next(parent, input, generate);
  const restarted = new LessonRepository(blobs, new QuizRepository(blobs), now);
  assert.deepEqual(await restarted.get(parent, input), started);
  const resumed = await restarted.next(parent, input, () => { throw new Error("Must reuse current question"); });
  assert.deepEqual(resumed, started);
  assert.equal(resumed.completed, 0);
  assert.equal(resumed.answer, null);
  assert.equal("correctIndex" in resumed.current!, false);
  assert.equal((await quiz.state(parent, resumed.current!.id)).answer, null);
});

test("same-answer retries and concurrent grading count exactly once; conflicting answers cannot change it", async () => {
  const { lessons, generate } = setup();
  const started = await lessons.next(parent, input, generate);
  const submit = () => lessons.answer(parent, input, started.date, started.current!.id, 1);
  const results = await Promise.all([submit(), submit(), submit()]);
  assert.ok(results.every(saved => saved.lesson.completed === 1 && saved.result.correct));
  assert.equal((await submit()).lesson.completed, 1);
  await assert.rejects(lessons.answer(parent, input, started.date, started.current!.id, 0), QuizAnswerConflictError);
  const second = await lessons.next(parent, input, generate);
  assert.notEqual(second.current!.id, started.current!.id);
  assert.equal((await submit()).lesson.current!.id, second.current!.id);
  assert.equal((await submit()).lesson.completed, 1);
});

test("lost progress writes reconcile saved quiz grading without a second answer submission", async () => {
  const { blobs, quiz, lessons, now, generate } = setup();
  const started = await lessons.next(parent, input, generate);
  blobs.failLessonWrites = true;
  await assert.rejects(lessons.answer(parent, input, started.date, started.current!.id, 0));
  assert.equal((await quiz.state(parent, started.current!.id)).answer!.correct, false);
  blobs.failLessonWrites = false;
  const restarted = new LessonRepository(blobs, quiz, now);
  const restored = await restarted.get(parent, input);
  assert.equal(restored.completed, 1);
  assert.equal(restored.answer!.correct, false);
  assert.equal(restored.answer!.correctIndex, 1);
  assert.equal((await restarted.get(parent, input)).completed, 1);
});

test("UTC rollover resets progress, separates subjects/languages/families and excludes unrelated quizzes", async () => {
  const { lessons, generate, tomorrow } = setup();
  const unrelated = await generate();
  await assert.rejects(lessons.answer(parent, input, "2026-11-16", unrelated.id, 1), PersistenceConflictError);
  const started = await lessons.next(parent, input, generate);
  await lessons.answer(parent, input, started.date, started.current!.id, 1);
  for (const [family, selection] of [
    ["other-family", input], [parent, { subject: "Science", language: "en" as const }],
    [parent, { ...input, language: "nb" as const }]
  ] as const) {
    const empty = await lessons.get(family, selection);
    assert.equal(empty.completed, 0); assert.equal(empty.current, null);
  }
  tomorrow();
  const fresh = await lessons.get(parent, input);
  assert.equal(fresh.date, "2026-11-17"); assert.equal(fresh.timeZone, "UTC");
  assert.equal(fresh.completed, 0); assert.equal(fresh.current, null);
  assert.equal((await lessons.get(parent, input, "2026-11-16")).completed, 1);
  await assert.rejects(lessons.get(parent, input, "2026-11-18"), InputValidationError);
  await assert.rejects(lessons.get(parent, input, "2026-02-30"), InputValidationError);
});

test("concurrent question issuance preserves one current question, and practice can continue beyond ten", async () => {
  const { lessons, generate } = setup();
  const [first, duplicate] = await Promise.all([
    lessons.next(parent, input, generate), lessons.next(parent, input, generate)
  ]);
  assert.equal(first.current!.id, duplicate.current!.id);
  let current = first;
  for (let index = 0; index < 11; index++) {
    const saved = await lessons.answer(parent, input, current.date, current.current!.id, 1);
    assert.equal(saved.lesson.completed, index + 1);
    current = await lessons.next(parent, input, generate);
  }
  assert.equal(current.completed, 11); assert.equal(current.target, 10);
});

test("the explicitly chosen practice language survives restart without mixing lesson records", async () => {
  const { blobs, quiz, lessons, now } = setup();
  assert.equal((await lessons.selectedLanguage(parent, "en")).subject, "Spanish");
  const french = { subject: "French", language: "en" as const };
  const question = () => quiz.create(parent, french, { question: "Bonjour means what?",
    options: ["Hello", "Goodbye", "Thanks", "Please"], correctIndex: 0, explanation: "Bonjour is a greeting." });
  const started = await lessons.next(parent, french, question);
  const restarted = new LessonRepository(blobs, quiz, now);
  assert.deepEqual(await restarted.selectedLanguage(parent, "en"), french);
  assert.deepEqual(await restarted.get(parent, await restarted.selectedLanguage(parent, "en")), started);
  assert.equal((await restarted.selectedLanguage(parent, "nb")).subject, "Spanish");
  assert.equal((await restarted.selectedLanguage("other-family", "en")).subject, "Spanish");
});

test("malformed progress fails closed rather than displaying invented counts or leaked answer keys", async () => {
  const { blobs, lessons, generate } = setup();
  await lessons.next(parent, input, generate);
  const key = [...blobs.values.keys()].find(key => key.includes("/lessons/"))!;
  const stored = blobs.values.get(key)!;
  const original = structuredClone(stored.value) as Record<string, unknown>;
  stored.value = null;
  await assert.rejects(lessons.get(parent, input), /Invalid lesson storage/);
  stored.value = { ...original, completedIds: ["fabricated"] };
  await assert.rejects(lessons.get(parent, input), /Invalid lesson storage/);
  stored.value = { ...original, current: { ...(original.current as object), correctIndex: 0 } };
  await assert.rejects(lessons.get(parent, input), /Invalid lesson question storage/);
});
