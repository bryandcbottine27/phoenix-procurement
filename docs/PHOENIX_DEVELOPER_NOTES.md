# Phoenix Procurement — Developer Notes / Handover

**App:** Phoenix Procurement — a procurement & logistics **control tower** for Phoenix Beverages and its group companies (Seychelles Breweries, Edena). It sits *on top of* the ERP (Navision now, Business Central later); it is **not** a replacement ERP.

**Auth model:** Demo mode can use Firebase Anonymous Authentication for prototype testing. Production/password mode uses individual user credentials and links each authenticated user to an officer profile by Auth UID, `authUid`, or `email`.
**Firebase project:** `phoenix-procurement2`.
**Status:** Operational prototype, ERP/Data-Warehouse-ready (read-only integration designed, not yet connected).
**Prototype version:** `prototype-2026.06-stage1` (see `REF.prototypeVersion`).

> This document describes the app as built, after the modular refactor (Stages 1–4).
> It is the first thing a new maintainer should read.

---

## 1. Two ways the app exists

The app now has **one source of truth (the modular `/src` tree)** and **one generated output (a single HTML file)**.

| | Modular source | Single-file build |
|---|---|---|
| Location | `/src/**.js` + `/styles/main.css` + `index.html` | `/dist/phoenix-procurement-DEMO.html` |
| Run by | a local web server (ES modules need `http://`) | double-click / OneDrive (`file://` is fine) |
| Edit? | **Yes — edit here** | **No — generated; never hand-edit** |

**Workflow:** edit `/src` → run `python build.py` → `dist/phoenix-procurement-DEMO.html` is regenerated. That single file runs standalone.

**Running the modular version for development:**
```
cd phoenix-procurement
python -m http.server 8000
# open http://localhost:8000/index.html
```
(or VS Code "Live Server"). The single-file build needs no server.

---

## 2. Module map

Files load in this order (see `index.html` / `build.py`). Modules communicate through a small set of `window.*` globals (see §4) — this is the current wiring (deliberately kept; a future pass may convert to native `import`/`export`).

```
src/
  core.js               REF config, Firebase init, state, PXUtils helpers, navigation,
                        modal, live subscriptions (PXStore now lives in firestoreStore.js)
  firestoreStore.js     PXStore — the ONE write path: validates, stamps, strips undefined, audits
  dataQuality.js        non-blocking record-health controls (orderDataQuality, shipmentDataQuality,
                        rfpDataQuality, supplierDataQuality, orderHealth) plus working-day/DQ-context helpers
  controls.js           PXAmendments / PXClaims / PXDelegation engines (Increment 5a/5c/5d) +
                        claim raise/edit modal handlers — loaded after dataQuality
  procurementFollowup.js PXProcFollowup — supplier commitments, chase plan, ageing buckets,
                        procurement risk score, and ERP/Data Warehouse exception checks
  erpOwnership.js       PXOwnership — who owns each field (ERP vs Phoenix) + Navision/BC maps
  schema.js             PXSchema — programmatic data dictionary for every collection
  workflows.js          PXWorkflows — allowed statuses & transitions per record type
  validators.js         PXValidators — record validation before save
  permissions.js        PXPermissions — record-aware can(action, record, user)
  myWork.js             "My Work" cross-entity personal action queue
  modules/
    dashboard.js        Dashboard + KPI tiles (entity-scoped)
    officers.js         Officers & Roles (incl. Increment 5d delegation fields)
    orders/             orders.service.js  (helpers: MTTO/OTIF, column prefs)
                        orders.render.js   (list views + column manager + renderer registrations)
                        orders.form.js     (create/edit order form; logs amendments on save)
                        orders.detail.js   (order detail screen; Amendments + Claims tabs)
    shipments/          shipments.service.js (requestShipment, addPartialShipment, PXDemurrage)
                        shipments.render.js  (list)
                        shipments.form.js    (form; actual-cost + container-tracker sections)
                        shipments.detail.js  (detail; actual-vs-estimate TEPS card)
                        containers.render.js (Increment 3 Container Tracker view)
                        taxprovision.service.js (TEPS engine + PXLandedCost + A/C export)
                        taxprovision.render.js  (TEPS view incl. actual/variance columns)
    payments/           payments.service.js (nextRfpRef, syncMilestoneFromRfp, buildPaymentsForecast)
                        payments.render.js
                        payments.form.js
                        payments.detail.js   (detail + printable RFP)
                        forecast.render.js   (Forthcoming Payments view — milestone-driven forecast)
     suppliers/          suppliers.service.js (vendor-code matching, performance)
                         suppliers.render.js  (master list, mapping worklist, guarded empty-master bootstrap)
                         suppliers.form.js    (form + computed performance panel)
     workingCalendars.js  System Settings view for per-entity approved holiday dates
     reports/            reports.service.js  (backup helpers, exportAllCSV)
                        importHistory.js    (structured committed-Excel-import audit + cards)
                        reports.render.js   (reports + operational reports + ERP reconciliation)
                        reports.form.js     (backup dialog)
                        dqCockpit.js        (Increment 4 Data Quality Cockpit — PXDataQuality + linked Issue ownership)
                        scorecards.js       (Increment 5b Supplier Scorecards — PXScorecard + view)
  operational.js        Documents / Follow-ups / Issues (shared detail sections)
  warehouseAdapter.js   PXWarehouse — future Data Warehouse/staging integration contract
  erpAdapter.js         PhoenixERP compatibility facade; delegates future sync to PXWarehouse
styles/main.css         all styles
```

**Why `*.service / *.render / *.form / *.detail`?** Each module is split by responsibility:
*service* = data helpers and writes, *render* = list/table views, *form* = create/edit, *detail* = the record detail screen. Where a helper in one file is needed in another (separate `<script type="module">` scopes), it is bridged via `window.__<mod>_<fn>` and re-imported at the top of the consuming file. These bridges are explicitly commented.

---

## 3. Firestore collections

| Collection | Purpose | Ownership |
|---|---|---|
| `orders` | Purchase orders (foreign/local), the spine of the app. | ERP-backed for ERP orders; Phoenix operational fields added. |
| `shipments` | Shipment tracking; one order to many shipment records using `FPO12345 (S1)`, `FPO12345 (S2)` sequencing for partial shipments. | Phoenix. |
| `payment_requests` | RFPs / milestone payments; per-entity auto-numbered. | Phoenix. |
| `suppliers` | Supplier master enrichment + aliases + rating. | Phoenix (becomes ERP-backed when vendor sync is built). |
| `officers` | Team members, roles, function assignment. | Phoenix. |
| `documents` | Document control (links, status, expiry, verification). | Phoenix. |
| `followups` | Follow-up log / next actions. | Phoenix. |
| `issues` | Exceptions / issues. | Phoenix. |
| `status_log` | Append-only audit trail of changes, including structured committed ERP import runs. | Phoenix (system). |
| `system_config` | Counters (per-entity RFP sequence) and shared configuration, including ERP import rules. | Phoenix (system). |

---

## 4. The `window.*` contract (how modules talk)

Set up by `core.js`, consumed everywhere:

- `window.REF` — all static config (statuses, categories, entities, permissions, erpOwnership, expectedDocuments...).
- `window.__state` — live app state: `state.data.{orders,shipments,...}`, `state.officer`, `state.user`, `state.filters`, `state.view`, `state.entity`.
- `window.__db` — Firestore handle.
- `window.PXUtils` — shared helpers (formatters, `can`, entity helpers, `expectedDocsFor`, `computeSupplierPerformance`, `stripUndefined`, ERP field helpers...). Use `PXUtils.bindSearchInput(...)` for list/search bars that re-render their view; it debounces redraws, handles browser search-clear events, and restores focus/caret so typing does not jump or drop characters.
- `window.__renderers['<view>']` — each view registers its render function here; `navigate()` calls them.
- `window.open*` — entry points for forms/details (`openOrderForm`, `openOrderDetail`, `openShipmentForm`, ...).
- **Centralised layers (added in the refactor):** `window.PXStore`, `window.PXSchema`, `window.PXOwnership`, `window.PXWorkflows`, `window.PXValidators`, `window.PXPermissions`.

---

## 5. Centralised Firestore writes — `PXStore` (firestoreStore)

**All creates/updates/archives go through `window.PXStore`** (now in its own `firestoreStore.js`). No module calls `addDoc`/`updateDoc`/`setDoc`/`deleteDoc` directly. **There are no hard deletes of business records** — removal is soft `archiveRecord` (reversible via `restoreRecord`). The only direct Firestore primitive left outside PXStore is the atomic per-entity RFP-counter `runTransaction`. **PXStore is validation-aware**: it runs `PXValidators` before create/update (errors block, warnings logged), so validation is inherited even if a form forgets to call it.

**PXStore also enforces role write permissions.** Create/update/archive/restore now check `REF.permissions` before writing business collections: `orders`, `shipments`, `exports`, `payment_requests`, `suppliers`, `documents`, `followups`, `issues`, `updateRequests`, and `officers`. This is the safety net behind the UI: a view-only role may still open detail screens, but hidden buttons, stale onclicks, or console calls cannot write through PXStore. Controlled side-effect writes use explicit `permissionResource` / `permissionAction` options, e.g. ERP import may update order ERP fields under `erprecon`, supplier mapping may stamp `supplierId` on orders under `suppliers`, and procurement may create a shipment request under `orders:edit` without being allowed to edit logistics details. KPI snapshot writes are limited to the privileged tier through `PXUtils.isPrivileged()`.

> **One sanctioned exception — profile/bootstrap, not a business write.** During sign-in, `core.js` writes the current user's *own* officer profile directly via `setDoc(doc(db,'officers',uid))` / `updateDoc`, because the document ID must equal the Auth UID (PXStore uses auto-IDs) and it runs during identity bootstrap before state is ready. This is identity setup, not a CRUD operation on business data, and it is the only place a direct write is allowed. It will be replaced when real authentication is added. All business records (orders, shipments, exports, payment_requests, suppliers, documents, followups, issues, updateRequests, and contactLog) still go through PXStore exclusively.

```js
PXStore.createRecord(collection, data, opts?)    // + createdAt/By, updatedAt/By, stripUndefined, optional log
PXStore.updateRecord(collection, id, data, opts?) // + updatedAt/By, stripUndefined, optional log
PXStore.archiveRecord(collection, id, reason)     // soft-delete (archived + archivedAt/By + archiveReason)
PXStore.restoreRecord(collection, id)             // un-archive
PXStore.logStatusChange(recordType, recordId, action, details, extraFields?) // append to status_log
```
`opts.log = { recordType, action, details }` writes a `status_log` entry.

**Why:** consistent metadata on every write, and `stripUndefined` is applied automatically — this structurally prevents the "Unsupported field value: undefined" Firestore error class.

---

## 6. Data ownership — `PXOwnership` (erpOwnership)

Phoenix is a control layer, not a second ERP, so field ownership matters.

- **erp-locked** — ERP is the boss; read-only in Phoenix for ERP-sourced records (`orderId`, `supplier`, `currency`, `amount`, `dateOfOrder`, `description`, `iprNumber`, `iprApprovedDate`).
- **erp-seed** — ERP provides a starting value, Phoenix may override (`paymentTerms`, `category`).
- **phoenix** — fully Phoenix-owned operational fields (status, milestones, notes, logistics, documents, follow-ups, issues, dashboards).

`PXOwnership.isEditable(record, field)` is the single answer to "can this be edited here". `PXUtils.fieldEditable` delegates to it. `erpSource` (`Manual`/`Navision`/`Business Central`) is independent of `entity`.

**ERP to Phoenix field maps** (`PXOwnership.navisionMap`, `.businessCentralMap`, `.mapErpToPhoenix(record, source)`) are placeholders the future Data Warehouse sync service will use. No live ERP calls happen in the browser.

---

## 6a. Data Warehouse integration path

The approved target path is:

```
Navision / Business Central
        -> Data Warehouse / staging views
        -> controlled sync/API service
        -> Phoenix Procurement
```

The browser app must not connect directly to Navision, Business Central, or the warehouse.
`src/warehouseAdapter.js` exposes `window.PXWarehouse`, the neutral contract for the future
staging layer. It defines the canonical purchase-order field shape and
`normalisePurchaseOrder(row, opts)` so the later connector can produce Phoenix-shaped order
patches without changing the operational screens.

`src/erpAdapter.js` keeps the older `window.PhoenixERP` facade alive for existing UI calls, but
it now explicitly delegates the future sync/reconciliation path to `PXWarehouse`. Until the
connector exists, it returns a clear "not connected" status and the Reconciliation screen points
users to the current Excel import feed.

New order provenance fields:

- `integrationLayer` — `excel-import`, `data-warehouse`, `warehouse-sync`, etc.
- `warehouseSource` — staging table/view/feed name.
- `warehouseRecordId` — stable staging row identifier where available.
- `warehouseBatchId` — import run or warehouse load batch.
- `warehouseExtractedAt` — when ERP data was extracted into staging.
- `warehouseLoadedAt` — when Phoenix received/loaded the staged data.
- `warehouseHash` — optional row/version hash for future changed-record detection.

Current Excel import is deliberately treated as `integrationLayer: 'excel-import'` with a
`manual-excel:<sheet>` warehouse source and the same `warehouseBatchId` as the structured import
history run. This makes the future switch to Data Warehouse mostly a feed replacement: the
reconciliation screen, badges, and ERP-owned update path already understand staging provenance.

The warehouse/sync service may refresh ERP-owned and ERP-seeded fields according to `PXOwnership`.
It must never overwrite Phoenix-owned operational fields: order status, milestones, shipments,
payment-request workflow, documents, follow-ups, issues, notes, warnings/readiness controls, and
closure decisions.

---

## 7. Validation — `PXValidators`

`PXValidators.validate(kind, data, existing)` returns `{ ok, errors, warnings }`.
- **errors block** the save; **warnings ask "save anyway?"**.
- Wired into every form save **and** enforced again inside `PXStore` (safety net).
- **Hard errors (always genuinely invalid):** amount non-numeric or negative, duplicate shipment references, missing shipment status, unsafe document links (`javascript:`/`data:`), receipt result without a GRN date/link, and impossible date orderings — GRN before ETA, ETA before ETD, expiry before received, and order acknowledged / ready / requested-receipt dates before the order date.
- **Warnings (judgment calls — confirm to proceed):** supplier not in master list, milestones ≠ 100% or amounts not reconciling, payment exceeds order value, closing an order with open issues or missing expected documents, backwards status moves, and historical GRN rows missing receipt dates.
- **TEPS tax-provision inputs (used by A/C for cash provisioning):** *errors* — negative invoiceValue / tepsFreight / insuranceRate / vatRate / exciseDuties, and exchangeRate ≤ 0; *warnings* — alcohol ticked but excise blank/0, invoice value without an exchange rate (CFR understated), and a provision with no meaningful basis (no invoice/freight/excise).
- The split is deliberate: block only data that is never legitimate; let the user confirm everything else.

---

## 8. Workflows — `PXWorkflows`

Allowed status transitions per record type (`shipment`, `payment`, `document`, `followup`, `issue`) plus the order lifecycle order. `canTransition(type, from, to)` returns `{ ok, reason }`. Advisory (surfaced as warnings) so the prototype never hard-blocks legitimate work; tighten as the team confirms the vocabulary.

---

## 9. Permissions — `PXPermissions`

Base resource/action matrix lives in `REF.permissions`; the engine is `PXUtils.can(resource, action)`. `PXPermissions.can(action, record, user?)` adds record-aware rules (e.g. cannot edit a closed order unless admin; cannot edit ERP-locked fields). **UI-layer only** for now — same matrix is intended to drive Firestore security rules once real login is added.

Roles: `admin` (full) plus the stream-specific roles in `REF.permissions` / `REF.viewAccess`:
`procurement_senior_manager`, `sc_manager`, `sc_supervisor`, `sc_officer`,
`procurement_technical_manager`, `procurement_technical_supervisor`,
`procurement_technical_officer`, `procurement_indirect_manager`,
`procurement_indirect_supervisor`, `procurement_indirect_officer`,
`logistics_manager`, `logistics_officer`, `demand_supervisor`,
`demand_officer`, `finance`, `stakeholder`. Legacy generic values such as
`procurement_manager`, `procurement_supervisor`, `procurement_officer`,
`logistics_supervisor`, `accounts`, and `officer` are normalized by `normalizeRole()`.

