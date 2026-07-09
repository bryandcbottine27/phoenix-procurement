# Phoenix Procurement Backend

Backend v1 scaffold for the future Data Warehouse connector.

This folder is intentionally isolated from the browser application. Nothing under
`src/` is imported by this backend, and the browser build remains governed by the
root `build.py` validation.

## Gate 1 Scope

- Azure Functions v4 Node/TypeScript project.
- Anonymous `GET /api/health` HTTP trigger.
- SQL Server connection helper using `mssql`.
- Idempotent DDL migration for:
  - `dbo.orders`
  - `dbo.sync_exceptions`
  - `dbo.import_audit`

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

## Read API Contract

Read endpoints use `authLevel: "function"` and should be served through the
final private Azure/VNet path. Use a read-only SQL principal for these endpoints
in production. They must not write to SQL.

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

## Order Alert Notifications

F2 adds order-level notification scaffolding for responsible officers. The timer
is disabled by default and reads SQL only. It looks for:

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

Until a notification/audit table is approved, F2 does not write sent-state to
SQL and therefore does not suppress repeated digest items between timer runs.

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
