# Phoenix Procurement - Architecture

Last reviewed: 2026-07-11

## Current technical stack

- Browser application written in plain JavaScript, HTML, and CSS.
- Modular source under `src/`.
- CSS in `styles/main.css`.
- HTML shell in `index.html`.
- Generated single-file HTML build through `build.py`.
- Firebase Web SDK loaded lazily from Google CDN when `APP_CONFIG.dataMode === 'firebase'`:
  - Firebase App
  - Firebase Auth
  - Cloud Firestore
- Demo mode uses Firestore as the current database.
- Production package generation now stages `APP_CONFIG.dataMode = 'api'`, which uses the internal SQL/API backend and does not load Firebase modules.
- No npm package, bundler, TypeScript, or framework is used.
- Python build tooling is used for concatenation, data dictionary generation, and invariant checks.
- Node is used by `build.py` for JavaScript syntax checking and the dependency-free
  local regression checks in `tools/regression_checks.js`.

## Source and build architecture

The source of truth is:

- `src/**/*.js`
- `styles/main.css`
- `index.html`
- `src/schema.js` for schema/data dictionary

The generated artifact is:

- `dist/phoenix-procurement-DEMO.html`

`build.py` performs the following:

1. Regenerates `docs/DATA_DICTIONARY.md` from `src/schema.js`.
2. Checks that the generated data dictionary is in sync.
3. Checks each JavaScript module with `node --check` when Node is available.
4. Inlines `styles/main.css` into `index.html`.
5. Inlines every module listed in `build.py` in the exact expected order.
6. Writes `dist/phoenix-procurement-DEMO.html`.
7. Runs structural, high-risk data-integrity, and package-hygiene invariants in `tools/check_invariants.py`.
8. Runs local role/security/data regression checks in `tools/regression_checks.js` when Node is available.

`tools/package.py` rebuilds the two approved full-snapshot zip packages after a green build. The demo package keeps the demo dist file. The production package stages a copy with production `APP_CONFIG` values and `dist/phoenix-procurement-PRODUCTION.html`. Package invariants reject generated dependencies, backend build output, local settings, secrets, and scratchpad artifacts inside the zips.

## Frontend architecture

The application uses a modular-but-global browser architecture. Each module is loaded as a `<script type="module">`, and cross-module APIs are exposed deliberately on `window`.

Important globals:

- `window.APP_CONFIG` - demo/production flags, data mode, internal API settings, and Firebase config for demo mode.
- `window.REF` - reference data, permissions, entities, statuses, document rules, ERP ownership.
- `window.__state` - live state, filters, active view, active entity, loaded data, officer/user.
- `window.__renderers` - view renderer registry.
- `window.PXUtils` - shared formatting, navigation, permissions, entity helpers, list helpers, export helpers, etc.
- `window.PXApiClient` - internal SQL/API adapter used only when `APP_CONFIG.dataMode === 'api'`.
- `window.PXStore` - central write path; delegates to Firestore in demo mode and the internal API adapter in API mode.
- `window.PXSchema` - declarative schema and data dictionary source.
- `window.PXOwnership` - ERP/Phoenix field ownership.
- `window.PXValidators` - validation layer.
- `window.PXPermissions` - record-aware permission layer.
- `window.PXWorkflows` - transition helpers.
- `window.PXDocuments` - document metadata and SharePoint-ready folder path logic.
- `window.PXWarehouse` - future Data Warehouse adapter contract.
- `window.PXProcFollowup` - procurement follow-up and risk engine.

UI structure:

- `src/bcStructure.js` applies the Business Central-style top navigation.
- `src/bcCardPage.js` renders order detail in a Business Central-style card page.
- `src/fastTab.js` supports FastTab interaction.
- `styles/main.css` contains the Phoenix Business Central theme layer.

List screens are progressively using:

- Card/table toggles through `PXView`.
- Card rendering helpers through `PXCards`.
- Business Central-like filter panes where applicable.
- Column manager and export controls on dense tables.

## Module architecture

Major foundation modules:

