import { BlobServiceClient } from "@azure/storage-blob";
import { createAzureCredential } from "./azure-credential.js";
import {
  InputValidationError,
  PersistenceConflictError,
  learningNote,
  summarizeNotes,
  type ChatEvent,
  type HistoryPage,
  type Interaction,
  type JsonBlobStore,
  type Language,
  type LearningNote,
  type PendingInteraction,
  type SessionRecord,
  type SessionSummary,
  type SubjectProgress,
  type StoredInteraction,
  subjectKey,
  validateSessionId
} from "./contracts.js";

const MAX_BLOB_BYTES = 256 * 1024;
const MAX_OPTIMISTIC_RETRIES = 8;
const HISTORY_BACKFILL_PAGE_SIZE = 50;
const HISTORY_BACKFILL_PAGES = 4;

interface HistoryIndexState {
  version: 1;
  complete: boolean;
  continuationToken?: string;
}

interface HistoryEventReference {
  version: 1;
  interactionId: string;
  position: 0 | 1;
  at: string;
}

export class HistoryPreparingError extends Error {}

export class AzureJsonBlobStore implements JsonBlobStore {
  private readonly container;
  private initialized?: Promise<void>;

  constructor(endpoint: string, containerName: string) {
    this.container = new BlobServiceClient(endpoint, createAzureCredential())
      .getContainerClient(containerName);
  }

  private ensureContainer(): Promise<void> {
    this.initialized ??= this.container.createIfNotExists().then(() => undefined);
    return this.initialized;
  }

  async read<T>(key: string): Promise<{ value: T; etag: string } | null> {
    await this.ensureContainer();
    const blob = this.container.getBlockBlobClient(key);
    try {
      const response = await blob.download(0);
      const length = response.contentLength;
      if (typeof length === "number" && length > MAX_BLOB_BYTES) {
        throw new Error("Stored record exceeds the configured size limit.");
      }
      const stream = response.readableStreamBody;
      if (!stream) {
        throw new Error("Stored record is unavailable.");
      }
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array>) {
        const buffer = Buffer.from(chunk);
        total += buffer.length;
        if (total > MAX_BLOB_BYTES) {
          throw new Error("Stored record exceeds the configured size limit.");
        }
        chunks.push(buffer);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
      if (!response.etag) {
        throw new Error("Stored record is unavailable.");
      }
      return { value, etag: response.etag };
    } catch (error) {
      if (statusCode(error) === 404) {
        return null;
      }
      throw error;
    }
  }

  async create<T>(key: string, value: T): Promise<boolean> {
    await this.ensureContainer();
    try {
      await this.container.getBlockBlobClient(key).uploadData(serialize(value), {
        conditions: { ifNoneMatch: "*" },
        blobHTTPHeaders: { blobContentType: "application/json; charset=utf-8" }
      });
      return true;
    } catch (error) {
      if (statusCode(error) === 412 ||
          (statusCode(error) === 409 && error && typeof error === "object" &&
            "code" in error && error.code === "BlobAlreadyExists")) {
        return false;
      }
      throw error;
    }
  }

  async replace<T>(key: string, value: T, etag: string): Promise<boolean> {
    await this.ensureContainer();
    try {
      await this.container.getBlockBlobClient(key).uploadData(serialize(value), {
        conditions: { ifMatch: etag },
        blobHTTPHeaders: { blobContentType: "application/json; charset=utf-8" }
      });
      return true;
    } catch (error) {
      if (statusCode(error) === 412) {
        return false;
      }
      throw error;
    }

  }

