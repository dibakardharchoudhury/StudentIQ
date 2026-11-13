import assert from "node:assert/strict";
import { test } from "node:test";
import type { BlobValue, JsonBlobStore } from "../src/contracts.js";
import { DailyQuotaRepository, QuotaExceededError, QuotaUnavailableError, readQuotaSettings } from "../src/quota.js";

class MemoryBlobStore implements JsonBlobStore {
  readonly values = new Map<string, { value: unknown; etag: string }>();
  failRead = false;
  failWrite = false;
  ambiguousWrite = false;
  conflictAlways = false;
  writes = 0;

  async read<T>(key: string): Promise<BlobValue<T> | null> {
    if (this.failRead) throw new Error("sensitive storage exception");
    const item = this.values.get(key);
    return item ? { value: structuredClone(item.value) as T, etag: item.etag } : null;
  }

  async create<T>(key: string, value: T): Promise<boolean> {
    this.writes++;
    if (this.failWrite) throw new Error("sensitive credential");
    if (this.conflictAlways || this.values.has(key)) return false;
    this.values.set(key, { value: structuredClone(value), etag: "1" });
    if (this.ambiguousWrite) throw new Error("write outcome unknown");
    return true;
  }

  async replace<T>(key: string, value: T, etag: string): Promise<boolean> {
    this.writes++;
    if (this.failWrite) throw new Error("sensitive credential");
    const item = this.values.get(key);
    if (this.conflictAlways || !item || item.etag !== etag) return false;
    this.values.set(key, { value: structuredClone(value), etag: String(Number(etag) + 1) });
    if (this.ambiguousWrite) throw new Error("write outcome unknown");
    return true;
  }

  async list(): Promise<never> {
    throw new Error("Quota must not enumerate transcripts or history.");
  }
}

const parent = "22222222-2222-4222-8222-222222222222";
const otherParent = "33333333-3333-4333-8333-333333333333";
const settings = { chatDailyLimit: 2, speechTokenDailyLimit: 3 };
const now = () => new Date("2026-11-13T23:59:59Z");

test("quota configuration defaults, disabling, and strict bounds fail closed", () => {
  assert.deepEqual(readQuotaSettings({}), { chatDailyLimit: 60, speechTokenDailyLimit: 200 });
  assert.deepEqual(readQuotaSettings({ CHAT_DAILY_LIMIT: "0", SPEECH_TOKEN_DAILY_LIMIT: "0" }), {
    chatDailyLimit: 0, speechTokenDailyLimit: 0
  });
  assert.deepEqual(readQuotaSettings({ CHAT_DAILY_LIMIT: "200", SPEECH_TOKEN_DAILY_LIMIT: "500" }), {
    chatDailyLimit: 200, speechTokenDailyLimit: 500
  });
  for (const value of ["", " ", "-1", "1.5", "1e2", "Infinity", "01", "+1", "1\n", " 1", "999999"]) {
    assert.throws(() => readQuotaSettings({ CHAT_DAILY_LIMIT: value }));
    assert.throws(() => readQuotaSettings({ SPEECH_TOKEN_DAILY_LIMIT: value }));
  }
  assert.throws(() => readQuotaSettings({ CHAT_DAILY_LIMIT: "201" }));
  assert.throws(() => readQuotaSettings({ SPEECH_TOKEN_DAILY_LIMIT: "501" }));
});

test("quotas persist across repository instances and are isolated by parent and operation", async () => {
  const blobs = new MemoryBlobStore();
  await new DailyQuotaRepository(blobs, settings, now).consume(parent, "chat");
  const restarted = new DailyQuotaRepository(blobs, settings, now);
  await restarted.consume(parent, "chat");
  await assert.rejects(restarted.consume(parent, "chat"), QuotaExceededError);
  for (let index = 0; index < 3; index++) await restarted.consume(parent, "speechToken");
  await assert.rejects(restarted.consume(parent, "speechToken"), QuotaExceededError);
  await restarted.consume(otherParent, "chat");
});

test("UTC rollover uses a different daily record without erasing earlier counters", async () => {
  const blobs = new MemoryBlobStore();
  let date = new Date("2026-11-13T18:59:59-05:00");
  const quota = new DailyQuotaRepository(blobs, { chatDailyLimit: 1, speechTokenDailyLimit: 1 }, () => date);
  await quota.consume(parent, "chat");
  await assert.rejects(quota.consume(parent, "chat"), QuotaExceededError);
  date = new Date("2026-11-13T19:00:00-05:00");
  await quota.consume(parent, "chat");
  assert.equal(blobs.values.size, 2);
  assert.ok(blobs.values.has(`parents/${parent}/quotas/2026-11-13.json`));
  assert.ok(blobs.values.has(`parents/${parent}/quotas/2026-11-14.json`));
});

test("competing instances cannot exceed either limit or lose the other counter", async () => {
  const blobs = new MemoryBlobStore();
  const limits = { chatDailyLimit: 5, speechTokenDailyLimit: 4 };
  const attempts = [
    ...Array.from({ length: 10 }, () => "chat" as const),
    ...Array.from({ length: 9 }, () => "speechToken" as const)
  ];
  const results = await Promise.allSettled(attempts.map((kind) =>
    new DailyQuotaRepository(blobs, limits, now).consume(parent, kind)
  ));
  assert.equal(results.slice(0, 10).filter((result) => result.status === "fulfilled").length, 5);
  assert.equal(results.slice(10).filter((result) => result.status === "fulfilled").length, 4);
  for (const result of results) {
    if (result.status === "rejected") assert.ok(result.reason instanceof QuotaExceededError);
  }
});

test("storage read/write failure, malformed usage, and ambiguous writes never confirm reservations", async () => {
  for (const failure of ["failRead", "failWrite", "ambiguousWrite"] as const) {
    const blobs = new MemoryBlobStore();
    blobs[failure] = true;
    await assert.rejects(new DailyQuotaRepository(blobs, settings, now).consume(parent, "chat"), QuotaUnavailableError);
  }
  const blobs = new MemoryBlobStore();
  const key = `parents/${parent}/quotas/2026-11-13.json`;
  for (const usage of [
    null,
    { version: 1, day: "2026-11-13", chat: -1, speechToken: 0 },
    { version: 1, day: "2026-11-13", chat: 0.5, speechToken: 0 },
    { version: 1, day: "2026-11-13", chat: 0 },
    { version: 1, day: "2026-11-12", chat: 0, speechToken: 0 }
  ]) {
    blobs.values.set(key, { value: usage, etag: "1" });
    await assert.rejects(new DailyQuotaRepository(blobs, settings, now).consume(parent, "chat"), QuotaUnavailableError);
  }
});

test("conflict retries are bounded and zero quotas disable upstream calls", async () => {
  const blobs = new MemoryBlobStore();
  blobs.conflictAlways = true;
  await assert.rejects(new DailyQuotaRepository(blobs, settings, now).consume(parent, "chat"), QuotaUnavailableError);
  assert.equal(blobs.writes, 16);
  const disabled = new DailyQuotaRepository(new MemoryBlobStore(), { chatDailyLimit: 0, speechTokenDailyLimit: 0 }, now);
  await assert.rejects(disabled.consume(parent, "chat"), QuotaExceededError);
  await assert.rejects(disabled.consume(parent, "speechToken"), QuotaExceededError);
});
