import { createHash, randomInt, randomUUID } from "node:crypto";
import {
  InputValidationError, subjectKey, type HistoryPage, type JsonBlobStore, type Language
} from "./contracts.js";
import { decodeCursor, nextCursor } from "./storage.js";

export interface QuizInput {
  subject: string;
  language: Language;
}

export type QuizVisual =
  | { kind: "array"; rows: number; columns: number; icon: "star" | "apple" | "leaf" | "note" | "drop" }
  | { kind: "fraction"; parts: number; filled: number }
  | { kind: "cards"; style: "sequence" | "timeline" | "words" | "places"; items: string[] };

export interface GeneratedQuiz {
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
  visual?: QuizVisual;
}

export interface QuizRecord extends GeneratedQuiz, QuizInput {
  id: string;
  fingerprint: string;
  createdAt: string;
  answer?: { answerIndex: number; correct: boolean; at: string };
}

interface QuizMemory {
  recent: { question: string; fingerprint: string; visual?: QuizVisual }[];
}

export interface QuizGenerator {
  generate(input: QuizInput, recentQuestions: string[], context: { subjectSummary: string; recentQuestions: string[] }, targetVisual?: QuizVisual): Promise<GeneratedQuiz>;
}

export class UnsupportedQuizSubjectError extends Error {}
export class QuizNotFoundError extends Error {}
export class QuizAnswerConflictError extends Error {}
export class QuizDuplicateError extends Error {}

const SUBJECTS: Record<string, string> = {
  math: "Maths", maths: "Maths", mathematics: "Maths", matematikk: "Maths",
  norsk: "Norsk", norwegian: "Norsk", bokmål: "Norsk", bokmal: "Norsk",
  science: "Science", naturfag: "Science",
  geography: "Geography", geografi: "Geography",
  history: "History", historie: "History",
  english: "English", engelsk: "English",
  piano: "Piano", "music theory": "Music theory", musikkteori: "Music theory",
  french: "French", fransk: "French", spanish: "Spanish", spansk: "Spanish",
  german: "German", tysk: "German"
};
const MAX_RECENT = 24;
const MAX_WRITE_ATTEMPTS = 8;

export function validateQuizInput(value: unknown): QuizInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputValidationError();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "subject" && key !== "language") ||
      typeof body.subject !== "string" || !body.subject.trim() || body.subject.length > 60 ||
      (body.language !== "en" && body.language !== "nb")) throw new InputValidationError();
  const subject = SUBJECTS[body.subject.trim().toLowerCase()];
  if (typeof subject !== "string") throw new UnsupportedQuizSubjectError();
  return { subject, language: body.language };
}

function plainString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum &&
    !/[\u0000-\u001f\u007f]|<[^>]*>|https?:\/\/|www\./i.test(value);
}

function validateVisual(value: unknown): QuizVisual {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid quiz visual.");
  const visual = value as Record<string, unknown>;
  if (visual.kind === "array" && Object.keys(visual).every((key) => ["kind", "rows", "columns", "icon"].includes(key)) &&
      Number.isInteger(visual.rows) && Number(visual.rows) >= 1 && Number(visual.rows) <= 8 &&
      Number.isInteger(visual.columns) && Number(visual.columns) >= 1 && Number(visual.columns) <= 8 &&
      typeof visual.icon === "string" && ["star", "apple", "leaf", "note", "drop"].includes(visual.icon)) {
    return { kind: "array", rows: Number(visual.rows), columns: Number(visual.columns), icon: visual.icon as Extract<QuizVisual, { kind: "array" }>["icon"] };
  }
  if (visual.kind === "fraction" && Object.keys(visual).every((key) => ["kind", "parts", "filled"].includes(key)) &&
      Number.isInteger(visual.parts) && Number(visual.parts) >= 2 && Number(visual.parts) <= 12 &&
      Number.isInteger(visual.filled) && Number(visual.filled) >= 0 && Number(visual.filled) <= Number(visual.parts)) {
    return { kind: "fraction", parts: Number(visual.parts), filled: Number(visual.filled) };
  }
  if (visual.kind === "cards" && Object.keys(visual).every((key) => ["kind", "style", "items"].includes(key)) &&
      typeof visual.style === "string" && ["sequence", "timeline", "words", "places"].includes(visual.style) &&
      Array.isArray(visual.items) && visual.items.length >= 2 && visual.items.length <= 4 &&
      visual.items.every((item) => plainString(item, 48))) {
    return { kind: "cards", style: visual.style as Extract<QuizVisual, { kind: "cards" }>["style"], items: visual.items.map((item: string) => item.trim()) };
  }
  throw new Error("Invalid quiz visual.");
}

