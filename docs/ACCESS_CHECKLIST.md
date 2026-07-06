# Phoenix Procurement — Views & Functions Checklist

This is the complete, current inventory of every navigable view (section) and the main actions in the
app, taken directly from the code. Mark it up however you like — e.g. note which **roles** should or
should not see each view, or which **actions** a role should/shouldn't be able to do — and send it back.
I'll then apply the access changes precisely.

Legend you can use when marking up: write the roles allowed next to each line, e.g.
`[ ] Shipments — logistics, admin (procurement view-only)`.
Roles available: **admin**, plus **procurement_senior_manager, procurement_manager,
procurement_supervisor, procurement_officer, logistics_manager, logistics_officer,
demand_supervisor, demand_officer, finance, stakeholder**.

---

## 1. Workbench

- [ ] **Dashboard** `[dashboard]` — operational overview, KPI tiles, risk/ageing, alerts
- [ ] **My Work** `[mywork]` — personal action queue (snooze, My Day, auto-chase prompts)

## 2. Foreign Orders

- [ ] **Technical** `[orders-foreign-technical]`
- [ ] **Indirect** `[orders-foreign-indirect]`
- [ ] **Supply Chain** `[orders-foreign-supplychain]`

## 3. Local Orders

- [ ] **Technical** `[orders-local-technical]`
- [ ] **Indirect** `[orders-local-indirect]`
- [ ] **Supply Chain** `[orders-local-supplychain]`

## 4. Logistics Operations

- [ ] **Shipments** `[shipments]` — shipment list, journey tracker, document readiness
- [ ] **Container Tracker** `[containers]`
- [ ] **Partial Shipments** `[partials]`
- [ ] **Clearance Readiness** `[clearance]`

## 5. Finance Control

- [ ] **Forthcoming Payments** `[forecast]`
- [ ] **Payment Requests** `[payments]`
- [ ] **Payment Exposure** `[paymentexposure]`
- [ ] **Tax Provision Forecast — TEPS** `[taxprovision]`

## 6. Records & Archives

- [ ] **Closed Orders** `[closedorders]`
- [ ] **Documents** `[documents]`

## 7. Reports & Controls

- [ ] **Management Cockpit** `[mgmtcockpit]`
- [ ] **Reports & Export** `[reports]`
- [ ] **Suppliers** `[suppliers]`
- [ ] **KPI Trends** `[kpitrends]`
- [ ] **OTIF Risk Forecast** `[otifrisk]`
- [ ] **Officer Workload** `[workload]`
- [ ] **Operational Calendar** `[opcalendar]`
- [ ] **Management Pack** `[managementpack]`
- [ ] **Exceptions** `[exceptions]`
- [ ] **Data Quality** `[dqcockpit]`  *(currently restricted → admin + managers/supervisors)*
- [ ] **Supplier Scorecards** `[scorecards]`

## 8. System Settings

- [ ] **Officers & Roles** `[officers]`  *(currently admin-gated in practice)*
- [ ] **ERP Reconciliation** `[erprecon]`
- [ ] **ERP Import Rules** `[erpimportrules]`  *(currently restricted → admin + managers/supervisors)*
- [ ] **Working Calendars** `[workingcalendars]`  *(currently restricted → admin + managers/supervisors)*

---

## Key actions / functions (the things users *do*, gated by the permission matrix)

These are governed per-role by the permission matrix (resource → allowed actions). Mark up who should
be able to do each.

### Orders
- [ ] Create order `(openOrderForm)` — *currently: procurement + managers + admin*
- [ ] Edit order — *same*
- [ ] Archive order — *same*
- [ ] View order detail `(openOrderDetail)` — *all roles*
- [ ] Request update on an order `(openUpdateRequestModal)`
- [ ] Log a contact `(openContactLogModal)`
- [ ] PO line control / receipts `(openLineControl)`

### Shipments
- [ ] Create shipment `(openShipmentForm)` — *currently: logistics + managers + admin*
- [ ] Edit shipment — *same*
- [ ] Archive shipment — *same*
- [ ] View shipment detail `(openShipmentDetail)` — *all roles*
- [ ] Edit journey / milestones `(openTimelineEditor)`
- [ ] Document readiness toggle

### Payments
- [ ] Create payment request `(openPaymentForm)` — *currently: procurement supervisor/officer + admin only*
- [ ] Edit payment / approve — *same*
- [ ] View payments `(openPaymentDetail)` — *currently: procurement roles, finance, logistics, stakeholder via linked order, and admin*

### Suppliers
- [ ] Create / edit supplier `(openSupplierForm)` — *currently: procurement + managers + admin*
- [ ] View supplier detail `(openSupplierDetail)` — *all roles*

### Documents
- [ ] Add / edit document `(openDocumentForm)` — *most roles create/edit; stakeholder view-only*
- [ ] Open stored file `(__openStoredFile)`

### Follow-ups & Issues
- [ ] Create / edit follow-up `(openFollowupForm)`
- [ ] Create / edit issue `(openIssueForm)`

### Officers & System
- [ ] Add / edit officer & assign role `(openOfficerForm)` — *admin only*
- [ ] ERP import / reconciliation — *managers + admin*
- [ ] Backup / export all `(openBackupDialog)`
- [ ] **Clear all data** `(__purgeAllData)` — *demo build only; admin; hidden in production*

### Demo-only aids (disabled in the production build)
- [ ] Role switcher `(__openRoleSwitcher)` — view-as-role
- [ ] Open role in new tab `(__openRoleInNewTab)`

---

## How to mark this up

For each view or action, just note the roles that **should** have access. For example:
- "Payment Requests → procurement supervisor/officer only for creation; finance/logistics/stakeholder view-only"
- "Working Calendars → admin only (not managers)"
- "Officer Workload → managers + admin only"

Send it back and I'll translate your notes into the permission matrix and the view-restriction lists,
verify each change, and rebuild both the DEMO and PRODUCTION full packages in one clean pass.
