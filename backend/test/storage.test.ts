import assert from "node:assert/strict";
import { test } from "node:test";
import { idempotentUuid, type BlobValue, type ChatEvent, type Interaction, type JsonBlobStore } from "../src/contracts.js";
import { AzureJsonBlobStore, HistoryPreparingError, SessionRepository } from "../src/storage.js";

test("Azure conditional creates handle existing blobs without hiding unrelated conflicts", async () => {
  for (const [statusCode, code, expectedConflict] of [
    [409, "BlobAlreadyExists", true],
    [412, "ConditionNotMet", true],
    [409, "LeaseIdMismatchWithBlobOperation", false]
  ] as const) {
    const failure = Object.assign(new Error("storage error"), { statusCode, code });
    const store = new AzureJsonBlobStore("https://example.blob.core.windows.net", "test-container");
    Object.defineProperty(store, "container", { value: {
      createIfNotExists: async () => {},
      getBlockBlobClient: () => ({ uploadData: async () => { throw failure; } })
    } });
    if (expectedConflict) assert.equal(await store.create("existing.json", {}), false);
    else await assert.rejects(store.create("existing.json", {}), failure);
  }
});

class MemoryBlobStore implements JsonBlobStore {
  private readonly values = new Map<string, { value: unknown; etag: string }>();
  failWritesContaining?: string;

  async read<T>(key: string): Promise<BlobValue<T> | null> {
    const item = this.values.get(key);
    return item ? { value: structuredClone(item.value) as T, etag: item.etag } : null;
  }

  async create<T>(key: string, value: T): Promise<boolean> {
    if (this.failWritesContaining && key.includes(this.failWritesContaining)) throw new Error("Write failed");
    if (this.values.has(key)) return false;
    this.values.set(key, { value: structuredClone(value), etag: "1" });
    return true;
  }