  async list(prefix: string, pageSize: number, continuationToken?: string, hierarchy = false): Promise<{
    keys: string[];
    continuationToken?: string;
  }> {
    await this.ensureContainer();
    if (hierarchy) {
      const pages = this.container.listBlobsByHierarchy("/", { prefix }).byPage({
        maxPageSize: pageSize,
        continuationToken
      });
      const page = await pages.next();
      if (page.done) return { keys: [] };
      return {
        keys: (page.value.segment.blobPrefixes ?? []).map((item) => item.name),
        ...(page.value.continuationToken ? { continuationToken: page.value.continuationToken } : {})
      };
    }
    const pages = this.container.listBlobsFlat({ prefix }).byPage({
      maxPageSize: pageSize,
      continuationToken
    });
    const page = await pages.next();
    if (page.done) return { keys: [] };
    return {
      keys: page.value.segment.blobItems.map((item) => item.name),
      ...(page.value.continuationToken ? { continuationToken: page.value.continuationToken } : {})
    };
  }
}

function serialize(value: unknown): Buffer {
  const result = Buffer.from(JSON.stringify(value), "utf8");
  if (result.length > MAX_BLOB_BYTES) {
    throw new Error("Stored record exceeds the configured size limit.");
  }
  return result;
}

function statusCode(error: unknown): number | undefined {
  if (error && typeof error === "object" && "statusCode" in error) {
    return Number((error as { statusCode: unknown }).statusCode);
  }
  return undefined;
}

export class SessionRepository {
  constructor(private readonly blobs: JsonBlobStore) {}

  private parentPrefix(parentOid: string): string {
    return `parents/${parentOid.toLowerCase()}`;
  }

  async getSubjectProgress(parentOid: string, subject: string): Promise<SubjectProgress | null> {
    const result = await this.blobs.read<SubjectProgress>(
      `${this.parentPrefix(parentOid)}/subjects/${subjectKey(subject)}.json`
    );
    return result?.value ?? null;
  }

  async getInteraction(
    parentOid: string,
    sessionId: string,
    interactionId: string
  ): Promise<StoredInteraction | null> {
    const result = await this.blobs.read<StoredInteraction>(
      `${this.parentPrefix(parentOid)}/interactions/${sessionId}/${interactionId}.json`
    );
    return result?.value ?? null;
  }

  async getSessionRecord(parentOid: string, sessionId: string): Promise<SessionRecord | null> {
    const result = await this.blobs.read<SessionRecord>(
      `${this.parentPrefix(parentOid)}/sessions/${sessionId}.json`
    );
    return result?.value ?? null;
  }

  async loadContext(
    parentOid: string,
    sessionId: string | undefined,
    subject: string,
    language: Language
  ): Promise<{ subjectSummary: string; recentQuestions: string[]; history: ChatEvent[] }> {
    const [progress, session] = await Promise.all([
      this.getSubjectProgress(parentOid, subject),
      sessionId ? this.getSessionRecord(parentOid, sessionId) : Promise.resolve(null)
    ]);

    if (session && (session.subject !== subject || session.language !== language)) {
      throw new PersistenceConflictError();
    }
    const subjectNotes = (progress?.recentNotes ?? []).filter((note) => note.language === language);
    // Legacy session IDs are a context fallback, never an authoritative history index.
    const ids = session?.recentNotes?.map((note) => note.interactionId) ??
      session?.interactionIds?.slice(-6) ?? [];
    const interactions = await Promise.all(ids.slice(-6).map((id) =>
      this.getInteraction(parentOid, sessionId!, id)
    ));
    if (interactions.some((item) => item === null)) {
      throw new Error("Session context could not be loaded completely.");
    }
    const history = interactions.flatMap((item) => item?.events ?? []);
    let remaining = 1800;
    const boundedHistory: ChatEvent[] = [];
    // Spend the context budget on the newest turns, not the oldest ones.
    for (const event of history.slice().reverse()) {
      if (remaining <= 0) break;
      const text = event.text.slice(0, Math.min(450, remaining));
      boundedHistory.unshift({ ...event, text });
      remaining -= text.length;
    }
    const previousSessions = subjectNotes.filter((note) => note.sessionId !== sessionId);
    return {
      subjectSummary: summarizeNotes(previousSessions).slice(0, 1200),
      recentQuestions: subjectNotes.slice(-6).map((note) => note.question),
      history: boundedHistory
    };
  }

