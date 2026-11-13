import assert from "node:assert/strict";
import { test } from "node:test";
import { InputValidationError, validatePreferences, type BlobValue, type JsonBlobStore } from "../src/contracts.js";
import { PreferencesRepository, readPreferenceDefaults } from "../src/preferences.js";
import {
  QuizRepository, QuizAnswerConflictError, QuizDuplicateError, QuizNotFoundError,
  UnsupportedQuizSubjectError, validateGeneratedQuiz, validateQuizAnswer, validateQuizInput, chooseMathVisual,
  type GeneratedQuiz
} from "../src/quiz.js";

class MemoryBlobStore implements JsonBlobStore {
  readonly values = new Map<string, { value: unknown; etag: string }>();
  failReads = false;
  failWrites = false;
  conflictAlways = false;
  async read<T>(key: string): Promise<BlobValue<T> | null> {
    if (this.failReads) throw new Error("Read failed");
    const item = this.values.get(key);
    return item ? { value: structuredClone(item.value) as T, etag: item.etag } : null;
  }
  async create<T>(key: string, value: T): Promise<boolean> {
    if (this.failWrites) throw new Error("Write failed");
    if (this.conflictAlways || this.values.has(key)) return false;
    this.values.set(key, { value: structuredClone(value), etag: "1" });
    return true;
  }
  async replace<T>(key: string, value: T, etag: string): Promise<boolean> {
    if (this.failWrites) throw new Error("Write failed");
    const item = this.values.get(key);
    if (this.conflictAlways || !item || item.etag !== etag) return false;
    this.values.set(key, { value: structuredClone(value), etag: String(Number(etag) + 1) });
    return true;
  }
  async list(prefix: string, pageSize: number, continuationToken?: string) {
    const keys = [...this.values.keys()].filter((key) =>
      key.startsWith(prefix) && (!continuationToken || key > continuationToken)
    ).sort();
    return { keys: keys.slice(0, pageSize), ...(keys.length > pageSize ? { continuationToken: keys[pageSize - 1] } : {}) };
  }
}

const parent = "22222222-2222-4222-8222-222222222222";
const otherFamily = "66666666-6666-4666-8666-666666666666";
const input = { subject: "Maths", language: "en" as const };
const generated: GeneratedQuiz = {
  question: "What is 2 + 2?", options: ["3", "4", "5", "6"], correctIndex: 1,
  explanation: "Adding two and two gives four."
};

test("preference enums and configured defaults reject partial, extra, or invalid choices", () => {
  assert.deepEqual(readPreferenceDefaults({ DEFAULT_APPEARANCE: "mint", DEFAULT_VOICE: "alternate", DEFAULT_MOOD: "calm" }), {
    appearance: "mint", voice: "alternate", mood: "calm"
  });
  for (const invalid of [
    null, [], {}, { appearance: "rose", voice: "default" },
    { appearance: "blue", voice: "default", mood: "gentle" },
    { appearance: "rose", voice: "other", mood: "gentle" },
    { appearance: "rose", voice: "default", mood: "excited" },
    { appearance: "rose", voice: "default", mood: "gentle", eyeContactScore: 100 }
  ]) assert.throws(() => validatePreferences(invalid), InputValidationError);
  assert.throws(() => readPreferenceDefaults({ DEFAULT_MOOD: "" }));
  assert.throws(() => readPreferenceDefaults({ DEFAULT_APPEARANCE: "Rose" }));
});

test("only absent preference data uses explicit defaults; writes survive restarts and errors never masquerade as defaults", async () => {
  const blobs = new MemoryBlobStore();
  const defaults = readPreferenceDefaults({ DEFAULT_APPEARANCE: "sunny", DEFAULT_MOOD: "calm" });
  const repository = new PreferencesRepository(blobs, defaults);
  assert.deepEqual(await repository.get(parent), defaults);
  assert.equal(blobs.values.size, 0);
  const saved = { appearance: "mint", voice: "alternate", mood: "cheerful" } as const;
  assert.deepEqual(await repository.put(parent, saved), saved);
  assert.deepEqual(await new PreferencesRepository(blobs, defaults).get(parent), saved);
  assert.deepEqual(await repository.get(otherFamily), defaults);
  blobs.failReads = true;
  await assert.rejects(repository.get(parent));
  blobs.failReads = false;
  blobs.failWrites = true;
  await assert.rejects(repository.put(parent, defaults));
  blobs.failWrites = false;
  assert.deepEqual(await repository.get(parent), saved);
  blobs.values.set(`parents/${parent}/preferences.json`, { value: { mood: "invalid" }, etag: "2" });
  await assert.rejects(repository.get(parent));
});

