PHOENIX PROCUREMENT — DEMO CONFIGURATION (READ ME FIRST)
=========================================================

>>> WHICH FILE DO I OPEN FOR THE DEMO? <<<
    Open:  dist/phoenix-procurement-DEMO.html
    (Double-click it, or open it in any modern browser — Chrome/Edge recommended.)

That single file IS the demo. There is no separate "BC" version to hunt for —
the Business Central look is built in and ON by default.

dist/ NOW CONTAINS EXACTLY ONE DEMO FILE (no duplicates to test by mistake):
  - phoenix-procurement-DEMO.html .............. the tester-facing demo file (OPEN THIS)
  (The old phoenix-procurement-no-login.html and phoenix-procurement-BC-STRUCTURE-DEMO.html
   were byte-identical copies and have been removed to avoid confusion.)

WHAT THIS BUILD IS:
  - demoMode = true (src/core.js): role switcher + multi-tab roles ENABLED, NO real login.
  - Business Central-style UI (top-nav, ribbon, card page, FactBox) with Phoenix branding.
  - Works across all three entities: Phoenix, Seychelles Breweries, Edena.
  - DO NOT deploy this DEMO file to a live server (no auth).

TO REBUILD FROM SOURCE:
    python3 build.py
  This regenerates dist/phoenix-procurement-DEMO.html + runs syntax and structural invariant checks.

FOR PRODUCTION:
  Use the PRODUCTION package instead (demoMode = false; role switcher removed).
  See HANDOVER-TO-IT.md for deployment and Firebase/Firestore notes.