  async replace<T>(key: string, value: T, etag: string): Promise<boolean> {
    if (this.failWritesContaining && key.includes(this.failWritesContaining)) throw new Error("Write failed");
    const current = this.values.get(key);
    if (!current || current.etag !== etag) return false;
    const nextEtag = String(Number(etag) + 1);
    this.values.set(key, { value: structuredClone(value), etag: nextEtag });
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

const parent = "22222222-2222-4222-8222-222222222222";
const otherParent = "33333333-3333-4333-8333-333333333333";
const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function interaction(id: string, message: string, reply: string): Interaction {
  const at = new Date().toISOString();
  return {
    id,
    sessionId,
    subject: "Math",
    language: "en",
    fingerprint: `fingerprint-${id}`,
    updatedAt: at,
    summary: `Math: ${reply}`,
    events: [
      { id: `u-${id}`, role: "user", text: message, at },
      { id: `a-${id}`, role: "assistant", text: reply, at }
    ]
  };
}

test("persists discoverable interaction, subject learning notes, and bounded context", async () => {
  const repository = new SessionRepository(new MemoryBlobStore());
  const first = interaction("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "What is a fraction?", "A fraction is part of a whole.");
  await repository.persistInteraction(parent, first);

  const listed = await repository.listSessions(parent);
  assert.deepEqual(listed.items.map(({ summary, ...item }) => item), [{
    id: sessionId,
    subject: "Math",
    language: "en",
    updatedAt: first.updatedAt
  }]);
  assert.match(listed.items[0]!.summary, /Question: What is a fraction/);
  assert.match(listed.items[0]!.summary, /tutor explanation: A fraction is part of a whole/);
  const session = await repository.getSession(parent, sessionId);
  assert.equal(session?.events.length, 2);
  assert.equal(session?.events[0]?.role, "user");
  assert.equal(session?.events[1]?.text, "A fraction is part of a whole.");

  const context = await repository.loadContext(parent, sessionId, "Math", "en");
  assert.equal(context.subjectSummary, "");
  assert.deepEqual(context.recentQuestions, ["What is a fraction?"]);
  assert.equal(context.history.length, 2);
  assert.deepEqual((await repository.listSessions(otherParent)).items, []);
  assert.equal(await repository.getSession(otherParent, sessionId), null);
});

test("retries are idempotent and conflicting subject/language is refused", async () => {
  const repository = new SessionRepository(new MemoryBlobStore());
  const first = interaction("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Question", "Answer");
  await repository.persistInteraction(parent, first);
  const replay = await repository.persistInteraction(parent, first);
  assert.equal(replay.events[1].text, "Answer");
  assert.equal((await repository.getSession(parent, sessionId))?.events.length, 2);
  await assert.rejects(repository.loadContext(parent, sessionId, "Science", "en"));
});

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function timedInteraction(id: string, userSecond: number, replySecond: number): Interaction {
  const item = interaction(id, `Question ${userSecond}`, `Answer ${replySecond}`);
  item.events[0].at = new Date(Date.UTC(2026, 0, 1, 0, 0, userSecond)).toISOString();
  item.events[1].at = new Date(Date.UTC(2026, 0, 1, 0, 0, replySecond)).toISOString();
  item.updatedAt = item.events[1].at;
  return item;
}

async function allSessionEvents(repository: SessionRepository, pageSize = 3): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  let cursor: string | undefined;
  do {
    const page = await repository.getSession(parent, sessionId, cursor, pageSize);
    assert.ok(page);
    events.push(...page.events);
    cursor = page.nextCursor;
  } while (cursor);
  return events;
}

test("legacy hashed interaction IDs paginate chronologically across every continuation page without rewriting records", async () => {
  const blobs = new MemoryBlobStore();
  const expected: ChatEvent[] = [];
  const originals: Interaction[] = [];
  for (let index = 0; index < 47; index++) {
    const item = timedInteraction(idempotentUuid(parent, sessionId, `retry-key-${index}`), index * 2, index * 2 + 1);
    await blobs.create(`parents/${parent}/interactions/${sessionId}/${item.id}.json`, item);
    originals.push(item);
    expected.push(...item.events);
  }
  assert.notDeepEqual(originals.map((item) => item.id).sort(), originals.map((item) => item.id));
  assert.deepEqual(await allSessionEvents(new SessionRepository(blobs), 2), expected);
  for (const original of originals) {
    assert.deepEqual((await blobs.read<Interaction>(
      `parents/${parent}/interactions/${sessionId}/${original.id}.json`
    ))?.value, original);
  }
});

test("event pagination interleaves overlapping replies and preserves pending user timestamps through late retries", async () => {
  const blobs = new MemoryBlobStore();
  const repository = new SessionRepository(blobs);
  const first = timedInteraction(uuid(99), 0, 10);
  const second = timedInteraction(uuid(1), 2, 4);
  const late = timedInteraction(uuid(50), 3, 12);
  for (const item of [first, second]) {
    await blobs.create(`parents/${parent}/interactions/${sessionId}/${item.id}.json`, item);
  }
  await blobs.create(`parents/${parent}/interactions/${sessionId}/${late.id}.json`, { ...late, events: [late.events[0]] });
  const start = await repository.getSession(parent, sessionId, undefined, 1);
  assert.deepEqual(start?.events, [first.events[0], second.events[0]]);
  assert.ok(start?.nextCursor);
  const retry = structuredClone(late);
  retry.events[0].at = retry.events[1].at;
  const saved = await repository.persistInteraction(parent, retry);
  assert.deepEqual(saved.events[0], late.events[0]);
  const next = await repository.getSession(parent, sessionId, start.nextCursor, 1);
  assert.deepEqual(next?.events, [late.events[0], second.events[1]]);
  const end = await repository.getSession(parent, sessionId, next!.nextCursor, 1);
  assert.deepEqual(end?.events, [first.events[1], late.events[1]]);
  assert.equal(end?.nextCursor, undefined);
  const future = timedInteraction(uuid(0), 13, 14);
  await repository.persistInteraction(parent, future);
  assert.deepEqual(await allSessionEvents(repository, 1), [
    first.events[0], second.events[0], late.events[0], second.events[1],
    first.events[1], late.events[1], ...future.events
  ]);
});

test("equal timestamps have a stable interaction-ID and user-before-assistant tie-breaker across pages", async () => {
  const blobs = new MemoryBlobStore();
  const repository = new SessionRepository(blobs);
  const items = [timedInteraction(uuid(9), 0, 0), timedInteraction(uuid(1), 0, 0), timedInteraction(uuid(5), 0, 0)];
  for (const item of items) await repository.persistInteraction(parent, item);
  const expected = [items[1]!, items[2]!, items[0]!].flatMap((item) => item.events);
  assert.deepEqual(await allSessionEvents(repository, 1), expected);
  assert.deepEqual(await allSessionEvents(new SessionRepository(blobs), 2), expected);
});

test("legacy timestamp offsets sort by their UTC instant and unorderable records fail rather than disappear", async () => {
  const blobs = new MemoryBlobStore();
  const first = timedInteraction(uuid(9), 0, 0);
  first.events.forEach((event) => { event.at = "2026-01-01T10:00:00+02:00"; });
  const second = timedInteraction(uuid(1), 0, 0);
  second.events.forEach((event) => { event.at = "2026-01-01T09:00:00.000Z"; });
  for (const item of [first, second]) {
    await blobs.create(`parents/${parent}/interactions/${sessionId}/${item.id}.json`, item);
  }
  assert.deepEqual(await allSessionEvents(new SessionRepository(blobs), 1), [...first.events, ...second.events]);
  const invalidStore = new MemoryBlobStore();
  const invalid = structuredClone(first);
  invalid.events[0].at = "not-a-timestamp";
  const key = `parents/${parent}/interactions/${sessionId}/${invalid.id}.json`;
  await invalidStore.create(key, invalid);
  await assert.rejects(new SessionRepository(invalidStore).getSession(parent, sessionId), /timestamp is invalid/);
  assert.deepEqual((await invalidStore.read<Interaction>(key))?.value, invalid);
});

test("legacy history backfill resumes durably in bounded batches and never serves a partially sorted history", async () => {
  const blobs = new MemoryBlobStore();
  const expected: ChatEvent[] = [];
  for (let index = 0; index < 205; index++) {
    const item = timedInteraction(idempotentUuid(parent, sessionId, `legacy-key-${index}`), index * 2, index * 2 + 1);
    await blobs.create(`parents/${parent}/interactions/${sessionId}/${item.id}.json`, item);
    expected.push(...item.events);
  }
  await assert.rejects(new SessionRepository(blobs).getSession(parent, sessionId), HistoryPreparingError);
  const stateKey = `parents/${parent}/history-index-v1/${sessionId}.json`;
  const state = (await blobs.read<{ complete: boolean; continuationToken: string }>(stateKey))!.value;
  assert.equal(state.complete, false);
  assert.ok(state.continuationToken);
  assert.deepEqual(await allSessionEvents(new SessionRepository(blobs), 17), expected);
  assert.equal((await blobs.read<{ complete: boolean }>(stateKey))?.value.complete, true);
});

test("failed backfill is resumable and concurrent readers do not lose legacy events", async () => {
  const blobs = new MemoryBlobStore();
  const expected: ChatEvent[] = [];
  for (let index = 0; index < 53; index++) {
    const item = timedInteraction(uuid(100 - index), index * 2, index * 2 + 1);
    await blobs.create(`parents/${parent}/interactions/${sessionId}/${item.id}.json`, item);
    expected.push(...item.events);
  }
  blobs.failWritesContaining = "/history-events-v1/";
  await assert.rejects(new SessionRepository(blobs).getSession(parent, sessionId), /Write failed/);
  const stateKey = `parents/${parent}/history-index-v1/${sessionId}.json`;
  assert.equal((await blobs.read<{ complete: boolean }>(stateKey))?.value.complete, false);
  blobs.failWritesContaining = undefined;
  const [left, right] = await Promise.all([
    allSessionEvents(new SessionRepository(blobs), 7),
    allSessionEvents(new SessionRepository(blobs), 5)
  ]);
  assert.deepEqual(left, expected);
  assert.deepEqual(right, expected);
});

test("index failures preserve pending records and retries never duplicate or expose losing answers", async () => {
  const blobs = new MemoryBlobStore();
  const repository = new SessionRepository(blobs);
  const first = timedInteraction(uuid(1), 0, 1);
  await repository.persistInteraction(parent, first);
  await repository.getSession(parent, sessionId);
  const next = timedInteraction(uuid(2), 2, 3);
  blobs.failWritesContaining = "/history-events-v1/";
  await assert.rejects(repository.beginInteraction(parent, { ...next, events: [next.events[0]] }));
  assert.equal(await repository.getInteraction(parent, sessionId, next.id), null);
  blobs.failWritesContaining = undefined;
  await repository.beginInteraction(parent, { ...next, events: [next.events[0]] });
  blobs.failWritesContaining = "/history-events-v1/";
  await assert.rejects(repository.persistInteraction(parent, next));
  assert.deepEqual(await allSessionEvents(repository), [...first.events, next.events[0]]);
  blobs.failWritesContaining = undefined;
  const alternative = timedInteraction(uuid(2), 2, 5);
  alternative.events[1].text = "Losing alternative answer";
  const results = await Promise.all([
    repository.persistInteraction(parent, next),
    repository.persistInteraction(parent, alternative)
  ]);
  assert.deepEqual(results[0]!.events, results[1]!.events);
  const replay = await repository.persistInteraction(parent, alternative);
  assert.deepEqual(replay.events, results[0]!.events);
  assert.deepEqual(await allSessionEvents(repository, 1), [...first.events, ...results[0]!.events]);
});

test("prewritten references from failed canonical writes never fabricate events and old hash-order cursors require restart", async () => {
  const blobs = new MemoryBlobStore();
  const repository = new SessionRepository(blobs);
  const pending = timedInteraction(uuid(2), 0, 1);
  blobs.failWritesContaining = "/interactions/";
  await assert.rejects(repository.beginInteraction(parent, { ...pending, events: [pending.events[0]] }));
  assert.deepEqual(await allSessionEvents(repository), []);
  blobs.failWritesContaining = undefined;
  const saved = timedInteraction(uuid(2), 2, 3);
  await repository.persistInteraction(parent, saved);
  assert.deepEqual(await allSessionEvents(repository, 1), saved.events);
  const legacyCursor = Buffer.from(JSON.stringify({
    prefix: `parents/${parent}/interactions/${sessionId}/`, token: "legacy-token"
  })).toString("base64url");
  await assert.rejects(repository.getSession(parent, sessionId, legacyCursor));
  // Add another event to obtain a continuation scoped to the new index.
  await repository.persistInteraction(parent, timedInteraction(uuid(3), 4, 5));
  const page = await repository.getSession(parent, sessionId, undefined, 1);
  assert.ok(page?.nextCursor);
  await assert.rejects(repository.getSession(otherParent, sessionId, page.nextCursor));
  await assert.rejects(repository.getSession(parent, uuid(9), page.nextCursor));
});

test("prefix pagination recovers every legacy session even when the old index omitted it", async () => {
  const blobs = new MemoryBlobStore();
  const repository = new SessionRepository(blobs);
  for (let index = 0; index < 105; index++) {
    await blobs.create(`parents/${parent}/sessions/${uuid(index)}.json`, {
      id: uuid(index), subject: "Math", language: "en", updatedAt: new Date().toISOString(),
      summary: "Earlier practice", interactionIds: []
    });
    await blobs.create(`parents/${parent}/interactions/${uuid(index)}/${uuid(1)}.json`, {
      ...interaction(uuid(1), "Legacy question", "Legacy explanation"), sessionId: uuid(index)
    });
  }
  await blobs.create(`parents/${parent}/session-index.json`, { sessions: [] });
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await repository.listSessions(parent, cursor, 17);
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 105);
  assert.equal(new Set(ids).size, 105);
  assert.ok(ids.includes(uuid(0)));
});

test("all interactions remain readable beyond the old 40-turn cap and cache limits", async () => {
  const blobs = new MemoryBlobStore();
  const repository = new SessionRepository(blobs);
  for (let index = 0; index < 47; index++) {
    const item = interaction(uuid(index), `Question ${index}`, `Explanation ${index}`);
    item.updatedAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
    item.events.forEach((event) => { event.at = item.updatedAt; });
    await repository.persistInteraction(parent, item);
  }
  // Simulate a legacy truncated ID array: prefix history must still include all.
  const metadataKey = `parents/${parent}/sessions/${sessionId}.json`;
  const metadata = await blobs.read<Record<string, unknown>>(metadataKey);
  await blobs.replace(metadataKey, { ...metadata!.value, interactionIds: [uuid(46)] }, metadata!.etag);

  const texts: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await repository.getSession(parent, sessionId, cursor, 9);
    assert.ok(page);
    texts.push(...page.events.filter((event) => event.role === "user").map((event) => event.text));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(texts.length, 47);
  assert.equal(new Set(texts).size, 47);
  assert.ok(texts.includes("Question 0"));
  const context = await repository.loadContext(parent, sessionId, "Math", "en");
  assert.ok(context.history.reduce((total, event) => total + event.text.length, 0) <= 1800);
  assert.ok(context.history.some((event) => event.text === "Question 46"));
});

test("new sessions receive bounded prior questions and explanations, separated by subject and language", async () => {
  const repository = new SessionRepository(new MemoryBlobStore());
  await repository.persistInteraction(parent, interaction(uuid(1), "How do I add fractions?", "Use a common denominator."));
  await repository.persistInteraction(parent, interaction(uuid(2), "What is a numerator?", "The numerator counts selected parts."));
  const next = await repository.loadContext(parent, uuid(3), "Math", "en");
  assert.match(next.subjectSummary, /How do I add fractions/);
  assert.match(next.subjectSummary, /common denominator/);
  assert.match(next.subjectSummary, /What is a numerator/);
  assert.match(next.subjectSummary, /not evidence of mastery/);
  assert.ok(next.subjectSummary.length <= 1200);
  assert.deepEqual(next.recentQuestions, ["How do I add fractions?", "What is a numerator?"]);
  assert.deepEqual(next.history, []);
  assert.equal((await repository.loadContext(parent, undefined, "Science", "en")).subjectSummary, "");
  assert.equal((await repository.loadContext(parent, undefined, "Math", "nb")).subjectSummary, "");
});

test("pending input remains discoverable; completed records survive cache failures and can repair on retry", async () => {
  const blobs = new MemoryBlobStore();
  const repository = new SessionRepository(blobs);
  const completed = interaction(uuid(1), "Keep this question", "An explanation");
  await repository.beginInteraction(parent, { ...completed, events: [completed.events[0]] });
  assert.equal((await repository.listSessions(parent)).items.length, 1);
  assert.deepEqual((await repository.getSession(parent, sessionId))?.events, [completed.events[0]]);
  blobs.failWritesContaining = "/subjects/";
  await assert.rejects(repository.persistInteraction(parent, completed), /Write failed/);
  assert.equal((await repository.getSession(parent, sessionId))?.events.length, 2);
  blobs.failWritesContaining = undefined;
  await repository.persistInteraction(parent, completed);
  assert.equal((await repository.getSession(parent, sessionId))?.events.length, 2);
  assert.match((await repository.getSubjectProgress(parent, "Math"))!.summary, /Keep this question/);
});

test("pagination rejects invalid limits and cursors from another parent or session", async () => {
  const repository = new SessionRepository(new MemoryBlobStore());
  await repository.persistInteraction(parent, interaction(uuid(1), "One", "First"));
  await repository.persistInteraction(parent, interaction(uuid(2), "Two", "Second"));
  const first = await repository.getSession(parent, sessionId, undefined, 1);
  assert.ok(first?.nextCursor);
  await assert.rejects(repository.listSessions(parent, first.nextCursor));
  await assert.rejects(repository.getSession(parent, sessionId, "invalid-cursor"));
  await assert.rejects(repository.getSession(parent, sessionId, undefined, 41));
  await assert.rejects(repository.listSessions(parent, undefined, 101));
  const forged = Buffer.from(JSON.stringify({
    prefix: `parents/${otherParent}/interactions/${sessionId}/`, token: "next"
  })).toString("base64url");
  await assert.rejects(repository.getSession(parent, sessionId, forged));
});

test("legacy orphan interactions remain discoverable without any metadata, and cannot change subject", async () => {
  const blobs = new MemoryBlobStore();
  const repository = new SessionRepository(blobs);
  const legacy = interaction(uuid(1), "An older question", "An older explanation");
  await blobs.create(`parents/${parent}/interactions/${sessionId}/${legacy.id}.json`, legacy);
  const sessions = await repository.listSessions(parent);
  assert.equal(sessions.items[0]?.id, sessionId);
  assert.match(sessions.items[0]!.summary, /An older question/);
  assert.deepEqual((await repository.getSession(parent, sessionId))?.events, legacy.events);
  await assert.rejects(repository.beginInteraction(parent, {
    ...legacy, id: uuid(2), subject: "Science", events: [legacy.events[0]]
  }));
  assert.deepEqual((await repository.getSession(parent, sessionId))?.events, legacy.events);
});

test("concurrent completions of one pending request agree on one durable answer", async () => {
  const repository = new SessionRepository(new MemoryBlobStore());
  const first = interaction(uuid(1), "One question", "First answer");
  await repository.beginInteraction(parent, { ...first, events: [first.events[0]] });
  const second = structuredClone(first);
  second.events[1].text = "Second answer";
  const results = await Promise.all([
    repository.persistInteraction(parent, first),
    repository.persistInteraction(parent, second)
  ]);
  assert.equal(results[0]!.events[1].text, results[1]!.events[1].text);
  const session = await repository.getSession(parent, sessionId);
  assert.equal(session?.events.length, 2);
  assert.equal(session?.events[1]?.text, results[0]!.events[1].text);
});

test("a long current session keeps useful prior-session notes without unbounded model context", async () => {
  const repository = new SessionRepository(new MemoryBlobStore());
  const earlier = interaction(uuid(0), "Earlier fractions question", "Earlier common denominator explanation");
  earlier.updatedAt = new Date(Date.UTC(2026, 0, 1)).toISOString();
  await repository.persistInteraction(parent, earlier);
  const currentId = uuid(100);
  for (let index = 1; index <= 25; index++) {
    const item = interaction(uuid(index), `Current question ${index} ${"x".repeat(900)}`, "y".repeat(1200));
    item.sessionId = currentId;
    item.updatedAt = new Date(Date.UTC(2026, 10, 13, 14, index)).toISOString();
    await repository.persistInteraction(parent, item);
  }
  const context = await repository.loadContext(parent, currentId, "Math", "en");
  assert.match(context.subjectSummary, /Earlier fractions question/);
  assert.ok(context.subjectSummary.length <= 1200);
  assert.ok(context.recentQuestions.length <= 6);
  assert.ok(context.recentQuestions.every((question) => question.length <= 180));
  assert.ok(context.history.reduce((total, event) => total + event.text.length, 0) <= 1800);
  assert.ok(context.history.some((event) => event.text.startsWith("Current question 25")));
});
