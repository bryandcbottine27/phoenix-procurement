# Phoenix Procurement — IT Handover Package

**Prepared for:** Phoenix Beverages IT / Infrastructure team
**Application:** Phoenix Procurement — a procurement "control tower" layered over the ERP
(Navision → Business Central), covering Phoenix, Seychelles Breweries, and Edena.
**Contents of this package:** the production application, full source, and all documentation
needed to deploy it.

---

## 1. Read this first — what you are receiving, in one paragraph

This is a complete, working web application backed by Google Firebase / Firestore. The business
logic, the full feature set, and a 10-role access-control model are finished and verified. **It is not,
however, a "drop it on a server and forget it" deliverable** — going live safely requires you to point
it at your own Firebase project, apply database security rules, decide on an authentication method, and
prepare the data. Those steps are spelled out in `docs/GO_LIVE_RUNBOOK.md`. Please complete that runbook
before opening the app to real users. The most important single step is applying the **Firestore
security rules** — without them, the database has no server-side protection.

---

## 2. What's in this package

```
phoenix-procurement-PRODUCTION.html   ← the built production app (single file)
src/                                   ← full modular source (58 modules)
index.html, build.py, styles/, tools/  ← build system (rebuild with: python build.py)
docs/
  GO_LIVE_RUNBOOK.md                   ← ★ your deployment checklist — start here
  FIRESTORE_RULES/                     ← ★ two security-rule templates (mandatory)
  PHOENIX_DEVELOPER_NOTES.md           ← architecture & every feature, for maintainers
  DATA_DICTIONARY.md                   ← the data model (auto-generated)
  PILOT_TEST_PACK.md                   ← test scenarios incl. role-based access
  PHOENIX_ACCESS_GRID.xlsx             ← the approved per-role access matrix
  (plus supporting specs)
```

The app is also available built and ready-to-open at
`dist/phoenix-procurement-PRODUCTION.html`.

---

## 3. The four things IT must do before go-live (summary — full detail in the runbook)

1. **Stand up a production Firebase project.** Do not reuse any prototype project for live data.
   Put its config into the `APP_CONFIG` block at the top of `src/core.js`, then rebuild.
2. **Apply the Firestore security rules** (`docs/FIRESTORE_RULES/`). This is the real, server-side
   access control. The app's in-browser role checks are necessary for a correct UI but can be bypassed;
   the database rules are what actually protect the data. **No rules = not safe to go live.**
3. **Decide and wire authentication.** Either Azure AD / M365 single sign-on (recommended — gives true
   per-person access), or an interim internal-network-only launch. The app supports both; the runbook
   covers each.
4. **Prepare the data.** Use a clean (empty) production database, seed officers with their roles, import
   the 2024→today order history, then run KPI Trends → "Backfill history" once.

A full pre-go-live verification checklist is at the end of the runbook.

---

## 4. About the access control (so IT understands what's already built)

The application enforces a **10-role model** in its interface — Senior Procurement Manager,
Procurement/SC Manager / Supervisor / Officer, Logistics Manager / Officer, Demand Planning Supervisor /
Officer, Finance, and Internal Stakeholder, plus an Admin (IT) role. Each role's screen visibility and
allowed actions were defined by the business and are documented in `docs/PHOENIX_ACCESS_GRID.xlsx`.
Every create / edit / delete / approve action is permission-gated in the code.

**Important:** this is the *application layer*. It produces the correct experience per role, but a
determined user could bypass browser-side checks. The **Firestore security rules** (step 2 above) are
what enforce these same boundaries on the server. Both layers should agree; the rule templates are a
starting point that IT must review and adapt to the final identity model.

The production build (`demoMode: false`) additionally disables the demo-only role switcher and fails
"closed" — an unknown role or an unlisted action is denied rather than allowed.

---

## 5. What is explicitly out of scope (so there are no surprises)

- **Live ERP integration.** The app ingests ERP data by Excel import, not a live Navision/Business
  Central sync. A live integration is a separate future project.
- **The authentication implementation itself** (Azure AD wiring) is IT's to complete — the app is built
  to accept it.
- **Ongoing role administration** (assigning people to roles) is a business/admin task, done in-app.

---

## 6. Who built what / how to maintain

The app is a single-file build assembled from modular source by `build.py` (which also runs a syntax
gate and 13 structural invariant checks). To change anything: edit `src/`, run `python build.py`, and
ship the regenerated `dist/` file. Architecture and conventions are in
`docs/PHOENIX_DEVELOPER_NOTES.md`.

---

*If anything in the runbook is unclear, the developer notes and the data dictionary together describe
the system in full. The safest sequence is: read this page → work through `GO_LIVE_RUNBOOK.md` →
verify against its checklist → then open to users.*

---

## Review updates (this build)

### Which demo file to open
`dist/phoenix-procurement-DEMO.html` is the single generated demo file — open this. (The former
`phoenix-procurement-no-login.html` and `phoenix-procurement-BC-STRUCTURE-DEMO.html` were
byte-identical duplicates and have been removed to avoid testing a stale copy.) The Business
Central UI is ON by default — there is no separate BC build.

### BC Card Page — scope (P4)
The full-page **Business Central card page** (Back link + action ribbon + tabbed content + FactBox rail)
currently applies to **ORDERS only**. Opening an order replaces the list with its card; the **Back**
button returns to the exact operational view you came from (Dashboard, My Work, Foreign/Local Orders,
Reports/Controls, Exceptions, etc.).

**Shipment and Payment-Request details remain modal-based — this is intentional for now.** Extending
the card-page pattern to Shipments and Payment Requests is a planned, separate increment; it was kept
out of this build to avoid destabilising those flows. The card page is behind `APP_CONFIG.bcCardPage`
(default true) and `APP_CONFIG.bcStructure`; setting either false reverts orders to modal behaviour.

### Empty BC menu groups (P2)
BC top-menu groups now hide automatically when a role has no visible items inside them. This runs after
role switch, entity switch, page refresh, and any re-render, across all three entities.

### Login model (segregation of duties)
Each user must use their own username/password or SSO account. Shared departmental logins and the former
"Who's working?" picker are no longer part of the active build. Access is resolved from the authenticated
user's officer profile (`officers/{auth uid}`, `authUid`, or `email`), so My Work, approvals and audit
trails remain tied to the real person. IT must provision one account per user and ensure the matching
Officer record has the correct role, function, email/Auth UID and active status.

### Demo Firestore behaviour (P5)
Subscriptions for `updateRequests`, `contactLog`, `kpiSnapshot`, and `exports` fail gracefully in the
demo (empty or restricted collections log a calm `[demo] … continuing.` info message, not an error).
Their state arrays are pre-initialised, so no view breaks when a collection is empty or read-restricted.
