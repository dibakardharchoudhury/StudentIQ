import assert from "node:assert/strict";
import { test } from "node:test";
import { AzureSpeechTokenProvider } from "../src/services.js";

const config = {
  speechIdentityClientId: "44444444-4444-4444-8444-444444444444",
  speechResourceId: "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/studentiq/providers/Microsoft.CognitiveServices/accounts/studentiq-speech",
  speechRegion: "eastus"
};

test("selects only the dedicated Speech identity and formats the SDK authorization token", async () => {
  let selectedClientId: string | undefined;
  const provider = new AzureSpeechTokenProvider(config, (clientId) => {
    selectedClientId = clientId;
    return {
      getToken: async (scope, options) => {
        assert.equal(scope, "https://cognitiveservices.azure.com/.default");
        assert.ok(options?.abortSignal);
        return { token: "speech-only-access-token", expiresOnTimestamp: Date.now() + 3600000 };
      }
    };
  });
  assert.equal(selectedClientId, config.speechIdentityClientId);
  assert.deepEqual(await provider.issue(), {
    token: `aad#${config.speechResourceId}#speech-only-access-token`,
    region: "eastus"
  });
});

test("rejects invalid or missing isolated identity configuration before credential creation", () => {
  for (const invalid of [
    { ...config, speechIdentityClientId: "" },
    { ...config, speechIdentityClientId: "not-a-client-id" },
    { ...config, speechResourceId: "" },
    { ...config, speechResourceId: `${config.speechResourceId}#injected` },
    { ...config, speechResourceId: "https://example.com" }
  ]) {
    assert.throws(() => new AzureSpeechTokenProvider(invalid, () => {
      assert.fail("Must not create a credential for invalid configuration");
    }), /Invalid isolated Speech identity configuration/);
  }
});

test("rejects reuse of the configured Foundry/Blob identity", () => {
  const previous = process.env.AZURE_CLIENT_ID;
  try {
    process.env.AZURE_CLIENT_ID = config.speechIdentityClientId;
    assert.throws(() => new AzureSpeechTokenProvider(config), /Invalid isolated Speech identity configuration/);
  } finally {
    if (previous === undefined) delete process.env.AZURE_CLIENT_ID;
    else process.env.AZURE_CLIENT_ID = previous;
  }
});

test("identity errors propagate without fallback and invalid or expiring tokens are refused", async () => {
  const failure = new Error("Identity is unavailable");
  const failed = new AzureSpeechTokenProvider(config, () => ({
    getToken: async () => { throw failure; }
  }));
  await assert.rejects(failed.issue(), (error) => error === failure);

  for (const token of [
    null,
    { token: "", expiresOnTimestamp: Date.now() + 3600000 },
    { token: "expired", expiresOnTimestamp: Date.now() - 1 },
    { token: "almost-expired", expiresOnTimestamp: Date.now() + 1000 },
    { token: "bad#token", expiresOnTimestamp: Date.now() + 3600000 }
  ]) {
    const provider = new AzureSpeechTokenProvider(config, () => ({ getToken: async () => token }));
    await assert.rejects(provider.issue(), /Speech token response was invalid/);
  }
});
