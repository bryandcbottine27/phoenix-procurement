# Phoenix Procurement - Project State

Last reviewed: 2026-07-11

## Current application status

Phoenix Procurement is an operational procurement and logistics control tower for Phoenix Beverages and group companies. It is a browser application with modular source in `src/`, styles in `styles/main.css`, an HTML shell in `index.html`, and a generated single-file demo build at `dist/phoenix-procurement-DEMO.html`. Demo mode uses Firebase/Firestore; the production package is now staged for internal SQL/API mode.

The current source is modular, but the delivered user artifact remains one clean generated HTML file for demo use. The production package is generated from the same source with `APP_CONFIG.demoMode = false`, `APP_CONFIG.authMode = 'internal'`, and `APP_CONFIG.dataMode = 'api'`.

Current active entities:

- Phoenix
- Seychelles Breweries
- Edena

Current ERP/integration posture:

- Phoenix currently uses Navision.
- Seychelles Breweries uses Business Central.
- Edena is supported through the Business Central-style Excel import path.
- Phoenix is expected to move to Business Central later.
- The approved future integration path is ERP -> Data Warehouse/staging -> controlled sync/API service -> Phoenix Procurement. The browser must not connect directly to Navision, Business Central, or the Data Warehouse.

Important continuity note: this folder is now a Git repository. The starting handover state was committed as `8b0618d` and tagged `baseline-2026-07-06` before follow-up fixes were made. Package history should be kept in Git, not by accumulating timestamped zip backups. The project root should contain only the two current package files: `Phoenix Procurement DEMO FULL.zip` and `Phoenix Procurement PRODUCTION FULL.zip`.

## Completed modules and features

Core application foundation:

- Modular JavaScript source tree with 64 source modules.
- Single-file build via `build.py`.
- Business Central-style top navigation, list pages, card pages, FastTabs, filter panes, and Phoenix colour theme.
- Three-entity handling with active entity switcher.
- Central reference data in `REF` inside `src/core.js`.
- Central state and navigation via `window.__state`, `window.__renderers`, and `PXUtils`.
- Central data dictionary source in `src/schema.js`.
- Generated `docs/DATA_DICTIONARY.md`, currently 358 fields across schema.
- Build-time invariant checks in `tools/check_invariants.py`, including structure, status-map, pre-test data-integrity, and package-zip hygiene checks.
- JavaScript syntax gate through Node `--check` in `build.py`.
- Local regression checks in `tools/regression_checks.js`, run by `build.py`, covering critical role permissions, production fail-closed access, Firestore rule drift, payment approval routing, validator guardrails, ERP import classification, Data Quality timing, and My Work computed actions.

Data and write control:

- Central browser write path in `src/firestoreStore.js` through `PXStore.createRecord`, `updateRecord`, `archiveRecord`, `restoreRecord`, and `logStatusChange`.
- Internal API data mode in `src/apiClient.js`; when `APP_CONFIG.dataMode === 'api'`, `PXStore` routes normal business writes to the backend operational record API instead of Firestore. The browser loads one initial `/api/records` snapshot, then uses `/api/records/heads` to refetch only collections whose SQL head changed. Backend read routes require the local operator code to resolve to an active stored officer and return only collections readable by that stored role.
- Validation gate in `src/validators.js`.
- Field ownership rules in `src/erpOwnership.js`.
- Workflow/status-transition helpers in `src/workflows.js`.
- Role and record-aware permission helpers in `src/permissions.js`.
- Optimistic concurrency support on selected writes through `expectedUpdatedAt`.
- Soft archive/restore for normal business records.
- Demo-only full data purge, guarded to demo/admin only, remains the only intentional hard-delete flow.

Procurement and order control:

- Foreign and local order streams by function: Technical, Indirect, Supply Chain.
- Business Central-style order detail/card page.
- Order form reorganized into operational sections.
- Supply Chain item rows for per-item detailed description and quantity.
- ERP-owned/read-only versus Phoenix-owned/editable field handling.
- Planned-versus-actual timeline fields and editor.
- Order amendments and claims arrays on orders.
- PO line/receipt control present as a control surface without duplicating the full ERP item-line process.
- GRN control through `orders.receipts[]`, with order-level and shipment-linked GRN rows.

Logistics and shipment control:

- Inbound shipment module with service/render/form/detail files.
- Shipment sequencing format such as `FPO12345 (S1)`, `FPO12345 (S2)`.
- Partial/balance/replacement shipment control fields.
- Shipment status list aligned to logistics flow.
- Delivery date at shipment level with GRN fallback for receipt timing.
- One or multiple GRNs per shipment through linked order receipts.
- Container tracker with demurrage/detention exposure.
- Shipment journey view and document-readiness checklist.
- Exports/Outbound module for one-way and round-trip movements.
- TEPS tax provision forecast and actual landed cost variance.