export function validateGeneratedQuiz(value: unknown): GeneratedQuiz {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid generated quiz.");
  const quiz = value as Record<string, unknown>;
  if (Object.keys(quiz).some((key) => !["question", "options", "correctIndex", "explanation", "visual"].includes(key)) ||
      !plainString(quiz.question, 320) || !plainString(quiz.explanation, 600) ||
      !Array.isArray(quiz.options) || quiz.options.length !== 4 ||
      !quiz.options.every((option) => plainString(option, 160)) ||
      new Set(quiz.options.map((option: string) => option.normalize("NFKC").trim().toLowerCase())).size !== 4 ||
      !Number.isInteger(quiz.correctIndex) || Number(quiz.correctIndex) < 0 || Number(quiz.correctIndex) > 3) {
    throw new Error("Invalid generated quiz.");
  }
  return {
    question: quiz.question.trim(), options: quiz.options.map((option: string) => option.trim()) as GeneratedQuiz["options"],
    correctIndex: quiz.correctIndex as number, explanation: quiz.explanation.trim(),
    ...(quiz.visual === undefined ? {} : { visual: validateVisual(quiz.visual) })
  };
}

export function validateQuizAnswer(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputValidationError();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || typeof body.answerIndex !== "number" ||
      !Number.isInteger(body.answerIndex) || body.answerIndex < 0 || body.answerIndex > 3) {
    throw new InputValidationError();
  }
  return body.answerIndex;
}

function validateQuizId(id: string): string {
  if (!/^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) || id.length !== 50) {
    throw new InputValidationError();
  }
  return id;
}

export function quizFingerprint(question: string): string {
  return createHash("sha256").update(question.normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim()).digest("hex");
}

function mathsVisualKey(visual: QuizVisual | undefined): string | undefined {
  if (visual?.kind === "array") return `array:${visual.rows}:${visual.columns}`;
  if (visual?.kind === "fraction") return `fraction:${visual.parts}:${visual.filled}`;
  return undefined;
}

export function chooseMathVisual(recent: QuizVisual[]): QuizVisual {
  const used = new Set(recent.map(mathsVisualKey));
  const candidates: QuizVisual[] = [];
  for (let rows = 2; rows <= 6; rows++) for (let columns = 2; columns <= 6; columns++) {
    candidates.push({ kind: "array", rows, columns, icon: "star" });
  }
  for (let parts = 2; parts <= 9; parts++) for (let filled = 1; filled < parts; filled++) {
    candidates.push({ kind: "fraction", parts, filled });
  }
  const available = candidates.filter((visual) => !used.has(mathsVisualKey(visual)));
  if (!available.length) throw new Error("No fresh maths visual available.");
  const visual = available[randomInt(available.length)]!;
  if (visual.kind === "array") {
    const icons = ["star", "apple", "leaf", "note", "drop"] as const;
    return { ...visual, icon: icons[randomInt(icons.length)]! };
  }
  return visual;
}

export class QuizRepository {
  constructor(private readonly blobs: JsonBlobStore) {}

  private prefix(parentOid: string): string {
    return `parents/${parentOid.toLowerCase()}/quiz/questions/`;
  }

  private memoryKey(parentOid: string, input: QuizInput): string {
    return `parents/${parentOid.toLowerCase()}/quiz/memory/${subjectKey(`${input.subject}:${input.language}`)}.json`;
  }

  async recent(parentOid: string, input: QuizInput): Promise<{ questions: string[]; visuals: QuizVisual[] }> {
    const stored = await this.blobs.read<unknown>(this.memoryKey(parentOid, input));
    const recent = stored ? validateMemory(stored.value).recent : [];
    return {
      questions: recent.slice(-8).map((item) => item.question),
      visuals: recent.flatMap((item) => item.visual ? [item.visual] : [])
    };
  }

  async recentQuestions(parentOid: string, input: QuizInput): Promise<string[]> {
    return (await this.recent(parentOid, input)).questions;
  }

