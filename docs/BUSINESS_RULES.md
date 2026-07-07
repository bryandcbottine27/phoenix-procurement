# Phoenix Procurement - Business Rules

Last reviewed: 2026-07-06

This document distinguishes confirmed rules from assumptions and unresolved questions. Before changing procurement, logistics, finance, import, or access behaviour, check this file and `docs/DECISIONS.md`.

## 1. Purpose and scope

Confirmed:

- Phoenix Procurement is a procurement/logistics follow-up and control app.
- It is not a replacement ERP.
- ERP remains the source of truth for purchase order accounting, vendor master, item lines, invoices, and official receipts.
- Phoenix owns operational follow-up: chasing, status, logistics coordination, documents, exceptions, comments, dashboards, alerts, and management visibility.
- Rules must apply to all three entities unless an entity-specific exception is explicitly documented.

Entities:

- Phoenix
- Seychelles Breweries
- Edena

## 2. ERP and integration ownership

Confirmed:

- Phoenix currently uses Navision.
- Seychelles Breweries uses Business Central.
- Edena uses Business Central-style import rules in this app.
- Phoenix is expected to move to Business Central in future.
- The app should not connect directly to Navision, Business Central, or the Data Warehouse from the browser.
- Approved future path: ERP -> Data Warehouse/staging -> controlled sync/API service -> Phoenix Procurement.
- Current Excel import is a manual staging feed until the warehouse integration is ready.

Field ownership:

- ERP owns PO number, supplier/vendor, vendor code, currency, amount, PO date, description, IPR number, HOD approval date, claimant/requested-by where available, and ERP PO lifecycle status.
- Phoenix owns operational status, notes, milestones, shipments, documents, follow-ups, issues, claims, update requests, readiness controls, warnings, closure decisions, and dashboards.
- ERP status must not replace Phoenix operational status.
- Warehouse/API sync may refresh ERP-owned and ERP-seeded fields only.
- Warehouse/API sync must not overwrite Phoenix-owned operational fields.

## 3. Entity and currency rules

Confirmed:

- Seychelles Breweries local currency is SCR.
- Edena local currency is EUR.
- In Business Central imports, blank currency code means the entity local currency.
- In Business Central imports, explicit entity local currency code also means local order.
- Seychelles blank currency or SCR is local.
- Edena blank currency or EUR is local.

Assumption:

- Phoenix local currency is MUR unless ERP data indicates otherwise.

## 4. Function classification rules

Confirmed:

- Phoenix classification rules apply to Seychelles Breweries and Edena.
- Purchaser Code/ID and Purchasing Mgr ID indicate the procurement function.
- Purchaser Code/ID plus Purchasing Mgr ID are treated as function classification signals.
- Example confirmed: Purchaser Code/ID `ET01` plus Purchasing Mgr ID `RA01` means Indirect.

Confirmed ID-to-function mapping:

| ID | Function |
|---|---|
| BB01 | Technical |
| BR01 | Supply Chain |
| DC01 | Technical |
| EJ01 | Technical |
| EL01 | Technical |
| ET01 | Indirect |
| HB01 | Technical |
| MK01 | Supply Chain |
| RA01 | Indirect |
| SH01 | Supply Chain |
| SL01 | Supply Chain |
| SN01 | Supply Chain |
| TV01 | Indirect |
| VS01 | Technical |
| YA01 | Technical |

Confirmed category-to-function examples:

- Technical includes spare parts, capex, technical services, refrigeration, lab consumables/equipment, consumables, IT spares/equipment.
- Indirect includes marketing, HR, finance.
- Supply Chain includes raw materials/ingredients, primary packaging, secondary packaging, finished products, finished products alcoholic.

## 5. Purchase order tracking rules

Confirmed:

