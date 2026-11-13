# StudentIQ frontend

React + TypeScript + Vite frontend for the StudentIQ Azure Functions backend.

## Run / validate

Use Node 22.12+ (validated with Node 26) and npm, from this directory:

```powershell
npm ci
npm run dev
npm test
npm run typecheck
npm run build
node .\scripts\check-build.mjs
npm run preview
```

Default project-site path: `/StudentIQ/`. To build for a different GitHub repository:

```powershell
$env:VITE_BASE_PATH = '/your-repository/'
npm run build
node .\scripts\check-build.mjs
```

The repository's GitHub Actions workflow publishes the **contents** of `dist` to Pages after its checks pass. No client routing or rewrite rules are needed. `VITE_BASE_PATH` must begin and end with `/`. Public runtime config, assets, manifest scope/start URL, auth callback and service worker use this base. Vite development mode does not serve the generated production manifest/icons; use the built preview to check installation.

## Required public runtime setup

Fill `public/config.json` before building, or replace `dist/config.json` after building:

```json
{
  "apiBaseUrl": "https://your-backend.example",
  "tenantId": "your-tenant-guid",
  "clientId": "your-spa-client-guid",
  "apiScope": "api://your-api-client-guid/Tutor.Access"
}
```

The checked-in configuration points to the StudentIQ Azure deployment and contains public identifiers, not credentials. Invalid or missing settings fail closed rather than providing fake tutoring. The API URL is the backend's root, optionally including a deployment prefix, **not** an `/api` URL; the adapter appends `/api/...`. HTTPS is required except for localhost development.

Configure an Entra **SPA** registration, tenant-specific authority, delegated exposed API scope and the exact callback `https://OWNER.github.io/REPOSITORY/auth.html` (plus the equivalent development URI). Do not use wildcard callbacks or a client secret. MSAL 4 popup flow uses the deliberately inert `auth.html` callback; keep it free of application scripts or redirects. Allow popups for sign-in/out. Token and temporary MSAL state are memory-only; refreshing requires sign-in again. Silent token renewal never opens an unsolicited login popup. Interactive renewal requires parent sign-out/sign-in.

## Backend contract and security expectations

Every call uses `Authorization: Bearer <API access token>`, `credentials: omit`, `cache: no-store`; redirects are rejected. The backend must validate signature, issuer, audience, delegated scope and the **parent allowlist on every endpoint**, including Speech. The frontend grants its workspace only after authenticated `GET /api/sessions` and `GET /api/me` succeed. A Microsoft login alone is not authorization. A frontend cannot enforce server authorization or child safety.

| Endpoint | JSON contract |
|---|---|
| `GET /api/sessions` | `{ "sessions": [{ "id": "...", "subject": "maths", "language": "en", "updatedAt": "2026-11-13T10:00:00Z", "summary": "..." }] }` |
| `GET /api/sessions/{encoded id}` | `{ "id": "...", "subject": "maths", "language": "en", "events": [{ "id": "...", "role": "user", "text": "...", "at": "2026-11-13T10:00:00Z" }] }` |
| `POST /api/chat` | Request `{ "sessionId": "optional-existing-id", "subject": "maths", "language": "en", "message": "...", "mood": "gentle" }`; response `{ "sessionId": "...", "reply": "..." }`. `mood` is omitted until saved preferences are available. |
| `POST /api/speech/token` | Request `{}`; response `{ "token": "aad#<resourceId>#<entra-access-token>", "region": "norwayeast" }` |
| `GET /api/me` | `{ "role": "admin" }` or `{ "role": "student" }`; unknown/missing roles fail closed |
| `GET /api/planning/reminders` | `{ "reminders": [{ "id": "...", "title": "...", "date": "2026-11-14", "completed": false }] }` |
| `POST /api/planning/reminders` | Create `{ "title": "...", "date": "2026-11-14" }`; update `{ "id": "...", "title": "...", "date": "2026-11-14", "completed": true }` |
| `DELETE /api/planning/reminders/{encoded id}` | No request body. POST/DELETE responses may be empty 2xx; canonical items are refetched after every mutation. |
| `GET /api/preferences` | `{ "appearance": "rose", "voice": "default", "mood": "gentle" }` |
| `PUT /api/preferences` | Same JSON shape and enums; after a successful PUT the frontend GETs canonical persisted preferences before applying them |
| `POST /api/practice/piano` | `{ "targetNote": "C4", "selectedNote": "D4" }` → `{ "correct": false }` |
| `GET /api/practice/piano` | `{ "attempts": [{ "id": "...", "targetNote": "C4", "selectedNote": "D4", "correct": false, "at": "2026-11-13T10:00:00Z" }], "nextCursor": "optional" }` |
| `POST /api/quiz` | `{ "subject": "geography", "language": "en" }` → `{ "id": "...", "question": "...", "options": ["...", "...", "...", "..."] }` (exactly four strings) |
| `POST /api/quiz/{encoded id}/answer` | `{ "answerIndex": 0 }` (0–3) → `{ "correct": false, "correctIndex": 1, "explanation": "..." }` |
| `GET /api/quiz/attempts` | `{ "attempts": [{ "id": "...", "subject": "geography", "question": "...", "correct": false, "at": "2026-11-13T10:00:00Z" }], "nextCursor": "optional" }` |

