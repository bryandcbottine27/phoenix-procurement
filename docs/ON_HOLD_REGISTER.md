# Phoenix Procurement — On-Hold / Later Register

This register keeps deferred recommendations, suggestions, and tasks visible without mixing them into the active build.

## On Hold

| Item | Status | Why Held | Resume Trigger |
|---|---|---|---|
| SharePoint adapter / Microsoft Graph upload | On hold | Current app is SharePoint-ready but does not have Azure AD app registration, SharePoint site/library details, or Graph permissions yet. | IT confirms site URL, library, Entra app registration, scopes, and upload/delete rules. |
| ERP / Data Warehouse reconciliation dashboard | On hold by user | The current request excludes this item. The concept remains useful once Navision/Business Central data is fed via a warehouse. | Data warehouse source tables/views are confirmed and business reconciliation rules are agreed. |
| Direct ERP connector to Navision / Business Central | Parked | IT recommended a Data Warehouse so Phoenix does not connect directly to ERP production systems. | Only revisit if DW approach is rejected. |
| Azure AD login and production access model | Later | Prototype still uses no-login/demo profile flow. | Before pilot or production access outside the test environment. |
| Production document migration | Later | Demo uploads are base64 in Firestore; production should use SharePoint links/upload. | SharePoint adapter is ready and document library is live. |
| Final security hardening | Later | Current build is still demo/prototype. | Before production launch. |
| Desktop app packaging | Parked | Web-based approach is preferred for ERP/BC/SharePoint/cloud integration and easier updates. | Only revisit if IT requires a desktop shell for deployment policy reasons. |
| Full backend/API refactor | Later | Current modular front-end is stable enough for demo; heavy backend work should follow final integration decisions. | After DW/API/SharePoint architecture is approved. |

## Rule

When a new recommendation is deferred, add it here with:

- the reason it is deferred,
- the trigger to resume,
- and whether the user, IT, or development team owns the next decision.