- Orders are split into Foreign and Local.
- Orders are further split by function: Technical, Indirect, Supply Chain.
- Operational order status should flow from order sent to supplier through supplier acknowledgement, clarification/amendment/payment, production/preparation, ready for collection/dispatch, logistics handover, receipt/GRN, closure, hold, or cancellation.
- ERP PO lifecycle status is stored separately as `erpPoStatus`.
- Imported ERP PO status maps only to an initial/suggested Phoenix status.
- Closed orders are hidden from default open views and available in Closed Orders/archives.
- Order Lookup was removed; Request Update is available on order/shipment rows and details where role access allows.
- IPR/PQ number should be visible in relevant order lists and filters.
- Seychelles calls IPR No. "PQ No."; Phoenix/Edena use IPR naming.

Confirmed order form structure:

- Header/basic fields: Entity, Order Type, Order Number, IPR/PQ Number, IPR HOD Approved Date, Category, Claimant, Purchasing Officer, No shipment required.
- Request details: Date Requested By Department, Date of Order, Requested Receipt Date, Order Sent to Supplier, Order Acknowledged, Order Ready Date.
- Supplier and goods: Supplier, Description, Detailed Description, Quantity where applicable.
- Financials: Currency, Amount, Forthcoming Payment Date, Payment Due Date, Payment Terms, Payment Schedule/Milestones.
- Status and tracking: Current Status, Notes.
- The previous separate "Order Tracking" section was removed.

Supply Chain item rule:

- Detailed Description and Quantity are per item.
- They apply to Supply Chain only.
- Technical and Indirect are not concerned with those item fields.

## 6. Shipment and receipt path rules

Confirmed:

- Shipment requirement is driven by operational reality, not just tangible/intangible nature.
- Foreign tangible orders normally require shipment follow-up.
- Foreign intangible orders do not require shipment follow-up and are controlled through order-level GRNs/receipt evidence where applicable.
- Local intangible orders normally have no shipment and may have one or multiple GRNs.
- Local tangible orders normally have no shipment and are controlled through one or multiple order-level GRNs.
- Local tangible orders may exceptionally have one or more shipment records.
- If a local shipment exists, it follows the same shipment rules, functions, principles, and controls as a foreign shipment.

GRN control:

- GRN matters most for receipt control.
- For foreign shipments, use shipment-level `deliveryDate` as the preferred delivery/receipt timing signal, with GRN date as fallback if delivery date does not exist.
- Foreign shipments must allow one or multiple GRNs per shipment.
- Local orders must allow one or multiple GRNs per order.
- If a local order has an exceptional shipment, that shipment must allow one or multiple linked GRNs.
- Delivery is not a separate accounting/control layer in this app.

GRN row fields:

- GRN Number.
- GRN Date.
- Linked Shipment, if applicable.
- Remarks/notes, optional.
- Status: pending, partially received, fully received, cancelled.

Validation/control:

- Shipment status is required on every shipment record.
- A received shipment result, such as fully received, partially received, short, missing, damaged, or over received, must have a shipment GRN date or a linked order GRN date.
- A shipment follow-up action of "Await GRN / store confirmation" is not considered processed by receipt result text alone; it requires a shipment GRN date or linked order GRN date.
- Shipment references must be unique, including archived records, to avoid S1/S2 collision if a shipment is restored.

Shipment record rules:

- Each actual shipment normally has its own shipment record.
- Shipment reference format is `FPO12345 (S1)`, `FPO12345 (S2)`, etc.
- If supplier initially says shipment is ready and later only part is ready, create or update shipment coverage/partial reason and create a next shipment if needed.
- If goods are received but missing parts require another shipment, create a new balance/replacement shipment.
- If shipping documents split goods but they remain on the same aircraft/vessel/logistics movement, they can remain under the same shipment record.
- If goods split by different transport mode/route, create separate shipment records.

Constraint:

- Do not reproduce the whole ERP PO item-line table as the main control surface. ERP remains source of truth for item-line quantities and official receipt accounting.

## 7. Shipment follow-up status rules

Confirmed:

