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
