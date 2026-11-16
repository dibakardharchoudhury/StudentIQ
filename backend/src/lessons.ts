import { InputValidationError, PersistenceConflictError, subjectKey, type JsonBlobStore } from "./contracts.js";
import { QuizRepository, validateGeneratedQuiz, validateQuizInput, type QuizInput, type QuizQuestion } from "./quiz.js";

interface LessonRecord extends QuizInput {
  date: string;
  completedIds: string[];
  current: QuizQuestion | null;
}

export class LessonRepository {
  constructor(private readonly blobs: JsonBlobStore, private readonly quiz: QuizRepository,
    private readonly now: () => Date = () => new Date()) {}

  private selectionKey(parentOid: string, input: QuizInput): string {
    return `parents/${parentOid.toLowerCase()}/lessons/selection/${input.language}.json`;
  }

  async selectedLanguage(parentOid: string, language: unknown): Promise<QuizInput> {
    const fallback = validateQuizInput({ subject: "Spanish", language });
    const saved = await this.blobs.read<{ subject: string }>(this.selectionKey(parentOid, fallback));
    if (!saved) return fallback;
    if (!["Spanish", "French", "German"].includes(saved.value.subject)) throw new Error("Invalid lesson selection.");
    return { ...fallback, subject: saved.value.subject };
  }

  private async rememberLanguage(parentOid: string, input: QuizInput) {
    if (!["Spanish", "French", "German"].includes(input.subject)) return;
    const key = this.selectionKey(parentOid, input);
    for (let attempt = 0; attempt < 8; attempt++) {
      const saved = await this.blobs.read<{ subject: string }>(key);
      if (saved?.value.subject === input.subject) return;
      if (saved ? await this.blobs.replace(key, { subject: input.subject }, saved.etag)
        : await this.blobs.create(key, { subject: input.subject })) return;
    }
    throw new Error("Lesson language selection could not be saved.");
  }

  private key(parentOid: string, input: QuizInput, date: string): string {
    return `parents/${parentOid.toLowerCase()}/lessons/${date}/${subjectKey(`${input.subject}:${input.language}`)}.json`;
  }

  private date(date = this.now().toISOString().slice(0, 10)): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
        date > this.now().toISOString().slice(0, 10)) throw new InputValidationError();
    return date;
  }

  private async load(parentOid: string, rawInput: QuizInput, rawDate?: string) {
    const input = validateQuizInput(rawInput);
    const date = this.date(rawDate);
    const key = this.key(parentOid, input, date);
    for (let attempt = 0; attempt < 8; attempt++) {
      const stored = await this.blobs.read<LessonRecord>(key);
      const record = stored ? stored.value : { ...input, date, completedIds: [], current: null };
      if (!record || Object.keys(record).some(key => !["date", "subject", "language", "completedIds", "current"].includes(key)) ||
          record.date !== date || record.subject !== input.subject || record.language !== input.language ||
          !Array.isArray(record.completedIds) || new Set(record.completedIds).size !== record.completedIds.length ||
          record.completedIds.some(id => typeof id !== "string" ||
            !/^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) ||
          (!record.current && (record.current !== null || record.completedIds.length > 0))) {
        throw new Error("Invalid lesson storage.");
      }
      if (record.current) {
        const current = record.current;
        if (typeof current !== "object" || Object.keys(current).some(key =>
          !["id", "question", "options", "lesson", "topic", "visual"].includes(key)) ||
          (current.topic !== undefined && (typeof current.topic !== "string" || current.topic.length > 80))) {
          throw new Error("Invalid lesson question storage.");
        }
        validateGeneratedQuiz({ question: current.question, options: current.options, correctIndex: 0,
          explanation: "Validation only", ...(current.lesson === undefined ? {} : { lesson: current.lesson }),
          ...(current.visual === undefined ? {} : { visual: current.visual }) });
      }
      const answer = record.current ? (await this.quiz.state(parentOid, record.current.id)).answer : null;
      // The quiz answer is the source of truth, including after an interrupted two-blob write.
      if (answer && !record.completedIds.includes(record.current!.id)) {
        const next = { ...record, completedIds: [...record.completedIds, record.current!.id] };
        if (!stored || !await this.blobs.replace(key, next, stored.etag)) continue;
        continue;
      }
      return { key, record, etag: stored?.etag, view: {
        date, timeZone: "UTC" as const, subject: input.subject, language: input.language,
        completed: record.completedIds.length, target: 10 as const, current: record.current, answer
      } };
    }
    throw new Error("Lesson progress write could not be confirmed.");
  }

  async get(parentOid: string, input: QuizInput, date?: string) {
    return (await this.load(parentOid, input, date)).view;
  }

  async next(parentOid: string, input: QuizInput, generate: () => Promise<QuizQuestion>) {
    input = validateQuizInput(input);
    await this.rememberLanguage(parentOid, input);
    const current = await this.load(parentOid, input);
    if (current.record.current && !current.view.answer) return current.view;
    const question = await generate();
    const next = { ...current.record, current: question };
    const saved = current.etag
      ? await this.blobs.replace(current.key, next, current.etag)
      : await this.blobs.create(current.key, next);
    // A competing issuance wins; never replace its question or count it twice.
    const result = await this.get(parentOid, input, current.record.date);
    if (!saved && !result.current) throw new Error("Lesson question write could not be confirmed.");
    return result;
  }

  async answer(parentOid: string, input: QuizInput, date: string, quizId: string, answerIndex: number) {
    const current = await this.load(parentOid, input, date);
    if (current.record.current?.id !== quizId && !current.record.completedIds.includes(quizId)) {
      throw new PersistenceConflictError();
    }
    const result = await this.quiz.answer(parentOid, quizId, answerIndex);
    return { result, lesson: await this.get(parentOid, input, date) };
  }

  async check(parentOid: string, input: QuizInput, date: string, quizId: string, answerIndex: number) {
    const current = await this.load(parentOid, input, date);
    if (current.record.current?.id !== quizId || current.view.answer) throw new PersistenceConflictError();
    return this.quiz.check(parentOid, quizId, answerIndex);
  }
}
