#!/usr/bin/env node
/*
  Phoenix Procurement - local regression checks.

  This is intentionally dependency-free: it runs with Node's standard library and
  exercises the source-level contracts that are easy to break before a real
  Firebase/staging environment exists.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const failures = [];
function check(name, ok, detail = '') {
  const status = ok ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${name}${!ok && detail ? ' - ' + detail : ''}`);
  if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
}

function matchingLiteral(source, marker) {
  const markerPos = source.indexOf(marker);
  if (markerPos === -1) throw new Error(`Marker not found: ${marker}`);
  const start = source.indexOf('{', markerPos);
  if (start === -1) throw new Error(`No object literal after: ${marker}`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed object literal after: ${marker}`);
}

function evaluateLiteral(literal, label) {
  try {
    return vm.runInNewContext(`(${literal})`, {}, { filename: label });
  } catch (err) {
    throw new Error(`Could not evaluate ${label}: ${err.message}`);
  }
}

const core = read('src/core.js');
const permissions = evaluateLiteral(matchingLiteral(core, 'permissions:'), 'REF.permissions');
const viewAccess = evaluateLiteral(matchingLiteral(core, 'viewAccess:'), 'REF.viewAccess');

function roleCan(role, resource, action, demoMode = false) {
  if (role === 'admin') return true;
  const perms = permissions[role];
  const fallback = !!demoMode;
  if (!perms) return fallback;
  const allowed = perms[resource];
  if (allowed === undefined) return fallback;
  return Array.isArray(allowed) && allowed.includes(action);
}

function viewLevel(role, view, demoMode = false) {
  if (role === 'admin') return 'full';
  const va = viewAccess[role];
  if (!va) return demoMode ? 'full' : 'none';
  if (Array.isArray(va.hidden) && va.hidden.includes(view)) return 'none';
  if (Array.isArray(va.viewOnly) && va.viewOnly.includes(view)) return 'view';
  return 'full';
}

function expectCan(role, resource, action) {
  check(`${role} can ${resource}:${action}`, roleCan(role, resource, action));
}

function expectCannot(role, resource, action) {
  check(`${role} cannot ${resource}:${action}`, !roleCan(role, resource, action));
}

console.log('Phoenix regression checks:');

// --- Permission matrix contracts ---
expectCannot('procurement_senior_manager', 'orders', 'create');
expectCannot('procurement_senior_manager', 'orders', 'edit');
expectCannot('procurement_senior_manager', 'orders', 'archive');
expectCan('procurement_senior_manager', 'payments', 'approve');
expectCannot('procurement_senior_manager', 'payments', 'create');

expectCan('sc_manager', 'orders', 'archive');
expectCan('sc_manager', 'shipments', 'archive');
expectCan('sc_manager', 'payments', 'approve');
expectCannot('sc_manager', 'payments', 'create');

expectCan('sc_officer', 'orders', 'create');
expectCan('sc_officer', 'payments', 'create');
expectCannot('sc_officer', 'shipments', 'create');
expectCannot('sc_officer', 'orders', 'archive');

expectCan('logistics_officer', 'shipments', 'create');
expectCan('logistics_officer', 'exports', 'archive');
expectCannot('logistics_officer', 'orders', 'edit');
expectCannot('logistics_officer', 'payments', 'approve');

expectCan('finance', 'payments', 'view');
expectCan('finance', 'payments', 'approve');
expectCannot('finance', 'payments', 'create');
expectCannot('finance', 'payments', 'edit');

expectCan('stakeholder', 'updateRequests', 'create');
expectCannot('stakeholder', 'payments', 'create');
expectCannot('stakeholder', 'payments', 'approve');
expectCannot('stakeholder', 'followups', 'create');

check('unknown role fails closed in production permissions', !roleCan('made_up_role', 'orders', 'view', false));
check('unknown role is permissive only in demo permissions', roleCan('made_up_role', 'orders', 'view', true));
check('stakeholder cannot navigate to payments', viewLevel('stakeholder', 'payments') === 'none');
check('finance sees payments as view-only', viewLevel('finance', 'payments') === 'view');
check('unknown production role has no navigation', viewLevel('made_up_role', 'dashboard') === 'none');

// --- Production auth/fail-closed source contracts ---
check('production no-role fallback is no_access',
  /return\s+isDemoMode\(\)\s*\?\s*'admin'\s*:\s*'no_access'/.test(core));
check('no_access is intentionally absent from permission matrix', !Object.prototype.hasOwnProperty.call(permissions, 'no_access'));

const paymentsRender = read('src/modules/payments/payments.render.js');
check('payment approval updates use the requested permission action',
  /updateRecord\('payment_requests',\s*id,\s*patch,\s*\{\s*skipValidation:\s*true,\s*permissionAction:\s*neededSave\s*\}\)/.test(paymentsRender));

// --- Firestore rule drift checks ---
const authRules = read('docs/FIRESTORE_RULES/firestore.rules.authenticated');
const internalRules = read('docs/FIRESTORE_RULES/firestore.rules.internal-locked');
check('authenticated rules use no_access for missing officer roles', authRules.includes("myRole()") && authRules.includes("'no_access'"));
check('authenticated rules no longer grant order writes to broad procurement group',
  !authRules.includes('allow create, update: if isProcurement();'));
check('authenticated rules model payment approve-only updates', authRules.includes('onlyPaymentApprovalChanged'));
check('authenticated rules block broad signed-in document writes',
  !/match\s+\/documents\/\{id\}[\s\S]*allow\s+create,\s+update:\s+if\s+signedIn\(\)/.test(authRules));
check('interim rules include exports collection', /match\s+\/exports\/\{id\}/.test(internalRules));

// --- Runtime validator checks in a VM sandbox ---
const validatorsSource = read('src/validators.js');
const validatorWindow = {
  __state: {
    data: {
      shipments: [
        { id: 'ship-a', shipmentId: 'FPO1 (S1)', orderId: 'FPO1' },
        { id: 'ship-other', shipmentId: 'FPO2 (S1)', orderId: 'FPO2' }
      ],
      orders: [
        { id: 'order-a', orderId: 'FPO1', amount: 100, receipts: [] },
        { id: 'order-b', orderId: 'FPO2', receipts: [{ shipmentId: 'ship-other', grnDate: '2026-07-01', status: 'fully received' }] }
      ],
      payments: [{ id: 'pay-existing', orderId: 'FPO1', amount: 80, status: 'approved' }],
      suppliers: [{ id: 'sup-a', name: 'Known Supplier', aliases: [] }]
    }
  },
  REF: {
    shipmentFollowupStatuses: ['In transit', 'GRN completed'],
    shipmentReceiptResults: ['fully received', 'partially received'],
    documentFolders: [{ key: 'purchase_order' }]
  },
  PXWorkflows: null
};
vm.runInNewContext(validatorsSource, { window: validatorWindow, console }, { filename: 'validators.js' });
const validators = validatorWindow.PXValidators;

let result = validators.validateShipment({ orderId: 'FPO1', shipmentId: 'FPO1 (S2)', status: '', receiptResult: 'fully received' }, null);
check('shipment validator requires status', result.errors.some(e => e.includes('Shipment status is required')));
check('shipment validator requires GRN evidence for received result', result.errors.some(e => e.includes('no GRN date or linked GRN')));

result = validators.validateShipment({ orderId: 'FPO3', shipmentId: 'FPO1 (S1)', status: 'In transit' }, null);
check('shipment validator blocks duplicate shipment IDs', result.errors.some(e => e.includes('already in use on order')));

result = validators.validateOrder({
  orderId: 'FPO1',
  entity: 'Phoenix',
  amount: 100,
  supplier: 'Known Supplier',
  requestedReceiptDate: '2026-07-10',
  dateOfOrder: '2026-07-01',
  receipts: [{ shipmentId: 'ship-other', grnDate: '2026-07-02', status: 'fully received' }]
}, null);
check('order validator blocks GRN linked to another order shipment', result.errors.some(e => e.includes('belongs to order FPO2')));

result = validators.validatePayment({ orderId: 'FPO1', amount: 30, invoiceNumber: 'INV-2', dueDate: '2026-07-20' }, null);
check('payment validator blocks totals above order value', result.errors.some(e => e.includes('exceed the order value')));

result = validators.validateDocument({ documentType: 'PO', documentUrl: 'javascript:alert(1)', folder: 'purchase_order' }, null);
check('document validator blocks unsafe links', result.errors.some(e => e.includes('not a valid or safe URL')));

// --- PXPermissions facade sanity ---
const permissionsSource = read('src/permissions.js');
const permSandbox = {
  window: {
    PXUtils: {
      currentRole: () => 'stakeholder',
      can: (resource, action) => roleCan('stakeholder', resource, action, false)
    }
  },
  console
};
vm.runInNewContext(permissionsSource, permSandbox, { filename: 'permissions.js' });
check('PXPermissions denies stakeholder payment creation',
  permSandbox.window.PXPermissions.can('create', { kind: 'payment' }) === false);
check('PXPermissions allows stakeholder update request creation',
  permSandbox.window.PXPermissions.can('updateRequests:create') === true);

console.log();
if (failures.length) {
  console.error(`REGRESSION CHECK FAILED (${failures.length} issue(s)):`);
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('All regression checks passed.');
