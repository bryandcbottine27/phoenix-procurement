/* dqCockpit.js — Increment 4: Data Quality Cockpit
   Aggregates per-record DQ issues (orderDataQuality / shipmentDataQuality /
   rfpDataQuality / supplierDataQuality from dataQuality.js) into entity-level scores. Findings
   remain computed from live Firestore state; officers may create a linked
   Issue work item to own, track, escalate, and resolve a finding. */
const { $, $$, fmtDate, escapeHtml, currentEntity, entityMeta, toast, can, serverTimestamp } = window.PXUtils;

/* ---------- engine ---------- */
(function () {
  function scoreSummary(issues) {
    const danger = issues.filter(i => i.level === 'danger').length;
    const warn = issues.filter(i => i.level === 'warn').length;
    const info = issues.filter(i => i.level === 'info').length;
    const score = Math.max(0, 100 - danger * 10 - warn * 3 - info);
    return { danger, warn, info, score, total: issues.length };
  }

  function buildReport(opts) {
    const ent = (opts && opts.entity) || (window.PXUtils ? window.PXUtils.currentEntity() : 'Phoenix');
    const st = window.__state;
    if (!st) return { orders: [], shipments: [], payments: [], suppliers: [], totals: {} };
    const recE = window.PXUtils.recordEntity;
    const orderEntity = oid => { const o = st.data.orders.find(x => x.orderId === oid); return o ? recE(o) : null; };
    const shipEntity = s => s.entity || orderEntity(s.orderId) || 'Phoenix';
    const payEntity = p => p.entity || orderEntity(p.orderId) || 'Phoenix';

    const dqOrder = window.PXUtils.orderDataQuality;
    const dqShip = window.PXUtils.shipmentDataQuality;
    const dqRFP = window.PXUtils.rfpDataQuality;
    const dqSupplier = window.PXUtils.supplierDataQuality;
    const context = {
      orders: st.data.orders || [], shipments: st.data.shipments || [], payments: st.data.payments || [],
      documents: st.data.documents || [], followups: st.data.followups || [], issues: st.data.issues || [],
      businessCalendars: st.data.businessCalendars || [], entity: ent,
      orderFunction: window.PXUtils.orderFunction, orderNeedsShipment: window.PXUtils.orderNeedsShipment,
      computeMilestoneDate: window.PXUtils.computeMilestoneDate
    };
    const row = (record, ref, label, issues) => ({ id: record.id, ref, label, record, issues, ...scoreSummary(issues) });

    const orders = st.data.orders
      .filter(o => !o.archived && recE(o) === ent)
      .map(o => row(o, o.orderId, `${o.orderId} — ${o.supplier || '?'}`, dqOrder ? dqOrder(o, context) : []))
      // Closed orders leave the routine view, but not while they still have a control failure.
      .filter(r => !r.record.isClosed || r.issues.length)
      .sort((a, b) => a.score - b.score);

    const shipments = st.data.shipments
      .filter(s => !s.archived && shipEntity(s) === ent)
      .map(s => row(s, s.shipmentId, `${s.shipmentId || '?'} — ${s.orderId || '?'}`, dqShip ? dqShip(s, context) : []))
      .filter(r => !(r.record.completed || r.record.stage === 'completed') || r.issues.length)
      .sort((a, b) => a.score - b.score);

    const payments = st.data.payments
      .filter(p => !p.archived && payEntity(p) === ent)
      .map(p => row(p, p.rfpRef || p.id, `${p.rfpRef || '?'} — ${p.supplier || '?'}`, dqRFP ? dqRFP(p, context) : []))
      .filter(r => !['paid', 'rejected'].includes(r.record.status) || r.issues.length)
      .sort((a, b) => a.score - b.score);

    const supplierRows = (st.data.suppliers || [])
      .filter(supplier => !supplier.archived && recE(supplier) === ent && (st.data.orders || []).some(order => !order.archived && recE(order) === ent && (order.supplierId === supplier.id || String(order.supplier || '').trim().toLowerCase() === String(supplier.name || '').trim().toLowerCase())))
      .map(supplier => row(supplier, supplier.name || supplier.id, supplier.legalName || supplier.name || '?', dqSupplier ? dqSupplier(supplier, context) : []))
      .sort((a, b) => a.score - b.score);
    const suppliers = supplierRows
      .filter(r => r.issues.length)
      .sort((a, b) => a.score - b.score);

    const sum = (arr, f) => arr.reduce((a, r) => a + (r[f] || 0), 0);
    const avg = arr => arr.length ? Math.round(arr.reduce((a, r) => a + r.score, 0) / arr.length) : 100;
    const allRows = [...orders, ...shipments, ...payments, ...supplierRows];
    const totals = {
      ordersScore: avg(orders), ordersDanger: sum(orders, 'danger'), ordersWarn: sum(orders, 'warn'),
      shipmentsScore: avg(shipments), shipmentsDanger: sum(shipments, 'danger'), shipmentsWarn: sum(shipments, 'warn'),
      paymentsScore: avg(payments), paymentsDanger: sum(payments, 'danger'), paymentsWarn: sum(payments, 'warn'),
      suppliersScore: avg(supplierRows), suppliersDanger: sum(suppliers, 'danger'), suppliersWarn: sum(suppliers, 'warn'),
      overallScore: avg(allRows),
      totalDanger: sum(allRows, 'danger'),
      totalWarn: sum(allRows, 'warn')
    };
    return { orders, shipments, payments, suppliers, totals };
  }

  window.PXDataQuality = { buildReport, scoreSummary };
  window.__dqCriticalCount = function () {
    try { return buildReport({ entity: window.PXUtils.currentEntity() }).totals.totalDanger || 0; }
    catch (e) { return 0; }
  };
})();

