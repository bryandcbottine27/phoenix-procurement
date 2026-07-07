# Phoenix Procurement - Decisions

Last reviewed: 2026-07-06

This file records decisions that future developers must not accidentally reverse.

## Architecture decisions

### Keep a web-based application

Decision: keep Phoenix Procurement as a web app, not a desktop app.

Reason:

- Easier deployment and updates.
- Better fit with Firebase, SharePoint, Business Central, and future Data Warehouse integration.
- Avoids installing or updating client software on each workstation.

Rejected/parked:

- Desktop app packaging. It remains parked unless IT policy later requires a desktop shell.

### Modular source, generated single HTML

Decision: maintain modular source under `src/`, but generate a single clean HTML file for demo/sharing.

Reason:

- Developers can work in a maintainable module structure.
- End users can still open one file during the demo stage.
- Avoids multiple duplicate-purpose HTML files in `dist`.

Constraint:

- Do not edit `dist/phoenix-procurement-DEMO.html` by hand.
- Do not reintroduce duplicate demo HTML files with the same purpose.

### Use Business Central-style UI with Phoenix colour code

Decision: the UI should feel similar to Business Central, using Phoenix Beverages colours.

Reason:

- Users already know the Business Central interaction pattern.
- The app sits operationally beside Navision/BC.
- Phoenix branding keeps it recognizable as an internal Phoenix tool.

Constraint:

- Preserve operational density. This is a work tool, not a marketing site.
- Keep list/filter/detail patterns consistent across all three entities.

### Data Warehouse is the integration path

Decision: do not connect the browser app directly to Navision, Business Central, or the Data Warehouse. Use Data Warehouse/staging plus a controlled sync/API service.

Reason:

- Protect ERP production systems.
- Avoid browser-held ERP credentials or tokens.
- Allow one normalized contract while Phoenix moves from Navision to Business Central.
- Support Phoenix, Seychelles Breweries, and Edena with a consistent feed.

Rejected/changed:

- Direct ERP connector from browser to Navision/BC is rejected/parked.
- Manual Excel import remains the demo/staging substitute until the warehouse feed is ready.

### Firestore remains current data store

Decision: Cloud Firestore is the current operational database.

Reason:

- Existing app is built around Firestore live subscriptions.
- Prototype already uses Firebase Auth/Firestore.
- Good fit for rapid operational workflow and dashboard changes.

Constraint:

- Production requires proper Firebase project separation, security rules, and authenticated users.

### Centralized writes through PXStore

Decision: business record writes must go through `PXStore`.

Reason:

- Ensures validation, write permissions, audit stamping, `stripUndefined`, and status logging are consistent.
- Prevents recurring Firestore `undefined` field errors.

Allowed exceptions:

- Officer profile bootstrap in `core.js`, because the officer document id must equal the Firebase Auth UID and runs before the normal state is ready.
- Atomic RFP counter `runTransaction` in `payments.service.js`.
- Demo-only full purge in `erpImport.js`, guarded to demo/admin only and disabled by default, for isolated demo reset testing only.
- Internal `PXStore` itself, because it wraps the Firestore primitives.

Constraint:

- New feature writes to business collections must use `PXStore`.

### Schema and data dictionary are generated from code

Decision: `src/schema.js` is the schema/data-dictionary source of truth; `docs/DATA_DICTIONARY.md` is generated.

Reason:

- Keeps field name, meaning, owner, editable/read-only state, and UI appearance together.
- Reduces drift between code and documentation.

Constraint:

- Every collection/field change must update `src/schema.js`.
- Run `python build.py` or `python tools/gen_data_dictionary.py --write`.
- Do not hand-edit `docs/DATA_DICTIONARY.md`.

## Business logic decisions

### Phoenix is a control tower, not an ERP

Decision: Phoenix Procurement must not replicate ERP transactions or become a second ERP.

Reason:

- ERP remains source of truth for PO master data, vendor, item lines, receipts, invoices, and payments.
- Phoenix focuses on follow-up, visibility, readiness, exceptions, and accountability.

Constraint:

- Avoid bulky PO-line operational screens unless they are lightweight control views.
- Do not build full item receipt accounting in Phoenix.

### ERP-owned fields are protected

Decision: ERP-owned fields are read-only or ERP-seeded in Phoenix for ERP-sourced records.

Reason:

- Prevents conflict between ERP truth and Phoenix operational comments/status.

Constraint:

- Future warehouse sync can refresh ERP-owned fields.
- Future warehouse sync must never overwrite Phoenix-owned operational fields.

