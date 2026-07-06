# Phoenix Procurement

A procurement & logistics **control tower** for Phoenix Beverages + group companies
(Seychelles Breweries, Edena). Sits on top of the ERP (Navision now, Business Central
later) — it is **not** a replacement ERP. Firebase/Firestore backed, with demo mode
for testing and individual username/password login for production.

---

## ⚠️ Which file do I edit?  (read this first)

| Category | Files | Edit these? |
|---|---|---|
| **ACTIVE SOURCE** | everything in `/src/**`, `/styles/main.css`, `index.html` | ✅ **YES — this is the source of truth** |
| **GENERATED** | `/dist/phoenix-procurement-DEMO.html` | ❌ **NO — produced by `build.py`; hand-edits are lost on next build** |
| **DOCS** | `/docs/PHOENIX_DEVELOPER_NOTES.md`, `/docs/DATA_DICTIONARY.md`, `/docs/PILOT_TEST_PACK.md` | ✅ keep updated (DATA_DICTIONARY is generated from `src/schema.js` — see below; it lives ONLY in /docs) |
| **DEFERRED WORK** | `/docs/ON_HOLD_REGISTER.md` | ✅ keep updated when a recommendation is parked for later |
| **LEGACY/ARCHIVE** | `/archive/**` (if present) | ❌ not loaded; kept for reference only |

There are **no `*.bundle.js` files in this project** — the old single-file/bundle
structure has been fully split into the `/src` modules below and the bundle files
deleted. See `/archive/README.md` for the rename/split history.

> **Seeing `*.bundle.js` files in your own `/src` folder?** Those are **stale leftovers
> from an older copy** on your disk (unzipping a new version over an old folder does
> not delete old files). They are not loaded by the app. Delete only the seven known
> old bundle filenames listed in `archive/README.md`, or replace the old folder with
> a clean extraction of this package. The active source is only under `/src`.

---

## Build & run

**Edit → build → ship:** run from the project root — the folder that contains
`build.py`, `index.html`, `/src`, `/styles`, `/docs` and `/tools` (this folder is
`phoenix-procurement/`; if you unzip elsewhere, `cd` into wherever `build.py` actually is):
```
python build.py          # regenerates dist/phoenix-procurement-DEMO.html
                         # AND regenerates + verifies docs/DATA_DICTIONARY.md from src/schema.js
```
Requires **Python 3** (no third-party packages). The build runs
`tools/gen_data_dictionary.py --write` then `--check`, so a build fails if the data
dictionary drifts from `src/schema.js`. To regenerate the dictionary alone:
`python tools/gen_data_dictionary.py --write`.

**Run the modular source (development)** — ES modules need `http://`, not `file://`:
```
python -m http.server 8000      # then open http://localhost:8000/index.html
```
(or VS Code "Live Server").

**Run the built app (users / sharing):** double-click `dist/phoenix-procurement-DEMO.html`
(the single generated demo file) — regenerated on every build with identical
content and work on `file://` / OneDrive, no server needed.

---

## Interface theme

The app uses a Business Central-style interface (`src/bcStructure.js`,
`src/bcCardPage.js`, and `src/fastTab.js`) dressed in Phoenix Beverages colours:
French Navy `#002955`, Flesh Ochre `#FD5C25`, and Lucky Orange `#FE9948`.

For visual changes, edit `styles/main.css`. The final section,
`PHOENIX BUSINESS CENTRAL THEME LAYER`, is the first place to adjust brand colours,
top navigation, command ribbons, list grids, FastTabs, and record-page polish.

---

## Source layout (`/src`) — all ACTIVE, all loaded by `build.py` in this order

