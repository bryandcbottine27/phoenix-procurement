# Phoenix Procurement - Project State

Last reviewed: 2026-07-06

## Current application status

Phoenix Procurement is an operational procurement and logistics control tower for Phoenix Beverages and group companies. It is a browser-based Firebase/Firestore application with modular source in `src/`, styles in `styles/main.css`, an HTML shell in `index.html`, and a generated single-file demo build at `dist/phoenix-procurement-DEMO.html`.

The current source is modular, but the delivered user artifact remains one clean generated HTML file for demo use. The production package is generated from the same source with `APP_CONFIG.demoMode = false` and `APP_CONFIG.authMode = 'password'`.

Current active entities:

- Phoenix
- Seychelles Breweries
- Edena

Current ERP/integration posture:

- Phoenix currently uses Navision.
- Seychelles Breweries uses Business Central.
- Edena is supported through the Business Central-style Excel import path.
- Phoenix is expected to move to Business Central later.
- The approved future integration path is ERP -> Data Warehouse/staging -> controlled sync/API service -> Phoenix Procurement. The browser must not connect directly to Navision, Business Central, or the Data Warehouse.

Important continuity note: this folder is now a Git repository. The starting handover state was committed as `8b0618d` and tagged `baseline-2026-07-06` before follow-up fixes were made. Timestamped zip backups are still present in the folder for release/reference history.

## Completed modules and features

Core application foundation:

- Modular JavaScript source tree with 62 source modules.
- Single-file build via `build.py`.
- Business Central-style top navigation, list pages, card pages, FastTabs, filter panes, and Phoenix colour theme.
- Three-entity handling with active entity switcher.
- Central reference data in `REF` inside `src/core.js`.
- Central state and navigation via `window.__state`, `window.__renderers`, and `PXUtils`.
- Central data dictionary source in `src/schema.js`.
- Generated `docs/DATA_DICTIONARY.md`, currently 358 fields across schema.
- Build-time invariant checks in `tools/check_invariants.py`.
- JavaScript syntax gate through Node `--check` in `build.py`.

Data and write control:

- Central Firestore write path in `src/firestoreStore.js` through `PXStore.createRecord`, `updateRecord`, `archiveRecord`, `restoreRecord`, and `logStatusChange`.
- Validation gate in `src/validators.js`.
- Field ownership rules in `src/erpOwnership.js`.
- Workflow/status-transition helpers in `src/workflows.js`.
- Role and record-aware permission helpers in `src/permissions.js`.
- Optimistic concurrency support on selected writes through `expectedUpdatedAt`.
- Soft archive/restore for normal business records.
- Demo-only full data purge, guarded to demo/admin only, remains the only intentional hard-delete flow.

Procurement and order control:

- Foreign and local order streams by function: Technical, Indirect, Supply Chain.
- Business Central-style order detail/card page.
- Order form reorganized into operational sections.
- Supply Chain item rows for per-item detailed description and quantity.
- ERP-owned/read-only versus Phoenix-owned/editable field handling.
- Planned-versus-actual timeline fields and editor.
- Order amendments and claims arrays on orders.
- PO line/receipt control present as a control surface without duplicating the full ERP item-line process.
- GRN control through `orders.receipts[]`, with order-level and shipment-linked GRN rows.

Logistics and shipment control:

- Inbound shipment module with service/render/form/detail files.
- Shipment sequencing format such as `FPO12345 (S1)`, `FPO12345 (S2)`.
- Partial/balance/replacement shipment control fields.
- Shipment status list aligned to logistics flow.
- Delivery date at shipment level with GRN fallback for receipt timing.
- One or multiple GRNs per shipment through linked order receipts.
- Container tracker with demurrage/detention exposure.
- Shipment journey view and document-readiness checklist.
- Exports/Outbound module for one-way and round-trip movements.
- TEPS tax provision forecast and actual landed cost variance.

Finance and payment control:

- Payment requests/RFP module with per-entity RFP reference numbering.
- Milestone-driven forthcoming payments forecast.
- Payment schedule on orders with milestone statuses.
- Payment detail and printable RFP.
- Payment request write permissions enforced through `PXStore` and UI permission checks.
- View-only users can view payments but should not be able to create payment requests.

Operational follow-up:

- My Work cross-entity action queue.
- My Day toggle.
- Snooze support for computed actions.
- Contact log collection and log-a-chase flow.
- Update Requests flow from order and shipment rows/details.
- Data Quality Cockpit.
- Exceptions board.
- Procurement follow-up engine in `src/procurementFollowup.js`.
- Working-day calculations using entity working calendars.

Reference, reports, and controls:

- Supplier master with aliases, ERP mappings, contacts, supplier rating, and supplier scorecard support.
- Supplier mapping worklist and guarded supplier bootstrap from ERP vendor codes.
- Officers & Roles under System Settings.
- ERP Reconciliation under System Settings.
- ERP Import Rules and Working Calendars under System Settings.
- Reports & Export, KPI Trends, OTIF Risk Forecast, Officer Workload, Operational Calendar, Management Pack, Exceptions, Data Quality, Supplier Scorecards.
- Management Cockpit reorganized as a control entry point.