---

## 10. Multi-entity

`REF.entities` = Phoenix / Seychelles Breweries / Edena (each with short code, accent colour, RFP prefix). Sidebar **entity switcher** scopes Orders/Shipments/Payments/Dashboard/Reports. `entity` field is on orders (editable), and inherited by shipments/payments from the linked order. Legacy records default to Phoenix via `recordEntity()`. RFP numbering is **per-entity** (`PHX/2026/IMP/001`, `SEY/...`, `EDN/...`).

**My Work is deliberately cross-entity** — it shows your actions across all three companies, each badged, with an optional entity filter (default All). It is the safety net, so it does *not* follow the sidebar switcher.

---

## 11. Documents foundation

Document records support: type, required flag, linked parent (order/shipment/payment/supplier), name, URL/link, status (`missing`/`requested`/`received`/`approved`/`rejected`), expiry date + alert days, version, `verifiedBy`/`verifiedAt`, `rejectedReason`, and soft-archive fields.

**Expected documents are configurable** (`REF.expectedDocuments` + `REF.expectedDocumentRules`), resolved by `PXUtils.expectedDocsFor(context, record)`:
- base list per context, plus conditional rules — e.g. **sea to Bill of Lading**, **air to Air Waybill**, **foreign to Bill of Entry / Customs Declaration**, **technical orders to Technical Datasheet**.
- This prevents false "missing document" alerts (no BL demanded on air freight).

**Links are validated** (`PXValidators.isSafeLink`) — `javascript:`/`data:` blocked.

---

## 11b. Forthcoming Payments forecast (milestone-driven, per PO)

A sidebar view ("Forthcoming Payments", `view-forecast`, renderer in `forecast.render.js`)
that surfaces **every unpaid milestone** across open orders — even before its triggering
event has happened, because "we will have to pay anyway".

**Forthcoming payment is per Purchase Order and per milestone attached to it.** The
Accounts (A/C) department reads it PO-by-PO and extracts the milestone lines into their
own payment follow-up sheet, so the **default view is grouped by Purchase Order** (a PO
header with supplier / currency / unpaid total, then its milestone lines beneath). A "By
date" toggle gives the flat date-sorted list for "what's due this week".

Engine in `payments.service.js`:
- `buildPaymentsForecast({entity})` → flat rows (bridged `window.__pay_buildPaymentsForecast`).
- `buildPaymentsForecastByPO({entity})` → grouped by PO (`window.__pay_buildPaymentsForecastByPO`).
- `buildForecastExportRows({entity})` → shared rows for export (single source).
- `buildForecastCSV({entity})` and `buildForecastXLSX({entity})` → **A/C export** as CSV and
  real Excel (.xlsx, written with a dependency-free zip writer — no external libraries).
  One row per PO + milestone. Lean column set (only data Phoenix holds): Entity, PO Number,
  Description, Supplier, Due Date, Milestone, Amount, Currency. A/C uses it to feed their own
  payment forecast — Forthcoming Payments is an indication of amount + approx date, no status.

For each unpaid milestone (`paidDate` empty):
- **forecastDate** = real `computeMilestoneDate(...)` if anchor data exists, else an
  **estimate** by anchor priority: `requestedReceiptDate` → `orderReadyDate` →
  `dateOfOrder + REF.forecastDefaultLeadDays` (60). Estimated rows tagged `est.`.
- **amount** = milestone amount, or the shared percentage allocator. When percentages total 100% and amounts are percent-derived, the final milestone absorbs rounding so the forecast reconciles to the PO total.
- flags `rfpRaised` when an RFP exists but isn't paid; marks `overdue` when past due.

Entity-aware (follows the sidebar switcher); currency summary pills; time-band filter chips
(overdue / ≤30 / 31–60 / 61–90 / 90+ & undated); "Export for A/C (CSV)" button; per-entity
sidebar count (`window.__forecastCount`). Read/computed view — stores nothing new, no schema
fields. Replaces the old manual `forthcomingPaymentDate` as the forecast driver.

---

## 11c. Tax Provision Forecast — "TEPS" (shipments)

Reproduces the logistics team's monthly **TEPS PROVISION** worksheet: per incoming
shipment, the approximate **Excise & Duties + VAT payable to Customs (MRA)** so A/C can
provision cash. Lives **on the Shipment** (a "Tax Provision Forecast — TEPS" section on
the form + a read-only summary on the detail) **and** in its own sidebar view
("Tax Provision (TEPS)", `view-taxprovision`).

Calculation (confirmed against the source workbooks):
- CFR Value = `tepsFreight (MUR) + invoiceValue × exchangeRate`
- Insurance = `CFR × insuranceRate%` (default **0.2%**, editable)
- VAT = `(CFR + Insurance) × vatRate%` (default **15%**, editable)
- Excise & Duties = **manual entry, ALCOHOL ONLY** (`isAlcohol` tickbox + reminder; blank/0 otherwise)
- Total Provision = `VAT + Excise & Duties`

Shipment fields (all Phoenix-owned): inputs `invoiceValue, invoiceCurrency, exchangeRate,
tepsFreight, insuranceRate, vatRate, isAlcohol, exciseDuties`; computed-and-persisted
`cfrValue, tepsInsurance, tepsVat, totalProvision`. **Note the computed VAT/insurance use
the `teps*` prefix** to avoid clashing with the separate Landed Cost section's manual
`vat`/`insuranceCost` fields.

Service `src/modules/shipments/taxprovision.service.js`:
`buildTaxProvision({entity})` (rows + totals, recomputes defensively),
`buildTaxProvisionCSV` / `buildTaxProvisionXLSX` (A/C export — real .xlsx via the shared
`window.__pay_zipStored` writer; sheet "Tax Provision"), `window.__taxProvisionCount`
(sidebar badge). View renderer `taxprovision.render.js`. Export columns mirror the TEPS
sheet: Entity, FPO, Supplier, Mode, Commodity, ETD, ETA, Total Invoice, Currency, Rate,
Freight (MUR), CFR Value, Insurance, Excise & Duties, VAT, Total Provision. Entity-aware.

---

## 11d. PO Import from Excel (manual staging feed)

Until the Data Warehouse sync is ready, open Purchase Orders can be imported from the
Navision/BC Excel export (`List_Of_POs.xlsx`) via the **ERP Reconciliation** page →
**"Import POs from Excel"**. Preview-then-commit; batched writes with progress + cancel.

- `src/modules/reports/erpImport.js` (`window.PXXlsxReader`, `window.PXPoImport`) — the
  live dependency-free .xlsx reader and import engine. It unzips the ZIP (STORED + DEFLATE
  via native `DecompressionStream('deflate-raw')`), parses sharedStrings + worksheets,
  converts Excel serial dates, then handles mapping + classification + upsert:
  - Sheets: **FPO → Phoenix foreign**, **LPO → Phoenix local**, **Seybrew → Seychelles (BC)**,
    **Edena → Edena (BC)**.
  - Only OPEN POs (`PO Closed` ≠ Yes / `Status` ∉ Closed,Cancelled).
  - **Function rules** — Phoenix by `Purchasing Mgr ID` (+ `HOD ID` tiebreak): technical =
    BTHOMAS/BBOTTINE/DCHRISTINE, or DNARAYANEN+HOD GMERLE (DNARAYANEN+other HOD → technical
    fallback); indirect = RADAKEN; supplychain = AA/MCOMBES, or DNARAYANEN+HOD DNARAYANEN.
    Seybrew and Edena primarily by Business Central `Purchaser Code` (equivalent to Phoenix's Purchasing
    Manager ID): BB01/DC01/EJ01/EL01/HB01/VS01/YA01 → technical;
    BR01/MK01/SH01/SL01/SN01 → supplychain; ET01/RA01/TV01 → indirect. `Created By` is a
    fallback only where Purchaser Code is blank: Procurement Technical → technical;
    Procurement Indirects/Robert Adaken → indirect; supplychain/Anousha A Bansropun/
    Dharmarajen Goinden Goundan/Sylvia Arissol → supplychain.
  - **Reference-data rule engine:** the above approved mappings are the built-in baseline in
    `src/importRules.js`. The shared `system_config` record with `configKey: erp_import_rules` overrides
    a matching baseline `ruleKey` (or adds a custom rule), and the live importer reads the effective set.
    The admin-only System Settings screen lets a supervisor store the baseline, edit the match, priority,
    secondary condition, activation and reason. A missing or partially stored rule set still falls back
    to the approved baseline.
  - POs matching **no** function rule are **skipped**.
  - **Upsert by `entity|orderId`**: new → `createRecord`; existing → `updateRecord` of
    ERP-owned fields ONLY (supplier, currency, amount, dates, description, function, orderType,
    paymentTerms, erp* provenance) — never milestones/follow-ups/operational status.
  - Writes go through `PXStore` with `skipValidation:true` (bulk ERP-sourced data), in
    batches of 25 with a yield between batches; `cancelRef` allows stopping mid-import.
  - Imported orders are tagged `erpSource: Navision` (FPO/LPO) / `Business Central` (Seybrew/Edena)
    plus staging provenance, so the ERP badges and reconciliation dashboard treat them as ERP-linked.

---

## 11d. ERP Excel import (manual staging feed)

Until the Data Warehouse sync is ready, POs can be imported from a Navision/Business
Central Excel export via the **ERP Reconciliation** view → **Import POs from Excel**.
Operationally, this is treated as the manual equivalent of the future Data Warehouse/staging feed.
Module `src/modules/reports/erpImport.js`:

- **No-library XLSX reader** (`window.PXXlsxReader.readWorkbook`) — an .xlsx is a ZIP of
  XML; it parses the central directory and inflates entries with the browser's
  `DecompressionStream('deflate-raw')`, then reads sharedStrings + each sheet. No
  external libraries (project rule).