```
core.js              foundation: REF config (incl. demoResetEnabled), Firebase, state,
                     PXUtils helpers, navigation, modal, live subscriptions
globalProgress.js    PXProgress — persistent, view-independent progress bar used by
                     import / purge / long operations
erpOwnership.js      PXOwnership — ERP vs Phoenix field ownership + Navision/BC field maps
schema.js            PXSchema — programmatic data dictionary (SOURCE for DATA_DICTIONARY.md)
workflows.js         PXWorkflows — allowed status transitions
validators.js        PXValidators — record validation (errors block, warnings confirm)
permissions.js       PXPermissions — record-aware permission checks
firestoreStore.js    PXStore — the ONE write path (centralised, validated, audited)
dataQuality.js       non-blocking record-health controls, working-day helpers, and DQ context (added to PXUtils)
controls.js          PXAmendments / PXClaims / PXDelegation engines
procurementFollowup.js PXProcFollowup — supplier commitments, chase plan, ageing buckets,
                     procurement risk score, and ERP/DW exception checks
importRules.js       approved ERP import-rule baseline + Firestore override resolver
myWork.js            "My Work" personal action queue (single source of My Work counts)
modules/
  dashboard.js       Dashboard + KPIs
  orders/    orders.service.js · orders.render.js · orders.form.js · orders.detail.js
  documents/ documents.render.js — Documents control centre (Records & Archives → Documents): status
             tabs (Active default · Missing · Expiring · Rejected · Archived) + per-PO Folders cabinet
  shipments/ shipments.service.js · shipments.render.js · shipments.form.js · shipments.detail.js
  payments/  payments.service.js · payments.render.js · payments.form.js · payments.detail.js
             forecast.render.js     — Forthcoming Payments view (milestone-driven forecast)
  shipments/ taxprovision.service.js — TEPS tax-provision engine + A/C Excel/CSV export
             taxprovision.render.js  — Tax Provision Forecast — TEPS view
   suppliers/ suppliers.service.js · suppliers.render.js · suppliers.form.js
   officers.js        Officers & Roles
   importRules.js     System Settings screen for ERP import-rule maintenance
   workingCalendars.js System Settings screen for entity holiday calendars; these dates
                     are excluded from working-day controls in Data Quality and My Work
   reports/   reports.service.js · importHistory.js · reports.render.js · reports.form.js
             erpImport.js — LIVE no-library XLSX reader + LIVE PO import engine
                            (PXXlsxReader, PXPoImport: grouped/validated/safe upsert),
                            legacy STATUS-log migration, and the demo-only data purge
operational.js       Documents / Follow-ups / Issues (shared detail sections) + demo file upload
warehouseAdapter.js  PXWarehouse — future Data Warehouse/staging integration contract
erpAdapter.js        PhoenixERP compatibility facade; delegates future sync to PXWarehouse
```

> Two superseded standalone files (`xlsxReader.js`, `poImport.js`) were removed from the
> deliverable to avoid duplicate-purpose files. The live reader/importer is
> `modules/reports/erpImport.js`.

> The load order above is exactly what `build.py` concatenates and what `index.html`
> lists. `forecast.render.js` loads after the payments module (it uses the forecast
> engine in `payments.service.js`); the TEPS files load after payments too, since
> `taxprovision.service.js` reuses the dependency-free XLSX/zip writer exposed by
> `payments.service.js` (`window.__pay_zipStored`).

Split convention: **service** = data/writes, **render** = lists, **form** = create/edit,
**detail** = record detail screen. Cross-file helpers are bridged via `window.__<mod>_<fn>`
(commented where used).

---

## ERP / Data Warehouse integration direction

Target architecture:

```
Navision / Business Central
        -> Data Warehouse / staging views
        -> controlled sync/API service
        -> Phoenix Procurement
```

The browser app should not connect directly to Navision, Business Central, or the warehouse.
The current Excel import is treated as a controlled **manual staging feed** until the Data
Warehouse sync is built. Imported orders are stamped with `integrationLayer`, `warehouseSource`,
`warehouseBatchId`, `warehouseLoadedAt`, and the usual `erp*` provenance fields.

`src/warehouseAdapter.js` defines the future `PXWarehouse` contract and canonical purchase-order
field shape. `src/erpAdapter.js` keeps the older `PhoenixERP` API alive for existing screens, but
its implementation now points to the warehouse path.

See `/docs/DATA_WAREHOUSE_INTEGRATION.md` for the concise IT-facing contract.

ERP/DW-owned fields remain read-only or ERP-seeded in Phoenix. Phoenix-owned operational fields
such as status, shipments, milestones, payment-request workflow, documents, follow-ups, issues,
notes and readiness controls must never be overwritten by the warehouse sync.

---

## Sidebar operational flow (`index.html` sections → views)

