const { $, $$, fmtDate, fmtDateISO, fmtMoney, escapeHtml, statusBadgeClass, daysBetween,
  collection, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, toast,
  generateMilestonesFromTerm, computeMilestoneDate, milestoneStatus,
  orderFunction, functionForCategory, orderNeedsShipment, canEditOrders, canEditShipments,
  shipmentBelongsToOrder,
  checkOrderDuplicates, orderDataQuality, orderHealth, buildOrderTimeline,
  isErpOrder, fieldEditable, erpFieldClass, erpSourceOf, erpBadgeFor, renderErpBadge,
  orderHasLines, orderLineSum, stripUndefined,
  currentEntity, recordEntity, entityMeta } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;


// ===== Per-order KPI calculators =====
function _toDate(v) {
  if (!v) return null;
  if (v.toDate) { try { return v.toDate(); } catch (_) { return null; } }
  if (v.seconds != null) return new Date(v.seconds * 1000);
  if (v instanceof Date) return isNaN(v) ? null : v;
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

function _latestDate(values) {
  const dates = values.map(_toDate).filter(Boolean);
  return dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;
}

function _grnStatus(receipt) {
  return String(receipt?.status || '').trim().toLowerCase();
}

function _grnCountsAsReceipt(receipt) {
  const status = _grnStatus(receipt);
  if (status === 'pending' || status === 'cancelled') return false;
  return !!(receipt && (receipt.grnDate || receipt.actualReceiptDate || receipt.grnRef || receipt.grnNumber));
}

function _shipmentMatchesReceipt(shipment, receipt) {
  if (!shipment || !receipt || !receipt.shipmentId) return false;
  const id = String(receipt.shipmentId);
  return id === String(shipment.id || '') || id === String(shipment.shipmentId || '');
}

function orderGrns(order, opts = {}) {
  const receipts = Array.isArray(order?.receipts) ? order.receipts : [];
  return receipts.filter(receipt => {
    if (opts.activeOnly && !_grnCountsAsReceipt(receipt)) return false;
    if (Object.prototype.hasOwnProperty.call(opts, 'shipmentId')) {
      if (opts.shipmentId === null) return !receipt.shipmentId;
      const target = String(opts.shipmentId || '');
      return String(receipt.shipmentId || '') === target;
    }
    return true;
  });
}

function shipmentGrns(order, shipment) {
  const receipts = Array.isArray(order?.receipts) ? order.receipts : [];
  return receipts.filter(receipt => !shipment || _shipmentMatchesReceipt(shipment, receipt));
}

function shipmentReceiptDate(order, shipment) {
  if (!shipment) return null;
  const linkedGrns = shipmentGrns(order, shipment).filter(_grnCountsAsReceipt);
  return _toDate(shipment.deliveryDate)
    || _latestDate(linkedGrns.map(r => r.actualReceiptDate || r.grnDate))
    || _toDate(shipment.grnDate)
    || null;
}

function orderReceiptDates(order, shipments) {
  const dates = [];
  orderGrns(order, { activeOnly: true }).forEach(receipt => {
    if (!receipt.shipmentId) dates.push(receipt.actualReceiptDate || receipt.grnDate);
  });
  (shipments || []).forEach(shipment => {
    const d = shipmentReceiptDate(order, shipment);
    if (d) dates.push(d);
  });
  return dates.map(_toDate).filter(Boolean);
}

function calcOrderMTTO(o) {
  // Days from IPR HOD Approved → Date of Order
  if (!o.iprApprovedDate || !o.dateOfOrder) return null;
  const d = daysBetween(o.iprApprovedDate, o.dateOfOrder);
  return (d !== null && d >= 0) ? d : null;
}

function calcOrderOTIF(o, ships) {
  // Returns { status: 'on_time' | 'late' | 'pending' | 'na', label, lateBy }
  // 'na'      - missing Requested Receipt Date (cannot evaluate)
  // 'pending' - have ReqReceipt but no GRN/delivery receipt event yet
  // 'on_time' - latest receipt event <= ReqReceipt
  // 'late'    - latest receipt event > ReqReceipt
  if (!o.requestedReceiptDate) return { status: 'na', label: '—' };
  const linkedShips = ships.filter(s => shipmentBelongsToOrder(s, o));
  const hasOrderLevelGrn = orderGrns(o, { activeOnly: true }).some(r => !r.shipmentId);
  if (linkedShips.length && !linkedShips.every(s => shipmentReceiptDate(o, s)) && !hasOrderLevelGrn) {
    return { status: 'pending', label: 'pending' };
  }
  const receiptDates = orderReceiptDates(o, linkedShips);
  if (!receiptDates.length) return { status: 'pending', label: 'pending' };
  const latestReceipt = new Date(Math.max(...receiptDates.map(d => d.getTime())));
  const reqReceipt = _toDate(o.requestedReceiptDate);
  const diff = Math.round((latestReceipt - reqReceipt) / 86400000);
  if (diff <= 0) return { status: 'on_time', label: '✓ on time', lateBy: diff };
  return { status: 'late', label: '✗ +' + diff + 'd', lateBy: diff };
}

function linkedShipmentsForOrder(o) {
  if (!o || !o.orderId) return [];
  return (state.data.shipments || []).filter(s =>
    !s.archived && shipmentBelongsToOrder(s, o));
}

function shipmentSortValue(s) {
  const fields = [s.deliveryDate, s.grnDate, s.eta, s.etd, s.readyDate, s.createdAt, s.updatedAt];
  for (const v of fields) {
    if (!v) continue;
    const d = _toDate(v);
    if (d instanceof Date && !isNaN(d.getTime())) return d.getTime();
  }
  return 0;
}

function primaryShipmentForOrder(o) {
  const ships = linkedShipmentsForOrder(o);
  if (!ships.length) return null;
  const active = ships.filter(s => !(s.completed || s.stage === 'completed'));
  return [...(active.length ? active : ships)].sort((a, b) => shipmentSortValue(b) - shipmentSortValue(a))[0];
}

function renderShipmentStatus(o) {
  const ships = linkedShipmentsForOrder(o);
  if (!orderNeedsShipment(o) && !ships.length) {
    return `<span class="badge neutral shipment-status-static" title="No shipment required for this order">n/a</span>`;
  }
  if (!ships.length) {
    return `<span class="badge accent shipment-status-static" title="No linked shipment request yet">not requested</span>`;
  }
  const s = primaryShipmentForOrder(o);
  const stg = s.stage || (s.completed ? 'completed' : 'in_progress');
  const meta = REF.shipmentStages[stg] || { short: stg || 'Shipment', badge: 'neutral' };
  const label = s.status || meta.short || 'Shipment';
  const cls = s.status ? statusBadgeClass(s.status) : meta.badge;
  const more = ships.length > 1 ? `<span class="shipment-status-more" title="${ships.length} linked shipments">+${ships.length - 1}</span>` : '';
  const title = `${s.shipmentId || s.orderId || 'Shipment'} - ${label}${s.status && meta.short ? ' (' + meta.short + ')' : ''}`;
  return `<span class="shipment-status-cell"><button type="button" class="badge ${cls} shipment-status-link" title="${escapeHtml(title)}" onclick="event.stopPropagation(); openShipmentDetail('${s.id}')">${escapeHtml(label)}</button>${more}</span>`;
}

/* ============================================================
   ORDERS LIST - DYNAMIC COLUMN SYSTEM
   Each column has: key, label, render(o), default visible, plus optional
   'num' alignment. User can reorder + hide columns. Saved to localStorage.
   Foreign and Local have different default column sets — Local omits all
   shipment + milestone columns.
============================================================ */
function getDefaultColumns(type) {
  const cols = [
    { key: 'iprNumber',     label: (window.__iprLabel ? window.__iprLabel() : 'IPR No.'),      visible: true,
      render: o => `<span class="mono text-xs">${escapeHtml(o.iprNumber || '—')}</span>` },
    { key: 'orderId',       label: type === 'foreign' ? 'FPO' : 'LPO', visible: true,
      render: o => `<span class="mono">${escapeHtml(o.orderId || '')}</span>${isErpOrder(o) ? ' ' + renderErpBadge(o, true) : ''}` },
    { key: 'claimant',      label: 'Claimant',     visible: true,
      render: o => `<span class="truncate" title="${escapeHtml(o.claimant||'')}">${escapeHtml(o.claimant || '—')}</span>` },
    { key: 'supplier',      label: 'Supplier',     visible: true,
      render: o => `<span class="truncate" title="${escapeHtml(o.supplier||'')}">${escapeHtml(o.supplier || '—')}</span>` },
    { key: 'requestedReceiptDate', label: 'Req. Receipt', visible: true,
      render: o => `<span class="mono text-xs">${fmtDate(o.requestedReceiptDate) || '—'}</span>` },
    { key: 'officer',       label: 'Officer (P/L)', visible: true,
      render: (o, ctx) => {
        const p = (ctx && ctx.officerMap ? (ctx.officerMap[o.officerCode] || o.officerCode) : o.officerCode) || '';
        const l = o.logisticOfficer ? (ctx && ctx.officerMap ? (ctx.officerMap[o.logisticOfficer] || o.logisticOfficer) : o.logisticOfficer) : '';
        const txt = [p, l].filter(Boolean).join(' / ');
        return escapeHtml(txt || '—');
      } },
    { key: 'dateOfOrder',   label: 'Date',         visible: false, render: o => `<span class="mono">${fmtDate(o.dateOfOrder)}</span>` },
    { key: 'description',   label: 'Description',  visible: false,
      render: o => `<span class="wrap text-sm">${escapeHtml(o.description || '—')}</span>` },
    { key: 'quantity',      label: 'Qty',          visible: false, num: true,
      render: o => `<span class="text-sm">${o.quantity != null && o.quantity !== '' ? escapeHtml(String(o.quantity)) : '—'}</span>` },
    { key: 'iprApprovedDate', label: 'HOD Appr.',  visible: false,
      render: o => `<span class="mono text-xs">${fmtDate(o.iprApprovedDate)}</span>` },
    { key: 'risk',          label: 'Risk',         visible: true,
      render: o => window.PXProcFollowup ? window.PXProcFollowup.riskBadge(o) : '—' },
    { key: 'ageing',        label: 'Ageing',       visible: false,
      render: o => window.PXProcFollowup ? window.PXProcFollowup.ageingBadge(o) : '—' },
    { key: 'nextFollowup',  label: 'Next Follow-Up', visible: false,
      render: o => `<span class="mono text-xs">${fmtDate(o.nextSupplierFollowupDate) || '—'}</span>` },
    { key: 'supplierPromise', label: 'Supplier Promise', visible: false,
      render: o => {
        const d = o.supplierRevisedPromisedDate || o.supplierPromisedDate;
        const cls = window.PXProcFollowup && window.PXProcFollowup.commitment(o).overdue ? ' style="color:var(--danger);font-weight:600"' : '';
        return `<span class="mono text-xs"${cls}>${fmtDate(d) || '—'}</span>`;
      } },
    { key: 'criticality',   label: 'Criticality',  visible: false,
      render: o => `<span class="badge ${String(o.orderCriticality||'normal') === 'critical' ? 'danger' : String(o.orderCriticality||'normal') === 'high' ? 'warn' : 'neutral'}">${escapeHtml(o.orderCriticality || 'normal')}</span>` },
    { key: 'erpExceptions', label: 'ERP/DW Exceptions', visible: false,
      render: o => {
        const n = window.PXProcFollowup ? window.PXProcFollowup.erpExceptions(o).length : 0;
        return n ? `<span class="badge warn">${n}</span>` : '<span class="text-xs text-muted">—</span>';
      } },
    { key: 'orderReadyDate', label: 'Ready Date',  visible: false,
      render: o => `<span class="mono text-xs">${fmtDate(o.orderReadyDate)}</span>` },
    { key: 'category',      label: 'Category',     visible: false,
      render: o => `<span class="text-xs truncate" title="${escapeHtml(o.category||'')}">${escapeHtml(o.category || '—')}</span>` },
    { key: 'amount',        label: 'Amount',       visible: true, num: true,
      render: o => fmtMoney(o.amount, o.currency) },
    { key: 'paymentDueDate', label: 'Pay Due',     visible: false,
      render: o => `<span class="mono text-xs">${fmtDate(o.paymentDueDate)}</span>` },
    { key: 'paymentTerms',  label: 'Terms',        visible: false,
      render: o => `<span class="text-xs truncate" title="${escapeHtml(o.paymentTerms||'')}" style="max-width:140px;display:inline-block">${escapeHtml(o.paymentTerms || '—')}</span>` },
    { key: 'mtto',          label: 'MTTO',         visible: false,  num: true,
      render: o => { const m = calcOrderMTTO(o); return m !== null ? `<span style="${m > 5 ? 'color: var(--warn); font-weight:600' : ''}">${m}d</span>` : '—'; } },
    { key: 'status',        label: 'Status',       visible: true,
      render: o => `<span class="badge ${statusBadgeClass(o.status)}">${escapeHtml(o.status || '—')}</span>` },
    { key: 'notes',         label: 'Notes',        visible: false,
      render: o => `<span class="text-xs truncate" title="${escapeHtml(o.notes||'')}" style="max-width:180px;display:inline-block">${escapeHtml(o.notes || '—')}</span>` }
  ];

  // Foreign-only columns
  if (type === 'foreign') {
    cols.push(
      { key: 'shipmentStatus', label: 'Shipment Status', visible: true,
        render: o => renderShipmentStatus(o) },
      { key: 'otif', label: 'OTIF', visible: true,
        render: o => {
          if (!orderNeedsShipment(o)) return `<span class="badge neutral" style="font-size:10.5px" title="Service / no-shipment order">n/a</span>`;
          const otif = calcOrderOTIF(o, state.data.shipments);
          const cls = otif.status === 'on_time' ? 'success' : otif.status === 'late' ? 'danger' : otif.status === 'pending' ? 'accent' : 'neutral';
          return `<span class="badge ${cls}" style="font-size:10.5px">${otif.label}</span>`;
        } },
      { key: 'payments', label: 'Payments', visible: true,
        render: o => {
          const ms = o.milestones || [];
          if (ms.length === 0) return '<span class="text-xs text-muted">—</span>';
          const dots = ms.map(m => {
            const exp = computeMilestoneDate(m, o, state.data.shipments);
            const st = milestoneStatus(m, exp);
            return `<span class="dot ${st}" title="${escapeHtml(m.label)} (${m.percent}%) - ${st}"></span>`;
          }).join('');
          const paid = ms.filter(m => m.paidDate).length;
          return `<span class="ladder-mini">${dots}</span> <span class="text-xs text-muted">${paid}/${ms.length}</span>`;
        } }
    );
  }

  return cols;
}

// localStorage helpers for column prefs - per viewKey (e.g. "foreign-technical")
// COL_DEFAULTS_VERSION: bump when the default column set/order changes so saved layouts
// from before the change are reset ONCE to pick up the new defaults; afterwards the user's
// own adjustments persist again.
const COL_DEFAULTS_VERSION = 2;
function loadColPrefs(viewKey) {
  try {
    const v = parseInt(localStorage.getItem('phoenix_cols_version') || '1', 10);
    if (v < COL_DEFAULTS_VERSION) return null; // stale layout → fall back to new defaults
    const raw = localStorage.getItem('phoenix_cols_' + viewKey);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveColPrefs(viewKey, prefs) {
  try { localStorage.setItem('phoenix_cols_version', String(COL_DEFAULTS_VERSION)); } catch (_) {}
  localStorage.setItem('phoenix_cols_' + viewKey, JSON.stringify(prefs));
}
function getOrderedColumns(viewKey, type) {
  const defaults = getDefaultColumns(type);
  const prefs = loadColPrefs(viewKey);
  if (!prefs) return defaults;
  // Reorder defaults by saved order, apply saved visibility
  const ordered = [];
  prefs.order.forEach(key => {
    const col = defaults.find(c => c.key === key);
    if (col) {
      col.visible = prefs.visible[key] !== undefined ? prefs.visible[key] : col.visible;
      ordered.push(col);
    }
  });
  // Insert new columns near their default neighbours so saved layouts evolve cleanly.
  defaults.forEach((col, defaultIndex) => {
    if (ordered.find(c => c.key === col.key)) return;
    const priorDefaultKeys = defaults.slice(0, defaultIndex).map(c => c.key);
    let insertAt = ordered.length;
    for (let i = ordered.length - 1; i >= 0; i--) {
      if (priorDefaultKeys.includes(ordered[i].key)) {
        insertAt = i + 1;
        break;
      }
    }
    ordered.splice(insertAt, 0, col);
  });
  return ordered;
}


// --- bridges (separate scopes) ---
window.__ord_calcOrderMTTO = calcOrderMTTO;
window.__ord_calcOrderOTIF = calcOrderOTIF;
window.__ord_getDefaultColumns = getDefaultColumns;
window.__ord_loadColPrefs = loadColPrefs;
window.__ord_saveColPrefs = saveColPrefs;
window.__ord_getOrderedColumns = getOrderedColumns;
window.PXReceiptControl = {
  orderGrns,
  shipmentGrns,
  shipmentReceiptDate,
  orderReceiptDates,
  grnStatus: _grnStatus,
  grnCountsAsReceipt: _grnCountsAsReceipt
};

/* ============================================================
   PXTimeline — planned vs actual performance timeline (Feature 6)
   ============================================================
   Builds the 12-milestone timeline for an order, deriving ACTUALS from the
   order's own fields, its shipments, and its payments (single source of truth),
   with order.actualDates[key] as a manual/override layer and order.plannedDates[key]
   as the planning layer. Computes delay days (actual − planned) and lead times
   (gap to the previous milestone that has an actual). Read-only over state. */
(function(){
  const toDate = v => {
    if (!v) return null;
    if (v.toDate) { try { return v.toDate(); } catch(_) { return null; } }
    if (v.seconds != null) return new Date(v.seconds * 1000);
    if (v instanceof Date) return isNaN(v) ? null : v;
    const d = new Date(v); return isNaN(d) ? null : d;
  };
  const dayDiff = (a, b) => Math.round((a.getTime() - b.getTime()) / 86400000);
  const pick = (records, field, mode) => {
    const ds = records.map(r => toDate(r[field])).filter(Boolean);
    if (!ds.length) return null;
    const t = mode === 'max' ? Math.max(...ds.map(d=>d.getTime())) : Math.min(...ds.map(d=>d.getTime()));
    return new Date(t);
  };

  function forOrder(order){
    const st = window.__state;
    const oid = order.orderId;
    const ships = (st.data.shipments || []).filter(s => s.orderId === oid && !s.archived);
    const pays  = (st.data.payments  || []).filter(p => p.orderId === oid && !p.archived);
    const planned = order.plannedDates || {};
    const override = order.actualDates || {};

    const rows = (window.REF.timelineMilestones || []).map(m => {
      let actual = override[m.key] ? toDate(override[m.key]) : null;
      let source = actual ? 'manual' : null;
      if (!actual) {
        if (m.src.startsWith('order:')) { actual = toDate(order[m.src.split(':')[1]]); source = 'order'; }
        else if (m.src.startsWith('ship:')) { const [,f,mode] = m.src.split(':'); actual = pick(ships, f, mode); source = 'shipment'; }
        else if (m.src.startsWith('pay:'))  { const [,f,mode] = m.src.split(':'); actual = pick(pays,  f, mode); source = 'payment'; }
        else source = 'manual';
      }
      const plan = planned[m.key] ? toDate(planned[m.key]) : null;
      const delayDays = (plan && actual) ? dayDiff(actual, plan) : null;
      return { key:m.key, label:m.label, src:m.src, manual:(m.src==='manual'), planned:plan, actual, source, delayDays, leadDays:null };
    });

    // Lead times: gap to the previous milestone that has an actual.
    let prev = null;
    rows.forEach(r => { if (r.actual) { r.leadDays = prev ? dayDiff(r.actual, prev) : null; prev = r.actual; } });

    const actuals = rows.filter(r => r.actual).map(r => r.actual.getTime());
    const summary = {
      completed: actuals.length,
      total: rows.length,
      firstActual: actuals.length ? new Date(Math.min(...actuals)) : null,
      lastActual:  actuals.length ? new Date(Math.max(...actuals)) : null,
      totalLeadDays: actuals.length > 1 ? Math.round((Math.max(...actuals) - Math.min(...actuals)) / 86400000) : null,
      lateCount: rows.filter(r => r.delayDays != null && r.delayDays > 0).length,
      onTimeCount: rows.filter(r => r.delayDays != null && r.delayDays <= 0).length,
      worstDelay: rows.reduce((mx, r) => (r.delayDays != null && r.delayDays > mx) ? r.delayDays : mx, 0)
    };
    return { rows, summary };
  }

  window.PXTimeline = { forOrder, _toDate: toDate };
})();

/* ============================================================
   PXFinancial — PO Financial & Receipt Control (Feature 5)
   ============================================================
   One controlled view per order of ordered / received / invoiced / requested /
   paid, grouped strictly BY CURRENCY (never a mixed unlabelled total). Flags
   over-payment, duplicate payments, and receipt/invoice/payment mismatches.
   Base-currency conversion is intentionally NOT computed unless a rate + rate date
   + source are recorded (none on orders today), per the spec. Read-only. */
(function(){
  const toNum = v => { const n = Number(v); return isNaN(n) ? 0 : n; };
  function forOrder(order){
    const st = window.__state;
    const poCur = order.currency || '—';
    const pays  = (st.data.payments  || []).filter(p => !p.archived && p.orderId === order.orderId);
    const ships = (st.data.shipments || []).filter(s => !s.archived && s.orderId === order.orderId);
    const isPaid = p => p.isPaid === true || p.status === 'paid';
    const isApproved = p => p.paymentApproved === true || ['approved','paid'].includes(p.status);
    const isRequested = p => p.status !== 'rejected';

    const curs = Array.from(new Set([poCur, ...pays.map(p => p.currency || poCur)]));
    const byCurrency = curs.map(cur => {
      const ps = pays.filter(p => (p.currency || poCur) === cur);
      const requested = ps.filter(isRequested).reduce((s,p)=>s+toNum(p.amount),0);
      const approved  = ps.filter(isApproved).reduce((s,p)=>s+toNum(p.amount),0);
      const paid      = ps.filter(isPaid).reduce((s,p)=>s+toNum(p.amount),0);
      const poAmount  = cur === poCur ? toNum(order.amount) : null;
      const outstanding = poAmount != null ? (poAmount - paid) : (requested - paid);
      return { currency: cur, poAmount, requested, approved, paid, outstanding };
    });

    const fmt = (a,c) => window.PXUtils.fmtMoney(a,c);
    const warnings = [];
    byCurrency.forEach(c => {
      if (c.poAmount != null && c.paid - c.poAmount > 0.01) warnings.push({ level:'danger', msg:`Over-payment: paid ${fmt(c.paid,c.currency)} exceeds PO amount ${fmt(c.poAmount,c.currency)} by ${fmt(c.paid-c.poAmount,c.currency)}` });
      if (c.paid - c.approved > 0.01) warnings.push({ level:'danger', msg:`Paid ${fmt(c.paid,c.currency)} exceeds approved ${fmt(c.approved,c.currency)} (${c.currency})` });
      if (c.poAmount != null && c.requested - c.poAmount > 0.01) warnings.push({ level:'warn', msg:`Requested ${fmt(c.requested,c.currency)} exceeds PO amount ${fmt(c.poAmount,c.currency)} (${c.currency})` });
    });
    const byInv = {};
    pays.forEach(p => { const k = (p.invoiceNumber||'').trim(); if (k) (byInv[k] = byInv[k] || []).push(p); });
    Object.entries(byInv).forEach(([inv, ps]) => { if (ps.length > 1) warnings.push({ level:'warn', msg:`Possible duplicate: invoice "${inv}" appears on ${ps.length} RFPs` }); });
    const byMs = {};
    pays.filter(isPaid).forEach(p => { if (p.milestoneId) byMs[p.milestoneId] = (byMs[p.milestoneId]||0) + 1; });
    Object.values(byMs).forEach(n => { if (n > 1) warnings.push({ level:'warn', msg:`A milestone has ${n} paid RFPs (possible duplicate payment)` }); });
    pays.forEach(p => { if (p.currency && poCur !== '—' && p.currency !== poCur) warnings.push({ level:'info', msg:`RFP ${p.rfpRef||''} currency ${p.currency} differs from PO currency ${poCur}` }); });

    const activeGrns = orderGrns(order, { activeOnly: true });
    const withGrn = ships.filter(s => shipmentReceiptDate(order, s)).length;
    const completed = ships.filter(s => s.completed || s.stage === 'completed' || /received|completed|closed/.test((s.status||'').toLowerCase())).length;
    if (pays.some(isPaid) && withGrn === 0 && activeGrns.length === 0) warnings.push({ level:'warn', msg:'Payment made but no goods receipt (GRN) recorded yet' });

    return {
      poCurrency: poCur, poAmount: toNum(order.amount), quantity: order.quantity != null ? order.quantity : null,
      lines: Array.isArray(order.lines) ? order.lines.length : 0,
      byCurrency, rfps: pays, receipts: { shipments: ships.length, withGrn, orderGrns: activeGrns.length, completed },
      warnings, hasFx: false
    };
  }
  window.PXFinancial = { forOrder };
})();

/* ============================================================
   PXLineFulfilment — PO line-level fulfilment / receipt / closure (Increment 1)
   ============================================================
   Computes, per ERP PO line, the controlled receipt position from Phoenix-owned
   receipts[] + lineTracking[]: ordered/cancelled/received/remaining, linked
   shipment(s), GRN refs, expected vs actual receipt date, line status
   (open / part received / received / cancelled), and the closure/over-receipt
   warnings the spec requires. ERP line master stays read-only; only the Phoenix
   arrays drive the operational position. Read-only computation. */
(function(){
  const toNum = v => { const n = Number(v); return isNaN(n) ? 0 : n; };
  const toDate = v => { if (!v) return null; if (v.toDate) return v.toDate(); if (v instanceof Date) return v; const d = new Date(v); return isNaN(d) ? null : d; };
  const lineKey = (l, idx) => String(l.lineId != null && l.lineId !== '' ? l.lineId : (l.lineNo != null && l.lineNo !== '' ? l.lineNo : ('idx' + idx)));

  function forOrder(order){
    const lines = Array.isArray(order.lines) ? order.lines : [];
    const receipts = Array.isArray(order.receipts) ? order.receipts : [];
    const tracking = Array.isArray(order.lineTracking) ? order.lineTracking : [];
    const validKeys = new Set();
    const out = lines.map((l, idx) => {
      const key = lineKey(l, idx); validKeys.add(key);
      const t = tracking.find(x => String(x.lineId) === key) || {};
      const ordered = toNum(l.orderedQty != null ? l.orderedQty : l.quantity);
      const cancelled = toNum(l.cancelledQty);
      const lineReceipts = receipts.filter(r => String(r.lineId) === key);
      const received = lineReceipts.reduce((s, r) => s + toNum(r.receivedQty), 0);
      const remaining = ordered - cancelled - received;
      const shipments = Array.from(new Set(lineReceipts.map(r => r.shipmentId).filter(Boolean)));
      const grns = lineReceipts.filter(r => r.grnRef || r.grnDate).map(r => ({ ref: r.grnRef || '', date: r.grnDate || null }));
      let actualReceiptDate = null;
      lineReceipts.forEach(r => { const d = toDate(r.grnDate); if (d && (!actualReceiptDate || d > actualReceiptDate)) actualReceiptDate = d; });
      const exceptionApproved = !!t.exceptionApproved || lineReceipts.some(r => r.exceptionApproved);
      let status;
      if (ordered > 0 && cancelled >= ordered) status = 'cancelled';
      else if (t.closed && /cancel/i.test(t.closureReason || '')) status = 'cancelled';
      else if (ordered > 0 && received + cancelled >= ordered - 0.0001) status = 'received';
      else if (received > 0) status = 'part received';
      else status = 'open';
      const warnings = [];
      if (received > ordered - cancelled + 0.0001 && !exceptionApproved)
        warnings.push({ level: 'error', msg: `Received ${received} exceeds ordered (${ordered - cancelled}) without an approved exception` });
      if (t.closed && remaining > 0.0001 && status !== 'cancelled')
        warnings.push({ level: 'warn', msg: `Line closed with ${remaining} remaining` });
      const open = (status === 'open' || status === 'part received') && !t.closed;
      return {
        key, lineNo: l.lineNo, itemNumber: l.itemNumber, description: l.description, uom: l.uom,
        ordered, cancelled, received, remaining, shipments, grns, actualReceiptDate,
        expectedDeliveryDate: l.expectedDeliveryDate || null, status, closed: !!t.closed,
        closureReason: t.closureReason || '', exceptionApproved, warnings, open, receipts: lineReceipts
      };
    });
    const orderWarnings = [];
    if (lines.length) {
      const orphan = receipts.filter(r => r.lineId && !validKeys.has(String(r.lineId)));
      if (orphan.length) orderWarnings.push({ level: 'warn', msg: `${orphan.length} receipt(s) recorded without a valid linked PO line` });
    }
    const errors = out.reduce((a, l) => a.concat(l.warnings.filter(w => w.level === 'error')), []);
    const openLines = out.filter(l => l.open).length;
    return {
      hasLines: lines.length > 0, lines: out, totalLines: lines.length,
      open: openLines, openLines,
      partReceived: out.filter(l => l.status === 'part received').length,
      received: out.filter(l => l.status === 'received').length,
      cancelled: out.filter(l => l.status === 'cancelled').length,
      canClose: lines.length === 0 ? true : (openLines === 0 && errors.length === 0),
      orderWarnings, errors, anyError: errors.length > 0
    };
  }
  window.PXLineFulfilment = { forOrder, _lineKey: lineKey };
})();
