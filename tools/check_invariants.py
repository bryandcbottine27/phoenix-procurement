#!/usr/bin/env python3
"""Phoenix Procurement — build-time invariant checks.

Runs after the bundle is built and asserts the structural invariants that keep the
single-file app coherent. Any failure exits non-zero so build.py stops loudly.

These are the same checks that were previously done by hand during code audits:
  1. Every nav data-view has a matching renderer AND a view section.
  2. Every nav view is covered by the breadcrumb and navSection maps.
  3. Every window.PX* engine that is referenced is also defined.
  4. Every window.__* bridge that is referenced is also defined.
  5. Every inline onclick="fn(...)" target is defined somewhere.
  6. The built dist has balanced braces per module and zero un-inlined module tags.
  7. ERP status mappings (REF.erpStatusMap.po) all target valid orderFollowupStatuses.
  8. The importer never seeds the bare invalid 'open' / 'Order placed' order status.
  9. VALIDATOR_TYPE contains no dead mappings (every type has a validateX function).
  10. The SharePoint-ready document folder shape exists.
  11. Pre-test data integrity controls stay in place.
  12. Only the two approved package zip names exist in the project root.

Run:  python3 tools/check_invariants.py
"""
import os, re, sys, glob, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

def read(p):
    with open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()

def src_files():
    return [p for p in glob.glob(os.path.join(ROOT, 'src', '**', '*.js'), recursive=True)]

def all_src():
    return '\n'.join(read(os.path.relpath(p, ROOT)) for p in src_files())

FAILURES = []
def check(name, ok, detail=''):
    status = 'PASS' if ok else 'FAIL'
    print(f"  [{status}] {name}" + (f" — {detail}" if detail and not ok else ''))
    if not ok:
        FAILURES.append(name + (f": {detail}" if detail else ''))