  async create(parentOid: string, input: QuizInput, generated: GeneratedQuiz): Promise<{
    id: string; question: string; options: GeneratedQuiz["options"]; visual?: QuizVisual;
  }> {
    input = validateQuizInput(input);
    generated = validateGeneratedQuiz(generated);
    const fingerprint = quizFingerprint(generated.question);
    const memoryKey = this.memoryKey(parentOid, input);
    let confirmed = false;
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const current = await this.blobs.read<unknown>(memoryKey);
      const memory = current ? validateMemory(current.value) : { recent: [] };
      if (memory.recent.some((item) => item.fingerprint === fingerprint)) throw new QuizDuplicateError();
      const visualKey = input.subject === "Maths" ? mathsVisualKey(generated.visual) : undefined;
      if (visualKey && memory.recent.some((item) => mathsVisualKey(item.visual) === visualKey)) throw new QuizDuplicateError();
      const next: QuizMemory = {
        recent: [...memory.recent, { question: generated.question, fingerprint,
          ...(visualKey && generated.visual ? { visual: generated.visual } : {}) }].slice(-MAX_RECENT)
      };
      confirmed = current
        ? await this.blobs.replace(memoryKey, next, current.etag)
        : await this.blobs.create(memoryKey, next);
      if (confirmed) break;
    }
    if (!confirmed) throw new Error("Quiz memory write could not be confirmed.");
    const now = new Date();
    const id = `${now.getTime()}-${randomUUID()}`;
    const record: QuizRecord = { ...input, ...generated, fingerprint, id, createdAt: now.toISOString() };
    if (!await this.blobs.create(`${this.prefix(parentOid)}${id}.json`, record)) {
      throw new Error("Quiz write could not be confirmed.");
    }
    return { id, question: record.question, options: [...record.options], ...(record.visual ? { visual: record.visual } : {}) };
  }

  async answer(parentOid: string, id: string, answerIndex: number): Promise<{
    correct: boolean; correctIndex: number; explanation: string;
  }> {
    id = validateQuizId(id);
    answerIndex = validateQuizAnswer({ answerIndex });
    const key = `${this.prefix(parentOid)}${id}.json`;
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const stored = await this.blobs.read<unknown>(key);
      if (!stored) throw new QuizNotFoundError();
      const quiz = validateRecord(stored.value);
      if (quiz.answer && quiz.answer.answerIndex !== answerIndex) throw new QuizAnswerConflictError();
      const next: QuizRecord = quiz.answer ? quiz : {
        ...quiz, answer: { answerIndex, correct: answerIndex === quiz.correctIndex, at: new Date().toISOString() }
      };
      if (quiz.answer || await this.blobs.replace(key, next, stored.etag)) {
        return { correct: next.answer!.correct, correctIndex: next.correctIndex, explanation: next.explanation };
      }
    }
    throw new Error("Quiz answer write could not be confirmed.");
  }

  async attempts(parentOid: string, cursor?: string, pageSize = 50): Promise<HistoryPage<{
    id: string; subject: string; question: string; correct: boolean; at: string;
  }>> {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new InputValidationError();
    const prefix = this.prefix(parentOid);
    const page = await this.blobs.list(prefix, pageSize, decodeCursor(prefix, cursor));
    const items: { id: string; subject: string; question: string; correct: boolean; at: string }[] = [];
    for (let offset = 0; offset < page.keys.length; offset += 8) {
      const records = await Promise.all(page.keys.slice(offset, offset + 8).map((key) => this.blobs.read<unknown>(key)));
      for (const stored of records) {
        if (!stored) throw new Error("Quiz history is unavailable.");
        const quiz = validateRecord(stored.value);
        if (quiz.answer) items.push({
          id: quiz.id, subject: quiz.subject, question: quiz.question,
          correct: quiz.answer.correct, at: quiz.answer.at
        });
      }
    }
    return { items, ...nextCursor(prefix, page.continuationToken) };
  }
}

function validateMemory(value: unknown): QuizMemory {
  if (!value || typeof value !== "object") throw new Error("Invalid quiz memory.");
  const memory = value as QuizMemory;
  if (!Array.isArray(memory.recent) || memory.recent.length > MAX_RECENT ||
      memory.recent.some((item) => !item || !plainString(item.question, 320) ||
        item.fingerprint !== quizFingerprint(item.question))) throw new Error("Invalid quiz memory.");
  for (const item of memory.recent) if (item.visual !== undefined) validateVisual(item.visual);
  return memory;
}

function validateRecord(value: unknown): QuizRecord {
  if (!value || typeof value !== "object") throw new Error("Invalid quiz storage.");
  const quiz = value as QuizRecord;
  try {
    validateQuizInput({ subject: quiz.subject, language: quiz.language });
    validateGeneratedQuiz({
      question: quiz.question, options: quiz.options, correctIndex: quiz.correctIndex, explanation: quiz.explanation,
      ...(quiz.visual === undefined ? {} : { visual: quiz.visual })
    });
    validateQuizId(quiz.id);
    if (quiz.fingerprint !== quizFingerprint(quiz.question) ||
        typeof quiz.createdAt !== "string" || !Number.isFinite(Date.parse(quiz.createdAt))) throw new Error();
    if (quiz.answer !== undefined) {
      if (!quiz.answer || typeof quiz.answer !== "object") throw new Error();
      validateQuizAnswer({ answerIndex: quiz.answer.answerIndex });
      if (typeof quiz.answer.at !== "string" || !Number.isFinite(Date.parse(quiz.answer.at)) ||
          quiz.answer.correct !== (quiz.answer.answerIndex === quiz.correctIndex)) throw new Error();
    }
  } catch {
    throw new Error("Invalid quiz storage.");
  }
  return quiz;
}
