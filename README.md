# StudentIQ

StudentIQ is a parent-controlled learning assistant for children. The web app
uses a 3D character and Azure Speech; a separate API uses Microsoft Foundry
Model Router and stores learning records in Azure Blob Storage.
The locally rendered, stylized human tutor changes outfit colour with the saved
appearance preset and has simple speaking and idle animation. It is not a real
person, uses no camera, and has a static illustrated fallback without WebGL.

The tutor is AI, can make mistakes, and does not replace a teacher or parent.
Generated quiz answers and explanations should be checked when important.
Current-affairs answers are not live news unless a verified source is supplied.
Attention cannot reliably be inferred from inactivity, facial expressions, or
gaze. Learning scores are based on recorded practice, not attention.

## Architecture

- React and TypeScript PWA, published as static files on GitHub Pages.
- Azure Functions Flex Consumption API with administrator-controlled Google and
  Microsoft personal sign-in for parents and learners.
- A new Foundry account and project with Data Zone Model Router in cost mode.
- Azure Speech with a separately scoped managed identity; no service key is sent
  to the browser. The short-lived Speech bearer token is a credential.
- Private Azure Storage endpoints, managed identity, and private DNS. Session
  records are not hosted on GitHub Pages.

## Learning activities

Learning has separate **Mission**, **Talk to teacher**, and **Explore & play**
spaces, with one activity visible at a time. Switching spaces preserves the
current mission and unsent question. A compact tutor panel on phones keeps the
activity within reach. Light violet and midnight themes are available from the
header; the theme choice is kept in the page URL, not personal-data storage.
Learners can explore multiplication with a dot array, build English or
Norwegian sentences, and select stages of the water cycle. The existing
fraction explorer and piano remain available. These local explorers use no
additional model calls and do not save attempts or award grades. Their teacher
buttons only add a question
to the draft; the learner reviews and sends it explicitly. Conversation,
quiz and piano practice history continue to be saved by the backend as before.
Changing subjects or language, starting a new session, or opening an old one
asks before clearing an unsent question.

**Design your learning companion** changes the teacher immediately from a short
English or Bokmål prompt, for example `blue shirt, short hair and glasses`.
Hair and shirt colours, hair length and glasses are supported in both the 3D
avatar and its illustrated fallback. Unsupported requests or conflicting
choices are reported without partially changing the avatar. This is local,
bounded styling, not AI image generation: prompts are not sent to a provider or
saved. Changes survive activity switching in this tab, but reset on page reload;
saved appearance, voice and mood preferences remain separate.

### Family access and calendars

Configuration separates **People & access** from **Calendar & reminders**.
Account approval uses an email-labelled, verified sign-in request, a clear
approved-account list, role changes, and confirmed removal. Parents can optionally
receive administrator rights; students cannot. Server-side authorization protects
all access management and planning endpoints.

External Google, Microsoft work/school and Microsoft personal calendars require
separate read-only consent: signing into StudentIQ does not grant calendar access.
Connecting loads all returned calendars and recurring occurrences for the visible
month, including provider pagination. Limits or partial failures are reported.
Calendar tokens and data remain in tab memory and are cleared on disconnect,
expiry, sign-out or leaving Configuration. They are not imported into backend
storage. Provider setup and consent requirements appear beside each connection.
The existing Microsoft registrations declare delegated `Calendars.Read.Shared`
for work/school and `Calendars.ReadBasic` for personal accounts; no application
permissions or tenant-wide administrator consent are granted. A mailbox and
account-level consent are still required when connecting.
Google remains unavailable until a Google OAuth web client and Calendar API
consent are configured; StudentIQ cannot create a Google client in Azure.

### Published version and updates

The footer displays the release version (for example, **1.0.0**) and a separate
build timestamp in **Europe/Oslo** (Norwegian local time, including daylight-saving
time). The unique timestamped build ID stays internal for update detection, so
rebuilds of the same release are still detected. Public `version.json`
is fetched without caching on load, once per minute, and when returning to the
tab. A newer build offers an explicit refresh, disabled while an operation is
busy, with confirmation before discarding an unsent question. Refreshing clears
in-memory sign-in; saved backend history is unchanged.

