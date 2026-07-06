# Archive folder

This folder documents the **old "bundle" files** that no longer exist in the project.

## The old bundle files and what replaced them

During the modular refactor, the app was split out of a single HTML file. Temporary
combined files named `*.bundle.js` existed along the way. They have all been
**renamed or split, then deleted**:

| Old file (no longer exists) | Replaced by |
|---|---|
| `src/core.bundle.js` | `src/core.js` |
| `src/operational.bundle.js` | `src/operational.js` |
| `src/modules/orders/orders.bundle.js` | `orders.{service,render,form,detail}.js` |
| `src/modules/shipments/shipments.bundle.js` | `shipments.{service,render,form,detail}.js` |
| `src/modules/payments/payments.bundle.js` | `payments.{service,render,form,detail}.js` |
| `src/modules/suppliers/suppliers.bundle.js` | `suppliers.{service,render,form}.js` |
| `src/modules/reports/reports.bundle.js` | `reports.{service,render,form}.js` |

**None of these `*.bundle.js` files are present in this project (the zip).** There is
nothing here to restore and nothing to edit. The active source is only under `/src`.

## If you still see `*.bundle.js` files in your local `/src` folder

That means your local/OneDrive folder has **stale leftovers from an older copy** —
they were never part of these newer builds, and unzipping a new version on top of an
old folder does not delete old files. They are NOT loaded by the app (neither
`build.py` nor `index.html` references them), but they can confuse you into editing
the wrong file.

Delete only the seven known stale bundle filenames listed above from that old local
folder, or replace the old folder with a clean extraction of this package. The cleanup
scripts that existed during earlier refactors are no longer shipped because the active
project no longer contains those files.

## Superseded standalone source files

The following old standalone source files were audited during cleanup. Their
functionality now lives inside active modules, so the files are **not shipped anywhere
in this package**:

| Removed file | Superseded by / reason |
|---|---|
| `src/poImport.js` | Legacy placeholder pointer. The active ERP Excel import engine is `src/modules/reports/erpImport.js` (defines `window.PXPoImport`). |
| `src/xlsxReader.js` | Standalone no-library XLSX reader. The same reader is now self-contained inside `src/modules/reports/erpImport.js` (defines `window.PXXlsxReader`). |

Do not reintroduce these into `src/` or `archive/` — they would duplicate the active
implementations.
