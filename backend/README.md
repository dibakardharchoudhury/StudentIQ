# StudentIQ backend

Node.js 20+ / TypeScript Azure Functions v4 API. HTTP triggers use Functions'
`anonymous` trigger level so the app can validate Entra access tokens itself;
this is **not** anonymous application access. Every route other than
`GET /api/health` requires a cryptographically verified v2 Entra JWT.

## Configuration

Use `.env.example` as a reference when creating local Function settings; do not
commit `local.settings.json`. Local development uses `DefaultAzureCredential`
only when `NODE_ENV=development`. In Azure, configure values as Function App
settings and use managed identities. Speech always uses a dedicated
user-assigned managed identity, including in development; there is no key-based
authentication or fallback to the backend's Foundry/Blob identity.

Required settings:

| Setting | Purpose |
| --- | --- |
| `ENTRA_TENANT_ID` | Tenant-specific issuer and Microsoft JWKS endpoint |
| `ENTRA_API_AUDIENCE` | Exact `aud` expected for the API access token |
| `ENTRA_PARENT_OID` | Admin allowlisted `oid` and family storage owner |
| `ENTRA_REQUIRED_SCOPE` | Exact delegated scope required in `scp` |
| `GITHUB_PAGES_ORIGIN` | One exact HTTPS origin; no wildcard or path |
| `AZURE_STORAGE_BLOB_ENDPOINT` | HTTPS Blob service endpoint |
| `BLOB_CONTAINER_NAME` | Private container for session data |
| `FOUNDRY_ENDPOINT` | HTTPS Foundry resource endpoint |
| `SPEECH_IDENTITY_CLIENT_ID` | Required isolated Speech user-assigned identity client ID |
| `SPEECH_RESOURCE_ID` | Full ARM resource ID of the Speech account |
| `AZURE_SPEECH_REGION` | Speech resource region |

`AZURE_CLIENT_ID` is optional and selects the Foundry/Blob user-assigned managed
identity; otherwise the system-assigned identity is used. It must not equal
`SPEECH_IDENTITY_CLIENT_ID`. Do not set `NODE_ENV=development`
in Azure, since that explicitly enables the local `DefaultAzureCredential` chain.
`FOUNDRY_MODEL` defaults to `model-router`; `FOUNDRY_API_VERSION` defaults to
`2024-05-01-preview`. The Function App managed identity must be granted Azure AI
inference permission on the Foundry resource and `Storage Blob Data Contributor`
on the private container/storage account. Attach a separate user-assigned
identity to the Function App and grant it **Cognitive Services Speech User**
at the Speech resource scope only. It must have no Foundry/Blob permissions
(including inherited roles); audit those assignments before deployment.
`SPEECH_RESOURCE_ID` and `AZURE_SPEECH_REGION` must identify that Speech account.
Keep `disableLocalAuth=true`; remove the obsolete Speech key app setting and
any unused Key Vault reference. Those resources, roles, Entra app registrations,
and Azure-host CORS settings are not
provisioned by this project. Keep the Blob container private and disable
anonymous Blob access at the storage account; grant the Function identity only
the required data-plane role. Identity attachment, RBAC isolation, resource
matching, and tenant policy require Azure-side configuration and verification;
they cannot be proven from these environment values alone.

Set Azure Functions platform CORS to the same single `GITHUB_PAGES_ORIGIN` as
well. The app also rejects a different browser `Origin` and emits no wildcard
CORS response. Do not configure `*`.

Use the v2 API access token for this API, not an ID token. Tokens are verified
against `https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys`;
issuer, audience, expiry, tenant, delegated scope, and exact parent object ID
or explicitly configured student object ID are enforced. No identity outside
that allowlist is accepted. A request may include an `Idempotency-Key` (8–128 safe ASCII
characters) to make chat retries replay-safe. Supplying this header before the
first attempt is recommended, including for network timeouts.

### Family roles

`ENTRA_PARENT_OID` is always the **admin**. Optional `ENTRA_STUDENT_OID` must
be a distinct, valid Entra object ID in the same tenant. The same strict JWT,
issuer, audience, expiry, and delegated scope checks apply to both identities;
roles come only from the verified allowlisted `oid`, never client headers or
token `roles` claims. Admin routes require the admin identity on every operation.

When `ENTRA_STUDENT_OID` is omitted/blank, only the admin can sign in. This
project does not provision identities or imply that a child-usable account
exists. Configure the separate identity, application access, scope consent,
and tenant/parent policies yourself before enabling it.

