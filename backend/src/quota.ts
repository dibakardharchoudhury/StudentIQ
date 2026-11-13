import type { JsonBlobStore } from "./contracts.js";

export interface QuotaSettings {
  chatDailyLimit: number;
  speechTokenDailyLimit: number;
}

export type QuotaKind = "chat" | "speechToken";

interface DailyUsage {
  version: 1;
  day: string;
  chat: number;
  speechToken: number;
}

export class QuotaExceededError extends Error {}
export class QuotaUnavailableError extends Error {}

const MAX_CHAT_LIMIT = 200;
const MAX_SPEECH_TOKEN_LIMIT = 500;
const MAX_RESERVATION_ATTEMPTS = 16;

export function readQuotaSettings(env: Record<string, string | undefined>): QuotaSettings {
  function boundedInteger(value: string | undefined, defaultValue: number, maximum: number): number {
    if (value === undefined) return defaultValue;
    if (!/^(0|[1-9]\d{0,2})$/.test(value) || String(Number(value)) !== value || Number(value) > maximum) {
      throw new Error("Invalid daily quota configuration.");
    }
    return Number(value);
  }
  return {
    chatDailyLimit: boundedInteger(env.CHAT_DAILY_LIMIT, 60, MAX_CHAT_LIMIT),
    speechTokenDailyLimit: boundedInteger(env.SPEECH_TOKEN_DAILY_LIMIT, 200, MAX_SPEECH_TOKEN_LIMIT)
  };
}

export class DailyQuotaRepository {
  constructor(
    private readonly blobs: JsonBlobStore,
    private readonly settings: QuotaSettings,
    private readonly now: () => Date = () => new Date()
  ) {
    if (!Number.isInteger(settings.chatDailyLimit) || settings.chatDailyLimit < 0 ||
        settings.chatDailyLimit > MAX_CHAT_LIMIT ||
        !Number.isInteger(settings.speechTokenDailyLimit) || settings.speechTokenDailyLimit < 0 ||
        settings.speechTokenDailyLimit > MAX_SPEECH_TOKEN_LIMIT) {
      throw new Error("Invalid daily quota configuration.");
    }
  }

  async consume(parentOid: string, kind: QuotaKind): Promise<void> {
    try {
      const day = this.now().toISOString().slice(0, 10);
      const key = `parents/${parentOid.toLowerCase()}/quotas/${day}.json`;
      const limit = kind === "chat" ? this.settings.chatDailyLimit : this.settings.speechTokenDailyLimit;
      for (let attempt = 0; attempt < MAX_RESERVATION_ATTEMPTS; attempt++) {
        const existing = await this.blobs.read<unknown>(key);
        const current: DailyUsage = existing
          ? validateUsage(existing.value, day)
          : { version: 1, day, chat: 0, speechToken: 0 };
        if (current[kind] >= limit) throw new QuotaExceededError();
        const next: DailyUsage = { ...current, [kind]: current[kind] + 1 };
        const saved = existing
          ? await this.blobs.replace(key, next, existing.etag)
          : await this.blobs.create(key, next);
        if (saved) return;
      }
      throw new QuotaUnavailableError();
    } catch (error) {
      if (error instanceof QuotaExceededError) throw error;
      // Unknown outcomes are never retried as successful reservations or refunded.
      throw new QuotaUnavailableError();
    }
  }
}

function validateUsage(value: unknown, day: string): DailyUsage {
  if (!value || typeof value !== "object") throw new QuotaUnavailableError();
  const record = value as Partial<DailyUsage>;
  if (record.version !== 1 || record.day !== day ||
      typeof record.chat !== "number" || !Number.isInteger(record.chat) ||
      record.chat < 0 || record.chat > MAX_CHAT_LIMIT ||
      typeof record.speechToken !== "number" || !Number.isInteger(record.speechToken) ||
      record.speechToken < 0 || record.speechToken > MAX_SPEECH_TOKEN_LIMIT) {
    throw new QuotaUnavailableError();
  }
  return record as DailyUsage;
}
