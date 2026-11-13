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
}

export type UserRole = "admin" | "student";

export function roleForOid(oid: string, config: AuthConfig): UserRole {
  const normalized = oid.toLowerCase();
  if (normalized === config.parentOid.toLowerCase()) return "admin";
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

  if (payload.tid !== config.tenantId || typeof payload.oid !== "string") {
    throw new AuthenticationError(403);
  }
  roleForOid(payload.oid, config);

  if (typeof payload.scp !== "string" ||
      !payload.scp.split(/\s+/).includes(config.requiredScope)) {
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
