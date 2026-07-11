# Backend V1 Handoff - Azure Functions + SQL Server WD Connector

This document is the durable handoff for the additive backend work on branch
`feat/backend-wd-connector`.

## 0. Context

Phoenix Procurement is adding a separate backend under `backend/` for a
private-Azure, VNet-isolated, no-Firebase production environment.

Backend stack:

- Azure Functions v4
- Node.js / TypeScript
- SQL Server through `mssql`

First backend capability:

Data Warehouse rows, represented by mock fixtures for now, are fetched,
normalised, classified, and then ownership-safely upserted into SQL Server.

Review status:

- Gate 1: scaffold, SQL DDL, migration, and `/api/health` - done and reviewed.
- Gate 2: fixture-backed `dwSource.fetchPurchaseOrders()`, mapping, and contract
  drift guard - done and reviewed.
- Commit `6bf3b0d` (`Extend stale-write guards and follow-up coverage`) - reviewed
  pass, no remaining Codex action.

## 1. Non-Negotiables

Every backend gate must preserve these constraints:

- Browser untouched: no `src/` changes unless a later, explicit gate approves it.
- Root `python build.py` must stay green.
- `backend/` must remain invisible to the browser build path.
- Connector writes ERP-owned fields, provenance, and derived `function` /
  `order_type` only.
- Connector must never overwrite `status`, `is_closed`, or `phoenix_data`.
- Idempotency is enforced by the SQL `(entity, order_id)` unique index.
- Re-runs update existing rows in place and must not create duplicates.
- All SQL that receives warehouse, fixture, or user-provided values must use
  parameterized `mssql` requests.
- No secrets are committed.
- Every commit on `feat/backend-wd-connector` must include:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## 2. Cleanup Pass

Do this before Gate 3:

- C0: create this `docs/BACKEND_HANDOFF.md` file.
- C1: remove the committed root scratchpad file with the mangled
  `scratchpadall_functions.txt` name, and add a root `.gitignore` rule so it
  cannot return.
- C2: formalise full-snapshot packaging:
  - `Phoenix Procurement DEMO FULL.zip`
  - `Phoenix Procurement PRODUCTION FULL.zip`
  - Both zips include the whole project snapshot: browser source, env-appropriate
    `dist/`, backend source, docs, tools, `build.py`, `AGENTS.md`, and `README.md`.
  - Backend source inside zips is intended.
  - Exclude only generated dependencies/build output and sensitive local files:
    `node_modules/`, `backend/dist/`, `backend/local.settings.json`, secret/key
    files, `.git/`, and the scratchpad file.
  - Add `tools/package.py` to rebuild the two zips.
  - Add an invariant that neither zip ships `node_modules`, backend `dist`,
    secrets, `local.settings.json`, or the scratchpad.
- C3: add `queryParams(sqlText, params)` next to `querySql` in
  `backend/src/sql/client.ts`; it must bind with `request.input(...)`.
- C4: switch `dwSource.defaultFixturePath()` from `process.cwd()` to a
  `__dirname`-relative fixture path.
- C5: document that `TrustServerCertificate=True` is for local development only.

Cleanup verification:

- `python build.py` green.
- `pnpm run build` in `backend/` green.
- Both zips contain backend source and no excluded generated/sensitive files.
- Tree clean after commit.

Cleanup commit message:

`Housekeeping: add backend handoff doc, drop stray file, formalize full-snapshot packaging, add parameterized SQL helper.`

## 3. Gate 3a - Classification

Gate 3a is unit-testable and does not require SQL.

Implementation status:

- Implemented in `backend/src/warehouse/classification.ts`.
- `backend/src/sources/dwSource.ts` applies classification after contract
  normalisation.
- Covered by `backend/test/classification.test.ts` plus the existing
  `backend/test/dwSource.test.ts` fixture assertions.
- Gate 3b remains the next approved review gate and must preserve the ownership
  boundary.

Objective:

The connector classifies `function` and `orderType` before SQL upsert.

Function classification:

- Port the baseline rules and resolver logic from `src/importRules.js`.
- Include `resolveFunction`, `matchingRule`, `sortRules`, `matchesValue`,
  priority ordering, entity scope, `requiresBlankField`, `secondaryField`, and
  blank-match behaviour.