/* ---------- Data-quality work ownership ---------- */
const dqTaskKey = (type, recordId, issue) => `dq:${type}:${recordId}:${issue.key || String(issue.msg || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
const dqSeverity = level => level === 'danger' ? 'critical' : level === 'warn' ? 'medium' : 'low';
const dqDueInput = level => {
  const days = level === 'danger' ? 3 : level === 'warn' ? 7 : 14;
  const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};
function dqRecord(type, id) {
  const state = window.__state;
  const collection = type === 'order' ? state.data.orders : type === 'shipment' ? state.data.shipments : type === 'supplier' ? state.data.suppliers : state.data.payments;
  return (collection || []).find(record => record.id === id) || null;
}
function dqRelatedOrderId(type, record) {
  if (!record) return null;
  if (type === 'order') return record.orderId || null;
  return record.orderId || null;
}
function dqTaskFor(key) {
  return (window.__state.data.issues || []).find(issue => !issue.archived && issue.dataQualityKey === key) || null;
}
function dqDefaultOwner(type, record) {
  if (type === 'order' && record?.officerCode) return record.officerCode;
  if (type === 'shipment' && record?.logisticOfficer) return record.logisticOfficer;
  return window.__state.officer?.code || '';
}
function openDqAssignment(item) {
  if (!can('issues', 'create')) { toast('You can view data quality findings, but you are not authorised to assign actions.', 'warn'); return; }
  const state = window.__state;
  const officers = (state.data.officers || []).filter(officer => officer.active !== false);
  const defaultOwner = dqDefaultOwner(item.type, item.record);
  window.openModal(`
    <div class="modal-head"><div><h2>Assign Data Quality Action</h2><div class="sub">${escapeHtml(item.row.ref || '')} - ${escapeHtml(item.issue.msg)}</div></div><button class="btn btn-ghost btn-icon" onclick="closeModal()" title="Close">x</button></div>
    <div class="modal-body">
      <div class="card" style="margin-bottom:14px;background:var(--surface-warm)"><div class="text-sm"><strong>Finding:</strong> ${escapeHtml(item.issue.msg)}<br><strong>Severity:</strong> ${escapeHtml(item.issue.level)}</div></div>
      <div class="form-grid">
        <div class="field-group"><label>Owner <span class="req">*</span></label><select id="dq-owner"><option value="">Assign an officer...</option>${officers.map(officer => `<option value="${escapeHtml(officer.code || '')}" ${officer.code === defaultOwner ? 'selected' : ''}>${escapeHtml(officer.fullName || officer.code)} (${escapeHtml(officer.code || '')})</option>`).join('')}</select></div>
        <div class="field-group"><label>Target Resolution Date <span class="req">*</span></label><input type="date" id="dq-target-date" value="${dqDueInput(item.issue.level)}" /></div>
        <div class="field-group full"><label>Action Notes</label><textarea id="dq-action-notes" placeholder="What needs to be checked or corrected?">${escapeHtml(`Data quality finding: ${item.issue.msg}`)}</textarea></div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="dq-create-task">Assign Action</button></div>
  `);
  $('#dq-create-task').addEventListener('click', async () => {
    const owner = $('#dq-owner').value.trim();
    const targetDate = $('#dq-target-date').value;
    if (!owner || !targetDate) { toast('Assign an owner and target date.', 'danger'); return; }
    const button = $('#dq-create-task'); button.disabled = true; button.textContent = 'Assigning...';
    const payload = {
      relatedType: item.type, relatedId: item.record.id, _key: `${item.type}:${item.record.id}`,
      orderId: dqRelatedOrderId(item.type, item.record),
      issueType: 'other', issueCategory: 'ERP / data', severity: dqSeverity(item.issue.level),
      impactType: 'compliance', responsibleParty: 'internal', status: 'open', owner,
      targetResolutionDate: new Date(targetDate), escalationLevel: 0, escalatedTo: null,
      resolutionCode: null, resolvedDate: null, actionNotes: $('#dq-action-notes').value.trim(),
      dataQualityKey: item.key, dataQualityMessage: item.issue.msg, dataQualityLevel: item.issue.level,
      openedBy: state.officer?.code || '', openedDate: serverTimestamp(), archived: false
    };
    try {
      await window.PXStore.createRecord('issues', payload, {
        log: { recordType: 'issue', action: 'created', details: `Data quality action assigned: ${item.issue.msg}` }
      });
      toast('Data quality action assigned.', 'success');
      window.closeModal();
    } catch (error) {
      toast('Could not assign action: ' + (error.message || error), 'danger');
      button.disabled = false; button.textContent = 'Assign Action';
    }
  });
}
async function reopenDqTask(item, task) {
  if (!can('issues', 'edit')) { toast('You can view data quality findings, but you are not authorised to reopen actions.', 'warn'); return; }
  try {
    await window.PXStore.updateRecord('issues', task.id, {
      status: 'open', resolvedDate: null, resolvedAt: null, resolvedBy: null,
      dataQualityMessage: item.issue.msg, dataQualityLevel: item.issue.level
    }, { log: { recordType: 'issue', action: 'reopened', details: `Data quality finding still present: ${item.issue.msg}` } });
    toast('Data quality action reopened.', 'success');
  } catch (error) { toast('Could not reopen action: ' + (error.message || error), 'danger'); }
}

/* ---------- view ---------- */
window.__renderers['dqcockpit'] = function () {
  const viewEl = $('#view-dqcockpit');
  if (!viewEl) return;
  const ent = currentEntity();
  const meta = entityMeta(ent);
  if (!window.PXDataQuality) { viewEl.innerHTML = '<p class="op-empty">DQ engine not available.</p>'; return; }

  const { orders, shipments, payments, suppliers, totals } = window.PXDataQuality.buildReport({ entity: ent });
  const mayAssign = can('issues', 'create');
  const mayEditIssues = can('issues', 'edit');
  const scoreColor = s => s >= 90 ? 'var(--success,#27ae60)' : s >= 70 ? 'var(--warn,#e67e22)' : 'var(--danger,#c0392b)';
  const scoreBar = (score, label, sub) => `
    <div class="kpi-pill" style="border-color:${scoreColor(score)}">
      <div class="kpi-pill-label">${label}</div>
      <div class="kpi-pill-value" style="color:${scoreColor(score)}">${score}</div>
      <div class="kpi-pill-sub">${sub}</div>
    </div>`;
  const actionItems = new Map();
  const allDqItems = [];
  [['order', orders], ['shipment', shipments], ['payment', payments], ['supplier', suppliers]].forEach(([type, rows]) => rows.forEach(row => row.issues.forEach(issue => {
    const record = dqRecord(type, row.id);
    const item = { type, row, record, issue, key: dqTaskKey(type, row.id, issue) };
    actionItems.set(item.key, item); allDqItems.push(item);
  })));
  const openTasks = allDqItems.filter(item => dqTaskFor(item.key)?.status === 'open').length;
  const unassignedTasks = allDqItems.filter(item => !dqTaskFor(item.key) || dqTaskFor(item.key)?.status === 'resolved').length;

  const issueRow = (row, type) => {
    if (!row.issues.length) return '';
    const badges = [
      row.danger ? `<span class="badge danger">${row.danger} critical</span>` : '',
      row.warn ? `<span class="badge warn">${row.warn} warn</span>` : '',
      row.info ? `<span class="badge neutral">${row.info} info</span>` : ''
    ].filter(Boolean).join(' ');
    const msgs = row.issues.map(issue => {
      const key = dqTaskKey(type, row.id, issue);
      const task = dqTaskFor(key);
      let action = '<span class="text-xs text-muted">Not assigned</span>';
      if (task?.status === 'open') action = `<span class="text-xs">Owner: <strong>${escapeHtml(task.owner || '-')}</strong>${task.targetResolutionDate ? ` · due ${fmtDate(task.targetResolutionDate)}` : ''}</span>${mayEditIssues ? `<button class="btn btn-sm" data-dq-manage="${escapeHtml(key)}">Manage</button>` : ''}`;
      else if (task?.status === 'resolved') action = `<span class="text-xs text-muted">Resolved</span>${mayEditIssues ? `<button class="btn btn-sm" data-dq-reopen="${escapeHtml(key)}">Reopen</button>` : ''}`;
      else if (mayAssign) action = `<button class="btn btn-sm btn-primary" data-dq-assign="${escapeHtml(key)}">Assign</button>`;
      return `<div class="dq-item ${issue.level}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:3px 0;padding:4px 6px"><span style="display:inline-flex;align-items:center;gap:4px"><span class="dq-dot"></span>${escapeHtml(issue.msg)}</span><span style="display:inline-flex;align-items:center;gap:5px;flex-shrink:0">${action}</span></div>`;
    }).join('');
    return `<tr>
      <td><span class="mono text-sm">${escapeHtml(row.ref || '?')}</span></td>
      <td class="truncate">${escapeHtml(row.label)}</td>
      <td>${badges}</td>
      <td><div style="display:flex;flex-direction:column;gap:2px">${msgs}</div></td>
      <td class="num" style="color:${scoreColor(row.score)};font-weight:700">${row.score}</td>
      <td><button class="btn btn-sm" data-dq-open="${escapeHtml(`${type}:${row.id}`)}">Open</button></td>
    </tr>`;
  };
  const table = (rows, type, emptyMsg) => {
    const issueRows = rows.filter(row => row.issues.length).map(row => issueRow(row, type)).join('');
    if (!issueRows) return `<p class="op-hint" style="color:var(--success,#27ae60);padding:12px 0">✓ ${emptyMsg}</p>`;
    return `<div class="table-wrap"><table class="data">
      <thead><tr><th>Ref</th><th>Record</th><th>Issues</th><th>Ownership</th><th class="num">Score</th><th></th></tr></thead>
      <tbody>${issueRows}</tbody>
    </table></div>`;
  };

  // ===== Summary-first: aggregate issues by message across all collections =====
  // At full-ERP scale a flat per-record list is unreadable; lead with issue TYPES ranked by
  // count, each expandable to its records on demand. Per-collection record tables remain as
  // collapsible drill-downs (collapsed by default).
  const COLL_LABEL = { order: 'Orders', shipment: 'Shipments', payment: 'Payments', supplier: 'Suppliers' };
  const sevRank = { danger: 0, warn: 1, info: 2 };
  const summaryMap = new Map();   // msg -> { msg, level, count, collections:Set }
  allDqItems.forEach(item => {
    const key = (item.issue.key || item.issue.msg);
    const cur = summaryMap.get(key) || { msg: item.issue.msg, level: item.issue.level, count: 0, collections: new Set() };
    cur.count++; cur.collections.add(COLL_LABEL[item.type] || item.type);
    // keep the most severe level seen for this message
    if (sevRank[item.issue.level] < sevRank[cur.level]) cur.level = item.issue.level;
    summaryMap.set(key, cur);
  });
  const summaryRows = [...summaryMap.values()]
    .sort((a, b) => (sevRank[a.level] - sevRank[b.level]) || (b.count - a.count));
  const sevBadge = lvl => lvl === 'danger' ? '<span class="badge danger">Critical</span>'
    : lvl === 'warn' ? '<span class="badge warn">Warning</span>' : '<span class="badge neutral">Info</span>';
  const summaryTable = summaryRows.length ? `<div class="table-wrap"><table class="data">
      <thead><tr><th>Data quality finding</th><th>Severity</th><th class="num">Records affected</th><th>Where</th></tr></thead>
      <tbody>${summaryRows.map(r => `<tr>
        <td>${escapeHtml(r.msg)}</td>
        <td>${sevBadge(r.level)}</td>
        <td class="num" style="font-weight:700">${r.count}</td>
        <td class="text-xs text-muted">${[...r.collections].join(', ')}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '';

  // Collapsible drill-down section (collapsed by default).
  const drill = (id, title, count, inner) => `
    <details class="dq-drill" style="margin:10px 0;border:1px solid var(--line);border-radius:6px">
      <summary style="cursor:pointer;padding:10px 12px;font-weight:600;display:flex;justify-content:space-between;align-items:center">
        <span>${title}</span><span class="badge ${count?'warn':'neutral'}">${count} record${count===1?'':'s'}</span>
      </summary>
      <div style="padding:0 12px 12px">${inner}</div>
    </details>`;
  const withIssues = arr => arr.filter(r => r.issues.length).length;

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title">
        <h1>Data Quality Cockpit</h1>
        <span class="desc">${escapeHtml(meta.code)} — completeness, integrity, and accountable remediation. Open/active records only.</span>
      </div>
    </div>

    <div class="kpi-pill-row">
      ${scoreBar(totals.overallScore, 'Overall score', `${totals.totalDanger} critical · ${totals.totalWarn} warnings`)}
      ${scoreBar(totals.ordersScore, 'Orders', `${withIssues(orders)} flagged · ${totals.ordersDanger} crit`)}
      ${scoreBar(totals.shipmentsScore, 'Shipments', `${withIssues(shipments)} flagged · ${totals.shipmentsDanger} crit`)}
      ${scoreBar(totals.paymentsScore, 'Payments', `${withIssues(payments)} flagged · ${totals.paymentsDanger} crit`)}
      ${scoreBar(totals.suppliersScore, 'Supplier patterns', `${suppliers.length} to review · ${totals.suppliersDanger} crit`)}
      ${scoreBar(100 - Math.min(100, unassignedTasks * 10), 'Owned actions', `${openTasks} open · ${unassignedTasks} to assign`)}
    </div>

    <div class="info-banner">
      Showing <strong>open / active records only</strong> (closed POs and completed shipments are excluded unless they still carry a control failure). Findings are summarised by type below; expand a collection to see and assign the individual records. Assigning a finding creates one linked Issue — it never changes the source record automatically.
    </div>

    ${totals.totalDanger + totals.totalWarn === 0
      ? '<div class="info-banner" style="border-color:var(--success,#27ae60);color:var(--success,#27ae60)">✓ All open records are clean for this entity. No issues detected.</div>'
      : `
        <h3 style="margin:20px 0 8px">Findings summary <span class="hint" style="text-transform:none;font-weight:400;color:var(--muted-soft);font-size:11px">(${summaryRows.length} type${summaryRows.length===1?'':'s'}, most severe first)</span></h3>
        ${summaryTable}

        <h3 style="margin:24px 0 8px">Records by collection <span class="hint" style="text-transform:none;font-weight:400;color:var(--muted-soft);font-size:11px">(expand to view &amp; assign)</span></h3>
        ${drill('dq-orders', 'Orders', withIssues(orders), table(orders, 'order', 'All open orders are clean.'))}
        ${drill('dq-shipments', 'Shipments', withIssues(shipments), table(shipments, 'shipment', 'All active shipments are clean.'))}
        ${drill('dq-payments', 'Payment Requests', withIssues(payments), table(payments, 'payment', 'All open payment requests are clean.'))}
        ${drill('dq-suppliers', 'Supplier Patterns', suppliers.length, table(suppliers, 'supplier', 'No recurring supplier exception pattern is detected.'))}
      `}
  `;
  $$('[data-dq-assign]', viewEl).forEach(button => button.addEventListener('click', () => openDqAssignment(actionItems.get(button.dataset.dqAssign))));
  $$('[data-dq-reopen]', viewEl).forEach(button => button.addEventListener('click', () => {
    const item = actionItems.get(button.dataset.dqReopen); const task = item && dqTaskFor(item.key); if (item && task) reopenDqTask(item, task);
  }));
  $$('[data-dq-manage]', viewEl).forEach(button => button.addEventListener('click', () => {
    const item = actionItems.get(button.dataset.dqManage); const task = item && dqTaskFor(item.key); if (item && task && window.openIssueForm) window.openIssueForm(item.type, item.record.id, task.id);
  }));
  $$('[data-dq-open]', viewEl).forEach(button => button.addEventListener('click', () => {
    const [type, id] = button.dataset.dqOpen.split(':');
    if (type === 'order' && window.openOrderDetail) window.openOrderDetail(id);
    else if (type === 'shipment' && window.openShipmentDetail) window.openShipmentDetail(id);
    else if (type === 'payment' && window.openPaymentDetail) window.openPaymentDetail(id);
    else if (type === 'supplier' && window.openSupplierDetail) window.openSupplierDetail(id);
  }));
};