### Phoenix status is not ERP status

Decision: ERP lifecycle status is stored separately from Phoenix operational status.

Reason:

- ERP "Open/Released/Closed" does not say whether the supplier acknowledged, goods are ready, logistics has collected, or GRN is pending.

Constraint:

- Importers must write ERP lifecycle into `erpPoStatus`, not blindly into `status`.
- ERP-to-Phoenix status mapping is only a suggested initial operational state.

### Multi-entity changes must apply to all entities

Decision: requested functional changes should apply to Phoenix, Seychelles Breweries, and Edena unless explicitly stated otherwise.

Reason:

- The app is a group procurement control tool.
- Divergence creates support and reporting problems.

Constraint:

- Entity-specific exceptions must be documented in `BUSINESS_RULES.md` and schema/import rules.

### Classification follows purchaser/manager IDs and function rules

Decision: Phoenix rules apply to Seychelles Breweries and Edena. Purchaser Code/ID and Purchasing Mgr ID indicate the procurement function.

Reason:

- The same operational streams are used across entities.

Confirmed ID-to-function mappings are documented in `BUSINESS_RULES.md`.

### Local currency handling

Decision:

- Seychelles Breweries local currency is SCR.
- Edena local currency is EUR.
- In Business Central imports, blank currency code or the entity local currency code means local order.

Reason:

- BC exports may show local currency as blank or explicit local code.

### Local orders normally receive by GRN, not shipment

Decision:

- Foreign tangible orders normally require shipment follow-up.
- Local tangible orders normally have no shipment and are controlled by order-level GRNs.
- Local intangible orders have no shipment and are controlled by order-level GRNs where applicable.
- If a local shipment is exceptionally created, it follows the same shipment rules as a foreign shipment.

Reason:

- Local tangible goods usually arrive by delivery/receipt rather than formal logistics shipment.
- GRN is the control point that matters most.

### Delivery is not a separate layer

Decision: do not create a separate delivery object/layer. Use shipment-level `deliveryDate` for shipments and GRN rows for order receipt control.

Reason:

- The business does not account deliveries separately.
- GRN matters most for control.
- Separate delivery records would add bulk without enough operational value.

### Partial shipments use shipment records, not item-line cloning

Decision: each actual shipment gets its own shipment record, using references such as `FPO12345 (S1)`, `FPO12345 (S2)`.

Reason:

- Logistics needs clear shipment ownership and status per movement.
- ERP remains the item-line source of truth.

Clarification:

- If a split remains on the same aircraft/vessel/logistics movement, it may remain one shipment record.
- If split by different transport means/routes, create separate shipment records.

### Supplier compliance controls removed

Decision: do not duplicate supplier compliance controls in Phoenix.

Reason:

- ERP supplier onboarding already enforces compulsory supplier compliance fields.

Constraint:

- Phoenix supplier master focuses on mapping, contacts, aliases, ratings, and performance.

### Internal stakeholders and view-only users cannot request payment

Decision: users without `payments:create` must be able to view payment request/payment status where allowed, but cannot create/request payment.

Reason:

- Payment request is a controlled finance/procurement action.
- Claimants/stakeholders need visibility, not authority.

Constraint:

- Future UI changes must check both view access and `PXUtils.can('payments','create')`.
- Approval-only flows must check `PXUtils.can('payments','approve')` and pass that permission action through `PXStore`, rather than requiring broad payment edit authority.

### SharePoint is the intended document store

Decision: production documents should live in SharePoint/OneDrive, with Phoenix storing metadata and links.

Reason:

- IT governance, access control, retention, and M365 integration are better handled in SharePoint.

Current state:

- Phoenix builds SharePoint-ready paths but does not yet upload via Graph.

## Process decisions

### Deferred recommendations must be tracked

Decision: put deferred work into `docs/ON_HOLD_REGISTER.md`.

Reason:

- Prevents good ideas from being lost while keeping active development focused.

### Do not change confirmed business logic casually

Decision: before changing established procurement/logistics rules, check `BUSINESS_RULES.md` and this file.

Reason:

- Many rules came from operational clarification and are easy to accidentally reverse.

### Validation gate before handover

Decision: every handover or shipped zip should run the build validation.

Required current command:

```powershell
$env:PATH='C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' .\build.py
```

Known limitation:

- There is no package-managed unit/e2e test stack yet. `build.py` now runs the dependency-free local regression harness in `tools/regression_checks.js` for the high-risk permission/security/data contracts that can be tested without the final Firebase environment.
