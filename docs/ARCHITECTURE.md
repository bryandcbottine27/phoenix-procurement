# Phoenix Procurement - Architecture

Last reviewed: 2026-07-06

## Current technical stack

- Browser application written in plain JavaScript, HTML, and CSS.
- Modular source under `src/`.
- CSS in `styles/main.css`.
- HTML shell in `index.html`.
- Generated single-file HTML build through `build.py`.
- Firebase Web SDK loaded from Google CDN:
  - Firebase App
  - Firebase Auth
  - Cloud Firestore
- Firestore is the current database.
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

- `window.APP_CONFIG` - demo/production flags and Firebase config.
- `window.REF` - reference data, permissions, entities, statuses, document rules, ERP ownership.
- `window.__state` - live state, filters, active view, active entity, loaded data, officer/user.
- `window.__renderers` - view renderer registry.
- `window.PXUtils` - shared formatting, navigation, permissions, entity helpers, list helpers, export helpers, etc.
- `window.PXStore` - central Firestore write path.
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

- `core.js` - Firebase setup, APP_CONFIG, REF, state, navigation, utility helpers, subscriptions.
- `schema.js` - data dictionary source.
- `erpOwnership.js` - ownership rules and ERP field maps.
- `workflows.js` - status transition rules.
- `validators.js` - data validation.
- `permissions.js` - record-aware permission helpers.
- `firestoreStore.js` - central writes, validation, permissions, audit.
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

The browser application remains independent of any custom backend and still uses
Firebase directly for current operational data. A new isolated backend scaffold
exists under `backend/` for the planned Data Warehouse connector.

Current production services used by the browser:

- Firebase Authentication
- Cloud Firestore

Current browser behaviour:

- Subscribes to Firestore collections with `onSnapshot`.
- Writes through `PXStore`.
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
- `backend/src/functions/orderAlertNotifications.ts` registers a disabled-by-default timer and a function-key preview endpoint for order-level requested-receipt/stale-sync notifications.
- `backend/src/analytics/cycleTime.ts` computes order-only cycle and bottleneck metrics from SQL orders, grouped by officer, supplier, category, and function.
- `backend/src/analytics/otifRisk.ts` scores open orders that are not yet requested-receipt overdue using order-only signals such as near-due requested receipt, stale sync, long-open age, and missing classification.
- `backend/src/kpi/queries.ts` and `backend/src/kpi/shape.ts` contain the first read-side query/mapping layer. The order mapper omits `phoenix_data` and labels SQL `status` as `initialOperationalStatus`. KPI shape helpers include explicit coverage metadata for excluded shipment/payment/GRN-derived metrics.
- `backend/src/notifications/orderAlerts.ts` builds read-only notification digests from SQL orders. `backend/src/notifications/graphClient.ts` contains the Microsoft Graph sendMail/Teams-channel adapter, configured only through environment/app settings.
- `backend/test/dwSource.test.ts` guards the backend field list against drift from `src/warehouseAdapter.js`.
- `backend/test/classification.test.ts` guards baseline rule drift against `src/importRules.js` and exercises canonical Phoenix, Seychelles Breweries, and Edena classifier cases.
- `backend/test/purchaseOrderSync.test.ts` guards grouping, initial status seeding, sync exception queueing, parameterized SQL shape, and the update-time ownership boundary.
- `backend/test/ordersRead.test.ts` and optional `backend/test/ordersRead.integration.test.ts` guard the F1a order-list endpoint, including sort injection rejection, pagination, read-only SQL shape, and live SQL pagination when `RUN_SQL_INTEGRATION=true`.
- `backend/test/kpisRead.test.ts` and optional `backend/test/kpisRead.integration.test.ts` guard the F1b KPI endpoint, including multi-currency spend buckets, MTTO, ageing, requested-receipt proxy handling, data-quality counts, coverage metadata, and read-only live SQL behaviour.
- `backend/test/orderAlerts.test.ts` and optional `backend/test/orderAlerts.integration.test.ts` guard F2 recipient routing, dry-run delivery, no-write query structure, and live SQL alert selection when `RUN_SQL_INTEGRATION=true`.
- `backend/test/cycleTime.test.ts` and optional `backend/test/cycleTime.integration.test.ts` guard F3 threshold validation, no-write query structure, order-age/requested-receipt bottleneck metrics, and live SQL cycle analytics when `RUN_SQL_INTEGRATION=true`.
- `backend/test/otifRisk.test.ts` and optional `backend/test/otifRisk.integration.test.ts` guard F4 scoring, coverage metadata, no-write query structure, and live SQL early-warning selection when `RUN_SQL_INTEGRATION=true`.
- `backend/src/sql/client.ts` exposes `queryParams(sqlText, params)` and transaction-bound execution for parameterized SQL upserts.
- `docs/BACKEND_HANDOFF.md` is the current backend gate handoff and sequencing source.