  private async ensureSession(parentOid: string, interaction: StoredInteraction): Promise<void> {
    const key = `${this.parentPrefix(parentOid)}/sessions/${interaction.sessionId}.json`;
    const existing = await this.blobs.read<SessionRecord>(key);
    if (existing) {
      if (existing.value.subject !== interaction.subject || existing.value.language !== interaction.language) {
        throw new PersistenceConflictError();
      }
      return;
    }
    const legacy = await this.readPage<StoredInteraction>(
      `${this.parentPrefix(parentOid)}/interactions/${interaction.sessionId}/`, 1, 40
    );
    const first = legacy.items[0];
    if (first && (first.subject !== interaction.subject || first.language !== interaction.language)) {
      throw new PersistenceConflictError();
    }
    const recoveredNotes = first?.events.length === 2 ? [learningNote(first as Interaction)] : [];
    const created = await this.blobs.create<SessionRecord>(key, {
      id: interaction.sessionId,
      subject: interaction.subject,
      language: interaction.language,
      updatedAt: interaction.updatedAt,
      summary: recoveredNotes.length ? summarizeNotes(recoveredNotes) : "A question is awaiting a tutor response.",
      recentNotes: recoveredNotes
    });
    if (created && !first) {
      // Brand-new sessions have no legacy rows to backfill. All writes below
      // publish chronological references before committing their canonical data.
      await this.blobs.create<HistoryIndexState>(
        `${this.parentPrefix(parentOid)}/history-index-v1/${interaction.sessionId}.json`,
        { version: 1, complete: true }
      );
    }
    if (!created) {
      const raced = await this.blobs.read<SessionRecord>(key);
      if (!raced) throw new Error("Session persistence could not be confirmed.");
      if (raced.value.subject !== interaction.subject || raced.value.language !== interaction.language) {
        throw new PersistenceConflictError();
      }
    }
  }

  async beginInteraction(parentOid: string, pending: PendingInteraction): Promise<StoredInteraction> {
    // Create discoverable session metadata first; never write a user message under
    // an undiscoverable session, even if later model or cache updates fail.
    await this.ensureSession(parentOid, pending);
    const key = `${this.parentPrefix(parentOid)}/interactions/${pending.sessionId}/${pending.id}.json`;
    const previous = await this.getInteraction(parentOid, pending.sessionId, pending.id);
    if (previous) {
      this.assertSameRequest(previous, pending);
      await this.indexInteraction(parentOid, previous);
      return previous;
    }
    // Index first: a failed canonical write may leave an unused reference, but
    // a committed user event must never be invisible to an already-ready index.
    await this.indexInteraction(parentOid, pending);
    if (await this.blobs.create(key, pending)) return pending;
    const existing = await this.getInteraction(parentOid, pending.sessionId, pending.id);
    if (!existing) throw new Error("Interaction persistence could not be confirmed.");
    this.assertSameRequest(existing, pending);
    await this.indexInteraction(parentOid, existing);
    return existing;
  }

  private assertSameRequest(left: StoredInteraction, right: StoredInteraction): void {
    if (left.fingerprint !== right.fingerprint || left.subject !== right.subject ||
        left.language !== right.language || left.sessionId !== right.sessionId) {
      throw new PersistenceConflictError();
    }
  }