The sidebar groups (defined in `index.html`) and the breadcrumb hierarchy (`navSection` in
`core.js`) must stay in sync; page headings should match the group + label.

```
1. Workbench              Dashboard · My Work
2. Foreign Orders         Technical · Indirect · Supply Chain          (views orders-foreign-*)
3. Local Orders           Technical · Indirect · Supply Chain          (views orders-local-*)
4. Logistics Operations   Shipments · Container Tracker · Partial      (shipments · containers ·
                           Shipments · Clearance Readiness               partials · clearance)
5. Finance Control        Forthcoming Payments · Payment Requests ·    (forecast · payments ·
                           Payment Exposure · Tax Provision Forecast      paymentexposure · taxprovision)
6. Records & Archives     Closed Orders · Documents                    (closedorders · documents)
7. Reports & Controls     Management Cockpit · Reports & Export ·       (mgmtcockpit · reports ·
                           Suppliers · KPI Trends · OTIF Risk Forecast ·  suppliers · kpitrends ·
                           Officer Workload · Operational Calendar ·      otifrisk · workload ·
                           Management Pack · Exceptions · Data Quality ·  opcalendar · managementpack ·
                           Supplier Scorecards                            exceptions · dqcockpit · scorecards)
8. System Settings        Officers & Roles · ERP Reconciliation ·       (officers · erprecon ·
                           ERP Import Rules · Working Calendars            erpimportrules · workingcalendars)
```

This is the intended daily flow: start from personal work, control orders, manage logistics,
control finance exposure, file/close records, review management controls, then maintain system
configuration.

> **Documents** sits under Records & Archives but **defaults to Active** documents, with status tabs
> (Active · Missing · Expiring · Rejected · Archived) plus a per-PO **Folders** cabinet —
> archive placement does not mean it only holds old files.

To add/move a nav item: edit the `index.html` `.nav-section` block, add the view to the
`navSection` and `breadcrumb` maps in `core.js`, register a `window.__renderers['<view>']`,
and (if it has a badge) set `#count-<view>` in `updateCounts()`.

> **Card-first lists.** Most list screens (Orders, Shipments, Forthcoming Payments, TEPS,
> Documents status lists) default to a **Cards** view with a **Table** toggle, via
> `window.PXView` (per-list mode in `localStorage`, default cards) and `window.PXCards`
> (`card(spec)` + `grid(html)`) in `core.js`. To card-enable a new list: compute the
> filtered set, then `mode==='cards' ? PXCards.grid(rows.map(card)) : <table>`, drop
> `PXView.toggle(key)` in the page-actions, and call `PXView.bind(key, rerender, root)`
> after render. Keep dense tables for reporting, exports and reconciliation.

---

## Key rules for future work

- **All writes go through `window.PXStore`** (`createRecord`/`updateRecord`/`archiveRecord`/
  `restoreRecord`). Never call `addDoc`/`updateDoc`/`setDoc`/`deleteDoc` directly.
- **PXStore validates automatically** before create/update (errors block; warnings logged).
- **No hard deletes of business records in normal use** — use `archiveRecord` (soft
  delete, audit-safe). The **one** sanctioned hard-delete is the demo-only "Clear all
  data" purge in `modules/reports/erpImport.js`, gated behind `REF.demoResetEnabled`
  (default **false**), admin-only, and a required Backup All. It must stay disabled (or
  be removed) before pilot/production.
- **Documents** can be attached two ways: a SharePoint/OneDrive **link** (recommended —
  files stay governed in M365) or a small **demo file upload** (base64 in Firestore,
  ≤600 KB). The app now stores SharePoint-ready folder metadata through `PXDocuments`;
  on go-live Microsoft Graph creates/uploads to those paths and demo uploads are removed.
- **Procurement follow-up controls** live in `src/procurementFollowup.js`. Use
  `window.PXProcFollowup` for supplier commitments, next chase date, order ageing,
  risk score, and ERP/Data Warehouse exceptions instead of duplicating logic in a screen.
- **Update the data dictionary** when fields change: edit `src/schema.js`, then regenerate
  `docs/DATA_DICTIONARY.md` (see the generator note at the top of that file).
- Full guidance + the 14-point new-feature checklist: `docs/PHOENIX_DEVELOPER_NOTES.md`.