Languages: `en` / `nb`. Subject values sent by this UI: `maths`, `norwegian` (displayed as Norsk), `science`, `currentAffairs`, `english`, `geography`, `history`, `piano`, `otherLanguages`. The given API contract does not define a subject enum; **backend must accept these values or agree a mapping**. Other Languages asks which language the learner wants to explore without promising a full curriculum. Unknown returned subjects remain readable. Event role must be `user` or `assistant`. Timestamps must be ISO 8601 with timezone; session/event IDs must be nonempty strings. A resumed chat must return the same session ID. Invalid responses surface a contract error, never a synthesized success. Successful chat displays only the submitted text and returned reply; canonical history IDs/times are obtained by fetching history, not generated locally.

Both history GET responses may additionally include `nextCursor`. The adapter automatically follows `?cursor=<URL-encoded opaque cursor>` until it is omitted or `null`, including empty pages with a continuation cursor. No `pageSize` override is required; the backend default is used. Each page is independently authenticated, schema-validated and fetched without caching. Backend must return consistent session metadata and a stable event ordering across pages; insertion order is preserved.

History loading is atomic: the UI only replaces sessions or a conversation after **all** pages succeed. It shows an all-pages loading status, keeps the last complete snapshot during refresh, and persistently labels it stale if refresh fails. Identical overlapping IDs are deduplicated; conflicting versions, invalid/empty cursors, repeated cursors, malformed later pages and later HTTP errors fail explicitly rather than display a truncated success. A 1,000-page safety limit also fails explicitly (ask the service administrator to increase backend default page size or fix pagination). Cursors are never interpreted as URLs, stored or included in displayed diagnostics. Abort signals stop traversal on unmount/sign-out/page exit. The conversation scroll region is keyboard-focusable so older events remain reachable.

Backend should enforce per-parent session ownership, size/rate limits, child-safe tutoring policies and age-appropriate current affairs. No moderation or browsing endpoint is supplied. The UI warns that answers may be wrong. Actual currentness, fact-checking and safety are server responsibilities.

Configure backend CORS for `https://OWNER.github.io` (**origin has no repository path**) and any chosen local development origin. Allow GET/POST/PUT/DELETE/OPTIONS, Authorization and Content-Type. Send `Cache-Control: no-store, private` on authenticated responses and temporary Speech tokens. Never issue service keys to this frontend. No API connection or real parent login can be verified until valid runtime configuration/backend are provided.

### Speech and microphone lifecycle

Azure Speech SDK only; no browser SpeechRecognition, speechSynthesis or camera APIs. Fresh temporary tokens are fetched through the authenticated backend for each listening/playback action. With Speech keys disabled, the backend returns the SDK-compatible Entra authorization string `aad#<resourceId>#<entra-access-token>` plus region. The frontend passes that opaque string **unchanged** to `SpeechConfig.fromAuthorizationToken(token, region)` for both STT and TTS; it never splits, persists or logs it. No subscription key or key-based token exchange is used. The backend's identity must be authorized for the Speech resource, and must obtain the appropriate Cognitive Services token audience. Locales: `en-US`, `nb-NO`; voices: `en-US-JennyNeural`, `nb-NO-PernilleNeural` (verify voice availability in your selected region). SDK recognition telemetry is disabled; raw SDK failure diagnostics are not surfaced because they may contain credentials.