  async persistInteraction(parentOid: string, interaction: Interaction): Promise<Interaction> {
    interaction = { ...interaction, summary: summarizeNotes([learningNote(interaction)]) };
    await this.ensureSession(parentOid, interaction);
    const base = this.parentPrefix(parentOid);
    const key = `${base}/interactions/${interaction.sessionId}/${interaction.id}.json`;
    const persisted = await this.updateJson<StoredInteraction>(key, async (current) => {
      if (current) this.assertSameRequest(current, interaction);
      // Preserve the exact durable user event and the first committed answer.
      const next: StoredInteraction = current?.events.length === 2 ? current : {
        ...interaction, events: [current?.events[0] ?? interaction.events[0], interaction.events[1]]
      };
      await this.indexInteraction(parentOid, next);
      return next;
    }) as Interaction;

    const note = learningNote(persisted);
    await this.updateJson<SessionRecord>(`${base}/sessions/${persisted.sessionId}.json`, (current) => {
      const recentNotes = mergeNotes(current?.recentNotes ?? [], note, 6);
      return {
        id: persisted.sessionId,
        subject: persisted.subject,
        language: persisted.language,
        updatedAt: recentNotes.at(-1)!.at,
        summary: summarizeNotes(recentNotes),
        recentNotes
      };
    });
    await this.updateJson<SubjectProgress>(`${base}/subjects/${subjectKey(persisted.subject)}.json`, (current) => {
      const recentNotes = mergeNotes(current?.recentNotes ?? [], note, 18, 3);
      return {
        subject: persisted.subject,
        updatedAt: recentNotes.at(-1)!.at,
        summary: summarizeNotes(recentNotes),
        recentNotes
      };
    });
    return persisted;
  }

  async listSessions(parentOid: string, cursor?: string, pageSize = 100): Promise<HistoryPage<SessionSummary>> {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new InputValidationError();
    // Enumerate canonical interaction directories, not a fallible/truncated
    // metadata index. This also exposes legacy writes missing session metadata.
    const prefix = `${this.parentPrefix(parentOid)}/interactions/`;
    const page = await this.blobs.list(prefix, pageSize, decodeCursor(prefix, cursor), true);
    const items: SessionSummary[] = [];
    for (let offset = 0; offset < page.keys.length; offset += 8) {
      const summaries = await Promise.all(page.keys.slice(offset, offset + 8).map(async (key) => {
        const id = key.slice(prefix.length).replace(/\/$/, "");
        const session = await this.getSessionRecord(parentOid, id);
        if (session) {
          const { subject, language, updatedAt, summary } = session;
          return { id, subject, language, updatedAt, summary };
        }
        const firstPage = await this.readPage<StoredInteraction>(key, 1, 40);
        const first = firstPage.items[0];
        if (!first) throw new Error("Session history could not be loaded completely.");
        return {
          id, subject: first.subject, language: first.language, updatedAt: first.updatedAt,
          summary: first.events.length === 2
            ? summarizeNotes([learningNote(first as Interaction)])
            : "A question is awaiting a tutor response."
        };
      }));
      items.push(...summaries);
    }
    return {
      items,
      ...nextCursor(prefix, page.continuationToken)
    };
  }

  async getSession(
    parentOid: string,
    sessionId: string,
    cursor?: string,
    pageSize = 40
  ): Promise<{ id: string; subject: string; language: Language; events: ChatEvent[]; nextCursor?: string } | null> {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 40) throw new InputValidationError();
    const prefix = this.historyPrefix(parentOid, sessionId);
    const continuationToken = decodeCursor(prefix, cursor);
    const session = await this.getSessionRecord(parentOid, sessionId);
    const details = session ?? (await this.readPage<StoredInteraction>(
      `${this.parentPrefix(parentOid)}/interactions/${sessionId}/`, 1, 40
    )).items[0];
    if (!details) return null;

