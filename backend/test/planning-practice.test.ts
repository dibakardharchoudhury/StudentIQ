import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { BlobValue, JsonBlobStore } from "../src/contracts.js";
import { InputValidationError } from "../src/contracts.js";
import {
  ReminderRepository, ReminderConflictError, ReminderLimitError, ReminderNotFoundError,
  validateReminderInput
} from "../src/reminders.js";
import { PianoRepository, validatePianoInput } from "../src/piano.js";

class MemoryBlobStore implements JsonBlobStore {
  readonly values = new Map<string, { value: unknown; etag: string }>();
  failWrites = false;
  async read<T>(key: string): Promise<BlobValue<T> | null> {
    const item = this.values.get(key);
    return item ? { value: structuredClone(item.value) as T, etag: item.etag } : null;
  }
  async create<T>(key: string, value: T): Promise<boolean> {
    if (this.failWrites) throw new Error("Write failed");
    if (this.values.has(key)) return false;
    this.values.set(key, { value: structuredClone(value), etag: "1" });
    return true;
  }
  async replace<T>(key: string, value: T, etag: string): Promise<boolean> {
    if (this.failWrites) throw new Error("Write failed");
    const item = this.values.get(key);
    if (!item || item.etag !== etag) return false;
    this.values.set(key, { value: structuredClone(value), etag: String(Number(etag) + 1) });
    return true;
  }
  async list(prefix: string, pageSize: number, continuationToken?: string) {
    const keys = [...this.values.keys()].filter((key) =>
      key.startsWith(prefix) && (!continuationToken || key > continuationToken)
    ).sort();
    return {
      keys: keys.slice(0, pageSize),
      ...(keys.length > pageSize ? { continuationToken: keys[pageSize - 1] } : {})
    };
  }
}

const parent = "22222222-2222-4222-8222-222222222222";
const stranger = "66666666-6666-4666-8666-666666666666";

test("reminders require real ISO calendar dates, bounded titles, exact create/update shapes", () => {
  assert.deepEqual(validateReminderInput({ title: "  Practise notes  ", date: "2028-02-29" }), {
    title: "Practise notes", date: "2028-02-29"
  });
  for (const invalid of [
    null, [], { title: " ", date: "2026-11-20" },
    { title: "x".repeat(121), date: "2026-11-20" },
    { title: "New\nline", date: "2026-11-20" },
    { title: "Plan", date: "2026-02-29" },
    { title: "Plan", date: "2026-11-20T00:00:00Z" },
    { title: "Plan", date: "2026-11-20\n" },
    { title: "Plan", date: "0000-01-01" },
    { title: "Plan", date: "2026-11-20", completed: true },
    { id: randomUUID(), title: "Plan", date: "2026-11-20" },
    { id: "../../elsewhere", title: "Plan", date: "2026-11-20", completed: false }
  ]) assert.throws(() => validateReminderInput(invalid), InputValidationError);
});

test("reminder optimistic concurrency preserves independent writes, durable retries, updates, and deletes", async () => {
  const blobs = new MemoryBlobStore();
  const repository = new ReminderRepository(blobs);
  const [first, second] = await Promise.all([
    repository.save(parent, { title: "Piano", date: "2026-11-20" }, "first-planning-key"),
    new ReminderRepository(blobs).save(parent, { title: "Map", date: "2026-11-21" })
  ]);
  assert.equal((await new ReminderRepository(blobs).list(parent)).length, 2);
  assert.deepEqual(await repository.list(stranger), []);
  const retry = await repository.save(parent, { title: "Piano", date: "2026-11-20" }, "first-planning-key");
  assert.equal(retry.created, false);
  assert.equal(retry.reminder.id, first.reminder.id);
  await assert.rejects(repository.save(parent, { title: "Different", date: "2026-11-20" }, "first-planning-key"), ReminderConflictError);
  await repository.save(parent, { ...first.reminder, completed: true });
  assert.equal((await repository.list(parent))[0]?.completed, true);
  await repository.delete(parent, second.reminder.id);
  assert.equal((await repository.list(parent)).length, 1);
  await assert.rejects(repository.save(parent, second.reminder), ReminderNotFoundError);
  blobs.failWrites = true;
  await assert.rejects(repository.delete(parent, first.reminder.id));
  assert.equal((await repository.list(parent)).length, 1);
});