- **`window.PXPoImport.buildCandidates(wb)`** maps OPEN POs to orders:
  - Sheets → entity/type: **FPO**→Phoenix foreign, **LPO**→Phoenix local, **Seybrew**→Seychelles Breweries (BC), **Edena**/**Edena Export**→Edena (BC). A blank BC Currency Code or explicit local code is local (`SCR` for Seychelles, `EUR` for Edena); a populated non-local code is foreign.
  - **Open-only:** FPO/LPO skip `PO Closed = Yes`; Seybrew/Edena skip Status Closed/Cancelled.
  - **Function classification** (POs matching no rule are skipped):
    - Phoenix by `Purchasing Mgr ID` (+`HOD ID` tie-break): BTHOMAS/BBOTTINE/DCHRISTINE → technical; DNARAYANEN→ technical if HOD GMERLE, supplychain if HOD DNARAYANEN, else technical; RADAKEN → indirect; AA/MCOMBES → supplychain.
    - Seybrew/Edena primarily by `Purchaser Code`: BB01/DC01/EJ01/EL01/HB01/VS01/YA01→technical;
      BR01/MK01/SH01/SL01/SN01→supplychain; ET01/RA01/TV01→indirect. `Created By` is a
      fallback only when Purchaser Code is blank: "Procurement Technical"→technical;
      "Procurement Indirects"/"Robert Adaken"→indirect; "supplychain"/"Anousha A Bansropun"/
      "Dharmarajen Goinden Goundan"/"Sylvia Arissol"→supplychain.
  - Field map: No.→orderId, Buy-from Vendor Name→supplier, Currency Code→currency, LineAmount/Amount→amount, Document Date→dateOfOrder, Purpose/Purpose Of Order→description, Requested Receipt Date→requestedReceiptDate, Payment Terms Code→paymentTerms (Seybrew/Edena). `erpSource` = Navision (Phoenix) / Business Central (Seybrew/Edena).
- **`splitNewExisting`** + **`commitImport`** upsert **by PO number**: create new orders
  (status open, empty milestones), or update only the ERP-owned fields on existing ones —
  never touching milestones/follow-ups/operational data. Batched with progress + cancel;
  writes via PXStore (`skipValidation:true` for the bulk feed). Each committed row is stamped
  with `integrationLayer: 'excel-import'`, `warehouseSource: manual-excel:<sheet>`,
  `warehouseRecordId`, `warehouseBatchId`, `warehouseExtractedAt`, and `warehouseLoadedAt`.
  The reconciliation dashboard and ERP badges then treat them exactly as staged ERP orders.
- **Structured import history:** after every committed import, `importHistory.js` adds one
  `status_log` entry with `entryType: erp_import_run`. Its `importRun` map records the
  workbook metadata, source sheets, preview counts, entity/function totals, skipped rows,
  warnings, active rule count, final create/update/failure totals and the first 20 write
  errors. ERP Reconciliation renders the most recent runs as cards with a details dialog.
  A preview alone never writes history; cancelled and partial imports are recorded once the
  commit attempt ends. The existing status-log backup includes these records automatically.

The import also brings across three IPR/claimant fields on Phoenix POs (Created From IPR No.→iprNumber, HOD Approval Date→iprApprovedDate, Requested By→claimant). Order lists now default to a lean column set (Date, PO, Officer, Supplier, Claimant, Description, Amount, Status; Shipment Status / OTIF / Payments for foreign). Shipment Status is computed from linked shipment records and opens the linked shipment detail; the rest stay available via the Columns manager, and the order table CSS keeps the list within the viewport (description wraps, supplier/claimant truncate).

Validated against the sample export: 3,164 open classified POs (FPO 1,020 · LPO 1,729 ·
Seybrew 415), matching the spec rules.

---

## 11e. Danger Zone — clear all data (demo reset)

The ERP Reconciliation view has a **Danger Zone → Clear all data** action
(`window.__purgeAllData` in `erpImport.js`). It HARD-deletes every business record
across **all entities** — orders, shipments, exports, payment_requests, suppliers, documents,
followups, issues, updateRequests, contactLog, kpiSnapshot, and status_log — and **keeps officers/roles and system_config** so
logins/teams survive. Requires typing **DELETE ALL**, shows a count first, batched
with progress + stop. This is the ONLY sanctioned hard delete in the app; it is kept
out of PXStore deliberately (PXStore stays delete-free — removal there is soft archive).
Intended for resetting before a demo, not routine use.

---

## 11f. Global progress bar (long operations)

Long operations (ERP import, Danger-Zone clear-all) drive a fixed, view-independent
progress indicator so it stays visible when the user switches tabs while the operation
keeps running. Component: `src/globalProgress.js` exposing `window.PXProgress.start(label,{onStop}) / update(done,total,detail) / finish(message) / hide()`, backed by the
`#global-progress` element in index.html and `.global-progress` CSS (fixed, bottom-centre,
z-index 9999). The async operations themselves are independent of any view; PXProgress only
mirrors them, and the in-view panels remain as a secondary readout. Both `commitImport` and
`__purgeAllData` call it.

---

## 11g. Legacy tracker fields (migrated from the obsolete workbook)

Fields carried over from the original manual follow-up workbook. Scoping was revised so the
universally-useful fields appear for **all functions and all entities** (Technical, Indirect,
Supply Chain), while import-only logistics fields stay scoped to **foreign** orders.

ORDER (form + detail, ALL functions/entities):
- `quantity` (number) — order quantity. Universal; shown in order form, order detail, a
  toggleable 'Qty' order-list column, and the linked-order summary on shipments. NOT blanked
  for local orders anymore.
- `orderSentToSupplierDate` (date) — date the PO was actually sent to the supplier
- `paymentApproved` (bool) + `paymentApprovedBy` ('AB' | 'MC') + `paymentApprovedDate` (date)
  — the legacy "Approved Request for Payment by AB/MC" sign-off
- Rendered under an "Order Tracking" section (previously "Supply Chain Tracking", previously
  gated to supplychain — gate removed).

SHIPMENT (form + detail, FOREIGN orders only — gate is `linkedOrder.orderType === 'foreign'`):
- `bookingDate`, `shippingDocsDate` (V/S FPO), `invoiceToAccountsDate` (costing),
  `coaPostedDate` (dates)
- `clearanceStatus` (free text, e.g. "UNDER CLEARANCE 07/05/26")
- `containerCount` (number, int)
- Rendered under an "Import / Clearance Tracking" section (was "Supply Chain Tracking").

Description + Quantity are two separate fields and both travel the whole flow (order →
shipment linked-order summary → details).

Currencies: `SCR` (Seychelles Rupee) added to the foreign list (REF.currencies) and to
Seychelles Breweries' LOCAL options are SCR/MUR/EUR/USD; Edena local is EUR only; Phoenix local stays MUR/EUR/USD.

Past-due dates: the order form shows a small non-blocking note under any date input whose
value is already in the past, so already-closed / historical orders can be entered freely.
No validation blocks past dates (only internal-consistency checks remain, e.g. ETA≥ETD).

Save handling: `paymentApproved` defaults false when unchecked; `quantity` parsed as float
(kept for local too); shipment `containerCount` parsed as int; new date fields use the
existing `.endsWith('Date')` coercion. Vessel Name = `vesselFlight` (already surfaced).

---

## 11h. No-shipment orders + grouped order detail

**No-shipment flag.** A `noShipment` (bool) checkbox sits next to Category in the order form
("No shipment required (service / works)"). When ticked, the order is treated as a service /
works order and ALL shipment UI is hidden for it everywhere: the Shipments tab and its content
(order detail), shipment health chip, OTIF badge/column (shows 'n/a'), the "Request shipment"
My Work alerts, the dataQuality "No shipments requested yet" note, and the close-order
checklist's shipment items. Central helper `orderNeedsShipment(o)` on window.PXUtils:
returns false if `o.noShipment`, false for non-foreign orders, true otherwise. All shipment
gates that previously read `o.orderType === 'foreign'` for *should-this-ship* logic now use
this helper (display-only "is this foreign" checks are unchanged). Unchecked checkbox defaults
to false on save.

**Grouped order detail.** The Information tab's single flat kv-grid was replaced with grouped
cards (`.info-cards` / `.info-card`, copper left-border): Order Information, Key Dates,
Financials, Status & Tracking (shows Shipment Required / Not required), and a full-width Notes
card. CSS in main.css (`.info-cards`, responsive to 1 col under 640px). No fields were removed
— only reorganised.

---

## 11i. Payment approval moved to RFP + chronological order detail

**Approval now lives on the Payment Request (RFP), not the order.** The checkbox +
Approved By (AB/MC) + Approval Date were removed from the order form and added to the RFP form
(new "Approval" section) and RFP schema (`paymentApproved`, `paymentApprovedBy`,
`paymentApprovedDate`). The old free-text `approvedBy`/`approvedDate` pair in the RFP form was
removed (one approval mechanism); the RFP detail still falls back to displaying legacy
`approvedBy`/`approvedDate` for historical records. The order's deprecated `paymentApproved`/
`paymentApprovedDate` schema entries were dropped; `paymentApprovedBy` kept as a legacy
display-only stub.

**Order detail reflects approval per RFP.** Since an order can have several RFPs, the order
Financials card lists each linked RFP as "RFP <ref> · <date> · <status>" with a sub-line
"↳ Approval" showing ✓ Approved by AB/MC · date, or "Not approved". Read-only reflection —
captured on the RFP, shown on the order.

**Chronological card reorder (order detail Information tab):**
- Order Information: Supplier, Description, Category, Officer, Claimant, IPR Number, IPR HOD Approved
- Key Dates: Date of Order, Date Requested, Requested Receipt, Order Sent to Supplier, Order Acknowledged, Order Ready Date
- Financials: Amount, Quantity, Payment Terms, Forthcoming Payment, Payment Due, then per-RFP (ref+created date) + approval
- Status & Tracking: Status, State, Type+function, Shipment required?, Linked Shipments, Payment Requests (n approved), MTTO

---

## 11j. RFP approved/paid ticks + rich Status & Tracking

**RFP list ticks.** The Payment Requests list gained two interactive columns just before the
Print column: 'Approved' (`paymentApproved` + `paymentApprovedDate`) and 'Paid' (`isPaid` +
`paidDate`, independent of status). Each shows its date beside the checkbox. Ticking opens a small
date-confirm popover (`window.__openRfpDatePrompt`) defaulting to today so the actual
approval/payment date can be confirmed or changed before saving (the tick date may differ
from the real date). Confirm → `window.__saveRfpFlag(id, flag, true, chosenDate)`; unticking
clears the flag + date immediately. Cancel / outside-click / Escape backs out and re-renders.
All via PXStore.updateRecord (skipValidation). Both are
also editable in the RFP form's Approval section. New schema fields on payment_requests:
`isPaid` (bool), `paidDate` (date).

**Payment creation/view separation.** The Order Detail payment tab now follows the same permission
matrix as the Payment Requests page: `+ Raise RFP`, `+ Retro RFP`, and `+ Create Payment Request` only
render when `can('payments','create')` is true. `openPaymentForm()` also checks create/edit rights
before opening, so direct console/onclick calls cannot bypass the UI. View-only roles, including
Internal Stakeholder, Logistics, Finance, Senior Procurement Manager, and Procurement Manager in the
current matrix, can see whether an RFP exists and whether it is approved/paid, but cannot create or
edit payment requests. The Payment Requests list also renders Approved/Paid as read-only badges unless
`can('payments','edit')` is true. This applies across all entities because payment permissions are
role-based and each RFP inherits its entity from the linked order.

**Status & Tracking card (order detail)** now shows, only when `orderNeedsShipment(o)`, a block
PER linked shipment with: Shipping Terms; Timeline (status, mode, ETD, ETA, vessel/flight);
Shipping Documents (lists only the MISSING expected docs, or 'All received'); Tax Provision
(TEPS) total only; Clearance (clearanceStatus, docs-to-broker, cleared) and KPIs (OTIF vs 10d,
clearance days, GRN). Card goes full-width when shipments exist. CSS: `.ship-track`,
`.ship-track-grid`, `.stk-label/.stk-val`, `.rfp-tick`.

---

## 11k. Card view for shipment & RFP detail

The shipment detail and RFP (payment request) detail were converted from flat
`<h3> + <dl class="kv-grid">` lists to the shared grouped-card layout (`.info-cards` /
`.info-card`, copper left-border) used by the order detail, for visual consistency and
scannability. No fields were added or removed — only re-presented as cards:
- Shipment detail cards: Timeline, Shipping Terms, Shipment Scope & Exception Control,
  Import/Clearance Tracking (foreign only), Logistics Partners & Tracking (only if any
  present), Tax Provision (TEPS), Landed Cost (only if present), Document Checklist
  (badge chips), Clearance.
- RFP detail cards: RFP & Order, Invoice & Amount, Approval & Payment (status + approved +
  paid), IBL & Other.
The header status/KPI badge bar at the top of each detail is unchanged.

Shipment Scope & Exception Control is deliberately a light Phoenix-owned control layer:
coverage, partial/split reason, same-movement/transport-split flags, receipt result,
next action and one short movement summary. It must not duplicate ERP PO lines; Navision /
Business Central remains the item-line source of truth.

---

## 11l. Local milestones (staged payment) + Local/Foreign RFP sub-tabs

Applies to ALL entities (Phoenix, Seychelles Breweries, Edena).

**Local-order milestones.** New `stagedPayment` (bool) field on orders. A "Staged payment"
checkbox in the LOCAL order form (Financials) toggles the milestone panel: ticked → local
order gets the same milestone schedule foreign orders have (auto-seeds from the selected term);
unticked → single payment, no milestones (previous behaviour). Foreign orders always have
milestones (unchanged). Save attaches milestones when `type==='foreign' || (local &&
stagedPayment)`. Downstream gates that were foreign-only now key off milestone PRESENCE so
local staged milestones flow through: My Work reminders, dashboard milestone forecast, order
detail Payments tab + unpaid-milestone health chip. The Forthcoming Payments forecast already
iterated all orders with milestones, so local staged orders appear there automatically.

**Local | Foreign RFP sub-tabs.** The Payment Requests page now has two sub-tabs (Foreign RFPs
| Local RFPs) with counts, filtering the list by type. Type is DERIVED from the linked order's
`orderType` (helper `payType(p)`), no field on the RFP. Default tab 'foreign'; stored in
`state.filters.payments.tab`. New RFPs land in the correct tab automatically once linked.
CSS: `.subtabs` / `.subtab`.

---

## 11m. Data-quality rules hardened to errors

17 of 18 reviewed validation rules were promoted from soft warnings to HARD ERRORS (block save
in the forms). Kept as a confirm-warning: order/shipment/payment STATUS moving backwards —
deliberately, to allow emergency cases (e.g. shipment dispatched before the PO formally reaches
the supplier); the user confirms to proceed.

Now hard errors (block save):
- Order: entity required; supplier required AND must exist in supplier list; requested receipt
  date required; foreign order must have payment terms; milestones must total 100%; cannot
  close with open issues or missing expected documents.
- Shipment: alcohol marked but excise blank/zero; invoice value without exchange rate; TEPS with
  no meaningful basis; ETA without ETD; clearance date without docs-to-broker date.
- Payment (RFP): invoice number required; due date required; total payments cannot exceed order
  value.
- Document: a rejected document must have a reason.

IMPORTANT: the ERP Excel import calls PXStore with {skipValidation:true}, so the bulk upsert of
open POs is NOT blocked by these rules — they apply only to interactive create/edit via the
forms. Consequence: editing a legacy imported order may now require filling
supplier/receipt-date/payment-terms before it can be saved. Re-running the ERP import populates
supplier (and other ERP fields) on existing records — note the source file's "Buy-from Vendor
Name" column is correctly mapped; orders showing a blank supplier were imported before the
mapping was finalised and will fill in on re-import.

---

## 11n. Legacy STATUS-log migration tool

One-off importer in ERP Reconciliation ("⬆ Migrate legacy status log"). Reads the obsolete
workbook's free-text STATUS column (OPEN FOREIGN ORDER col 'STATUS '/FPO No; OPEN LOCAL ORDER
'STATUS '/LPO NO.) and creates a follow-up note (relatedType:'order', officer:'ERP',
status:'done', comment prefixed "[Migrated from legacy tracker] ") on each matching order
(matched by PO number). Preview shows entries found / matched / unmatched; commit writes via
PXStore (skipValidation) with the persistent progress bar. Re-runnable: skips entries whose
identical migrated note already exists. Functions: window.PXStatusMigration.{buildStatusMigration,
commitStatusMigration}. Verified against the legacy file: 172 status entries parsed correctly.

---

## 11o. Demo document upload + Closed Orders page

**Demo file upload.** The document form now offers a file picker alongside the link field. Small
files (<=1 MB) are read to a base64 data URL and stored on the document record in Firestore
(fields: fileData, fileName, fileSize, fileMime) — persists across refresh, multi-user. Opened
via window.__openStoredFile (decodes to a Blob, opens/downloads). The 1 MB cap keeps within
Firestore's ~1 MB document limit; larger files must use a SharePoint link. This is a DEMO of how
storage will work; on implementation the SharePoint link replaces fileData. Documents remain
attached by relatedType (order/shipment/payment) = the Purchase Order / Shipping Documents /
Payment Request "folders", and show in each record's Documents section.

**Closed Orders page.** New sidebar item "Closed Orders" under the "Records & Archives" nav section (own view
`closedorders`), scoped to the current entity. The section is structured to hold more
sub-items later (e.g. archived/soft-deleted records), listing all closed orders across types/functions. Closing an order sets
`isClosed:true` + stamps `closedAt`; it leaves the open lists and appears here, still fully
viewable (row click → openOrderDetail). Sidebar count `#count-closedorders` updated in
updateCounts(). Renderer: renderClosedOrders() in orders.render.js with search + type/function
filters, sorted most-recently-closed first.

---

## 11p. Resizable columns (persisted) + per-PO document folders confirmed

**Resizable columns.** All data tables (cmRenderTable-based: shipments, payments, column-managed
lists; plus the custom orders list and Closed Orders) are now drag-to-resize. Each <th> carries a
.col-resize handle; a single delegated, idempotent listener (initColumnResize() in core.js)
tracks drag and persists widths per list in localStorage key 'phoenix_colw_<storageKey>'
(orders list uses 'orderslist-<viewKey>', closed orders 'closedorders'). Min width 60px. Widths
reload on render. CSS: table.data.resizable th .col-resize, body.col-resizing.

**Per-PO document folders (SharePoint-ready, not live SharePoint yet).** Order documents are grouped
under one future parent folder per PO: `PO Number - Supplier Name`. Under that parent the app uses
four logical folders: **PO**, **Shipping Documents**, **Payment**, and **GRN**
(`REF.documentFolders`; `REF.documentTypeFolder` auto-maps each type to a folder). Shipping
documents linked to a shipment add a shipment sub-folder such as `FPO12345 (S1)`.

The central service is `src/documentService.js` / `window.PXDocuments`. Use it for document links,
presence checks, folder keys, PO parent names, and future SharePoint folder paths. It stamps document
records with `folderLabel`, `poFolderName`, `documentFolderPath`, `sharePointFolderPath`, and
`storageProvider` when a document is saved. It does **not** create SharePoint folders or upload files;
that still requires login + Microsoft Graph. The service exists so that Graph integration can plug
into one place later instead of changing every screen.

---

## 11q. Central Documents page (per-PO folder cabinet)

**What.** Sidebar item **"Documents"** (Records & Archives section, own view `documents`), giving a
single browsable place that lists **one folder per purchase order** for the current entity, instead
of only reaching files by drilling into each order. Scoped to `currentEntity()` like every page
(Phoenix / Seychelles Breweries / Edena).

**How it works (reuse, not rebuild).** `src/modules/documents/documents.render.js` has two states:
- **Folder list** — one row per non-archived order (open *and* closed, so files on closed POs stay
  reachable), with a 📁/📂 folder icon, file count badge, and search / type / function filters plus a
  "With files only" toggle. Folders holding files sort first. Table is `data.resizable`
  `data-colw="documents"` so its columns are user-resizable and persist like every other list.
- **Open folder** — sets `openOrderId` and renders the **exact same per-PO folder UI** from the order
  detail via `window.renderDocumentsSection('order', orderId)` (exposed from operational.js). So the
  PO / Shipping Documents / Payment / GRN sub-folders, the "+ Add to <folder>" upload buttons, the
  expected-documents checklist, and the demo file storage all work identically with zero duplicated
  logic. Shipment/payment documents linked to the same PO are counted under that PO folder by
  `PXDocuments.documentsForOrder(...)`. Header has Back + "Open full order ↗" (`openOrderDetail`).

**Schema.** Reuses the existing `documents` parent fields (`relatedType`, `relatedId`, `folder`,
`fileData`/`fileName`/`fileSize`) and adds SharePoint-ready metadata fields: `folderLabel`,
`poFolderName`, `documentFolderPath`, `sharePointFolderPath`, and `storageProvider`.

**Wiring.** Renderer registered as `window.__renderers['documents']`; globals `window.__openDocFolder` /
`window.__closeDocFolder`. Breadcrumb label added. Sidebar badge `#count-documents` in `updateCounts()`
= number of PO folders (current entity) holding ≥1 stored file. Live refresh: the `orders` and
`documents` `onSnapshot` handlers now re-render the `documents` view, so uploads and new POs appear
without a manual refresh. Build order: added after the orders modules in `build.py` and `index.html`
(calls into operational.js are resolved at runtime via `window.*`, so load order is safe).

**Boundary (unchanged).** This organises and stores files inside the app; it does **not** create real
OS / SharePoint folders on disk — that still needs login + Graph API and stays parked. On go-live the
Graph upload adapter should call `PXDocuments.folderSegmentsFor(...)` / `folderPathFor(...)` and then
store the returned SharePoint URL in `documentUrl`; `fileData` should be disabled or removed.

---

## 11r. Foundation integrity pass

A consolidation pass (no new features) hardening the data model, the ERP import, and the docs.

**1. Data dictionary completeness + anti-drift.** Added the 10 ERP-importer fields to
`src/schema.js` (`erpVendorNo`, `erpVendorName`, `erpAmount`, `erpCurrency`, `erpPoStatus`,
`erpHodId`, `erpPurchasingMgrId`, `erpCreatedFromIpr`, `erpCreatedBy`, `erpShipmentMethod`)
— all `owner: ERP`, `editable: false`, optional. New generator `tools/gen_data_dictionary.py`
regenerates `docs/DATA_DICTIONARY.md` straight from `schema.js` (`--write`) and verifies it
(`--check`, non-zero exit on drift). `build.py` runs both on every build, so the two cannot
drift. (163 fields.)

**2. ERP ownership correction.** The import never writes ERP lifecycle into Phoenix
`status`. ERP lifecycle is mapped to **`erpPoStatus`** (Phoenix: `PO Closed`=YES→Closed/Open;
Seybrew/Edena: the `Status` value). Phoenix `orderType`/`function` remain fill-once on update,
so a re-import cannot overwrite a Phoenix re-classification. Seychelles/Edena Business Central
records are a controlled exception: `Currency Code` corrects local/foreign, while a populated
`Purchaser Code` corrects the procurement function.

**3. Safe Excel import** (`modules/reports/erpImport.js`, the LIVE `PXPoImport`).
- **Grouping + master amount:** line rows are grouped into one PO per `entity|orderId`; the
  master `amount` (and `erpAmount`) is the **sum of the line amounts**. The preview reports
  how many POs were grouped and from how many line rows.
- **De-dup within the workbook:** the same `entity|orderId` is merged, not duplicated.
- **`splitNewExisting` keys by `entity|orderId`** (was `orderId` only) so a Phoenix LPO and a
  Seybrew PO sharing a number never collide.
- **Conflict warnings before commit:** existing orders whose amount, supplier, currency, order type
  or function would change are listed in the preview before anything is written.
- **Import-specific validation:** `validateCandidate()` checks PO number, entity, order type,
  function, currency, and a non-negative numeric amount. Failing candidates are **excluded**
  and listed in an on-screen error report; `skipValidation` is still passed to `PXStore` (the
  ERP-shaped write differs from interactive-form rules) but is **no longer blind** — our own
  validation runs first. Per-row write failures are collected and shown post-commit.
- **Preserve Phoenix data on update:** updates patch only `ERP_OWNED_UPDATE_FIELDS`; status,
  milestones, noShipment, stagedPayment, notes, follow-ups, etc. are never touched.

**4. Demo reset safeguard.** `REF.demoResetEnabled` is disabled by default and is only for isolated demo reset testing. The "Clear all data"
Danger Zone renders only when demo mode is active, `demoResetEnabled` is true, and `currentRole()==='admin'`. The direct purge function also checks this flag. The purge requires
a successful **Backup All** in the session (`window.__backupDoneAt`, set by the JSON/CSV backup)
— the panel shows a "Run Backup All now" button and keeps the **Permanently delete** button
disabled until both the backup is done and `DELETE ALL` is typed. Must be left disabled (or the
purge removed) before pilot — stated in the UI, README, and §12.

**5. Document upload.** Demo base64 cap reduced to **600 KB** (room under Firestore's ~1 MB doc
limit for the rest of the record). UI explains the limit and frames the SharePoint/OneDrive
link as the recommended method. Over-limit and read-failure messages name the file and point to
the link option; the save-failure toast hints at the link when a file was attached.

**6. Documentation & verification.** Corrected stale "no hard deletes anywhere" (one sanctioned
demo purge) and "documents are link-only" (link + demo upload) statements in README and these
notes. README build instructions clarified for the project root and the dictionary regen/verify
step. Module map updated to include `globalProgress.js` and the live
`modules/reports/erpImport.js`. The older `xlsxReader.js`/`poImport.js` files were removed
from the deliverable to avoid duplicate-purpose files; their replacement history is documented
in `archive/README.md`.
Every active source module and every inlined build module parses.

---

## 11s. Operational increment 1 — ERP keys, supplier mapping, pilot pack

First tranche of the operational-improvements programme. Delivered as a verified increment
so the working build never breaks; later tranches add readiness gates, structured-issue
escalation, PO↔payment reconciliation, and the planned-vs-actual timeline.

**Feature 1 — stable ERP identifiers & source tracking.** Added to the `orders` schema:
`erpCompany` (source system instance, e.g. PHOENIX-NAV / SEYBREW-BC), `erpEntityId` (ERP
company code), `erpDocumentId` (ERP internal id/GUID — the preferred stable match key,
populated by the warehouse/sync service), `erpDocumentNo` (ERP document number, may differ from `orderId`).
All ERP-owned, read-only. The importer now stamps `erpCompany` and `erpDocumentNo`; these
plus the new keys are in `ERP_OWNED_UPDATE_FIELDS`, so re-import refreshes them while Phoenix
operational data (status, assignments, follow-ups, documents, issues, milestones) is never
touched — the create/update split from §11r still holds.

**Feature 2 — supplier ERP mapping by entity.** Added to the `suppliers` schema:
`legalName` and `erpMappings` (array of `{entity, erpSource, vendorNo, active}`). The supplier
form (which is also the supplier detail screen) gets a legal-name field and an editable
mapping table — add/remove rows, one per entity/source — so the same supplier can carry a
Phoenix/Navision number, a future Phoenix/BC number, and a Seychelles/BC number. New resolver
`window.PXSupplierMap` (in `suppliers.service.js`): `vendorNoFor(supplier, entity[, source])`,
`findByVendor(vendorNo, entity[, source])`, and `matchSupplier({name, vendorNo, entity, source})`
which tries vendor number first, then exact name/legal-name, then alias — returning
`{supplier, method}`. Read-only over state; manual matching remains possible for exceptions.

**Feature 2a — imported supplier links and master-data control.** The Excel import now calls
`PXSupplierMap.matchSupplier()` for every candidate, using the already available `Buy-from Vendor
No.` as the primary key and the vendor name only as a fallback. The ERP vendor name/code stay on
the order as ERP-owned fields. A separate Phoenix-owned `supplierId` plus `supplierMatchMethod`
(`vendorNo`, `name`, `alias`, `unmatched`, or `manual`) links the transaction to the supplier
master, so a later supplier rename does not split performance history. The import preview reports
unmatched vendors without blocking import. On an update an unmatched import never clears an
existing supplier link. Supplier forms now validate duplicate active mappings, hold structured
contacts, support archive/restore, and manual order entry prevents selection of inactive suppliers;
blocked suppliers require an administrator reason recorded on the order.

**Feature 2b — Supplier Mapping Worklist.** `PXSupplierMap.unmappedImportVendors()` derives a
live queue from non-archived ERP orders with an `erpVendorNo` but no `supplierId`, grouped by
entity, ERP source and vendor code. The Suppliers view presents those groups as operational cards.
An editor can map the code to an existing supplier or create a prefilled supplier master record;
the selected mapping is written through `PXStore` and every affected order is backfilled with the
same `supplierId` / `supplierMatchMethod: 'vendorNo'`. No separate queue collection is stored, so
the worklist always reflects the actual imported data. Duplicate mapping validation still applies,
and the worklist contains no new persisted fields beyond the existing data dictionary entries.

**Feature 2c — reviewable supplier master data and ERP migration dates.** Supplier contacts now
carry optional entity, purpose and escalation level, allowing separate commercial, logistics,
accounts, quality and technical contacts for Phoenix or Seychelles. Vendor mappings now include
optional `effectiveFrom` / `effectiveTo` dates; the resolver respects those dates when matching an
import as of its order date, so Navision and Business Central mappings can coexist through the
migration. Rating changes and review amendments record a reason, reviewer, timestamp, next review
date and append-only history; a reason is mandatory for `watchlist` and `blocked`, and only an
administrator can newly block a supplier. All fields are declared in `schema.js` and regenerated
into the data dictionary.

**Feature 2d — controlled supplier merge.** Only an admin can merge an active duplicate into a
different active supplier. The confirmation requires a reason plus the word `MERGE`. The survivor
receives non-duplicate ERP mappings, contacts, aliases and a `mergedSupplierHistory` entry. Linked
orders, supplier documents, follow-ups and issues are reassigned via `PXStore`; the source is then
soft-archived with `mergedIntoSupplierId`, `mergedAt`, `mergedBy` and `mergeReason`. This is a
cross-collection operation rather than a Firestore transaction, so a write failure stops the flow
and tells the user to review records before retrying; it never deletes the source history.


**Feature 7 — pilot test pack.** New `docs/PILOT_TEST_PACK.md` with 14 end-to-end scenarios
(foreign advance+balance, local staged payment, part shipment, late acknowledgement, delayed
shipment, missing BL/AWB, damaged/short receipt, invoice mismatch, duplicate payment, duplicate
ERP import row, ERP-closed/Phoenix-open, expiring document, critical-issue escalation, closure
with incomplete requirements). Each has setup data, steps, expected result, and a fill-in
Actual/Tester/Date/Pass-Fail/Comments line, plus a result register and a defect log. It doubles
as the acceptance spec for the remaining increments; rows that reference not-yet-shipped
features are marked N/A (pending feature).

**Schema/dictionary discipline.** All six new fields are in `src/schema.js` and regenerate into
`docs/DATA_DICTIONARY.md` (169 fields) via `tools/gen_data_dictionary.py`, which the build runs
(`--write` then `--check`).

---

## 11t. Operational increment 2 — structured issues & escalation (Feature 4)

Turns free-text issues into structured, reportable, escalatable records. Self-contained on the
`issues` collection plus its three surfaces (issue section, My Work, reports).

**Schema (10 new `issues` fields).** `issueCategory` (root-cause), `severity`
(low/medium/high/critical), `impactType` (cost/time/quantity/compliance/quality),
`responsibleParty` (supplier/freight forwarder/customs/internal/ERP-data),
`targetResolutionDate`, `escalationLevel` (0–3), `escalatedTo`, `resolutionCode`, `resolvedBy`,
`resolvedAt`. Option lists live in `REF` (`issueCategories`, `issueSeverities`,
`issueImpactTypes`, `issueResponsibleParties`, `issueResolutionCodes`, `escalationLevels`).
Dictionary now 179 fields.

**Issue form (`operational.js`).** All ten fields added as selects/date/text inputs. Severity
defaults to `medium`. Saving stamps `resolvedBy`/`resolvedAt` once on transition to resolved
(idempotent — won't overwrite an earlier resolution). The quick **Resolve** action stamps them too.

**Issue section table.** New Severity badge (`badgeForSeverity`: critical→danger, high→warn,
medium→info, low→neutral), a Target column that turns red and shows "overdue Nd" when
`targetResolutionDate` has passed on an open issue, and an escalation chip (⬆ L# → code) on the
type cell. Note row shows responsible party + category.

**My Work (`myWork.js`).** The "issues I own" block now also surfaces issues **escalated to me**
(`escalatedTo === myCode`). Each open issue computes ageing (days since opened), overdue
(past `targetResolutionDate`), and criticality; tier is `crit` when overdue / critical / high /
open ≥14 days, else `soon`. The "why" line shows severity, age, overdue/“due in” days, and the
record. A separate **Escalate issue** action appears for overdue-or-critical issues I own that
are not yet escalated (`escalationLevel` 0).

**Reports (`reports.render.js`).** Issue Reports expanded to: Open Issues and **Overdue
Resolution** (full tables, now incl. severity + target columns), Long-Running (>14d), **Issue
Ageing** buckets (0–7 / 8–14 / 15–30 / 30+ days), and breakdowns **by Category, Severity,
Responsible Party, Supplier** (resolved via the linked order), Owner, and Type — all entity-scoped
to the current entity. **By Entity** is an aggregate count across all entities (portfolio KPI; no
cross-entity record detail, so entity scope on records is preserved). Supplier is derived from the
issue's linked order/shipment.

**Cross-cutting.** Entity scope, role permissions (issue create/edit unchanged), audit trail
(writes go through `PXStore`), and backup/export (JSON+CSV serialise whole records, so the new
fields are included automatically) all continue to hold. ERP ownership is unaffected — issues are
Phoenix-owned. Pilot-pack scenarios 7 and 13 now exercise live functionality.

---

## 11u. Operational increment 3 — planned-vs-actual timeline (Feature 6)

A per-order performance timeline across 12 milestones, with delays marked and lead times
computed. Aggregated at the order level (it pulls shipment and payment milestones from the
order's linked records), so it covers "orders and shipments" without per-shipment duplication.

**Schema (2 new `orders` fields).** `plannedDates` and `actualDates` — both objects keyed by
milestone (`{milestoneKey: date}`). `plannedDates` is the planning/commitment layer (Phoenix-set
now, prepared to be ERP/supplier-sourced later). `actualDates` is a small supplementary/override
layer for milestones with no canonical field (departure, arrival) and optional overrides. Dictionary
now 181 fields.

**Milestone definitions (`REF.timelineMilestones`).** Ordered list of 12 — PO created, PO sent,
supplier acknowledgement, goods ready, booking, departure, ETA, arrival, GRN/receipt, invoice
received, payment requested, payment made — each with a `src` telling the engine where the ACTUAL
comes from: `order:<field>`, `ship:<field>:min|max` (across the order's shipments), `pay:<field>:min|max`
(across its payments), or `manual` (from `actualDates`). Single source of truth — actuals are read
from the existing fields (`dateOfOrder`, `orderSentToSupplierDate`, `orderAcknowledgedDate`,
`orderReadyDate`, shipment `bookingDate`/`eta`/`grnDate`/`invoiceToAccountsDate`, payment
`requestDate`/`paidDate`); no double entry. Part shipments: booking/ETA take the earliest, GRN/invoice
the latest, across the order's shipments.

**Engine (`PXTimeline.forOrder` in `orders.service.js`).** Returns `{rows, summary}`. Each row has
planned, actual (with `source`), `delayDays` (actual − planned), and `leadDays` (gap to the previous
milestone with an actual). `summary` gives completed/total, first/last actual, total lead time, late
vs on-time counts, and worst delay. An `actualDates[key]` override always wins. Unit-tested
(14 cases) for derivation, min/max part-shipment handling, delays both directions, lead times, summary.

**UI (Order Detail → Timeline tab).** The pre-existing but empty `timeline` tab now renders: a summary
line, a proportional visual track (dots coloured red=late / green=on-or-ahead / grey=no plan, positioned
between first and last actual), and a resizable table (Milestone · Planned · Actual+source · Delay ·
Lead). An "Edit planned / actual dates" button (gated by `canEditOrders()`) opens an editor for all 12
planned dates plus the manual actuals (departure, arrival); derived actuals are shown as read-only with
their source. Saves write `plannedDates`/`actualDates` via `PXStore`.

**Cross-cutting.** Entity scope and permissions hold (timeline edit = order edit). Actuals stay editable
by Phoenix (existing fields in their own forms; gap actuals in the timeline editor). Audit/export via
`PXStore` and whole-record serialisation. Pilot-pack scenarios 4 and 5 (late acknowledgement, delayed
shipment) now have a live home. CSS: `.tl-track`, `.tl-dot`, `.tl-src`.

---

## 11v. Operational increment 4 — readiness gates (Feature 3)

Pass/fail "Readiness / Missing Items" panels on the three detail screens, reusing the document
(`expectedDocsFor`), issue, milestone and shipment-completion data already in state. No schema change.

**Engine (`window.PXReadiness` in `operational.js`, read-only).** Four gates, each returning
`{gate, gateLabel, checks:[{label, ok, detail}], passed, total, ready}`:
- `forOrderShipment(order)` — PO sent, supplier acknowledgement, supplier/currency/amount, requested
  receipt date, order documents complete.
- `forShipmentReceipt(shipment)` — logistics officer assigned, transport details (vessel/flight or
  mode), ETA, required documents received.
- `forPaymentProcessing(payment)` — invoice number, amount, linked PO, linked milestone (only when the
  order is milestone-based), approval, payment documents.
- `forOrderClosure(order)` — shipments completed or not required, payments completed/closed (no open
  RFPs, no unpaid milestones), no critical/high open issues on the order or its shipments/payments,
  required documents complete (order + each shipment).

Document completeness uses `expectedDocsFor(context, record)` vs received/approved documents (or a
file/link present). `window.renderReadinessPanel(res, {title})` renders the card; CSS `.rd-panel`/
`.rd-row`/`.rd-item`. Unit-tested (9 cases).

**Placement.** Order Detail (Information tab) shows Ready-for-shipment (when it needs shipment and is
open) + Ready-for-closure side by side. Shipment Detail shows Ready-for-clearance/receipt (hidden once
completed). Payment Detail shows Ready-for-processing (hidden once paid). Pilot-pack scenarios 3, 4, 6,
9 and 14 now exercise live functionality.

---

## 11w. Operational increment 5 — PO Financial & Receipt Control (Feature 5)

A new **Financial** tab on Order Detail giving one controlled view of ordered / received / invoiced /
requested / paid for a PO. No schema change.

**Engine (`window.PXFinancial.forOrder(order)` in `orders.service.js`, read-only).** Returns the PO
amount/currency, ordered quantity and PO-line count, a **by-currency** breakdown
`[{currency, poAmount, requested, approved, paid, outstanding}]`, the linked RFPs, receipt status
(shipments / with-GRN / completed), and a `warnings` list. Requested = non-rejected RFPs; approved =
approved-or-paid; paid = isPaid-or-status-paid; outstanding = PO amount − paid (per currency), or
requested − paid for non-PO currencies.

**Currency rule.** Values are grouped strictly by currency — never summed into a mixed unlabelled
total. Base-currency conversion is intentionally **not** computed because no exchange rate + rate date
+ source is recorded on orders today (`hasFx:false`); the tab states this explicitly. (When an FX
source is added later, the engine returns `hasFx` and the tab can show a converted line.)

**Warnings.** Over-payment (paid > PO amount), paid > approved, requested > PO amount, duplicate
invoice number across RFPs, a milestone with multiple paid RFPs, RFP currency ≠ PO currency, and
payment-made-but-no-GRN. Unit-tested (11 cases incl. multi-currency separation).

**UI.** Tab button + `#tab-financial` panel + switch-array entry. Renders a control-warnings block, the
by-currency table, and the RFP table (click-through to payment detail). Pilot-pack scenarios 8 (invoice
mismatch) and 9 (duplicate payment) now have a live home.

---

## 11x. UI/navigation refinement — part 1: sidebar restructuring (Priority 2)

Regrouped the sidebar and reframed Documents. No data/schema change.

**Sidebar groups (`index.html`).** The active sidebar follows the operational sequence:
**Workbench** (Dashboard · My Work), **Foreign Orders**, **Local Orders**, **Logistics Operations**
(Shipments · Container Tracker), **Finance Control** (Forthcoming Payments · Payment Requests · Tax
Provision Forecast — TEPS), **Records & Archives** (Closed Orders · Documents),
**Reports & Controls** (Reports & Export · Suppliers · Data Quality · Supplier Scorecards), and
**System Settings** (Officers & Roles · ERP Reconciliation · ERP Import Rules · Working Calendars).
The generic `.nav-item → navigate()` handler and CSS-driven responsive sidebar mean regrouped items
work unchanged on mobile; existing functionality is untouched.

**Breadcrumbs (`core.js`).** `navSection` maps each view to the same operational section and the
breadcrumb renders `Section › Page` (e.g. *Finance Control › Forthcoming Payments*). CSS:
`.crumb-section` / `.crumb-sep`.

**Documents control centre (`documents.render.js`).** Rebuilt as a status-tabbed control centre
that **defaults to Active** so the Records & Archives placement never implies "old files only". Tabs:
Active (default) · Missing · Expiring · Rejected · Archived · Folders. The status tabs show a
flat, searchable, entity-scoped document list with click-through to the parent record; **Missing**
computes expected-but-absent required documents via `expectedDocsFor` across the entity's orders,
shipments and payments; **Folders** is the existing per-PO cabinet (with its search/type/function
filters and the per-PO upload UI) unchanged. Tab counts shown in the bar. The sidebar **Documents
badge** now counts active documents in the entity (was folders-with-files). CSS `.doc-tabs`/`.doc-tab`.

**Docs.** README carries the Sidebar operational flow (groups → views) and a note that Documents
defaults to Active; module-map entry and TEPS label updated.

> Part 2 (card-first interface with a Cards/Table toggle across Dashboard, My Work, Orders,
> Shipments, Forthcoming Payments, TEPS, Documents, Data Quality Cockpit, etc.) follows as the next
> verified increment. The nav hierarchy settled here is what those card headings will stay consistent with.

---

## 11y. UI/navigation refinement — part 2: card-first interface (Priority 1)

A reusable card system with a per-list **Cards / Table** toggle (default Cards). No schema change.

**Engine (`core.js`).**
- `window.PXView` — per-list view mode persisted in `localStorage` under `phoenix_view_<key>`
  (default `'cards'`). `mode(key)` / `set(key,m)` / `toggle(key)` (renders the segmented control) /
  `bind(key, rerender, root)` (wires the toggle buttons to re-render).
- `window.PXCards` — `card(spec)` renders one consistent, scan-friendly card; `grid(html, emptyMsg)`
  lays cards out in a responsive `auto-fill minmax(280px,1fr)` grid with an empty state. The card
  spec carries exactly the operational-decision fields requested: `ref`, `entity` (+`entityAccent`),
  `title`, `supplier`, `statusBadge`, `severity`, `badges[]`, `dates[]` (with per-date `overdue`),
  `amount` (pre-formatted, currency-aware), `owner`, `note` (missing item / next action), and a
  string `onclick` + `actionLabel` for the open-detail button. Cards are never nested — one record
  per card. CSS: `.view-toggle`/`.vt-btn`, `.px-card-grid`, `.px-card` and children.

**Pattern.** Each list computes its filtered/sorted/entity-scoped set exactly as before, then:
`const mode = PXView.mode(key); body = mode==='cards' ? PXCards.grid(rows.map(card)) : <table>;`
plus `PXView.toggle(key)` in the page-actions and `PXView.bind(key, rerender, root)` after render.
Search, filters, sorting, entity scope, exports and click-through are shared by both views because
they run before the body is chosen.

**Screens with the toggle (default Cards):** Foreign/Local Orders (`orders-<view>` key, card shows
PO, entity, supplier, status, PO/need-by dates with overdue, amount, officer, and an "awaiting
acknowledgement / past receipt date" note), Shipments (`shipments`: stage + status, ETD/ETA/GRN with
overdue-ETA, landed cost, logistics officer, unassigned/past-ETA note), Forthcoming Payments
(`forecast-view`, orthogonal to the existing PO/flat grouping: forecast date + overdue, days-until
badge, amount, RFP-raised badge, estimate note), TEPS (`teps-view`: total provision as the headline
amount, VAT/Excise/CFR note, ETA, alcohol-excise badge — totals stay in the KPI pills), and the
Documents control-centre status lists (`documents-status`: type, file/link, parent record, status,
expiry with overdue, click-through to the record; Missing tab shows missing-required cards).

**Dense tables kept** for reporting, exports, the PO line-level and financial reconciliation tabs in
Order Detail, and large multi-column datasets — the Table toggle restores the full resizable tables
on the list screens, and the Documents **Folders** cabinet stays a table index.

**Already card-style (no toggle needed):** My Work action items render as `.action-item` cards and
the Dashboard alerts render as alert cards. The **Data Quality Cockpit** is a deliberately dense
reporting table rather than a card-toggle screen: its job is to scan, sort, assign, and close a large
number of findings and linked Issue actions efficiently. It is available under Reports & Controls and reuses the
same record-health rules shown in detail screens.

Engine is unit-tested (14 cases: default-cards, persistence, toggle state, all card fields, HTML
escaping, grid + empty state).

---

## 12. Archive (soft-delete)

Documents, follow-ups, and issues use **soft archive**, never hard delete: `archived`, `archivedAt`, `archivedBy`, `archiveReason`. Each section has a **"Show archived (n)"** toggle and a **Restore** button on archived rows. Archived records are hidden by default, excluded from counts/reports, but kept for audit and included in backups.

Business records (orders, shipments, exports, payment_requests, suppliers) are likewise removed by
**soft archive only** in normal use — the "Archive" button on each form calls
`PXStore.archiveRecord`, and the list views hide archived rows.

**One sanctioned exception:** the demo-only "Clear all data" purge in
`modules/reports/erpImport.js` hard-deletes business records to reset an isolated demo
database. It is gated behind demo mode plus `REF.demoResetEnabled`, shown only to
admins, requires a successful **Backup All** first, and keeps the typed `DELETE ALL`
confirmation. It must be disabled (or removed) before any pilot/production use. `PXStore`
itself remains delete-free by design — the purge calls `deleteDoc` directly and is the only
place that does.

---

## 12b. Operational increment — PO line-level fulfilment, receipt & closure control

A PO can arrive in parts across several shipments, so a single GRN must not mark a PO fully
received or closeable. This adds a controlled, Phoenix-owned receipt layer over the read-only ERP
line master.

**Schema (orders).**
- `lines[]` — **ERP master, read-only.** Item: `{lineId, lineNo, itemNumber, description,
  orderedQty (alias of legacy quantity), uom, unitCost, lineAmount, cancelledQty,
  expectedDeliveryDate}`.
- `receipts[]` — **Phoenix, controlled.** One GRN event per item:
  `{receiptId, lineId, shipmentId, grnRef, grnDate, receivedQty, exceptionApproved,
  exceptionReason, exceptionApprovedBy, notes, recordedBy, recordedAt}`. (Array-element timestamps
  use an ISO string, not `serverTimestamp()` — Firestore forbids sentinels inside arrays.)
- `lineTracking[]` — **Phoenix, controlled.** Per-line operational state:
  `{lineId, closed, closureReason, exceptionApproved, notes, updatedBy, updatedAt}`.

All three are documented (with item structure) in `DATA_DICTIONARY.md`, regenerated from `schema.js`.

**Engine `window.PXLineFulfilment.forOrder(order)`** (orders.service.js, read-only). Per line:
ordered, cancelled, received (Σ receipts), remaining (ordered − cancelled − received), linked
shipment(s), GRN refs, expected vs actual receipt date (latest GRN), and status
`open / part received / received / cancelled`. Warnings: over-receipt without an approved exception
(**error**), line closed with remaining (**warn**), and an order-level orphan-receipt warning when a
receipt has no valid linked line. Rollup exposes `openLines`, `canClose`, `errors`. Unit-tested (13
cases).

**Controls.**
- *PO Lines tab* in Order Detail: per-line dense table (kept as a table — line-level receipt
  comparison) + a fulfilment banner; a per-line **Manage** modal records receipts (qty, GRN ref,
  date, linked shipment, over-receipt exception) and sets per-line closure + reason. All writes go
  through `PXStore.updateRecord('orders', …)` (audit + entity scope preserved).
- *Validation* (`validators.js`): closing an order is **blocked** while any PO line is open, or while
  an over-receipt has no approved exception. The receipt modal blocks an over-receipt unless the
  exception is ticked, and requires a GRN ref or date.
- *My Work*: open lines past expected delivery date raise a tiered action; an unresolved over-receipt
  raises a critical action.
- *Reports*: a **PO Line Fulfilment** section (Open Lines, Open Past Expected Date, Over-Receipt
  needing exception, Part-Received) with click-through to the order.

ERP line master remains read-only; only the Phoenix arrays drive the operational position, so a
future ERP sync can overwrite `lines[]` without touching receipts or closure decisions.

---

## 12c. Operational increments 2–5 — landed cost, containers, data quality, controls

Five operational features added on top of the line-fulfilment increment, each shipped one at a
time (build → verify → ship), every change applied universally across all three entities.

**Increment 2 — Actual landed cost vs TEPS estimate.**
Three new shipment fields (`actualLandedCostMUR`, `actualLandedCostDate`, `actualLandedCostNote`).
Engine `PXLandedCost` (in `taxprovision.service.js`) exposes `forShipment(s)` →
`{estimate, actual, variance, variancePct, outstanding}` and `buildActualSummary({entity})`.
"estimate" is the TEPS `totalProvision`; variance = actual − estimate (positive = overspend vs
provision). "outstanding" = GRN recorded + has TEPS + no actual yet. Surfaced in: the shipment
form (live variance bar), shipment detail TEPS card, the TEPS view (Actual/Variance columns +
net-variance & outstanding KPI pills), the A/C Excel/CSV export (6 new columns), a soft validator
warning when a GRN is set with no actual, and a My Work card.

**Increment 3 — Container demurrage / detention tracker.**
Seven new shipment fields (`portArrivalDate`, `demurrageFreeDays`, `containerPickupDate`,
`detentionFreeDays`, `containerReturnDate`, `demurrageRatePerDay`, `detentionRatePerDay`,
`trackerCurrency`). Engine `PXDemurrage` (in `shipments.service.js`) runs two clocks — demurrage
(port arrival → pickup) and detention (pickup → empty return) — each `clear / warning(≤3 free days
left) / overdue / closed / inactive`, with projected exposure when per-day rates are entered. New
**Container Tracker** view (`containers.render.js`, sidebar under Logistics Operations) lists all active sea
shipments with a port-arrival date, ranked worst-status first. Form section (sea + foreign only)
shows a live status bar. My Work raises `crit` for overdue, `soon` for at-risk.

**Increment 4 — Data Quality Cockpit.**
Engine `PXDataQuality` (`dqCockpit.js`) aggregates the existing
`orderDataQuality / shipmentDataQuality / rfpDataQuality` helpers into per-record scores
(100 − critical×10 − warn×3 − info×1) and per-collection averages. The **Data Quality** view under
Reports & Controls shows score pills plus click-through issue tables; sidebar badge = critical-issue count.
Findings are always calculated from the live source record. An officer can explicitly assign one
finding to an owner, target date, and notes; this creates a normal linked `issues` record rather
than changing operational data. The issue adds `dataQualityKey`, `dataQualityMessage`, and
`dataQualityLevel`: the stable key prevents duplicate actions for one finding, while the message
and level preserve the original context. Existing Issue status, escalation, resolution, and My Work
behaviour are reused. A closed order is only retained in the cockpit when it has unpaid milestones,
so the closed-order financial control can genuinely be actioned.

**Data Quality operational warning pack.** `dataQuality.js` is the single home for non-blocking
daily follow-up controls. `workingDaysBetween`, `workingDaysSince`, and `workingDaysUntil` exclude
weekends and the approved holiday dates entered for the relevant entity in **System Settings → Working
Calendars**. Holidays are deliberately maintained by an administrator rather than inferred from a
country calendar, because public and company closure dates must be confirmed locally. The central `dataQualityThresholds`
object currently applies: acknowledgement 3 working days, no order activity 5, ready-without-shipment 2, shipment without
ETD 5, ETA clearance readiness 7, port-arrival clearance start 3, clearance delay 5, release to
delivery 7, delivery to GRN 2, payment draft/submitted 2, payment due look-ahead 7, and ERP sync
freshness 3. These thresholds are deliberately easy to change in one place.

The controls cover acknowledgement/readiness/receipt and shipment-plan gaps; Supply Chain item
completeness; payment-schedule, advance-RFP, payment approval/due/reference controls; shipping
departure/arrival, clearance, release, GRN, document and ETA-change controls; closed-order
blockers; ERP freshness, vendor mapping and value mismatches; and recurring supplier exception
patterns. Existing Container Tracker, ERP Reconciliation, Readiness, Supplier Scorecards, and
Issue workflows remain the specialist views; the cockpit creates one assignable Issue only for a
specific current finding. A clearance-delay finding is suppressed while an open Issue is already
logged for that shipment, preventing duplicate follow-up work.

New Phoenix-owned fields are `orders.incoterm`, `orders.plannedShipmentMode`,
`orders.plannedFreightForwarder`, `orders.shipmentPlanNotes`, `shipments.actualDepartureDate`,
`shipments.actualArrivalDate`, `shipments.etaChangeHistory`, `shipments.clearanceOwner`,
`shipments.clearanceStartDate`, `shipments.customsReleaseDate`, `shipments.deliveryDate`, and
`payment_requests.invoiceDate`, `payment_requests.paymentReference`. ETA history is added automatically only when a previously
entered ETA changes; the initial ETA is not counted. Open Issues already surface in My Work from
the first overdue day; at 3 working days overdue an un-escalated Issue also receives a specific
escalation action, meeting the three-day maximum without silently changing the Issue record.

**Procurement follow-up control tranche (15 controls).** `src/procurementFollowup.js` exposes
`window.PXProcFollowup`, a read-only calculation engine for supplier commitments, next chase dates,
order ageing, risk score, and ERP/Data Warehouse exceptions. It is loaded after Data Quality /
controls and before My Work, Dashboard, Reports, and Orders so every screen uses the same answers.

The 15 controls represented by the engine are: supplier acknowledgement SLA; supplier promised date;
supplier revised promise; promise revision count; next supplier chase; no recent order activity;
requested receipt risk; ready goods without shipment; shipment ETA/ETD discipline; clearance
readiness; released cargo delivery/GRN; payment milestone/RFP exposure; ERP/Data Warehouse
exceptions; supplier master mapping; and closure blockers / overall risk.

New Phoenix-owned order fields are `supplierPromisedDate`, `supplierRevisedPromisedDate`,
`supplierPromiseRevisionCount`, `supplierDelayReason`, `lastSupplierFollowupDate`,
`nextSupplierFollowupDate`, `followupMethod`, `followupFrequencyDays`, `supplierReplySummary`,
`orderCriticality`, `escalationOwner`, `escalationDate`, and `escalationLevel`. They are declared in
`src/schema.js`, included in `REF.erpOwnership.appOwned`, and therefore must never be overwritten by
the future ERP/Data Warehouse sync. The order form has a dedicated **Supplier Commitment & Follow-Up**
section for these fields. Order detail shows risk/ageing badges plus a Procurement Follow-Up card.
Order lists get a compact visible Risk column plus optional Ageing, Next Follow-Up, Supplier Promise,
Criticality, and ERP/DW Exception columns. Dashboard adds High-Risk Orders, Supplier Follow-ups Due,
Promise Overdue, and ERP/DW Exception metrics plus Risk & Ageing / Supplier Chase panels. My Work
raises personal actions for due/overdue chases, overdue promises, high/critical risk, and ERP/DW
exceptions. Reports & Export adds follow-up columns and a Procurement Follow-up Control report.
ERP Reconciliation reuses the same exception engine.

**Working Calendars.** One Phoenix-owned `system_config` document with
`configKey: 'business_calendars'` stores an array of `{entity, holidays:[{date,label}]}`. The
**Working Calendars** System Settings view presents one card per entity and permits administrators
to maintain unique, approved holiday dates. No dates are populated automatically; until dates are
entered, working-day calculations remain weekdays-only. `core.js` subscribes to this configuration
and re-renders the calendar view, Data Quality Cockpit, and My Work when it changes. This means the
same entity-aware calendar governs acknowledgement, follow-up, shipment, clearance, payment, ERP
freshness, and Issue-escalation thresholds.

**Supplier master bootstrap.** The Supplier Mapping Worklist remains the normal reviewed route for
linking an ERP vendor to an existing supplier master. A one-time **Bootstrap Supplier Masters**
action appears only while there are no active supplier records. It groups only exact normalised ERP
display-name duplicates, creates one Phoenix supplier master per resulting group with its stable
entity/source/vendor-code mapping(s), then links the affected imported POs. It intentionally does
not use fuzzy matching or merge similar legal names. The operator must type `BOOTSTRAP <count>`;
the operation uses the global progress control, can stop between supplier masters, and logs each
created master. Once a master exists, the bulk action is unavailable and normal controlled mapping
applies. Supplier attributes such as contacts, country, payment terms, rating, and aliases remain
for later enrichment.

**Increment 5 — Amendment control, scorecards, claims, delegation.**
- **5a Amendments** (`controls.js` → `PXAmendments`): orders gain an `amendments[]` audit array.
  On save, `diff(existing, next, byCode)` detects changes to 8 watched PO fields, prompts for a
  reason, and logs `{field,label,oldValue,newValue,reason,amendedBy,amendedAt}`. Shown in a new
  **Amendments** tab on order detail.
- **5b Scorecards** (`scorecards.js` → `PXScorecard`): per-supplier rating =
  OTIF×0.4 + DQ×0.3 + punctuality×0.3, with OTIF, avg delay, spend, open claims. New
  **Supplier Scorecards** view under Reports & Controls.
- **5c Claims** (`controls.js` → `PXClaims`): orders gain a `claims[]` array
  (`{type,amount,currency,status,raisedDate,resolvedDate,raisedBy,assignedTo,note}`). New
  **Claims** tab on order detail with raise/edit modals; open claims surface in My Work.
- **5d Delegation** (`controls.js` → `PXDelegation`): officers gain `delegateToCode`,
  `delegateUntil`, `delegateReason`. `activeFor(code)` / `delegatedTo(code)` drive My Work cards
  so a delegate sees the absent officer's queue; set in the Officer edit form.

New modules added to `build.py` / `index.html` load order include `src/controls.js` (after
`dataQuality.js`), `src/procurementFollowup.js` (after `controls.js`), `src/modules/shipments/containers.render.js` (after `shipments.detail.js`),
`src/modules/reports/dqCockpit.js` and `src/modules/reports/scorecards.js` (after `erpImport.js`).
Schema is generated from `src/schema.js` and currently has 276 fields. Sidebar count hooks added to `core.js`
(`__demurrageAtRiskCount`, `__dqCriticalCount`); view-name and nav-section maps updated for the
three new views (`containers`, `dqcockpit`, `scorecards`).

**Validator leniency for historical / imported POs.** Two relaxations in `validators.js` so that
bulk-loaded and previously-closed orders are not blocked on edit/re-save:
(1) the "supplier not in the supplier list" check is a confirmable **warning**, not a hard error —
ERP/manual orders routinely introduce a supplier before it is added to the master list;
(2) when an order is closed/historical (`data.isClosed` or the existing record `isClosed`), the
three live-workflow completeness rules — requested-receipt-date required (#12), foreign payment
terms required (#13), milestones-total-100% (#3) — are demoted to confirmable **warnings**.
Genuine integrity rules remain hard errors for all records: required order id / entity / supplier,
numeric and non-negative amount, dates not preceding the order date, and all closure controls
(open issues, missing expected documents, open PO lines, unresolved over-receipt). Live (open)
orders therefore keep their full guardrails; only historical records are treated leniently.
Note: the live bulk-import path (`erpImport.js`) already calls
`PXStore.createRecord(..., { skipValidation: true })`, so the import itself is not blocked —
this leniency is specifically for the form save path when a user later opens and edits an
imported historical PO.

**Payment terms — free-text combo + non-blocking validation.** Navision/BC payment terms are
frequently ad-hoc (especially with mixed milestones), so the order form's Payment Terms field is
an **editable combo** (`<input list=…>` + `<datalist>` of `REF.paymentTerms`), not a fixed
`<select>`. Officers can pick a standard term or type any custom term, and the entered value is
preserved verbatim through save and milestone generation. Picking a known term still auto-generates
the milestone schedule (`change` event → `generateMilestonesFromTerm`); an unrecognised term yields
an empty schedule and prompts the officer to set milestones manually. Validator #13 (foreign order
must have payment terms) is now always a confirmable **warning**, never a hard error — independent
of the closed/historical leniency above. The previous fixed dropdown silently dropped any
ERP/custom term not in the 30-item list; the combo fixes that data-loss path.

**Payment terms editable until an RFP is issued.** The terms combo (and the milestone schedule)
stay freely editable until a payment request has actually been issued against the order. `anyRfpIssued`
is true when any milestone carries an `rfpRef` or `paidDate`, or any non-archived, non-rejected
payment request references the order; only then is the field `readonly` (with a "🔒 Locked" hint
telling the user to reject/remove the RFP to change it). A *rejected* RFP does not lock the term.
This replaces the earlier behaviour where the milestone-regen guard silently reverted the term even
when no RFP existed, which read as "can't be changed once selected". Custom/unrecognised terms are
accepted (officer sets milestones manually); the term field is `readonly`, not `disabled`, so the
value still submits and a locked term is preserved verbatim on save. The standard terms remain
available as datalist suggestions; "custom" is conveyed in the field hint rather than as a literal
list entry (a datalist cannot carry a non-selectable label).

---

## 13. My Work / counts consistency

`updateCounts()` (sidebar badges) is entity-scoped for orders, shipments, payments, suppliers, documents and closed orders; the My Work badge is computed through the same My Work count helper and follows its active-entity badge behaviour. The My Work page itself filters every section by the chosen entity chip.

**Reports & Controls follows the sidebar entity switcher** (like the Dashboard, not cross-entity). Every report — the order/shipment/payment dataset tables, the summary metrics, the operational reports (documents/follow-ups/issues), the missing-required-documents sweep, supplier reporting, and the "Export CSV (current view)" — is scoped to `currentEntity()`. Shipments/payments resolve their entity from their own tag or their linked order; documents/follow-ups/issues resolve via their parent record; suppliers are per-entity and scoped directly by their `entity` field. There is no entity dropdown in Reports any more — a read-only badge shows the active entity. "Backup All" remains a deliberate all-entities full export.

**Action Required is single-select by tier.** The summary pills (Overdue/Critical, Due Soon, Upcoming, Waiting on Others) are clickable filters: only the chosen tier's group renders, not all at once. The choice persists per browser in `localStorage['phoenix_mywork_tier']` (default `crit`) via `window.__setMyworkTier`. If the remembered tier is empty for the current entity, it falls back to the first non-empty group so the panel is never blank. The pill counts always reflect the full set; the filter only changes which group is listed below.

---

## 13b. Bulk update on the order list

Repetitive status/date updates (the most common officer complaint — e.g. "these five shipped Tuesday") are handled by multi-select bulk update on the order list, table mode only. Each list row carries a checkbox (plus a select-all in the header); selecting any row reveals a bulk-actions bar showing the count, a "Bulk update…" button, and Clear. The bar and checkboxes only appear when `canEditOrders()` is true. Clicking a row's data cells still opens the order; only the checkbox cell is exempt (`event.stopPropagation()`).

`openBulkUpdateModal(ids, onDone)` (in `orders.render.js`) lets the user pick one field and one value to apply to every selected order. Bulk-settable fields are operational and Phoenix-owned: Current Status, Order Sent to Supplier, Order Acknowledged, Order Ready Date, Requested Receipt Date, and Purchasing Officer (`officerCode`). Each order is written through `PXStore.updateRecord('orders', id, {...}, { log: { action: 'bulk-update', … } })`, so per-record validation and audit logging run exactly as in the single-order form — locked ERP fields, closed-order leniency, and warnings all behave identically. The loop is isolated per order in a `try/catch`: a record that fails validation is collected and reported, and the remaining orders still save (the toast shows "N updated, M skipped" with the first reason). Field keys are the real schema keys (`status`, `orderSentToSupplierDate`, `orderAcknowledgedDate`, `orderReadyDate`, `requestedReceiptDate`, `officerCode`) — verified against `schema.js`, not the screenshot labels.

---

## 13c. Scorecard segregation, restricted views & System Settings

**Supplier Scorecards segregated by type and function (within entity).** The scorecard is already
entity-scoped via the sidebar switcher; it now also filters by order type (All / Foreign / Local)
and by **function** (All / Technical / Indirect / Supply Chain — the same three procurement
functions the sidebar splits orders by, resolved via `PXUtils.orderFunction`), via two dropdowns on
the view. `PXScorecard.buildScorecard({ entity, type, fn })` filters the order set before
aggregating, and only attaches shipments whose linked order is in the filtered set so OTIF/delay
stay consistent with the chosen segment. Filter state persists in `state.filters.scorecards`. The
page heading, KPI sub-labels, and info banner reflect the active segment.

**Privileged-only views.** `isPrivileged()` (core.js) returns true for the privileged tier
SuperUsers / Managers / Supervisors are treated as privileged by `isPrivileged()` (`admin`, plus role
codes ending in `_manager` or `_supervisor`). This is active even in the demo role switcher.
`RESTRICTED_VIEWS = ['dqcockpit','erpimportrules',
'workingcalendars']` are gated two ways: `applyNavVisibility()` hides their sidebar items (and any
section that becomes fully empty) at login for non-privileged users, and `navigate()` blocks direct
hash/bookmark access to them (redirecting to the dashboard with a toast). Both helpers are exposed
as `window.__isPrivileged` / `window.__applyNavVisibility`.

**System Settings section (bottom of sidebar).** Officers & Roles, ERP Reconciliation, ERP Import
Rules and Working Calendars live in **System Settings**. ERP Import Rules and Working Calendars remain
restricted views; Officers & Roles and ERP Reconciliation keep their existing access behaviour. The
`navSection` breadcrumb map maps all four views to "System Settings". The old Reference Data sidebar
section has been removed.

**Data Quality Cockpit — summary-first for ERP scale.** At full-ERP volume a flat per-record list
is unreadable, so the cockpit leads with a **findings summary**: every distinct data-quality
message aggregated to one row (finding · severity · records-affected count · which collections),
sorted most-severe-then-most-frequent. The per-collection record tables (which carry the
assign/manage/reopen/open actions) are retained but moved into **collapsible drill-downs, collapsed
by default** — a manager reads the shape of the problem in a few lines; an officer expands one
collection to work it. The engine already scans **open/active records only** (closed POs and
completed shipments leave the view unless they still carry a control failure), which removes the
bulk of historical noise; the banner states this explicitly. All assignment wiring is unchanged —
`$$('[data-dq-*]', viewEl)` still binds buttons even inside collapsed `<details>`.

---

## 13d. Suppliers are per-entity

Suppliers are now fully separate per entity (Phoenix / Seychelles Breweries / Edena), like orders,
shipments, and payments. The supplier record carries an `entity` field (first field in the
`suppliers` schema). The same real-world vendor name may therefore exist as independent records
under each entity, each with its own vendor code, contacts, rating, claims, and scorecard. This is
deliberate per-legal-entity procurement: e.g. "ITHEMBA FOR LIFE" can be vendor `10234` under
Phoenix and `V-557` under Edena as two distinct masters.

Implementation: the Suppliers list scopes to `recordEntity(s) === currentEntity()` and adds a
**Vendor Code** column showing that entity's active `erpMappings.vendorNo` (search includes it). The
heading states the entity. The supplier form has an **Entity** selector as its first field — it
defaults to the current entity for new suppliers and is disabled (fixed) on edit, with a hint to
create a separate record under another entity if needed; the save preserves `entity` verbatim on
edit (a disabled `<select>` is not submitted, so it is set explicitly). The order form's supplier
dropdown is scoped to the order's entity (`recordEntity(s) === orderEntity`). The dashboard "Active
Suppliers" tile and the Data Quality Cockpit supplier-pattern scan are both entity-scoped.

Consequence to keep in mind: name uniqueness is now **per entity** (the same name is allowed across
entities), and per-vendor analytics (scorecards, claims, rating history) are per-entity by design —
a vendor trading with all three entities has three independent supplier records. The pre-existing
`erpMappings` array still holds the per-entity ERP vendor codes within a record; with per-entity
masters each record typically carries only its own entity's mapping.

---

## 13e. Request For Update (direct order/shipment self-service)

The standalone **Order Lookup** page has been removed. Stakeholders and authorised managers/officers
now request updates directly from the operational records they are looking at: Foreign/Local order
cards, Foreign/Local order table rows, the order detail footer, shipment cards/table rows, linked
shipment rows inside an order, and the shipment detail footer. The flow is shared across all three
entities because the order and shipment screens are already scoped by `currentEntity()` /
`recordEntity()`.

**Access rules.** `PXUpdateRequests.canRequestUpdate(targetType)` is the single gate for the button.
For Foreign/Local order sections it allows Internal Stakeholder, Procurement Manager/Supervisor,
and Logistics Manager/Supervisor-style roles where the user has section access. For Logistics
Operations > Shipments it also allows Procurement Officer and Logistics Officer roles. Legacy
generic procurement/logistics role values are normalized to current stream-specific role codes before
permission checks run. The gate also checks section access through
`can('orders','view')`, `can('shipments','view')`, and `can('updateRequests','create')`.

**Request For Update.** The modal shows which officers will be notified and takes a free-text
message. Order requests notify the purchasing officer (`officerCode`) and logistics officer
(`logisticOfficer`). Shipment requests notify the shipment logistics officer plus the linked order's
logistics/purchasing officer where available, de-duplicated by `PXUpdateRequests.assignedOfficers`.
On send it creates an `updateRequests` record with `targetType:'order'|'shipment'`, the target record
ids, `status:'open'`, the requestor snapshot, the target officer codes, and a `dueDate` of +3 days
(the 2–3 day SLA). If no officer is assigned, the modal explains there is no one to notify and
disables sending.

**Persistence & SLA.** A request stays `open` until an officer attends it. `PXUpdateRequests.slaState`
returns `on-track` / `due-soon` (≤1 day) / `overdue`. Open requests routed to the current officer
surface in **My Work** (`openForOfficer(myCode)`) as `soon`/`crit` action cards that deep-link to
the attend modal; overdue ones are critical. Attending (`PXUpdateRequests.attend`) sets
`status:'attended'`, stamps `attendedBy`/`attendedAt`, stores an optional reply note, and removes it
from the officers' queue. Both create and attend write a status-log entry on the target record
(`update-requested` / `update-attended`).

**Identity note (deferred login).** The requestor is captured from `state.officer` — the same
identity slot every "who did this" field uses. Real per-stakeholder identity arrives with the
deferred Azure AD / login work (see Backlog); when it lands, the requestor is automatically the
authenticated user with no code change, because the field already reads from that slot. In the
no-login demo the requestor is the active profile.

**Wiring.** Collection `updateRequests` is initialised in `state.data`, subscribed in `subscribeAll`,
and is routed through `PXStore` validation as `updateRequest`. `updateRequests.js` is loaded before
`orders.detail.js` so order/shipment details can render the access-gated buttons. Old `#orderlookup`
hashes redirect to Dashboard because there is no longer a lookup view.

---

## 13f. Order list density & default columns

**Row density (compact default + toggle).** Order lists default to a **compact** row density so long
lists show roughly twice as many rows per screen (≈8 → ≈15) without cards. The density is a body
class `density-compact` (CSS in `main.css`) controlling table padding/font; the preference lives in
`localStorage['phoenix_density']` (default `compact`) and is applied at login via `applyDensity()`.
A toolbar button ("↕ Comfortable / ↕ Compact") toggles it through `window.__toggleDensity`; helpers
`__getDensity` / `__applyDensity` are exposed. Comfortable restores the original 9px/13px spacing.

**Default visible columns + order.** `getDefaultColumns` (orders.service.js) now leads with the six
requested columns in this order, all visible: **IPR No. · PO (FPO/LPO) · Claimant · Supplier · Req.
Receipt · Officer (P/L)**. The Officer column shows purchasing + logistics codes (`officerCode` /
`logisticOfficer`) joined as "P / L". The operational columns kept visible after them (Risk, Amount,
Status, Shipment Status, OTIF, Payments) are unchanged; everything else stays available in the column
manager. Columns remain fully user-reorderable/hideable and persisted per browser. Because saved
layouts would otherwise mask the new defaults, `COL_DEFAULTS_VERSION` was bumped to 2: a saved layout
from before the bump is reset **once** to adopt the new defaults, after which the user's own changes
persist again (`loadColPrefs`/`saveColPrefs` stamp `phoenix_cols_version`).

**IPR filtering.** IPR was already part of the free-text search; a dedicated **IPR No.** filter box
was added to the toolbar (next to officer/status/closed) for direct narrowing, wired through the same
debounced `bindSearchInput` helper and a `filters.ipr` predicate.

---

## 13g. ERP status mapping — chronologically-correct order lifecycle

ERP imports now seed a **valid, chronologically-honest** Phoenix status instead of the bare
`'open'` (which was not a member of any status list and rendered as a grey "legacy" badge).

`mapErpPoStatus(erpPoStatus)` (core.js, exposed on `PXUtils`) resolves an ERP PO status to a member
of `orderFollowupStatuses` via `REF.erpStatusMap.po`, with a safe fallback to the **earliest active
state, "Order sent to supplier"** (lifecycle step 1). The reasoning is deliberate: an ERP/Excel
snapshot only proves a PO was *issued* — it does not prove the supplier has acknowledged, started
production, or shipped. Claiming a later status would fabricate progress, so active imports land at
the start of the lifecycle and officers advance them as real events occur. The mapping:

- `Open` (Navision) / `Released` (BC) -> `Order sent to supplier` (step 1)
- `Pending Approval` -> `Order amendment pending` (a pre-send hold)
- `Closed` -> `Order closed`; `Cancelled` -> `Order cancelled` (terminal)
- anything else / blank / null -> `Order sent to supplier`

The live Excel importer uses it on the create path only (`erpImport.js`); the
update path still never touches status, so officer progress is preserved. `isClosed` is set consistently with the
status. `REF.erpStatusMap` itself was realigned so every target is a valid `orderFollowupStatuses`
value (it had pointed at four labels — `Order placed`, `Order confirmed`, `Awaiting approval`,
`Cancelled` — that existed in no list; the not-yet-live `erpAdapter.mapStatus` consumes this map, so
it is now correct for when the live adapter is wired). The Reports "create sample ERP order" button
was likewise corrected from the invalid `Order placed` to `Order sent to supplier`.

Why this is robust: the order-list status **filter** is data-driven (`[...new Set(orders.map(o =>
o.status))]`), open/closed detection uses the `isClosed` **boolean** (never the status string), and
`statusOptionsHtml` shows any out-of-list status as "(legacy)" — so even a stray status degrades
gracefully. The fix removes the drift rather than relying on that safety net.

Separately, `VALIDATOR_TYPE` now only lists collections with actual validators. `updateRequests`,
`contactLog`, and `kpiSnapshot` are validated centrally; `followups` and `issues` still pass through
the permissive default because no dedicated validators exist for them.

---

## 13h. Pilot hardening pass (status consolidation, invariant tests, concurrency, empty states, sync net)

A focused "harden before pilot" pass covering six items.

**Status list consolidation.** The old 15-value shared list was renamed `REF.legacyStatuses` (retained
only so pre-split records still render with a badge) and `REF.statuses` is now an explicit alias to the
canonical `REF.orderFollowupStatuses` (`REF.statuses = REF.orderFollowupStatuses`, set just after the
REF literal). All form/filter/mapping code already used the canonical list; this removes the ambiguity
of two coexisting "truths". `statusOptionsHtml` still shows any out-of-list value as "(legacy)".

**Build-time invariant checks.** `tools/check_invariants.py` runs at the end of `build.py` and FAILS the
build (non-zero exit) on structural or high-risk data-control regression. It asserts: nav view <->
renderer <-> view-section integrity; breadcrumb and navSection coverage; every `window.PX*` engine
referenced is defined; every `window.__*` bridge referenced is defined; every inline `onclick` target
resolves; dist module braces balanced and zero un-inlined module tags; every `REF.erpStatusMap.po`
target is a valid `orderFollowupStatuses` value; importers never seed the bare invalid
`'open'`/`'Order placed'` order status; `VALIDATOR_TYPE` has no dead mappings (each mapped kind has a
`validateX` function); production SharePoint folder fields stay mapped in `docs.service.js`; pre-test
data-integrity guards stay in place for milestone allocation, ready/no-shipment ageing, shipment receipt
evidence, shipment ID/status validation, duplicate shipment IDs, and demo reset gating; and the project
root contains exactly the approved Demo and Production package zip names. Add
a new check by appending a `check(name, condition, detail)` call. This converts the manual audit checks
into an automated gate.

**Optimistic concurrency (stale-write protection).** `PXStore.updateRecord` accepts an optional
`opts.expectedUpdatedAt`. If provided and the live record's `updatedAt` is newer (someone saved first),
it throws a typed `STALE_WRITE` error instead of overwriting. `tsMillis()` normalises any timestamp
shape (Firestore Timestamp, ISO string, Date, millis). The order form snapshots `o.updatedAt` at open
time, passes it on save, and the catch shows a clear "changed by someone else — reopen and re-apply"
message rather than silently clobbering. Opt-in: callers that don't pass `expectedUpdatedAt` are
unaffected, so this can be rolled out to shipments/payments forms incrementally.

**Empty-state guidance.** The Dashboard shows a first-run banner ("No orders yet — Import from ERP /
Load a sample order", deep-linking to ERP Reconciliation and Reports) when there are zero non-archived
orders, via the `#dashboard-firstrun` slot. The order list now distinguishes a genuinely empty segment
("No <type> orders in <function> yet" with how-to-populate guidance) from a filtered-to-empty result
("…match these filters").

**Write-failure safety net.** A global `unhandledrejection` handler (core.js) surfaces write/permission/
network failures as a toast via `window.__flagWriteError(context, err)` so a failed Firestore write is
never fully silent. A header indicator (`#sync-status`) shows "✓ Synced" / "⚠ Last save failed" and
recovers (`window.__flagWriteOk()`) on the next successful orders snapshot. `STALE_WRITE` is excluded
(handled inline by the form). This matters on flaky connectivity (Mauritius / Seychelles).

**Deferred-login note.** The pilot pack now opens with a consolidated "what is not live yet" section so
testers understand the no-login behaviours (everyone is admin; requestor/actor = active profile; My
Work is profile-scoped; no email/push; data is user-populated) up front rather than discovering them
feature by feature.

---

## 13i. Operational follow-up — Phase 1: snooze + My Day

First phase of the operational follow-up enhancements (see docs/OPERATIONAL_FOLLOWUP_SPEC.md). This
phase establishes the **snooze mechanism** later phases reuse, plus a focused daily view.

**Snooze engine (`followupSnooze.js`, `window.PXSnooze`).** Many My Work actions are *computed* (no
record to flag), so snoozes are keyed by the action's stable key (`what|ref`) plus the officer code,
and stored in `localStorage` under `phoenix_snoozes`. Snoozes are personal, per-device, and transient
— not shared business data — so localStorage is correct (no Firestore write, works offline). API:
`isSnoozed(key)`, `snoozedUntil(key)`, `snooze(key, days[, explicitIso])`, `clearSnooze(key)`,
`activeSnoozes()`. Expired snoozes are cleaned lazily and the action resurfaces automatically. Loaded
before `myWork.js` in build order.

**My Work integration.** Each action gets `a.key = a.what + '|' + a.ref` (same as the dedup key).
Snoozed actions are pulled out of the active queues into a separate **💤 Snoozed** pill *before*
counts are computed, so the sidebar badge (`__myWorkCount` = crit+soon+up) and the page always agree
and snoozed items never inflate the badge. Each action row has a 💤 snooze button
(`__snoozeAction(key)` — prompts for days, default 3) and snoozed rows show an ↩ un-snooze button
(`__unsnoozeAction(key)`).

**My Day toggle.** A header toggle (`__toggleMyDay`, persisted as `phoenix_myday`) narrows the queue
to **overdue + due-soon only** (hides upcoming/waiting/snoozed), giving a focused "what needs me
today" view distinct from the full backlog. Implemented as a toggle inside My Work (not a new nav
item) per the spec, to avoid nav clutter.

---

## 13j. Operational follow-up — Phase 2: communication log + auto-chase

Phase 2 gives the app a memory of the *conversation*, not just the status.

**`contactLog` collection** (schema). One entry per supplier contact on an order/shipment: entity,
relatedType, orderId/orderDocId (or shipmentId), supplier snapshot, contactDate, direction
(outbound = we contacted them / inbound = they replied), channel (Email/Phone/Teams/portal/meeting/
WhatsApp/other), contactPerson, summary, responseExpectedBy, officer snapshot, createdAt. Registered
in `state.data`, subscribed in core, and routed through the central `PXStore` validator as
`contactLog`.

**`PXContactLog` engine + UI** (`src/modules/orders/contactLog.js`). `add(entry)` writes the log entry
and keeps the chase engine in sync: an outbound contact stamps the order's `lastSupplierFollowupDate`,
and if a `responseExpectedBy` is given and no next chase is planned, it seeds `nextSupplierFollowupDate`.
Helpers: `entriesForOrder`, `lastContactDate`, `daysSinceContact`, `overdueReplies`. The order detail
Follow-up tab now shows a **communication timeline** (newest first) above the follow-up tasks, with a
"Log contact" button; a "Log contact" button is also in the detail footer. `openContactLogModal`
pre-fills supplier contacts from the supplier master when available.

**Auto-chase prompts (My Work).** Two generated actions per open order, so officers never have to
remember to chase: (a) **Chase reply** — an outbound contact's `responseExpectedBy` has passed with no
inbound since (tier soon); (b) **No recent contact** — an order still awaiting delivery with no logged
contact for >=14 days (tier upcoming). These flow through the same My Work queue and are snoozable via
Phase 1.

---

## 13k. Operational follow-up — Phase 3: exceptions / stuck-orders board

A new **Exceptions** view (under Reports & Controls) answering "what is stuck, and whose?" across the
active entity. It is pure presentation over `PXProcFollowup.orderChecks()` — it does not recompute
exception logic, so the board and the per-order risk badge always agree.

**View** (`src/modules/reports/exceptions.js`, key `exceptions`). Active, entity-scoped, non-closed
orders only. For each it pulls `orderChecks()` (acknowledgement, supplier promise, follow-up, receipt,
shipment, payment, issue, and ERP exceptions), flattens to {order, check}, and:
- **Groups by exception type** (check `key`), most-severe-then-most-frequent, each an expandable
  drill-down listing the affected orders (sorted by the check's weight) with a click-through to the
  order.
- **Owner roll-up** table: per officer, count of distinct stuck orders + critical exceptions + total
  — for handover and accountability.
- Filters: severity and officer; clicking a type filters to it. KPI pills summarise stuck orders,
  critical count, warnings, and type count. CSV export of the flat exception list.

Registered in nav (Reports & Controls), view section, breadcrumb, and navSection. A sidebar count
badge (`__exceptionsCount`, wired in `updateCounts`) shows the number of orders with a danger-level
exception in the active entity, hidden when zero. Visible to all officers; the roll-up is the
cross-officer view managers use.

---

## 13l. Operational follow-up — Phase 4: shipment journey + document readiness

Final phase. Logistics visibility: a journey tracker and a clearance-document checklist, plus the
shipment-side communication log.

**Shipment journey (`PXJourney`, `shipmentJourney.js`).** `build(shipment)` lays the existing date
fields into one ordered lifecycle — Ready → Booked → Departed → Arrived → Clearance → Delivered → GRN
— marking each step done/current/pending and carrying planned-vs-actual (e.g. ETD vs
actualDepartureDate, ETA vs actualArrivalDate). `alerts(shipment)` derives proactive warnings (ETA
passed with no arrival, ETD passed with no departure, arrived-but-stuck-in-clearance,
released-but-not-delivered). Rendered as a visual strip at the top of the shipment detail with the
alerts beneath. New schema field `etd` was added (previously read but undeclared).

**Document readiness (`PXShipmentDocs`).** A per-shipment clearance-document checklist persisted in
`s.requiredDocs` (array of {key,label,status,receivedDate,from,note}); defaults cover invoice, packing
list, BL/AWB, certificate of origin, COA, insurance, health/phyto. `list()` seeds from legacy
*Date fields so existing shipments aren't blank; `summary()` counts applicable (non-N/A) docs and
flags incomplete sets; `setStatus()` cycles awaited → received → N/A. Rendered as a table on the
shipment detail with a "N of M ready" pill. A My Work alert fires when a shipment is arriving within 7
days (or overdue) with an incomplete doc set — the demurrage-prevention signal.

**Shipment communication log.** `openContactLogModal` was generalised to accept `{relatedType:'shipment'}`,
so the Phase 2 contact log now works from the shipment detail (footer "Log contact"). The contactLog
schema already carried `shipmentId`, so no schema change was needed.

---

## 13m. KPI Trends over time (with 2024→today history)

Turns the point-in-time KPIs into month-on-month trends, built to handle a go-live import spanning
2024 to today without old/incomplete orders ever blocking.

**`PXKpi` engine (`src/modules/reports/kpi.js`).** Single source of truth for KPI values, used by both
the live Dashboard indicators and the trend snapshots so they cannot drift. Two design rules: (1)
**null-tolerant** — a record missing a field needed for a KPI is simply excluded from that KPI's
sample, never an error; every average/ratio returns `null` (shown "—"), never NaN. (2)
**date-window-aware** — `compute(entity, {window:{from,to}})` restricts the date-bucketable KPIs (OTIF
by latest GRN, MTTO by order date, lateness by GRN, clearance by clearance date) to a period, so past
months can be back-computed from real dates. Count KPIs (open orders, overdue payments, risk) are
point-in-time and omitted for windowed calls. `META` carries each KPI's label, `upGood`, unit, and
`backfill` flag.

**`kpiSnapshot` collection + capture (`kpiTrends.js`, `PXKpiSnapshot`).** One small record per entity
per `period` (YYYY-MM) holding the KPI `values`. Capture paths: **auto** (on first app use in a new
month, snapshots the prior completed month once — deferred 4s after boot, failures swallowed, never
blocks load), **manual** ("Capture this month" button), and **backfill** ("Backfill history" button —
computes date-bucketable KPIs for up to 30 prior months from existing order/GRN dates; only writes
months that actually had eligible data; idempotent, safe to re-run at go-live). Backfilled snapshots
omit count KPIs (those trend forward from first capture only). Writes go through the `kpiSnapshot`
validator, which checks entity, `YYYY-MM` period, and object-shaped KPI values.

**KPI Trends view** (key `kpitrends`, under Reports & Controls). Trend tiles per KPI: current value,
▲/▼ vs last period coloured by whether up is good for that metric, an inline-SVG sparkline (no new
dependency), and the period count. CSV export of the series. The current month appends a live point so
the latest value shows even before capture. **Dashboard integration:** OTIF / MTTO / lateness /
clearance tiles now show a small ▲/▼ delta vs last captured month (`kpiTrend()` helper reading
snapshots), putting the trend where managers already look.

**Go-live note:** old or incomplete 2024 orders never block — they are excluded from a KPI's sample,
consistent with how OTIF already skips orders lacking a requested-receipt date. Run **Backfill history**
once after the historical import to populate the trend from real dates.

---

## 13o. Management control dashboards

`src/modules/reports/managementControls.js` adds read-only, entity-scoped control views over existing
data. No new collection is created.

- **Management Cockpit** (`mgmtcockpit`): daily control tower combining critical exceptions, high OTIF
  risks, clearance readiness risks, payment due/overdue exposure, and weak supplier reliability.
- **OTIF Risk Forecast** (`otifrisk`): predicts delivery risk before the requested receipt date using
  requested receipt, shipment creation, ETD/ETA, ETA changes, documents, and existing
  `PXProcFollowup.orderChecks`.
- **Officer Workload & SLA** (`workload`): roll-up by officer across open orders, shipments,
  payments, issues, update requests, due-soon items, and critical/overdue items.
- **Partial Shipment Control** (`partials`): PO-level control of S1/S2/S3, partial/split/balance
  shipment reasons, receipt exceptions, and open follow-up actions.
- **Clearance Readiness** (`clearance`): broker-document and clearance-owner view for active foreign
  shipments; uses ETA, docs-to-broker date, clearance owner/start/release, and `PXShipmentDocs`.
- **Payment Exposure** (`paymentexposure`): currency exposure by overdue, due <=7d, due <=30d, later,
  and undated, combining milestone forecast and open RFPs.
- **Operational Calendar** (`opcalendar`): next 30/60/90 day calendar of requested receipts, order
  ready dates, ETD/ETA, clearance dates, payment due dates, follow-up due dates, and update-request
  due dates.
- **Management Pack** (`managementpack`): one-click CSV pack for weekly/monthly review, pulling the
  major exception, risk, clearance, payment, partial-shipment, and supplier-reliability rows.

The module exposes `window.PXManagementControls` builders so future screens/exports can reuse the same
logic. Sidebar counters are provided by `__mgmtCockpitCount`, `__otifRiskCount`,
`__clearanceRiskCount`, and `__paymentExposureCount`. These views intentionally exclude the ERP/Data
Warehouse reconciliation dashboard, which is parked in `docs/ON_HOLD_REGISTER.md` per user decision.

**Two OTIF measures — by design, not a discrepancy.** The app deliberately carries two different
OTIF-related figures and they are not expected to match:
- **KPI Trends OTIF** (`PXKpi`, KPI Trends view + Dashboard): a *backward-looking actual* — the % of
  **closed** orders whose latest GRN landed on or before the requested receipt date. It measures what
  already happened and feeds the month-on-month trend.
- **OTIF Risk Forecast** (`buildOtifRisk`, Management Controls): a *forward-looking prediction* — a
  weighted risk score on **active, not-yet-received** orders (receipt-date proximity, missing/late
  shipment records, ETA vs requirement, repeated ETA changes, missing docs, open risk checks). It
  flags orders likely to miss OTIF so they can be acted on *before* the fact.
One reports history; the other warns about the future. A future reader should not try to reconcile the
two numbers.

Supplier Scorecards were also enriched with reliability signals: acknowledgement delay, readiness
delay, ETA changes, receipt exceptions, document problems, and open issues. The rating keeps the
existing OTIF/DQ/punctuality basis but applies a capped reliability penalty.

---

## 13p. Demo role switcher (no-login testing aid)

In no-login mode every profile resolves to `admin`, so a single tester cannot see what each role
experiences. The role switcher lets you preview the app as any role **without** real login and without
changing stored data.

`currentRole()` now checks a demo override first: `window.__demoRole` / `localStorage.phoenix_demo_role`.
When set, the whole app behaves as that role because every gate already runs through
`currentRole()` / `can()` / `isPrivileged()` — nothing about the permission logic changed. The override
is per-browser and never written to the Firestore officer record, so other sessions and the real data
are untouched.

UI: the header user-chip is clickable (`__openRoleSwitcher`) and lists Superuser (admin) plus the
configured stream-specific test roles. Picking one
calls `__setDemoRole(code)`, which persists the override, refreshes the chip (a dashed outline + role
pill marks demo mode), re-applies `applyNavVisibility()`, toggles the role-gated "+ New Order" button,
and re-renders the current view. Choosing "Superuser (admin)" clears the override. On boot,
`updateUserChip()` + `applyNavVisibility()` restore any persisted demo role.

This is a prototype testing aid; when real Azure AD login lands, the switcher can be hidden behind a
debug flag or removed — the role logic it exercises is the production logic.

**Different users in different tabs of the SAME browser.** Because localStorage is shared across a
browser's tabs, the browser-level switcher alone makes every tab the same role. To run tabs
independently, role resolution checks **per-tab `sessionStorage` first** (sessionStorage is isolated
per tab), then the browser-level localStorage role, then the officer's own role. A tab is pinned by
opening it with URL params — `?role=logistics&as=LM&name=Logi` — which `captureTabIdentityFromUrl()`
reads into `sessionStorage` (`phoenix_tab_role` / `phoenix_tab_code` / `phoenix_tab_name`) and then
strips from the address bar. `currentRole()` honours `phoenix_tab_role`; the officer code/name are
applied as an **in-memory overlay** on `state.officer` for that tab only — never written to the shared
Firestore officer record. The switcher's "↗ new tab" action builds these URLs for one-click use, and
the chip shows "· this tab" when a tab is pinned. Result: Tab A can run as Procurement while Tab B
runs as Logistics in the same browser at the same time, both seeing the same live data.

---

## 13q. Production mode & go-live hardening

The app ships from one source with deployment switches in `APP_CONFIG` at the very top of
`src/core.js`. `demoMode: true` keeps prototype/testing aids available. Production should use
`demoMode: false` and `authMode: 'password'`, so each person signs in with their own account.

Flipping `demoMode` to false (via `isDemoMode()`, used throughout) does all of the following with no
other code change:
- disables the header **role switcher** (`__openRoleSwitcher` returns early; the chip shows the real
  role with no caret/affordance),
- disables the **per-tab `?role=`/`?as=` URL identity** capture and officer overlay (so URL params and
  browser-storage keys cannot spoof identity or role),
- makes `currentRole()` **ignore** the `phoenix_demo_role` / `phoenix_tab_role` keys entirely, so a user
  cannot self-elevate; the default role for a user with no officer record becomes `stakeholder`
  (read-only), i.e. **fail-closed**,
- makes `can()` **fail closed** — an unknown role or an unlisted resource is denied instead of granted
  (the prototype's permissive defaults apply only in demo mode),
- hides the **"Clear all data" purge** tool.

`authMode: 'password'` shows the username/password login form. It signs in through Firebase
Email/Password (or a compatible SSO bridge later) and then loads the officer profile by
`officers/{auth uid}`, `authUid`, or `email`. The app no longer supports shared departmental
logins or the former "Who's working?" picker; My Work and audit attribution depend on the
individual authenticated user.

Important honesty for maintainers: these are **client-side** controls. They are necessary but not
sufficient. Real enforcement is the **Firestore security rules** (templates in
`docs/FIRESTORE_RULES/`) plus the auth decision — both covered in `docs/GO_LIVE_RUNBOOK.md`. The build
script can emit either posture; the source default is `demoMode: true`, and a production file is
produced by flipping the flag at build time.

---

## 13r. Role-based access control (the approved access grid)

The app's access model has TWO layers, both generated from the approved Excel access grid
(PHOENIX_ACCESS_GRID.xlsx) and kept consistent:

1. **Action layer — `REF.permissions[role]`.** Per resource (orders, shipments, payments, milestones,
   suppliers, documents, followups, issues, updateRequests, officers, reports, erprecon), the list of
   allowed actions (view/create/edit/archive). `can(resource, action)` reads this. admin = '*'.

2. **View layer — `REF.viewAccess[role]`.** Per role, which views are `hidden` (not shown, navigation
   blocked) or `viewOnly` (read-only). `viewLevel(view)` returns full/view/none; `applyNavVisibility()`
   hides nav items and empty sections; the navigate() guard redirects away from hidden views. Anything
   not listed = full.

**The current stream-specific roles** (+ admin): procurement_senior_manager, sc_manager,
sc_supervisor, sc_officer, procurement_technical_manager,
procurement_technical_supervisor, procurement_technical_officer,
procurement_indirect_manager, procurement_indirect_supervisor,
procurement_indirect_officer, logistics_manager, logistics_officer,
demand_supervisor, demand_officer, finance, stakeholder. Legacy values are normalized
(`normalizeRole()`): accounts->finance, bare procurement->procurement_technical_manager,
generic procurement manager/supervisor/officer values -> the Technical stream by default,
bare logistics->logistics_manager, logistics_supervisor->logistics_officer,
officer->procurement_technical_officer — so existing officer records keep working while
they are reassigned to their correct stream.

**Consistency rule:** where a role is `viewOnly` on a screen-backed resource, its action permissions
for that resource are capped at `['view']`, so the two layers never contradict (no edit buttons on a
read-only screen). The Senior Procurement Manager is the clearest case: full oversight visibility,
view-only on orders/shipments/payments/documents, but retains updateRequests create/edit so the role
can *request* changes without making them directly. Logistics manager/officer retain documents edit by
explicit decision.

To change access: edit the grid/source roles, regenerate the two REF blocks, rebuild. The officer-form
dropdown and the demo role switcher both list the configured roles.

---

## 13s. Exports / Outbound module (logistics-owned)

A dedicated module for OUTBOUND movements — goods sent out by logistics: samples,
returns to supplier, and round-trip items sent for repair / refurbishment / calibration
that come back. Deliberately kept SEPARATE from inbound shipments and EXCLUDED from
inbound OTIF.

**Collection:** `exports` (own Firestore collection; subscribed in core.js; included in
Backup All and the demo purge list).

**Engine:** `window.PXExports` (src/modules/shipments/exports.js) —
`forEntity`, `isRoundTrip`, `statusList`, `isOut`, `isOverdue`, `turnaround`,
`reasonLabel`, `metrics`. `nextExportRef()` generates `EXP-YYYY-nnnn` per entity.

**Trip types:**
- `one_way` — sample / return to supplier / scrap. Lifecycle: Draft → Dispatched →
  In transit → Delivered → Closed. Turnaround = dispatch → delivered.
- `round_trip` — repair / refurbishment / calibration. Lifecycle adds the return leg:
  … Delivered → Return in transit → Received back → Closed. An **expected return date**
  is set at dispatch; if the item is still out past that date it is flagged **overdue**.
  Turnaround = dispatch → received back. Round-trip items are typically linked to a PO
  (the return relates to a purchase order); the link is optional in general.

**Metrics (inside the Exports view, no dashboard tile):** total, currently out,
overdue returns, open one-way, and **average turnaround by reason** (calibration vs
repair, etc.). Sidebar count badges the overdue-return count.

**Access:** `exports` permission — logistics_manager / logistics_officer create/edit/
archive; procurement (all levels), demand planning, and stakeholder view-only; finance
none. Form-openers self-guard (defense in depth).

**Not in OTIF:** exports never enter the inbound OTIF/KPI engine. They are outbound and
measured only by their own turnaround / overdue metrics.

---

## 14. How to add a new feature (checklist)

Before building, answer these (this keeps the app from sprawling):

1. **Collection** — which collection does it touch? New one? Add it to `schema.js` and the backup list.
2. **Fields** — list new fields; add each to `schema.js` (meaning/type/owner/editable/required/ui).
3. **Ownership** — ERP-owned or Phoenix-owned? If ERP, add to `REF.erpOwnership` and the relevant ERP map.
4. **Who can edit** — add/adjust `REF.permissions`; gate buttons with `can(...)` / `PXPermissions`.
5. **Writes** — go through `PXStore` only. Never call `addDoc`/`updateDoc` directly.
6. **Validation** — add rules to `validators.js`; call `PXValidators.validate` in the save handler.
7. **Workflow** — if it has statuses, add them to `workflows.js`.
8. **My Work** — should it raise personal actions? Add to `myWork.js` (badge it by entity).
9. **Reports** — should it appear in reports? Add to `reports.render.js`.
10. **Backup/export** — new collections must be added to the backup in `reports.service.js`.
11. **Audit** — use `PXStore`'s `opts.log` or `logStatusChange` for meaningful changes.
12. **Documents** — does it need attached documents? Reuse the documents section + `expectedDocsFor`.
13. **ERP / Warehouse** — does it map to ERP data? Add the field to `schema.js`, the Navision/BC maps in `erpOwnership.js`, and the canonical staging contract in `warehouseAdapter.js`.
14. **Docs** — update this file and `DATA_DICTIONARY.md`.

---

## 15. Known limitations

- Production authentication is configured through Firebase/SSO and individual officer profiles.
  Demo mode still uses anonymous name/code setup for prototype testing.
- Documents support two methods: a SharePoint/OneDrive **link** (recommended) and a
  small **demo file upload** (base64 in Firestore, ≤600 KB). Binary storage at scale
  (Firebase Storage / SharePoint document library via Graph API) is future work.
- Hard deletes exist in exactly one place: the demo-only purge (see §12), which must be disabled before pilot/production data is used.
- ERP/Data Warehouse integration is placeholder only — no live Navision/BC, Data Warehouse, or direct browser calls; the maps and adapters define the future controlled sync contract.
- Working-day calculations exclude weekends and the approved holiday dates maintained in System
  Settings → Working Calendars; there is no automatic public-holiday feed.
- ES module source needs a local server; the single-file build is the shareable artefact.
- Modules still talk via `window.*` rather than native `import`/`export` (deliberate; future pass).

---

## 16. Future improvements

- Convert `window.*` wiring to native ES `import`/`export`.
- Real login (Azure AD) + Firestore security rules generated from `REF.permissions`.
- Live ERP -> Data Warehouse -> Phoenix sync service using the `PXWarehouse` contract and `erpOwnership` maps.
- Secure document upload (SharePoint / Firebase Storage) replacing link-only.
- Promote validation warnings to errors as the team confirms rules.
