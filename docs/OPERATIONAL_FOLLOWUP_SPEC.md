# Phoenix Procurement — Operational Follow-up Enhancements (Spec for review)

This spec covers the four areas you selected: **the chase**, **logistics visibility**,
**daily worklist**, and **the exceptions digest**. It is written for review — nothing here is
built yet. Each section states what already exists in the app, the gap, and exactly what I would
add, so you can approve, change, or cut item by item.

A guiding principle throughout: **this is a follow-up app, not an ERP.** Nothing below reproduces
ERP transactions (PO lines, GRNs, invoices stay in Navision / Business Central). Every feature lives
in the operational layer the ERP ignores — the chasing, the waiting, the conversation, the journey,
the readiness.

A second principle: **build on what exists.** The audit showed you already have a `followups`
collection, a `procurementFollowup` engine (commitments, next-chase, ageing, risk), supplier
contacts with escalation levels, ETA + actual departure/arrival with change history, demurrage
tracking, and a shipment exception model. Most of this work is *surfacing and connecting* those
pieces, not building from scratch.

---

## Area 1 — The chase (communication log, promises, auto-chase)

### What already exists
- `followups` collection: comment, nextAction, nextActionDueDate, assignedTo, status (open/done).
- `followupMethod` on orders (email / phone / Teams / portal / meeting / other).
- Supplier `contacts` array with name, role, email, phone, escalation level, preferred flag.
- `procurementFollowup` computes `commitment()` (from supplierPromisedDate /
  supplierRevisedPromisedDate), `nextChase()`, ageing, and promise-revision count.

### The gap
There is no **timestamped conversation log** per order. The follow-up record captures the *next
action* but not the *history of contact* ("emailed 3rd, chased 10th, promised 15th, silent since").
And chasing is reactive — the officer must remember to chase; the app does not prompt.

### What I would build
1. **Communication log per order (and per shipment).** A new lightweight `contactLog` concept —
   either a small array on the order or a `contactLog` collection — each entry: date, direction
   (we contacted / they responded), channel (reuses `followupMethod` values), contact person (from
   supplier contacts), summary, and optional "response expected by" date. Shown as a timeline on the
   order detail. This becomes the officer's memory of the relationship.
2. **Auto-chase prompts in My Work.** Using the existing commitment / ack-SLA logic, surface
   proactive items: "PO sent N days ago, no acknowledgement — chase", "supplier promised <date>, now
   overdue — follow up", "no contact logged in N days on an active order". These are *generated*, not
   manually created, so the officer never has to remember.
3. **One-click "log a chase".** From My Work or the order, a quick action that records a contact-log
   entry and (optionally) sets the next chase date — turning "I chased them" into one tap.

### Decisions to confirm
- Contact log as an **array on the order** (simpler, travels with the record) vs a **collection**
  (queryable across orders, better for a cross-order "who haven't we chased" view). Recommendation:
  collection, for the daily worklist in Area 3.
- Should logging a chase be allowed for **logistics officers on shipments** too, or procurement only?

---

## Area 2 — Logistics visibility (ETA / milestones, document readiness)

### What already exists
- Shipment record: `eta`, `actualDepartureDate`, `actualArrivalDate`, `etaChangeHistory`,
  `grnDate`, `vesselFlight`, demurrage / detention tracking, container tracker view.
- Shipment exception model: `receiptResult`, `followupAction`, `followupActionStatus`.

### The gap
The dates exist but there is no **journey view** that lays out the shipment lifecycle as
expected-vs-actual milestones with proactive alerts, and there is **no document-readiness checklist**
— the single biggest cause of clearance delay and demurrage is missing paperwork (BL/AWB, packing
list, commercial invoice, certificate of origin, etc.).

### What I would build
1. **Shipment journey / milestone tracker.** A per-shipment visual lifecycle: Booked -> ETD ->
   In transit -> Port arrival -> Customs / clearance -> Cleared -> Delivered / GRN. Each step shows
   expected vs actual (reusing eta / actualDepartureDate / actualArrivalDate / grnDate and the
   demurrage clock). Proactive alerts: "ETA was <date>, N days ago, no arrival recorded",
   "arrived <date>, still under clearance N days". Pure logistics value, mostly assembling fields you
   already have.
2. **Document-readiness checklist per shipment.** A configurable required-docs list (BL/AWB, packing
   list, commercial invoice, certificate of origin, insurance, inspection cert — defaults by
   incoterm / mode, editable). Each doc: status (awaited / received / N/A), from whom, date. A
   shipment shows "5 of 7 docs ready" and flags an **incomplete set before the container arrives**,
   so clearance is not blocked at the port. Ties to the existing Documents page.
3. **A logistics watchlist.** Active shipments sorted by soonest ETA / most overdue, with the open
   action on each — the logistics officer's "where is everything" screen.

### Decisions to confirm
- Required-doc list: **fixed default set**, or **configurable per entity / incoterm / mode**?
- Should the doc checklist link to the actual uploaded documents (Documents page) or just track
  status? Recommendation: track status now, link to uploads as a fast follow.

---

## Area 3 — Daily worklist ("my day", snooze, next action)