Document handling:

- Documents module and document cabinet.
- SharePoint-ready folder path metadata through `PXDocuments`.
- Logical folder structure supports:
  - `<PO No.> - <Supplier Name>` parent folder
  - `PO`
  - `Shipping Documents`, with shipment subfolder when document is shipment-linked
  - `Payment`
  - `GRN`
- Current implementation records metadata, links, status, and small demo upload data. It does not yet upload to SharePoint through Microsoft Graph.

ERP import:

- No-library browser XLSX reader.
- Manual Excel import treated as a staging feed.
- Phoenix Navision FPO/LPO handling.
- Seychelles Breweries Business Central import handling.
- Edena Business Central import handling with EUR local-currency rule.
- Entity/function classification through import rules.
- Supplier mapping by vendor code first, then name/alias fallback.
- Import preview, create/update split, supplier mapping warnings, and structured import history.

Authentication and access:

- Demo build uses demo/anonymous mode.
- Production build is intended to use individual username/password through Firebase Auth.
- Officer profile lookup supports Auth UID document id, `authUid`, and `email`.
- Demo role switching is ignored in production mode.
- Production permission posture fails closed for unknown roles/resources.

## Partially completed work

- SharePoint integration is metadata-ready only. Folder path rules exist, but Microsoft Graph upload, folder creation, delete/rename policy, and permission inheritance are not implemented.
- Data Warehouse integration is a contract and adapter only. `PXWarehouse` defines the target shape and returns "not connected"; the current operational feed is Excel import.
- Firestore security rule templates exist under `docs/FIRESTORE_RULES`, but they have not been deployed or validated against a production Firebase project in this repository.
- Production package generation exists as a process and zip output, but production hosting, Firebase project separation, API-key restriction, and authentication deployment remain IT tasks.
- Visual smoke testing is limited by local Firebase/auth/network behaviour in the desktop browser environment. Build validation passes, but browser role/entity walkthroughs should still be repeated before demo.
- Access grid documentation exists, but the role matrix is broad and should be re-tested after every access-sensitive change.
- Edena import/export support exists in the code path, but it needs business pilot validation with real Edena export samples before it should be considered production-proven.

## Features planned but not started or not production-ready

- Live Data Warehouse/API sync service.
- Microsoft Graph SharePoint upload adapter.
- Azure AD / Microsoft 365 SSO or final corporate identity integration.
- Production Firebase project, hardened rules, API-key restrictions, and HTTPS hosting.
- Automated end-to-end browser regression suite.
- Formal unit tests for import classification, permissions, data quality, and My Work computed actions.
- Server-side audit/reporting pipeline, if required by IT.

## Current known bugs and limitations

- No `package.json`, npm test, lint, or TypeScript configuration exists. Current validation is Python build, generated data dictionary check, structural invariant checks, and Node syntax checks.
- Browser/client-side permission checks are not sufficient for production security. Firestore rules and authenticated identity must enforce access server-side before go-live.
- Demo mode still contains demo aids such as role switching and guarded demo purge. These must stay disabled in production builds.
- SharePoint upload is not live; documents are metadata/link/demo-upload records only.
- Data Warehouse sync is not live; Excel import is the current staging feed.
- Large generated single HTML is expected. Do not edit it by hand.
- Some older docs may describe prototype history; the new continuity docs should be treated as the primary handover map.

## Immediate next development priorities

1. Repeat a visual smoke test of dashboard, entity switching, filter pane, order detail, shipment detail, Exports/Outbound, KPI Trends capture/backfill, payment permissions, and production login mode.
2. Re-test access rules for view-only users, especially payment request creation, exports, KPI capture, and update request visibility.
3. Create automated checks for permission-sensitive actions and My Work disappearing-after-processed logic.
4. Decide the next delivery tranche: either SharePoint adapter design, Data Warehouse/API design, or operational feature polishing. Do not mix these without a milestone boundary.

## Current validation baseline

Last local validation during this handover pass:

- `python build.py` with bundled Node/Python: passed.
- Data dictionary regenerated and checked: passed.
- Structural invariants: passed.
- JavaScript syntax check for all 62 modules: passed.
- Demo build output generated: `dist/phoenix-procurement-DEMO.html`.
- Isolated staged production build with `demoMode: false` and `authMode: 'password'`: passed.
- Demo and production zip packages refreshed with these handover docs included:
  - `Phoenix Procurement DEMO FULL.zip`
  - `Phoenix Procurement PRODUCTION FULL.zip`
- The refreshed demo package contains only `dist/phoenix-procurement-DEMO.html`.
- The refreshed production package contains only `dist/phoenix-procurement-PRODUCTION.html`.

No separate lint, type check, unit test, migration, or Firebase rules validation command exists in the repository at this time.
