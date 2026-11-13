import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InputValidationError,
  validateChatInput,
  validateIdempotencyKey,
  validateSessionId
} from "../src/contracts.js";

test("validates chat payload fields and supported languages", () => {
  assert.deepEqual(
    validateChatInput({
      subject: "Matematikk",
      language: "nb",
      message: "Kan du forklare brøk?"
    }),
    {
      subject: "Matematikk",
      language: "nb",
      message: "Kan du forklare brøk?"
    }
  );
  for (const invalid of [
    null,
    [],
    { subject: "Math", language: "fr", message: "Hi" },
    { subject: "Math", language: "en", message: "  " },
    { subject: "Math", language: "en", message: "x".repeat(1201) },
    { subject: "Math/", language: "en", message: "Hi" },
    { subject: "Math", language: "en", message: "Hi", sessionId: "../../other" }
  ]) {
    assert.throws(() => validateChatInput(invalid), InputValidationError);
  }
});

test("validates session and idempotency identifiers", () => {
  assert.equal(validateSessionId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.throws(() => validateSessionId("anything"), InputValidationError);
  assert.equal(validateIdempotencyKey(null), undefined);
  assert.equal(validateIdempotencyKey("retry-key-123"), "retry-key-123");
  assert.throws(() => validateIdempotencyKey("short"), InputValidationError);
});
