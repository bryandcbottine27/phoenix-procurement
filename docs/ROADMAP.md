# Phoenix Procurement - Roadmap

Last reviewed: 2026-07-06

This roadmap organizes remaining work into milestones. It assumes the current modular source and generated single-file demo build remain the baseline.

## Milestone 0 - Continuity and release hygiene

Status: initial baseline completed on 2026-07-06; keep release hygiene ongoing.

Goal:

Create a stable development baseline before more features are added.

Dependencies:

- Current source folder.
- Current demo and production package zips.

Scope:

- Git has been initialized in `F:\OneDrive\Documents\PP2`.
- The starting source, docs, dist file, build tools, package notes, and existing zip backups were committed as the baseline.
- Current packaging policy keeps only `Phoenix Procurement DEMO FULL.zip` and `Phoenix Procurement PRODUCTION FULL.zip` in the project root; old timestamped package zips have been removed.
- The baseline was tagged as `baseline-2026-07-06`.
- Keep `AGENTS.md`, `PROJECT_STATE.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `ROADMAP.md`, and `BUSINESS_RULES.md` updated.

Acceptance criteria:

- `git status` shows a clean working tree after the baseline commit.
- Current docs are committed.
- Only the two current package zips exist in the project root.
- `python build.py` passes.

Validation:

```powershell
git status --short --branch
$env:PATH='C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' .\build.py
```

## Milestone 1 - Stability and access regression

Status: next after Git baseline.

Goal:

Ensure the current app behaves correctly before new features continue.

Dependencies:

- Milestone 0.
- Demo data or representative test data.

Scope:

- Browser smoke test by entity: Phoenix, Seychelles Breweries, Edena.
- Test entity switching and view re-rendering.
- Test Business Central-style filter pane remains accessible after opening/closing.
- Test dashboard Role Center per entity.
- Test order detail/card page.
- Test shipment detail and shipment GRN linkage.
- Test shipment integrity guards: duplicate shipment references blocked, status required, received result requires a GRN date or linked GRN, and order-level GRN links cannot point to another order's shipment.
- Test payment visibility versus payment creation for view-only roles.
- Test milestone schedules with rounding-sensitive percentages and confirm the forecast/RFP prefill reconciles to the PO amount.
- Test My Work item disappears after the source action is processed.
- Test production password mode in a staged build.

Acceptance criteria:

- No "Could not render this view" after switching entities and returning to a list view.
- Filter button remains visible when filter pane is open.
- View-only users cannot create payment requests.
- Stakeholders can request updates where allowed, but cannot edit restricted records.
- Ready-without-shipment alerts do not appear until the shared 2-working-day grace period has passed.
- Received orders with order-level or shipment-linked GRNs do not remain in Awaiting/Overdue list filters.
- Processed My Work actions no longer show as unattended.
- Build passes after any fixes.

Validation:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' .\build.py
```

Manual browser validation is required until automated e2e tests exist.

## Milestone 2 - Automated regression checks

Status: initial local harness completed; broader browser/e2e coverage remains planned.

Goal:

Reduce risk from the growing feature set.

Dependencies:

- Milestone 0.
- Milestone 1 issues fixed.

Scope:

- Add a minimal JavaScript test harness or Playwright smoke suite.
- Cover role permissions for create/edit/payment/update-request actions. Initial local coverage is in `tools/regression_checks.js`.
- Cover production fail-closed role behaviour, Firestore rule drift assumptions, payment approval routing, and validator guardrails. Initial local coverage is in `tools/regression_checks.js`.
- Cover import classification. Initial local coverage is in `tools/regression_checks.js`.
- Cover order/shipment status lists.
- Cover GRN receipt model.
- Cover Data Quality warning calculations. Initial local ready/no-shipment and working-day coverage is in `tools/regression_checks.js`.
- Cover My Work computed action completion/snooze. Initial local ready/no-shipment and processed-follow-up disappearance coverage is in `tools/regression_checks.js`; snooze and rendered browser behaviour still need e2e coverage.
- Cover build invariants.

Acceptance criteria:

- A single command runs automated regression tests. Initial command is the normal `build.py` validation.
- CI or local pre-ship checklist includes tests.
- Permission-sensitive actions have explicit tests.

Validation:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' .\build.py
```

Remaining gap: browser/e2e coverage is still needed for rendered UI flows, role walkthroughs, snooze behaviour, and cross-view smoke testing.

## Milestone 3 - SharePoint document adapter

Status: on hold until IT provides Microsoft 365 details.

Goal:

Move from metadata/link/demo upload to real SharePoint document storage.

Dependencies:

- IT confirms SharePoint site URL and document library.
- IT confirms Entra app registration and Graph permissions.
- IT confirms upload/delete/rename/retention rules.
- Current `PXDocuments` folder structure remains stable.

Scope:

- Microsoft Graph authentication design.
- Folder creation:
  - `<PO No.> - <Supplier Name>`
  - `PO`
  - `Shipping Documents/<Shipment Ref>`
  - `Payment`
  - `GRN`
- Upload file to correct folder.
- Save SharePoint URL, drive item id, folder path, document type, status, and linked record.
- Remove or disable base64 demo upload for production.
- Add retry/error handling and visible upload failure messages.

Acceptance criteria:

- Uploading a PO document creates/stores it in the expected PO folder.
- Uploading a shipment document stores it under the matching shipment subfolder.
- Uploading payment and GRN documents stores them under correct folders.
- App records a usable SharePoint link.
- Failed uploads do not create misleading successful document records.

Validation:

- Build passes.
- Manual upload tests against IT-approved test SharePoint site.
- Confirm permissions from a non-admin user.

## Milestone 4 - Data Warehouse/API integration design

Status: Backend v1 Gate 2 complete; Gate 1 was locally runtime-proven against Docker SQL Server, and Gate 2 fixture source/mapping tests are green. Still dependent on IT/data team for real Data Warehouse and production SQL environment.

Goal:

Replace manual Excel import with controlled staging sync.

Dependencies:

- Data Warehouse tables/views confirmed.
- Stable purchase order row contract agreed.
- Sync identity/service account approved.
- Field ownership rules signed off.

Scope:

- Finalize PO staging contract based on `PXWarehouse.ORDER_CONTRACT_FIELDS`.
- Define changed-record detection using `warehouseHash` or batch timestamp.
- Define create/update reconciliation flow.
- Define error and retry logging.
- Define batch audit history.
- Decide whether sync writes directly to Firestore or through an API service.
- Preserve Phoenix-owned operational data.
- Scaffolded `backend/` Azure Functions v4 TypeScript project with SQL Server DDL for local development.
- Gate 1 backend DDL includes SQL `orders`, `sync_exceptions`, and `import_audit`.
- Gate 2 adds fixture-backed `dwSource.fetchPurchaseOrders()`, backend purchase-order normalisation, and a drift-guard test against `src/warehouseAdapter.js`.
- Cleanup pass adds durable backend handoff documentation, formal full-snapshot packaging, zip-content invariants, scratchpad removal, a parameterized SQL helper, and local-dev SQL certificate guidance.
- Gate 3a adds backend `function` and `orderType` classification, including a drift guard against `src/importRules.js` and canonical Phoenix/Seychelles/Edena unit tests.
- Gate 3b adds ownership-safe transactional SQL upsert, `sync_exceptions` queueing, per-batch `import_audit`, HTTP sync trigger, disabled timer stub, and unit tests for grouping/ownership/parameterization.
- Gate 3b.1 tightens the sync path with typed decimal money bindings, case-insensitive ERP PO status mapping drift-guarded against `src/core.js`, `UNCLASSIFIED` exception codes, and failed-audit logging.
- Gate 4 adds SQL integration tests for create, idempotent re-run, ownership preservation, malformed/unclassified exceptions, decimal precision, lowercase status mapping, line grouping, plus README run-local and real SQL/Data Warehouse swap points.
- F1a adds read-only `GET /api/orders` with typed parameterized filters, allowlisted sorting, pagination, function-key auth, and SQL integration-ready tests.
- F1b adds read-only `GET /api/kpis` with order-only counts, multi-currency spend buckets, MTTO, ageing, requested-receipt proxy exposure, data-quality counts, latest sync metadata, explicit coverage exclusions, function-key auth, and SQL integration-ready tests.
- Next backend gate: F1c endpoint README/Power BI notes and optional read indexes.
- Gate 3 SQL upsert must be parameterized through `mssql` request inputs for every external value; no warehouse/fixture/user value may be interpolated into SQL text.

Acceptance criteria:

- Warehouse feed can create a new PO without overwriting Phoenix-owned fields.
- Warehouse feed can update ERP-owned fields on an existing PO.
- Changed amount/currency/requested receipt date appears in reconciliation for officer review.
- Supplier mapping still uses vendor code first.
- Sync failures are visible to admins/managers.

Validation:

- Build passes.
- Import/sync test with representative Phoenix, Seychelles, and Edena rows.
- Reconciliation report reviewed by business owner.
- Backend gate validation additionally requires a SQL Server LocalDB or Docker SQL Server instance plus Azure Functions Core Tools. If SQL is not available, backend integration tests are code-reviewed but not runtime-proven.

## Milestone 5 - Production authentication and security

Status: required before pilot/production outside the test environment.

Goal:

Replace demo access with real user identity and server-side access control.

Dependencies:

- IT chooses Firebase email/password or Azure AD/M365 SSO path.
- Dedicated production Firebase project.
- Officer records populated with correct roles and emails/auth UIDs.

Scope:

- Configure production Firebase project.
- Set `APP_CONFIG.demoMode = false`.
- Set `APP_CONFIG.authMode = 'password'` or corporate SSO equivalent.
- Deploy and test Firestore rules.
- Use the role-aligned authenticated template in `docs/FIRESTORE_RULES/firestore.rules.authenticated`.
- Restrict API key.
- Remove or disable demo purge in production.
- Test every role from the access grid.

Acceptance criteria:

- Each user logs in with individual credentials.
- Users cannot self-change role through URL or UI.
- Unknown role fails closed.
- Firestore rules block unauthorized writes even if the browser UI is bypassed.
- View-only roles cannot create payment requests or edit restricted records.
- A production officer profile with no role or an unknown role receives no write access and no direct-view navigation access.

Validation:

- Build passes.
- Firebase Rules Playground tests.
- Manual role-by-role access test using `docs/ACCESS_CHECKLIST.md`.

## Milestone 6 - Pilot data and operational readiness

Status: planned.

Goal:

Prepare realistic pilot use with copied/controlled ERP data.

Dependencies:

- Milestone 1.
- Either manual Excel import or warehouse pilot feed.
- Production-like Firebase/staging environment.

Scope:

- Import representative Phoenix, Seychelles, and Edena data.
- Seed officers, suppliers, working calendars, and import rules.
- Backfill KPI history if required.
- Verify Data Quality and Exceptions boards.
- Verify My Work for procurement, logistics, finance, demand/stakeholder roles.
- Confirm closed order/archive behaviour.

Acceptance criteria:

- Pilot users can perform daily follow-up without developer assistance.
- Import/reconciliation results are explainable.
- Management cockpit and reports reflect current operational state.
- Known limitations are signed off.

Validation:

- Build passes.
- Pilot Test Pack scenarios in `docs/PILOT_TEST_PACK.md`.
- Business owner sign-off.

## Milestone 7 - Production go-live

Status: future.

Goal:

Deploy securely for real operational use.

Dependencies:

- Milestones 0 through 6.
- IT approval.
- Business process owner approval.

Scope:

- Deploy production HTML over HTTPS.
- Use production Firebase project.
- Confirm security rules and backups.
- Confirm document storage decision.
- Confirm ERP/data feed decision.
- Train users.
- Freeze feature changes during go-live window.

Acceptance criteria:

- Go-live checklist in `docs/GO_LIVE_RUNBOOK.md` completed.
- Backup/export captured before opening to users.
- Support owner and escalation route identified.
- Rollback plan exists.

Validation:

- Production build smoke test.
- Role-by-role access test.
- Firestore rules test.
- Backup restore drill, if required by IT.
