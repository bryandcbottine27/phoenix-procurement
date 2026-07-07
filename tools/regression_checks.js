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

console.log();
if (failures.length) {
  console.error(`REGRESSION CHECK FAILED (${failures.length} issue(s)):`);
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('All regression checks passed.');