- `core.js` - APP_CONFIG, lazy Firebase/API data-mode setup, REF, state, navigation, utility helpers, subscriptions.
- `schema.js` - data dictionary source.
- `erpOwnership.js` - ownership rules and ERP field maps.
- `workflows.js` - status transition rules.
- `validators.js` - data validation.
- `permissions.js` - record-aware permission helpers.
- `apiClient.js` - inactive-by-default internal API snapshot/write adapter.
- `firestoreStore.js` - central writes, validation, permissions, audit, and Firestore/API delegation.
- `dataQuality.js` - record-health checks and working-day calculations.
- `procurementFollowup.js` - risk scoring, ageing, commitment, chase, ERP/DW exception checks.
- `documentService.js` - SharePoint-ready document folder metadata.
- `warehouseAdapter.js` - future Data Warehouse contract.
- `erpAdapter.js` - compatibility facade for older ERP UI calls.

Domain modules generally follow:

- `*.service.js` for data helpers and write orchestration.
- `*.render.js` for list/page rendering.
- `*.form.js` for create/edit forms.
- `*.detail.js` for detail screens.

Major domain folders:

- `src/modules/orders`
- `src/modules/shipments`
- `src/modules/payments`
- `src/modules/suppliers`
- `src/modules/reports`
- `src/modules/documents`

## Backend architecture

The browser application has two data modes:

- `firebase`: the demo path, using Firebase Auth/Firestore directly.
- `api`: the internal production package path, using the SQL/API backend through
  `PXApiClient` and never loading Firebase modules.

Current demo services used by the browser:

- Firebase Authentication
- Cloud Firestore

Current browser behaviour:

- In Firebase/demo mode, subscribes to Firestore collections with `onSnapshot`.
- In API/internal mode, loads one initial `/api/records` snapshot through
  `PXApiClient`, then polls `/api/records/heads` and reloads only changed
  collections.
- Writes through `PXStore` in both modes.
- Generates client-side reports, exports, and Excel/CSV artifacts.
- Reads Excel imports in the browser as a manual staging feed.

Backend v1 scaffold:

- Azure Functions v4, Node/TypeScript, using the `@azure/functions` v4 programming model.
- Package-managed backend dependencies in `backend/package.json`; the root browser app still has no package-managed frontend build.
- SQL Server access through `mssql`, configured by `SQL_CONNECTION_STRING` in `backend/local.settings.json` or environment variables.
- `GET /api/health` HTTP trigger checks SQL connectivity.
- `backend/db/001_init.sql` creates the first SQL tables for warehouse sync:
  - `orders`
  - `sync_exceptions`
  - `import_audit`
- `backend/db/002_kpi_indexes.sql` adds idempotent read indexes for order
  filters/KPIs, requested-receipt exposure, open sync exceptions, and latest
  import-audit lookup.
- `backend/db/004_operational_records.sql` adds the generic SQL operational record
  store used by browser API mode for orders, shipments, payment requests, documents,
  follow-ups, issues, update requests, contact logs, KPI snapshots, status logs, and
  system configuration.
- `backend/db/005_app_counters.sql` adds SQL-backed generated-reference counters
  used by API mode, starting with RFP numbering.
