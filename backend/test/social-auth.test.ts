import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { AuthenticationError, requireAdmin, roleForOid } from "../src/auth.js";
import { SocialAuth } from "../src/social-auth.js";
import { SocialDirectory } from "../src/social-directory.js";
import type { BlobValue, JsonBlobStore } from "../src/contracts.js";

class MemoryStore implements JsonBlobStore {
  private values = new Map<string, BlobValue<unknown>>();
  async read<T>(key: string) { return (this.values.get(key) as BlobValue<T> | undefined) ?? null; }
  async create<T>(key: string, value: T) {
    if (this.values.has(key)) return false;
    this.values.set(key, { value, etag: "1" });
    return true;
  }
  async replace<T>(key: string, value: T, etag: string) {
    if (this.values.get(key)?.etag !== etag) return false;
    this.values.set(key, { value, etag: "2" });
    return true;
  }
  async list() { return { keys: [] }; }
}

const nonce = "ab".repeat(32);
const config = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  parentOid: "22222222-2222-4222-8222-222222222222",
  audience: "api://studentiq",
  requiredScope: "access_as_user",
  googleClientId: "test.apps.googleusercontent.com",
  googleStudentSubject: "google-student",
  microsoftClientId: "33333333-3333-4333-8333-333333333333",
  microsoftStudentSubject: "microsoft-student"
};
const microsoftIssuer = "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0";

async function setup() {
  const store = new MemoryStore();
  const directory = new SocialDirectory(store, config.parentOid);
  await directory.save({ provider: "google", subject: config.googleStudentSubject, role: "student" });
  await directory.save({ provider: "microsoft", subject: config.microsoftStudentSubject, role: "student" });
  return { social: new SocialAuth(store, directory), directory };
}

async function fixture(provider: "google" | "microsoft", overrides: {
  issuer?: string; audience?: string; subject?: string; nonce?: string;
  emailVerified?: boolean; expired?: boolean; tid?: string;
} = {}) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const key = await exportJWK(publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...key, kid: "test", alg: "RS256", use: "sig" }] });
  const token = await new SignJWT({
    nonce: overrides.nonce ?? nonce,
    ...(provider === "google" ? { email_verified: overrides.emailVerified ?? true } : {
      tid: overrides.tid ?? "9188040d-6c67-4c5b-b112-36a304b66dad", ver: "2.0"
    })
  }).setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(overrides.issuer ?? (provider === "google" ? "https://accounts.google.com" : microsoftIssuer))
    .setAudience(overrides.audience ?? (provider === "google" ? config.googleClientId : config.microsoftClientId))
    .setSubject(overrides.subject ?? (provider === "google" ? config.googleStudentSubject : config.microsoftStudentSubject))
    .setIssuedAt().setExpirationTime(overrides.expired ? "-1m" : "5m").sign(privateKey);
  return { token, keys };
}

test("approved provider tokens yield revocable student-only sessions and cannot be replayed", async () => {
  for (const provider of ["google", "microsoft"] as const) {
    const { social, directory } = await setup();
    const { token, keys } = await fixture(provider);
    const body = { provider, idToken: token, nonce };
    const session = await social.exchange(body, config, keys);
    const principal = await social.authorize(`Bearer ${session.token}`, config);
    assert.equal(roleForOid(principal, config), "student");
    assert.throws(() => requireAdmin(principal, config), AuthenticationError);
    await assert.rejects(social.exchange(body, config, keys), AuthenticationError);
    await directory.save({ provider, subject: provider === "google" ? config.googleStudentSubject : config.microsoftStudentSubject, role: "parent" });
    await assert.rejects(social.authorize(`Bearer ${session.token}`, config), AuthenticationError);
    await directory.save({ provider, subject: provider === "google" ? config.googleStudentSubject : config.microsoftStudentSubject, role: "student" });
    await assert.rejects(social.authorize(`Bearer ${session.token}`, config), AuthenticationError);
    await social.revoke(`Bearer ${session.token}`);
    await assert.rejects(social.authorize(`Bearer ${session.token}`, config), AuthenticationError);
  }
});

test("rejects unapproved, forged, expired, wrong-audience, wrong-issuer and wrong-nonce tokens", async () => {
  const variants = [
    { subject: "stranger" }, { audience: "other-client" }, { issuer: "https://wrong.example" },
    { nonce: "cd".repeat(32) }, { expired: true }, { emailVerified: false }
  ];
  for (const variant of variants) {
    const { social } = await setup();
    const { token, keys } = await fixture("google", variant);
    await assert.rejects(social.exchange({ provider: "google", idToken: token, nonce }, config, keys), AuthenticationError);
  }
  const { social, directory } = await setup();
  const first = await fixture("google");
  const second = await fixture("google");
  await assert.rejects(social.exchange({ provider: "google", idToken: first.token, nonce }, config, second.keys), AuthenticationError);
  const wrongTenant = await fixture("microsoft", { tid: "other" });
  await assert.rejects(social.exchange({ provider: "microsoft", idToken: wrongTenant.token, nonce }, config, wrongTenant.keys), AuthenticationError);
  const google = (await directory.list()).find(item => item.provider === "google")!;
  await directory.remove(google.id);
  await assert.rejects(social.exchange({ provider: "google", idToken: first.token, nonce }, config, first.keys), AuthenticationError);
});

test("admin-approved parents cannot administer accounts and removal revokes access", async () => {
  const { social, directory } = await setup();
  const account = await directory.save({ provider: "google", subject: config.googleStudentSubject, role: "parent" });
  const { token, keys } = await fixture("google");
  const session = await social.exchange({ provider: "google", idToken: token, nonce }, config, keys);
  const principal = await social.authorize(`Bearer ${session.token}`, config);
  assert.equal(roleForOid(principal, config), "parent");
  assert.throws(() => requireAdmin(principal, config), AuthenticationError);
  await directory.remove(account.id);
  await assert.rejects(social.authorize(`Bearer ${session.token}`, config), AuthenticationError);
});