Both authorized roles share tutoring, history, piano/quiz evidence,
preferences, and one quota pool under `parents/{ENTRA_PARENT_OID}/`. No
student-specific data prefix or second allowance is created. Only the admin
can read/write calendar reminders; students receive 403 on all admin routes.

## Routes

* `GET /api/health` — unauthenticated liveness response.
* `GET /api/me` — `{ "role": "admin" | "student" }`.
* `GET /api/preferences` and `PUT /api/preferences` — the preferences object described below.
* `GET /api/planning/reminders`, `POST /api/planning/reminders`, `DELETE /api/planning/reminders/{id}` — admin-only manual planning. The `admin` route prefix is reserved by Azure Functions.
* `POST /api/practice/piano` and `GET /api/practice/piano` — recorded note-identification practice.
* `POST /api/quiz`, `POST /api/quiz/{id}/answer`, `GET /api/quiz/attempts` — evidence-based MCQ practice.
* `GET /api/sessions` — `{ "sessions": [{ "id", "subject", "language", "updatedAt", "summary" }] }`
* `GET /api/sessions/{id}` — `{ "id", "subject", "language", "events": [{ "id", "role", "text", "at" }] }`
* `POST /api/chat` — body `{ "sessionId"?, "subject", "language": "en"|"nb", "message", "mood"?: "gentle"|"cheerful"|"calm" }`; response `{ "sessionId", "reply" }`.
* `POST /api/speech/token` — `{ "token", "region" }`, with `Cache-Control: no-store`.
  The token is `aad#<SPEECH_RESOURCE_ID>#<access token>`, obtained solely through
  `ManagedIdentityCredential({ clientId: SPEECH_IDENTITY_CLIENT_ID })` for
  `https://cognitiveservices.azure.com/.default`. The Speech SDK can use
  `SpeechConfig.fromAuthorizationToken(token, region)`. Refresh before expiry;
  no key or backend default-identity token is returned. Missing/invalid
  configuration or identity/token failures fail closed. Local Speech calls
  require an environment supporting the configured managed identity.

All routes except health and browser CORS preflight require authenticated
family access. The exact configured origin is allowed GET/POST/PUT/DELETE;
platform CORS must use the same origin. Responses use `Cache-Control: no-store`.

### Shared preferences and teaching tone

GET returns, and PUT fully replaces, exactly:

```json
{"appearance":"rose","voice":"default","mood":"gentle"}
```

Allowed values are `appearance: rose|sunny|mint`, `voice: default|alternate`,
and `mood: gentle|cheerful|calm`. All three fields are required for PUT;
unknown fields, partial updates, and invalid values return 400. Both family
roles may save choices. Each successful PUT confirms an atomic conditional
Blob write at `parents/{adminOid}/preferences.json`; concurrent replacements
do not mix fields. A failed/unconfirmed write returns 503.

Initial choices are explicitly configured through optional `DEFAULT_APPEARANCE`,
`DEFAULT_VOICE`, and `DEFAULT_MOOD` (defaults: `rose`, `default`, `gentle`).
GET uses these only when the preference Blob is absent, not for failed reads
or malformed saved data; those return 503. Invalid default configuration
fails closed. Appearance/voice are presentation hints for the client, not
provisioned avatars or a promise of voice availability.

Chat uses saved mood unless an allowed per-message `mood` is supplied.
An override changes that response's tone, not saved preferences. All moods
retain the same age-appropriate teacher/safeguarding instructions; they do
not infer the child's emotions. Completed idempotent chat retries return
their saved answer without reloading preferences or calling the model.
Reusing a key with a different explicit mood returns 409 rather than
regenerating the answer. No monitoring/eye-contact scores are accepted.

### Admin calendar / manual to-dos

* GET returns `{ "reminders": [{ "id", "title", "date", "completed" }] }`, sorted by date/ID.
* POST `{ "title", "date" }` creates a UUID reminder with `completed:false`;
  responds **201** `{ "reminder": { "id", "title", "date", "completed" } }`.
* POST `{ "id", "title", "date", "completed" }` fully updates an existing item;
  responds **200** with the same wrapper. Missing items return 404.
* DELETE `/api/planning/reminders/{id}` confirms deletion with **204**; an already
  absent valid ID is also 204. Invalid IDs return 400.

