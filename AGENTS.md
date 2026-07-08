# AGENTS.md - Phoenix Procurement

This file is for future Codex/AI coding threads working in this repository.

## Project purpose

Phoenix Procurement is a procurement, logistics, finance follow-up, and management control tower for Phoenix Beverages and group companies. It sits on top of ERP data from Navision/Business Central. It is not a replacement ERP.

The app tracks operational follow-up: supplier chasing, shipment visibility, GRNs, documents, payment requests, warnings, exceptions, dashboards, and management reporting.

Current entities:

- Phoenix
- Seychelles Breweries
- Edena

## Start here before changing code

Read these files before any substantial change:

- `docs/PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/BUSINESS_RULES.md`
- `docs/ROADMAP.md`
- `README.md`
- `docs/PHOENIX_DEVELOPER_NOTES.md`
- `docs/DATA_DICTIONARY.md`

If the change touches fields or collections, read and update `src/schema.js`. Do not hand-edit `docs/DATA_DICTIONARY.md`; it is generated.

## Architecture principles

- Source of truth is modular source: `src/**/*.js`, `styles/main.css`, and `index.html`.
- Generated demo output is `dist/phoenix-procurement-DEMO.html`. Do not edit generated HTML by hand.
- Keep one clean demo HTML output. Do not reintroduce duplicate-purpose HTML files.
- Use the existing global module contract (`window.PX*`, `window.__*`) unless a deliberate refactor is requested.
- New domain code should follow the existing split:
  - `*.service.js` for data helpers/writes
  - `*.render.js` for list/page rendering
  - `*.form.js` for create/edit forms
  - `*.detail.js` for detail screens
- Keep the Business Central-style interface with Phoenix colours.
- Keep UI dense, operational, and suitable for repeated daily use.
- Changes must apply to Phoenix, Seychelles Breweries, and Edena unless explicitly documented otherwise.

## Package file rule

- The project root must contain exactly two zip packages:
  - `Phoenix Procurement DEMO FULL.zip`
  - `Phoenix Procurement PRODUCTION FULL.zip`
- Do not create timestamped, `pre-*`, backup, duplicate-purpose, or extra package zip files in the project root.
- Every package update/amendment must replace those two files only.
- Demo package keeps the demo build (`dist/phoenix-procurement-DEMO.html`).
- Production package keeps the production build (`dist/phoenix-procurement-PRODUCTION.html`) with `demoMode: false` and `authMode: 'password'`.
- Use Git commits/tags for history instead of accumulating package backup zips.

## Data and write rules

- All business record writes must go through `window.PXStore`.
- Do not call Firestore `addDoc`, `updateDoc`, `setDoc`, `deleteDoc`, or `runTransaction` directly for normal business CRUD.
- Known direct-write exceptions:
  - officer profile bootstrap in `src/core.js`
  - atomic RFP counter transaction in `src/modules/payments/payments.service.js`
  - demo-only admin purge in `src/modules/reports/erpImport.js`
  - `PXStore` internals
- Use soft archive/restore for business records.
- Keep validation in `src/validators.js` and write safety in `src/firestoreStore.js`.
- Do not let the future warehouse sync overwrite Phoenix-owned operational fields.

## Business logic guardrail

Before changing established procurement/logistics/finance rules, check:

- `docs/BUSINESS_RULES.md`
- `docs/DECISIONS.md`
- `src/schema.js`
- `src/core.js` reference data/status lists

Do not reverse confirmed rules without explicit user approval. In particular:

- This app is a control layer, not a second ERP.
- ERP status and Phoenix operational status are separate.
- Local tangible orders normally receive through order-level GRNs, not shipments.
- If local shipments exist, they follow the same shipment rules as foreign shipments.
- GRN is the key receipt control.
- Delivery is not a separate object/layer.
- Internal stakeholders and view-only users cannot create/request payments.
- Supplier compliance is not duplicated because ERP controls supplier onboarding.
- SharePoint is the intended production document store.
- Data Warehouse/staging is the intended ERP integration route.

## Authentication and permissions

- Demo mode may use anonymous/demo role switching.
- Production mode must use individual credentials and ignore demo role overrides.
- `REF.permissions`, `REF.viewAccess`, `PXUtils.can`, `PXPermissions`, and `PXStore` write checks must stay aligned.
- Production requires Firestore rules. Browser checks alone are not sufficient.
- Access-sensitive changes need role-by-role testing, especially payments, update requests, order edit, shipment edit, and System Settings.

## Documentation requirements

Update persistent docs when you change behaviour:

- Field/collection change: update `src/schema.js`, then run `python build.py`.
- Business rule change: update `docs/BUSINESS_RULES.md` and `docs/DECISIONS.md`.
- Architecture/integration change: update `docs/ARCHITECTURE.md`.
- Roadmap or deferred work: update `docs/ROADMAP.md` and/or `docs/ON_HOLD_REGISTER.md`.
- Current-state change: update `docs/PROJECT_STATE.md`.

Never leave a major behaviour only in chat history.

## Validation requirements

Run the current validation before handover:

```powershell
$env:PATH='C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' .\build.py
```

This currently performs:

- data dictionary regeneration
- data dictionary drift check
- JavaScript syntax check for all modules
- generated demo build
- structural invariant checks, including the pre-test data integrity guards and package zip hygiene
- local Node regression checks for role permissions, production fail-closed access, Firestore rule drift, payment approval routing, validator guardrails, ERP import classification, Data Quality timing, and My Work computed actions

The root browser app still has no package-managed frontend build, lint runner, TypeScript checker, Firebase emulator, or Firebase rules validation command. The local browser regression harness is `tools/regression_checks.js` and is run by `build.py`.

Backend work is isolated under `backend/` and has its own `package.json`, TypeScript build, Azure Functions Core Tools dependency, `mssql`, and SQL DDL migration scaffold. Backend validation is separate from the browser gate and requires a local SQL Server instance for runtime/integration proof.

## Current continuity note

This project folder is now a Git repository. The original handover baseline is tagged `baseline-2026-07-06`. Keep the working tree clean after handover, commit meaningful changes, and keep only the two current package zips listed above.
