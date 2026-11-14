import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { AuthenticationError, requireAdmin, roleForOid } from "../src/auth.js";
import { ApprovalRequiredError, SocialAuth } from "../src/social-auth.js";
import { emailLabel, SocialDirectory } from "../src/social-directory.js";
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
    this.values.set(key, { value, etag: String(Number(etag) + 1) });
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

test("provider email labels cannot introduce metadata that the frontend rejects", () => {
  assert.equal(emailLabel("Parent.Name+school@Example.com"), "parent.name+school@example.com");
  for (const email of ["parent..name@example.com", ".parent@example.com", "parent@example.c", "parent@<example>.com"]) {
    assert.equal(emailLabel(email), undefined);
  }
});

test("failed pending-request storage never reports approval-required or creates an application session", async () => {
  class UnavailableDirectoryStore extends MemoryStore {
    async create<T>(key: string, value: T) {
      if (key.endsWith("/admin/social-accounts.json")) throw new Error("Directory unavailable");
      return super.create(key, value);
    }
  }
  const store = new UnavailableDirectoryStore();
  const directory = new SocialDirectory(store, config.parentOid);
  const social = new SocialAuth(store, directory);
  const { token, keys } = await fixture("microsoft", { subject: "pending-parent", email: "parent@example.com" });
  const body = { provider: "microsoft", idToken: token, nonce };
  await assert.rejects(social.exchange(body, config, keys), error => {
    assert.ok(error instanceof Error && !(error instanceof ApprovalRequiredError));
    assert.equal(error.message, "Directory unavailable"); return true;
  });
  assert.deepEqual(await directory.snapshot(), { accounts: [], requests: [] });
  await assert.rejects(social.exchange(body, config, keys), AuthenticationError);
});

async function setup() {
  const store = new MemoryStore();
  const directory = new SocialDirectory(store, config.parentOid);
  await directory.save({ provider: "google", subject: config.googleStudentSubject, role: "student" });
  await directory.save({ provider: "microsoft", subject: config.microsoftStudentSubject, role: "student" });
  return { social: new SocialAuth(store, directory), directory, store };
}

async function fixture(provider: "google" | "microsoft", overrides: {
  issuer?: string; audience?: string; subject?: string; nonce?: string;
  emailVerified?: boolean; expired?: boolean; tid?: string;
  email?: string; username?: string; admin?: boolean;
} = {}) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const key = await exportJWK(publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...key, kid: "test", alg: "RS256", use: "sig" }] });
  const token = await new SignJWT({
    nonce: overrides.nonce ?? nonce,
    ...(overrides.email ? { email: overrides.email } : {}),
    ...(overrides.username ? { preferred_username: overrides.username } : {}),
    ...(overrides.admin ? { admin: true, roles: ["admin"] } : {}),
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

test("unapproved sign-in records only signature-checked identity metadata, not access or client-supplied admin claims", async () => {
  const { social, directory } = await setup();
  const { token, keys } = await fixture("microsoft", { subject: "new-parent", username: "Person@Example.com", admin: true });
  const body = { provider: "microsoft", idToken: token, nonce, email: "attacker@example.com", admin: true };
  await assert.rejects(social.exchange(body, config, keys), ApprovalRequiredError);
  const { requests, accounts } = await directory.snapshot();
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.email, "person@example.com");
  assert.equal(requests[0]!.subject, "new-parent");
  assert.equal(accounts.some(account => account.subject === "new-parent"), false);
  await assert.rejects(social.exchange(body, config, keys), error => error instanceof AuthenticationError && error.status === 401);
});

test("email approval requires an authenticated request and explicit parent admin grants revoke old sessions when changed", async () => {
  const { social, directory } = await setup();
  await assert.rejects(directory.save({ provider: "microsoft", email: "person@example.com", role: "parent" }));
  const pending = await fixture("microsoft", { subject: "new-parent", email: "person@example.com" });
  await assert.rejects(social.exchange({ provider: "microsoft", idToken: pending.token, nonce }, config, pending.keys), ApprovalRequiredError);
  const request = (await directory.snapshot()).requests[0]!;
  await assert.rejects(directory.save({ provider: "microsoft", requestId: request.id, email: request.email, role: "student", admin: true }));
  const parent = await directory.save({ provider: "microsoft", requestId: request.id, email: request.email, role: "parent", admin: true });
  assert.equal(parent.subject, "new-parent");
  assert.equal((await directory.snapshot()).requests.length, 0);
  const next = await fixture("microsoft", { subject: "new-parent", email: "changed-label@example.com" });
  const session = await social.exchange({ provider: "microsoft", idToken: next.token, nonce }, config, next.keys);
  const principal = await social.authorize(`Bearer ${session.token}`, config);
  assert.equal(roleForOid(principal, config), "admin");
  requireAdmin(principal, config);
  const revoked = await directory.save({ provider: "microsoft", subject: parent.subject, role: "parent", admin: false });
  assert.notEqual(revoked.revision, parent.revision);
  assert.equal(revoked.email, "person@example.com");
  await assert.rejects(social.authorize(`Bearer ${session.token}`, config), AuthenticationError);
  await directory.save({ provider: "microsoft", subject: parent.subject, role: "parent", admin: true });
  await assert.rejects(social.authorize(`Bearer ${session.token}`, config), AuthenticationError);
});

test("expired requests cannot be approved, and legacy approvals default to non-admin without losing their identity or revision", async () => {
  const { directory, store } = await setup();
  await directory.request("google", "waiting", "person@example.com");
  const request = (await directory.snapshot()).requests[0]!;
  const now = Date.now;
  Date.now = () => now() + 49 * 60 * 60 * 1000;
  try {
    assert.equal((await directory.snapshot()).requests.length, 0);
    await assert.rejects(directory.save({ provider: "google", requestId: request.id, email: request.email, role: "parent" }));
  } finally { Date.now = now; }
  const account = (await directory.list())[0]!;
  const { admin: _admin, ...legacy } = account;
  const key = `parents/${config.parentOid}/admin/social-accounts.json`;
  const existing = await store.read(key);
  await store.replace(key, { version: 1, accounts: [legacy] }, existing!.etag);
  const migrated = (await directory.list())[0]!;
  assert.equal(migrated.admin, false);
  assert.equal(migrated.subject, account.subject);
  assert.equal(migrated.revision, account.revision);
});

test("concurrent sign-in requests and account changes do not overwrite one another", async () => {
  const { directory, store } = await setup();
  const other = new SocialDirectory(store, config.parentOid);
  await Promise.all([
    directory.request("google", "new-one", "one@example.com"),
    other.request("microsoft", "new-two", "two@example.com"),
    other.save({ provider: "google", subject: config.googleStudentSubject, role: "parent", admin: true }),
  ]);
  const state = await directory.snapshot();
  assert.equal(state.requests.length, 2);
  assert.equal(state.accounts.find(account => account.provider === "google")!.admin, true);
});
