# Phoenix Procurement - Runtime Access Grid

This document mirrors the current demo implementation. The runtime source of
truth is `REF.permissions` and `REF.viewAccess` in `src/core.js`; all Firestore
business writes are also checked centrally by `src/firestoreStore.js`.

Legend: **F** = view/create/edit/archive, **CE** = create/edit, **V** = view only,
**-** = no access. `admin` remains the IT/superuser role.

## Implemented Roles

| # | Role | App role |
|---|---|---|
| 1 | Senior Procurement Manager | `procurement_senior_manager` |
| 2 | Procurement / Supply Chain Manager | `procurement_manager` |
| 3 | Procurement / Supply Chain Supervisor | `procurement_supervisor` |
| 4 | Procurement / Supply Chain Officer | `procurement_officer` |
| 5 | Logistics Manager | `logistics_manager` |
| 6 | Logistics Officer | `logistics_officer` |
| 7 | Demand Planning Supervisor | `demand_supervisor` |
| 8 | Demand Planning Officer | `demand_officer` |
| 9 | Finance | `finance` |
| 10 | Internal Stakeholder / Claimant | `stakeholder` |

## Action Access

| Resource | 1 SnrMgr | 2 Mgr | 3 Supv | 4 Offr | 5 LogMgr | 6 LogOff | 7 DPSupv | 8 DPOff | 9 Fin | 10 Stake | Admin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Orders | V | F | F | CE | V | V | V | V | V | V | F |
| Shipments | V | F | V | V | F | F | V | V | - | V | F |
| Payments / RFP | V | V | CE | CE | V | V | - | - | V | V | F |
| Milestones | F | F | CE | CE | CE | V | V | V | V | - | F |
| Suppliers | F | F | CE | CE | V | V | V | V | V | - | F |
| Documents | V | V | F | CE | F | CE | V | V | V | V | F |
| Follow-ups | F | F | F | CE | F | CE | V | V | - | - | F |
| Issues | F | F | CE | CE | F | CE | V | V | V | V | F |
| Update Requests | F | F | CE | CE | F | CE | CE | CE | CE | CE | F |
| Officers & Roles | V | - | - | - | - | - | - | - | - | - | F |
| Reports | V | V | V | V | V | V | V | V | V | - | F |
| ERP Reconciliation | F | F | CE | - | CE | - | - | - | - | - | F |

## Important Runtime Rules

- Payment requests can be viewed by view-only roles, but only Procurement /
  Supply Chain Supervisor, Procurement / Supply Chain Officer, and Admin can
  create or edit RFPs.
- Internal Stakeholders and other view-only roles can see whether an RFP exists
  and whether it is paid, but they cannot raise, edit, approve, or mark payments.
- Shipment document readiness is editable only by roles with shipment edit
  access. View-only shipment users see the checklist without change controls.
- Officers & Roles is admin-write only. Senior Procurement Manager may view the
  section, but cannot edit roles.
- Update requests are separate from operational editing. Users may request an
  update where allowed, but only the assigned officer or Admin can mark the
  request as attended.
- The same access matrix applies across all entities: Phoenix, Seychelles
  Breweries, and Edena.

## Navigation Access

Exact sidebar visibility and read-only page access are held in `REF.viewAccess`
inside `src/core.js`. When updating access later, update both:

1. `REF.permissions` for action rights.
2. `REF.viewAccess` for sidebar/view visibility.

Then rebuild and test at least these demo roles: Stakeholder, Finance,
Logistics Officer, Procurement Officer, Procurement Manager, and Admin.
