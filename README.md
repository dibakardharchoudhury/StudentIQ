# StudentIQ

StudentIQ is a parent-controlled learning assistant for children. The web app
uses a 3D character and Azure Speech; a separate API uses Microsoft Foundry
Model Router and stores learning records in Azure Blob Storage.

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

The deployed Azure resources are in `rg-studentiq-20261113` in Norway East.
The Entra application registration is a tenant-level directory object and cannot
reside in an Azure resource group. GitHub Pages is publicly accessible; the API
and data are protected independently.

## Security and privacy

The existing work/school Entra identity remains the bootstrap administrator.
Parents and learners do not need an account in that tenant: the administrator
can separately approve a Google or Microsoft personal account as a parent or
student. Both can access the shared learning history and tutoring features;
neither can manage access or the server-protected planning endpoints. Do not
give a child an administrator session.

Social access is disabled until the administrator approves the exact provider
subject (`sub`) in Configuration. A verified provider signature, issuer,
audience, expiry and nonce are required before a short-lived session is issued. Each
provider assertion is accepted once. Sessions expire after 30 minutes and are
kept in browser memory only; signing out revokes the app session but does not
necessarily sign out of Google or Microsoft. Requests and learning records
continue to use the existing shared family history. Removing an account or
changing its role immediately invalidates its existing sessions; re-approval
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
3. Under administrator supervision, sign in with the intended account. Until
   approved, access is denied and the page displays its **unverified** setup
   identifier. Confirm the selected account with the provider; never approve
   an identifier supplied by an unknown person. Sign in as administrator in a
   separate browser or device, open Configuration, and add the provider,
   case-sensitive identifier and role. Do not put identifiers in Git, URLs, or
   logs. Each provider account must be approved independently.
4. Sign in again, confirm the approved account sees the shared history and
   cannot access Configuration or the planning API, and confirm administrator
   sign-in still works. Remove an entry in Configuration to revoke access.

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

Voice capture requires a user gesture and permission. Audio is sent to Azure
Speech; learning messages are sent to the backend and model. Audio recordings
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
