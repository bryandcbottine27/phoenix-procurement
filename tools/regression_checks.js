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

function matchingFunction(source, name) {
  const marker = `function ${name}`;
  const markerPos = source.indexOf(marker);
  if (markerPos === -1) throw new Error(`Function not found: ${name}`);
  const start = source.indexOf('{', markerPos);
  if (start === -1) throw new Error(`No function body for: ${name}`);

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
      if (depth === 0) return source.slice(markerPos, i + 1);
    }
  }
  throw new Error(`Unclosed function body for: ${name}`);
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

// --- Shipment sequence contracts ---
const shipmentSequenceSource = matchingFunction(core, 'shipmentSequence');
const nextShipmentSequenceSource = matchingFunction(core, 'nextShipmentSequence');
const sequenceSandbox = { state: { data: { shipments: [] } } };
vm.runInNewContext(
  `${shipmentSequenceSource}\n${nextShipmentSequenceSource}\nthis.shipmentSequence = shipmentSequence;\nthis.nextShipmentSequence = nextShipmentSequence;`,
  sequenceSandbox,
  { filename: 'core-shipment-sequence.js' }
);
check('nextShipmentSequence does not exclude archived shipments in source',
  !/&&\s*!sh\.archived/.test(nextShipmentSequenceSource));
check('nextShipmentSequence counts archived S1 and returns S2',
  sequenceSandbox.nextShipmentSequence('FPO-SEQ', [
    { id: 'archived-s1', orderId: 'FPO-SEQ', shipmentId: 'FPO-SEQ (S1)', archived: true }
  ]) === 2);
check('nextShipmentSequence returns one above the highest archived or active sequence',
  sequenceSandbox.nextShipmentSequence('FPO-SEQ', [
    { id: 'active-s1', orderId: 'FPO-SEQ', shipmentId: 'FPO-SEQ (S1)' },
    { id: 'active-s2', orderId: 'FPO-SEQ', shipmentId: 'FPO-SEQ (S2)' },
    { id: 'archived-s3', orderId: 'FPO-SEQ', shipmentId: 'FPO-SEQ (S3)', archived: true }
  ]) === 4);
check('nextShipmentSequence starts at S1 when an order has no shipments',
  sequenceSandbox.nextShipmentSequence('FPO-SEQ', []) === 1);
check('shipmentSequence still parses legacy letter suffixes',
  sequenceSandbox.shipmentSequence({ orderId: 'FPO-SEQ', shipmentId: 'FPO-SEQ C' }) === 3);

const paymentsRender = read('src/modules/payments/payments.render.js');
const shipmentsForm = read('src/modules/shipments/shipments.form.js');
const paymentsForm = read('src/modules/payments/payments.form.js');
const shipmentProcessedBlock = shipmentsForm.slice(
  shipmentsForm.indexOf("followupActionStatus: 'processed'"),
  shipmentsForm.indexOf("toast('Shipment created and linked", shipmentsForm.indexOf("followupActionStatus: 'processed'"))
);
check('shipment edit form captures loaded updatedAt for stale-write guard',
  /const\s+loadedUpdatedAt\s*=\s*isEdit\s*\?\s*\(s\.updatedAt\s*\|\|\s*null\)\s*:\s*null/.test(shipmentsForm));
check('shipment edit form passes expectedUpdatedAt on the primary update',
  /updateRecord\('shipments',\s*shipId,\s*data,\s*\{\s*expectedUpdatedAt:\s*loadedUpdatedAt\s*\}\)/.test(shipmentsForm));
check('shipment edit form handles STALE_WRITE inline',
  /err\s*&&\s*err\.code\s*===\s*'STALE_WRITE'/.test(shipmentsForm));
check('shipment follow-up linkage write is not stale-write guarded',
  shipmentProcessedBlock && !shipmentProcessedBlock.includes('expectedUpdatedAt'));
check('payment edit form captures loaded updatedAt for stale-write guard',
  /const\s+loadedUpdatedAt\s*=\s*isEdit\s*\?\s*\(p\.updatedAt\s*\|\|\s*null\)\s*:\s*null/.test(paymentsForm));
