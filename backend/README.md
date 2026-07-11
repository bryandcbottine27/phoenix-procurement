# Phoenix Procurement Backend

Backend v1 scaffold for the Data Warehouse connector, SQL read APIs, and the
internal browser data API used by the production no-Firebase package.

This folder is intentionally isolated from the browser application. Nothing under
`src/` is imported by this backend, and the browser build remains governed by the
root `build.py` validation.

## Gate 1 Scope

- Azure Functions v4 Node/TypeScript project.
- Anonymous `GET /api/health` HTTP trigger.
- SQL Server connection helper using `mssql`.
- Idempotent DDL migrations for:
  - `dbo.orders`
  - `dbo.sync_exceptions`
  - `dbo.import_audit`
  - `dbo.notification_state`
  - `dbo.operational_records`
  - `dbo.app_counters`

## Local Prerequisites

Use either SQL Server LocalDB or a Docker SQL Server container.

This Codex environment currently has bundled Node/pnpm, but may not have:

- Azure Functions Core Tools (`func`)
- Docker
- SQL Server LocalDB (`sqllocaldb`)
- `sqlcmd`

The project keeps Azure Functions Core Tools as a dev dependency so `pnpm exec func`
can be used where the package install succeeds. SQL Server itself must still be
available locally.

## Setup

```powershell
cd backend
pnpm install
Copy-Item local.settings.example.json local.settings.json
# Edit local.settings.json and set SQL_CONNECTION_STRING for LocalDB or Docker SQL Server.
pnpm run build
pnpm run db:migrate
pnpm start
```

Full `func start` runs timer listeners as well as HTTP triggers. For a clean
local host run, provide a reachable `AzureWebJobsStorage` value, such as Azurite
or an approved Azure Storage account. If storage is missing or unreachable, the
HTTP endpoints can still be smoke-tested, but the host may report storage-health
warnings for timer infrastructure.

Local SQL integration test run:

```powershell
$env:SQL_CONNECTION_STRING='Server=localhost,14333;Database=PhoenixProcurementBackend;User Id=sa;Password=Your_strong_password123;Encrypt=True;TrustServerCertificate=True'
pnpm run db:migrate
$env:RUN_SQL_INTEGRATION='true'
pnpm test
```

Health endpoint:

```powershell
Invoke-RestMethod http://localhost:7071/api/health
```

The health check returns `200` only when the SQL connection can run `SELECT 1`.
Missing or invalid SQL configuration returns `503`.

Warehouse sync endpoint:

```powershell
Invoke-RestMethod -Method Post http://localhost:7071/api/sync/purchase-orders
```

The sync endpoint reads the fixture-backed `dwSource` for now, groups duplicate
line rows by `(entity, orderId)`, validates them, and upserts into SQL Server
inside a transaction. Existing rows refresh ERP/provenance/classification fields
only; `status`, `is_closed`, and `phoenix_data` are not updated on existing rows.
Malformed rows are written to `sync_exceptions`, and every batch writes one
`import_audit` row.

The timer function is registered as a safe stub and does nothing unless
`DW_SYNC_TIMER_ENABLED=true`. Use `DW_SYNC_CRON` to override the default schedule
when the real Data Warehouse feed is ready.

Real SQL swap point:

- Use an Azure SQL / SQL Server connection string supplied through app settings
  or Key Vault, not `local.settings.json`.
- Production should use a least-privilege write principal for the WD sync
  functions and a read-only principal for read APIs.
- `TrustServerCertificate=True` is local-dev only.

Real Data Warehouse swap point:

- Replace the fixture reader in `src/sources/dwSource.ts` with the approved WD
  source query/client.
- Keep the output normalized to `ORDER_CONTRACT_FIELDS` before classification
  and upsert.
- Keep failures flowing to `sync_exceptions` and batch summaries to
  `import_audit`.

Orders read endpoint:

```powershell
Invoke-RestMethod -Headers @{ "x-functions-key" = "<function-key>" } "http://localhost:7071/api/orders?function=technical&pageSize=10"
```

`GET /api/orders` is a read-only, function-key protected list endpoint over the
SQL `orders` table. It supports entity/function/order-type/ERP-status/closed/
supplier/date filters, pagination, and allowlisted sorting. It does not expose
the raw `phoenix_data` ownership-boundary blob; SQL `status` is exposed only as
`initialOperationalStatus` because it is seeded on insert and is not live
Phoenix operational state in the SQL-only feed.

KPI read endpoint:

```powershell
Invoke-RestMethod -Headers @{ "x-functions-key" = "<function-key>" } "http://localhost:7071/api/kpis?entity=Phoenix"
```