Finance and payment control:

- Payment requests/RFP module with per-entity RFP reference numbering.
- Milestone-driven forthcoming payments forecast.
- Payment schedule on orders with milestone statuses.
- Percentage-generated milestone amounts reconcile to the order total by assigning rounding remainder to the final milestone when percentages total 100%.
- Payment detail and printable RFP.
- Payment request write permissions enforced through `PXStore` and UI permission checks.
- Payment approval-only updates now pass `payments:approve` through `PXStore`, so approve-only roles are not blocked by the generic edit permission check.
- View-only users can view payments but should not be able to create payment requests.

Operational follow-up:

- My Work cross-entity action queue.
- My Day toggle.
- Snooze support for computed actions.
- Ready-without-shipment warnings use a shared 2-working-day grace period across Data Quality, My Work, and procurement follow-up risk scoring.
- Contact log collection and log-a-chase flow.
- Update Requests flow from order and shipment rows/details.
- Data Quality Cockpit.
- Exceptions board.
- Procurement follow-up engine in `src/procurementFollowup.js`.
- Working-day calculations using entity working calendars.

Reference, reports, and controls:

- Supplier master with aliases, ERP mappings, contacts, supplier rating, and supplier scorecard support.
- Supplier mapping worklist and guarded supplier bootstrap from ERP vendor codes.
- Officers & Roles under System Settings.
- ERP Reconciliation under System Settings.
- ERP Import Rules and Working Calendars under System Settings.
- Reports & Export, Daily Control Room, Supplier Chase Plan, KPI Trends, OTIF Risk Forecast, Officer Workload, Operational Calendar, Management Pack, Exception Workbench, Exceptions, Data Quality, Supplier Scorecards.
- Management Cockpit reorganized as a control entry point, with the Daily Control Room now acting as the operating cadence view for daily, weekly, and monthly routines.
- Daily Control Room includes a read-only operating checklist for daily, weekly, and monthly controls, with current signal counts, target posture, and drill-through actions.
- Management Pack includes an executive summary, KPI target-variance rows, and export rows for weekly/monthly review, not only detailed exception lines.

Document handling:

- Documents module and document cabinet.
- SharePoint-ready folder path metadata through `PXDocuments`.
- Logical folder structure supports:
  - `<PO No.> - <Supplier Name>` parent folder
  - `PO`
  - `Shipping Documents`, with shipment subfolder when document is shipment-linked
  - `Payment`
  - `GRN`
- Current implementation records metadata, links, status, and small demo upload data. It does not yet upload to SharePoint through Microsoft Graph.

ERP import:

- No-library browser XLSX reader.
- Manual Excel import treated as a staging feed.
- Phoenix Navision FPO/LPO handling.
- Seychelles Breweries Business Central import handling.
- Edena Business Central import handling with EUR local-currency rule.
- Entity/function classification through import rules.
- Supplier mapping by vendor code first, then name/alias fallback.
- Import preview, create/update split, supplier mapping warnings, and structured import history.

Authentication and access:

- Demo build uses demo/anonymous mode.
- Production package is staged for internal API mode with a temporary local operator setup while IT confirms the final SSO/identity perimeter.
- Officer profile lookup supports Auth UID document id, `authUid`, and `email`.
- Demo role switching is ignored in production mode.
- Production permission posture fails closed for unknown roles/resources and for production officer profiles with no assigned role.

## Partially completed work