Planned backend/integration services:

- Data Warehouse/staging feed.
- Controlled sync/API service between Data Warehouse and Firestore.
- Microsoft Graph adapter for SharePoint uploads.
- Production identity/SSO service if Azure AD/OIDC/custom token path is chosen.

## Database architecture

Database: Cloud Firestore.

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

The database currently has no migrations folder. Schema changes are made by updating `src/schema.js`, validators, forms, renderers, and any import/export logic. The generated data dictionary is the persistent schema documentation.

## Authentication and authorization architecture

Authentication modes:

- Demo: `APP_CONFIG.demoMode = true`, `authMode = 'demo'`. Uses Firebase anonymous/demo flow and allows demo role switching.
- Production: `APP_CONFIG.demoMode = false`, `authMode = 'password'`. Uses Firebase Auth email/password and individual user credentials.

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

Important limitation:

- Client-side authorization is not enough for production. Firestore security rules must enforce the same access model server-side. Role-aligned templates exist in `docs/FIRESTORE_RULES`, and local regression checks guard the main rule assumptions, but the rules still need Firebase Rules Playground/emulator validation and deployment against the final production project.

## API structure

Current backend HTTP API scaffold:

- `GET /api/health` in `backend/src/functions/health.ts`, anonymous, returns SQL connectivity status.
- `GET /api/orders` in `backend/src/functions/orders.ts`, function-auth, lists SQL orders with filters, allowlisted sorting, and pagination.
- `GET /api/kpis` in `backend/src/functions/kpis.ts`, function-auth, returns order-only KPI aggregations with an explicit coverage block for metrics not derivable from the SQL order store.
- `GET /api/analytics/cycle-time` in `backend/src/functions/cycleTimeAnalytics.ts`, function-auth, returns order-only cycle/bottleneck analytics with an explicit workflow-history coverage block.
- `GET /api/analytics/otif-risk` in `backend/src/functions/otifRisk.ts`, function-auth, returns an order-only OTIF early-warning proxy with explicit supplier/shipment/GRN coverage exclusions.
- `GET /api/notifications/order-alerts/preview` in `backend/src/functions/orderAlertNotifications.ts`, function-auth, returns a dry-run summary of order alert digests without Graph delivery.
- `POST /api/sync/purchase-orders` in `backend/src/functions/syncPurchaseOrders.ts`, function-auth, runs the fixture-backed purchase-order sync.

No browser screen currently calls this backend API.

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

- Firebase Web SDK CDN.
- Firebase Auth.
- Cloud Firestore.

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

- Navision / Business Central -> Data Warehouse/staging -> controlled sync/API service -> Firestore.
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

- Generate a production HTML build from the same source with demo mode disabled and password auth enabled.
- Serve over HTTPS from an approved server/static host.
- Use a dedicated production Firebase project.
- Deploy reviewed Firestore security rules.
- Restrict Firebase API key to approved domains and APIs.
- Use individual user credentials or corporate SSO.
- Keep ERP and SharePoint integrations server-side.