    await this.prepareHistory(parentOid, sessionId);
    // Keep the existing maximum of two events per requested interaction slot,
    // but paginate events individually so overlapping replies can interleave.
    const page = await this.blobs.list(prefix, pageSize * 2, continuationToken);
    const events: ChatEvent[] = [];
    for (let offset = 0; offset < page.keys.length; offset += 8) {
      const resolved = await Promise.all(page.keys.slice(offset, offset + 8).map(async (key) => {
        const stored = await this.blobs.read<HistoryEventReference>(key);
        const reference = stored?.value;
        if (!reference || reference.version !== 1 ||
            typeof reference.interactionId !== "string" ||
            (reference.position !== 0 && reference.position !== 1) ||
            typeof reference.at !== "string") {
          throw new Error("History index could not be loaded completely.");
        }
        validateHistoryId(reference.interactionId);
        if (reference.at !== historyTimestamp(reference.at) ||
            key !== this.historyEventKey(parentOid, sessionId, reference)) {
          throw new Error("History index is invalid.");
        }
        const interaction = await this.getInteraction(parentOid, sessionId, reference.interactionId);
        // References precede canonical writes. Ignore uncommitted writes and
        // losing concurrent completions; never return their proposed text.
        if (!interaction) return undefined;
        this.validateHistoryInteraction(sessionId, interaction);
        if (interaction.id !== reference.interactionId) throw new Error("Session history is invalid.");
        const event = interaction.events[reference.position];
        return event && historyTimestamp(event.at) === reference.at ? event : undefined;
      }));
      events.push(...resolved.filter((event): event is ChatEvent => event !== undefined));
    }
    return {
      id: sessionId,
      subject: details.subject,
      language: details.language,
      events,
      ...nextCursor(prefix, page.continuationToken)
    };
  }

  private historyPrefix(parentOid: string, sessionId: string): string {
    return `${this.parentPrefix(parentOid)}/history-events-v1/${sessionId}/`;
  }

  private historyEventKey(parentOid: string, sessionId: string, reference: HistoryEventReference): string {
    return `${this.historyPrefix(parentOid, sessionId)}${historyTimestamp(reference.at)}-${reference.interactionId}-${reference.position}.json`;
  }

  private validateHistoryInteraction(sessionId: string, interaction: StoredInteraction): void {
    if (!interaction || interaction.sessionId !== sessionId || typeof interaction.id !== "string" ||
        !Array.isArray(interaction.events) || interaction.events.length < 1 || interaction.events.length > 2) {
      throw new Error("Session history is invalid.");
    }
    validateHistoryId(interaction.id);
    for (let position = 0; position < interaction.events.length; position++) {
      const event = interaction.events[position];
      if (!event || event.role !== (position === 0 ? "user" : "assistant") ||
          typeof event.id !== "string" || typeof event.text !== "string") {
        throw new Error("Session history is invalid.");
      }
      historyTimestamp(event.at);
    }
  }

  private async indexInteraction(parentOid: string, interaction: StoredInteraction): Promise<void> {
    this.validateHistoryInteraction(interaction.sessionId, interaction);
    await Promise.all(interaction.events.map(async (event, position) => {
      const reference: HistoryEventReference = {
        version: 1, interactionId: interaction.id, position: position as 0 | 1,
        at: historyTimestamp(event.at)
      };
      const key = this.historyEventKey(parentOid, interaction.sessionId, reference);
      if (!await this.blobs.create(key, reference)) {
        const existing = (await this.blobs.read<HistoryEventReference>(key))?.value;
        if (!existing || existing.version !== reference.version ||
            existing.interactionId !== reference.interactionId ||
            existing.position !== reference.position || existing.at !== reference.at) {
          throw new Error("History indexing could not be confirmed.");
        }
      }
    }));
  }

  private async prepareHistory(parentOid: string, sessionId: string): Promise<void> {
    const stateKey = `${this.parentPrefix(parentOid)}/history-index-v1/${sessionId}.json`;
    for (let step = 0; step < HISTORY_BACKFILL_PAGES; step++) {
      let state = await this.blobs.read<HistoryIndexState>(stateKey);
      if (!state) {
        await this.blobs.create<HistoryIndexState>(stateKey, { version: 1, complete: false });
        state = await this.blobs.read<HistoryIndexState>(stateKey);
      }
      if (!state || !state.value || state.value.version !== 1 || typeof state.value.complete !== "boolean" ||
          (state.value.continuationToken !== undefined &&
            (typeof state.value.continuationToken !== "string" || !state.value.continuationToken)) ||
          (state.value.complete && state.value.continuationToken !== undefined)) {
        throw new Error("History indexing state is invalid.");
      }
      if (state.value.complete) return;
      const prefix = `${this.parentPrefix(parentOid)}/interactions/${sessionId}/`;
      const page = await this.blobs.list(prefix, HISTORY_BACKFILL_PAGE_SIZE, state.value.continuationToken);
      for (let offset = 0; offset < page.keys.length; offset += 8) {
        await Promise.all(page.keys.slice(offset, offset + 8).map(async (key) => {
          const record = await this.blobs.read<StoredInteraction>(key);
          if (!record) throw new Error("Session history could not be loaded completely.");
          this.validateHistoryInteraction(sessionId, record.value);
          if (key !== `${prefix}${record.value.id}.json`) throw new Error("Session history is invalid.");
          await this.indexInteraction(parentOid, record.value);
        }));
      }
      // Advance only after every reference in this batch is durable. A crashed
      // batch is safe to repeat; concurrent readers cannot overwrite progress.
      const saved = await this.blobs.replace<HistoryIndexState>(stateKey, {
        version: 1,
        complete: !page.continuationToken,
        ...(page.continuationToken ? { continuationToken: page.continuationToken } : {})
      }, state.etag);
      if (saved && !page.continuationToken) return;
    }
    throw new HistoryPreparingError();
  }

  private async readPage<T>(prefix: string, pageSize: number, maxPageSize: number, cursor?: string): Promise<HistoryPage<T>> {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > maxPageSize) throw new InputValidationError();
    const continuationToken = decodeCursor(prefix, cursor);
    const page = await this.blobs.list(prefix, pageSize, continuationToken);
    const items: T[] = [];
    for (let offset = 0; offset < page.keys.length; offset += 8) {
      const records = await Promise.all(page.keys.slice(offset, offset + 8).map((key) => this.blobs.read<T>(key)));
      for (const record of records) {
        if (!record) throw new Error("History page could not be loaded completely.");
        items.push(record.value);
      }
    }
    return {
      items,
      ...nextCursor(prefix, page.continuationToken)
    };
  }

  private async updateJson<T>(key: string, update: (current: T | null) => T | Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt += 1) {
      const existing = await this.blobs.read<T>(key);
      const next = await update(existing?.value ?? null);
      const saved = existing
        ? await this.blobs.replace(key, next, existing.etag)
        : await this.blobs.create(key, next);
      if (saved) {
        return next;
      }
    }
    throw new Error("Concurrent persistence update could not be completed.");
  }
}