- SQL `orders` has a unique `(entity, order_id)` constraint to protect idempotent sync.
- Phoenix-owned operational state is represented separately from ERP/provenance columns so the sync upsert can preserve it.
- `backend/src/sources/dwSource.ts` reads fixture purchase orders, normalises them to the `PXWarehouse.ORDER_CONTRACT_FIELDS` shape, and applies backend classification.
- `backend/src/warehouse/classification.ts` ports the browser import-rule baseline and order-type rules for backend `function` / `orderType` derivation before SQL upsert.
- `backend/src/sync/purchaseOrderSync.ts` performs transactional ownership-safe upsert keyed by `(entity, order_id)`, updating ERP/provenance/classification columns only for existing rows and seeding Phoenix `status` only on new rows.
- `backend/src/functions/syncPurchaseOrders.ts` exposes `POST /api/sync/purchase-orders` for the fixture-backed WD sync.
- `backend/src/functions/syncPurchaseOrdersTimer.ts` registers a disabled-by-default timer stub controlled by `DW_SYNC_TIMER_ENABLED`.
- `backend/src/functions/orders.ts` exposes read-only `GET /api/orders` with function-key auth, typed parameterized filters, allowlisted sorting, and paginated SQL results for BI/future browser consumers.
- `backend/src/functions/kpis.ts` exposes read-only `GET /api/kpis` with function-key auth and order-only aggregations for BI/future browser consumers.
- `backend/src/functions/cycleTimeAnalytics.ts` exposes read-only `GET /api/analytics/cycle-time` with order-age bottleneck analytics and explicit coverage limits for unavailable workflow time-in-stage history.
- `backend/src/functions/otifRisk.ts` exposes read-only `GET /api/analytics/otif-risk` with an order-only early-warning proxy and explicit coverage limits for unavailable supplier/shipment/GRN history.
- `backend/src/functions/unclassifiedWorklist.ts` exposes read-only `GET /api/worklists/unclassified` for actionable sync exception rows.
- `backend/src/functions/orderAlertNotifications.ts` registers a disabled-by-default timer and a function-key preview endpoint for order-level requested-receipt/stale-sync notifications with repeat suppression.
- `backend/src/functions/records.ts` exposes function-key protected operational
  record routes for internal browser API mode, including collection-level reads
  with `top`/`skip`/`changedSince` and `GET /api/records/heads` for lightweight
  polling. Read routes require an active stored officer and return only collections
  readable by that officer's stored role.
- `backend/src/functions/counters.ts` exposes function-key protected atomic
  counters for generated references in internal browser API mode.
- `backend/src/operational/records.ts` implements the operational record allowlist,
  JSON record mapping, capped `status_log` reads, per-collection change heads,
  soft archive/restore, and stale-write guard over SQL Server.
- `backend/src/operational/orderMerge.ts` merges SQL ERP orders with Phoenix
  operational overlays for API-mode `/api/records` order reads. It derives
  ERP-owned fields from the connector field list, keeps Phoenix-owned overlay
  fields, strips ERP-owned values before order overlay writes, supports
  synthetic ERP-only order ids when the browser first edits an ERP-sourced order,
  and reports ERP-only, app-only, and value-mismatch reconciliation issues.
- `backend/src/operational/counters.ts` validates counter keys and increments
  `dbo.app_counters` with parameterized SQL.
- `backend/src/security/permissions.ts` mirrors the browser `REF.permissions`
  matrix, resolves roles from stored officer records, filters API-mode reads by
  collection/resource, redacts officer `email`/`authUid` for non-privileged reads,
  and fails closed for unknown roles or collections.
- `backend/src/security/validate.ts` enforces backend validation for high-risk
  API-mode writes, including required order fields, non-negative amounts, payment
  exposure versus linked order value, and unsafe document links.