Voice playback starts muted; a parent/learner enables it. Hold the talk button with pointer, Space or Enter. Only that action requests microphone access. Release stops physical tracks immediately and finalizes Azure transcription (bounded 1.5-second wait); transcripts go to the composer for review, never automatic submission. Capture is capped at 30 seconds. Release during token loading or permission prompts invalidates startup and stops any late stream. Escape, blur, hidden tab, offline, subject/language/view change, mute, sign-out and unmount cancel voice resources. Browser permissions/OS indicators are outside app control. Browser autoplay rules can still block audio: text remains available, and explicit Read reply aloud is provided.

### History / progress limitations

History is fetched from the backend. Session progress is explicitly **activity**, calculated from returned session counts and subjects, not fabricated mastery or completed lessons. Piano/quiz progress additionally shows stored attempt counts and stored-correct counts, measuring practice only, not ability. Both attempt-history endpoints use the same all-pages validation/cycle/abort/partial-failure protections as session history. No session-deletion or consent-management endpoint is supplied. A new subject/language starts a new conversation because the contract cannot update session metadata.

POST failure may be ambiguous: the backend could have saved a message before the connection failed. Sending is blocked until history is refreshed. Open the saved session and inspect it before retrying. There is no idempotency key in the supplied API contract, so exactly-once retries cannot be guaranteed.

### Fraction explorer

The maths lesson includes a clearly labeled **local, ungraded** fraction explorer. Keyboard-accessible controls choose 1–12 equal parts and 0–denominator filled parts; reducing the denominator clamps the numerator. The graphic uses equal-width parts, filled/open symbols and a text alternative, so color is not the only signal. UI text and the prepared teacher question support English and Bokmål.

Exploration neither calls the backend nor creates sessions, events, grades or progress. “Ask teacher about this fraction” appends a factual description of the current selection to the composer without overwriting an existing draft. It never submits automatically. Only choosing Send question invokes the real tutoring endpoint; the normal ambiguous-failure protections still apply. Explorer state exists only in component memory.

### Playable piano and optional quizzes

The piano synthesizes one octave, C4–C5 including chromatic keys, locally with Web Audio triangle oscillators and volume envelopes. AudioContext is created/resumed only during a user key/pointer gesture, never on mount or after an API reply. Pointer capture supports touch, focusable keys support Space/Enter, and A W S E D F T G Y H U J K provide keyboard shortcuts only inside the piano. Release, blur, hidden tab, pause and unmount stop tones; each tone is also capped at two seconds. There are no external samples, audio recordings or microphone/pitch-analysis claims.

Free playing never posts attempts or increments progress. Optional note-identification practice displays a selectable target C4/D4/E4/F4/G4/A4/B4 and POSTs the chosen key; the **backend `correct` boolean** determines feedback. Selected chromatic keys use `C#4`, `D#4`, `F#4`, `G#4`, `A#4`; C5 is also selectable. Scores/counts update only from subsequent persisted history, not by incrementing local counters. Failures are reported and ambiguous POST failures require a history refresh before another submission.

Optional four-choice quizzes start only on request. Questions, choices, grading, correct index and explanations all come from the backend; contradictory correctness/index responses fail as a contract error. Unsupported subjects/services show errors, never sample questions or invented success. AI-generated questions/answers may be wrong. Users can inspect explanations or stop without penalties. Backend must enforce quiz ownership, exactly-once answer semantics where appropriate and safe/varied question generation; the frontend does not promise accuracy, nonrepetition or a particular curriculum. Persisted attempts are the only source of practice scores. Attention is never graded.

### Admin planning calendar

Only authenticated `/api/me` returning `admin` exposes Configuration navigation. `student`, unknown roles and role-load failures do not expose it. The backend must **independently authorize every admin GET/POST/DELETE** and apply item ownership/tenant rules; UI hiding is not authorization. A 401/403 while using planning clears the displayed planning data and removes admin navigation until a fresh sign-in.