check('payment edit form passes expectedUpdatedAt on the form update',
  /updateRecord\('payment_requests',\s*payId,\s*data,\s*\{\s*expectedUpdatedAt:\s*loadedUpdatedAt\s*\}\)/.test(paymentsForm));
check('payment edit form handles STALE_WRITE inline',
  /err\s*&&\s*err\.code\s*===\s*'STALE_WRITE'/.test(paymentsForm));
check('payment render inline status toggles do not use expectedUpdatedAt',
  !paymentsRender.includes('expectedUpdatedAt'));
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

// --- ERP import rule classification checks ---
const importRulesSource = read('src/importRules.js');
const importRuleWindow = {
  __state: { data: { importRules: [] } },
  PXStore: {}
};
vm.runInNewContext(importRulesSource, { window: importRuleWindow, console }, { filename: 'importRules.js' });
const importRules = importRuleWindow.PXImportRules;
check('BC purchaser code ET01 classifies as indirect',
  importRules.resolveFunction({
    entity: 'Edena',
    erpSource: 'Business Central',
    values: { 'Purchaser Code': 'ET01', 'Created By': '' }
  }) === 'indirect');
check('BC Created By fallback classifies blank purchaser code',
  importRules.resolveFunction({
    entity: 'Seychelles Breweries',
    erpSource: 'Business Central',
    values: { 'Purchaser Code': '', 'Created By': 'SUPPLYCHAIN' }
  }) === 'supplychain');
check('Edena blank BC currency resolves to EUR',
  importRules.resolveLocalCurrency({
    entity: 'Edena',
    erpSource: 'Business Central',
    values: { 'Currency Code': '' }
  }) === 'EUR');
importRuleWindow.__state.data.importRules = [{
  ruleKey: 'bc-purchaser-et01',
  ruleType: 'function',
  entity: '*',
  erpSource: 'Business Central',
  sourceField: 'Purchaser Code',
  matchValue: 'ET01',
  resultValue: 'technical',
  priority: 10,
  active: true
}];
check('stored import rule overrides matching baseline rule',
  importRules.resolveFunction({
    entity: 'Edena',
    erpSource: 'Business Central',
    values: { 'Purchaser Code': 'ET01', 'Created By': '' }
  }) === 'technical');

// --- Data Quality checks ---
const dataQualitySource = read('src/dataQuality.js');
const procFollowupSource = read('src/procurementFollowup.js');
check('Data Quality GRN fallback trims receipt status before comparison',
  /String\(receipt\?\.status\s*\|\|\s*''\)\.trim\(\)\.toLowerCase\(\)/.test(dataQualitySource));
check('Procurement Follow-up GRN fallback trims receipt status before comparison',
  /String\(receipt\?\.status\s*\|\|\s*''\)\.trim\(\)\.toLowerCase\(\)/.test(procFollowupSource));
const dataQualityWindow = {
  __state: {
    data: {
      businessCalendars: [
        { entity: 'Phoenix', holidays: ['2026-07-06'] }
      ]
    }
  },
  PXDocuments: null,
  PXUtils: {
    currentEntity: () => 'Phoenix',
    orderNeedsShipment: order => order.orderType === 'foreign' && !order.noShipment
  }
};
vm.runInNewContext(dataQualitySource, { window: dataQualityWindow, console }, { filename: 'dataQuality.js' });
const dq = dataQualityWindow.PXUtils;
check('working-day helper excludes weekends and configured holidays',
  dq.workingDaysBetween('2026-07-03', '2026-07-07', 'Phoenix') === 1);