- `backend/src/analytics/cycleTime.ts` computes order-only cycle and bottleneck metrics from SQL orders, grouped by officer, supplier, category, and function.
- `backend/src/analytics/otifRisk.ts` scores open orders that are not yet requested-receipt overdue using order-only signals such as near-due requested receipt, stale sync, long-open age, and missing classification.
- `backend/src/worklists/unclassified.ts` lists `sync_exceptions` rows for unclassified, unmapped-supplier, and currency-ambiguous worklists and emits suggested actions for the future admin UI.
- `backend/src/kpi/queries.ts` and `backend/src/kpi/shape.ts` contain the first read-side query/mapping layer. The order mapper omits `phoenix_data` and labels SQL `status` as `initialOperationalStatus`. KPI shape helpers include explicit coverage metadata for excluded shipment/payment/GRN-derived metrics.
- `backend/src/notifications/orderAlerts.ts` builds notification digests from SQL orders and records sent items in `dbo.notification_state` only after successful email delivery. `backend/src/notifications/graphClient.ts` contains the Microsoft Graph sendMail/Teams-channel adapter, configured only through environment/app settings.
- `backend/test/dwSource.test.ts` guards the backend field list against drift from `src/warehouseAdapter.js`.
- `backend/test/classification.test.ts` guards baseline rule drift against `src/importRules.js` and exercises canonical Phoenix, Seychelles Breweries, and Edena classifier cases.
- `backend/test/purchaseOrderSync.test.ts` guards grouping, initial status seeding, sync exception queueing, parameterized SQL shape, and the update-time ownership boundary.
- `backend/test/ordersRead.test.ts` and optional `backend/test/ordersRead.integration.test.ts` guard the F1a order-list endpoint, including sort injection rejection, pagination, read-only SQL shape, and live SQL pagination when `RUN_SQL_INTEGRATION=true`.
- `backend/test/kpisRead.test.ts` and optional `backend/test/kpisRead.integration.test.ts` guard the F1b KPI endpoint, including multi-currency spend buckets, MTTO, ageing, requested-receipt proxy handling, data-quality counts, coverage metadata, and read-only live SQL behaviour.
- `backend/test/orderAlerts.test.ts` and optional `backend/test/orderAlerts.integration.test.ts` guard F2 recipient routing, dry-run delivery, parameterized notification-state writes, repeat suppression, and live SQL alert selection when `RUN_SQL_INTEGRATION=true`.
- `backend/test/cycleTime.test.ts` and optional `backend/test/cycleTime.integration.test.ts` guard F3 threshold validation, no-write query structure, order-age/requested-receipt bottleneck metrics, and live SQL cycle analytics when `RUN_SQL_INTEGRATION=true`.
- `backend/test/otifRisk.test.ts` and optional `backend/test/otifRisk.integration.test.ts` guard F4 scoring, coverage metadata, no-write query structure, and live SQL early-warning selection when `RUN_SQL_INTEGRATION=true`.
- `backend/test/unclassifiedWorklist.test.ts` and optional `backend/test/unclassifiedWorklist.integration.test.ts` guard F5 allowlists, mapping, summaries, suggested actions, no-write query structure, and live SQL worklist selection when `RUN_SQL_INTEGRATION=true`.
- `backend/test/operationalRecords.test.ts` and optional `backend/test/operationalRecords.integration.test.ts` guard the API-mode operational record allowlist, CRUD, stale-write handling, archive, and restore paths.
- The same operational-record test files also guard API-mode counter key validation
  and live SQL counter increments.
- `backend/src/sql/client.ts` exposes `queryParams(sqlText, params)` and transaction-bound execution for parameterized SQL upserts.
- `docs/BACKEND_HANDOFF.md` is the current backend gate handoff and sequencing source.

Browser operating cadence views:

- `src/modules/reports/dailyControlRoom.js` composes existing browser engines into read-only Daily Control Room, Supplier Chase Plan, and Exception Workbench views.
- Daily Control Room reuses `PXManagementControls`, `PXProcFollowup`, and `__myWorkCompute` to provide a daily, weekly, and monthly operating cadence without creating new records.
- Daily Control Room also renders a read-only operating checklist that combines current control signals, target posture, owners, and drill-through actions for daily/weekly/monthly routines.
- Supplier Chase Plan groups open supplier acknowledgement, promise, response, cadence, and delivery-recovery actions by supplier and order.
- Exception Workbench surfaces Firestore-side classification, supplier mapping, ERP/DW, and import-history exceptions and links to existing supplier mapping, ERP reconciliation, import-rule, or order-detail remediation screens. It does not call the backend SQL worklist API yet.
- Management Pack includes an executive summary plus KPI target-variance guardrails built from the same `PXManagementControls` and `PXKpi` data, and exports those rows with the pack.

Planned backend/integration services:

- Data Warehouse/staging feed.
- Controlled sync/API service between Data Warehouse and the SQL/API backend.
- Microsoft Graph adapter for SharePoint uploads.
- Production identity/SSO service if Azure AD/OIDC/custom token path is chosen.

## Database architecture

Database:

- Demo/browser mode: Cloud Firestore.
- Internal API mode: SQL Server through the backend operational record API.

Collections in `src/schema.js`:

- `orders`
- `shipments`
- `payment_requests`
- `exports`
- `suppliers`
- `officers`
- `documents`
- `followups`
- `issues`
- `updateRequests`
- `contactLog`
- `kpiSnapshot`
- `status_log`
- `system_config`