Shipment status should follow the logistics flow from supplier collection through warehouse/GRN. Current canonical sequence includes:

1. Shipment request received
2. Collection to be arranged
3. Supplier contacted for collection
4. Ready confirmation pending
5. Shipping documents requested
6. Shipping documents received
7. Forwarder / carrier quotation requested
8. Booking in progress
9. Booking confirmed
10. Collection date requested
11. Collection date confirmed
12. Ready for pickup
13. Collected from supplier
14. Pending export clearance / origin documents
15. Awaiting departure
16. Departed origin
17. In transit
18. ETA revised / delayed
19. Arrived at destination / port
20. Documents sent to broker
21. Clearance preparation started
22. Under customs clearance
23. Clearance query / issue logged
24. Cleared by customs
25. Released for delivery
26. Delivery arranged
27. Delivered to warehouse
28. GRN pending
29. GRN completed
30. Shipment closed
31. Shipment on hold
32. Shipment cancelled

## 8. Payment and invoice rules

Confirmed:

- Payment terms drive milestone schedules where possible.
- Payment schedule/milestones may be generated from payment terms and manually adjusted where required.
- Generated percentage-based milestone amounts should reconcile to the PO total. When percentages total 100%, the final milestone absorbs rounding pennies/cents so 33.33/33.33/33.34-style splits equal the order amount.
- Multiple payment requests/RFPs can exist per PO.
- A milestone can link to an RFP.
- RFP status includes draft, forthcoming, submitted, approved, paid, rejected.
- Per-entity RFP numbering is used.
- Payment requests are Phoenix-owned operational records, not ERP invoice/payment records.
- Finance/payment visibility can be granted without allowing payment request creation.
- Internal stakeholders and other view-only users must not be allowed to request/create payment.
- View-only users may see whether a payment request exists and whether it has been paid, where view access allows.

Validation rules currently implemented:

- Payment request must link to an order.
- Amount must be numeric and not negative.
- Invoice number is required.
- Due date is required.
- Payment total cannot exceed order value beyond tolerance, excluding rejected/cancelled payments.

Assumption:

- ERP remains final source for official invoice and paid facts once integration is live.

## 9. Documents and SharePoint rules

Confirmed:

- Production document storage should be SharePoint/OneDrive, not base64 Firestore uploads.
- Phoenix should store metadata, status, links, folder paths, and readiness information.
- Current demo supports SharePoint/OneDrive links and small demo uploads.
- SharePoint folder shape:
  - Parent: `<PO No.> - <Supplier Name>`
  - Subfolder: `PO`
  - Subfolder: `Shipping Documents`
  - Shipment subfolder under Shipping Documents when linked to a shipment
  - Subfolder: `Payment`
  - Subfolder: `GRN`

Document validation:

- Unsafe links such as `javascript:` and `data:` are blocked.
- Document folder keys must be recognized.
- Rejected documents require a rejection reason.
- Expiry date cannot be before received date.

Unresolved:

- IT must provide SharePoint site/library, Entra app registration, Graph scopes, and retention/delete rules before upload is implemented.

## 10. Supplier rules

Confirmed:

- ERP vendor name and vendor code remain the values on the PO.
- Phoenix supplier master stores a separate supplier link for reporting/performance history.
- Supplier matching should prioritize ERP vendor code.
- Name and alias matching are fallback methods.
- Supplier compliance details should not be duplicated because ERP supplier setup already enforces compulsory compliance controls.
- Suppliers are per entity; the same vendor name may exist separately under each entity with its own vendor code.
- Supplier master can store aliases, ERP mappings, contacts, ratings, rating reasons, and rating history.

## 11. Roles and permission rules

Confirmed roles:

- admin
- procurement_senior_manager
- sc_manager
- sc_supervisor
- sc_officer
- procurement_technical_manager
- procurement_technical_supervisor
- procurement_technical_officer
- procurement_indirect_manager
- procurement_indirect_supervisor
- procurement_indirect_officer
- logistics_manager
- logistics_officer
- demand_supervisor
- demand_officer
- finance
- stakeholder

