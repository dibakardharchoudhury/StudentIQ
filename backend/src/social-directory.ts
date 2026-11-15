import { createHash, randomBytes, randomUUID } from "node:crypto";
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
export interface SocialPreapproval {
  id: string;
  provider: SocialProvider;
  email: string;
  role: SocialRole;
  admin: boolean;
  expiresAt: string;
}
interface StoredPreapproval extends SocialPreapproval { codeHash: string }
interface Directory {
  accounts: SocialAccount[];
  requests: SocialAccessRequest[];
  preapprovals: StoredPreapproval[];
}
const REQUEST_LIFETIME_MS = 48 * 60 * 60 * 1000;
const PREAPPROVAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export class InvitationCodeError extends Error {
  constructor() { super("The access code is invalid, expired, or for a different account or sign-in provider."); }
}

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
      (value.version !== 1 && value.version !== 2 && value.version !== 3) || !("accounts" in value) || !Array.isArray(value.accounts) ||
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
  if (value.version === 2 || value.version === 3) {
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
  const preapprovals: StoredPreapproval[] = [];
  if (value.version === 3) {
    if (!("preapprovals" in value) || !Array.isArray(value.preapprovals) ||
        accounts.length + value.preapprovals.length > 20) throw new Error("Invalid access directory.");
    for (const item of value.preapprovals) {
      if (!item || typeof item !== "object" || typeof item.email !== "string" ||
          emailLabel(item.email) !== item.email ||
          typeof item.id !== "string" || item.id !== accountId(item.provider, `invite:${item.email}`) ||
          typeof item.codeHash !== "string" || !/^[a-f0-9]{64}$/.test(item.codeHash) ||
          typeof item.expiresAt !== "string" || !Number.isFinite(Date.parse(item.expiresAt)) ||
          preapprovals.some(invite => invite.id === item.id)) throw new Error("Invalid access directory.");
      try { validateInput({ provider: item.provider, subject: "pending", role: item.role, admin: item.admin }); }
      catch { throw new Error("Invalid access directory."); }
      preapprovals.push({ id: item.id, provider: item.provider, email: item.email, role: item.role,
        admin: item.admin === true, expiresAt: item.expiresAt, codeHash: item.codeHash });
    }
  }
  return { accounts, requests, preapprovals };
}

export class SocialDirectory {
  constructor(private readonly blobs: JsonBlobStore, private readonly parentOid: string) {}

  private key() { return `parents/${this.parentOid.toLowerCase()}/admin/social-accounts.json`; }

  private async read(): Promise<Directory> {
    const stored = await this.blobs.read<unknown>(this.key());
    return stored ? validateStored(stored.value) : { accounts: [], requests: [], preapprovals: [] };
  }

  async list(): Promise<SocialAccount[]> {
    return (await this.read()).accounts;
  }

  async snapshot(): Promise<{ accounts: SocialAccount[]; requests: SocialAccessRequest[]; preapprovals: SocialPreapproval[] }> {
    const directory = await this.read();
    return { accounts: directory.accounts, requests: this.currentRequests(directory.requests),
      preapprovals: directory.preapprovals.filter(item => Date.parse(item.expiresAt) > Date.now())
        .map(({ codeHash: _codeHash, ...item }) => item) };
  }

  private currentRequests(requests: SocialAccessRequest[]): SocialAccessRequest[] {
    return requests.filter(request => Date.parse(request.requestedAt) + REQUEST_LIFETIME_MS > Date.now());
  }

  private async update<T>(change: (directory: Directory) => { directory: Directory; result: T }): Promise<T> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const stored = await this.blobs.read<unknown>(this.key());
      const directory = stored ? validateStored(stored.value) : { accounts: [], requests: [], preapprovals: [] };
      directory.requests = this.currentRequests(directory.requests);
      directory.preapprovals = directory.preapprovals.filter(item => Date.parse(item.expiresAt) > Date.now());
      const next = change(directory);
      const value = { version: 3, ...next.directory };
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
      const preapprovals = fromRequest
        ? directory.preapprovals.filter(item => item.provider !== input.provider || item.email !== email)
        : directory.preapprovals;
      if (!existing && directory.accounts.length + preapprovals.length >= 20) throw new InputValidationError();
      const account: SocialAccount = {
        ...input, id, ...(fromRequest ? { email: email! } : existing?.email ? { email: existing.email } : {}),
        revision: existing?.role === input.role && existing.admin === input.admin ? existing.revision : randomUUID(),
      };
      return {
        directory: {
          ...directory,
          preapprovals,
          accounts: [...directory.accounts.filter(item => item.id !== id), account],
          requests: directory.requests.filter(item => item.id !== id),
        }, result: account,
      };
    });
  }

  async preapprove(value: unknown): Promise<{ preapproval: SocialPreapproval; invitationCode: string }> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputValidationError();
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some(key => !["provider", "email", "role", "admin"].includes(key))) throw new InputValidationError();
    const email = emailLabel(typeof body.email === "string" ? body.email.trim() : body.email);
    if (!email) throw new InputValidationError();
    const input = validateInput({ provider: body.provider, subject: "pending", role: body.role, admin: body.admin });
    const invitationCode = randomBytes(24).toString("base64url");
    const id = accountId(input.provider, `invite:${email}`);
    const preapproval: SocialPreapproval = { id, provider: input.provider, email, role: input.role,
      admin: input.admin, expiresAt: new Date(Date.now() + PREAPPROVAL_LIFETIME_MS).toISOString() };
    const codeHash = createHash("sha256").update(invitationCode).digest("hex");
    return this.update(directory => {
      if (directory.accounts.some(item => item.provider === input.provider && item.email === email) ||
          directory.preapprovals.some(item => item.id === id)) throw new InputValidationError();
      if (directory.accounts.length + directory.preapprovals.length >= 20) throw new InputValidationError();
      return { directory: { ...directory, preapprovals: [...directory.preapprovals, { ...preapproval, codeHash }] },
        result: { preapproval, invitationCode } };
    });
  }

  async redeem(provider: SocialProvider, subject: string, email: string | undefined, code: string): Promise<SocialAccount> {
    validateInput({ provider, subject, role: "student" });
    if (!email || emailLabel(email) !== email || !/^[A-Za-z0-9_-]{32}$/.test(code)) throw new InvitationCodeError();
    const codeHash = createHash("sha256").update(code).digest("hex");
    return this.update(directory => {
      const invite = directory.preapprovals.find(item => item.provider === provider && item.email === email && item.codeHash === codeHash);
      if (!invite) throw new InvitationCodeError();
      const id = accountId(provider, subject);
      if (directory.accounts.some(item => item.id === id)) throw new InvitationCodeError();
      const account: SocialAccount = { id, provider, subject, email, role: invite.role, admin: invite.admin, revision: randomUUID() };
      // Consuming the secret and binding the verified provider subject is one ETag-protected write.
      return { directory: { ...directory, accounts: [...directory.accounts, account],
        preapprovals: directory.preapprovals.filter(item => item.id !== invite.id),
        requests: directory.requests.filter(item => item.id !== id) }, result: account };
    });
  }

  async remove(id: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new InputValidationError();
    await this.update(directory => ({
      directory: { ...directory, accounts: directory.accounts.filter(item => item.id !== id),
        preapprovals: directory.preapprovals.filter(item => item.id !== id) }, result: undefined,
    }));
  }
}
