# Phoenix Procurement — Pilot Test Pack & Feedback Register

Purpose: validate the control tower against realistic procurement & logistics
scenarios **before** real deployment. Run each scenario end-to-end, record the
actual result, and mark pass/fail. This pack doubles as the acceptance spec for the
operational features (readiness gates, structured issues, PO↔payment reconciliation,
planned-vs-actual timeline).

## How to use this pack

1. Pick a test entity (Phoenix / Seychelles Breweries / Edena) and sign in with an
   officer code whose role matches the action (admin / procurement roles / logistics roles / finance).
2. Work top to bottom; some scenarios build on earlier data.
3. Fill in the **Result register** row for each scenario: Actual result, Tester, Date,
   Pass/Fail, Comments. Use the Issues log at the end for defects.
4. All actions must respect: entity scope, role permissions, My Work, reports/export,
   audit trail, ERP ownership (ERP never overwrites Phoenix operational data), and the
   data dictionary.

### Result register (fill in)

| # | Scenario | Tester | Date | Pass / Fail | Comments |
|---|---|---|---|---|---|
| 1 | Foreign PO — advance + balance payment | | | | |
| 2 | Local order — staged payment | | | | |
| 3 | Part shipment | | | | |
| 4 | Late supplier acknowledgement | | | | |
| 5 | Delayed shipment | | | | |
| 6 | Missing Bill of Lading / Air Waybill | | | | |
| 7 | Damaged or short receipt | | | | |
| 8 | Invoice mismatch | | | | |
| 9 | Duplicate payment request attempt | | | | |
| 10 | Duplicate ERP import row | | | | |
| 11 | Closed ERP PO but Phoenix still open | | | | |
| 12 | Expiring compliance document | | | | |
| 13 | Critical issue escalation | | | | |
| 14 | Order closure with incomplete requirements | | | | |
| 15 | Actual landed cost vs TEPS estimate | | | | |
| 16 | Container demurrage / detention tracker | | | | |
| 17 | Data Quality Cockpit | | | | |
| 18 | Amendments, scorecards, claims, delegation | | | | |
| 19 | Unknown supplier validation | | | | |
| 20 | Imported / closed historical PO edit | | | | |
| 21 | Custom / Navision payment terms | | | | |
| 22 | Entity working calendar | | | | |
| 23 | Empty supplier-master bootstrap | | | | |

---

## Before you start — what is not live yet (read this first)

This pilot build runs in **no-login mode**. Authentication (Azure AD / single sign-on) and real
per-user identity are deliberately deferred to a later phase. A few behaviours therefore differ from
the final product, and several features quietly depend on the identity that is not present yet. Knowing
this up front avoids raising these as defects:

- **Everyone is `admin`.** Role-based gating (privileged views, who can edit orders, restricted
  System Settings) is fully built, but in no-login mode every profile resolves to `admin`, so nothing
  is hidden. The gates only take visible effect once real roles arrive. To test role behaviour, switch
  the active officer/role where the scenario allows it.
- **"Requestor" / "who did this" = the active profile.** On Request-For-Update, amendments, claims,
  attended-by, and audit entries, the actor is taken from the current profile (`state.officer`). When
  login lands this automatically becomes the authenticated user with no rework — the field already
  reads from that identity slot. In the pilot, treat the recorded actor as "whoever the active profile
  is", not a verified identity.
- **My Work is officer-scoped by that same profile.** What appears in My Work depends on the active
  officer code; switching profile changes the queue. This is expected.
- **No email / push notifications.** Notifications (e.g. update requests, escalations) surface inside
  the app — in My Work and badges — but there is no outbound email or push yet. That requires the same
  backend/identity work as login. Test notifications by checking My Work, not your inbox.
- **Data is populated by you.** The app is a control tower over ERP data; it starts empty. Populate it
  via ERP import or the "load a sample order" button (Reports). A first-run banner on the Dashboard
  points to both.

None of the above are bugs — they are the known shape of the no-login pilot. Everything else in this
pack should behave as a finished feature.

---

## Scenario 1 — Foreign PO with advance and balance payment

**Setup data**
- Entity: Phoenix. Order type: Foreign (FPO). Supplier with a foreign currency (e.g. EUR).
- Amount: 100,000 EUR. Terms implying a split (e.g. 30% advance / 70% on shipping docs).

**User steps**
1. Create the foreign order; set supplier, currency EUR, amount, requested receipt date.
2. Add two payment milestones: 30% advance, 70% balance.
3. Raise the advance payment request; approve and mark paid.
4. Later, raise the balance request against the second milestone.

**Expected result**
- Both milestones show on the order; forecast/forthcoming payments reflect them.
- Advance RFP and balance RFP are separate, each linked to its milestone.
- Amounts are shown in EUR (not merged into an unlabelled total).
- Audit trail records each status change.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 2 — Local order with staged payment

