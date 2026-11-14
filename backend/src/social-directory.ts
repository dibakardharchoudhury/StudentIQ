import { createHash, randomUUID } from "node:crypto";
import { InputValidationError, type JsonBlobStore } from "./contracts.js";

export type SocialProvider = "google" | "microsoft";
export type SocialRole = "parent" | "student";
export interface SocialAccount {
  id: string;
  provider: SocialProvider;
  subject: string;
  role: SocialRole;
  admin: boolean;
  email?: string;
  revision: string;
}
export interface SocialAccessRequest {
  id: string;
  provider: SocialProvider;
  subject: string;
  email?: string;
  requestedAt: string;
}
interface Directory {
  accounts: SocialAccount[];
  requests: SocialAccessRequest[];
}
const REQUEST_LIFETIME_MS = 48 * 60 * 60 * 1000;

export class AccessRequestError extends Error {
  constructor() { super("The sign-in request is missing or expired. Ask the person to sign in again, then refresh the list."); }
}

export function emailLabel(value: unknown): string | undefined {
  // Match the frontend email contract so provider metadata cannot break the directory UI.
  if (typeof value !== "string" || value.length > 254 ||
      !/^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/.test(value)) return undefined;
  return value.toLowerCase();
}

function accountId(provider: SocialProvider, subject: string): string {
  return createHash("sha256").update(`${provider}\0${subject}`).digest("hex");
}

function validateInput(value: unknown): Pick<SocialAccount, "provider" | "subject" | "role" | "admin"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputValidationError();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !["provider", "subject", "role", "admin"].includes(key)) ||
      (body.provider !== "google" && body.provider !== "microsoft") ||
      (body.role !== "parent" && body.role !== "student") ||
      typeof body.subject !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(body.subject) ||
      (body.admin !== undefined && typeof body.admin !== "boolean") ||
      (body.admin === true && body.role !== "parent")) {
    throw new InputValidationError();
  }
  return { provider: body.provider, subject: body.subject, role: body.role, admin: body.admin === true };
}

function validateStored(value: unknown): Directory {
  if (!value || typeof value !== "object" || !("version" in value) ||
      (value.version !== 1 && value.version !== 2) || !("accounts" in value) || !Array.isArray(value.accounts) ||
      value.accounts.length > 20) throw new Error("Invalid access directory.");
  const accounts: SocialAccount[] = [];
  for (const item of value.accounts) {
    if (!item || typeof item !== "object" || typeof item.id !== "string") {
      throw new Error("Invalid access directory.");
    }
    let input: ReturnType<typeof validateInput>;
    try { input = validateInput({ provider: item.provider, subject: item.subject, role: item.role, admin: item.admin }); }
    catch { throw new Error("Invalid access directory."); }
    if (item.id !== accountId(input.provider, input.subject) || typeof item.revision !== "string" ||
        !/^[0-9a-f-]{36}$/.test(item.revision) || accounts.some(account => account.id === item.id)) {
      throw new Error("Invalid access directory.");
    }
    if (item.email !== undefined && !emailLabel(item.email)) throw new Error("Invalid access directory.");
    accounts.push({ id: item.id, ...input, ...(item.email ? { email: item.email } : {}), revision: item.revision });
  }
  const requests: SocialAccessRequest[] = [];
  if (value.version === 2) {
    if (!("requests" in value) || !Array.isArray(value.requests) || value.requests.length > 50) {
      throw new Error("Invalid access directory.");
    }
    for (const item of value.requests) {
      if (!item || typeof item !== "object" || (item.provider !== "google" && item.provider !== "microsoft") ||
          typeof item.subject !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(item.subject) ||
          item.id !== accountId(item.provider, item.subject) ||
          typeof item.requestedAt !== "string" || !Number.isFinite(Date.parse(item.requestedAt)) ||
          (item.email !== undefined && !emailLabel(item.email)) ||
          requests.some(request => request.id === item.id)) throw new Error("Invalid access directory.");
      requests.push({
        id: item.id, provider: item.provider, subject: item.subject, requestedAt: item.requestedAt,
        ...(item.email ? { email: item.email } : {}),
      });
    }
  }
  return { accounts, requests };
}

