import { randomUUID } from "node:crypto";
import {
  idempotentUuid,
  InputValidationError,
  validateSessionId as validateReminderId,
  type JsonBlobStore
} from "./contracts.js";

export interface Reminder {
  id: string;
  title: string;
  date: string;
  completed: boolean;
}

export type ReminderInput =
  | { title: string; date: string; id?: never; completed?: never }
  | Reminder;

interface ReminderCalendar {
  version: 1;
  reminders: Reminder[];
}

export class ReminderNotFoundError extends Error {}
export class ReminderLimitError extends Error {}
export class ReminderConflictError extends Error {}

const MAX_REMINDERS = 250;
const MAX_WRITE_ATTEMPTS = 8;

export function validateReminderInput(value: unknown): ReminderInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputValidationError();
  const body = value as Record<string, unknown>;
  const update = Object.hasOwn(body, "id");
  const allowed = update ? ["id", "title", "date", "completed"] : ["title", "date"];
  if (Object.keys(body).some((key) => !allowed.includes(key)) ||
      typeof body.title !== "string" || !body.title.trim() ||
      body.title.length > 120 || /[\u0000-\u001f\u007f]/.test(body.title) ||
      typeof body.date !== "string" || body.date.length !== 10 ||
      !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    throw new InputValidationError();
  }
  const parsed = new Date(`${body.date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== body.date) {
    throw new InputValidationError();
  }
  const fields = { title: body.title.trim(), date: body.date };
  if (!update) return fields;
  if (typeof body.id !== "string" || typeof body.completed !== "boolean") throw new InputValidationError();
  return { ...fields, id: validateReminderId(body.id), completed: body.completed };
}

export class ReminderRepository {
  constructor(private readonly blobs: JsonBlobStore) {}

  private key(parentOid: string): string {
    return `parents/${parentOid.toLowerCase()}/admin/reminders.json`;
  }

  async list(parentOid: string): Promise<Reminder[]> {
    const stored = await this.blobs.read<unknown>(this.key(parentOid));
    const reminders = stored ? validateCalendar(stored.value).reminders : [];
    return reminders.map((item) => ({ ...item }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }

  async save(parentOid: string, input: ReminderInput, idempotencyKey?: string): Promise<{
    reminder: Reminder;
    created: boolean;
  }> {
    input = validateReminderInput(input);
    const id = input.id ?? (idempotencyKey
      ? idempotentUuid(parentOid, "reminder", idempotencyKey)
      : randomUUID());
    const key = this.key(parentOid);
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const stored = await this.blobs.read<unknown>(key);
      const calendar = stored ? validateCalendar(stored.value) : { version: 1 as const, reminders: [] };
      const existing = calendar.reminders.find((item) => item.id === id);
      if (input.id && !existing) throw new ReminderNotFoundError();
      if (!input.id && existing) {
        if (existing.title !== input.title || existing.date !== input.date) throw new ReminderConflictError();
        return { reminder: { ...existing }, created: false };
      }
      if (!existing && calendar.reminders.length >= MAX_REMINDERS) throw new ReminderLimitError();
      const reminder: Reminder = { id, title: input.title, date: input.date, completed: input.completed ?? false };
      const next: ReminderCalendar = {
        version: 1,
        reminders: [...calendar.reminders.filter((item) => item.id !== id), reminder]
      };
      const saved = stored
        ? await this.blobs.replace(key, next, stored.etag)
        : await this.blobs.create(key, next);
      if (saved) return { reminder, created: !existing };
    }
    throw new Error("Reminder write could not be confirmed.");
  }

  async delete(parentOid: string, id: string): Promise<void> {
    id = validateReminderId(id);
    const key = this.key(parentOid);
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const stored = await this.blobs.read<unknown>(key);
      if (!stored) return;
      const calendar = validateCalendar(stored.value);
      const reminders = calendar.reminders.filter((item) => item.id !== id);
      if (reminders.length === calendar.reminders.length) return;
      if (await this.blobs.replace(key, { version: 1, reminders }, stored.etag)) return;
    }
    throw new Error("Reminder deletion could not be confirmed.");
  }
}

function validateCalendar(value: unknown): ReminderCalendar {
  if (!value || typeof value !== "object") throw new Error("Invalid reminder storage.");
  const calendar = value as Partial<ReminderCalendar>;
  if (calendar.version !== 1 || !Array.isArray(calendar.reminders) || calendar.reminders.length > MAX_REMINDERS) {
    throw new Error("Invalid reminder storage.");
  }
  const ids = new Set<string>();
  const reminders = calendar.reminders.map((item) => {
    let validated: ReminderInput;
    try {
      validated = validateReminderInput(item);
    } catch {
      throw new Error("Invalid reminder storage.");
    }
    if (!validated.id || ids.has(validated.id)) throw new Error("Invalid reminder storage.");
    ids.add(validated.id);
    return validated as Reminder;
  });
  return { version: 1, reminders };
}