test("calendar capacity rejects new items explicitly without evicting any saved reminders", async () => {
  const blobs = new MemoryBlobStore();
  const reminders = Array.from({ length: 250 }, (_, index) => ({
    id: randomUUID(), title: `Planning item ${index}`, date: "2026-11-20", completed: false
  }));
  await blobs.create(`parents/${parent}/admin/reminders.json`, { version: 1, reminders });
  const repository = new ReminderRepository(blobs);
  await assert.rejects(repository.save(parent, { title: "Overflow", date: "2026-11-21" }), ReminderLimitError);
  assert.equal((await repository.list(parent)).length, 250);
  await repository.save(parent, { ...reminders[0]!, completed: true });
  assert.equal((await repository.list(parent)).length, 250);
});

test("piano targets stay natural while selections accept the displayed chromatic octave and cannot supply grades", () => {
  for (const note of ["C4", "D4", "E4", "F4", "G4", "A4", "B4"]) {
    assert.deepEqual(validatePianoInput({ targetNote: note, selectedNote: note }), { targetNote: note, selectedNote: note });
  }
  for (const note of ["C#4", "D#4", "F#4", "G#4", "A#4", "C5"]) {
    assert.deepEqual(validatePianoInput({ targetNote: "C4", selectedNote: note }), { targetNote: "C4", selectedNote: note });
    assert.throws(() => validatePianoInput({ targetNote: note, selectedNote: note }), InputValidationError);
  }
  for (const invalid of [
    null, [], { targetNote: "C5", selectedNote: "C4" },
    ...["C3", "D5", "B#4", "Db4", "C♯4", "c4", " C4", "C4 "].map((selectedNote) => ({ targetNote: "C4", selectedNote })),
    { targetNote: "c4", selectedNote: "C4" },
    { targetNote: "C4", selectedNote: "C4", correct: true },
    { targetNote: "C4", selectedNote: "C4", at: "2026-11-13T00:00:00Z" }
  ]) assert.throws(() => validatePianoInput(invalid), InputValidationError);
});

test("chromatic and upper-octave piano selections persist as incorrect evidence, alongside correct natural choices", async () => {
  const blobs = new MemoryBlobStore();
  const repository = new PianoRepository(blobs);
  for (const selectedNote of ["C#4", "D#4", "F#4", "G#4", "A#4", "C5"] as const) {
    assert.equal(await repository.record(parent, { targetNote: "C4", selectedNote }), false);
  }
  assert.equal(await repository.record(parent, { targetNote: "C4", selectedNote: "C4" }), true);
  const saved = (await new PianoRepository(blobs).list(parent)).items;
  assert.equal(saved.length, 7);
  assert.equal(saved.filter((item) => item.correct).length, 1);
  assert.ok(saved.every((item) => item.targetNote === "C4" && item.correct === (item.selectedNote === "C4")));
  assert.deepEqual(saved.map((item) => item.selectedNote).sort(), ["C#4", "D#4", "F#4", "G#4", "A#4", "C5", "C4"].sort());
});

test("piano records server-computed answers durably, with unique IDs, timestamps, and complete pagination", async () => {
  const blobs = new MemoryBlobStore();
  const repository = new PianoRepository(blobs);
  assert.equal(await repository.record(parent, { targetNote: "C4", selectedNote: "C4" }), true);
  assert.equal(await repository.record(parent, { targetNote: "C4", selectedNote: "D4" }), false);
  const first = await new PianoRepository(blobs).list(parent, undefined, 1);
  assert.ok(first.nextCursor);
  const second = await repository.list(parent, first.nextCursor, 1);
  assert.equal(second.nextCursor, undefined);
  const attempts = [...first.items, ...second.items];
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[0]!.id, attempts[1]!.id);
  assert.ok(attempts.every((item) => item.at === new Date(item.at).toISOString()));
  assert.deepEqual(attempts.map((item) => item.correct).sort(), [false, true]);
  assert.deepEqual((await repository.list(stranger)).items, []);
  await assert.rejects(repository.list(stranger, first.nextCursor), InputValidationError);
  await assert.rejects(repository.list(parent, undefined, 101), InputValidationError);
  blobs.failWrites = true;
  await assert.rejects(repository.record(parent, { targetNote: "E4", selectedNote: "E4" }));
  assert.equal((await repository.list(parent)).items.length, 2);
});

test("corrupt planning or practice storage fails rather than inventing empty history or grades", async () => {
  const blobs = new MemoryBlobStore();
  await blobs.create(`parents/${parent}/admin/reminders.json`, { version: 1, reminders: [{ title: "Invalid" }] });
  await assert.rejects(new ReminderRepository(blobs).list(parent));
  await blobs.create(`parents/${parent}/practice/piano/bad.json`, {
    id: randomUUID(), targetNote: "C4", selectedNote: "D4", correct: true, at: new Date().toISOString()
  });
  await assert.rejects(new PianoRepository(blobs).list(parent));
});