`GET /api/kpis` is a read-only, function-key protected aggregation endpoint over
the SQL order store. It supports optional `entity`, `dateFrom`, and `dateTo`
scope filters. It returns order-only counts, spend grouped by currency, MTTO,
open-order ageing, requested-receipt exposure, data-quality counts, latest sync
audit metadata, and a `coverage` block. The coverage block deliberately excludes
OTIF, cycle time through GRN/shipment stages, supplier scorecards, and live
Phoenix operational status because shipment, payment, GRN, and live Phoenix
operational data are not in SQL yet.

Internal browser operational API:

```powershell
Invoke-RestMethod -Headers @{ "x-functions-key" = "<function-key>" } "http://localhost:7071/api/records"
```

`GET /api/records` returns a grouped snapshot for the browser when
`APP_CONFIG.dataMode === 'api'`. The production package generated by
`tools/package.py` uses this mode by default and does not load Firebase modules.
After the first snapshot, the browser polls `GET /api/records/heads` and reloads
only collections whose `MAX(updated_at)` or count changed. Create/update/archive/
restore operations also reload only the affected collection instead of refetching
the full operational store. Normal browser writes still go through `PXStore`, then
`PXApiClient`, then the function-key protected operational record routes:

- `GET /api/records`
- `GET /api/records/heads`
- `GET /api/records/{collection}?top=&skip=&changedSince=` (non-order collections)
- `POST /api/records/{collection}`
- `PATCH /api/records/{collection}/{id}`
- `POST /api/records/{collection}/{id}/archive`
- `POST /api/records/{collection}/{id}/restore`
- `POST /api/counters/{counterKey}/next`
- `GET /api/reconciliation/orders`

Allowed collections are hard-coded in `src/operational/records.ts` and mirror the
browser business collections. Records are stored in `dbo.operational_records` as
allowlisted collection/name pairs with JSON payload, SQL timestamps, soft archive
flags, and a stale-write guard based on `updated_at`. Non-order single-collection
reads support `top`, `skip`, and `changedSince`; `status_log` is capped to the
latest 200 rows by default so routine API polling cannot drag the full audit
history into the browser.

Orders are merged on read. `GET /api/records` and `GET /api/records/orders`
combine ERP-owned SQL rows from `dbo.orders` with Phoenix-owned overlays from
`dbo.operational_records`. ERP-owned fields such as supplier, amount, currency,
ERP lifecycle status, provenance, and classified `function`/`orderType` win from
`dbo.orders`; Phoenix-owned fields such as operational `status`, milestones,
notes, claims, and receipts stay in the active overlay. If an ERP-only
order is edited for the first time, the synthetic id returned by the merged read
creates a Phoenix overlay record. Order overlay writes strip ERP-owned fields
before storing, keeping only the merge keys (`entity`, `orderId`) plus
Phoenix-owned fields. Because the order collection is derived from two stores,
`GET /api/records/orders` intentionally returns the full merged set and ignores
`top`, `skip`, and `changedSince`; `/api/records/heads` is the change detector
that tells the browser when to refresh orders.

Read routes require `x-phoenix-user` to resolve to an active stored officer in
`dbo.operational_records`. `GET /api/records` and `GET /api/records/heads` return
only collections readable by that stored role. Reference data (`system_config`,
`officers`, `suppliers`) is available to any active known role, but non-privileged
roles receive officer names/codes without `email` or `authUid`. `status_log` and
`kpiSnapshot` are privileged. `GET /api/records/{collection}` returns `403` when
the stored role cannot read that collection.

`PXApiClient` sends the current operator code in `x-phoenix-user` so backend read
authorization and audit metadata such as `archivedBy` use the local operator
during internal testing. This header is not a final identity proof; pilot/go-live
still needs the IT-approved gateway/backend policy that makes the asserted user
trustworthy.

`POST /api/counters/{counterKey}/next` returns an atomic SQL-backed integer from
`dbo.app_counters`. The first browser use is API-mode RFP numbering, replacing the
Firestore transaction used in demo/Firebase mode.

`GET /api/reconciliation/orders` returns ERP-only orders, app-only overlays, and
value mismatches for amount, currency, and ERP lifecycle status versus Phoenix
operational status. It is function-key protected and also requires the
`x-phoenix-user` header to resolve to an active stored officer with order read
access.

This operational JSON table is a practical internal-server bridge for testing
without Firebase. It is not a final normalized data warehouse model; IT/business
can still approve a later normalized operational schema once hosting, identity,
and reporting requirements are final.

