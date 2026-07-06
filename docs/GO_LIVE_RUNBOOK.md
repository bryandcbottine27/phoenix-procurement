# Phoenix Procurement — Go-Live Deployment & Hardening Runbook

**Audience:** the IT / infrastructure team deploying this application to a server.
**Status of the app:** feature-complete and verified as a **prototype**. It is **not** production-secure
until the steps in this runbook are completed. Read this document fully before deploying.

> **One-sentence summary for management:** the application works and the business logic is complete, but
> going live safely requires a hardened Firebase project, server-side security rules, a decision on login,
> and a data-preparation step — all described below. Deploying the file alone, without these, would expose
> live procurement data without access control.

---

## 0. What this deliverable is (and is not)

**Is:** a single-file web app (`phoenix-procurement.html`) plus its modular source, that runs the full
Phoenix Procurement control-tower feature set against a Firebase/Firestore backend.

**Is not — yet — "plug and play":** the prototype ran in **no-login mode** where every browser self-declares
identity and has full access. Production requires the access-control and data steps below. The application
*code* supports production; the surrounding configuration is what this runbook delivers.

---

## 1. Set the app to production mode (one edit)

In the deployed HTML (or in `src/core.js` before building), find the **`APP_CONFIG`** block at the very
top and:

1. Replace `firebase: { ... }` with **your own Firebase project's** web config (see §2).
2. Set **`demoMode: false`**.

Setting `demoMode: false` automatically disables every no-login demo aid:
- the header **role switcher** (users can no longer reassign their own role),
- the **`?role=` / `?as=` URL overrides** (URL params can no longer spoof identity),
- the **"Clear all data" purge** tool,
- and switches permission checks to **fail-closed** (an unknown role or unlisted resource is **denied**,
  not granted).

This single flag is the difference between the demo build and the production build. Nothing else in the
app code needs to change for either login path.

---

## 2. Stand up a dedicated production Firebase project

Do **not** reuse the prototype Firebase project for live data.

1. Create a new Firebase project (e.g. `phoenix-procurement-prod`).
2. Enable **Cloud Firestore** (production mode).
3. Register a **Web App** in the project; copy its config into `APP_CONFIG.firebase` (§1).
4. Restrict the **API key** (Google Cloud Console → Credentials): set HTTP-referrer restrictions to your
   server's domain only, and restrict it to the Firebase/Firestore APIs actually used.
5. Set Firestore **location** to the region closest to Mauritius/Seychelles for latency.

---

## 3. Apply Firestore security rules (MANDATORY)

**This is the most important step.** The app's role checks run in the browser and a determined user can
bypass any client-side gate. Real access control **must** be enforced server-side by Firestore rules.
Until rules are applied, anyone who can reach the database can read and write everything.

The exact rules depend on the login decision in §4. Two starting templates are provided in
`docs/FIRESTORE_RULES/` (see that folder):
- `firestore.rules.authenticated` — for the Azure AD / authenticated path: only signed-in users can read;
  writes are constrained by the user's role claim and the collection.
- `firestore.rules.internal-locked` — for an internal launch without per-user login: restricts access to
  requests originating from your network/app and blocks anonymous public access, as an interim measure.

**Neither template should be deployed unread.** Have whoever owns Firebase review and adapt them to your
identity model, then deploy with the Firebase CLI (`firebase deploy --only firestore:rules`). Test with the
Rules Playground before go-live.

> If you take only one thing from this runbook: **no security rules = no go-live.**

---

## 4. Decide and wire authentication

The business has not yet finalised whether per-user login (Azure AD / M365) is in place for launch. The app
supports both; choose one:

### Path A — Azure AD / M365 single sign-on (recommended for true access control)
- Register the app in **Azure AD** (app registration; redirect URI = your server URL).
- Wire Firebase Auth to the Microsoft identity provider (Firebase supports OIDC/SAML), or use MSAL to obtain
  the identity and exchange it for a Firebase custom token via a small Cloud Function.
- On sign-in, set the user's **role** (`admin` or one of the 10 organisational role codes:
  `procurement_senior_manager`, `procurement_manager`, `procurement_supervisor`,
  `procurement_officer`, `logistics_manager`, `logistics_officer`, `demand_supervisor`,
  `demand_officer`, `finance`, `stakeholder`) as a custom
  claim or in their `officers` record. The app reads `state.officer.role` — populate it from the verified
  identity instead of the prototype's self-set profile.
- Apply `firestore.rules.authenticated`.
- This gives genuine "assign correct access to everyone": access follows the person's real corporate login.

### Path B — Internal launch without per-user login (interim)
- Acceptable only on a **restricted internal network** where reaching the app already implies authorisation.
- Apply `firestore.rules.internal-locked` and lock network access (VPN / IP allow-list / internal hosting).
- Roles are assigned by an admin editing each person's `officers` record (`role` field). Without login the
  app cannot *verify* identity, so this is weaker than Path A — treat it as a stepping stone, documented and
  signed off by management as an accepted interim risk.

The application code is identical for both; only `APP_CONFIG`, the Firestore rules, and the sign-in wiring
differ.

---

## 5. Prepare the data

1. **Purge demo data.** The production Firebase project should start empty. (If you cloned a database that
   contains demo records, clear them before go-live — in demo mode the Reports "Danger Zone" tool does this;
   in production it is disabled, so clear via the Firebase console or a one-off script.)
2. **Seed reference data:** officers (with correct `role` per person), entities, suppliers, working calendars,
   import rules.
3. **Import historical orders (2024 → today).** Use the in-app ERP import. Old/incomplete orders are handled
   gracefully (missing fields exclude a record from a KPI's sample; they never block the import). After import,
   open **KPI Trends → Backfill history** once to populate past-month trends from the historical dates.

---

## 6. Host the app

- Serve `phoenix-procurement.html` over **HTTPS** from your server or a static host (the app is a single file
  plus its Firebase calls; no app server is required).
- Set a strict **Content-Security-Policy** allowing the Firebase/Google endpoints the app uses.
- Restrict who can reach the URL per the §4 decision (public-with-login, or internal-network-only).

---

## 7. Pre-go-live verification checklist

- [ ] `APP_CONFIG.demoMode === false` in the deployed file.
- [ ] Production Firebase project in use (not the prototype project); API key restricted.
- [ ] Firestore **security rules deployed** and tested in the Rules Playground.
- [ ] Authentication path chosen, wired, and tested (or interim network-lock signed off).
- [ ] Each person's `officers.role` is correct; a non-admin **cannot** see restricted views or edit outside
      their role (verify by signing in as a test user of each role).
- [ ] A user **cannot** self-elevate (confirm the role switcher and `?role=` URL params do nothing in prod).
- [ ] Demo data purged; reference data seeded; historical orders imported; KPI history backfilled.
- [ ] App served over HTTPS; URL access restricted appropriately.
- [ ] A full **Backup All** export taken and stored before opening to users.

When every box is ticked, the app is ready for users. Until then, it is not.

---

## 8. What remains the business's / vendor's responsibility, not IT's

- Final sign-off on the **auth model** (Path A vs B) and acceptance of any interim risk.
- Ongoing **role administration** (who holds each of the 10 organisational roles, plus `admin`).
- The eventual **live ERP integration** (Navision → Business Central), which is out of scope for this build —
  the app currently ingests ERP data by import, not live sync.

---

*This runbook accompanies the production build. The application's internal architecture, feature set, and
the demo-vs-production flag are documented in `PHOENIX_DEVELOPER_NOTES.md`.*
