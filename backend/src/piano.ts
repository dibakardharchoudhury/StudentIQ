import { randomUUID } from "node:crypto";
import { InputValidationError, validateSessionId, type HistoryPage, type JsonBlobStore } from "./contracts.js";
import { decodeCursor, nextCursor } from "./storage.js";

const TARGET_NOTES = ["C4", "D4", "E4", "F4", "G4", "A4", "B4"] as const;
const SELECTED_NOTES = ["C4", "C#4", "D4", "D#4", "E4", "F4", "F#4", "G4", "G#4", "A4", "A#4", "B4", "C5"] as const;
export type PianoTargetNote = typeof TARGET_NOTES[number];
export type PianoSelectedNote = typeof SELECTED_NOTES[number];

export interface PianoInput {
  targetNote: PianoTargetNote;
  selectedNote: PianoSelectedNote;
}

export interface PianoAttempt extends PianoInput {
  id: string;
  correct: boolean;
  at: string;
}

export function validatePianoInput(value: unknown): PianoInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputValidationError();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "targetNote" && key !== "selectedNote") ||
      typeof body.targetNote !== "string" || !TARGET_NOTES.includes(body.targetNote as PianoTargetNote) ||
      typeof body.selectedNote !== "string" || !SELECTED_NOTES.includes(body.selectedNote as PianoSelectedNote)) {
    throw new InputValidationError();
  }
  return { targetNote: body.targetNote as PianoTargetNote, selectedNote: body.selectedNote as PianoSelectedNote };
}

export class PianoRepository {
  constructor(private readonly blobs: JsonBlobStore) {}

  private prefix(parentOid: string): string {
    return `parents/${parentOid.toLowerCase()}/practice/piano/`;
  }

  async record(parentOid: string, input: PianoInput): Promise<boolean> {
    input = validatePianoInput(input);
    const attempt: PianoAttempt = {
      ...input,
      id: randomUUID(),
      at: new Date().toISOString(),
      correct: input.targetNote === input.selectedNote
    };
    const key = `${this.prefix(parentOid)}${attempt.at}-${attempt.id}.json`;
    if (!await this.blobs.create(key, attempt)) throw new Error("Piano practice write could not be confirmed.");
    return attempt.correct;
  }

  async list(parentOid: string, cursor?: string, pageSize = 50): Promise<HistoryPage<PianoAttempt>> {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new InputValidationError();
    const prefix = this.prefix(parentOid);
    const page = await this.blobs.list(prefix, pageSize, decodeCursor(prefix, cursor));
    const items: PianoAttempt[] = [];
    for (let offset = 0; offset < page.keys.length; offset += 8) {
      const records = await Promise.all(page.keys.slice(offset, offset + 8).map((key) =>
        this.blobs.read<unknown>(key)
      ));
      for (const record of records) {
        if (!record) throw new Error("Piano practice history is unavailable.");
        items.push(validateAttempt(record.value));
      }
    }
    return { items, ...nextCursor(prefix, page.continuationToken) };
  }
}

function validateAttempt(value: unknown): PianoAttempt {
  if (!value || typeof value !== "object") throw new Error("Invalid piano practice storage.");
  const attempt = value as PianoAttempt;
  try {
    validatePianoInput({ targetNote: attempt.targetNote, selectedNote: attempt.selectedNote });
    if (typeof attempt.id !== "string" || typeof attempt.at !== "string" ||
        !Number.isFinite(Date.parse(attempt.at)) || new Date(attempt.at).toISOString() !== attempt.at ||
        attempt.correct !== (attempt.targetNote === attempt.selectedNote)) {
      throw new Error();
    }
    validateSessionId(attempt.id);
  } catch {
    throw new Error("Invalid piano practice storage.");
  }
  return {
    id: attempt.id, targetNote: attempt.targetNote, selectedNote: attempt.selectedNote,
    correct: attempt.correct, at: attempt.at
  };
}