function historyTimestamp(at: string): string {
  const timestamp = typeof at === "string" ? Date.parse(at) : NaN;
  if (!Number.isFinite(timestamp)) throw new Error("Session history timestamp is invalid.");
  const normalized = new Date(timestamp).toISOString();
  if (normalized.length !== 24) throw new Error("Session history timestamp is invalid.");
  return normalized;
}

function validateHistoryId(id: string): void {
  try {
    validateSessionId(id);
  } catch {
    throw new Error("Session history identifier is invalid.");
  }
}

function mergeNotes(current: LearningNote[], note: LearningNote, maxNotes: number, maxPerSession = maxNotes): LearningNote[] {
  const sorted = [...current.filter((item) =>
    item.interactionId !== note.interactionId || item.sessionId !== note.sessionId
  ), note].sort((a, b) => a.at.localeCompare(b.at) || a.interactionId.localeCompare(b.interactionId));
  const counts = new Map<string, number>();
  return sorted.reverse().filter((item) => {
    const key = `${item.sessionId}:${item.language}`;
    const count = counts.get(key) ?? 0;
    counts.set(key, count + 1);
    return count < maxPerSession;
  }).slice(0, maxNotes).reverse();
}

export function decodeCursor(prefix: string, cursor?: string): string | undefined {
  if (cursor === undefined) return undefined;
  if (cursor.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new InputValidationError();
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { prefix?: unknown; token?: unknown };
    if (value.prefix !== prefix || typeof value.token !== "string" || !value.token || value.token.length > 8192) {
      throw new InputValidationError();
    }

    return value.token;
  } catch {
    throw new InputValidationError();
  }
}

export function nextCursor(prefix: string, token?: string): { nextCursor?: string } {
  return token ? { nextCursor: Buffer.from(JSON.stringify({ prefix, token })).toString("base64url") } : {};
}