def main():
    print("Phoenix invariant checks:")
    index = read('index.html')
    src = all_src()
    dist_path = 'dist/phoenix-procurement-DEMO.html'
    dist = read(dist_path) if os.path.exists(os.path.join(ROOT, dist_path)) else ''

    # --- 1. nav views <-> renderers <-> view sections ---
    nav_views = set(re.findall(r'data-view="([^"]+)"', index))
    renderers = set(re.findall(r"__renderers\['([^']+)'\]", src))
    sections  = set(re.findall(r'id="view-([^"]+)"', index))
    missing_renderer = nav_views - renderers
    missing_section  = nav_views - sections
    check("every nav view has a renderer", not missing_renderer, f"missing: {sorted(missing_renderer)}")
    check("every nav view has a view section", not missing_section, f"missing: {sorted(missing_section)}")

    # --- 2. breadcrumb + navSection coverage ---
    bc = set(re.findall(r"'([\w-]+)':\s*'[^']*'", _block(read('src/core.js'), 'const breadcrumb = {')))
    ns = set(re.findall(r"'([\w-]+)':\s*'[^']*'", _block(read('src/core.js'), 'const navSection = {')))
    check("breadcrumb covers all nav views", not (nav_views - bc), f"missing: {sorted(nav_views - bc)}")
    check("navSection covers all nav views", not (nav_views - ns), f"missing: {sorted(nav_views - ns)}")

    # --- 3. PX* engines used vs defined ---
    px_def = set(re.findall(r"window\.(PX[A-Za-z]+)\s*=", src))
    px_use = set(re.findall(r"window\.(PX[A-Za-z]+)", src))
    undefined_px = px_use - px_def
    check("every PX* engine used is defined", not undefined_px, f"undefined: {sorted(undefined_px)}")

    # --- 4. window.__* bridges used vs defined ---
    h_def = set(re.findall(r"window\.(__[A-Za-z_]+)\s*=", src))
    h_use = set(re.findall(r"window\.(__[A-Za-z_]+)", src))
    undefined_h = h_use - h_def
    check("every __ bridge used is defined", not undefined_h, f"undefined: {sorted(undefined_h)}")

    # --- 5. inline onclick targets resolve ---
    onclick_fns = set(re.findall(r"onclick=[\\\"']{1,2}([a-zA-Z_]\w*)\(", src))
    unresolved = set()
    for fn in onclick_fns:
        pat = re.compile(r'(window\.%s\b|function %s\b|\b%s\s*=\s*function|\b%s\s*=\s*\(|const %s\b)' % ((re.escape(fn),)*5))
        if not pat.search(src):
            unresolved.add(fn)
    check("every inline onclick target is defined", not unresolved, f"unresolved: {sorted(unresolved)}")

    # --- 6. dist integrity ---
    if dist:
        mods = re.findall(r'<script type="module">(.*?)</script>', dist, re.DOTALL)
        bad = [i+1 for i, m in enumerate(mods) if m.count('{') != m.count('}')]
        check("dist module braces balanced", not bad, f"unbalanced modules: {bad}")
        check("dist has zero un-inlined module tags", 'script type="module" src=' not in dist)
    else:
        check("dist exists", False, "dist not built yet")

    # --- 7. ERP status map targets are valid orderFollowupStatuses ---
    core = read('src/core.js')
    ofs = set(re.findall(r'"([^"]+)"', _block(core, 'orderFollowupStatuses: [', close=']')))
    po_map = re.findall(r"'([^']+)':\s*'([^']+)'", _block(core, 'po: {', close='}'))
    invalid_targets = [f"{k}->{v}" for k, v in po_map if v not in ofs]
    check("erpStatusMap.po targets are valid statuses", not invalid_targets, f"invalid: {invalid_targets}")

    # --- 8. importers never seed the bare invalid order status ---
    bad_seed = []
    for p in ['src/modules/reports/erpImport.js', 'src/modules/reports/reports.render.js']:
        body = read(p)
        if re.search(r"status:\s*'Order placed'", body):
            bad_seed.append(f"{p}: 'Order placed'")
        # bare lowercase 'open' as an *order* status (rec.status / status: in an order map)
        if re.search(r"rec\.status\s*=\s*'open'", body):
            bad_seed.append(f"{p}: rec.status='open'")
    check("importers seed a valid order status", not bad_seed, f"found: {bad_seed}")

    # --- 9. VALIDATOR_TYPE has no dead mappings ---
    store = read('src/firestoreStore.js')
    vmap = re.findall(r"(\w+):\s*'(\w+)'", _block(store, 'VALIDATOR_TYPE = {', close='}'))
    validators = read('src/validators.js')
    dead = []
    for coll, kind in vmap:
        cap = kind[0].upper() + kind[1:]
        if not re.search(r'function validate%s\b' % cap, validators):
            dead.append(f"{coll}->{kind}")
    check("VALIDATOR_TYPE has no dead mappings", not dead, f"dead: {dead}")

    # --- 10. SharePoint-ready document folder shape ---
    doc_folder_block = _block(core, 'documentFolders: [', close=']')
    required_doc_folders = {'purchase_order', 'shipping_documents', 'payment_request', 'grn'}
    doc_folder_keys = set(re.findall(r"key:\s*'([^']+)'", doc_folder_block))
    missing_doc_folders = required_doc_folders - doc_folder_keys
    check("document folders support PO/Shipping/Payment/GRN", not missing_doc_folders, f"missing: {sorted(missing_doc_folders)}")

    # --- 11. Pre-test data integrity controls ---
    data_quality = read('src/dataQuality.js')
    proc_followup = read('src/procurementFollowup.js')
    my_work = read('src/myWork.js')
    order_render = read('src/modules/orders/orders.render.js')
    order_form = read('src/modules/orders/orders.form.js')
    payments_service = read('src/modules/payments/payments.service.js')
    payments_form = read('src/modules/payments/payments.form.js')
    shipment_form = read('src/modules/shipments/shipments.form.js')
    erp_import = read('src/modules/reports/erpImport.js')

    integrity_failures = []
    if not re.search(r"demoResetEnabled:\s*false", core):
        integrity_failures.append("REF.demoResetEnabled must default false")
    if "REF.demoResetEnabled" not in erp_import or re.search(r"const demo\s*=\s*!\(window\.__isDemoMode\)", erp_import):
        integrity_failures.append("purgeAllData must require demo mode and demoResetEnabled")
    if not re.search(r"readyNoShipmentWorkingDays:\s*2", data_quality):
        integrity_failures.append("Data Quality ready/no-shipment threshold must be 2 working days")
    if "readyNoShipmentWorkingDays" not in proc_followup or "readyNoShipmentWorkingDays" not in my_work:
        integrity_failures.append("ready/no-shipment checks must use the shared DQ threshold")
    if "Shipment status is required" not in validators:
        integrity_failures.append("shipment status must be validator-required")
    if "already in use on order" not in validators or "checkShipmentDuplicates" not in shipment_form or "Save anyway?" in shipment_form[shipment_form.find("checkShipmentDuplicates"):shipment_form.find("Validate the linked order actually exists")]:
        integrity_failures.append("duplicate shipment IDs must be hard-blocked")
    if "Receipt result shows goods were received" not in validators or "linked GRN date" not in validators:
        integrity_failures.append("received shipment results must require a GRN date/link")
    if "shipment.grnDate || linkedGrn" not in core:
        integrity_failures.append("Await GRN action must require actual GRN evidence")
    if "PXReceiptControl.grnCountsAsReceipt" not in order_render or "r.grnCountsAsReceipt" in order_render:
        integrity_failures.append("order Awaiting/Overdue filters must use the GRN helper")
    if "allocateMilestoneAmounts" not in core or "allocateMilestoneAmounts(orderAmount, schedule)" not in core:
        integrity_failures.append("generated milestones must use the shared amount allocator")
    if "milestoneAmountsLookPercentDerived" not in payments_service or "milestoneAmountsLookPercentDerived" not in payments_form or "milestoneAmountsLookPercentDerived" not in order_form:
        integrity_failures.append("payment forecast/RFP/order save must preserve reconciled milestone amounts")
    if "case 'grn_date'" not in core or "PXReceiptControl" not in _block(core, "case 'grn_date':", close="break;"):
        integrity_failures.append("GRN-date milestone anchor must read receipt control data")
    check("pre-test data integrity controls stay enforced", not integrity_failures, f"issues: {integrity_failures}")

    # --- 12. Package zip hygiene ---
    approved_zips = {'Phoenix Procurement DEMO FULL.zip', 'Phoenix Procurement PRODUCTION FULL.zip'}
    root_zips = {os.path.basename(p) for p in glob.glob(os.path.join(ROOT, '*.zip'))}
    extra_zips = sorted(root_zips - approved_zips)
    missing_zips = sorted(approved_zips - root_zips)
    check("only approved package zips exist", not extra_zips and not missing_zips,
          f"extra: {extra_zips}; missing: {missing_zips}")

    zip_failures = []
    required_common = {
        'index.html', 'build.py', 'AGENTS.md', 'README.md',
        'src/core.js', 'styles/main.css', 'tools/package.py',
        'backend/package.json', 'backend/src/sql/client.ts', 'backend/db/001_init.sql',
        'docs/BACKEND_HANDOFF.md'
    }
    forbidden_fragments = [
        '/node_modules/', 'backend/dist/', 'backend/local.settings.json',
        '/.git/', 'scratchpadall_functions.txt', 'backend/secrets/'
    ]
    forbidden_suffixes = ('.key', '.pem', '.pfx')
    for zip_name in sorted(approved_zips):
        zip_path = os.path.join(ROOT, zip_name)
        if not os.path.exists(zip_path):
            continue
        try:
            with zipfile.ZipFile(zip_path) as zf:
                entries = set(zf.namelist())
        except zipfile.BadZipFile:
            zip_failures.append(f"{zip_name}: invalid zip")
            continue
        missing_required = sorted(required_common - entries)
        if missing_required:
            zip_failures.append(f"{zip_name}: missing full-snapshot entries {missing_required}")
        if 'DEMO' in zip_name:
            if 'dist/phoenix-procurement-DEMO.html' not in entries:
                zip_failures.append(f"{zip_name}: missing demo dist")
            if 'dist/phoenix-procurement-PRODUCTION.html' in entries:
                zip_failures.append(f"{zip_name}: contains production dist")
        if 'PRODUCTION' in zip_name:
            if 'dist/phoenix-procurement-PRODUCTION.html' not in entries:
                zip_failures.append(f"{zip_name}: missing production dist")
            if 'dist/phoenix-procurement-DEMO.html' in entries:
                zip_failures.append(f"{zip_name}: contains demo dist")
        bad_entries = []
        for entry in entries:
            clean = entry.replace('\\', '/')
            lower = clean.lower()
            wrapped = '/' + lower
            name = os.path.basename(lower)
            if any(fragment in wrapped for fragment in forbidden_fragments):
                bad_entries.append(clean)
            elif '/__pycache__/' in wrapped or name.endswith('.pyc'):
                bad_entries.append(clean)
            elif name.endswith(forbidden_suffixes):
                bad_entries.append(clean)
            elif name in {'.env'} or name.startswith('.env.'):
                bad_entries.append(clean)
            elif name.endswith('.json') and ('service-account' in name or 'connection' in name):
                bad_entries.append(clean)
        if bad_entries:
            zip_failures.append(f"{zip_name}: forbidden entries {sorted(bad_entries)[:8]}")
    check("package zips exclude generated dependencies and secrets", not zip_failures,
          f"issues: {zip_failures}")

    print()
    if FAILURES:
        print(f"INVARIANT CHECK FAILED ({len(FAILURES)} issue(s)):")
        for f in FAILURES:
            print("  - " + f)
        sys.exit(1)
    print("All invariant checks passed.")

def _block(text, start_marker, close='};'):
    """Return the substring from start_marker up to the first `close` after it."""
    i = text.find(start_marker)
    if i == -1:
        return ''
    j = text.find(close, i + len(start_marker))
    return text[i:(j if j != -1 else len(text))]

if __name__ == '__main__':
    main()
