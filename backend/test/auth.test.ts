import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT
} from "jose";
import { authorizeRequest, AuthenticationError, requireAdmin, roleForOid } from "../src/auth.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const parentOid = "22222222-2222-4222-8222-222222222222";
const otherOid = "33333333-3333-4333-8333-333333333333";
const audience = "api://studentiq";
const config = { tenantId, parentOid, audience, requiredScope: "StudentIQ.Access" };

async function signedToken(overrides: Record<string, unknown> = {}) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const keyResolver = createLocalJWKSet({
    keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }]
  });
  const token = await new SignJWT({
    tid: tenantId,
    oid: parentOid,
    scp: "StudentIQ.Access",
    ...overrides
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return { token, keyResolver };
}

test("requires a bearer token and rejects invalid signatures", async () => {
  await assert.rejects(
    authorizeRequest(null, config),
    (error: unknown) => error instanceof AuthenticationError && error.status === 401
  );
  await assert.rejects(
    authorizeRequest("Bearer not.a.jwt", config),
    (error: unknown) => error instanceof AuthenticationError && error.status === 401
  );
});

test("accepts only a valid token for the exact parent and delegated scope", async () => {
  const valid = await signedToken();
  assert.equal(await authorizeRequest(`Bearer ${valid.token}`, config, valid.keyResolver), parentOid);

  const wrongParent = await signedToken({ oid: otherOid });
  await assert.rejects(
    authorizeRequest(`Bearer ${wrongParent.token}`, config, wrongParent.keyResolver),
    (error: unknown) => error instanceof AuthenticationError && error.status === 403
  );

  const wrongScope = await signedToken({ scp: "Other.Access" });
  await assert.rejects(
    authorizeRequest(`Bearer ${wrongScope.token}`, config, wrongScope.keyResolver),
    (error: unknown) => error instanceof AuthenticationError && error.status === 403
  );
});

test("optional student tokens retain tenant/scope checks and cannot acquire admin from token role claims", async () => {
  const studentOid = otherOid;
  const familyConfig = { ...config, studentOid };
  const student = await signedToken({ oid: studentOid, roles: ["admin"] });
  const oid = await authorizeRequest(`Bearer ${student.token}`, familyConfig, student.keyResolver);
  assert.equal(oid, studentOid);
  assert.equal(roleForOid(oid, familyConfig), "student");
  assert.throws(() => requireAdmin(oid, familyConfig), AuthenticationError);
  assert.equal(roleForOid(parentOid, familyConfig), "admin");
  await assert.rejects(authorizeRequest(`Bearer ${student.token}`, config, student.keyResolver), AuthenticationError);

  const missingScope = await signedToken({ oid: studentOid, scp: "Other.Access" });
  await assert.rejects(
    authorizeRequest(`Bearer ${missingScope.token}`, familyConfig, missingScope.keyResolver),
    AuthenticationError
  );
  const otherTenant = await signedToken({ oid: studentOid, tid: "55555555-5555-4555-8555-555555555555" });
  await assert.rejects(
    authorizeRequest(`Bearer ${otherTenant.token}`, familyConfig, otherTenant.keyResolver),
    AuthenticationError
  );
  const stranger = await signedToken({ oid: "66666666-6666-4666-8666-666666666666" });
  await assert.rejects(
    authorizeRequest(`Bearer ${stranger.token}`, familyConfig, stranger.keyResolver),
    AuthenticationError
  );
});

test("rejects a token issued for another audience", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const keyResolver = createLocalJWKSet({
    keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }]
  });
  const token = await new SignJWT({
    tid: tenantId,
    oid: parentOid,
    scp: "StudentIQ.Access"
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
    .setAudience("api://not-studentiq")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  await assert.rejects(
    authorizeRequest(`Bearer ${token}`, config, keyResolver),
    (error: unknown) => error instanceof AuthenticationError && error.status === 401
  );
});

test("rejects an expired token even when signature and claims otherwise match", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const keyResolver = createLocalJWKSet({
    keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }]
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    tid: tenantId,
    oid: parentOid,
    scp: "StudentIQ.Access"
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
    .setAudience(audience)
    .setIssuedAt(now - 3600)
    .setExpirationTime(now - 1800)
    .sign(privateKey);
  await assert.rejects(
    authorizeRequest(`Bearer ${token}`, config, keyResolver),
    (error: unknown) => error instanceof AuthenticationError && error.status === 401
  );
});
