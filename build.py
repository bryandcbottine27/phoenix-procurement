#!/usr/bin/env python3
"""Phoenix Procurement — build step.
Bundles the modular /src + /styles back into double-clickable HTML files
at /dist/phoenix-procurement-DEMO.html
(works on file:// / OneDrive, no server).
Run:  python3 build.py
"""
import re, os, sys, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))

def read(p): return open(os.path.join(HERE, p), encoding='utf-8').read()

# Keep DATA_DICTIONARY.md generated from src/schema.js on every build so the two
# can never drift. --write regenerates; --check then verifies (fails loudly).
def sync_data_dictionary():
    gen = os.path.join(HERE, 'tools', 'gen_data_dictionary.py')
    if not os.path.exists(gen):
        print("WARN: tools/gen_data_dictionary.py missing — skipping dictionary sync.")
        return
    subprocess.run([sys.executable, gen, '--write'], check=True)
    subprocess.run([sys.executable, gen, '--check'], check=True)

sync_data_dictionary()

index = read('index.html')
css = read('styles/main.css')

# The exact module load order (must match index.html)
MODULES = [
  'src/core.js',
  'src/globalProgress.js',
  'src/erpOwnership.js','src/schema.js',
  'src/workflows.js','src/validators.js','src/permissions.js',
  'src/apiClient.js',
  'src/firestoreStore.js',
  'src/importRules.js',
  'src/documentService.js',
  'src/dataQuality.js',
  'src/controls.js',
  'src/procurementFollowup.js',
  'src/followupSnooze.js',
  'src/myWork.js','src/modules/dashboard.js',
  # orders (service → render → form → detail: bridges defined before use)
  'src/modules/orders/orders.service.js','src/modules/orders/orders.sortfilter.js','src/modules/orders/orders.render.js',
  'src/modules/orders/orders.form.js','src/modules/orders/updateRequests.js',
  'src/modules/orders/contactLog.js',
  'src/modules/orders/orders.detail.js',
  # documents (central per-PO folder cabinet)
  'src/modules/documents/documents.render.js',
  # shipments
  'src/modules/shipments/shipments.service.js','src/modules/shipments/shipments.render.js',
  'src/modules/shipments/shipments.form.js','src/modules/shipments/shipmentJourney.js','src/modules/shipments/shipments.detail.js',
  'src/modules/shipments/containers.render.js',
  'src/modules/shipments/exports.js',
  # payments
  'src/modules/payments/payments.service.js','src/modules/payments/payments.render.js',
  'src/modules/payments/payments.form.js','src/modules/payments/payments.detail.js',
  'src/modules/payments/forecast.render.js',
  'src/modules/shipments/taxprovision.service.js','src/modules/shipments/taxprovision.render.js',
  # suppliers
  'src/modules/suppliers/suppliers.service.js','src/modules/suppliers/suppliers.render.js',
  'src/modules/suppliers/suppliers.form.js',
  'src/modules/officers.js',
  'src/modules/importRules.js',
  'src/modules/workingCalendars.js',
  # reports
  'src/modules/reports/reports.service.js','src/modules/reports/importHistory.js','src/modules/reports/reports.render.js',
  'src/modules/reports/reports.form.js','src/modules/reports/erpImport.js',
  'src/modules/reports/dqCockpit.js','src/modules/reports/scorecards.js',
  'src/modules/reports/exceptions.js',
  'src/modules/reports/kpi.js',
  'src/modules/reports/kpiTrends.js',
  'src/modules/reports/managementControls.js',
  'src/modules/reports/dailyControlRoom.js',
  'src/operational.js','src/warehouseAdapter.js','src/erpAdapter.js',
  'src/bcStructure.js',
  'src/teamWork.js',
  'src/fastTab.js',
  'src/bcCardPage.js',
]

# 0. SYNTAX GATE — every module must parse as JS. A single syntax error in any
#    type="module" script makes the WHOLE app fail to render (blank screen), so we
#    fail the build loudly here rather than ship a broken bundle. Requires `node`.
def _node_available():
    try:
        subprocess.run(['node', '--version'], capture_output=True, check=True)
        return True
    except Exception:
        return False

if _node_available():
    syntax_failures = []
    for m in MODULES:
        res = subprocess.run(['node', '--check', os.path.join(HERE, m)],
                             capture_output=True, text=True)
        if res.returncode != 0:
            syntax_failures.append((m, (res.stderr or res.stdout).strip().splitlines()[:4]))
    if syntax_failures:
        print("BUILD FAILED — JavaScript syntax error(s):")
        for m, lines in syntax_failures:
            print(f"  ✗ {m}")
            for ln in lines:
                print(f"      {ln}")
        sys.exit(1)
    print(f"Syntax check: all {len(MODULES)} modules parse.")
else:
    print("WARN: node not found — skipping JS syntax check (install Node.js to enable).")

# 1. Replace the CSS <link> with an inline <style>
out = index.replace(
  '<link rel="stylesheet" href="styles/main.css" />',
  '<style>\n' + css + '\n</style>'
)

# 2. Replace the block of <script src> tags with inlined module bodies (same order)
script_tags = '\n'.join(f'  <script type="module" src="{m}"></script>' for m in MODULES)
inlined = '\n'.join(f'<script type="module">\n{read(m)}\n</script>' for m in MODULES)
out = out.replace(script_tags, inlined)

os.makedirs(os.path.join(HERE, 'dist'), exist_ok=True)
# Only ONE official demo HTML is generated, to avoid duplicate-purpose files in dist.
# - phoenix-procurement-DEMO.html : the demo build (BC structure on by default).
#   (The former phoenix-procurement-no-login.html and -BC-STRUCTURE-DEMO.html were
#   byte-identical copies and have been removed. Do not reintroduce duplicate demo files.)
open(os.path.join(HERE, 'dist', 'phoenix-procurement-DEMO.html'), 'w', encoding='utf-8').write(out)
print("Built dist/phoenix-procurement-DEMO.html")

# Build-time invariant checks — fail loudly on structural regressions.
check_script = os.path.join(HERE, 'tools', 'check_invariants.py')
if os.path.exists(check_script):
    subprocess.run([sys.executable, check_script], check=True)
else:
    print("WARN: tools/check_invariants.py missing — skipping invariant checks.")

# No-dependency local regression checks for permission, security-rule, and data
# integrity contracts that can be tested before a final Firebase environment exists.
regression_script = os.path.join(HERE, 'tools', 'regression_checks.js')
if os.path.exists(regression_script):
    if _node_available():
        subprocess.run(['node', regression_script], check=True)
    else:
        print("WARN: node not found — skipping regression checks.")
else:
    print("WARN: tools/regression_checks.js missing — skipping regression checks.")
