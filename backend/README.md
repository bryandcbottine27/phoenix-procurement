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
`GET /api/kpis`, with optional live SQL integration coverage. F1c will expand
this README with the full endpoint contract, Power BI consumption note, optional
read indexes, and real-SQL/Data Warehouse swap points.