Key concepts:

- `orders` is the operational spine. ERP-owned header fields and Phoenix-owned follow-up fields live together, with ownership controls.
- `shipments` are Phoenix-owned logistics records linked by `orderId`.
- `payment_requests` are Phoenix-owned RFP records linked by `orderId` and optional milestone.
- `orders.receipts[]` stores GRN control rows. GRNs can be order-level or shipment-linked.
- `documents` store metadata, status, links, and demo upload data.
- `followups`, `issues`, `updateRequests`, and `contactLog` support operational action flow.
- `system_config` stores shared configuration such as import rules, working calendars, and counters.
- `status_log` stores audit/change/import-history entries.

The browser schema source remains `src/schema.js`; field changes still require
validators, forms, renderers, and import/export logic to be updated. The generated
data dictionary is the persistent browser schema documentation.

The backend SQL schema is migration-based under `backend/db/`. The warehouse-sync
tables (`orders`, `sync_exceptions`, `import_audit`, `notification_state`) are
structured SQL tables. The API-mode browser store currently uses
`dbo.operational_records`, a collection allowlisted JSON record table with a SQL
`updated_at` stale-write token. This is a practical internal-server bridge until
IT confirms the final normalized operational schema and identity model.

## Authentication and authorization architecture

Authentication modes:

- Demo: `APP_CONFIG.demoMode = true`, `authMode = 'demo'`, `dataMode = 'firebase'`. Uses Firebase anonymous/demo flow and allows demo role switching.
- Internal production package: `APP_CONFIG.demoMode = false`, `authMode = 'internal'`, `dataMode = 'api'`. Uses local operator setup plus function-key/API perimeter controls until IT supplies the final identity model.
- Firebase password mode remains possible only if IT chooses that path again by setting `authMode = 'password'` and `dataMode = 'firebase'`.

Officer profile resolution in production mode:

1. `officers/{uid}` document.
2. First officer where `authUid == user.uid`.
3. First officer where `email == user.email`.

Authorization layers:

- `REF.permissions` is the resource/action matrix.
- `REF.viewAccess` controls hidden and view-only views.
- `PXUtils.can(resource, action)` checks the current role.
- `PXPermissions.can(action, record)` adds record-aware checks.
- `PXStore.assertWriteAllowed()` blocks create/update/archive/restore when the current role lacks write permission.
- Production mode fails closed for unknown roles/resources.

Important limitations:

- Client-side authorization is not enough for production. API mode now enforces
  the browser permission matrix again on operational write routes by resolving
  `x-phoenix-user` to the stored officer role, ignoring any client-sent role, and
  returning `403` when denied. Pilot/go-live still needs the IT-approved identity
  and gateway/backend policy so that `x-phoenix-user` itself is trusted. If
  Firebase is reselected, Firestore security rules must enforce the same access
  model server-side; role-aligned templates exist in `docs/FIRESTORE_RULES`.
- API-mode local operator setup is not a final enterprise identity control. It is for closed-environment testing only; pilot/go-live still needs IT-approved SSO, Windows-integrated access, APIM policy, or another server-side identity boundary.
- API-mode read routes now require the asserted local operator to resolve to an
  active stored officer row. Until IT supplies final identity, local test data must
  include officer records matching the operator codes testers use.

## API structure

Current backend HTTP API scaffold:

- `GET /api/health` in `backend/src/functions/health.ts`, anonymous, returns SQL connectivity status.
- `GET /api/orders` in `backend/src/functions/orders.ts`, function-auth, lists SQL orders with filters, allowlisted sorting, and pagination.
- `GET /api/kpis` in `backend/src/functions/kpis.ts`, function-auth, returns order-only KPI aggregations with an explicit coverage block for metrics not derivable from the SQL order store.
- `GET /api/analytics/cycle-time` in `backend/src/functions/cycleTimeAnalytics.ts`, function-auth, returns order-only cycle/bottleneck analytics with an explicit workflow-history coverage block.
- `GET /api/analytics/otif-risk` in `backend/src/functions/otifRisk.ts`, function-auth, returns an order-only OTIF early-warning proxy with explicit supplier/shipment/GRN coverage exclusions.
- `GET /api/worklists/unclassified` in `backend/src/functions/unclassifiedWorklist.ts`, function-auth, returns actionable sync exception worklist rows for future admin remediation screens.
- `GET /api/notifications/order-alerts/preview` in `backend/src/functions/orderAlertNotifications.ts`, function-auth, returns a dry-run summary of order alert digests without Graph delivery or sent-state writes.
- `GET /api/records`, `GET /api/records/heads`, `GET/POST /api/records/{collection}`, `PATCH /api/records/{collection}/{id}`, `POST /api/records/{collection}/{id}/archive`, and `POST /api/records/{collection}/{id}/restore` in `backend/src/functions/records.ts`, function-auth, provide the internal browser operational store.
- `GET /api/reconciliation/orders` in `backend/src/functions/orderReconciliation.ts`,
  function-auth, returns ERP-only, app-only, and ERP/Phoenix value-mismatch
  order issues for admin/manager reconciliation.
- `POST /api/counters/{counterKey}/next` in `backend/src/functions/counters.ts`,
  function-auth, provides atomic generated-reference counters for API mode.
- `POST /api/sync/purchase-orders` in `backend/src/functions/syncPurchaseOrders.ts`, function-auth, runs the fixture-backed purchase-order sync.

In API data mode, the browser calls `/api/records` through `PXApiClient`. The other
read APIs are currently BI/future-screen endpoints.

Internal JavaScript APIs are exposed as `window.PX*` services and `window.__*` bridges. Important examples:

- `PXStore.*` for writes.
- `PXWarehouse.*` for future warehouse integration contract.
- `PhoenixERP` facade in `erpAdapter.js` for compatibility.
- `PXPoImport.*` for Excel import.
- `PXXlsxReader.readWorkbook()` for browser XLSX reading.
- `PXDocuments.*` for document folder/path metadata.
- `PXProcFollowup.*` for control/risk calculations.

## Important services and dependencies

External:

- Firebase Web SDK CDN, Firebase Auth, and Cloud Firestore for demo/Firebase mode only.
- Internal SQL/API backend for production API mode.

Internal:

- `build.py`.
- `tools/gen_data_dictionary.py`.
- `tools/check_invariants.py`.
- `docs/FIRESTORE_RULES` templates.
- Backend-only package dependencies under `backend/`:
  - `@azure/functions`
  - `mssql`
  - `typescript`
  - package-managed Azure Functions Core Tools for local function hosting where install scripts are approved.

No third-party frontend package manager dependencies are currently declared.

## Integration architecture

Current integration:

- Manual Excel import from Navision/Business Central exports.
- Imported rows are treated as staging records and stamped with `integrationLayer`, `warehouseSource`, `warehouseRecordId`, `warehouseBatchId`, and warehouse timing fields.

Future integration:

- Navision / Business Central -> Data Warehouse/staging -> controlled sync/API service -> SQL/API backend.
- Browser must not directly access ERP or Data Warehouse.
- Sync may refresh ERP-owned and ERP-seeded fields only.
- Sync must not overwrite Phoenix-owned operational fields.
- Backend v1 starts the controlled sync/API side in `backend/` with SQL Server as the local development store and test target.

Document integration:

- Current app builds SharePoint-ready metadata and paths.
- Future Microsoft Graph adapter will create folders and upload/save files using those paths.

## Deployment architecture

Current demo deployment:

- Double-click or open `dist/phoenix-procurement-DEMO.html`.
- Can run over `file://` for demo/OneDrive sharing.
- Modular source can be served locally with `python -m http.server`.

Intended production deployment:

- Generate a production HTML build from the same source with demo mode disabled and API data mode enabled.
- Serve the static production HTML and `/api` backend from the approved internal local server or private Azure/VNet host.
- Use SQL Server through the backend; do not require Firebase in API data mode.
- Use IT-approved individual identity or corporate SSO before pilot/go-live. The current internal operator setup is temporary for closed-environment testing.
- Keep ERP and SharePoint integrations server-side.
