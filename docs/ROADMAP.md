# Phoenix Procurement - Roadmap

Last reviewed: 2026-07-06

This roadmap organizes remaining work into milestones. It assumes the current modular source and generated single-file demo build remain the baseline.

## Milestone 0 - Continuity and release hygiene

Status: initial baseline completed on 2026-07-06; keep release hygiene ongoing.

Goal:

Create a stable development baseline before more features are added.

Dependencies:

- Current source folder.
- Current demo and production zip backups.

Scope:

- Git has been initialized in `F:\OneDrive\Documents\PP2`.
- The starting source, docs, dist file, build tools, package notes, and existing zip backups were committed as the baseline.
- The baseline was tagged as `baseline-2026-07-06`.
- Keep `AGENTS.md`, `PROJECT_STATE.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `ROADMAP.md`, and `BUSINESS_RULES.md` updated.

Acceptance criteria:

- `git status` shows a clean working tree after the baseline commit.
- Current docs are committed.
- Current zips are either committed intentionally or excluded with a documented backup policy.
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
- Test payment visibility versus payment creation for view-only roles.
- Test My Work item disappears after the source action is processed.
- Test production password mode in a staged build.

Acceptance criteria:

- No "Could not render this view" after switching entities and returning to a list view.
- Filter button remains visible when filter pane is open.
- View-only users cannot create payment requests.
- Stakeholders can request updates where allowed, but cannot edit restricted records.
- Processed My Work actions no longer show as unattended.
- Build passes after any fixes.

Validation:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' .\build.py
```

Manual browser validation is required until automated e2e tests exist.

## Milestone 2 - Automated regression checks

Status: planned.

Goal:

Reduce risk from the growing feature set.

Dependencies:

- Milestone 0.
- Milestone 1 issues fixed.

Scope:

- Add a minimal JavaScript test harness or Playwright smoke suite.
- Cover import classification.
- Cover role permissions for create/edit/payment/update-request actions.
- Cover order/shipment status lists.
- Cover GRN receipt model.
- Cover Data Quality warning calculations.
- Cover My Work computed action completion/snooze.
- Cover build invariants.

Acceptance criteria:

- A single command runs automated regression tests.
- CI or local pre-ship checklist includes tests.
- Permission-sensitive actions have explicit tests.

Validation:

To be defined after test framework selection. Until then:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' .\build.py
```

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

Status: planned, dependent on IT/data team.

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
- Restrict API key.
- Remove or disable demo purge in production.
- Test every role from the access grid.

Acceptance criteria:

- Each user logs in with individual credentials.
- Users cannot self-change role through URL or UI.
- Unknown role fails closed.
- Firestore rules block unauthorized writes even if the browser UI is bypassed.
- View-only roles cannot create payment requests or edit restricted records.

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
