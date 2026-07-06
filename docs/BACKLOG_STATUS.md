# Phoenix Procurement - Consolidated Backlog Status

Updated: 24 June 2026

This note records the outcome of the consolidated review of the product discussion and the active
modular source. It distinguishes delivered operational capability from work that needs external
systems or source data. It is not a replacement for the generated data dictionary.

## Delivered operational foundation

- Modular source with a generated single-file build, central `PXStore` write path, field ownership,
  validation, audit logging, data dictionary, and developer notes.
- Multi-entity handling for Phoenix, Seychelles Breweries, and Edena; card-first operational lists
  with dense tables retained for reports and reconciliation.
- ERP Excel import preflight, supplier mapping worklist, import history, entity/function
  classification rules, reconciliation, and preservation of Phoenix-owned operational data. Where
  the supplier master is initially empty, a guarded bootstrap can create masters from stable ERP
  vendor codes and link the imported POs without fuzzy merging names.
- Planned-versus-actual timeline, readiness panels, structured Issues and escalation, My Work,
  Data Quality Cockpit with assignable actions, PO Financial & Receipt Control, payment forecasts,
  TEPS, landed cost, container exposure, supplier scorecards, claims, delegation, and document
  control.
- Entity working calendars. Administrators maintain approved public or company holiday dates in
  System Settings. Data Quality and My Work now exclude those dates as well as weekends when they
  evaluate working-day thresholds.

## Deliberately not implemented in the browser prototype

- Real sign-in, Azure AD identity, Firestore security rules, and server-side authorization. These
  need the production identity and security design; a no-login demo must not pretend to enforce them.
- Live Navision / Business Central integration. This needs a server-side integration layer, service
  credentials, endpoint contracts, retry/monitoring, and field-map approval. The browser only keeps
  adapters and ownership maps ready for that work.
- Production document storage. The demo supports links and small base64 test uploads only. Real
  documents need SharePoint/OneDrive via Microsoft Graph or Firebase Storage, with access control,
  retention, and malware scanning agreed with IT.
- Live Navision / Business Central integration remains outside the browser prototype. Edena is now
  supported by the controlled Excel import path, including the shared purchaser-code classifier and
  EUR local-currency handling, but automated ERP/warehouse sync still needs the approved server-side
  integration layer.

## Operating discipline before launch

- Maintain a named calendar owner for each entity and load only confirmed closure dates.
- Keep the generated `docs/DATA_DICTIONARY.md` aligned with every schema change by running
  `python build.py`.
- Treat the Pilot Test Pack as the release gate. Test imports and operational rules with copied data
  before changing live records.
- Do not move live ERP credentials, access tokens, or privileged writes into the single-file client.
  Use an approved server-side integration service when the ERP phase begins.