**Setup data**
- Entity: Phoenix or Edena. Order type: Local (LPO), currency MUR (or SCR for Seychelles).
- "Staged payment" enabled so milestones apply to a local order.

**User steps**
1. Create a local order; tick "Staged payment".
2. Define stage milestones (e.g. 50% on delivery, 50% on completion).
3. Raise and process the first stage payment.

**Expected result**
- Milestones enabled only because "Staged payment" is ticked.
- Stage RFPs link to the correct milestone; forecast reflects staged schedule.
- Currency is the local currency throughout.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 3 — Part shipment

**Setup data**
- An existing foreign order with quantity that will arrive in two batches.

**User steps**
1. Open the order; create shipment batch A for part of the quantity.
2. Create shipment batch B for the remainder.
3. Progress batch A to received (GRN) while batch B is still in transit.

**Expected result**
- Two shipments (e.g. FPO###A, FPO###B) under one order.
- Order is not auto-closed while a batch is outstanding.
- Readiness/closure check reports the order is not ready to close (open shipment).

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 4 — Late supplier acknowledgement

**Setup data**
- A new order with PO sent date set, but no supplier acknowledgement date.

**User steps**
1. Set "PO sent to supplier" date a week in the past; leave acknowledgement blank.
2. Open the order's readiness panel.
3. (When the planned-vs-actual timeline ships) confirm the acknowledgement step shows a delay.

**Expected result**
- Readiness "ready for shipment" check fails on the missing acknowledgement and explains why.
- The order surfaces in My Work / reports as awaiting acknowledgement.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 5 — Delayed shipment

**Setup data**
- A shipment with an ETA in the past and no actual arrival / GRN yet.

**User steps**
1. Set the shipment ETA to a past date; leave actual arrival blank.
2. Review the shipment readiness panel and My Work.

**Expected result**
- Shipment flagged as delayed/overdue; delay days calculated once the timeline ships.
- Appears in the logistics officer's My Work and in reports.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 6 — Missing Bill of Lading / Air Waybill

**Setup data**
- A foreign shipment that requires a BL/AWB document, with the document not yet attached.

**User steps**
1. Open the shipment; check the documents folder — no BL/AWB present.
2. Open the shipment readiness "ready for clearance/receipt" check.

**Expected result**
- Readiness check fails on the missing required transport document and names it.
- The missing-required-documents report lists this shipment.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 7 — Damaged or short receipt

**Setup data**
- A shipment being received with fewer/units damaged versus ordered.

**User steps**
1. Record the GRN with a short/over quantity.
2. Log a structured issue: category = damage/shortage, severity, impact = quantity/quality,
   responsible party = supplier or freight forwarder, target resolution date.

**Expected result**
- Issue captured with category, severity, impact, responsible party, target date.
- Issue appears in My Work for its owner and in issue reports by category/owner/supplier.
- PO↔receipt reconciliation (when shipped) shows the received-vs-ordered mismatch.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 8 — Invoice mismatch

**Setup data**
- An order with PO amount X; a supplier invoice with a different amount Y.

**User steps**
1. Enter the supplier invoice reference and amount on the payment request.
2. Open the PO Financial & Receipt Control view (when shipped).

**Expected result**
- Reconciliation highlights the invoice-vs-PO amount mismatch.
- Values grouped by currency; no unlabelled mixed-currency total; base-currency conversion
  shown only when rate + rate date + source exist.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 9 — Duplicate payment request attempt

**Setup data**
- An order/milestone that already has an approved or paid payment request.

**User steps**
1. Attempt to raise a second payment request for the same milestone/amount.
2. Open the reconciliation view.

**Expected result**
- The system warns of a potential duplicate / over-payment against the milestone.
- Outstanding amount and paid amount remain coherent.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 10 — Duplicate ERP import row

**Setup data**
- An ERP export workbook where the same PO appears as several line rows, and/or is imported twice.

**User steps**
1. Import the workbook; review the import preview.
2. Re-import the same workbook.

**Expected result**
- Line rows for one PO are grouped into a single PO with a summed master amount.
- The preview reports grouped POs and any conflicts before commit.
- Re-import updates ERP-owned fields only; Phoenix status, milestones, follow-ups, documents,
  issues are preserved. No duplicate orders are created (keyed by entity + PO number).

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 11 — Closed ERP PO but Phoenix still open

**Setup data**
- An ERP order whose `erpPoStatus` is Closed/Cancelled while the Phoenix record is still open.

**User steps**
1. Import or edit so `erpPoStatus` = Closed but the order is not closed in Phoenix.
2. Open ERP Reconciliation.

**Expected result**
- The "ERP closed · Phoenix still open" divergence card lists the order.
- ERP status never overwrote the Phoenix operational status.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 12 — Expiring compliance document

**Setup data**
- A required document with an expiry date approaching (within its alert window).

**User steps**
1. Add a required document with an expiry date a few days out and an expiry-alert window.
2. Review reports / My Work.

**Expected result**
- The document is flagged as expiring; appears in alerts and the relevant report.
- Readiness checks treat an expired required document as not satisfied.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 13 — Critical issue escalation

**Setup data**
- An open issue with severity = critical and a target resolution date in the past.

**User steps**
1. Log/raise an issue; set severity critical, target resolution date overdue.
2. Use the escalation action (set escalation level + escalated-to).
3. Review My Work and issue reports.

**Expected result**
- Overdue critical issue surfaces as an escalation action in My Work.
- Escalation level / escalated-to are recorded; ageing and overdue resolution are visible.
- Issue reporting shows the issue by category, owner, supplier, entity, and ageing.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 14 — Order closure with incomplete requirements

**Setup data**
- An order with an open shipment, an unpaid payment, or a critical open issue.

**User steps**
1. Attempt to close the order.
2. Review the readiness "ready for closure" check.

**Expected result**
- Closure readiness fails and lists exactly what is missing (open shipment / unpaid payment /
  critical issue / missing required document).
- The order can only be closed once requirements are met or formally waived.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 15 — Actual landed cost vs TEPS estimate (Increment 2)

**Setup:** A foreign sea shipment with TEPS inputs entered (so it has a Total Provision estimate)
and a GRN date recorded.

**Steps:**
1. Open the shipment; confirm a My Work card "Enter actual landed cost" appears for it.
2. In the shipment form, enter an Actual Landed Cost (MUR), date, and note.
3. Confirm the live variance bar shows estimate, actual, variance and variance %.
4. Open the TEPS view and the A/C Excel export.

**Expected:**
- The shipment detail TEPS card shows Actual Landed Cost + signed variance.
- The TEPS view shows Actual and Variance columns, plus net-variance and "outstanding actuals"
  KPI pills; the A/C export contains the new Actual / Variance / Variance % / Outstanding columns.
- Saving a shipment that has a GRN but no actual raises a soft (confirmable) warning.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 16 — Container demurrage / detention tracker (Increment 3)

**Setup:** A foreign shipment with mode = Sea.

**Steps:**
1. In the shipment form, enter Port Arrival Date, Demurrage Free Days, and (optionally) a
   demurrage rate per container per day; leave pickup blank so the clock runs against today.
2. Confirm the live status bar shows the demurrage clock (elapsed / remaining / over).
3. Open the **Container Tracker** view (Logistics Operations).
4. Set free days low enough that the clock is overdue; re-check.

**Expected:**
- Container Tracker lists the shipment with a status badge (OK / AT RISK / OVERDUE) and both
  clocks; projected exposure shows when a rate is entered.
- An overdue container raises a `crit` My Work card; one within 3 free days raises a `soon` card.
- The sidebar Container Tracker badge reflects at-risk + overdue count.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 17 — Data Quality Cockpit (Increment 4)

**Steps:**
1. Open **Data Quality** (Reports & Controls). Note the overall score and per-collection scores.
2. Open a flagged order/shipment from the issue table and fix the issue (e.g. add a missing
   supplier or requested receipt date).
3. Return to the cockpit.

**Expected:**
- Each collection shows a score (100 − critical×10 − warn×3 − info×1, averaged) and an issue
  table; clicking a row opens the record.
- After fixing an issue, the score rises and the row drops off; sidebar badge (critical count)
  decreases. A fully clean entity shows the "all records clean" banner.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 18 — Amendment control, scorecards, claims, delegation (Increment 5)

**Steps (amendments 5a):**
1. Edit an existing order and change a tracked field (e.g. Amount). Enter a reason when prompted.
2. Open the order's **Amendments** tab.

**Steps (claims 5c):**
3. On the same order's **Claims** tab, raise a claim (type, amount, status). Confirm it appears,
   and that an open claim shows a My Work "Resolve claim" card.

**Steps (scorecards 5b):**
4. Open **Supplier Scorecards** (Reports & Controls); confirm the supplier appears with a rating, OTIF, and
   the open-claim count just raised.

**Steps (delegation 5d):**
5. In Officers & Roles, edit an officer and delegate their My Work to a colleague with an
   until-date and reason.

**Expected:**
- The amendment is logged with from/to/reason/by/when. The claim is stored on the order and
  surfaced in My Work and the scorecard. The delegate sees a "Delegated items from …" card and the
  delegating officer sees a "My Work delegated to …" reminder; the delegation clears after its
  until-date.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 19 — Unknown supplier on save (validation behaviour)

**Setup:** An order whose supplier name is not yet in the Suppliers list (e.g. a fresh ERP import
or a manually typed supplier).

**Steps:**
1. Create or edit an order and enter a supplier name that is not in the Suppliers list.
2. Save.
3. Separately, try to save an order with the supplier field left blank.
4. Add the supplier (or an alias on an existing supplier) under Suppliers, then re-save the order.

**Expected:**
- An unknown supplier produces a **confirmable warning** ("not in the supplier list yet — it will
  be saved as entered"), not a hard block; confirming saves the order with the name as entered.
- A blank supplier is still a **hard error** ("Supplier is required.") and cannot be saved.
- Once the supplier (or alias) exists in the Suppliers list, the warning no longer appears and the
  supplier links to Supplier Scorecards / performance tracking.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 20 — Editing an imported / closed historical PO

**Setup:** Bulk-import (or have on hand) a historical PO that is already **closed** and is missing
live-workflow fields — e.g. no requested receipt date, no payment terms, or milestones that do not
total 100% (typical of POs closed earlier in the year before those rules existed).

**Steps:**
1. Open the closed historical PO and make a small edit (e.g. fix a reference), then Save.
2. Separately, open a **live (open)** order, clear its requested receipt date, and try to Save.
3. Try to save any order (open or closed) with a **negative amount** or a **blank supplier**.

**Expected:**
- The closed historical PO saves after a confirmable **warning** for each missing completeness
  field ("historical/closed order — confirm to save as-is"); it is not hard-blocked.
- The live open order is still **hard-blocked** for the missing requested receipt date.
- Negative amount and blank supplier remain **hard errors** for every record, closed or not.
- Reminder: the bulk import itself never blocks (it skips validation); this scenario covers the
  later form-edit path.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 21 — Payment terms (custom / Navision) on an order

**Setup:** A foreign order. Have one term that is in the standard list and one custom term that is
not (e.g. "35% advance; 65% against BL after 2 inspections").

**Steps:**
1. In the order form, open the Payment Terms field. Confirm it is an editable box with the standard
   terms available as a dropdown/typeahead list.
2. Pick a standard term — confirm milestones auto-generate.
3. Clear it and type the custom term — confirm you are allowed to enter it freely; set milestones
   manually when prompted.
4. Save the order, reopen it, and confirm the custom term is preserved exactly as typed.
5. Save a foreign order with the payment terms left blank.
6. Issue a payment request (RFP) against a milestone, then reopen the order and try to change the
   payment term.
7. Reject that RFP (or use an order with no RFP) and reopen — confirm the term is editable again.

**Expected:**
- The field accepts both standard (from the list) and custom (free-typed) terms; the custom value
  is saved verbatim and shown on reopen and in the order detail.
- A standard term auto-generates the milestone schedule; an unrecognised term prompts for manual
  milestones and does not block saving.
- A blank payment term on a foreign order produces a **confirmable warning**, not a hard block.
- The term (and schedule) is **freely editable until a payment request is issued**; once an RFP is
  attached/paid the field is locked with a "🔒 Locked" hint. A **rejected** RFP does not lock it.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 22 — Entity working calendar

**Setup:** Sign in as an administrator. Pick an upcoming weekday for a Phoenix, Seychelles
Breweries, or Edena public/company closure date. Use an order, shipment, payment, or Issue whose
working-day threshold crosses that date.

**Steps:**
1. Go to **System Settings → Working Calendars** and open the relevant entity card.
2. Add the date and a clear label, save, then reopen the card.
3. Review Data Quality and My Work for the test record. Compare the working-day count before and
   after adding the date.
4. Switch entity and confirm the holiday does not affect another entity's calculation.

**Expected:**
- The date and label persist in the correct entity card; duplicates or invalid dates cannot be saved.
- Weekends and the maintained holiday date are excluded from the relevant entity's working-day
  controls, including Data Quality findings and My Work escalation.
- Other entities remain unaffected. With no configured holidays, the behaviour remains weekdays-only.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 23 — Empty supplier-master bootstrap

**Setup:** Use a copied/demo dataset with imported ERP POs, vendor code/name fields populated, and
no active supplier-master records. Do not use a live supplier master for this scenario.

**Steps:**
1. Open **Reports & Controls → Suppliers → Mapping Worklist**.
2. Confirm the bootstrap action shows only because the supplier master is empty.
3. Open its preview; check the proposed master count, vendor-code mapping count, and PO link count.
4. Confirm using the required `BOOTSTRAP <count>` text, then wait for the progress bar to finish.
5. Reopen Suppliers and the Mapping Worklist. Review at least one master and its linked PO.

**Expected:**
- Each supplier master retains its ERP vendor code mapping(s), and its affected POs receive a
  `supplierId` link without altering their ERP vendor name/code.
- Only exact normalised display-name duplicates are combined; no fuzzy merge is attempted.
- Country, contacts, payment terms, aliases, and rating remain blank for later reviewed enrichment.
- The bulk action disappears once an active supplier master exists; remaining exceptions use the
  normal one-vendor-at-a-time Mapping Worklist.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 24 — Bulk update orders from the list

**Setup:** An order list (table view) with several open orders, including at least one closed
historical PO if available.

**Steps:**
1. In an order list, switch to table view. Tick the checkboxes for 3–4 orders (or use the
   header select-all). Confirm the bulk-actions bar appears with the correct count.
2. Click a data cell of a selected row — confirm it still opens that order (checkbox cell does not).
3. Click **Bulk update…**, choose **Current Status**, pick a value, and apply.
4. Reopen two of the updated orders and confirm the new status saved, and that each shows a
   bulk-update entry in its Timeline.
5. Repeat with **Order Sent to Supplier** (a date) and with **Purchasing Officer**.
6. If possible, include an order that will fail validation in the selection and apply — confirm the
   toast reports "N updated, M skipped" and the valid orders still saved.
7. Confirm the checkboxes/bulk bar are hidden for a read-only (non-editing) user.

**Expected:**
- Selecting rows reveals the bar; Clear and select-all behave correctly.
- The chosen field/value is applied to every selected order through the normal validated, audited
  write path; each updated order gets a "bulk-update" timeline entry.
- A failing order is skipped and reported without aborting the rest of the batch.
- Bulk controls are only present when the user can edit orders.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 25 — Supplier Scorecard segregation (type / function / entity)

**Setup:** A dataset with the same supplier on both a foreign and a local order, and orders across
at least two categories, within one entity.

**Steps:**
1. Open **Reports & Controls → Supplier Scorecards**. Note the total-PO counts per supplier.
2. Switch the type filter to **Foreign only**, then **Local only** — confirm counts and supplier
   list change accordingly.
3. Pick a specific **function** (Technical / Indirect / Supply Chain) — confirm only suppliers/orders in that function remain.
4. Switch the entity in the sidebar — confirm the scorecard rescopes to the new entity and the
   filters still apply.

**Expected:**
- The supplier list, PO counts, OTIF, delay, spend, and ratings all reflect the chosen
  entity + type + function segment; the heading and KPI sub-labels state the active segment.
- A supplier appearing in both foreign and local shows the correct split per filter.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 26 — Restricted views & System Settings visibility

**Setup:** Understand the current build runs in no-login mode where every profile is `admin`
(privileged), so restricted items are visible. This scenario verifies the gate logic and the
relocation.

**Steps:**
1. Confirm the sidebar has no **Reference Data** section.
2. Confirm **Reports & Controls** contains **Reports & Export**, **Suppliers**, **Data Quality**, and
   **Supplier Scorecards**.
3. Confirm **System Settings** contains **Officers & Roles**, **ERP Reconciliation**,
   **ERP Import Rules**, and **Working Calendars**.
4. (Role-gating check, when non-admin roles exist) For a non-privileged role: confirm Data Quality,
   ERP Import Rules, and Working Calendars are hidden, while System Settings still shows any
   non-restricted items the role may access. Confirm
   navigating directly to `#dqcockpit` / `#erpimportrules` / `#workingcalendars` redirects to the
   dashboard with a "restricted" notice.

**Expected:**
- Suppliers live under Reports & Controls; Officers & Roles and ERP Reconciliation live under System Settings.
- The old Reference Data section is not present.
- Privileged users (admin/manager/supervisor) see everything; non-privileged users do not see or
  reach restricted items by direct hash, while non-restricted System Settings items follow their
  existing access behaviour.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 27 — Data Quality Cockpit at scale (summary-first)

**Setup:** A dataset with many records carrying data-quality issues, ideally after an ERP backlog
import, including some closed POs that are missing fields they never needed.

**Steps:**
1. Open **Reports & Controls → Data Quality**. Confirm it opens to a compact **Findings summary** (one row per
   distinct finding, with severity and a records-affected count), not a long flat list.
2. Confirm the page states it is showing **open/active records only**, and that closed POs missing
   only legacy fields do not appear.
3. Expand a collection drill-down (Orders / Shipments / Payments / Suppliers) and confirm the
   individual records appear with their Assign / Manage / Open actions working as before.
4. Assign a finding from inside an expanded drill-down; confirm the linked Issue is created and the
   ownership column updates.

**Expected:**
- The summary is readable regardless of backlog size; findings are ranked most-severe-then-most-
  frequent.
- Drill-downs are collapsed by default and expand on demand; assignment/manage/reopen/open all work
  from within them.
- Closed/completed records are excluded unless they still carry a control failure.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 28 — Per-entity suppliers (same name, different code)

**Setup:** Two entities (e.g. Phoenix and Edena) and a vendor that trades with both under the same
name but a different ERP vendor code per entity.

**Steps:**
1. With Phoenix active, open **Reports & Controls → Suppliers** and create the vendor (e.g. "ITHEMBA
   FOR LIFE"); confirm the Entity selector defaults to Phoenix. Add the Phoenix vendor code in the
   ERP mapping. Save.
2. Switch the active entity to Edena. Confirm the Phoenix supplier does **not** appear in Edena's
   list. Create the same-named vendor under Edena with its Edena vendor code.
3. Confirm each entity's Suppliers list shows only its own suppliers, the heading names the entity,
   and the **Vendor Code** column shows that entity's code.
4. Open an existing supplier and confirm the Entity field is fixed (disabled) with the explanatory
   hint.
5. Create an order under each entity and confirm the supplier dropdown only offers that entity's
   suppliers.

**Expected:**
- The same vendor name exists as two independent records, one per entity, each with its own code.
- Lists, the order-form dropdown, the dashboard "Active Suppliers" tile, and the Data Quality
  supplier patterns are all scoped to the active entity.
- Entity is chosen on creation and fixed thereafter; a separate record is used for another entity.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 29 — Request For Update (orders and shipments)

**Setup:** An order with both a purchasing officer and a logistics officer assigned, plus a linked
shipment with a logistics officer, in the active entity. Know those officers' codes.

**Steps:**
1. Open a **Foreign Orders** or **Local Orders** section. Confirm each visible order/card has
   **Request update** for allowed roles: Internal Stakeholder, Procurement Manager/Supervisor, and
   Logistics Manager/Supervisor. Confirm it is hidden for roles without order-section access.
2. Open an order detail. Confirm the footer also shows **Request update** for the same allowed
   order roles.
3. Click **Request update**, confirm the modal names the purchasing + logistics officer as
   recipients, enter a message, and send.
4. Open **Logistics Operations → Shipments**. Confirm each shipment/card has **Request update** for allowed
   roles: Internal Stakeholder, Procurement Manager/Supervisor/Officer, and Logistics
   Manager/Supervisor/Officer. Confirm it is hidden for roles without shipment-section access.
5. Raise a shipment update request and confirm the modal names the shipment logistics officer and
   linked order officer(s), where assigned.
6. As one of the target officers (switch profile/role as available), open **My Work** and confirm an
   "Update requested" action appears, linking to the attend dialog.
7. Open the attend dialog, add a reply note, and mark attended. Confirm the request leaves the
   officer's My Work and the open-request badge clears on the related order/shipment.
8. Raise a request and leave it; confirm that as its due date (request + 3 days) approaches and
   passes, the My Work action moves from due-soon to overdue/critical.
9. Try Request update on an order/shipment with no assigned officer — confirm the modal explains
   there is no one to notify and prevents sending.

**Expected:**
- The standalone Order Lookup page is no longer present in the sidebar.
- A request notifies the correct purchasing/logistics officers, is persistent until attended, tracks
  the requestor, and escalates by its 2–3 day SLA.
- Attending records who/when/note and removes it from the officers' queue.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 30 — Order list density & default columns

**Setup:** An order list (Foreign or Local) with several rows.

**Steps:**
1. Open an order list. Confirm the visible columns lead with **IPR No. · PO · Claimant · Supplier ·
   Req. Receipt · Officer (P/L)**, followed by the operational columns (Risk, Status, OTIF, etc.).
2. Confirm rows are compact by default (more rows per screen than before).
3. Click the **↕ Comfortable / ↕ Compact** toolbar button and confirm the row height toggles, the
   button label flips, and the choice survives a page reload.
4. In the **⚙ Columns** manager, reorder/hide a column and confirm it persists; confirm you can still
   restore any of the six default columns.
5. Type an IPR number into the dedicated **IPR No.** filter box and confirm the list narrows to
   matching orders; clear it and confirm the list restores.

**Expected:**
- The six requested columns appear first, in order, with operational columns following.
- Compact is the default; the toggle switches to comfortable and the preference is remembered.
- The IPR filter narrows by IPR number independently of the main search box.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---


## Scenario 31 — ERP import seeds a chronologically-correct status

**Setup:** An ERP Excel export (or the manual staging feed) containing open POs, plus a row whose
ERP status is "Pending Approval" if available.

**Steps:**
1. Run the ERP import (Reports / ERP Reconciliation).
2. Open an imported order and confirm its **status is a real lifecycle status** — open POs show
   "Order sent to supplier" (the start of the active lifecycle), not a grey "open (legacy)" badge.
3. Confirm a "Pending Approval" PO shows "Order amendment pending", and that a closed/cancelled PO
   (if any slip through) shows "Order closed"/"Order cancelled" with the Closed flag set.
4. Filter the order list by status and confirm imported orders appear under their proper status.
5. Re-run the import on an order whose status an officer has already advanced; confirm the officer's
   status is **not** overwritten (only ERP-owned fields refresh).

**Expected:**
- Imported orders always carry a valid `orderFollowupStatuses` value placed at the earliest honest
  point in the lifecycle; officers advance from there.
- The status filter and open/closed view behave correctly for imported orders.
- Re-import never regresses an officer-set status.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 32 — Pilot hardening (empty state, concurrent edit, sync indicator)

**Setup:** Two browser sessions open on the same entity (or two officers), plus an empty database for
the first-run check.

**Steps:**
1. On a fresh/empty database, open the **Dashboard** and confirm the first-run banner appears with
   "Import from ERP" and "Load a sample order" actions; confirm an empty order list shows a
   "no orders yet" message (not a "no match" message).
2. Load some data, then in **session A** open an order for editing. In **session B**, open the *same*
   order, change a field, and save.
3. Back in **session A**, make a different change and save. Confirm session A is **blocked** with a
   clear "this order was changed by someone else" message, and the edit is not silently lost.
4. Reopen the order in session A, confirm it now shows session B's change, re-apply the edit, and save
   successfully.
5. Observe the header **sync indicator** ("✓ Synced"). Optionally simulate a save failure (e.g. go
   offline and attempt a save) and confirm it switches to "⚠ Last save failed", then recovers to
   "✓ Synced" when connectivity returns.

**Expected:**
- First-run guidance appears only when there is genuinely no data; it disappears once data exists.
- A concurrent edit is rejected with a clear message rather than overwriting the other officer's save.
- The sync indicator reflects write health and recovers automatically.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 33 — Communication log & auto-chase

**Setup:** An open order assigned to your officer code.

**Steps:**
1. Open the order, go to the **Follow-up** tab, and click **Log contact**. Record an outbound email
   with a summary and a "response expected by" date a few days out. Save.
2. Confirm the contact appears in the timeline (newest first), and that the order's last-follow-up
   date updated. If no next chase was set, confirm the response-expected date became the next chase.
3. Log an inbound reply and confirm both entries show with correct direction markers.
4. Set a "response expected by" date in the past (or wait), then open **My Work** and confirm a
   **"Chase reply"** action appears for the order.
5. On an order with no recent contact (>=14 days) still awaiting delivery, confirm a **"No recent
   contact"** action appears in My Work. Snooze it and confirm it disappears, then returns after the
   snooze date.

**Expected:**
- The communication log records the full conversation per order, newest first, with direction and
  channel.
- Logging an outbound contact keeps the chase planning fields in sync.
- Auto-chase prompts surface in My Work without manual creation and are snoozable.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 34 — Exceptions / stuck-orders board

**Setup:** Several active orders, some with overdue supplier promises, overdue follow-ups, overdue
receipts, or open high issues (so they generate exceptions). Orders assigned across two officers.

**Steps:**
1. Open **Reports & Controls -> Exceptions**. Confirm the KPI pills show the count of stuck orders,
   critical exceptions, warnings, and exception types for the active entity.
2. Confirm exceptions are grouped by type, most-severe first, and each group expands to the affected
   orders; click an order and confirm it opens.
3. Use the severity and officer filters and confirm the list narrows correctly.
4. Check the **By officer** roll-up shows, per officer, the number of stuck orders and critical
   exceptions — useful for handover.
5. Confirm the sidebar **Exceptions** badge shows the number of orders with a critical exception (and
   is hidden when there are none).
6. Switch entity and confirm the board re-scopes.

**Expected:**
- The board reflects the same exceptions as each order's risk badge (no separate logic).
- Grouping, filtering, drill-down, roll-up, and CSV export all work and are entity-scoped.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 35 — Shipment journey & document readiness

**Setup:** A foreign-order shipment with some milestone dates filled (ready, ETD, departure, ETA) and
an ETA in the past with no arrival recorded; a supplier with contacts on the master if possible.

**Steps:**
1. Open the shipment. Confirm a **journey strip** shows Ready → Booked → Departed → Arrived →
   Clearance → Delivered → GRN, with completed steps marked, the current step highlighted, and
   planned-vs-actual dates.
2. Confirm a journey **alert** appears (e.g. "ETA was N days ago, no arrival recorded").
3. In **Document readiness**, confirm the checklist lists the clearance documents with a "N of M
   ready" pill. Click **Change** to cycle a document awaited → received → N/A and confirm the pill
   updates.
4. Set the shipment ETA within 7 days with an incomplete doc set, open **My Work**, and confirm a
   **"Complete clearance docs"** action appears.
5. Click **Log contact** on the shipment, record a contact, and confirm it saves (shipment-side
   communication log).

**Expected:**
- The journey reflects the shipment's real dates and flags timing exceptions proactively.
- The document checklist persists, summarises readiness, and drives a My Work demurrage-prevention
  alert when a shipment arrives with papers missing.
- Contact logging works from the shipment as it does from the order.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 36 — KPI Trends over time (incl. 2024 history backfill)

**Setup:** A data set spanning 2024 to today, including at least one older order that is **missing**
fields a KPI needs (e.g. no requested-receipt date) and at least one closed order with a GRN date.

**Steps:**
1. Open **Reports & Controls -> KPI Trends**. On a fresh database, confirm the empty-state guidance
   appears (no snapshots yet).
2. Click **Backfill history**. Confirm it reports how many past periods were backfilled, and that the
   trend tiles populate for OTIF, lead-time, lateness and clearance from the 2024-onward dates.
3. Confirm months with no eligible data were skipped (no empty rows), and that count metrics
   (open orders, overdue, high-risk) are marked **forward-only** (not backfilled).
4. Confirm the order missing a required field did **not** cause an error — it is simply excluded from
   that KPI's sample. The app must not block or show NaN; missing values show "—".
5. Click **Capture this month** and confirm the current month is added; re-run **Backfill** and confirm
   it writes nothing the second time (idempotent).
6. On the **Dashboard**, confirm OTIF / MTTO / lateness / clearance tiles show a small ▲/▼ indicator vs
   the last captured month.
7. Switch entity and confirm trends re-scope. Export the trend CSV.

**Expected:**
- Backfill populates date-bucketable KPIs from real historical dates; old/incomplete orders are
  excluded from a KPI's sample, never blocking the calculation or the app.
- Forward-only KPIs trend from first capture; charts handle missing months gracefully.
- Dashboard shows month-on-month direction; trends are entity-scoped and exportable.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 37 — Management control dashboards

**Setup:** Use a mixed demo dataset with open orders, at least one late/at-risk shipment, one partial
shipment, one open/overdue payment, one update request, and at least one supplier with multiple POs.

**Steps:**
1. Open **Reports & Controls -> Management Cockpit**. Confirm the KPI pills and four control tables
   populate and that row clicks open the relevant order/shipment/payment record.
2. Open **OTIF Risk Forecast**. Confirm high/medium/watch risks are sorted by score and export to CSV.
3. Open **Officer Workload**. Confirm open orders, shipments, payments, issues, update requests,
   due-soon and critical columns are entity-scoped.
4. Open **Logistics Operations -> Partial Shipments**. Confirm POs with S1/S2 or partial/balance/
   replacement/receipt-exception signals appear.
5. Open **Logistics Operations -> Clearance Readiness**. Confirm ETA <=7d, missing broker docs,
   missing clearance owner, and clearance-delay signals are visible.
6. Open **Finance Control -> Payment Exposure**. Confirm exposure groups by currency and due band.
7. Open **Operational Calendar** and test 30/60/90 day ranges and event-type filtering.
8. Open **Management Pack** and export the CSV.
9. Switch entity and repeat a spot check; every view must re-scope.

**Expected:**
- The views calculate from existing operational data only; no new records are created.
- All exports work and match the rows visible in the UI.
- The ERP/Data Warehouse reconciliation dashboard is not included in this tranche.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Scenario 37 — Role-based access demo (no-login role switcher)

**Purpose:** Demonstrate that the app enforces different access per role even in no-login mode.

**Steps:**
1. Click the **user chip** (top-right) to open **View as role**.
2. Select **Procurement Officer**. Confirm: you can create/edit orders, but shipment edit controls
   disappear; restricted items (Data Quality, some System Settings) leave the sidebar; the chip shows
   a dashed outline indicating demo mode.
3. Select **Logistics Officer**. Confirm the inverse — shipment create/edit available, order edit
   hidden.
4. Select **Stakeholder / Viewer**. Confirm a read-only experience (no create/edit on orders or
   payments).
5. Select **Superuser (admin)** to return to full access; confirm everything reappears.
6. Confirm switching roles does not change any data and does not require logging in as another person.

**Expected:**
- Each role shows only the actions and sections its permissions allow.
- The active role is shown in the header; demo mode is visually marked.
- Returning to Superuser restores full access.

**Actual result:** _____   **Tester:** _____   **Date:** _____   **Pass/Fail:** _____
**Comments:** _____

---

## Issues / defects log

| # | Scenario | Severity | Description | Reported by | Date | Status | Resolution |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |

> Severity: blocker / major / minor / cosmetic. Status: open / in progress / fixed / won't fix.

## Notes on feature availability

This pack assumes the current consolidated build: readiness gates, structured issue escalation,
PO Financial & Receipt Control, planned-vs-actual timeline, Data Quality Cockpit, and Working
Calendars are all available. Mark a scenario **N/A** only when the build under test has been
deliberately restricted or when its prerequisite test data is unavailable; state the reason in the
result register.
