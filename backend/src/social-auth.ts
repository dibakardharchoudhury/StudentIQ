import { createHash, randomBytes } from "node:crypto";
import type { JWTVerifyGetKey } from "jose";
import { AuthenticationError, bearerFromHeader, SOCIAL_ADMIN, SOCIAL_PARENT, SOCIAL_STUDENT, verifySocialToken, type AuthConfig } from "./auth.js";
import type { JsonBlobStore } from "./contracts.js";
import { emailLabel, type SocialDirectory, type SocialRole } from "./social-directory.js";

export class ApprovalRequiredError extends AuthenticationError {
  constructor() { super(403); }
}

type Provider = "google" | "microsoft";
interface Session {
  provider: Provider;
  subject: string;
  clientId: string;
  role: SocialRole;
  admin?: boolean;
  revision: string;
  expiresAt: number;
  revoked: boolean;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class SocialAuth {
  constructor(private readonly blobs: JsonBlobStore, private readonly directory: SocialDirectory) {}

  async exchange(input: unknown, config: AuthConfig, keys?: JWTVerifyGetKey): Promise<{ token: string; expiresAt: string }> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new AuthenticationError(401);
    const body = input as Record<string, unknown>;
    if ((body.provider !== "google" && body.provider !== "microsoft") ||
        typeof body.idToken !== "string" || body.idToken.length > 7000 ||
        typeof body.nonce !== "string" || !/^[a-f0-9]{64}$/.test(body.nonce)) {
      throw new AuthenticationError(401);
    }
    const payload = await verifySocialToken(body.idToken, body.provider, config, body.nonce, keys);
    if (!await this.blobs.create(`social-auth/used/${digest(body.idToken)}`, { used: true })) {
      throw new AuthenticationError(401);
    }
    const account = (await this.directory.list()).find(item =>
      item.provider === body.provider && item.subject === payload.sub);
    if (!account) {
      const email = emailLabel(payload.email) ?? emailLabel(payload.preferred_username);
      await this.directory.request(body.provider, payload.sub!, email);
      throw new ApprovalRequiredError();
    }
    const token = `s1.${randomBytes(32).toString("base64url")}`;
    const expiresAt = Date.now() + 30 * 60 * 1000;
    const clientId = body.provider === "google" ? config.googleClientId : config.microsoftClientId;
    if (!clientId) throw new AuthenticationError(403);
    const session: Session = {
      provider: body.provider, subject: payload.sub!, clientId, role: account.role, admin: account.admin,
      revision: account.revision, expiresAt, revoked: false
    };
    if (!await this.blobs.create(`social-auth/sessions/${digest(token)}`, session)) {
      throw new Error("Could not create the social sign-in session.");
    }
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  async authorize(authorization: string | null, config: AuthConfig): Promise<string> {
    const token = bearerFromHeader(authorization);
    if (!/^s1\.[A-Za-z0-9_-]{43}$/.test(token)) throw new AuthenticationError(401);
    const stored = await this.blobs.read<Session>(`social-auth/sessions/${digest(token)}`);
    if (!stored || stored.value.revoked || !Number.isFinite(stored.value.expiresAt) ||
        stored.value.expiresAt <= Date.now()) throw new AuthenticationError(401);
    const clientId = stored.value.provider === "google" ? config.googleClientId
      : stored.value.provider === "microsoft" ? config.microsoftClientId : undefined;
    const approved = (await this.directory.list()).some(item => item.provider === stored.value.provider &&
      item.subject === stored.value.subject && item.role === stored.value.role && item.revision === stored.value.revision &&
      item.admin === (stored.value.admin ?? false));
    if (!approved || !clientId || stored.value.clientId !== clientId) {
      throw new AuthenticationError(403);
    }
    return stored.value.role === "parent" ? stored.value.admin ? SOCIAL_ADMIN : SOCIAL_PARENT : SOCIAL_STUDENT;
  }

  async revoke(authorization: string | null): Promise<void> {
    const token = bearerFromHeader(authorization);
    if (!/^s1\.[A-Za-z0-9_-]{43}$/.test(token)) throw new AuthenticationError(401);
    const key = `social-auth/sessions/${digest(token)}`;
    const stored = await this.blobs.read<Session>(key);
    if (!stored || !await this.blobs.replace(key, { ...stored.value, revoked: true }, stored.etag)) {
      throw new AuthenticationError(401);
    }
  }
}
