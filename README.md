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
- Azure Functions Flex Consumption API with Microsoft Entra bearer-token
  verification and a server-side allowlist.
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

Sign in as the configured parent/admin. A separate student identity must be
explicitly configured before the app can distinguish a student from an
administrator. Do not hand a child an administrator session and expect the
admin-only configuration page to remain protected.

After creating or selecting an appropriate separate identity in the same Entra
tenant, set its object ID as `ENTRA_STUDENT_OID` on the Function App. It must
differ from `ENTRA_PARENT_OID`. Supply the same ID as `studentObjectId` when
redeploying `infra\function.bicep`, so infrastructure updates preserve access.
The identity must be able to sign in and obtain the app's delegated scope.
Verify that student sign-in works and that its API requests to `/api/admin`
are rejected before handing over the device.

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
verify that alerts reach an owner. Check the Azure pricing calculator for
current regional rates.
