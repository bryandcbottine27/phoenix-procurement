# Phoenix Procurement - Runtime Access Grid

This document mirrors the current demo implementation at a practical level. The
runtime source of truth is `REF.permissions` and `REF.viewAccess` in `src/core.js`;
all Firestore business writes are also checked centrally by `src/firestoreStore.js`.

Legend: **F** = view/create/edit/archive, **CE** = create/edit, **V** = view only,
**-** = no access. `admin` remains the IT/superuser role.

## Implemented Roles

| # | Role | App role |
|---|---|---|
| 1 | Senior Procurement Manager | `procurement_senior_manager` |
| 2 | Supply Chain Manager | `sc_manager` |
| 3 | Supply Chain Supervisor | `sc_supervisor` |
| 4 | Supply Chain Officer | `sc_officer` |
| 5 | Procurement Technical Manager | `procurement_technical_manager` |
| 6 | Procurement Technical Supervisor | `procurement_technical_supervisor` |
| 7 | Procurement Technical Officer | `procurement_technical_officer` |
| 8 | Procurement Indirect Manager | `procurement_indirect_manager` |
| 9 | Procurement Indirect Supervisor | `procurement_indirect_supervisor` |
| 10 | Procurement Indirect Officer | `procurement_indirect_officer` |
| 11 | Logistics Manager | `logistics_manager` |
| 12 | Logistics Officer | `logistics_officer` |
| 13 | Demand Planning Supervisor | `demand_supervisor` |
| 14 | Demand Planning Officer | `demand_officer` |
| 15 | Finance | `finance` |
| 16 | Internal Stakeholder / Claimant | `stakeholder` |

## Action Access Summary

| Resource | Senior Proc. | Stream Managers | Stream Supervisors | Stream Officers | Logistics | Demand | Finance | Stakeholder | Admin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Orders | V | F | CE | CE | V | V | V | V | F |
| Shipments | V | F | V | V | F | V | - | V | F |
| Exports / Outbound | V | V | V | V | F | V | - | V | F |
| Payments / RFP | V + approve | V + approve | CE + approve | CE | V | - | V + approve | V | F |
| Milestones | F | F | CE | CE | Manager CE / Officer V | V | V | - | F |
| Suppliers | F | F | CE | CE | V | V | V | - | F |
| Documents | V | V | CE | CE | Manager F / Officer CE | V | V | V | F |
| Follow-ups | F | F | CE | CE | Manager F / Officer CE | V | - | - | F |
| Issues | F | F | CE | CE | Manager F / Officer CE | V | V | V | F |
| Update Requests | F | F | CE | CE | Manager F / Officer CE | CE | CE | CE | F |
| Officers & Roles | V | V for managers | - | - | - | - | - | - | F |
| Reports | V | V | V | V | V | V | V | - | F |
| ERP Reconciliation | F | F | - | - | Manager CE / Officer - | - | - | - | F |

`REF.viewAccess` further scopes which views are hidden or read-only for each role.
For example, Technical roles only see the Technical order streams, Indirect roles
only see the Indirect streams, and Supply Chain roles only see Supply Chain streams.
Use `src/core.js` for exact sidebar/view behavior before changing access.

## Important Runtime Rules

- Payment requests can be viewed by view-only roles, but only roles with
  `payments:create` can raise RFPs.
- Internal Stakeholders and other view-only roles can see whether an RFP exists
  and whether it is paid, but they cannot raise, edit, approve, or mark payments.
- Exports / Outbound is logistics-owned. Logistics Manager and Logistics Officer
  can create/edit/archive exports; procurement, demand, and stakeholder roles are
  view-only; finance has no exports access.
- KPI snapshot capture/backfill is privileged: admin plus manager/supervisor roles.
- Shipment document readiness is editable only by roles with shipment or document
  edit access. View-only shipment users see the checklist without change controls.
- Officers & Roles is admin-write only. Selected managers may view the section,
  but cannot edit roles.
- Update requests are separate from operational editing. Users may request an
  update where allowed, but only the assigned officer or Admin can mark the
  request as attended.
- The same access model applies across all entities: Phoenix, Seychelles
  Breweries, and Edena.

## Navigation Access

Exact sidebar visibility and read-only page access are held in `REF.viewAccess`
inside `src/core.js`. When updating access later, update both:

1. `REF.permissions` for action rights.
2. `REF.viewAccess` for sidebar/view visibility.

Then rebuild and test at least these demo roles: Stakeholder, Finance,
Logistics Officer, Logistics Manager, Supply Chain Officer, Supply Chain Manager,
Procurement Technical Officer, Procurement Technical Manager, Procurement Indirect
Officer, Procurement Indirect Manager, and Admin.