Operational record write routes enforce the browser permission matrix again on
the server. The API resolves the submitted `x-phoenix-user` value to the stored
`officers` record in `dbo.operational_records` and uses that stored role; it does
not accept a client-supplied role from the request body. Unknown/missing roles
fail closed with `403`. The routes also run backend validation for high-risk
payloads such as required order fields, non-negative order/payment amounts,
payment totals versus linked order value, and unsafe document links. This is a
closed-environment guardrail; pilot/go-live still needs the IT-approved identity
and gateway/backend authorization policy in front of the Function app.

## Read API Contract

Read endpoints use `authLevel: "function"` and should be served through the
final private Azure/VNet path. Use a read-only SQL principal for these endpoints
in production. They must not write to SQL.

Operational record endpoints also use `authLevel: "function"` but do write to
`dbo.operational_records`. Use a separate least-privilege SQL principal for those
routes in production and keep Function keys/app settings out of committed files.

### `GET /api/orders`

Query parameters:

- `entity`
- `function`
- `orderType`
- `erpPoStatus`
- `closed` (`true` or `false`)
- `supplier` (contains search)
- `dateFrom` / `dateTo` (`YYYY-MM-DD`, scoped to `date_of_order`)
- `page` (default `1`)
- `pageSize` (default `50`, max `200`)
- `sort` (`date_of_order`, `amount`, `entity`, `order_id`, or
  `erp_po_status`, with `asc` or `desc`)

Example:

```powershell
Invoke-RestMethod -Headers @{ "x-functions-key" = "<function-key>" } "http://localhost:7071/api/orders?entity=Phoenix&function=technical&page=1&pageSize=50&sort=date_of_order:desc"
```

Response shape:

```json
{
  "data": [],
  "page": 1,
  "pageSize": 50,
  "total": 0,
  "generatedAt": "2026-07-09T00:00:00.000Z"
}
```

Rows map SQL snake_case columns to the browser/backend camelCase contract.
`phoenix_data` is not exposed. SQL `status` appears only as
`initialOperationalStatus`, because it is seeded by the connector and is not
the live Phoenix operational status.

### `GET /api/kpis`

Query parameters:

- `entity`
- `dateFrom` / `dateTo` (`YYYY-MM-DD`, scoped to `date_of_order`)

Example:

```powershell
Invoke-RestMethod -Headers @{ "x-functions-key" = "<function-key>" } "http://localhost:7071/api/kpis?entity=Phoenix&dateFrom=2026-07-01&dateTo=2026-07-31"
```

Response shape:

```json
{
  "scope": { "entity": "Phoenix", "dateFrom": "2026-07-01", "dateTo": "2026-07-31" },
  "generatedAt": "2026-07-09T00:00:00.000Z",
  "counts": {
    "byEntity": [],
    "byFunction": [],
    "byOrderType": [],
    "byErpPoStatus": [],
    "openClosed": { "open": 0, "closed": 0 }
  },
  "spendCommitment": { "byCurrency": {} },
  "mtto": { "avgDays": null, "medianDays": null, "sampleSize": 0 },
  "ageing": { "openByBucket": { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } },
  "requestedReceipt": {
    "proxy": true,
    "overdue": { "count": 0, "valueByCurrency": {} },
    "approachingDays": 7,
    "approaching": { "count": 0, "valueByCurrency": {} }
  },
  "dataQuality": {
    "unclassifiedFunction": 0,
    "unclassifiedOrderType": 0,
    "openSyncExceptions": 0,
    "staleSyncOverDays": 3,
    "staleSyncCount": 0
  },
  "sync": { "lastBatchId": null, "lastLoadedAt": null, "created": 0, "updated": 0, "exceptions": 0 },
  "coverage": {
    "excluded": ["otif", "cycleTimeThroughGrn", "supplierScorecards", "liveOperationalStatus"],
    "reason": "Shipment/payment/GRN and live Phoenix operational data are not in SQL yet (WD connector syncs ERP order data only)."
  }
}
```

Amounts are grouped by currency and are never summed across currencies.
Lifecycle metrics use `erp_po_status` and `is_closed`, not the seeded SQL
`status` column.

### Power BI Consumption

For a first BI connection, use Power BI Desktop's **Get Data > Web** connector
against the private Function URL. Pass the function key as an `x-functions-key`
header, or use the final APIM/private endpoint policy chosen by IT. Treat
`GET /api/orders` as the detail table and `GET /api/kpis` as a shaped summary
feed. Power BI should respect the `coverage.excluded` list and must not create
OTIF, GRN cycle-time, or supplier-scorecard measures from this order-only SQL
dataset.

