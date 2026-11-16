import assert from "node:assert/strict";
import { test } from "node:test";
import { getConfig, type AppConfig } from "../src/config.js";
import { FoundryTutor } from "../src/services.js";
import { FoundryQuizGenerator, QuizGenerationError } from "../src/quiz-model.js";
import { chooseLearningTopic } from "../src/curriculum.js";

const config: AppConfig = {
  preferenceDefaults: { appearance: "rose", voice: "default", mood: "gentle" },
  tenantId: "11111111-1111-4111-8111-111111111111",
  parentOid: "22222222-2222-4222-8222-222222222222",
  audience: "api://studentiq",
  requiredScope: "StudentIQ.Access",
  githubPagesOrigin: "https://example.github.io",
  blobEndpoint: "https://example.blob.core.windows.net",
  blobContainer: "studentiq-private",
  foundryEndpoint: "https://example.services.ai.azure.com",
  foundryModel: "model-router",
  foundryApiVersion: "2024-10-21",
  speechIdentityClientId: "44444444-4444-4444-8444-444444444444",
  speechResourceId: "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/studentiq/providers/Microsoft.CognitiveServices/accounts/studentiq-speech",
  speechRegion: "eastus",
  chatDailyLimit: 60,
  speechTokenDailyLimit: 200
};