Titles are nonempty single-line plain text, at most 120 characters. Dates
must be real ISO calendar dates `YYYY-MM-DD` (not timestamps), including
valid leap days. There are at most 250 saved reminders; adding beyond that
returns explicit 409 without dropping anything. Updates/deletions use
ETag-based concurrency on `parents/{adminOid}/admin/reminders.json`;
storage errors return 503, not success. Optional `Idempotency-Key` on creation
reuses the same reminder; changed title/date with that key conflicts.
Render titles as text, not HTML.

These are **manual planning items**, not delivered notifications. There is
no scheduler, push alert, email, automatic completion, or reminder-delivery claim.

### Piano practice and educational evidence

POST `/api/practice/piano` accepts exactly `{ "targetNote", "selectedNote" }`.
Targets remain strictly `C4,D4,E4,F4,G4,A4,B4`; selections may be any displayed
key: `C4,C#4,D4,D#4,E4,F4,F#4,G4,G#4,A4,A#4,B4,C5`. Sharps and C5 are valid
selections but incorrect for every natural octave-4 target, not 400 errors.
Other spellings/octaves and non-natural targets remain invalid. Existing
natural-note attempts need no migration. The server generates an attempt
UUID/UTC timestamp, computes `correct = targetNote === selectedNote`, and
confirms a durable Blob write before returning **200** `{ "correct": boolean }`.
The client cannot supply correctness, grades, IDs, or timestamps.

GET returns `{ "attempts": [{ "id", "targetNote", "selectedNote", "correct", "at" }], "nextCursor"? }`.
Use `?pageSize=N&cursor=...` (default 50, maximum 100). Follow all cursors to
retrieve every saved attempt; there is no silent history cap. Attempts are
family-owned at `parents/{adminOid}/practice/piano/`, in timestamp/ID order.
Every POST is a new attempt; avoid resubmitting after an ambiguous response
without first checking history.

Evidence here is only the submitted note-identification choice, **not** audio,
pitch recognition, or an assessment of an actual piano performance. The tutor
is a warm, transparent AI teacher for Maths, Norsk, Science, Geography, History,
English, piano/basic music theory, additional languages and other school
subjects. It uses short Q&A, encouragement, and optional safe visual activities.
Interface explanations are English/Bokmål; other languages can be practised
within those lessons. It cannot hear/evaluate a real piano performance, infer
mastery, invent grades, or assess pronunciation from text alone.
No eye-contact, attention, emotion, compliance or surveillance scores exist.
Mood changes do not weaken these restrictions. No reward/streak pressure,
manipulation, or promise of live current events is used.

### Evidence-based quiz scores

* POST `/api/quiz` accepts exactly `{ "subject", "language": "en"|"nb" }`.
  It generates one structured four-option MCQ and confirms server-side storage
  of the question, answer key and explanation before returning **200**
  `{ "id", "question", "options": [four plain strings] }`. The answer key and
  explanation are **not** included at creation.
* POST `/api/quiz/{id}/answer` accepts exactly `{ "answerIndex": 0..3 }`.
  A successful durable comparison returns **200**
  `{ "correct": boolean, "correctIndex": 0..3, "explanation": string }`.
  The first committed answer wins. Identical retries return the saved grade
  without another write/model call; a different answer returns 409. Unknown
  or other-family quiz IDs return 404; unauthorized identities are denied.
* GET `/api/quiz/attempts` returns
  `{ "attempts": [{ "id", "subject", "question", "correct", "at" }], "nextCursor"? }`.
  Use `?pageSize=N&cursor=...` (default 50, maximum 100). Each page reads a
  bounded number of issued question records and includes only answered ones:
  an empty page can still have a continuation cursor. Follow it until absent.
  Answer and grade share one canonical Blob, avoiding a fallible grade index.

Quiz subjects currently supported: Maths, Norsk, Science, Geography, History,
English, Piano, Music theory, French, Spanish, German (documented common
English/Norwegian aliases are accepted). Other subjects, including all live
Current Affairs/Current Events/News quizzes, return **422** without a model call.
Chat can discuss a parent-provided current-affairs source but does not claim
live access or fabricate freshness.

**Generated questions/answer keys can be wrong.** Correctness is a real
comparison with the saved generated key, not an independently verified fact,
mastery score, attention score, or fabricated grade. Review questionable items
with a parent/teacher. Counts of saved correct/answered attempts describe only
those exercises; no new model judgment is needed to compute them.