- Do not port the Firestore stored-override path.

Order type:

- Port the relevant `PXPoImport` rules from `src/modules/reports/erpImport.js`.
- Phoenix/Navision FPO rows classify as foreign.
- Phoenix/Navision LPO rows classify as local.
- Business Central rows for Seychelles Breweries and Edena classify as local
  when currency is blank or equal to the entity local currency (`SCR` or `EUR`);
  otherwise they classify as foreign.

Input mapping:

- `Purchaser Code` from `erpPurchaserCode`
- `Created By` from `erpCreatedBy`
- `Purchasing Mgr ID` from `erpPurchasingMgrId`
- `HOD ID` from `erpHodId`
- `Currency Code` from `currency`
- `entity` and `erpSource` from the order contract

Tests:

- Drift guard against the map/rules parsed from `src/importRules.js`.
- Behavioural tests:
  - `ET01` -> indirect
  - `SH01` -> supplychain
  - blank purchaser code plus `Created By` fallback
  - `DNARAYANEN` plus HOD ID secondary rule
  - Phoenix LPO order type
  - Seychelles blank-currency order type
  - foreign USD order type

Canonical browser expectations live in `tools/regression_checks.js`, around the
ERP import classification checks.

## 4. Gate 3b - Ownership-Safe Idempotent Upsert

Objective:

Port the safe import/upsert behaviour from `src/modules/reports/erpImport.js`
into the SQL backend.

Implementation status:

- Implemented in `backend/src/sync/purchaseOrderSync.ts`.
- `backend/src/sql/client.ts` now supports transaction-bound `queryParams`.
- `POST /api/sync/purchase-orders` is wired in
  `backend/src/functions/syncPurchaseOrders.ts`.
- A disabled-by-default timer stub is wired in
  `backend/src/functions/syncPurchaseOrdersTimer.ts`.
- Covered by `backend/test/purchaseOrderSync.test.ts`.
- Gate 4 remains responsible for SQL-backed integration tests against LocalDB or
  Docker SQL Server.

3b.1 corrective status:

- Money fields `amount` and `erp_amount` bind as `sql.Decimal(18,4)`.
- ERP PO status mapping is case-insensitive and drift-guarded against
  `src/core.js` `REF.erpStatusMap.po`.
- Unresolved classification rows write `sync_exceptions.error_code =
  'UNCLASSIFIED'`.
- Fatal sync failures best-effort write a failed `import_audit` row outside the
  transaction.

Requirements:

- Use only the parameterized helper from cleanup C3 for external values.
- Use a SQL transaction keyed by `(entity, order_id)`.
- Existing rows update ERP-owned columns, provenance, and classification only.
- Existing rows must never update:
  - `status`
  - `is_closed`
  - `phoenix_data`
- New rows insert mapped ERP data and seed initial `status` from the browser
  `REF.erpStatusMap` / `mapErpPoStatus` logic in `src/core.js`.
- Group and sum line rows.
- Failures are written to `sync_exceptions`.
- Each batch writes one `import_audit` row.
- Wire the sync behind an HTTP trigger and a timer stub.

## 5. Gate 4 - Integration Tests + README

Use `node:test` against local SQL Server, either Docker SQL Server or LocalDB.

Implementation status:

- Implemented in `backend/test/purchaseOrderSync.integration.test.ts`.
- Runs when `RUN_SQL_INTEGRATION=true` and `SQL_CONNECTION_STRING` are set.
- Proven locally against Docker SQL Server with `backend/db/001_init.sql`
  applied.
- `backend/README.md` now documents migration, `func start`, sync POST,
  integration-test command, and real SQL / real Data Warehouse swap points.

Required cases:

- Create new rows.
- Re-run idempotently with no duplicates.
- Ownership preservation: pre-seed `status` and `phoenix_data`, sync, and assert
  both remain unchanged.
- Malformed row creates a `sync_exceptions` record.

README additions:

- Run-local steps.
- Real SQL swap point.
- Real Data Warehouse swap point.

## 6. Reuse Map

- Contract: `src/warehouseAdapter.js` `ORDER_CONTRACT_FIELDS`, mirrored in
  `backend/src/warehouse/contract.ts`.
