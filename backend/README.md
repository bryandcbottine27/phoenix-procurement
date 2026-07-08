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

Health endpoint:

```powershell
Invoke-RestMethod http://localhost:7071/api/health
```

The health check returns `200` only when the SQL connection can run `SELECT 1`.
Missing or invalid SQL configuration returns `503`.

## Docker SQL Server Example

```powershell
docker run --name phoenix-sql -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=Your_strong_password123" -p 14333:1433 -d mcr.microsoft.com/mssql/server:2022-latest
```

Example connection string:

```text
Server=localhost,14333;Database=PhoenixProcurementBackend;User Id=sa;Password=Your_strong_password123;Encrypt=True;TrustServerCertificate=True
```

Create the database before running migrations if your SQL login cannot create it.

## Next Gates

Gate 2 will add the fixture-backed `dwSource.fetchPurchaseOrders()` and mapping
to the `PXWarehouse.ORDER_CONTRACT_FIELDS` contract.

Gate 3 will implement transactional ownership-safe upsert keyed on
`(entity, orderId)`, preserving Phoenix-owned operational data.

Gate 4 will add integration tests against local SQL and document the real Data
Warehouse swap point.