export class SocialDirectory {
  constructor(private readonly blobs: JsonBlobStore, private readonly parentOid: string) {}

  private key() { return `parents/${this.parentOid.toLowerCase()}/admin/social-accounts.json`; }

  private async read(): Promise<Directory> {
    const stored = await this.blobs.read<unknown>(this.key());
    return stored ? validateStored(stored.value) : { accounts: [], requests: [] };
  }

  async list(): Promise<SocialAccount[]> {
    return (await this.read()).accounts;
  }

  async snapshot(): Promise<Directory> {
    const directory = await this.read();
    return { ...directory, requests: this.currentRequests(directory.requests) };
  }

  private currentRequests(requests: SocialAccessRequest[]): SocialAccessRequest[] {
    return requests.filter(request => Date.parse(request.requestedAt) + REQUEST_LIFETIME_MS > Date.now());
  }

  private async update<T>(change: (directory: Directory) => { directory: Directory; result: T }): Promise<T> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const stored = await this.blobs.read<unknown>(this.key());
      const directory = stored ? validateStored(stored.value) : { accounts: [], requests: [] };
      directory.requests = this.currentRequests(directory.requests);
      const next = change(directory);
      const value = { version: 2, ...next.directory };
      if (stored ? await this.blobs.replace(this.key(), value, stored.etag) : await this.blobs.create(this.key(), value)) {
        return next.result;
      }
    }
    throw new Error("Access list update could not be confirmed.");
  }

  async request(provider: SocialProvider, subject: string, email?: string): Promise<void> {
    validateInput({ provider, subject, role: "student" });
    if (email !== undefined && !emailLabel(email)) throw new InputValidationError();
    const id = accountId(provider, subject);
    await this.update(directory => {
      if (directory.accounts.some(account => account.id === id)) return { directory, result: undefined };
      const requests = directory.requests.filter(request => request.id !== id);
      if (requests.length >= 50) throw new InputValidationError();
      requests.push({ id, provider, subject, ...(email ? { email } : {}), requestedAt: new Date().toISOString() });
      return { directory: { ...directory, requests }, result: undefined };
    });
  }

  async save(value: unknown): Promise<SocialAccount> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputValidationError();
    const body = value as Record<string, unknown>;
    const email = emailLabel(body.email);
    const fromRequest = body.requestId !== undefined;
    if (fromRequest && (Object.keys(body).some(key => !["provider", "requestId", "email", "role", "admin"].includes(key)) ||
        typeof body.requestId !== "string" || !/^[a-f0-9]{64}$/.test(body.requestId) || !email)) {
      throw new InputValidationError();
    }
    return this.update(directory => {
      // Email is a display label, never an authorization identifier. The admin
      // explicitly approves the immutable subject from a signature-checked request.
      const request = fromRequest ? directory.requests.find(item => item.id === body.requestId && item.provider === body.provider) : undefined;
      if (fromRequest && !request) throw new AccessRequestError();
      const input = validateInput(fromRequest
        ? { provider: body.provider, subject: request!.subject, role: body.role, admin: body.admin }
        : value);
      const id = accountId(input.provider, input.subject);
      const existing = directory.accounts.find(item => item.id === id);
      if (!existing && directory.accounts.length >= 20) throw new InputValidationError();
      const account: SocialAccount = {
        ...input, id, ...(fromRequest ? { email: email! } : existing?.email ? { email: existing.email } : {}),
        revision: existing?.role === input.role && existing.admin === input.admin ? existing.revision : randomUUID(),
      };
      return {
        directory: {
          accounts: [...directory.accounts.filter(item => item.id !== id), account],
          requests: directory.requests.filter(item => item.id !== id),
        }, result: account,
      };
    });
  }

  async remove(id: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new InputValidationError();
    await this.update(directory => ({
      directory: { ...directory, accounts: directory.accounts.filter(item => item.id !== id) }, result: undefined,
    }));
  }
}
