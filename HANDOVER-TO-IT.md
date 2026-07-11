# Phoenix Procurement - IT Handover Package

**Prepared for:** Phoenix Beverages IT / Infrastructure team
**Application:** Phoenix Procurement - procurement, logistics, finance follow-up, and management control tower for Phoenix, Seychelles Breweries, and Edena.
**Deployment posture:** internal SQL/API mode by default; Firebase is retained for demo only unless IT explicitly reselects it.

## 1. Read This First

Phoenix Procurement is a control layer over ERP data from Navision / Business Central. It is not a replacement ERP.

The current production package is staged for a private/internal server deployment:

- browser app: `demoMode: false`, `authMode: 'internal'`, `dataMode: 'api'`;
- backend: Azure Functions v4, Node/TypeScript, SQL Server via `mssql`;
- database: SQL Server migrations under `backend/db/`;
- Firebase: demo path only, not the default production path.

Do not follow older Firebase-first instructions if they appear in archived material. The current deployment checklist is `docs/GO_LIVE_RUNBOOK.md`.

## 2. Package Files

The project root must contain exactly two package zips:

- `Phoenix Procurement DEMO FULL.zip`
- `Phoenix Procurement PRODUCTION FULL.zip`

Both are full snapshots and intentionally include source, docs, tools, and backend source. They exclude `node_modules`, generated backend `dist`, `.git`, local settings, and secret/key files.

Use the production package for internal server testing and pilot preparation. Use the demo package only for demo/Firebase testing.

## 3. What IT Must Provide Before Pilot

1. **SQL Server database**
   - Apply `backend/db/001_init.sql` through the latest migration.
   - Current latest migration is `backend/db/005_app_counters.sql`.
   - Use trusted certificates and least-privilege SQL principals for production.

2. **Backend hosting**
   - Host the Azure Functions backend under `backend/`.
   - Required app settings include `FUNCTIONS_WORKER_RUNTIME=node`, `SQL_CONNECTION_STRING`, and `AzureWebJobsStorage`.
   - Graph notification settings remain disabled unless IT provides the approved app registration and secrets.

3. **Static browser hosting**
   - Host `dist/phoenix-procurement-PRODUCTION.html` from the production zip over HTTPS.
   - Same-origin hosting is recommended so `apiBaseUrl: '/api'` works unchanged.
   - If API is on another internal URL, update `APP_CONFIG.apiBaseUrl` during deployment.

4. **Identity and authorization**
   - The current `authMode: 'internal'` setup is suitable for closed-environment testing only.
   - Before pilot/go-live, IT must enforce individual identity and server-side authorization through Entra ID/SSO, Windows-integrated auth, APIM/reverse-proxy policy, or another approved gateway.
   - Browser role checks are not enough on their own.

5. **Data and integration**
   - Seed officers/roles, suppliers, working calendars, import rules, and entity reference data.
   - The real Data Warehouse feed is not connected yet. Until IT provides the final source view/API, use the controlled Excel import or fixture-backed backend sync for testing.

## 4. Backend Smoke Checks

From `backend/`:

```powershell
pnpm install
$env:SQL_CONNECTION_STRING='<approved SQL connection string>'
pnpm run db:migrate
pnpm test
pnpm start
```

Then check:

```powershell
Invoke-RestMethod http://localhost:7071/api/health
Invoke-RestMethod -Headers @{ "x-functions-key" = "<function-key>" } http://localhost:7071/api/records
Invoke-RestMethod -Method Post -Headers @{ "x-functions-key" = "<function-key>" } http://localhost:7071/api/counters/smoke:counter/next
```

`func start` runs timer infrastructure too. Provide reachable `AzureWebJobsStorage` or Azurite for a clean local host run; otherwise HTTP endpoints may work while timer/storage health warnings appear.

## 5. Current Verification State

The current branch has been validated locally with:

- root `python build.py`;
- package zip hygiene invariants;
- backend TypeScript build and `node:test`;
- backend SQL integration against Docker SQL Server;
- local Functions HTTP smoke for `/api/health`, `/api/records`, and `/api/counters/{counterKey}/next`.

See `docs/PROJECT_STATE.md` and `backend/README.md` for the latest detailed state.

## 6. Main Documents

- `docs/GO_LIVE_RUNBOOK.md` - internal deployment and hardening checklist.
- `backend/README.md` - backend setup, migrations, endpoints, and local test steps.
- `docs/ARCHITECTURE.md` - browser/backend architecture.
- `docs/BUSINESS_RULES.md` and `docs/DECISIONS.md` - rules that should not be reversed casually.
- `docs/DATA_DICTIONARY.md` - generated field and collection dictionary.
- `docs/PHOENIX_DEVELOPER_NOTES.md` - detailed maintainer notes.

## 7. Firebase Note

Firebase/Firestore remains available for the demo build and as an optional future path only if IT explicitly reselects it. If that happens, the deployment docs and package settings must be updated together, and Firestore security rules must be reviewed and deployed before any live use.

Do not mix Firebase and SQL/API production paths casually. Choose one production architecture and keep the configuration, docs, identity model, and security controls aligned.