### `GET /api/analytics/cycle-time`

Query parameters:

- `entity`
- `dateFrom` / `dateTo` (`YYYY-MM-DD`, scoped to `date_of_order`)
- `longOpenDays` (default `90`)
- `staleSyncDays` (default `3`)

Example:

```powershell
Invoke-RestMethod -Headers @{ "x-functions-key" = "<function-key>" } "http://localhost:7071/api/analytics/cycle-time?entity=Phoenix&longOpenDays=90"
```

The endpoint returns order-age and requested-receipt bottleneck analytics grouped
by officer, supplier, category, and function. It also returns SLA-style counts
for overdue requested receipts, stale ERP sync, and long-open orders. Its
`coverage` block explicitly excludes true workflow time-in-stage and
stage-transition bottlenecks because SQL does not yet contain browser
`status_log` / `workflows.js` transition history.

### `GET /api/analytics/otif-risk`

Query parameters:

- `entity`
- `dateFrom` / `dateTo` (`YYYY-MM-DD`, scoped to `date_of_order`)
- `horizonDays` (default `14`)
- `longOpenDays` (default `90`)
- `staleSyncDays` (default `3`)
- `minRiskScore` (default `20`)

Example:

```powershell
Invoke-RestMethod -Headers @{ "x-functions-key" = "<function-key>" } "http://localhost:7071/api/analytics/otif-risk?entity=Phoenix&horizonDays=14"
```

The endpoint returns an order-only early-warning proxy for open orders not yet
past requested receipt date. It scores near-due requested receipts, stale ERP
sync, long-open age, and missing classification/supplier fields. It does not
claim true OTIF prediction: the `coverage` block explicitly excludes supplier
delay history, promise revision counts, shipment stage, GRN outcome, and true
OTIF until those datasets are available.

### `GET /api/worklists/unclassified`

Query parameters:

- `entity`
- `status` (default `open`)
- `errorCode` (`UNCLASSIFIED`, `UNMAPPED_SUPPLIER`, or `CURRENCY_AMBIGUOUS`)
- `page` (default `1`)
- `pageSize` (default `50`, max `200`)
- `sort` (`created_at`, `error_code`, `entity`, or `order_id`, with `asc` or
  `desc`)

Example:

```powershell
Invoke-RestMethod -Headers @{ "x-functions-key" = "<function-key>" } "http://localhost:7071/api/worklists/unclassified?entity=Phoenix&errorCode=UNCLASSIFIED"
```

The endpoint returns actionable sync exceptions for the future admin worklist:
unclassified function rows, unmapped supplier rows, and currency-ambiguous rows.
Each row includes a `suggestedAction` such as `addImportRule`, `mapSupplier`, or
`resolveCurrencyRule`. The endpoint is read-only; the browser admin screen and
one-click write actions remain deferred until the rule/supplier mapping write
design is approved.

### Read Indexes

`db/002_kpi_indexes.sql` adds idempotent read indexes for the F1 filters and
aggregations: entity/date, function, order type, ERP PO status, requested
receipt exposure, open sync exceptions, and latest import audit lookup.

`db/003_notification_state.sql` adds the F2 notification sent-state table used
to suppress repeated order-alert digest items between timer runs.

`db/004_operational_records.sql` adds the internal browser API-mode operational
record table.

`db/005_app_counters.sql` adds SQL-backed counters used for API-mode generated
references such as RFP numbers.

`db/006_order_merge_indexes.sql` adds idempotent support indexes for the merged
order read/head path over `dbo.orders` and active order overlays in
`dbo.operational_records`.

## Order Alert Notifications

F2 adds order-level notification scaffolding for responsible officers. The timer
is disabled by default, reads SQL order data, and writes only notification
sent-state after successful delivery. It looks for:

- open orders with `requested_receipt_date` already overdue;
- open orders with `requested_receipt_date` approaching within
  `ORDER_ALERTS_APPROACHING_DAYS`;
- open orders with `erp_last_synced_at` missing or older than
  `ORDER_ALERTS_STALE_SYNC_DAYS`.

Preview the current digest without sending Graph messages:

```powershell
Invoke-RestMethod -Headers @{ "x-functions-key" = "<function-key>" } "http://localhost:7071/api/notifications/order-alerts/preview"
```

Timer settings:

- `ORDER_ALERTS_ENABLED=false` keeps the timer inactive.
- `ORDER_ALERTS_DRY_RUN=true` runs the query and builds digests without Graph
  delivery.
