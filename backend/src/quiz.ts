import { createHash, randomUUID } from "node:crypto";
import {
  InputValidationError, subjectKey, type HistoryPage, type JsonBlobStore, type Language
} from "./contracts.js";
import { decodeCursor, nextCursor } from "./storage.js";

export interface QuizInput {
  subject: string;
  language: Language;
}

export interface GeneratedQuiz {
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
}

export interface QuizRecord extends GeneratedQuiz, QuizInput {
  id: string;
  fingerprint: string;
  createdAt: string;
  answer?: { answerIndex: number; correct: boolean; at: string };
}

interface QuizMemory {
  recent: { question: string; fingerprint: string }[];
}

export interface QuizGenerator {
  generate(input: QuizInput, recentQuestions: string[]): Promise<GeneratedQuiz>;
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

export function validateGeneratedQuiz(value: unknown): GeneratedQuiz {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid generated quiz.");
  const quiz = value as Record<string, unknown>;
  if (Object.keys(quiz).some((key) => !["question", "options", "correctIndex", "explanation"].includes(key)) ||
      !plainString(quiz.question, 320) || !plainString(quiz.explanation, 600) ||
      !Array.isArray(quiz.options) || quiz.options.length !== 4 ||
      !quiz.options.every((option) => plainString(option, 160)) ||
      new Set(quiz.options.map((option: string) => option.normalize("NFKC").trim().toLowerCase())).size !== 4 ||
      !Number.isInteger(quiz.correctIndex) || Number(quiz.correctIndex) < 0 || Number(quiz.correctIndex) > 3) {
    throw new Error("Invalid generated quiz.");
  }
  return {
    question: quiz.question.trim(), options: quiz.options.map((option: string) => option.trim()) as GeneratedQuiz["options"],
    correctIndex: quiz.correctIndex as number, explanation: quiz.explanation.trim()
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

export class QuizRepository {
  constructor(private readonly blobs: JsonBlobStore) {}

  private prefix(parentOid: string): string {
    return `parents/${parentOid.toLowerCase()}/quiz/questions/`;
  }

  private memoryKey(parentOid: string, input: QuizInput): string {
    return `parents/${parentOid.toLowerCase()}/quiz/memory/${subjectKey(`${input.subject}:${input.language}`)}.json`;
  }

  async recentQuestions(parentOid: string, input: QuizInput): Promise<string[]> {
    const stored = await this.blobs.read<unknown>(this.memoryKey(parentOid, input));
    return stored ? validateMemory(stored.value).recent.slice(-8).map((item) => item.question) : [];
  }

  async create(parentOid: string, input: QuizInput, generated: GeneratedQuiz): Promise<{
    id: string; question: string; options: GeneratedQuiz["options"];
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
      const next: QuizMemory = {
        recent: [...memory.recent, { question: generated.question, fingerprint }].slice(-MAX_RECENT)
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
    return { id, question: record.question, options: [...record.options] };
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
  return memory;
}

function validateRecord(value: unknown): QuizRecord {
  if (!value || typeof value !== "object") throw new Error("Invalid quiz storage.");
  const quiz = value as QuizRecord;
  try {
    validateQuizInput({ subject: quiz.subject, language: quiz.language });
    validateGeneratedQuiz({
      question: quiz.question, options: quiz.options, correctIndex: quiz.correctIndex, explanation: quiz.explanation
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