test("concurrent preference replacements commit whole choices and unconfirmed writes fail closed", async () => {
  const blobs = new MemoryBlobStore();
  const repository = new PreferencesRepository(blobs, readPreferenceDefaults({}));
  const first = { appearance: "rose", voice: "alternate", mood: "calm" } as const;
  const second = { appearance: "mint", voice: "default", mood: "cheerful" } as const;
  await Promise.all([repository.put(parent, first), repository.put(parent, second)]);
  assert.ok([first, second].some((value) => JSON.stringify(value) === JSON.stringify(blobs.values.get(`parents/${parent}/preferences.json`)!.value)));
  blobs.conflictAlways = true;
  await assert.rejects(repository.put(parent, first));
});

test("quiz validation restricts stable subjects, four distinct plain options, answer range, and generated fields", () => {
  assert.deepEqual(validateQuizInput({ subject: "matematikk", language: "nb" }), { subject: "Maths", language: "nb" });
  for (const subject of ["Current Affairs", "Current Events", "Nyheter", "unknown", "__proto__"]) {
    assert.throws(() => validateQuizInput({ subject, language: "en" }), UnsupportedQuizSubjectError);
  }
  assert.throws(() => validateQuizInput({ subject: "Maths", language: "fr" }), InputValidationError);
  for (const invalid of [
    { ...generated, options: ["One", "Two", "Three"] },
    { ...generated, options: ["Same", "same", "Other", "Another"] },
    { ...generated, options: ["<script>bad</script>", "Two", "Three", "Four"] },
    { ...generated, correctIndex: 4 }, { ...generated, correctIndex: 0.5 },
    { ...generated, explanation: "" }, { ...generated, extra: true }
  ]) assert.throws(() => validateGeneratedQuiz(invalid));
  for (const invalid of [{ answerIndex: -1 }, { answerIndex: 4 }, { answerIndex: "1" }, { answerIndex: 0, correct: true }]) {
    assert.throws(() => validateQuizAnswer(invalid), InputValidationError);
  }
});

test("quiz keys stay private on creation; durable answers are actual, immutable comparisons scoped to the family", async () => {
  const blobs = new MemoryBlobStore();
  const repository = new QuizRepository(blobs);
  const created = await repository.create(parent, input, generated);
  assert.deepEqual(Object.keys(created).sort(), ["id", "options", "question"]);
  const restarted = new QuizRepository(blobs);
  const result = await restarted.answer(parent, created.id, 0);
  assert.deepEqual(result, { correct: false, correctIndex: 1, explanation: generated.explanation });
  assert.deepEqual(await restarted.answer(parent, created.id, 0), result);
  assert.equal((await restarted.attempts(parent)).items.length, 1);
  await assert.rejects(restarted.answer(parent, created.id, 1), QuizAnswerConflictError);
  await assert.rejects(restarted.answer(otherFamily, created.id, 0), QuizNotFoundError);
  assert.deepEqual((await restarted.attempts(otherFamily)).items, []);
});

