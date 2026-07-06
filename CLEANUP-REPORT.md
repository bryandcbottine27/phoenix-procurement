# Phoenix Procurement — Pre-Go-Live Cleanup Report

This report documents the project/package cleanup. The goal was to remove duplicate-purpose
files and confusion, **not** to delete useful modules.

## 1. Files removed (deleted)

| File | Why removed |
|---|---|
| `dist/phoenix-procurement-no-login.html` | Byte-identical duplicate of `phoenix-procurement-DEMO.html`. |
| `dist/phoenix-procurement-BC-STRUCTURE-DEMO.html` | Byte-identical duplicate of `phoenix-procurement-DEMO.html`. |
| `DATA_DICTIONARY.md` (project root) | Exact duplicate of `docs/DATA_DICTIONARY.md`, which is the generated, canonical copy. |
| `cleanup-old-bundles.sh` | Obsolete — targeted `*.bundle.js` files that no longer exist anywhere in the project. |
| `cleanup-old-bundles.bat` | Obsolete — same as above (Windows variant). |
| `src/poImport.js` and any archived copy | Legacy placeholder pointer. Active importer is `src/modules/reports/erpImport.js` (`window.PXPoImport`). No source copy is shipped. |
| `src/xlsxReader.js` and any archived copy | Standalone reader superseded by the reader embedded in `src/modules/reports/erpImport.js` (`window.PXXlsxReader`). No source copy is shipped. |
| `src/workingIdentity.js` | Removed shared departmental-login picker. IT will issue individual user credentials instead. |

## 2. Archive notes

No duplicate-purpose source files are preserved in `archive/`. The archive folder is
documentation-only and explains what old bundle files and superseded standalone files
were replaced by.

## 3. Duplicate-LOOKING files intentionally KEPT (different purpose)

These were audited and confirmed to serve **distinct** purposes, so they were kept:

| File(s) | Why kept |
|---|---|
| `src/importRules.js` **and** `src/modules/importRules.js` | Different layers: the first is the **engine** (`window.PXImportRules` — save/store/baseline logic); the second is the **UI renderer** for the `erpimportrules` view. Both are built and required. |
| `docs/ACCESS_CHECKLIST.md`, `docs/ACCESS_GRID.md`, `docs/PHOENIX_ACCESS_GRID.xlsx` | Different artefacts: a manual checklist, a runtime access grid (Markdown), and the spreadsheet version. Not duplicates. |
| The modular `*.service.js` / `*.render.js` / `*.form.js` / `*.detail.js` split across orders, shipments, payments, suppliers, reports | Deliberate separation of responsibilities (data/service vs render vs form vs detail). Not duplicates. |

## 4. Build changes

- `build.py` now generates **only** `dist/phoenix-procurement-DEMO.html` (previously wrote three
  byte-identical files). Header comment and dist notes updated.
- `tools/check_invariants.py` updated to read `dist/phoenix-procurement-DEMO.html` and no longer
  expects any removed duplicate-purpose source files.
- The shared-login `workingIdentity.js` module was removed from `index.html` / `build.py`.

## 5. Bug fixed — first-time setup hang (Priority 5)

The setup form previously saved the profile then called `signInAnonymously()` **only if**
`auth.currentUser` was absent. When Firebase already had an anonymous user, `onAuthStateChanged`
did not re-fire, so the app stayed on “Setting up…” until a manual page refresh.

**Fix:** the post-auth continuation was extracted into a single reusable function,
`continueAfterAuth(user)` (in `src/core.js`). It is now called from **both**:
1. `onAuthStateChanged(auth, user => …)`, and
2. the setup-form submit handler, when `auth.currentUser` already exists.

A re-entry guard prevents double execution. On failure, the error is shown and the button resets
to “Continue”. Result: the app opens immediately after Continue, with no refresh needed.

## 6. Documentation updated

- `README.md` — generated-files table, build notes, and legacy-file notes corrected to the single
  demo file; obsolete cleanup-script callout removed.
- `_README-FIRST-DEMO.txt` — now states the single demo file to open.
- `HANDOVER-TO-IT.md` — “which demo file to open” corrected.
- `docs/PHOENIX_DEVELOPER_NOTES.md` — source/generated locations and workflow corrected;
  archived-file note added.
- `archive/README.md` — documents old bundle and superseded source history without shipping duplicate source copies.

## 7. Verification run (Priority 8)

- Data dictionary regenerated: **358 fields**, in sync with `src/schema.js`.
- JS syntax check: all source modules parse.
- Full build + structural invariant checks: **all passed**.
- Built bundle parses; **zero** references to any removed file remain.
- Component smoke check on the built bundle confirmed present & wired: setup-hang fix,
  entity switching, order card page, per-column sort/filter, role switcher, individual-login mapping, Finance exports
  hiding, Seychelles “PQ No.” label, SEY officer←Purchaser Code mapping, `demoMode: true`.

## Final state

`dist/` contains exactly one demo file. No duplicate-purpose files remain in the active tree.
Superseded source copies are not shipped; only the replacement history is documented in `archive/README.md`.