function isoOffset(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function hasIssue(list, key) {
  return Array.isArray(list) && list.some(item => item.key === key);
}
const dqContext = {
  shipments: [],
  payments: [],
  followups: [],
  issues: [],
  documents: [],
  entity: 'Phoenix',
  orderNeedsShipment: order => order.orderType === 'foreign' && !order.noShipment
};
let dqIssues = dq.orderDataQuality({
  id: 'order-ready-today',
  orderId: 'FPO-READY-TODAY',
  entity: 'Phoenix',
  orderType: 'foreign',
  orderReadyDate: isoOffset(0),
  requestedReceiptDate: isoOffset(45),
  supplier: 'Known Supplier',
  officerCode: 'ME',
  orderAcknowledgedDate: isoOffset(-1)
}, dqContext);
check('Data Quality does not fire ready/no-shipment on day zero',
  !hasIssue(dqIssues, 'order-ready-no-shipment'));

dqIssues = dq.orderDataQuality({
  id: 'order-ready-old',
  orderId: 'FPO-READY-OLD',
  entity: 'Phoenix',
  orderType: 'foreign',
  orderReadyDate: isoOffset(-7),
  requestedReceiptDate: isoOffset(45),
  supplier: 'Known Supplier',
  officerCode: 'ME',
  orderAcknowledgedDate: isoOffset(-8)
}, dqContext);
check('Data Quality fires ready/no-shipment after shared grace period',
  hasIssue(dqIssues, 'order-ready-no-shipment'));

const scorecardsSource = read('src/modules/reports/scorecards.js');
const scorecardBuildSource = matchingFunction(scorecardsSource, 'buildScorecard');
const scorecardMapPos = scorecardBuildSource.indexOf('return Object.values(map).map');
const scorecardDqCtxPos = scorecardBuildSource.indexOf('const dqCtx');
check('Supplier scorecards build Data Quality context once before supplier loop',
  scorecardDqCtxPos !== -1 && scorecardMapPos !== -1 && scorecardDqCtxPos < scorecardMapPos);
check('Supplier scorecards pass Data Quality context into order scoring',
  /dqFn\(o,\s*dqCtx\)/.test(scorecardBuildSource));

// --- Procurement Follow-up engine behavioral checks ---
const procBaseDate = new Date('2026-07-10T12:00:00');
const DAY_MS = 86400000;
function procDateStart(value) {
  if (!value) return null;
  const d = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}
function procIso(days) {
  const d = new Date(procBaseDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function createProcFollowupWindow(dataOverrides = {}) {
  const state = {
    data: {
      orders: [],
      shipments: [],
      payments: [],
      documents: [],
      followups: [],
      issues: [],
      suppliers: [],
      ...dataOverrides
    }
  };
  const px = {
    recordEntity: record => record && record.entity || 'Phoenix',
    orderNeedsShipment: order => order && order.orderType === 'foreign' && !order.noShipment,
    isErpOrder: order => !!(order && order.erpSource && order.erpSource !== 'Manual'),
    escapeHtml: value => String(value == null ? '' : value),
    dataQualityThresholds: {
      acknowledgementWorkingDays: 3,
      noFollowupWorkingDays: 5,
      readyNoShipmentWorkingDays: 2
    },
    workingDaysSince: value => {
      const d = procDateStart(value);
      const base = procDateStart(procBaseDate);
      return d ? Math.floor((base - d) / DAY_MS) : null;
    },
    workingDaysUntil: value => {
      const d = procDateStart(value);
      const base = procDateStart(procBaseDate);
      return d ? Math.floor((d - base) / DAY_MS) : null;
    }
  };
  const sandbox = { window: { __state: state, PXUtils: px }, console };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(procFollowupSource, sandbox, { filename: 'procurementFollowup.js' });
  return sandbox.window;
}
function procCtx(overrides = {}) {
  return {
    orders: [],
    shipments: [],
    payments: [],
    documents: [],
    followups: [],
    issues: [],
    suppliers: [],
    now: new Date(procBaseDate),
    ...overrides
  };
}
function issueKeys(list) {
  return (list || []).map(item => item.key);
}
const procWindow = createProcFollowupWindow();
const proc = procWindow.PXProcFollowup;
const procForeignOrder = {
  id: 'proc-foreign',
  orderId: 'FPO-PROC',
  entity: 'Phoenix',
  orderType: 'foreign',
  supplier: 'Known Supplier',
  orderSentToSupplierDate: procIso(-5),
  orderAcknowledgedDate: procIso(-4),
  orderReadyDate: procIso(-2),
  requestedReceiptDate: procIso(20)
};
check('PXProcFollowup ageingBucket classifies not-sent orders',
  proc.ageingBucket({ ...procForeignOrder, orderSentToSupplierDate: '' }, procCtx()).key === 'not_sent');
check('PXProcFollowup ageingBucket classifies sent/no-ack orders',
  proc.ageingBucket({ ...procForeignOrder, orderAcknowledgedDate: '', orderReadyDate: '' }, procCtx()).key === 'sent_no_ack');
check('PXProcFollowup ageingBucket classifies acknowledged/no-ready orders',
  proc.ageingBucket({ ...procForeignOrder, orderReadyDate: '' }, procCtx()).key === 'ack_no_ready');
check('PXProcFollowup ageingBucket classifies ready/no-shipment orders',
  proc.ageingBucket(procForeignOrder, procCtx()).key === 'ready_no_shipment');
check('PXProcFollowup ageingBucket classifies shipment-in-progress orders',
  proc.ageingBucket(procForeignOrder, procCtx({ shipments: [{ id: 'ship-proc', orderId: 'FPO-PROC', status: 'In transit' }] })).key === 'shipment_in_progress');
check('PXProcFollowup ageingBucket classifies under-clearance shipments',
  proc.ageingBucket(procForeignOrder, procCtx({ shipments: [{ id: 'ship-proc-clearance', orderId: 'FPO-PROC', status: 'Under Clearance' }] })).key === 'under_clearance');
check('PXProcFollowup ageingBucket classifies awaiting-receipt orders',
  proc.ageingBucket(procForeignOrder, procCtx({ shipments: [{ id: 'ship-proc-done', orderId: 'FPO-PROC', stage: 'completed' }] })).key === 'awaiting_receipt');
check('PXProcFollowup ageingBucket classifies overdue payment exposure',
  proc.ageingBucket({
    id: 'proc-local-pay',
    orderId: 'LPO-PROC-PAY',
    entity: 'Phoenix',
    orderType: 'local',
    orderSentToSupplierDate: procIso(-2),
    orderAcknowledgedDate: procIso(-1)
  }, procCtx({ payments: [{ id: 'pay-proc-overdue', orderId: 'LPO-PROC-PAY', status: 'approved', dueDate: procIso(-1) }] })).key === 'payment_overdue');
check('PXProcFollowup ageingBucket classifies pending payment/milestone exposure',
  proc.ageingBucket({
    id: 'proc-local-pending',
    orderId: 'LPO-PROC-PENDING',
    entity: 'Phoenix',
    orderType: 'local',
    orderSentToSupplierDate: procIso(-2),
    orderAcknowledgedDate: procIso(-1),
    milestones: [{ id: 'milestone-pending', label: 'Balance' }]
  }, procCtx()).key === 'payment_pending');
check('PXProcFollowup ageingBucket classifies closed orders',
  proc.ageingBucket({ ...procForeignOrder, isClosed: true }, procCtx()).key === 'closed');

const commitmentResult = proc.commitment({
  ...procForeignOrder,
  supplierPromisedDate: procIso(5),
  supplierRevisedPromisedDate: procIso(-2),
  supplierPromiseRevisionCount: 2,
  supplierDelayReason: 'Factory delay',
  supplierReplySummary: 'Revised date confirmed'
}, procCtx());
check('PXProcFollowup commitment prefers revised promise and marks overdue',
  commitmentResult.label === 'Revised promise' && commitmentResult.daysUntil === -2 && commitmentResult.overdue && commitmentResult.revisions === 2);

const chaseDueSoon = proc.nextChase({
  ...procForeignOrder,
  nextSupplierFollowupDate: procIso(2),
  lastSupplierFollowupDate: procIso(-3),
  followupMethod: 'Email',
  followupFrequencyDays: '7'
});
const chaseOverdue = proc.nextChase({ ...procForeignOrder, nextSupplierFollowupDate: procIso(-1) });
check('PXProcFollowup nextChase marks due-soon follow-ups',
  chaseDueSoon.dueSoon && !chaseDueSoon.overdue && chaseDueSoon.method === 'Email' && chaseDueSoon.frequencyDays === 7);
check('PXProcFollowup nextChase marks overdue follow-ups',
  chaseOverdue.overdue && !chaseOverdue.dueSoon && chaseOverdue.daysUntil === -1);

const exposure = proc.paymentExposure({
  id: 'proc-pay-order',
  orderId: 'LPO-PROC-EXPOSURE',
  milestones: [
    { id: 'milestone-open' },
    { id: 'milestone-rfp', rfpRef: 'RFP-1' },
    { id: 'milestone-paid', paidDate: procIso(-1) }
  ]
}, procCtx({
  payments: [
    { id: 'pay-overdue', orderId: 'LPO-PROC-EXPOSURE', status: 'approved', dueDate: procIso(-1) },
    { id: 'pay-future', orderId: 'LPO-PROC-EXPOSURE', status: 'draft', dueDate: procIso(5) },
    { id: 'pay-paid', orderId: 'LPO-PROC-EXPOSURE', status: 'paid', dueDate: procIso(-3) },
    { id: 'pay-other', orderId: 'OTHER', status: 'approved', dueDate: procIso(-1) }
  ]
}));
check('PXProcFollowup paymentExposure separates pending, overdue, and milestone exposure',
  exposure.pendingPayments.length === 2 && exposure.overduePayments.length === 1 && exposure.pendingMilestones.length === 1);

const lowRisk = proc.riskScore({ id: 'risk-low', orderId: 'RISK-LOW', entity: 'Phoenix', orderType: 'local', isClosed: true }, procCtx());
const mediumRisk = proc.riskScore({
  id: 'risk-medium',
  orderId: 'RISK-MEDIUM',
  entity: 'Phoenix',
  orderType: 'local',
  orderSentToSupplierDate: procIso(-2),
  orderAcknowledgedDate: procIso(-2),
  requestedReceiptDate: procIso(-1)
}, procCtx());
const highRisk = proc.riskScore({
  id: 'risk-high',
  orderId: 'RISK-HIGH',
  entity: 'Phoenix',
  orderType: 'local',
  orderSentToSupplierDate: procIso(-2),
  orderAcknowledgedDate: procIso(-2),
  requestedReceiptDate: procIso(-5),
  supplierPromisedDate: procIso(-2),
  nextSupplierFollowupDate: procIso(-1),
  amount: 500000
}, procCtx());
const criticalRisk = proc.riskScore({
  id: 'risk-critical',
  orderId: 'RISK-CRITICAL',
  entity: 'Phoenix',
  orderType: 'local',
  orderSentToSupplierDate: procIso(-20),
  requestedReceiptDate: procIso(-10),
  orderCriticality: 'critical',
  amount: 1000000,
  milestones: [{ id: 'milestone-critical' }],
  erpSource: 'Business Central',
  erpSyncStatus: 'error',
  erpPoStatus: 'Closed',
  erpVendorNo: 'V-1',
  supplierMatchMethod: 'unmatched',
  supplier: 'Phoenix Supplier',
  erpVendorName: 'Different Supplier',
  erpAmount: 10,
  currency: 'EUR',
  erpCurrency: 'USD'
}, procCtx({
  payments: [{ id: 'pay-critical', orderId: 'RISK-CRITICAL', status: 'approved', dueDate: procIso(-5) }],
  issues: [{ id: 'issue-critical', relatedType: 'order', relatedId: 'risk-critical', status: 'open', severity: 'critical', targetResolutionDate: procIso(-1), issueType: 'Quality' }]
}));
check('PXProcFollowup riskScore covers low band',
  lowRisk.level === 'low' && lowRisk.score === 0);
check('PXProcFollowup riskScore covers medium band',
  mediumRisk.level === 'medium' && mediumRisk.score >= 25 && mediumRisk.score < 50);
check('PXProcFollowup riskScore covers high band',
  highRisk.level === 'high' && highRisk.score >= 50 && highRisk.score < 75);
check('PXProcFollowup riskScore covers critical band and clamps at 100',
  criticalRisk.level === 'critical' && criticalRisk.score === 100);
check('PXProcFollowup riskScore is monotonic across crafted risk cases',
  lowRisk.score < mediumRisk.score && mediumRisk.score < highRisk.score && highRisk.score < criticalRisk.score);

const erpKeys = issueKeys(proc.erpExceptions({
  id: 'erp-exception',
  orderId: 'ERP-EXCEPTION',
  entity: 'Phoenix',
  erpSource: 'Business Central',
  erpSyncStatus: 'error',
  erpPoStatus: 'Closed',
  isClosed: false,
  erpVendorNo: 'V-1',
  supplierMatchMethod: 'unmatched',
  supplier: 'Phoenix Supplier',
  erpVendorName: 'Different Supplier',
  amount: 1000,
  erpAmount: 900,
  currency: 'EUR',
  erpCurrency: 'USD'
}, procCtx()));
check('PXProcFollowup erpExceptions detects ERP mismatch keys',
  ['sync-missing', 'sync-error', 'erp-closed-phoenix-open', 'supplier-unmapped', 'supplier-mismatch', 'amount-mismatch', 'currency-mismatch']
    .every(key => erpKeys.includes(key)));
check('PXProcFollowup erpExceptions detects stale ERP sync',
  issueKeys(proc.erpExceptions({ id: 'erp-stale', orderId: 'ERP-STALE', entity: 'Phoenix', erpSource: 'Business Central', erpLastSyncedAt: procIso(-5) }, procCtx())).includes('sync-stale'));
check('PXProcFollowup erpExceptions detects manual records with integration metadata',
  issueKeys(proc.erpExceptions({ id: 'manual-integration', orderId: 'MANUAL-INTEGRATION', erpSource: 'Manual', integrationLayer: 'warehouse-sync' }, procCtx())).includes('manual-with-integration'));

// --- My Work computed action checks ---
const myWorkSource = read('src/myWork.js');
function createMyWorkSandbox(dataOverrides = {}) {
  const state = {
    officer: { code: 'ME', fullName: 'Morgan Example', role: 'procurement_technical_officer' },
    filters: {},
    data: {
      orders: [],
      shipments: [],
      payments: [],
      exports: [],
      followups: [],
      issues: [],
      documents: [],
      suppliers: [],
      officers: [],
      ...dataOverrides
    }
  };
  const px = {
    $: () => null,
    $$: () => [],
    fmtDate: value => String(value || ''),
    fmtMoney: (amount, currency) => `${currency || ''} ${amount || ''}`.trim(),
    daysBetween: () => 0,
    escapeHtml: value => String(value == null ? '' : value),
    statusBadgeClass: () => 'neutral',
    generateMilestonesFromTerm: () => [],
    computeMilestoneDate: milestone => milestone.expectedDate || milestone.expectedDateOverride || null,
    milestoneStatus: () => 'planned',
    orderFunction: order => order.function || '',
    orderNeedsShipment: order => order.orderType === 'foreign' && !order.noShipment,
    currentEntity: () => 'Phoenix',
    recordEntity: record => record.entity || 'Phoenix',
    entityMeta: code => ({ code, short: code === 'Phoenix' ? 'PHX' : code, accent: '#002955' }),
    currentRole: () => 'procurement_technical_officer',
    canEditOrders: () => true,
    canEditShipments: () => false,
    canManageShipments: () => false,
    shipmentFollowupActionOpen: () => false,
    dataQualityThresholds: { acknowledgementWorkingDays: 3, readyNoShipmentWorkingDays: 2 },
    workingDaysSince: value => {
      if (!value) return null;
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return null;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      d.setHours(0, 0, 0, 0);
      return Math.floor((today - d) / 86400000);
    },
    can: (resource, action) => resource === 'payments' && ['create', 'edit'].includes(action)
  };
  const sandbox = {
    window: {
      __state: state,
      __renderers: {},
      PXUtils: px,
      REF: {
        actionThresholds: {
          dueSoonDays: 7,
          upcomingDays: 30,
          requestedNotAssignedDays: 2,
          arrivedNoGrnGraceDays: 2,
          readyNoShipmentDays: 2,
          noAckDays: 3
        },
        entities: [{ code: 'Phoenix', short: 'PHX', accent: '#002955' }],
        shipmentStages: {}
      }
    },
    console
  };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(myWorkSource, sandbox, { filename: 'myWork.js' });
  return sandbox.window;
}

let myWorkWindow = createMyWorkSandbox({
  orders: [{
    id: 'order-mywork-ready',
    orderId: 'FPO-MW-READY',
    entity: 'Phoenix',
    orderType: 'foreign',
    officerCode: 'ME',
    isClosed: false,
    orderSentToSupplierDate: isoOffset(-9),
    orderAcknowledgedDate: isoOffset(-8),
    orderReadyDate: isoOffset(-7),
    requestedReceiptDate: isoOffset(45)
  }]
});
let myWork = myWorkWindow.__myWorkCompute({ renderDom: false, entityOverride: 'Phoenix' });
check('My Work surfaces ready/no-shipment action after grace period', myWork && myWork.actionCount === 1);

myWorkWindow = createMyWorkSandbox({
  orders: [{
    id: 'order-mywork-ready',
    orderId: 'FPO-MW-READY',
    entity: 'Phoenix',
    orderType: 'foreign',
    officerCode: 'ME',
    isClosed: false,
    orderSentToSupplierDate: isoOffset(-9),
    orderAcknowledgedDate: isoOffset(-8),
    orderReadyDate: isoOffset(-7),
    requestedReceiptDate: isoOffset(45)
  }],
  shipments: [{ id: 'ship-mywork-ready', shipmentId: 'FPO-MW-READY (S1)', orderId: 'FPO-MW-READY', entity: 'Phoenix' }]
});
myWork = myWorkWindow.__myWorkCompute({ renderDom: false, entityOverride: 'Phoenix' });
check('My Work ready/no-shipment action disappears after shipment exists', myWork && myWork.actionCount === 0);

myWorkWindow = createMyWorkSandbox({
  followups: [{
    id: 'followup-open',
    status: 'open',
    assignedTo: 'ME',
    nextAction: 'Call supplier',
    nextActionDueDate: isoOffset(-1)
  }]
});
myWork = myWorkWindow.__myWorkCompute({ renderDom: false, entityOverride: 'Phoenix' });
check('My Work surfaces open assigned follow-up', myWork && myWork.actionCount === 1);

myWorkWindow = createMyWorkSandbox({
  followups: [{
    id: 'followup-done',
    status: 'done',
    assignedTo: 'ME',
    nextAction: 'Call supplier',
    nextActionDueDate: isoOffset(-1)
  }]
});
myWork = myWorkWindow.__myWorkCompute({ renderDom: false, entityOverride: 'Phoenix' });
check('My Work hides processed follow-up', myWork && myWork.actionCount === 0);

const indexSource = read('index.html');
const buildSource = read('build.py');
const coreSource = read('src/core.js');
const managementControlsSource = read('src/modules/reports/managementControls.js');
const dailyControlSource = read('src/modules/reports/dailyControlRoom.js');
const dailyViews = ['dailycontrol', 'supplierchase', 'exceptionworkbench'];

check('Daily control module loads after management controls',
  buildSource.indexOf("'src/modules/reports/managementControls.js'") >= 0
  && buildSource.indexOf("'src/modules/reports/dailyControlRoom.js'") > buildSource.indexOf("'src/modules/reports/managementControls.js'"));

check('Daily control source is loaded by index.html',
  indexSource.includes('src/modules/reports/dailyControlRoom.js'));

dailyViews.forEach(view => {
  check(`Operational cadence view ${view} has nav, section, renderer and breadcrumb`,
    indexSource.includes(`data-view="${view}"`)
    && indexSource.includes(`id="view-${view}"`)
    && dailyControlSource.includes(`__renderers['${view}']`)
    && coreSource.includes(`'${view}':`));
});

check('Daily control views re-render on live control data changes',
  /CONTROL_SUMMARY_VIEWS\s*=\s*\[[^\]]*'dailycontrol'[^\]]*'supplierchase'[^\]]*'exceptionworkbench'/s.test(coreSource));

check('Daily control sidebar counts are wired',
  coreSource.includes('__dailyControlCount')
  && coreSource.includes('__supplierChaseCount')
  && coreSource.includes('__exceptionWorkbenchCount'));

check('Exception workbench reuses supplier mapping and import history signals',
  dailyControlSource.includes('PXSupplierMap')
  && dailyControlSource.includes('state.data.importRuns')
  && dailyControlSource.includes('__openSupplierMappingWorklist'));

check('Management pack exposes executive summary export helpers',
  managementControlsSource.includes('function managementPackSummary')
  && managementControlsSource.includes('function managementPackExportRows')
  && managementControlsSource.includes('managementPackSummary, managementPackExportRows'));

console.log();
if (failures.length) {
  console.error(`REGRESSION CHECK FAILED (${failures.length} issue(s)):`);
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('All regression checks passed.');