The service worker uses network-first HTML navigation and cached static assets
only as an offline fallback. New workers activate and take control without
automatically reloading a lesson. Configuration, authentication, version checks
and private API data remain outside the cache. An already-open old installation
may need a refresh after the new worker installs. Run
`npm run build` and `node scripts/check-build.mjs` in `frontend` to validate
production shell updates and privacy cache boundaries.

Visual missions are optional AI-generated mini-lessons with an introductory
idea, a question, four choices and bounded visual clues. Maths rotates between
equal-group arrays, fraction bars and 0–10 number lines; the backend checks
the numerical answer against each picture. Other supported subjects use labelled
cards, not generated maps or images. When voice is enabled the avatar reads
the introduction, question and explanation, and the learner
can replay, request a hint or skip. A question is stored when generated; an
answer is stored only when submitted. The next topic is chosen automatically
from a small subject-specific rotation using recent saved mission topics; recent
questions, pictures and bounded conversation notes reduce repetition. They do
not prove learning, ensure a personalized sequence, or guarantee novelty.
Starting a mission or choosing the next one is an explicit action; there are no
background model calls. AI content can still be wrong. Live current-affairs
missions are unavailable without a verified source. Each mission makes a model
call and voice narration uses Speech; both may incur charges and are subject
to the existing quotas.

### Curriculum scope