- SharePoint integration is metadata-ready only. Folder path rules exist, but Microsoft Graph upload, folder creation, delete/rename policy, and permission inheritance are not implemented.
- Data Warehouse integration is partly scaffolded only. `PXWarehouse` defines the browser-side target shape and still returns "not connected"; the current manual operational feed remains Excel import. The isolated `backend/` Backend v1 scaffold now includes Azure Functions v4, TypeScript, `mssql`, SQL Server DDL, fixture-backed `dwSource.fetchPurchaseOrders()`, purchase-order normalisation, classification for `function` and `orderType`, an ownership-safe SQL upsert service with typed decimal money bindings and `UNCLASSIFIED` exception codes, `POST /api/sync/purchase-orders`, read-only `GET /api/orders`, read-only order-only `GET /api/kpis`, read-only `GET /api/analytics/cycle-time`, read-only order-only `GET /api/analytics/otif-risk`, read-only `GET /api/worklists/unclassified`, F1 read-index migration, disabled-by-default Graph notification scaffolding with a dry-run preview endpoint and SQL `notification_state` repeat suppression, `dbo.operational_records` plus function-key `/api/records` and `/api/records/heads` routes for browser API mode, full merged SQL ERP order plus Phoenix operational overlay reads, order-overlay writes that strip ERP-owned fields, `GET /api/reconciliation/orders`, role-filtered reads with officer PII redaction, non-order collection-level `top`/`skip`/`changedSince` reads with capped `status_log`, and `dbo.app_counters` plus `/api/counters/{counterKey}/next` for API-mode generated references such as RFP numbers. It has drift/unit/SQL integration tests against `src/warehouseAdapter.js`, `src/importRules.js`, the sync ownership boundary, the F1a order-list API, the F1b KPI API, F2 order-alert query/routing/suppression, F3 order-age bottleneck analytics, the F4 OTIF early-warning proxy, the F5 sync-exception worklist API, order-store merge/reconciliation behavior, the operational record/counter API, and a closed-environment sync-to-records E2E flow. It is not yet connected to a real warehouse feed.
- Firestore security rule templates exist under `docs/FIRESTORE_RULES` for the optional Firebase path. The authenticated template has been tightened to mirror the main app permission matrix and local regression checks guard the highest-risk assumptions, but Firebase is not the current default production path.
- Production package generation exists through `tools/package.py` and the two approved zip outputs. It now stages internal SQL/API mode by default; production hosting, backend URL/function-key policy, final identity/SSO, TLS/certificates, and service accounts remain IT tasks.
- Visual smoke testing is limited by local Firebase/auth/network behaviour in the desktop browser environment. The built demo was opened through localhost in an earlier handover pass and the initial login shell rendered with the then-current module set and no console warnings/errors; authenticated dashboard/role/entity walkthroughs should still be repeated before demo using an approved seeded profile or tester login.
- Access grid documentation exists, but the role matrix is broad and should be re-tested after every access-sensitive change.
- Edena import/export support exists in the code path, but it needs business pilot validation with real Edena export samples before it should be considered production-proven.

## Features planned but not started or not production-ready

- Real Data Warehouse/API sync feed and final normalized SQL operational schema.
- Microsoft Graph SharePoint upload adapter.
- Azure AD / Microsoft 365 SSO or final corporate identity integration.
- Production internal HTTPS hosting, function-key/APIM policy, and server-side identity enforcement.
- Automated end-to-end browser regression suite.
- Broader formal unit/integration tests for permissions, data quality, My Work computed actions, and backend sync behaviour beyond the current local regression and backend unit coverage.
- Server-side audit/reporting pipeline, if required by IT.

## Current known bugs and limitations

- The root browser app still has no package-managed frontend build, lint, or TypeScript configuration. Backend v1 now has its own `backend/package.json`, TypeScript build, package-managed Azure Functions Core Tools dependency, `mssql`, SQL DDL migration scaffold, fixture source adapter, classifier, transaction-bound parameterized SQL helper, ownership-safe sync service, read-only order-list/KPI/analytics/worklist APIs, operational record API, and `node:test` coverage. Current browser validation remains Python build, generated data dictionary check, Node syntax checks, invariant checks for structure/status maps/pre-test data-integrity/package zip hygiene, and local Node regression checks for permission/security/import/Data Quality/My Work contracts.
- Local backend runtime proof is environment-dependent, but Backend v1 has been proven locally against Docker SQL Server in this Codex desktop environment. Bundled Node/pnpm and package-managed Azure Functions Core Tools are available; SQL Server LocalDB, `sqlcmd`, and global Azure Functions Core Tools are not installed. Validation used Docker SQL Server on `localhost:14333`, applied `backend/db/001_init.sql` through `backend/db/006_order_merge_indexes.sql` twice idempotently, returned a healthy `/api/health` SQL response in prior runtime smoke, executed `/api/records` and `/api/counters/{counterKey}/next` through the local Functions host in prior runtime smoke, and executed backend SQL integration tests with no skips. A full local Functions host still needs reachable `AzureWebJobsStorage` or Azurite to avoid timer/storage health warnings.
- Browser/client-side permission checks are not sufficient for production security. API mode now has backend operational-record read and write gates that resolve `x-phoenix-user` to the stored officer role, filter readable collections, redact non-privileged officer PII, and re-enforce the permission matrix plus record validation server-side. Final pilot/go-live still needs IT-owned identity and gateway/API policy so the asserted user header is trusted and cannot be spoofed.
- Demo mode still contains demo aids such as role switching. The guarded demo purge code remains for isolated reset testing, but `REF.demoResetEnabled` is disabled by default and must stay disabled for shared testing, pilot, and production builds.
- SharePoint upload is not live; documents are metadata/link/demo-upload records only.
- Data Warehouse sync is not connected to the real warehouse yet; Excel import remains the current manual staging feed.
- API mode uses a generic SQL JSON operational record table as an internal-server bridge for Phoenix-owned operational overlays. It is suitable for closed-environment testing, and now avoids routine full-store reloads by capping `status_log`, exposing collection heads, and refetching changed collections only. Orders are the exception to a pure JSON read: `/api/records` merges SQL ERP order rows with Phoenix overlays so ERP-owned fields come from `dbo.orders` and operational fields come from `dbo.operational_records`. A future normalized SQL operational schema may still be required for long-term reporting/governance.
- Graph notification delivery is scaffolded but disabled by default. It requires IT-provided Graph app registration, Azure app settings/Key Vault secrets, and a recipient map. Sent alert items are recorded in backend SQL `notification_state` after successful email delivery so repeated digest items are suppressed for `ORDER_ALERTS_REPEAT_SUPPRESSION_HOURS` (24 hours by default).
- Backend cycle-time analytics are order-only. True workflow time-in-stage, stage-transition bottlenecks, and officer stage-SLA analytics require migration of browser `status_log` / workflow transition history into SQL.
- Backend OTIF early warning is an order-only proxy. Supplier historical delay, supplier promise revision counts, shipment stage, GRN outcome, and true OTIF prediction require additional datasets or approved browser-side `PXProcFollowup` work.
- Backend unclassified/unmapped worklist support is read-only. A browser-side Exception Workbench now surfaces Firestore import/classification/supplier-mapping exceptions and links to existing remediation screens, but one-click backend add-rule/map-supplier/resolve-currency actions still require final write-design decisions.
- Large generated single HTML is expected. Do not edit it by hand.
- Some older docs may describe prototype history; the new continuity docs should be treated as the primary handover map.