The calendar uses date-only `YYYY-MM-DD` strings without UTC conversion, Monday-first localized weekday headings, selectable dates, month navigation, a selected-day view and an All dates list so items outside the visible month remain accessible. Items can be added, edited, completed/reopened and deleted with inline confirmation. Titles are limited to 200 characters in the frontend. The reminders GET contract is a complete array (no reminder pagination was supplied). Every mutation is followed by GET; nothing is optimistically marked saved/completed/deleted. An ambiguous mutation failure blocks another write until refresh. These are **in-app planning items only**, not delivered push notifications, alarms, emails or OS-calendar integrations.

### Teacher preferences and gentle wellbeing options

Canonical preference enums are exactly `appearance: rose|sunny|mint`, `voice: default|alternate`, `mood: gentle|cheerful|calm`. All authenticated parents/students can customize. GET loads persisted choices; a PUT sends only that shape, followed by a GET before applying choices. Unsaved drafts do not alter the teacher. If load/save/readback fails, the UI explicitly labels its rose/default/gentle fallback as **unsynchronized**, never pretends local settings were saved, and omits optional chat mood until preferences are confirmed. A failed PUT requires reload before retry. Settings are non-sensitive presets and are never stored locally.

Voice preset `default` maps to `en-US-JennyNeural` / `nb-NO-PernilleNeural`; `alternate` maps to `en-US-AriaNeural` / `nb-NO-FinnNeural`. SDK configuration tests cover these mappings and Entra token forwarding; live voice availability/region/Entra authorization must still be verified with your service. Appearance uses Clawpilot `--cp-accent`, `--cp-warning` and `--cp-success` tokens for rose, sunny and mint. The procedural avatar faces the virtual camera, blinks and animates speaking; positive mood presets change only gentle expression/motion and the optional backend chat `mood`. They never punish or claim higher accuracy. Reduced motion disables idle bob, blink and speaking movement.

The Q&A interface encourages asking why, requesting hints and taking time. Encouragement is opt-in and does not claim an answer was right. Sessions can be paused/resumed with the draft intact or started afresh. Optional 10/15-minute break suggestions have no countdown, streak, reward schedule or missed-day penalty. A separate opt-in check-in offers at most one prompt per enablement after five minutes without pointer/key interaction, or returning after at least two minutes of tab invisibility. It uses only these browser events and local elapsed time—not gaze, camera, distraction inference, attention tracking or scores. It never automatically pauses or sends anything; choosing a break stops voice and piano resources. All optional wellbeing settings are memory-only.

### Privacy and PWA

No app personal data, tokens, transcripts or histories are written to localStorage, sessionStorage, IndexedDB or logs. React renders backend text as text, never raw HTML. No telemetry, third-party fonts, remote 3D assets or analytics are installed. Audio goes directly to Azure Speech; tutoring text goes to the configured backend. Consent, retention and deletion must be handled by the operator/backend.

The production service worker uses an exact static-asset allowlist: shell HTML, hashed bundles, install icons and manifest. It never intercepts config, the auth callback, APIs, requests with Authorization, non-GET traffic, query-bearing requests or external origins. It does not runtime-cache responses. Offline availability is **shell only**; authentication, conversations and speech require network. Old StudentIQ static caches are removed on activation; updates activate once previous app tabs close. Reloading the app is not a history backup. Sign-out immediately unmounts the workspace, stops speech/requests and clears app memory; provider logout is attempted separately.

The original procedural Three.js companion uses virtual-camera gaze, blink and speaking motion; it accesses no device camera. WebGL/module failure has a decorative fallback and never blocks text tutoring. Reduced-motion preferences are respected. UI uses the exact Clawpilot light/dark variables, Segoe UI and responsive keyboard-accessible controls.

Theme detection is copied verbatim from the requested skill. Its original expression treats **any nonempty `scoutTheme` query parameter as dark** due to operator precedence; without that parameter it follows OS color preference. This behavior is retained to match the required script.

Unit tests use explicit test-only fixtures and SDK/network doubles. They are never shipped as application data. Production PWA checks execute the generated worker to verify cache privacy and project paths. No cloud resources or GitHub settings are touched.
