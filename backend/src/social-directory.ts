import { createHash, randomUUID } from "node:crypto";
import { InputValidationError, type JsonBlobStore } from "./contracts.js";

export type SocialProvider = "google" | "microsoft";
export type SocialRole = "parent" | "student";
export interface SocialAccount {
  id: string;
  provider: SocialProvider;
  subject: string;
  role: SocialRole;
  revision: string;
}

function accountId(provider: SocialProvider, subject: string): string {
  return createHash("sha256").update(`${provider}\0${subject}`).digest("hex");
}

function validateInput(value: unknown): Pick<SocialAccount, "provider" | "subject" | "role"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputValidationError();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !["provider", "subject", "role"].includes(key)) ||
      (body.provider !== "google" && body.provider !== "microsoft") ||
      (body.role !== "parent" && body.role !== "student") ||
      typeof body.subject !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(body.subject)) {
    throw new InputValidationError();
  }
  return { provider: body.provider, subject: body.subject, role: body.role };
}

function validateStored(value: unknown): SocialAccount[] {
  if (!value || typeof value !== "object" || !("version" in value) ||
      value.version !== 1 || !("accounts" in value) || !Array.isArray(value.accounts) ||
      value.accounts.length > 20) throw new Error("Invalid access directory.");
  const accounts: SocialAccount[] = [];
  for (const item of value.accounts) {
    if (!item || typeof item !== "object" || typeof item.id !== "string") {
      throw new Error("Invalid access directory.");
    }
    let input: Pick<SocialAccount, "provider" | "subject" | "role">;
    try { input = validateInput({ provider: item.provider, subject: item.subject, role: item.role }); }
    catch { throw new Error("Invalid access directory."); }
    if (item.id !== accountId(input.provider, input.subject) || typeof item.revision !== "string" ||
        !/^[0-9a-f-]{36}$/.test(item.revision) || accounts.some(account => account.id === item.id)) {
      throw new Error("Invalid access directory.");
    }
    accounts.push({ id: item.id, ...input, revision: item.revision });
  }
  return accounts;
}

export class SocialDirectory {
  constructor(private readonly blobs: JsonBlobStore, private readonly parentOid: string) {}

  private key() { return `parents/${this.parentOid.toLowerCase()}/admin/social-accounts.json`; }

  async list(): Promise<SocialAccount[]> {
    const stored = await this.blobs.read<unknown>(this.key());
    return stored ? validateStored(stored.value) : [];
  }

  async save(value: unknown): Promise<SocialAccount> {
    const input = validateInput(value);
    const id = accountId(input.provider, input.subject);
    for (let attempt = 0; attempt < 8; attempt++) {
      const stored = await this.blobs.read<unknown>(this.key());
      const accounts = stored ? validateStored(stored.value) : [];
      const existing = accounts.find(item => item.id === id);
      if (!existing && accounts.length >= 20) {
        throw new InputValidationError();
      }
      const account = { ...input, id, revision: existing?.role === input.role ? existing.revision : randomUUID() };
      const next = { version: 1, accounts: [...accounts.filter(item => item.id !== account.id), account] };
      if (stored ? await this.blobs.replace(this.key(), next, stored.etag) : await this.blobs.create(this.key(), next)) {
        return account;
      }
    }
    throw new Error("Access list update could not be confirmed.");
  }

  async remove(id: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new InputValidationError();
    for (let attempt = 0; attempt < 8; attempt++) {
      const stored = await this.blobs.read<unknown>(this.key());
      if (!stored) return;
      const accounts = validateStored(stored.value);
      if (!accounts.some(item => item.id === id)) return;
      if (await this.blobs.replace(this.key(), { version: 1, accounts: accounts.filter(item => item.id !== id) }, stored.etag)) return;
    }
    throw new Error("Access list removal could not be confirmed.");
  }
}
