# ERP Import Pilot And Integration Specification

## Purpose

Use this document for the first controlled import from Phoenix Navision and
Seychelles Breweries / Edena Business Central. Phoenix Procurement is an operational
control tower: Navision/Business Central remain the financial and transactional
source of truth.

## Pilot Scope

Start with one recent export containing open purchase orders only. Use the test
environment first; do not use production data until the pilot results are
approved.

Before every pilot import:

1. Run **Backup All** from the application.
2. Confirm that the officer performing the import can access Suppliers and ERP
   Reconciliation.
3. Keep the original workbook unchanged as pilot evidence.
4. Record the import date, source company, row count and tester.

## Workbook Contract

The current importer recognises these worksheets and fields:

| Worksheet | Entity | ERP source | Required identifiers | Main fields read |
|---|---|---|---|---|
| `FPO` | Phoenix | Navision | `No.`, `Buy-from Vendor No.`, `Buy-from Vendor Name` | `PO Closed`, `Purchasing Mgr ID`, `HOD ID`, `Currency Code`, `Document Date`, `Purpose`, `Requested Receipt Date`, `Created From IPR No.`, `HOD Approval Date`, `Requested By`, `LineAmount` |
| `LPO` | Phoenix | Navision | `No.`, `Buy-from Vendor No.`, `Buy-from Vendor Name` | Same field set as FPO |
| `Seybrew` | Seychelles Breweries | Business Central | `No.`, `Buy-from Vendor No.`, `Buy-from Vendor Name` | `Status`, `Purchaser Code`, `Created By`, `Currency Code`, `Document Date`, `Purpose Of Order`, `Requested Receipt Date`, `Payment Terms Code`, `Amount` |
| `Edena` / `Edena Export` | Edena | Business Central | `No.`, `Buy-from Vendor No.`, `Buy-from Vendor Name` | Same field set as `Seybrew` |

The PO number is unique only within an entity. The import groups multiple export
lines into one purchase order and sums the line amounts.

For Seychelles Breweries, a blank Business Central `Currency Code` or explicit `SCR`
imports as a local order. For Edena, a blank code or explicit `EUR` imports as a
local order. A populated non-local currency code imports as a foreign order.
`Purchaser Code` is the primary procurement-function classifier,
equivalent to Phoenix's `Purchasing Mgr ID`; `Created By` is used only when the
Purchaser Code is blank. The currently approved map is BB01/DC01/EJ01/EL01/
HB01/VS01/YA01 → Technical; BR01/MK01/SH01/SL01/SN01 → Supply Chain; and
ET01/RA01/TV01 → Indirect.

The application now runs a header preflight before it creates candidates. A
worksheet with missing required headers is skipped and shown in the import
preview as an error; correct the export rather than committing a partial sheet.

## ERP Import Rules

The approved classification and local-currency rules are visible under
**System Settings > ERP Import Rules**. The application has a built-in approved
baseline so imports remain safe before the rules are saved to the shared
`system_config` record in Firestore. An
administrator can use **Store Approved Defaults** to persist that baseline, then
edit or add rules with a reason, priority, optional secondary condition, and an
active/inactive state. Changes affect the next import preview only; they never
change existing purchase orders until that preview is committed.

## Import History

Each committed workbook import writes one structured audit entry to the existing
`status_log` collection and displays it in **ERP Reconciliation > Recent Import
History**. It records the file name, source sheets, importing officer, preview
counts, entity/function totals, skips, warnings, rule-set count, final create/
update/failure totals and up to 20 row-write errors. A preview does not create a
history record; a cancelled or partial commit does.

## Supplier Matching Rule

The import applies this priority order:

1. Entity + ERP source + **Vendor Code**.
2. Exact supplier or legal name.
3. Supplier alias.
4. Unmatched vendor: import the order, flag it in the Supplier Mapping Worklist.

The ERP vendor name and code stay unchanged on the order. Phoenix stores a
separate supplier master link for reporting and performance history. Do not
replace ERP vendor codes with Phoenix IDs.

## Pilot Procedure

1. Export open POs from Navision/BC using the exact worksheet/header contract.
2. In Phoenix, open **ERP Reconciliation** and choose **Import POs from Excel**.
3. Review the preview before committing:
   - classified vs skipped POs;
   - create vs update totals;
   - supplier links by vendor code, name and alias;
   - unmatched vendor codes;
   - ERP/Phoenix conflicts.
4. Commit the import.
5. Open **Reports & Controls → Suppliers → Mapping Worklist** and resolve every vendor-code mapping.
6. Spot-check at least ten POs against the source workbook:
   - entity, PO number, vendor code/name, currency and amount;
   - date of order, requested receipt date, IPR fields and claimant;
   - function classification;
   - supplier link status.
7. Re-import the identical workbook. The result must update existing POs rather
   than create duplicates.
8. Log any mismatch as an issue, including workbook row, PO number, field,
   expected value and actual value.

## Acceptance Criteria

- No duplicate purchase orders for the same entity + PO number.
- Vendor-code mappings connect the correct supplier master record.
- An unmatched vendor is visible in the worklist, never silently discarded.
- Re-import preserves Phoenix-owned status, milestones, notes, follow-ups,
  documents and issues.
- Imported ERP lifecycle is stored separately from Phoenix operational status.
- Line amounts group correctly to the PO amount.
- All pilot exceptions have an owner and resolution note.

## Integration Target

After the Excel pilot is stable, use middleware or a server-side integration.
The browser must not connect directly to Navision or Business Central.

| Area | Recommendation |
|---|---|
| Direction | ERP to Phoenix for PO/vendor master updates; Phoenix remains operational follow-up only. |
| Matching keys | Entity + ERP company + ERP document ID where available; entity + PO number as fallback; entity + ERP source + vendor code for supplier mapping. |
| Frequency | Start daily or on-demand; move to incremental scheduled sync after reconciliation is stable. |
| Error handling | Store source timestamp, sync status, error message and retry state; send failures to an operational exception queue. |
| Write-back | Do not write operational notes, supplier ratings or documents back to ERP in the first release. |
| Security | Service credentials belong in middleware/server configuration, never in browser code. |

## Field Ownership

The full field dictionary is generated from `src/schema.js` and lives in
`docs/DATA_DICTIONARY.md`. It records meaning, data type, owner, editability,
required status and UI location for every collection. Keep it updated whenever
the integration contract changes.