test("visual quiz scenes are bounded, stored with the question, and do not reveal its answer", async () => {
  const visual = { kind: "array", rows: 2, columns: 3, icon: "star" } as const;
  const blobs = new MemoryBlobStore();
  const repository = new QuizRepository(blobs);
  const created = await repository.create(parent, input, { ...generated, visual });
  assert.deepEqual(created.visual, visual);
  assert.equal("correctIndex" in created, false);
  assert.deepEqual((await new QuizRepository(blobs).answer(parent, created.id, 1)).correct, true);
  assert.deepEqual((await repository.recent(parent, input)).visuals, [visual]);
  await assert.rejects(repository.create(parent, input, { ...generated, question: "Count this new-looking grid?", visual: { ...visual, icon: "apple" } }), QuizDuplicateError);
  for (let index = 0; index < 20; index++) {
    const choice = chooseMathVisual([visual]);
    assert.ok(choice.kind !== "array" || choice.rows !== visual.rows || choice.columns !== visual.columns);
  }
  const cards = { kind: "cards", style: "timeline", items: ["Before", "After"] } as const;
  assert.deepEqual(validateGeneratedQuiz({ ...generated, visual: cards }).visual, cards);
  assert.deepEqual(validateGeneratedQuiz({ ...generated, visual: { kind: "fraction", parts: 8, filled: 3 } }).visual,
    { kind: "fraction", parts: 8, filled: 3 });
  for (const invalid of [
    { ...visual, rows: 0 }, { ...visual, columns: 9 }, { ...visual, icon: "url" },
    { ...visual, script: "bad" }, { kind: "cards", style: "timeline", items: ["Only one"] },
    { kind: "fraction", parts: 2, filled: 3 },
    { kind: "cards", style: "places", items: ["Safe", "<script>"] },
    { kind: "cards", style: "words", items: ["Safe", "https://example.test"] }
  ]) assert.throws(() => validateGeneratedQuiz({ ...generated, visual: invalid }));
});

test("recent fingerprints suppress normalized and competing duplicate questions without automatic extra generation", async () => {
  const blobs = new MemoryBlobStore();
  const repository = new QuizRepository(blobs);
  const results = await Promise.allSettled([
    repository.create(parent, input, generated),
    new QuizRepository(blobs).create(parent, input, generated)
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  const rejected = results.find((item) => item.status === "rejected") as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof QuizDuplicateError);
  assert.deepEqual(await repository.recentQuestions(parent, input), [generated.question]);
  await assert.rejects(repository.create(parent, input, { ...generated, question: "WHAT is 2 + 2??" }), QuizDuplicateError);
  assert.equal([...blobs.values.keys()].filter((key) => key.includes("/questions/")).length, 1);
});

test("quiz history paginates all real grades, including continuation across unanswered questions", async () => {
  const blobs = new MemoryBlobStore();
  const repository = new QuizRepository(blobs);
  for (let index = 0; index < 3; index++) {
    await repository.create(parent, input, { ...generated, question: `What is ${index} plus two?` });
  }
  const ids = [...blobs.values.keys()].filter((key) => key.includes("/questions/")).sort()
    .map((key) => (blobs.values.get(key)!.value as { id: string }).id);
  await repository.answer(parent, ids[1]!, 1);
  await repository.answer(parent, ids[2]!, 0);
  const first = await repository.attempts(parent, undefined, 1);
  assert.deepEqual(first.items, []);
  assert.ok(first.nextCursor);
  const second = await repository.attempts(parent, first.nextCursor, 1);
  assert.equal(second.items[0]?.correct, true);
  const third = await repository.attempts(parent, second.nextCursor, 1);
  assert.equal(third.items[0]?.correct, false);
  assert.equal(third.nextCursor, undefined);
  await assert.rejects(repository.attempts(otherFamily, first.nextCursor), InputValidationError);
});

test("failed question/answer writes and malformed grading state never report a successful grade", async () => {
  const blobs = new MemoryBlobStore();
  const repository = new QuizRepository(blobs);
  blobs.failWrites = true;
  await assert.rejects(repository.create(parent, input, generated));
  blobs.failWrites = false;
  const quiz = await repository.create(parent, input, generated);
  blobs.failWrites = true;
  await assert.rejects(repository.answer(parent, quiz.id, 1));
  blobs.failWrites = false;
  assert.deepEqual((await repository.attempts(parent)).items, []);
  const key = [...blobs.values.keys()].find((item) => item.includes("/questions/"))!;
  const value = blobs.values.get(key)!.value as object;
  for (const answer of [null, false, { answerIndex: 0, correct: true, at: new Date().toISOString() }]) {
    blobs.values.set(key, { etag: "2", value: { ...value, answer } });
    await assert.rejects(repository.attempts(parent));
  }
});
