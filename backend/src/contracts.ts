import { createHash } from "node:crypto";

export type Language = "en" | "nb";
export type Role = "user" | "assistant";
export type Mood = "gentle" | "cheerful" | "calm";

export interface Preferences {
  appearance: "rose" | "sunny" | "mint";
  voice: "default" | "alternate";
  mood: Mood;
}

export function isMood(value: unknown): value is Mood {
  return value === "gentle" || value === "cheerful" || value === "calm";
}

export function validatePreferences(value: unknown): Preferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputValidationError();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["appearance", "voice", "mood"].includes(key)) ||
      (body.appearance !== "rose" && body.appearance !== "sunny" && body.appearance !== "mint") ||
      (body.voice !== "default" && body.voice !== "alternate") || !isMood(body.mood)) {
    throw new InputValidationError();
  }
  return { appearance: body.appearance, voice: body.voice, mood: body.mood };
}

export interface ChatInput {
  sessionId?: string;
  subject: string;
  language: Language;
  message: string;
  mood?: Mood;
}

export interface SessionSummary {
  id: string;
  subject: string;
  language: Language;
  updatedAt: string;
  summary: string;
}

export interface ChatEvent {
  id: string;
  role: Role;
  text: string;
  at: string;
}

export interface Interaction {
  id: string;
  sessionId: string;
  subject: string;
  language: Language;
  fingerprint: string;
  updatedAt: string;
  summary: string;
  events: [ChatEvent, ChatEvent];
  mood?: Mood;
}

export interface PendingInteraction extends Omit<Interaction, "events"> {
  events: [ChatEvent];
}

export type StoredInteraction = PendingInteraction | Interaction;

export interface LearningNote {
  interactionId: string;
  sessionId: string;
  language: Language;
  at: string;
  question: string;
  explanation: string;
}

export interface SessionRecord extends SessionSummary {
  // Bounded context cache only; Blob prefix listing is authoritative for history.
  recentNotes?: LearningNote[];
  interactionIds?: string[];
}

export interface SubjectProgress {
  subject: string;
  updatedAt: string;
  summary: string;
  recentNotes?: LearningNote[];
}

export interface BlobValue<T> {
  value: T;
  etag: string;
}

export interface JsonBlobStore {
  read<T>(key: string): Promise<BlobValue<T> | null>;
  create<T>(key: string, value: T): Promise<boolean>;
  replace<T>(key: string, value: T, etag: string): Promise<boolean>;
  list(prefix: string, pageSize: number, continuationToken?: string, hierarchy?: boolean): Promise<{
    keys: string[];
    continuationToken?: string;
  }>;
}

export class PersistenceConflictError extends Error {}

export interface HistoryPage<T> {
  items: T[];
  nextCursor?: string;
}

export const MAX_MESSAGE_LENGTH = 1200;

export function learningNote(interaction: Interaction): LearningNote {
  return {
    interactionId: interaction.id,
    sessionId: interaction.sessionId,
    language: interaction.language,
    at: interaction.updatedAt,
    question: compactText(interaction.events[0].text, 180),
    explanation: compactText(interaction.events[1].text, 220)
  };
}

export function compactText(text: string, limit: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function summarizeNotes(notes: LearningNote[]): string {
  if (!notes.length) return "";
  return compactText(
    `Practice discussed (not evidence of mastery): ${notes.slice(-3).map((note) =>
      `Question: ${note.question}; tutor explanation: ${note.explanation}`
    ).join(" | ")}`,
    1200
  );
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._~-]{8,128}$/;
const SUBJECT_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .,'&()\-]{0,59}$/u;

export function validateChatInput(value: unknown): ChatInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputValidationError();
  }
  const body = value as Record<string, unknown>;
  const sessionId = body.sessionId;
  const subject = body.subject;
  const language = body.language;
  const message = body.message;
  const mood = body.mood;

  if (Object.keys(body).some((key) => !["sessionId", "subject", "language", "message", "mood"].includes(key)) ||
      (mood !== undefined && !isMood(mood)) ||
      (sessionId !== undefined &&
      (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId)))) {
    throw new InputValidationError();
  }
  if (typeof subject !== "string" || !SUBJECT_PATTERN.test(subject.trim()) ||
      typeof language !== "string" || (language !== "en" && language !== "nb") ||
      typeof message !== "string" || !message.trim() ||
      message.length > MAX_MESSAGE_LENGTH || message.trim().length > MAX_MESSAGE_LENGTH ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) {
    throw new InputValidationError();
  }

  return {
    ...(sessionId ? { sessionId: sessionId.toLowerCase() } : {}),
    subject: subject.trim(),
    language,
    message: message.trim(),
    ...(isMood(mood) ? { mood } : {})
  };
}

export class InputValidationError extends Error {}

export function validateSessionId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new InputValidationError();
  }
  return value.toLowerCase();
}

export function validateIdempotencyKey(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  if (!IDEMPOTENCY_PATTERN.test(value)) {
    throw new InputValidationError();
  }
  return value;
}

export function idempotentUuid(parentOid: string, namespace: string, key: string): string {
  const hex = createHash("sha256").update(parentOid).update("\0").update(namespace).update("\0").update(key).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "a";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function requestFingerprint(input: ChatInput): string {
  // Keep the legacy hash for requests without an explicit mood so saved
  // completions remain replayable after preferences change.
  const fields = [input.subject.toLocaleLowerCase(), input.language, input.message];
  if (input.mood !== undefined) fields.push(input.mood);
  return createHash("sha256")
    .update(JSON.stringify(fields))
    .digest("hex");
}

export function subjectKey(subject: string): string {
  return createHash("sha256").update(subject.normalize("NFKC").toLocaleLowerCase()).digest("hex");
}