Question/options/explanation lengths and four distinct options are validated,
and filtered, refused, malformed, or unconfirmed model/storage results return
errors—not fake quizzes/grades. Foundry JSON-output support and deployed
content filters must be configured/tested. Questions are stored privately at
`parents/{adminOid}/quiz/questions/`.

For best-effort nonrepeat, a bounded subject/language memory retains the last
24 normalized question fingerprints; up to eight recent questions are sent
as untrusted context. Conditional memory writes reject normalized/concurrent
duplicates with **409**, without automatic extra model attempts. A failed
question write may conservatively leave a fingerprint reserved. Paraphrases
or older questions can still repeat; this is not a uniqueness guarantee.

### Complete history and pagination

Both history routes accept `?pageSize=N&cursor=<nextCursor>`. Session pages
default to at most 100 sessions. Session-detail `pageSize` remains 1–40
(default 40), allowing up to `2 * pageSize` chronological event-index entries
(normally up to 80 events). These are per-request limits, **not retention
limits**. Smaller positive page sizes are allowed; larger values return 400.
When more data exists, the response has an additive `nextCursor` field.
Continue with that cursor on the same route until it is absent. Existing
`sessions`/`events` fields remain unchanged; consumers must follow `nextCursor`
to display full history. No frontend files were changed.

Canonical interaction blobs, not the old session index or truncated interaction-ID
arrays, remain the source of truth. All canonical legacy interactions remain readable,
including records omitted by old indexes or missing session metadata. Sessions
missing metadata derive a fallback note/date from the first canonical
interaction; full interactions are still available through pagination.
The session list retains Blob-name/ID ordering; clients may sort accumulated
sessions by `updatedAt`.

**Session-detail events are ordered server-side by their stored UTC timestamp
across all continuation pages**, not by hashed interaction UUID. Equal times
use interaction ID then event position as deterministic tie-breakers, keeping
the user before the assistant within one interaction. Overlapping interactions
can interleave, and a user/reply pair may span pages. Output preserves original
event IDs, timestamps and text; it does not guess missing/invalid timestamps.
Unusable legacy records fail explicitly rather than being silently dropped.

An additive derived index at
`parents/{adminOid}/history-events-v1/{sessionId}/` contains only timestamped
references, not transcript copies. Reads resolve each reference against the
canonical record. New requests/retries index before committing user/reply data.
References left by failed writes or losing concurrent completions are ignored;
only the committed canonical events are returned. This can yield short or empty
pages with `nextCursor`; always continue until the cursor is absent.
The first committed answer and original user timestamp remain unchanged.

**Upgrade/backfill:** no canonical blobs are renamed, deleted, or rewritten.
On the first history read of an existing session, a resumable ETag-protected
backfill enumerates *all* canonical interactions, including legacy orphans.
It processes at most 200 interaction records per request (four batches of 50),
persisting progress at `parents/{adminOid}/history-index-v1/{sessionId}.json`.
No partial chronological history is served until backfill finishes. Larger
sessions return explicit **503** with `Retry-After: 1` and a preparation message;
retry the same request to continue. Storage errors also fail, and the next
request safely resumes/repeats the last unconfirmed batch. Brand-new sessions
need no backfill. No background job, provisioning, or offline migration was run.

Drain/stop older backend writers before deploying this version: an old binary
does not maintain the new index. If canonical interactions are later imported
or restored outside this backend, remove that session's `history-index-v1`
state blob to trigger backfill again; keep all canonical interaction blobs.
Pre-upgrade **session-detail** cursors return 400; restart that history route
without a cursor. Session-list and other collection cursors are unchanged.

Listing is not a snapshot: finish/restart pagination after concurrent writes
to refresh the collection. Events committed behind an already-consumed cursor
require a restart. Ordering reflects stored timestamps, not inferred wall-clock
order if historical clocks were wrong. Normal indexed pages read only their
bounded entries and referenced records, in batches of eight; backfill has the
separate bound above. No request loads all history into memory or the model
prompt. The derived index adds small Blob operations/storage, not model calls.

### Durable chat and bounded learning memory

Blob data is partitioned under the configured admin/family object ID. The session
is made discoverable and its user event is saved **before** context loading or
model invocation. An interrupted or failed model request remains in history as
an unanswered user event. Completion atomically replaces that interaction
using an ETag, preserving the original user event; concurrent/repeated
completion returns the already saved answer. The API reports success only
after the canonical record and context caches have been confirmed written.
Caches are updated with optimistic concurrency, not multi-Blob transactions.