- Function classifier: `src/importRules.js`.
- Order type and upsert behaviour: `src/modules/reports/erpImport.js`
  (`PXPoImport`).
- Status map: `src/core.js` `mapErpPoStatus`.
- Canonical classifier expectations: `tools/regression_checks.js`.

## 7. Cadence And Don't-Touch Rules

Cadence:

1. Cleanup
2. Gate 3a
3. Claude review
4. Gate 3b
5. Claude review
6. Gate 4

One commit per gate.

Do not touch:

- `src/`
- `build.py` module list
- Firebase demo path
- ownership boundary

Do not create root zips beyond:

- `Phoenix Procurement DEMO FULL.zip`
- `Phoenix Procurement PRODUCTION FULL.zip`

## 8. F1 - Read API Gates

F1 adds read-side endpoints over the SQL store for BI and future browser use.
The SQL backend currently holds ERP order data only, so read APIs must not fake
shipment/payment/GRN-derived KPIs.

F1a implementation status:

- Implemented `GET /api/orders` in `backend/src/functions/orders.ts`.
- Query and validation live in `backend/src/kpi/queries.ts`.
- Row mapping lives in `backend/src/kpi/shape.ts`.
- The endpoint is function-key protected, read-only, typed-parameterized, and
  uses an allowlist for sortable SQL column names.
- Raw `phoenix_data` is not exposed. SQL `status` is mapped only as
  `initialOperationalStatus`.
- Covered by `backend/test/ordersRead.test.ts` and optional live SQL coverage in
  `backend/test/ordersRead.integration.test.ts`.

F1b implementation status:

- Implemented `GET /api/kpis` in `backend/src/functions/kpis.ts`.
- KPI query logic lives in `backend/src/kpi/queries.ts`.
- Coverage metadata lives in `backend/src/kpi/shape.ts`.
- The endpoint is function-key protected, read-only, typed-parameterized, and
  scoped by optional `entity`, `dateFrom`, and `dateTo` filters.
- It returns order-only counts, spend grouped by currency, MTTO aligned to the
  browser `calcOrderMTTO` definition, open-order ageing, requested-receipt
  proxy exposure, data-quality counts, latest sync audit metadata, and explicit
  coverage exclusions for OTIF, cycle time through GRN/shipment stages, supplier
  scorecards, and live Phoenix operational status.
- Covered by `backend/test/kpisRead.test.ts` and optional live SQL coverage in
  `backend/test/kpisRead.integration.test.ts`.

F1c implementation status:

- `backend/README.md` documents the read endpoint contracts, examples, function
  key auth model, read-only SQL-principal expectation, Power BI Web connector
  consumption note, and the real SQL / real Data Warehouse swap points.
- `backend/db/002_kpi_indexes.sql` adds idempotent read indexes for F1 filters
  and aggregations.

Remaining backend delivery items:

F2 implementation status:

- `backend/src/notifications/orderAlerts.ts` queries open SQL orders for
  approaching/overdue requested receipt dates and stale ERP sync timestamps.
- `backend/src/notifications/graphClient.ts` contains the Microsoft Graph
  sendMail and optional Teams-channel adapter.
- `backend/src/functions/orderAlertNotifications.ts` registers a
  disabled-by-default timer plus `GET /api/notifications/order-alerts/preview`
  for dry-run testing without Graph delivery.
- Recipient routing is environment-driven through
  `ORDER_ALERT_RECIPIENT_MAP_JSON` and `ORDER_ALERT_FALLBACK_EMAIL`; Graph
  secrets must come from app settings or Key Vault.
- `backend/db/003_notification_state.sql` adds SQL sent-state, and F2 records
  sent digest items after successful email delivery so repeated items are
  suppressed for `ORDER_ALERTS_REPEAT_SUPPRESSION_HOURS` (24 hours by default).
- Covered by `backend/test/orderAlerts.test.ts` and optional live SQL coverage
  in `backend/test/orderAlerts.integration.test.ts`.

Remaining backend delivery items:

F3 implementation status:

- `backend/src/analytics/cycleTime.ts` computes order-only cycle/bottleneck
  metrics from SQL orders.