- `ORDER_ALERTS_CRON` overrides the default `0 0 4 * * *` schedule.
- `ORDER_ALERTS_REPEAT_SUPPRESSION_HOURS=24` suppresses digest items already
  recorded as sent in SQL during the last 24 hours. Set a different positive
  integer for a shorter or longer repeat window.
- `ORDER_ALERT_RECIPIENT_MAP_JSON` maps officer keys to email targets. Keys are
  checked in this order: `erp_purchaser_code`, `erp_created_by`, `claimant`,
  `procurement_function`, `entity`, `default`.
- `ORDER_ALERT_FALLBACK_EMAIL` is used when no map key matches.

Example recipient map:

```json
{
  "ET01": { "email": "technical.officer@example.com", "label": "Technical" },
  "supplychain": "supply.chain@example.com",
  "Phoenix": "phoenix.procurement@example.com",
  "default": "procurement.control@example.com"
}
```

Graph delivery settings must come from Azure app settings or Key Vault, never
from committed files:

- `GRAPH_TENANT_ID`
- `GRAPH_CLIENT_ID`
- `GRAPH_CLIENT_SECRET`
- `GRAPH_MAIL_SENDER_USER_ID`
- optional `GRAPH_TEAMS_TEAM_ID` and `GRAPH_TEAMS_CHANNEL_ID` for a Teams channel
  summary.

After a real email digest is sent, each alert item is upserted into
`dbo.notification_state`. Later timer runs suppress matching
recipient/type/entity/order alert keys inside the configured repeat window.
The preview endpoint and dry-run mode do not write notification state.

## Docker SQL Server Example

```powershell
docker run --name phoenix-sql -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=Your_strong_password123" -p 14333:1433 -d mcr.microsoft.com/mssql/server:2022-latest
```

Example connection string:

```text
Server=localhost,14333;Database=PhoenixProcurementBackend;User Id=sa;Password=Your_strong_password123;Encrypt=True;TrustServerCertificate=True
```

`TrustServerCertificate=True` is for local development only. Production SQL
connections should use trusted certificates and the final IT-approved encryption
configuration.

Create the database before running migrations if your SQL login cannot create it.

## Next Gates

Gate 2 added the fixture-backed `dwSource.fetchPurchaseOrders()` and mapping to
the `PXWarehouse.ORDER_CONTRACT_FIELDS` contract. The backend keeps a local copy
of that field list, guarded by a unit test that reads `src/warehouseAdapter.js`
and fails on drift.

Gate 3a added backend classification in `src/warehouse/classification.ts`.
Fixture purchase orders now receive derived `function` and `orderType` values
using the browser import-rule baseline and the approved Phoenix/Seychelles/Edena
order-type logic. `test/classification.test.ts` guards drift against
`../src/importRules.js` and covers the canonical classifier cases.

Gate 3b added transactional ownership-safe upsert keyed on
`(entity, orderId)`, preserving Phoenix-owned operational data. All Gate 3 SQL
upsert statements must use parameterized `mssql` requests for external values;
no fixture, warehouse, or user-provided value may be interpolated into SQL text.
`test/purchaseOrderSync.test.ts` covers grouping, status seeding, exception
queueing, ownership preservation on updates, and parameterized SQL structure.
Gate 3b.1 tightened that path with typed decimal money bindings,
case-insensitive ERP PO status mapping guarded against the browser map,
`UNCLASSIFIED` sync exception codes, and failed-audit logging for fatal sync
errors.

Gate 4 added SQL integration tests against Docker SQL Server for create,
idempotent re-run, ownership preservation, malformed and unclassified
exceptions, decimal precision, lowercase status mapping, and line grouping.

F1a added `GET /api/orders` as the first read-side endpoint for BI/future browser
consumers. F1b added honest order-only KPI aggregations and coverage metadata in
`GET /api/kpis`, with optional live SQL integration coverage. F1c added the
endpoint contract, Power BI consumption note, read-index migration, and
real-SQL/Data Warehouse swap points. F2 added disabled-by-default Graph
notification scaffolding plus a function-key preview endpoint for order-level
requested-receipt and stale-sync alerts. F3 added
`GET /api/analytics/cycle-time` for order-age bottleneck analytics with explicit
coverage metadata for workflow time-in-stage gaps. F4 added
`GET /api/analytics/otif-risk` as an order-only early-warning proxy while the
browser `PXProcFollowup` predictive enhancement remains deferred under the
browser-untouched gate rule. F5 added `GET /api/worklists/unclassified` as the
backend data API for the future unclassified/unmapped admin worklist, while the
browser UI and one-click write actions remain deferred under the same rule.