### What already exists
- **My Work** aggregates open actions (orders, shipments, payments, claims, update requests) with
  tiers (critical / soon / upcoming) and entity scope.
- `nextAction` / `nextActionDueDate` / `assignedTo` on follow-ups.

### The gap
My Work shows *what is open* but not *what to do today*, and it has no **snooze**. The same 40 items
stare back every morning; an officer who chased something today still sees it tomorrow. There is no
notion of "handled for now, remind me in 3 days".

### What I would build
1. **"My Day" view** — a focused daily queue: items due today or overdue, sorted by urgency, each
   with its next action and owner. Distinct from My Work's full backlog: My Day is "what needs me
   *today*".
2. **Snooze.** Any actionable item can be snoozed to a date ("chased today, remind me in 3 days").
   Snoozed items drop off the daily queue and resurface on the snooze date. Implemented as a
   `snoozedUntil` field on the follow-up / action source, so it is durable and per-item.
3. **Next-action capture on the spot.** When an officer acts on an item, prompt for the next action +
   date in one step, so the chain never breaks and nothing is "done but forgotten".

### Decisions to confirm
- Snooze stored on the **follow-up record** (clean for follow-up-type actions) — but some My Work
  items are *computed* (e.g. "no ack in 7 days"), which have no record to snooze. For those, a small
  per-officer `snoozes` store keyed by a synthetic action id. Recommendation: support both.
- Is "My Day" a **new nav item**, or a **tab/toggle inside My Work**? Recommendation: a toggle inside
  My Work to avoid nav clutter.

---

## Area 4 — Exceptions / stuck-orders digest

### What already exists
- `procurementFollowup` already computes risk, ageing, and `orderChecks` (a set of per-order
  exception signals). The Dashboard surfaces some risk/ageing panels. The Data Quality Cockpit covers
  *data* exceptions.
- Shipment exceptions (`receiptResult`, `followupAction`).

### The gap
There is no single **operational exceptions view** answering "what is stuck and whose?" across the
whole pipeline — no ack, overdue promise, ready-but-not-shipped, arrived-no-GRN, payment-blocking-
collection — in one ranked list, for the Monday meeting and for managers.

### What I would build
1. **Stuck-orders / exceptions board.** One screen listing every active order/shipment hitting an
   operational exception, grouped by exception type, each row showing the order, the issue, days
   stuck, the owner, and a jump to act. Built largely from the existing `orderChecks` / risk engine —
   this is mostly presentation over logic you already have.
2. **Owner roll-up.** A by-officer summary ("Officer X: 4 stuck, 2 overdue promises") for handover
   and accountability, reusing the delegation/assignment model.
3. **Optional weekly digest snapshot.** A printable / exportable "state of the pipeline this week"
   view for management — no new data, just a framed summary of the board.

### Decisions to confirm
- Should this be **manager-only** (privileged view) or visible to all officers? Recommendation:
  visible to all, since officers benefit from seeing their own stuck items; managers get the
  cross-officer roll-up.
- Distinct nav item ("Exceptions") vs a tab on the Dashboard. Recommendation: its own item under
  Reports & Controls.

---

## How these connect (why design them together)

- The **contact log (1)** feeds the **daily worklist (3)** ("not chased in N days") and the
  **exceptions board (4)** ("overdue promise").
- The **snooze (3)** applies to chase prompts (1), logistics alerts (2), and exceptions (4) — one
  snooze mechanism, used everywhere.
- The **logistics alerts (2)** and **chase prompts (1)** are both just *generated actions* that land
  in My Day (3) and, when overdue, on the exceptions board (4).

So under the hood this is really: **(a) a contact-log record, (b) a generated-action layer with
snooze, (c) two new views (My Day toggle, Exceptions board) and one enriched view (shipment journey
+ doc checklist).** That shared spine is why building them together is far less work than four
separate features.

---

## Build status — ALL PHASES COMPLETE

1. **Snooze + My Day toggle** (Area 3) — ✅ built & shipped (Phase 1). Per-officer snooze on any My
   Work action; "My Day" toggle narrows to overdue + due-soon.
2. **Contact log + log-a-chase + auto-chase prompts** (Area 1) — ✅ built & shipped (Phase 2). A
   `contactLog` collection, communication timeline on the order/shipment, and generated chase prompts
   in My Work (chase reply / no recent contact). Decision taken: contact log is a **collection**.
3. **Exceptions board** (Area 4) — ✅ built & shipped (Phase 3). A new Exceptions view grouping
   `orderChecks()` exceptions by type with an owner roll-up. Decision taken: **visible to all**, its
   own nav item under Reports & Controls.
4. **Shipment journey + document checklist** (Area 2) — ✅ built & shipped (Phase 4). Journey strip
   with planned-vs-actual and proactive alerts; a persisted document-readiness checklist driving a
   demurrage-prevention My Work alert. Decision taken: **fixed default doc set, editable per shipment**
   (status-tracked; linking to uploaded files remains a fast-follow).

Implementation details for each phase are in PHOENIX_DEVELOPER_NOTES.md sections 13i–13l, and pilot
scenarios 32–35 cover them.