## Immediate next development priorities

1. Browser-test the pre-testing stability fixes: demo purge hidden/blocked, duplicate shipment ID blocked, blank shipment status blocked, receipt result requiring GRN date/link, ready-without-shipment grace period, milestone amount reconciliation, and order Awaiting/Overdue filters after GRN.
2. Repeat a visual smoke test of dashboard, entity switching, filter pane, order detail, shipment detail, Exports/Outbound, KPI Trends capture/backfill, payment permissions, and production API-mode login/setup.
3. Re-test access rules in the browser for view-only users, especially payment request creation, exports, KPI capture, update request visibility, and GRN entry through orders versus shipments.
4. Extend automated checks further into browser/e2e smoke coverage once a test runner/environment is selected.
5. Confirm the IT identity/API hosting design, then decide the next delivery tranche: SharePoint adapter design, real Data Warehouse connection, normalized SQL operational schema, or operational feature polishing.

## Current validation baseline

Last local validation during this handover pass:

- `python build.py` with bundled Node/Python: passed.
- Data dictionary regenerated and checked: passed.
- Structural invariants: passed.
- Pre-test data-integrity invariants and approved package-zip hygiene checks: passed.
- Local role/security/import/Data Quality/My Work regression checks plus Daily Control Room/Supplier Chase/Exception Workbench structural checks: passed.
- Localhost browser shell smoke of the modular source: passed for the new navigation entries and view containers with no console errors; full authenticated dashboard walkthrough was not performed from this session to avoid creating/submitting a new Firebase demo profile.
- JavaScript syntax check for all 64 modules: passed.
- Backend `pnpm test` with Docker SQL integration (`RUN_SQL_INTEGRATION=true`) passed: 75 pass, 0 skipped.
- Demo build output generated: `dist/phoenix-procurement-DEMO.html`.
- Isolated staged production build with `demoMode: false`, `authMode: 'internal'`, and `dataMode: 'api'`: passed.
- Demo and production zip packages refreshed with these handover docs included:
  - `Phoenix Procurement DEMO FULL.zip`
  - `Phoenix Procurement PRODUCTION FULL.zip`
- The refreshed demo package includes source/docs/tools plus only `dist/phoenix-procurement-DEMO.html` under `dist`.
- The refreshed production package includes source/docs/tools plus only `dist/phoenix-procurement-PRODUCTION.html` under `dist`.
- Both refreshed packages are full snapshots and intentionally include backend source, fixtures, and tests, while excluding `node_modules`, `backend/dist`, local settings, secrets, and scratchpad artifacts.
- No timestamped or `pre-*` package zip files should be kept in the project root.

No separate lint, type check, package-managed unit test, migration, Firebase emulator, or Firebase rules validation command exists in the repository at this time.