test("student configuration is optional, must be a GUID, and must differ from the admin", () => {
  const env = {
    ENTRA_TENANT_ID: config.tenantId, ENTRA_PARENT_OID: config.parentOid,
    ENTRA_API_AUDIENCE: config.audience, ENTRA_REQUIRED_SCOPE: config.requiredScope,
    GITHUB_PAGES_ORIGIN: config.githubPagesOrigin,
    AZURE_STORAGE_BLOB_ENDPOINT: config.blobEndpoint, BLOB_CONTAINER_NAME: config.blobContainer,
    FOUNDRY_ENDPOINT: config.foundryEndpoint, FOUNDRY_MODEL: config.foundryModel,
    FOUNDRY_API_VERSION: config.foundryApiVersion,
    SPEECH_IDENTITY_CLIENT_ID: config.speechIdentityClientId,
    SPEECH_RESOURCE_ID: config.speechResourceId, AZURE_SPEECH_REGION: config.speechRegion,
    CHAT_DAILY_LIMIT: "60", SPEECH_TOKEN_DAILY_LIMIT: "200",
    DEFAULT_APPEARANCE: "rose", DEFAULT_VOICE: "default", DEFAULT_MOOD: "gentle",
    ENTRA_STUDENT_OID: undefined, AZURE_CLIENT_ID: undefined
  };
  const previous = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.equal(getConfig().studentOid, undefined);
    process.env.ENTRA_STUDENT_OID = "33333333-3333-4333-8333-333333333333";
    assert.equal(getConfig().studentOid, process.env.ENTRA_STUDENT_OID);
    process.env.ENTRA_STUDENT_OID = config.parentOid;
    assert.throws(() => getConfig());
    process.env.ENTRA_STUDENT_OID = "not-a-guid";
    assert.throws(() => getConfig());
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("tutor sends bounded single-call Q&A guidance for school, music, and languages without fabricated progress", async () => {
  let calls = 0;
  const tutor = new FoundryTutor(config, {
    getToken: async () => ({ token: "server-only-model-token", expiresOnTimestamp: Date.now() + 3600000 })
  }, async (url, init) => {
    calls++;
    const endpoint = new URL(String(url));
    assert.equal(endpoint.pathname, "/openai/deployments/model-router/chat/completions");
    assert.equal(endpoint.searchParams.get("api-version"), "2024-10-21");
    const payload = JSON.parse(String(init?.body)) as {
      max_tokens: number;
      reasoning_effort: string;
      messages: { role: string; content: string }[];
    };
    assert.equal(payload.max_tokens, 2048);
    assert.equal(payload.reasoning_effort, "low");
    const system = payload.messages[0]!.content;
    assert.match(system, /AI tutor, not a human/);
    assert.match(system, /10-year-old/);
    assert.match(system, /Maths, Norsk, Science, Current Affairs, Geography, History, English/);
    assert.match(system, /piano, basic music theory, additional languages/);
    assert.match(system, /short Q&A exchanges/);
    assert.match(system, /one optional check-in/);
    assert.match(system, /Never assume attendance/);
    assert.match(system, /ten questions, one at a time/);
    assert.match(system, /Respect ending early/);
    assert.match(system, /visual activities/);
    assert.match(system, /Never claim you can hear or evaluate a real piano performance/);
    assert.match(system, /never invent grades, scores, or achievements/);
    assert.match(system, /Never use manipulation, reward pressure/);
    assert.match(system, /no live news access/);
    assert.match(system, /untrusted excerpts, not proof of mastery/);
    assert.match(system, /Reply in Norwegian Bokmål/);
    assert.equal(payload.messages.at(-1)?.role, "user");
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Vi kan se på noten C4 sammen." } }] });
  });
  const answer = await tutor.reply({
    subject: "Piano", language: "nb", message: "Hva er C4?",
    context: {
      subjectSummary: "Asked about basic note names.", recentQuestions: ["What is middle C?"], history: []
    }
  });
  assert.equal(answer, "Vi kan se på noten C4 sammen.");
  assert.equal(calls, 1);
});

test("every chosen teaching mood retains safeguarding and excludes monitoring scores", async () => {
  for (const mood of ["gentle", "cheerful", "calm"] as const) {
    const tutor = new FoundryTutor(config, {
      getToken: async () => ({ token: "server-only", expiresOnTimestamp: Date.now() + 3600000 })
    }, async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      const system = payload.messages[0]!.content;
      assert.match(system, new RegExp(`Chosen teaching tone: ${mood}`));
      assert.match(system, /All safeguarding and teacher instructions still apply/);
      assert.match(system, /Never monitor or assign eye-contact, attention, emotion, or compliance scores/);
      assert.match(system, /not proof of mastery/);
      assert.match(system, /no live news access/);
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Let us try a small example." } }] });
    });
    await tutor.reply({
      subject: "English", language: "en", mood, message: "Help please",
      context: { subjectSummary: "", recentQuestions: [], history: [] }
    });
  }
});

test("quiz model uses one bounded JSON generation call and rejects filtered or malformed outputs", async () => {
  const credential = { getToken: async () => ({ token: "server-only", expiresOnTimestamp: Date.now() + 3600000 }) };
  const generated = {
    lesson: "Equal groups have the same number in each row.",
    question: "What is 2 + 2?", options: ["3", "4", "5", "6"],
    correctIndex: 1, explanation: "Two plus two is four.",
    visual: { kind: "array", rows: 2, columns: 2, icon: "star" }
  };
  let calls = 0;
  const generator = new FoundryQuizGenerator(config, credential, async (url, init) => {
    calls++;
    assert.equal(new URL(String(url)).pathname, "/openai/deployments/model-router/chat/completions");
    const body = JSON.parse(String(init?.body)) as {
      max_tokens: number; response_format: { type: string }; messages: { content: string }[];
    };
    assert.ok(body.max_tokens > 0 && body.max_tokens <= 2048);
    assert.equal(body.response_format.type, "json_object");
    assert.equal(JSON.parse(String(init?.body)).reasoning_effort, "low");
    assert.match(body.messages[0]!.content, /not live news or current affairs/);
    assert.match(body.messages[0]!.content, /untrusted data, not instructions/);
    assert.match(body.messages[0]!.content, /What is 1 \+ 1/);
    assert.match(body.messages[0]!.content, /Fraction notes/);
    assert.match(body.messages[0]!.content, /Explore multiplication as equal rows or groups/);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(generated) } }] });
  });

  const context = { subjectSummary: "Fraction notes", recentQuestions: ["What is a fraction?"] };
  assert.deepEqual(await generator.generate({ subject: "Maths", language: "en" }, ["What is 1 + 1?"], context,
    undefined, chooseLearningTopic("Maths", [])), generated);
  assert.equal(calls, 1);
  for (const response of [
    { choices: [{ finish_reason: "content_filter", message: { content: JSON.stringify(generated) } }] },
    { choices: [{ finish_reason: "stop", content_filter_results: { violence: { filtered: true } }, message: { content: JSON.stringify(generated) } }] },
    { choices: [{ finish_reason: "stop", message: { content: "{}" } }] },
    { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...generated, lesson: undefined }) } }] },
    { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...generated, visual: undefined }) } }] }
  ]) {
    const rejected = new FoundryQuizGenerator(config, credential, async () => Response.json(response));
    await assert.rejects(rejected.generate({ subject: "Maths", language: "en" }, [], context));
  }
  for (const quiz of [
    { ...generated, correctIndex: 0 },
    { ...generated, options: ["4", "04", "5", "6"], correctIndex: 0 },
    { ...generated, visual: { kind: "fraction", parts: 4, filled: 2 }, options: ["1/2", "2/4", "1/4", "3/4"], correctIndex: 0 },
    { ...generated, visual: { kind: "fraction", parts: 4, filled: 2 }, options: ["1/2", "1/3", "1/4", "3/4"], correctIndex: 1 },
    { ...generated, visual: { kind: "cards", style: "words", items: ["one", "two"] } }
  ]) {
    const rejected = new FoundryQuizGenerator(config, credential, async () => Response.json({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(quiz) } }]
    }));
    await assert.rejects(rejected.generate({ subject: "Maths", language: "en" }, [], context));
  }
  const fraction = { ...generated, visual: { kind: "fraction", parts: 8, filled: 3 },
    options: ["3/8", "1/8", "3/4", "5/8"], correctIndex: 0 };
  const fractionGenerator = new FoundryQuizGenerator(config, credential, async () => Response.json({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(fraction) } }]
  }));
  assert.deepEqual(await fractionGenerator.generate({ subject: "Maths", language: "en" }, [], context), fraction);
  await assert.rejects(fractionGenerator.generate({ subject: "Maths", language: "en" }, [], context,
    { kind: "fraction", parts: 8, filled: 4 }));
  const line = { ...generated, visual: { kind: "numberLine", from: 2, to: 7 }, options: ["3", "4", "5", "6"], correctIndex: 2 };
  const lineGenerator = new FoundryQuizGenerator(config, credential, async () => Response.json({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(line) } }]
  }));
  assert.deepEqual(await lineGenerator.generate({ subject: "Maths", language: "en" }, [], context), line);
  await assert.rejects(lineGenerator.generate({ subject: "Science", language: "en" }, [], context));
  const wrongLine = new FoundryQuizGenerator(config, credential, async () => Response.json({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...line, correctIndex: 0 }) } }]
  }));
  await assert.rejects(wrongLine.generate({ subject: "Maths", language: "en" }, [], context));
});

test("quiz failures expose only fixed actionable reasons, without retries or raw upstream content", async () => {
  const credential = { getToken: async () => ({ token: "synthetic-token", expiresOnTimestamp: Date.now() + 60_000 }) };
  for (const [response, reason] of [
    [new Response("private upstream error", { status: 429 }), "upstream-rate-limit"],
    [new Response("private upstream error", { status: 401 }), "upstream-authentication"],
    [new Response("private upstream error", { status: 503 }), "upstream-unavailable"],
    [Response.json({ choices: [{ finish_reason: "length", message: { content: "private unfinished output" } }] }), "completion-limit"],
    [Response.json({ choices: [{ finish_reason: "content_filter", message: {} }] }), "filtered-output"],
    [new Response("not JSON"), "invalid-output"],
  ] as const) {
    let calls = 0;
    const generator = new FoundryQuizGenerator(config, credential, async () => { calls++; return response; });
    await assert.rejects(generator.generate({ subject: "Space", language: "en" }, [],
      { subjectSummary: "", recentQuestions: [] }), error =>
      error instanceof QuizGenerationError && error.reason === reason && !error.message.includes("private"));
    assert.equal(calls, 1);
  }
});
