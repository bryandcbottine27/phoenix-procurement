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

Run:  python3 tools/check_invariants.py
"""
import os, re, sys, glob

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