The topic rotation is a small, locally curated starting point for an
approximately ten-year-old, inspired by broad Norwegian primary-school subject
themes and inquiry-led learning. Useful public references include the
[Norwegian mathematics](https://www.udir.no/lk20/mat01-06),
[science](https://www.udir.no/lk20/nat01-05) and
[social studies](https://www.udir.no/lk20/saf01-05) curricula and the
[IB Primary Years Programme](https://www.ibo.org/programmes/primary-years-programme/curriculum/)
framework. Schools choose their own IB units; Norwegian goals span year bands.
This is not an official, endorsed or complete IB or LK20 curriculum mapping,
and generated lessons have not been independently reviewed by teachers.
Parents should compare topics with the child's actual school plan. Maths
missions currently cover only the three visual exercise types described above.
Deploy the backend before the frontend: older clients omit the number-line
capability and receive only visuals they understand.

The deployed Azure resources are in `rg-studentiq-20261113` in Norway East.
The Entra application registration is a tenant-level directory object and cannot
reside in an Azure resource group. GitHub Pages is publicly accessible; the API
and data are protected independently.

## Security and privacy

The existing work/school Entra identity remains the bootstrap administrator.
Parents and learners do not need an account in that tenant: the administrator
can separately approve a Google or Microsoft personal account as a parent or
student. Both can access the shared learning history and tutoring features.
Parents have no administrator rights by default; an administrator can optionally
grant those rights to a parent. Only administrators can manage access or the
server-protected planning endpoints. Do not give a child an administrator session.

Social access is disabled until the administrator approves the exact provider
subject (`sub`) in Configuration. A verified provider signature, issuer,
audience, expiry and nonce are required before a short-lived session is issued. Each
provider assertion is accepted once. Sessions expire after 30 minutes and are
kept in browser memory only; signing out revokes the app session but does not
necessarily sign out of Google or Microsoft. Requests and learning records
continue to use the existing shared family history. Removing an account or
changing its role or administrator rights immediately invalidates its existing sessions; re-approval
does not reactivate old sessions.

### Approving an account

1. The dedicated Microsoft personal SPA registration is
   `fa5a0009-06ab-47d1-9fec-992bbf54f72c` and its only production callback is
   `https://dibakardharchoudhury.github.io/StudentIQ/auth.html`. The API setting
   `MICROSOFT_PERSONAL_CLIENT_ID` must match the public
   `microsoftPersonalClientId` in `frontend\public\config.json`.
2. For Google, create a **new** Google Cloud OAuth web client, authorize the
   JavaScript origin `https://dibakardharchoudhury.github.io`, and set the
   resulting public client ID in both frontend `googleClientId` and API
   `GOOGLE_CLIENT_ID`. Publish the frontend. Follow Google's consent-screen and
   test-user requirements. Do not reuse another application's credentials.
3. Sign in with the intended account. Until approved, access is denied and the
   API records a request only after verifying the provider token. In a separate
   browser/device, sign in as administrator, open **Configuration → People &
   access**, refresh requests and select the person's request. You can enter
   their email to locate a unique request. Confirm the account directly with the
   person: provider email/username is a mutable label, never the authorization
   identifier, and may differ from an alias they use. Approval binds to the
   verified provider and immutable subject. Requests are eligible for 48 hours;
   expired records are removed on later directory writes.
4. Choose **Parent** or **Student** and approve. For a parent only, optionally
   enable administrator rights and confirm the grant. This defaults off.
   Existing parents can also be granted/revoked these rights from the list.
   Each provider account must be approved separately.
5. Sign in again using the normal personal-account button. Ordinary parents and
   students cannot access Configuration or the planning API; parents explicitly
   granted administrator rights can. The separate work/school administrator
   button is for the original bootstrap administrator, whose account cannot be
   removed from this list. Remove an entry to revoke access. Do not put account
   identifiers in Git, URLs, or logs.

Provider parental-consent rules may block a supervised child account until its
parent permits third-party sign-in. Account approval is not a substitute for
reviewing the provider's age, consent, and privacy requirements.

`infra\function.bicep` accepts the social client IDs. Supply them again when
redeploying that template: defaults are empty and would disable provider
sign-in. Approvals are stored separately in private family storage. The separate
`infra\social-auth-retention.bicep` deletes only `learning-history/social-auth/`
records after two days, subject to Azure's periodic lifecycle processing and
seven-day soft deletion. It defines the account-wide management policy, so
merge any other rules into it before deploying if a policy already exists.

Voice capture requires a user gesture and permission: select **Speak to teacher**,
then select **Stop listening**, review the transcript and send it. Capture also
stops after 30 seconds or when the page loses focus. Turn on the teacher's voice
separately to hear replies. Audio is sent to Azure Speech; learning messages are
sent to the backend and model. Audio recordings
are not intentionally stored. Learning text, quiz attempts and settings are
sensitive data; protect them and do not commit them to the repository.

Storage has seven-day blob soft deletion enabled, so deleting a live record
does not immediately erase recoverable copies. Review retention, account access,
the data processing locations and applicable privacy requirements before use.
The application uses content filtering but no automated safety measure makes AI
outputs guaranteed safe or correct.

## Running and testing

Use Node.js 22 or later. Each app has its own lockfile.

```powershell
Set-Location frontend
npm ci
npm test
npm run build
Set-Location ..\backend
npm ci
npm test
npm run build
```

The frontend's `public\config.json` contains public application identifiers,
not credentials. Backend configuration is described in `backend\.env.example`;
never commit real secrets or local settings.

## Deployment and cost

The Bicep files under `infra` describe Foundry, storage, private networking and
the Function App. Deploy them to the intended subscription and resource group
in that order, after registering required providers. `infra\entra-app.json`
documents the current single-tenant SPA redirect and delegated API scope.

GitHub Actions publishes the frontend on pushes to `main`. Backend deployment
is separate. GitHub Pages only hosts public static files.

Private endpoints incur charges even when the app is idle, in addition to
Functions, Speech, AI inference, storage and other resources. Per-user app
limits and Azure budget alerts are not hard spending caps. Set and monitor a
resource-group budget appropriate to the subscription's billing currency and
verify that alerts reach an owner. The deployed resource-group budget is USD
50 per month, with alerts at 80% actual and 100% forecast; it expires on
November 1, 2027. Adjust it as needed and renew it before expiry. The template
in `infra\budget.bicep` requires a notification email when redeployed. Check
the Azure pricing calculator for current regional rates.
