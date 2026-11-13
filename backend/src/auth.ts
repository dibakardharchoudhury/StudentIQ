import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload
} from "jose";

export interface AuthConfig {
  tenantId: string;
  audience: string;
  parentOid: string;
  studentOid?: string;
  requiredScope: string;
  googleClientId?: string;
  microsoftClientId?: string;
}

export type UserRole = "admin" | "parent" | "student";
export const SOCIAL_STUDENT = "social-student";
export const SOCIAL_PARENT = "social-parent";
const CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const MICROSOFT_ISSUER = `https://login.microsoftonline.com/${CONSUMER_TENANT}/v2.0`;
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const microsoftKeys = createRemoteJWKSet(
  new URL(`https://login.microsoftonline.com/${CONSUMER_TENANT}/discovery/v2.0/keys`)
);

export function roleForOid(oid: string, config: AuthConfig): UserRole {
  const normalized = oid.toLowerCase();
  if (normalized === config.parentOid.toLowerCase()) return "admin";
  if (normalized === SOCIAL_STUDENT) return "student";
  if (normalized === SOCIAL_PARENT) return "parent";
  if (config.studentOid && normalized === config.studentOid.toLowerCase()) return "student";
  throw new AuthenticationError(403);
}

export function requireAdmin(oid: string, config: AuthConfig): void {
  if (roleForOid(oid, config) !== "admin") throw new AuthenticationError(403);
}

export class AuthenticationError extends Error {
  constructor(readonly status: 401 | 403) {
    super("Request is not authorized.");
    this.name = "AuthenticationError";
  }
}

const jwksByTenant = new Map<string, JWTVerifyGetKey>();

function tenantKeys(tenantId: string): JWTVerifyGetKey {
  let keys = jwksByTenant.get(tenantId);
  if (!keys) {
    keys = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)
    );
    jwksByTenant.set(tenantId, keys);
  }
  return keys;
}

export function bearerFromHeader(header: string | null): string {
  const match = header?.match(/^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i);
  if (!match) {
    throw new AuthenticationError(401);
  }
  return match[1]!;
}

export async function verifyAccessToken(
  token: string,
  config: AuthConfig,
  keyResolver: JWTVerifyGetKey = tenantKeys(config.tenantId)
): Promise<JWTPayload> {
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, keyResolver, {
      algorithms: ["RS256"],
      issuer: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
      audience: config.audience,
      requiredClaims: ["exp", "iss", "aud", "oid", "tid", "scp"],
      maxTokenAge: "1 hour",
      clockTolerance: 5
    });
    payload = result.payload;
  } catch {
    throw new AuthenticationError(401);
  }

  if (payload.tid !== config.tenantId || typeof payload.oid !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.oid)) {
    throw new AuthenticationError(403);
  }
  roleForOid(payload.oid, config);

  if (typeof payload.scp !== "string" ||
      !payload.scp.split(/\s+/).includes(config.requiredScope)) {
    throw new AuthenticationError(403);
  }
  return payload;
}

export async function verifySocialToken(
  token: string,
  provider: "google" | "microsoft",
  config: AuthConfig,
  nonce: string,
  keyResolver: JWTVerifyGetKey = provider === "google" ? googleKeys : microsoftKeys
): Promise<JWTPayload> {
  const audience = provider === "google" ? config.googleClientId : config.microsoftClientId;
  if (!audience) throw new AuthenticationError(403);
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, keyResolver, {
      algorithms: ["RS256"],
      issuer: provider === "google" ? ["accounts.google.com", "https://accounts.google.com"] : MICROSOFT_ISSUER,
      audience,
      requiredClaims: ["exp", "iat", "iss", "aud", "sub", "nonce"],
      maxTokenAge: "5 minutes",
      clockTolerance: 5
    }));
  } catch {
    throw new AuthenticationError(401);
  }
  if (payload.nonce !== nonce || typeof payload.sub !== "string" ||
      !/^[A-Za-z0-9_-]{1,255}$/.test(payload.sub) ||
      (provider === "google" && (payload.email_verified !== true ||
        (payload.azp !== undefined && payload.azp !== audience))) ||
      (provider === "microsoft" && (payload.tid !== CONSUMER_TENANT || payload.ver !== "2.0"))) {
    throw new AuthenticationError(403);
  }
  return payload;
}

export async function authorizeRequest(
  authorization: string | null,
  config: AuthConfig,
  keyResolver?: JWTVerifyGetKey
): Promise<string> {
  const token = bearerFromHeader(authorization);
  const payload = await verifyAccessToken(token, config, keyResolver);
  return payload.oid!.toString().toLowerCase();
}