- `backend/src/functions/cycleTimeAnalytics.ts` exposes
  `GET /api/analytics/cycle-time` with function-key auth.
- Metrics cover open order age, requested-receipt lead/delay, stale-sync and
  long-open SLA-style breaches, grouped by officer, supplier, category, and
  function.
- The response explicitly excludes true workflow time-in-stage and stage
  transition bottlenecks until browser `status_log` / workflow history is
  migrated to SQL.
- Covered by `backend/test/cycleTime.test.ts` and optional live SQL coverage in
  `backend/test/cycleTime.integration.test.ts`.

Remaining backend delivery items:

F4 implementation status:

- `backend/src/analytics/otifRisk.ts` computes an order-only OTIF early-warning
  proxy for open orders that are not yet requested-receipt overdue.
- `backend/src/functions/otifRisk.ts` exposes `GET /api/analytics/otif-risk`
  with function-key auth.
- Risk scoring uses near-due requested receipt, stale ERP sync, long-open age,
  and missing supplier/classification signals.
- The response explicitly marks supplier historical delay, promise revision
  counts, shipment stage, GRN outcome, and true OTIF as unavailable.
- The originally requested browser-side `src/procurementFollowup.js` predictive
  enhancement is deferred under the non-negotiable browser-untouched rule.
- Covered by `backend/test/otifRisk.test.ts` and optional live SQL coverage in
  `backend/test/otifRisk.integration.test.ts`.

Remaining backend delivery items:

F5 implementation status:

- `backend/src/worklists/unclassified.ts` lists actionable `sync_exceptions`
  rows for `UNCLASSIFIED`, `UNMAPPED_SUPPLIER`, and `CURRENCY_AMBIGUOUS`.
- `backend/src/functions/unclassifiedWorklist.ts` exposes
  `GET /api/worklists/unclassified` with function-key auth.
- Rows include parsed payload data, summaries, and suggested actions for the
  future admin UI (`addImportRule`, `mapSupplier`, `resolveCurrencyRule`).
- The endpoint is read-only. Browser admin UI and one-click write actions remain
  deferred under the non-negotiable browser-untouched rule and need final write
  design approval.
- Covered by `backend/test/unclassifiedWorklist.test.ts` and optional live SQL
  coverage in `backend/test/unclassifiedWorklist.integration.test.ts`.

Backend-safe handoff status:

- 3b.1 through F5 are implemented and tested in the backend/API path.
- Deferred browser-specific items: `src/procurementFollowup.js` predictive
  enhancement and the admin worklist UI/write actions.

## 9. Complete Backend Handoff A-E Status

Current status after the closed-environment backend pass:

- Stage A is wired. API-mode order reads merge SQL ERP rows from `dbo.orders`
  with active Phoenix order overlays from `dbo.operational_records`; order
  overlay writes strip ERP-owned fields before storing; synthetic ERP-only ids
  create the first Phoenix overlay when an ERP-sourced order is edited; and
  `GET /api/reconciliation/orders` is available for admin/manager review.
- Orders are intentionally exempt from `top`, `skip`, and `changedSince`
  collection slicing. The browser uses `/api/records/heads` to detect order
  changes, then refreshes the full merged order set so the two-source merge
  cannot produce partial or misleading browser state.
- Stage B is complete locally. Migrations now run through
  `backend/db/006_order_merge_indexes.sql`, including `dbo.app_counters` and
  merged-order support indexes, and have been applied twice idempotently against
  Docker SQL Server.
- Stage C is already represented by `tools/package.py`: the production package
  stages `demoMode:false`, `authMode:'internal'`, and `dataMode:'api'` with
  same-origin `/api` defaults and no committed secrets.
- Stage D has local SQL integration coverage. `backend/test/e2eOperationalFlow.integration.test.ts`
  proves the critical path: fixture/contract sync inserts an ERP order, the
  operational records API returns it merged, an API overlay update preserves ERP
  truth while adding Phoenix fields, and reconciliation has no issue for that
  order.
- Stage E remains an IT deployment activity: provision the target SQL Server,
  run migrations, deploy Functions/app settings, host the production HTML over
  internal HTTPS, provide final identity/API policy, and run the go-live
  smoke checklist in `docs/GO_LIVE_RUNBOOK.md`.