Confirmed principles:

- Admin has full access.
- Production mode ignores demo role overrides.
- Unknown roles/resources fail closed in production.
- Stream-scoped procurement roles only see their relevant function stream.
- View-only users must not be able to write through hidden buttons, stale onclicks, or console calls because `PXStore` enforces write permissions.
- Firestore rules must enforce the same access model server-side before production.

Request Update visibility:

- In Foreign/Local Order sections, Request Update is visible to Internal Stakeholder, Procurement Manager/Supervisor, and Logistic Manager/Supervisor where view access allows.
- In Operation/Shipment sections, Request Update is visible to Internal Stakeholder, Procurement Manager/Supervisor/Officer, and Logistic Manager/Supervisor/Officer where view access allows.
- Request Update should toggle according to user section access and be available on each applicable order/shipment row.

Payment request authority:

- Users without payment create permission cannot request/create payments.
- This specifically includes stakeholders and any configured view-only role.

## 12. Approval and audit history rules

Confirmed:

- Changes should be auditable.
- `status_log` stores status/change/import-history entries.
- Order amendments are stored in the order `amendments` array.
- Claims are stored in the order `claims` array.
- Creates/updates through `PXStore` stamp created/updated metadata.
- Soft archive should be used for business records.

Current exceptions:

- Demo purge hard-deletes test data only in isolated demo/admin mode and must remain disabled by default for shared testing, pilot, and production.
- Officer bootstrap writes the user profile directly during sign-in.
- RFP counter uses Firestore transaction.

## 13. Notifications, My Work, and warnings

Confirmed:

- My Work is a cross-entity personal action queue.
- My Work should show actionable items for the current officer/role.
- Once a triggered action is processed, it should disappear from My Work/Dashboard and no longer be marked unattended.
- Snoozed items should disappear until the snooze date.
- My Day narrows the queue to overdue and due-soon items.

Confirmed warning/control points:

- Order sent with no follow-up/activity for more than 5 working days.
- Foreign goods ready for more than 2 working days with no shipment requested.
- Shipment open more than 5 working days without ETD.
- ETA within 7 working days without broker documents or clearance owner.
- Cargo arrived but clearance not started within 3 working days.
- Clearance in progress beyond 5 working days unless an issue is logged.
- Released cargo not delivered or GRN recorded after 7 working days.
- ETA changed more than 3 times.
- Open issue past target resolution date, with 3 days maximum expected target, should appear prominently in My Work.
- Requested receipt overdue with no receipt evidence.
- Supplier promise overdue.
- Supplier promise revised repeatedly.
- Next supplier follow-up overdue.
- Open high/critical issue.
- Closed order with open work remaining.
- ERP/DW sync missing/stale/error.
- ERP/Phoenix amount/currency/supplier mismatch.
- Supplier unmapped.

## 14. KPIs and operational reporting rules

Confirmed:

- KPIs and reports should support operational follow-up, not replace ERP reporting.
- Management Cockpit is a control entry point and may redirect to focused subviews.
- KPI Trends, OTIF Risk Forecast, Officer Workload, Operational Calendar, Management Pack, Exceptions, Data Quality, and Supplier Scorecards are valuable management controls.
- TEPS Tax Provision Forecast supports finance/cash provisioning.
- Container demurrage/detention supports logistics cost exposure.

Assumption:

- KPI samples should exclude records where required dates are missing, rather than inventing false performance.

## 15. Unresolved questions

- Final production identity approach: Firebase email/password versus Azure AD/M365 SSO/custom token.
- Final Firestore rule design and deployment owner.
- SharePoint Graph adapter details and retention/delete rules.
- Data Warehouse source table/view names and batch/error-monitoring contract.
- Whether production zips should remain in the project folder or be moved to a formal release location.
- Whether the project should adopt an automated test framework, and which one.