Chat failures return 503 with `sessionId` and `idempotencyKey`; check history
and retry the same message using that session ID and `Idempotency-Key` header.
If completion was already durable but a cache write failed, retry repairs
caches without another model call or duplicate events. If storage is unavailable,
the error explicitly says saving could not be confirmed, rather than claiming
the input was saved. No backend can guarantee saving during a storage outage.

Session/subject summaries are compact **extractive practice notes** containing
questions and tutor explanation excerpts, not inferred mastery or merely the
last answer. Session caches keep six recent notes; subject caches keep up to
18 notes, at most three per session/language so a long current session does
not immediately evict all earlier sessions. These caches do not control
history retention. Prior-session notes are limited to 1,200 characters,
recent questions to six excerpts of 180 characters, and current-session
history to 1,800 characters. The prompt marks notes/questions as untrusted
context, not instructions or evidence of mastery. Legacy one-reply subject
summaries are not treated as learning summaries; structured caches populate
as interactions complete/replay after this update.

No audio is accepted or stored.
Application code does not log request content, transcripts, or credentials.
Unexpected failures produce only fixed `{ operation, category }` diagnostic
labels through the Functions error logger. No exception messages/stacks,
request URLs/bodies, parent/session IDs, headers, keys, or tokens are logged by
application code. Expected validation/authentication/limit failures are not
logged. Keep SDK HTTP/verbose diagnostics and body-capturing telemetry disabled.
Configure and test Azure AI Foundry input/output content filters for the
selected model. The API replaces responses explicitly marked as filtered; this
is not an independent safety classifier or a guarantee about model output.
Configure a Blob lifecycle/retention policy appropriate for children's data:
session records are retained, and this API does not delete them automatically.

## Cost governance

Optional app settings (omit to use defaults):

| Setting | Default | Strict integer range |
| --- | --- | --- |
| `CHAT_DAILY_LIMIT` | 60 | 0–200 |
| `SPEECH_TOKEN_DAILY_LIMIT` | 200 | 0–500 |

Zero disables new upstream calls. Empty strings, whitespace, signs, fractions,
scientific notation, and out-of-range values are configuration errors, not
silently clamped or replaced with defaults.

Each family has one private Blob counter record per UTC day at
`parents/{oid}/quotas/YYYY-MM-DD.json`. Both counters use conditional create
and ETag-based compare-and-swap updates shared across Function instances and
restarts. The day is determined in UTC when reserving, not from client input.
Do not delete/reset the current day's quota Blob through lifecycle rules or
administrative jobs. No IP-based or in-memory rate limiter is used.

Chat and quiz generation **share** `CHAT_DAILY_LIMIT`; enabling a student does
not double this quota. Chat reserves a unit immediately before each model
invocation, after durable input/context loading; quiz generation reserves one
before its single model call; Speech reserves one before each token-provider call.
Failed upstream attempts still consume their reservation. Pending chat retries
that need another model call reserve again; completed idempotent chat retries
only replay/repair saved data and do not reserve another unit. Concurrent
pending attempts can each reserve a unit; every model invocation is charged.
Counters are not refunded on crashes, upstream failures, or uncertain writes.
Chat output is limited to 450 model tokens; quiz generation to 600, with
bounded context/response sizes. Preferences, planning, note practice, grading
saved quizzes and progress retrieval do not call the model.

Exhaustion returns an explicit **429** with a generic error, no counters,
identifiers, or credentials, and `Cache-Control: no-store`; try again on the
next UTC day. If quota storage/read/validation/write cannot be confirmed, the
API fails closed with **503**, never calling the model/token provider.
Quota failures never fabricate an answer or token. Chat input already saved
before a limit/storage failure remains discoverable in history.

**These are request quotas, not hard spend caps.** A returned Speech token is
a bearer credential enabling direct Speech use until its Entra expiry,
including multiple recognition/synthesis operations without another token
request. Treat it as sensitive and refresh only as needed. Quotas do not cap
direct Speech consumption, model price variation, Blob operations, history
reads, or Function execution costs. Configure Azure budgets/alerts and
resource-side controls separately; budgets/alerts are not immediate hard
cutoffs either. No resources or billing controls are provisioned here.

## Local verification

`npm install`, `npm test`, `npm run build`. Start locally with Azure Functions
Core Tools after setting the values in `local.settings.json` (do not commit that
file).
