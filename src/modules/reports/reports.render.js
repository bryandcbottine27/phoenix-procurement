const { $, $$, fmtDate, fmtMoney, daysBetween, escapeHtml, toast, statusBadgeClass,
  orderFunction, cmGetColumns, cmRenderTable, cmOpenManager, cmExportCSV,
  erpSourceOf, renderErpBadge, isErpOrder,
  collection, getDocs, addDoc, serverTimestamp, recordEntity, entityMeta, currentEntity } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;


window.__renderers['reports'] = function() {
  const viewEl = $('#view-reports');

  // Shared dimension filters (same shape as dashboard). Entity is NOT a dimension here —
  // like the dashboard, Reports always scopes to the sidebar entity switcher.
  const rf = state.filters.reportsDim || (state.filters.reportsDim = {
    orderType: '', function: '', officer: '', supplier: '', currency: '', dateFrom: '', dateTo: ''
  });
  const repEnt = currentEntity();
  const rDateFrom = rf.dateFrom ? new Date(rf.dateFrom) : null;
  const rDateTo = rf.dateTo ? new Date(rf.dateTo + 'T23:59:59') : null;
  function rOrderPasses(o) {
    if (recordEntity(o) !== repEnt) return false;
    if (rf.orderType && o.orderType !== rf.orderType) return false;
    if (rf.function && orderFunction(o) !== rf.function) return false;
    if (rf.officer && o.officerCode !== rf.officer) return false;
    if (rf.supplier && o.supplier !== rf.supplier) return false;
    if (rf.currency && o.currency !== rf.currency) return false;
    if (rDateFrom || rDateTo) {
      const d = o.dateOfOrder?.toDate ? o.dateOfOrder.toDate() : (o.dateOfOrder ? new Date(o.dateOfOrder) : null);
      if (!d) return false;
      if (rDateFrom && d < rDateFrom) return false;
      if (rDateTo && d > rDateTo) return false;
    }
    return true;
  }
  // Entity-scoped helpers for shipments/payments (linked to an in-entity order, or own entity tag).
  const repShipPasses = s => recordEntity(s) === repEnt || (state.data.orders.find(o => o.orderId === s.orderId && recordEntity(o) === repEnt) != null);
  const repPayPasses = p => recordEntity(p) === repEnt || (state.data.orders.find(o => o.orderId === p.orderId && recordEntity(o) === repEnt) != null);
  const rAnyFilter = rf.orderType || rf.function || rf.officer || rf.supplier || rf.currency || rf.dateFrom || rf.dateTo;
  const orders = state.data.orders.filter(rOrderPasses);
  const rOrderIds = new Set(orders.map(o => o.orderId));
  // Shipments are always entity-scoped; if other dimensions are set, narrow to the filtered orders.
  const ships = rAnyFilter ? state.data.shipments.filter(s => rOrderIds.has(s.orderId)) : state.data.shipments.filter(repShipPasses);
  const procCtx = window.PXProcFollowup ? window.PXProcFollowup.context() : null;
  const procDash = window.PXProcFollowup ? window.PXProcFollowup.dashboard(orders, procCtx) : null;

  const totalsByCurrency = {};
  orders.filter(o => !o.isClosed).forEach(o => {
    if (o.amount && o.currency) {
      totalsByCurrency[o.currency] = (totalsByCurrency[o.currency] || 0) + Number(o.amount);
    }
  });

  const byCategory = {};
  orders.filter(o => !o.isClosed).forEach(o => {
    const k = o.category || '(uncategorised)';
    byCategory[k] = (byCategory[k]||0) + 1;
  });

  const byCounterparty = {};
  orders.filter(o => !o.isClosed).forEach(o => {
    const k = o.supplier || '—';
    byCounterparty[k] = (byCounterparty[k]||0) + 1;
  });

  const topSup = Object.entries(byCounterparty).sort((a,b) => b[1]-a[1]).slice(0, 10);

  let otifBreaches = 0, clrBreaches = 0;
  ships.forEach(s => {
    if (s.eta && s.grnDate) {
      const d = daysBetween(s.eta, s.grnDate);
      if (d > 10) otifBreaches++;
    }
    if (s.docsToBrokerDate && s.clearanceDate) {
      const d = daysBetween(s.docsToBrokerDate, s.clearanceDate);
      if (d > 3) clrBreaches++;
    }
  });

  // ===== All Records detailed table (dynamic columns) =====
  const repFilters = state.filters.reports || (state.filters.reports = { dataset: 'orders', search: '' });

  // Build column defs + rows per dataset
  function buildReportDataset(which) {
    if (which === 'orders') {
      const officerMap = Object.fromEntries(state.data.officers.map(o => [o.code, o.fullName || o.code]));
      const defs = [
        { key: 'orderId', label: 'Order', render: o => `<span class="mono" style="font-weight:600">${escapeHtml(o.orderId||'—')}</span>`, raw: o => o.orderId },
        { key: 'entity', label: 'Entity', render: o => { const m = entityMeta(recordEntity(o)); return `<span class="entity-badge" style="background:${m.accent};color:#fff">${m.short}</span>`; }, csv: o => recordEntity(o) },
        { key: 'orderType', label: 'Type', render: o => escapeHtml(o.orderType||'—'), raw: o => o.orderType },
        { key: 'function', label: 'Function', render: o => { const f = orderFunction(o); return f ? escapeHtml(f) : '—'; }, csv: o => orderFunction(o) || '' },
        { key: 'dateOfOrder', label: 'Date', render: o => fmtDate(o.dateOfOrder), raw: o => o.dateOfOrder },
        { key: 'supplier', label: 'Supplier', render: o => `<span class="truncate" title="${escapeHtml(o.supplier||'')}">${escapeHtml(o.supplier||'—')}</span>`, raw: o => o.supplier },
        { key: 'description', label: 'Description', defaultVisible: false, render: o => `<span class="text-sm truncate" title="${escapeHtml(o.description||'')}" style="max-width:200px;display:inline-block">${escapeHtml(o.description||'—')}</span>`, raw: o => o.description },
        { key: 'category', label: 'Category', render: o => escapeHtml(o.category||'—'), raw: o => o.category },
        { key: 'iprNumber', label: (window.__iprLabel ? window.__iprLabel(null, {short:true}) : 'IPR'), defaultVisible: false, render: o => `<span class="mono text-xs">${escapeHtml(o.iprNumber||'—')}</span>`, raw: o => o.iprNumber },
        { key: 'officerCode', label: 'Officer', render: o => escapeHtml(officerMap[o.officerCode] || o.officerCode || '—'), raw: o => o.officerCode },
        { key: 'amount', label: 'Amount', num: true, render: o => fmtMoney(o.amount, o.currency), raw: o => o.amount },
        { key: 'currency', label: 'Curr.', defaultVisible: false, render: o => escapeHtml(o.currency||'—'), raw: o => o.currency },
        { key: 'paymentTerms', label: 'Terms', defaultVisible: false, render: o => `<span class="text-xs truncate" title="${escapeHtml(o.paymentTerms||'')}" style="max-width:140px;display:inline-block">${escapeHtml(o.paymentTerms||'—')}</span>`, raw: o => o.paymentTerms },
        { key: 'paymentDueDate', label: 'Pay Due', defaultVisible: false, render: o => fmtDate(o.paymentDueDate), raw: o => o.paymentDueDate },
        { key: 'requestedReceiptDate', label: 'Req. Receipt', defaultVisible: false, render: o => fmtDate(o.requestedReceiptDate), raw: o => o.requestedReceiptDate },
        { key: 'procRisk', label: 'Risk', render: o => window.PXProcFollowup ? window.PXProcFollowup.riskBadge(o) : '—', csv: o => window.PXProcFollowup ? window.PXProcFollowup.exportRow(o).riskLevel : '' },
        { key: 'procRiskScore', label: 'Risk Score', defaultVisible: false, num: true, render: o => window.PXProcFollowup ? String(window.PXProcFollowup.riskScore(o).score) : '—', raw: o => window.PXProcFollowup ? window.PXProcFollowup.riskScore(o).score : '' },
        { key: 'ageingBucket', label: 'Ageing', defaultVisible: false, render: o => window.PXProcFollowup ? window.PXProcFollowup.ageingBadge(o) : '—', csv: o => window.PXProcFollowup ? window.PXProcFollowup.ageingBucket(o).label : '' },
        { key: 'nextSupplierFollowupDate', label: 'Next Follow-Up', defaultVisible: false, render: o => fmtDate(o.nextSupplierFollowupDate) || '—', raw: o => o.nextSupplierFollowupDate },
        { key: 'supplierPromisedDate', label: 'Supplier Promise', defaultVisible: false, render: o => fmtDate(o.supplierRevisedPromisedDate || o.supplierPromisedDate) || '—', csv: o => fmtDate(o.supplierRevisedPromisedDate || o.supplierPromisedDate) },
        { key: 'orderCriticality', label: 'Criticality', defaultVisible: false, render: o => escapeHtml(o.orderCriticality || 'normal'), raw: o => o.orderCriticality },
        { key: 'erpExceptionCount', label: 'ERP/DW Ex.', defaultVisible: false, num: true, render: o => window.PXProcFollowup ? String(window.PXProcFollowup.erpExceptions(o).length || '') : '', raw: o => window.PXProcFollowup ? window.PXProcFollowup.erpExceptions(o).length : 0 },
        { key: 'status', label: 'Status', render: o => `<span class="badge ${statusBadgeClass(o.status)}">${escapeHtml(o.status||'—')}</span>`, raw: o => o.status },
        { key: 'isClosed', label: 'Closed', defaultVisible: false, render: o => o.isClosed ? 'Yes' : 'No', csv: o => o.isClosed ? 'Yes' : 'No' },
        { key: 'erpSource', label: 'ERP Source', render: o => isErpOrder(o) ? renderErpBadge(o, true) : '<span class="text-xs text-muted">Manual</span>', csv: o => erpSourceOf(o) }
      ];
      return { defs, rows: state.data.orders, onRowClick: 'openOrderDetail' };
    }
    if (which === 'shipments') {
      const defs = [
        { key: 'shipmentId', label: 'Shipment', render: s => `<span class="mono" style="font-weight:600">${escapeHtml(s.shipmentId||'—')}</span>`, raw: s => s.shipmentId },
        { key: 'orderId', label: 'Order', render: s => `<span class="mono">${escapeHtml(s.orderId||'—')}</span>`, raw: s => s.orderId },
        { key: 'stage', label: 'Stage', render: s => { const m = REF.shipmentStages[s.stage||'']||{short:s.stage||'—'}; return escapeHtml(m.short); }, raw: s => s.stage },
        { key: 'supplier', label: 'Supplier', render: s => `<span class="truncate">${escapeHtml(s.supplier||'—')}</span>`, raw: s => s.supplier },
        { key: 'status', label: 'Shipping Status', render: s => escapeHtml(s.status||'—'), raw: s => s.status },
        { key: 'conveyance', label: 'Conveyance', defaultVisible: false, render: s => escapeHtml(s.conveyance||'—'), raw: s => s.conveyance },
        { key: 'etd', label: 'ETD', render: s => fmtDate(s.etd), raw: s => s.etd },
        { key: 'eta', label: 'ETA', render: s => fmtDate(s.eta), raw: s => s.eta },
        { key: 'grnDate', label: 'GRN Date', render: s => fmtDate(s.grnDate), raw: s => s.grnDate },
        { key: 'otif', label: 'OTIF', num: true, render: s => { const o = (s.eta && s.grnDate) ? daysBetween(s.eta, s.grnDate) : null; return o!==null ? o+'d' : '—'; }, raw: s => (s.eta && s.grnDate) ? daysBetween(s.eta, s.grnDate) : '' },
        { key: 'logisticOfficer', label: 'Logistic Officer', render: s => escapeHtml(s.logisticOfficer||'—'), raw: s => s.logisticOfficer },
        { key: 'freightForwarder', label: 'Forwarder', defaultVisible: false, render: s => escapeHtml(s.freightForwarder||'—'), raw: s => s.freightForwarder },
        { key: 'blAwbNumber', label: 'BL/AWB', defaultVisible: false, render: s => escapeHtml(s.blAwbNumber||'—'), raw: s => s.blAwbNumber },
        { key: 'containerNumber', label: 'Container', defaultVisible: false, render: s => escapeHtml(s.containerNumber||'—'), raw: s => s.containerNumber },
        { key: 'totalLandedCost', label: 'Landed Cost', num: true, render: s => s.totalLandedCost!=null?fmtMoney(s.totalLandedCost,s.currency):'—', raw: s => s.totalLandedCost }
      ];
      return { defs, rows: state.data.shipments, onRowClick: 'openShipmentDetail' };
    }
    if (which === 'payments') {
      const defs = [
        { key: 'rfpRef', label: 'RFP Ref', render: p => `<span class="mono" style="font-weight:600">${escapeHtml(p.rfpRef||'—')}</span>`, raw: p => p.rfpRef },
        { key: 'orderId', label: 'FPO', render: p => `<span class="mono">${escapeHtml(p.orderId||'—')}</span>`, raw: p => p.orderId },
        { key: 'supplier', label: 'Supplier', render: p => `<span class="truncate">${escapeHtml(p.supplier||'—')}</span>`, raw: p => p.supplier },
        { key: 'amount', label: 'Amount', num: true, render: p => fmtMoney(p.amount, p.currency), raw: p => p.amount },
        { key: 'status', label: 'Status', render: p => `<span class="badge ${statusBadgeClass(p.status)}">${escapeHtml(p.status||'—')}</span>`, raw: p => p.status },
        { key: 'invoiceNumber', label: 'Invoice', render: p => `<span class="mono text-sm">${escapeHtml(p.invoiceNumber||'—')}</span>`, raw: p => p.invoiceNumber },
        { key: 'dueDate', label: 'Due', render: p => fmtDate(p.dueDate), raw: p => p.dueDate },
        { key: 'iblValueDate', label: 'IBL Value Date', defaultVisible: false, render: p => fmtDate(p.iblValueDate), raw: p => p.iblValueDate },
        { key: 'requestedBy', label: 'By', render: p => escapeHtml(p.requestedBy||'—'), raw: p => p.requestedBy }
      ];
      return { defs, rows: state.data.payments, onRowClick: 'openPaymentDetail' };
    }
    if (which === 'update_requests') {
      const defs = [
        { key: 'targetType', label: 'Target', render: r => escapeHtml(r.targetType || 'order'), raw: r => r.targetType },
        { key: 'orderId', label: 'Order', render: r => `<span class="mono">${escapeHtml(r.orderId || '—')}</span>`, raw: r => r.orderId },
        { key: 'shipmentId', label: 'Shipment', defaultVisible: false, render: r => `<span class="mono">${escapeHtml(r.shipmentId || '—')}</span>`, raw: r => r.shipmentId },
        { key: 'status', label: 'Status', render: r => `<span class="badge ${r.status === 'attended' ? 'success' : 'warn'}">${escapeHtml(r.status || 'open')}</span>`, raw: r => r.status },
        { key: 'dueDate', label: 'Due', render: r => fmtDate(r.dueDate), raw: r => r.dueDate },
        { key: 'requestorName', label: 'Requested By', render: r => escapeHtml(r.requestorName || r.requestorCode || '—'), raw: r => r.requestorName || r.requestorCode },
        { key: 'targetOfficers', label: 'Routed To', defaultVisible: false, render: r => escapeHtml((r.targetOfficers || []).join(', ') || '—'), csv: r => (r.targetOfficers || []).join('; ') },
        { key: 'message', label: 'Request', render: r => `<span class="text-sm">${escapeHtml(r.message || '—')}</span>`, raw: r => r.message },
        { key: 'attendedBy', label: 'Attended By', defaultVisible: false, render: r => escapeHtml(r.attendedBy || '—'), raw: r => r.attendedBy },
        { key: 'attendedAt', label: 'Attended At', defaultVisible: false, render: r => fmtDate(r.attendedAt), raw: r => r.attendedAt },
        { key: 'attendNote', label: 'Reply', defaultVisible: false, render: r => `<span class="text-sm">${escapeHtml(r.attendNote || '—')}</span>`, raw: r => r.attendNote }
      ];
      return { defs, rows: state.data.updateRequests, onRowClick: null };
    }
    if (which === 'contact_log') {
      const defs = [
        { key: 'contactDate', label: 'Date', render: r => fmtDate(r.contactDate), raw: r => r.contactDate },
        { key: 'relatedType', label: 'Type', render: r => escapeHtml(r.relatedType || 'order'), raw: r => r.relatedType },
        { key: 'orderId', label: 'Order', render: r => `<span class="mono">${escapeHtml(r.orderId || '—')}</span>`, raw: r => r.orderId },
        { key: 'shipmentId', label: 'Shipment', defaultVisible: false, render: r => `<span class="mono">${escapeHtml(r.shipmentId || '—')}</span>`, raw: r => r.shipmentId },
        { key: 'supplier', label: 'Supplier', render: r => `<span class="truncate">${escapeHtml(r.supplier || '—')}</span>`, raw: r => r.supplier },
        { key: 'direction', label: 'Direction', render: r => escapeHtml(r.direction || '—'), raw: r => r.direction },
        { key: 'channel', label: 'Channel', render: r => escapeHtml(r.channel || '—'), raw: r => r.channel },
        { key: 'contactPerson', label: 'Contact', defaultVisible: false, render: r => escapeHtml(r.contactPerson || '—'), raw: r => r.contactPerson },
        { key: 'summary', label: 'Summary', render: r => `<span class="text-sm">${escapeHtml(r.summary || '—')}</span>`, raw: r => r.summary },
        { key: 'responseExpectedBy', label: 'Response Due', defaultVisible: false, render: r => fmtDate(r.responseExpectedBy), raw: r => r.responseExpectedBy },
        { key: 'officerCode', label: 'Officer', defaultVisible: false, render: r => escapeHtml(r.officerName || r.officerCode || '—'), raw: r => r.officerName || r.officerCode }
      ];
      return { defs, rows: state.data.contactLog, onRowClick: null };
    }
    if (which === 'kpi_snapshot') {
      const defs = [
        { key: 'entity', label: 'Entity', render: r => escapeHtml(r.entity || '—'), raw: r => r.entity },
        { key: 'period', label: 'Period', render: r => `<span class="mono">${escapeHtml(r.period || '—')}</span>`, raw: r => r.period },
        { key: 'source', label: 'Source', render: r => escapeHtml(r.source || '—'), raw: r => r.source },
        { key: 'capturedAt', label: 'Captured', render: r => fmtDate(r.capturedAt), raw: r => r.capturedAt },
        { key: 'capturedBy', label: 'By', defaultVisible: false, render: r => escapeHtml(r.capturedBy || '—'), raw: r => r.capturedBy },
        { key: 'values', label: 'Values', render: r => `<span class="text-xs">${escapeHtml(JSON.stringify(r.values || {}))}</span>`, csv: r => JSON.stringify(r.values || {}) }
      ];
      return { defs, rows: state.data.kpiSnapshot, onRowClick: null };
    }
    return { defs: [], rows: [], onRowClick: null };
  }

  const ds = buildReportDataset(repFilters.dataset);
  let dsRows = ds.rows;
  // Entity scoping ALWAYS applies (matches the sidebar switcher), then optional dimensions.
  if (repFilters.dataset === 'orders') {
    dsRows = dsRows.filter(rOrderPasses); // rOrderPasses already enforces the current entity
  } else if (repFilters.dataset === 'shipments') {
    dsRows = dsRows.filter(repShipPasses);
    if (rAnyFilter) dsRows = dsRows.filter(r => rOrderIds.has(r.orderId));
  } else if (repFilters.dataset === 'payments') {
    dsRows = dsRows.filter(repPayPasses);
    if (rAnyFilter) dsRows = dsRows.filter(r => rOrderIds.has(r.orderId));
  } else if (['update_requests','contact_log','kpi_snapshot'].includes(repFilters.dataset)) {
    dsRows = dsRows.filter(r => (r.entity || repEnt) === repEnt);
  }
  if (repFilters.search) {
    const q = repFilters.search.toLowerCase();
    dsRows = dsRows.filter(r => Object.values(r).some(v => v && typeof v !== 'object' && String(v).toLowerCase().includes(q)));
  }
  const storageKey = 'reports_' + repFilters.dataset;

  /* ===== Operational reports (documents / follow-ups / issues) ===== */
  const badgeForDocStatus = s => ({ missing:'danger', requested:'accent', received:'info', approved:'success', rejected:'danger' }[s] || 'neutral');
  function relatedLabel(rt, rid) {
    if (rt === 'order') { const o = state.data.orders.find(x => x.id === rid); return o ? `Order ${o.orderId}` : 'Order'; }
    if (rt === 'shipment') { const s = state.data.shipments.find(x => x.id === rid); return s ? `Shipment ${s.shipmentId}` : 'Shipment'; }
    if (rt === 'payment') { const p = state.data.payments.find(x => x.id === rid); return p ? `RFP ${p.rfpRef}` : 'Payment'; }
    if (rt === 'supplier') { const s = state.data.suppliers.find(x => x.id === rid); return s ? (s.name||'Supplier') : 'Supplier'; }
    return rt || '—';
  }
  function relatedOpen(rt, rid) {
    const fn = { order:'openOrderDetail', shipment:'openShipmentDetail', payment:'openPaymentDetail', supplier:'openSupplierDetail' }[rt];
    return fn ? `onclick="${fn}('${rid}')" style="cursor:pointer"` : '';
  }
  function daysUntil(d) {
    if (!d) return null;
    const dt = d.toDate ? d.toDate() : new Date(d);
    if (isNaN(dt)) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    return Math.round((dt - today)/86400000);
  }
  const officerName = c => { const o = state.data.officers.find(x=>x.code===c); return o?.fullName || c || '—'; };

  function buildOperationalReports() {
    // Resolve the entity of an operational record's parent (order/shipment/payment/supplier).
    // Suppliers are shared across entities, so supplier-related items are always included.
    const parentEntity = (relatedType, relatedId) => {
      if (relatedType === 'order')    { const o = state.data.orders.find(x => x.id === relatedId); return o ? recordEntity(o) : null; }
      if (relatedType === 'shipment') { const s = state.data.shipments.find(x => x.id === relatedId); return s ? recordEntity(s) : null; }
      if (relatedType === 'payment')  { const p = state.data.payments.find(x => x.id === relatedId); return p ? recordEntity(p) : null; }
      return 'shared'; // suppliers / unknown → not entity-specific
    };
    const inEntity = r => { const e = parentEntity(r.relatedType, r.relatedId); return e === 'shared' || e === repEnt; };
    const docs = state.data.documents.filter(d => !d.archived && inEntity(d));
    const fus  = state.data.followups.filter(f => !f.archived && inEntity(f));
    const iss  = state.data.issues.filter(i => !i.archived && inEntity(i));

    // --- Documents: missing required, requested-not-received, rejected, expiring, expired ---
    const expiry = d => window.__docExpiryInfo ? window.__docExpiryInfo(d) : null;
    const docRequestedNotReceived = docs.filter(d => d.status === 'requested');
    const docRejected = docs.filter(d => d.status === 'rejected');
    const docExpiringSoon = docs.filter(d => { const e = expiry(d); return e && e.state === 'soon'; });
    const docExpired = docs.filter(d => { const e = expiry(d); return e && e.state === 'expired'; });
    const docPresent = d => window.PXDocuments ? window.PXDocuments.isPresent(d) : (['received', 'approved'].includes(d.status) || d.fileData || d.documentUrl || d.url || d.link);
    // Missing required: across all parent records, compare expectedDocuments vs present
    const missingRequired = [];
    const entOrders = state.data.orders.filter(o => recordEntity(o) === repEnt);
    const entShips  = state.data.shipments.filter(s => recordEntity(s) === repEnt);
    const entPays   = state.data.payments.filter(p => recordEntity(p) === repEnt);
    [['order', entOrders, 'orderId'], ['shipment', entShips, 'shipmentId'], ['payment', entPays, 'rfpRef'], ['supplier', state.data.suppliers, 'name']]
      .forEach(([rt, list]) => {
        list.forEach(rec => {
          const expected = window.PXUtils.expectedDocsFor ? window.PXUtils.expectedDocsFor(rt, rec) : ((REF.expectedDocuments && REF.expectedDocuments[rt]) || []);
          if (!expected.length) return;
          const present = docs.filter(d => d.relatedType === rt && d.relatedId === rec.id && docPresent(d)).map(d => d.documentType);
          expected.forEach(t => { if (!present.includes(t)) missingRequired.push({ rt, rid: rec.id, documentType: t }); });
        });
      });

    const docRow = (d, extra) => `<tr ${relatedOpen(d.relatedType, d.relatedId)}>
      <td>${escapeHtml(relatedLabel(d.relatedType, d.relatedId))}</td>
      <td>${escapeHtml(d.documentType||'—')}</td>
      <td><span class="badge ${badgeForDocStatus(d.status)}">${escapeHtml(d.status||'—')}</span></td>
      <td>${escapeHtml(d.addedBy||d.updatedBy||'—')}</td>
      <td>${d.expiryDate?fmtDate(d.expiryDate):'—'}</td>
      ${extra||''}
    </tr>`;

    const docReportsHtml = `
      <h2 style="margin:28px 0 12px">Document Reports</h2>
      <div class="rep-grid">
        ${opReportCard('Missing Required Documents', missingRequired.length, missingRequired.length ?
          `<table class="data"><thead><tr><th>Record</th><th>Expected Document</th></tr></thead><tbody>${
            missingRequired.slice(0,200).map(m => `<tr ${relatedOpen(m.rt, m.rid)}><td>${escapeHtml(relatedLabel(m.rt, m.rid))}</td><td>${escapeHtml(m.documentType)} <span class="doc-req">REQ</span></td></tr>`).join('')
          }</tbody></table>` : null)}
        ${opReportCard('Requested — Not Yet Received', docRequestedNotReceived.length, docRequestedNotReceived.length ?
          `<table class="data"><thead><tr><th>Record</th><th>Type</th><th>Status</th><th>Officer</th><th>Expiry</th></tr></thead><tbody>${docRequestedNotReceived.map(d=>docRow(d)).join('')}</tbody></table>` : null)}
        ${opReportCard('Rejected Documents', docRejected.length, docRejected.length ?
          `<table class="data"><thead><tr><th>Record</th><th>Type</th><th>Status</th><th>Officer</th><th>Expiry</th></tr></thead><tbody>${docRejected.map(d=>docRow(d, `<td class="text-xs" style="color:var(--danger)">${escapeHtml(d.rejectedReason||'')}</td>`)).join('')}</tbody></table>` : null)}
        ${opReportCard('Expiring Soon', docExpiringSoon.length, docExpiringSoon.length ?
          `<table class="data"><thead><tr><th>Record</th><th>Type</th><th>Status</th><th>Officer</th><th>Expiry</th></tr></thead><tbody>${docExpiringSoon.map(d=>docRow(d)).join('')}</tbody></table>` : null)}
        ${opReportCard('Expired', docExpired.length, docExpired.length ?
          `<table class="data"><thead><tr><th>Record</th><th>Type</th><th>Status</th><th>Officer</th><th>Expiry</th></tr></thead><tbody>${docExpired.map(d=>docRow(d)).join('')}</tbody></table>` : null)}
      </div>`;

    // --- Follow-ups: open, overdue, due soon, by officer, (completed hidden) ---
    const fuOpen = fus.filter(f => f.status === 'open');
    const fuOverdue = fuOpen.filter(f => { const dd = daysUntil(f.nextActionDueDate); return dd !== null && dd < 0; });
    const fuDueSoon = fuOpen.filter(f => { const dd = daysUntil(f.nextActionDueDate); return dd !== null && dd >= 0 && dd <= 7; });
    const fuByOfficer = {};
    fuOpen.forEach(f => { const k = f.assignedTo || f.officer || '—'; (fuByOfficer[k] = fuByOfficer[k] || []).push(f); });

    const fuRow = f => `<tr ${relatedOpen(f.relatedType, f.relatedId)}>
      <td>${escapeHtml(relatedLabel(f.relatedType, f.relatedId))}</td>
      <td class="truncate" title="${escapeHtml(f.comment||'')}" style="max-width:220px">${escapeHtml(f.comment||'—')}</td>
      <td>${escapeHtml(f.nextAction||'—')}</td>
      <td>${f.nextActionDueDate?fmtDate(f.nextActionDueDate):'—'}</td>
      <td>${escapeHtml(officerName(f.assignedTo)||'—')}</td>
      <td><span class="badge ${f.status==='open'?'accent':'success'}">${escapeHtml(f.status||'—')}</span></td>
    </tr>`;
    const fuHead = `<thead><tr><th>Record</th><th>Comment</th><th>Next Action</th><th>Due</th><th>Assigned</th><th>Status</th></tr></thead>`;

    const fuReportsHtml = `
      <h2 style="margin:28px 0 12px">Follow-up Reports</h2>
      <div class="rep-grid">
        ${opReportCard('Overdue Follow-ups', fuOverdue.length, fuOverdue.length ? `<table class="data">${fuHead}<tbody>${fuOverdue.map(fuRow).join('')}</tbody></table>` : null)}
        ${opReportCard('Due Soon (7 days)', fuDueSoon.length, fuDueSoon.length ? `<table class="data">${fuHead}<tbody>${fuDueSoon.map(fuRow).join('')}</tbody></table>` : null)}
        ${opReportCard('All Open Follow-ups', fuOpen.length, fuOpen.length ? `<table class="data">${fuHead}<tbody>${fuOpen.map(fuRow).join('')}</tbody></table>` : null)}
        ${opReportCard('Open Follow-ups by Officer', Object.keys(fuByOfficer).length,
          Object.keys(fuByOfficer).length ? `<table class="data"><thead><tr><th>Officer</th><th class="num">Open</th></tr></thead><tbody>${
            Object.entries(fuByOfficer).sort((a,b)=>b[1].length-a[1].length).map(([k,v])=>`<tr><td>${escapeHtml(officerName(k))}</td><td class="num">${v.length}</td></tr>`).join('')
          }</tbody></table>` : null)}
      </div>`;

    // --- Issues: open, overdue, ageing, by category/severity/party/supplier/owner/type/entity ---
    const isOpen = iss.filter(i => i.status === 'open');
    const longRunning = isOpen.filter(i => { const dd = daysUntil(i.openedDate); return dd !== null && dd <= -14; }); // open >14d
    const overdueIssues = isOpen.filter(i => { const t = daysUntil(i.targetResolutionDate); return t !== null && t < 0; });
    const ageOf = i => { const dd = daysUntil(i.openedDate); return dd === null ? null : Math.abs(dd); };
    const supplierForIssue = i => {
      let oid = i.orderId || (i.relatedType === 'order' ? (state.data.orders.find(o => o.id === i.relatedId)?.orderId) : null);
      if (!oid && i.relatedType === 'shipment') { const s = state.data.shipments.find(x => x.id === i.relatedId); oid = s?.orderId; }
      if (oid) { const o = state.data.orders.find(o => o.orderId === oid); if (o) return o.supplier || '—'; }
      return '—';
    };
    const groupCount = (list, keyFn) => { const m = {}; list.forEach(x => { const k = keyFn(x) || '—'; m[k] = (m[k] || 0) + 1; }); return m; };
    const isByOwner = groupCount(isOpen, i => i.owner);
    const isByType = groupCount(isOpen, i => i.issueType);
    const isByCategory = groupCount(isOpen, i => i.issueCategory);
    const isBySeverity = groupCount(isOpen, i => i.severity);
    const isByParty = groupCount(isOpen, i => i.responsibleParty);
    const isBySupplier = groupCount(isOpen, supplierForIssue);
    const ageBuckets = { '0–7 days': 0, '8–14 days': 0, '15–30 days': 0, '30+ days': 0 };
    isOpen.forEach(i => { const a = ageOf(i); if (a === null) return; if (a <= 7) ageBuckets['0–7 days']++; else if (a <= 14) ageBuckets['8–14 days']++; else if (a <= 30) ageBuckets['15–30 days']++; else ageBuckets['30+ days']++; });
    // By entity — portfolio counts across ALL entities (aggregate only; no cross-entity record detail).
    const allOpenIssues = state.data.issues.filter(i => !i.archived && i.status === 'open');
    const isByEntity = groupCount(allOpenIssues, i => { const e = parentEntity(i.relatedType, i.relatedId); return (e === 'shared' || !e) ? '(shared / unknown)' : e; });

    const isRow = i => { const t = daysUntil(i.targetResolutionDate); const od = t !== null && t < 0;
      return `<tr ${relatedOpen(i.relatedType, i.relatedId)}>
      <td>${escapeHtml(relatedLabel(i.relatedType, i.relatedId))}</td>
      <td>${escapeHtml(i.issueType||'—')}</td>
      <td>${escapeHtml(i.severity||'—')}</td>
      <td>${escapeHtml(i.owner||'—')}</td>
      <td>${fmtDate(i.openedDate)||'—'}</td>
      <td>${i.targetResolutionDate ? (od ? `<span style="color:var(--danger)">${fmtDate(i.targetResolutionDate)} (overdue)</span>` : fmtDate(i.targetResolutionDate)) : '—'}</td>
      <td><span class="badge ${i.status==='open'?'danger':'success'}">${escapeHtml(i.status||'—')}</span></td>
      <td class="truncate" title="${escapeHtml(i.actionNotes||'')}" style="max-width:180px">${escapeHtml(i.actionNotes||'—')}</td>
    </tr>`; };
    const isHead = `<thead><tr><th>Record</th><th>Type</th><th>Severity</th><th>Owner</th><th>Opened</th><th>Target</th><th>Status</th><th>Action Notes</th></tr></thead>`;
    const countCard = (title, mapObj, keyLabel) => opReportCard(title, Object.keys(mapObj).length,
      Object.keys(mapObj).length ? `<table class="data"><thead><tr><th>${keyLabel}</th><th class="num">Open</th></tr></thead><tbody>${
        Object.entries(mapObj).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`<tr><td>${escapeHtml(k)}</td><td class="num">${n}</td></tr>`).join('')}</tbody></table>` : null);

    const isReportsHtml = `
      <h2 style="margin:28px 0 12px">Issue Reports</h2>
      <div class="rep-grid">
        ${opReportCard('Open Issues', isOpen.length, isOpen.length ? `<table class="data">${isHead}<tbody>${isOpen.map(isRow).join('')}</tbody></table>` : null)}
        ${opReportCard('Overdue Resolution', overdueIssues.length, overdueIssues.length ? `<table class="data">${isHead}<tbody>${overdueIssues.map(isRow).join('')}</tbody></table>` : null)}
        ${opReportCard('Long-Running (open &gt; 14 days)', longRunning.length, longRunning.length ? `<table class="data">${isHead}<tbody>${longRunning.map(isRow).join('')}</tbody></table>` : null)}
        ${countCard('Issue Ageing', ageBuckets, 'Age bucket')}
        ${countCard('Open Issues by Category', isByCategory, 'Category')}
        ${countCard('Open Issues by Severity', isBySeverity, 'Severity')}
        ${countCard('Open Issues by Responsible Party', isByParty, 'Party')}
        ${countCard('Open Issues by Supplier', isBySupplier, 'Supplier')}
        ${countCard('Open Issues by Owner', isByOwner, 'Owner')}
        ${countCard('Open Issues by Type', isByType, 'Type')}
        ${countCard('Open Issues by Entity (all entities)', isByEntity, 'Entity')}
      </div>`;

    // --- PO Line Fulfilment (Increment 1) ---
    const lineRows = [];
    entOrders.forEach(o => {
      if (!window.PXLineFulfilment) return;
      const lf = window.PXLineFulfilment.forOrder(o);
      if (lf.hasLines) lf.lines.forEach(l => lineRows.push({ o, l }));
    });
    const openL = lineRows.filter(x => x.l.open);
    const overdueL = openL.filter(x => x.l.expectedDeliveryDate && daysUntil(x.l.expectedDeliveryDate) < 0);
    const overRecL = lineRows.filter(x => x.l.warnings.some(w => w.level === 'error'));
    const partL = lineRows.filter(x => x.l.status === 'part received');
    const lHead = `<thead><tr><th>PO</th><th>Line</th><th>Item</th><th class="num">Ord</th><th class="num">Rcvd</th><th class="num">Remain</th><th>Status</th><th>Expected</th></tr></thead>`;
    const lRow = x => `<tr onclick="${relatedOpen('order', x.o.id)}" style="cursor:pointer">
      <td>${escapeHtml(x.o.orderId || '')}</td><td class="mono">${escapeHtml(String(x.l.lineNo != null ? x.l.lineNo : x.l.key))}</td>
      <td class="truncate" style="max-width:200px">${escapeHtml(x.l.description || x.l.itemNumber || '—')}</td>
      <td class="num">${x.l.ordered}</td><td class="num">${x.l.received}</td>
      <td class="num">${x.l.remaining}</td><td><span class="badge ${x.l.status === 'received' ? 'success' : (x.l.status === 'part received' ? 'warn' : 'neutral')}">${x.l.status}</span></td>
      <td>${x.l.expectedDeliveryDate ? fmtDate(x.l.expectedDeliveryDate) : '—'}</td></tr>`;
    const lineReportsHtml = `
      <h2 style="margin:28px 0 12px">PO Line Fulfilment</h2>
      <div class="rep-grid">
        ${opReportCard('Open Lines', openL.length, openL.length ? `<table class="data">${lHead}<tbody>${openL.map(lRow).join('')}</tbody></table>` : null)}
        ${opReportCard('Open Lines Past Expected Date', overdueL.length, overdueL.length ? `<table class="data">${lHead}<tbody>${overdueL.map(lRow).join('')}</tbody></table>` : null)}
        ${opReportCard('Over-Receipt (needs exception)', overRecL.length, overRecL.length ? `<table class="data">${lHead}<tbody>${overRecL.map(lRow).join('')}</tbody></table>` : null)}
        ${opReportCard('Part-Received Lines', partL.length, partL.length ? `<table class="data">${lHead}<tbody>${partL.map(lRow).join('')}</tbody></table>` : null)}
      </div>`;

    return docReportsHtml + fuReportsHtml + isReportsHtml + lineReportsHtml;
  }
  function opReportCard(title, count, tableHtml) {
    return `<div class="card rep-card">
      <div class="rep-card-head"><span>${title}</span><span class="rep-card-count ${count>0?'has':''}">${count}</span></div>
      ${count > 0 ? `<div class="rep-card-body">${tableHtml}</div>` : '<div class="rep-card-empty">None ✓</div>'}
    </div>`;
  }

  function buildProcurementFollowupReports() {
    if (!procDash) return '';
    const highRisk = procDash.topRisk.filter(r => ['high', 'critical'].includes(r.risk.level));
    const chaseDue = procDash.rows.filter(r => r.chase.overdue || r.chase.dueSoon)
      .sort((a, b) => (a.chase.daysUntil ?? 99) - (b.chase.daysUntil ?? 99));
    const promiseOverdue = procDash.promiseOverdue
      .sort((a, b) => (a.commitment.daysUntil ?? 0) - (b.commitment.daysUntil ?? 0));
    const erpExceptions = procDash.erpExceptionRows;
    const bucketRows = procDash.buckets;
    const riskHead = '<thead><tr><th>Order</th><th>Supplier</th><th>Risk</th><th>Ageing</th><th>Reason</th></tr></thead>';
    const riskRow = r => `<tr onclick="openOrderDetail('${r.order.id}')">
      <td><span class="mono">${escapeHtml(r.order.orderId || '—')}</span></td>
      <td class="truncate">${escapeHtml(r.order.supplier || '—')}</td>
      <td><span class="badge ${r.risk.cls}">${escapeHtml(r.risk.level)} ${r.risk.score}</span></td>
      <td>${escapeHtml(r.bucket.label)}</td>
      <td class="text-xs truncate" title="${escapeHtml(r.risk.reasons.join('; '))}">${escapeHtml(r.risk.reasons[0] || '—')}</td>
    </tr>`;
    const chaseHead = '<thead><tr><th>Next</th><th>Order</th><th>Supplier</th><th>Method</th><th>Commitment</th></tr></thead>';
    const chaseRow = r => `<tr onclick="openOrderDetail('${r.order.id}')">
      <td style="${r.chase.overdue ? 'color:var(--danger);font-weight:600' : ''}">${r.chase.next ? fmtDate(r.chase.next) : '—'}</td>
      <td><span class="mono">${escapeHtml(r.order.orderId || '—')}</span></td>
      <td class="truncate">${escapeHtml(r.order.supplier || '—')}</td>
      <td>${escapeHtml(r.chase.method || '—')}</td>
      <td style="${r.commitment.overdue ? 'color:var(--danger);font-weight:600' : ''}">${r.commitment.current ? fmtDate(r.commitment.current) : '—'}</td>
    </tr>`;
    const exHead = '<thead><tr><th>Order</th><th>Supplier</th><th>Exception</th></tr></thead>';
    const exRows = erpExceptions.flatMap(r => r.erp.map(e => ({ ...r, exception: e })));
    const exRow = r => `<tr onclick="openOrderDetail('${r.order.id}')">
      <td><span class="mono">${escapeHtml(r.order.orderId || '—')}</span></td>
      <td class="truncate">${escapeHtml(r.order.supplier || '—')}</td>
      <td><span class="badge ${r.exception.level}">${escapeHtml(r.exception.level)}</span> ${escapeHtml(r.exception.msg)}</td>
    </tr>`;
    return `
      <h2 style="margin:28px 0 12px">Procurement Follow-up Control</h2>
      <p class="text-sm text-muted" style="margin:-4px 0 12px">Covers the 15 daily controls: ${window.PXProcFollowup.CONTROL_LABELS.map(escapeHtml).join(' · ')}</p>
      <div class="metric-grid" style="margin-bottom:14px">
        <div class="metric ${highRisk.length?'warn':'success'}"><div class="label">High / Critical Risk</div><div class="value">${highRisk.length}</div></div>
        <div class="metric ${chaseDue.length?'warn':'success'}"><div class="label">Supplier Follow-ups Due</div><div class="value">${chaseDue.length}</div></div>
        <div class="metric ${promiseOverdue.length?'danger':'success'}"><div class="label">Promise Overdue</div><div class="value">${promiseOverdue.length}</div></div>
        <div class="metric ${erpExceptions.length?'warn':'success'}"><div class="label">ERP/DW Exceptions</div><div class="value">${erpExceptions.length}</div></div>
      </div>
      <div class="rep-grid">
        ${opReportCard('High / Critical Risk Orders', highRisk.length, highRisk.length ? `<table class="data">${riskHead}<tbody>${highRisk.map(riskRow).join('')}</tbody></table>` : null)}
        ${opReportCard('Supplier Follow-ups Due', chaseDue.length, chaseDue.length ? `<table class="data">${chaseHead}<tbody>${chaseDue.map(chaseRow).join('')}</tbody></table>` : null)}
        ${opReportCard('Supplier Promise Overdue', promiseOverdue.length, promiseOverdue.length ? `<table class="data">${chaseHead}<tbody>${promiseOverdue.map(chaseRow).join('')}</tbody></table>` : null)}
        ${opReportCard('ERP / Data Warehouse Exceptions', exRows.length, exRows.length ? `<table class="data">${exHead}<tbody>${exRows.map(exRow).join('')}</tbody></table>` : null)}
        ${opReportCard('Order Ageing Buckets', bucketRows.length, bucketRows.length ? `<table class="data"><thead><tr><th>Bucket</th><th class="num">Open Orders</th></tr></thead><tbody>${bucketRows.map(b => `<tr><td>${escapeHtml(b.label)}</td><td class="num">${b.count}</td></tr>`).join('')}</tbody></table>` : null)}
      </div>`;
  }

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title"><h1>Reports &amp; Export</h1><span class="desc">Detailed records with custom columns, plus pre-built summaries below</span></div>
      <div class="page-actions">
        <div class="col-mgr"><button class="btn" id="rep-col-btn">⚙ Columns</button></div>
        <button class="btn btn-primary" id="rep-export-btn">⤓ Export Excel (current view)</button>
        <button class="btn" id="rep-backup-btn">💾 Backup All</button>
      </div>
    </div>

    <div class="toolbar" style="flex-wrap:wrap;gap:8px">
      <span class="report-entity-tag" title="Reports follow the entity selected in the sidebar">${(() => { const m = entityMeta(repEnt); return `<span class="entity-badge" style="background:${m.accent};color:#fff">${m.short}</span> ${escapeHtml(m.code || repEnt)}`; })()}</span>
      <select id="rf-type">
        <option value="">All orders</option>
        <option value="foreign" ${rf.orderType==='foreign'?'selected':''}>Foreign only</option>
        <option value="local" ${rf.orderType==='local'?'selected':''}>Local only</option>
      </select>
      <select id="rf-function">
        <option value="">All functions</option>
        <option value="technical" ${rf.function==='technical'?'selected':''}>Technical</option>
        <option value="indirect" ${rf.function==='indirect'?'selected':''}>Indirect</option>
        <option value="supplychain" ${rf.function==='supplychain'?'selected':''}>Supply Chain</option>
      </select>
      <select id="rf-officer">
        <option value="">All officers</option>
        ${[...new Set(state.data.orders.map(o => o.officerCode).filter(Boolean))].sort().map(o => `<option value="${escapeHtml(o)}" ${rf.officer===o?'selected':''}>${escapeHtml(o)}</option>`).join('')}
      </select>
      <select id="rf-supplier">
        <option value="">All suppliers</option>
        ${[...new Set(state.data.orders.map(o => o.supplier).filter(Boolean))].sort().map(s => `<option value="${escapeHtml(s)}" ${rf.supplier===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}
      </select>
      <select id="rf-currency">
        <option value="">All currencies</option>
        ${[...new Set(state.data.orders.map(o => o.currency).filter(Boolean))].sort().map(c => `<option value="${escapeHtml(c)}" ${rf.currency===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}
      </select>
      <label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:4px">From <input type="date" id="rf-from" value="${rf.dateFrom||''}" style="width:auto" /></label>
      <label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:4px">To <input type="date" id="rf-to" value="${rf.dateTo||''}" style="width:auto" /></label>
      ${rAnyFilter ? '<button class="btn btn-sm" id="rf-clear">Clear filters</button>' : ''}
    </div>

    <div class="toolbar">
      <select id="rep-dataset">
        <option value="orders" ${repFilters.dataset==='orders'?'selected':''}>All Orders</option>
        <option value="shipments" ${repFilters.dataset==='shipments'?'selected':''}>All Shipments</option>
        <option value="payments" ${repFilters.dataset==='payments'?'selected':''}>All Payment Requests</option>
        <option value="update_requests" ${repFilters.dataset==='update_requests'?'selected':''}>Update Requests</option>
        <option value="contact_log" ${repFilters.dataset==='contact_log'?'selected':''}>Contact Logs</option>
        <option value="kpi_snapshot" ${repFilters.dataset==='kpi_snapshot'?'selected':''}>KPI Snapshots</option>
      </select>
      <div class="search"><input type="search" placeholder="Search across all fields…" id="rep-search" value="${escapeHtml(repFilters.search)}" /></div>
      <div class="filter-count">${dsRows.length}</div>
    </div>
    ${cmRenderTable(storageKey, ds.defs, dsRows, {}, {
      onRowClick: ds.onRowClick,
      idField: 'id',
      emptyHtml: '<tr><td colspan="99" class="empty-state"><div class="ic">📊</div><h3>No records</h3></td></tr>'
    })}

    ${buildProcurementFollowupReports()}

    <h2 style="margin: 28px 0 12px">Open Orders — Value by Currency</h2>
    <div class="card">
      <table class="data">
        <thead><tr><th>Currency</th><th class="num">Open Order Value</th></tr></thead>
        <tbody>
          ${Object.entries(totalsByCurrency).sort((a,b) => b[1]-a[1]).map(([c, v]) => `
            <tr><td><span class="mono" style="font-weight:600">${c}</span></td><td class="num">${fmtMoney(v, c)}</td></tr>
          `).join('') || '<tr><td colspan="2" class="text-muted text-sm">No open orders.</td></tr>'}
        </tbody>
      </table>
    </div>

    <h2 style="margin: 24px 0 12px">Top Suppliers by Open Order Count</h2>
    <div class="card">
      <table class="data">
        <thead><tr><th>Rank</th><th>Supplier</th><th class="num">Open Orders</th></tr></thead>
        <tbody>
          ${topSup.map(([s, c], i) => `
            <tr><td><span class="mono">${i+1}</span></td><td>${escapeHtml(s)}</td><td class="num">${c}</td></tr>
          `).join('') || '<tr><td colspan="3" class="text-muted text-sm">—</td></tr>'}
        </tbody>
      </table>
    </div>

    <h2 style="margin: 24px 0 12px">Category Mix</h2>
    <div class="card">
      <table class="data">
        <thead><tr><th>Category</th><th class="num">Open Orders</th></tr></thead>
        <tbody>
          ${Object.entries(byCategory).sort((a,b) => b[1]-a[1]).map(([c, v]) => `
            <tr><td>${escapeHtml(c)}</td><td class="num">${v}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <h2 style="margin: 24px 0 12px">KPI Breaches</h2>
    <div class="metric-grid">
      <div class="metric ${otifBreaches > 0 ? 'warn' : 'success'}">
        <div class="label">OTIF Breaches (&gt; 10 days)</div>
        <div class="value">${otifBreaches}</div>
        <div class="delta">shipments where GRN exceeded ETA by &gt; 10 days</div>
      </div>
      <div class="metric ${clrBreaches > 0 ? 'warn' : 'success'}">
        <div class="label">Clearance Breaches (&gt; 3 days)</div>
        <div class="value">${clrBreaches}</div>
        <div class="delta">where clearance took &gt; 3 days from docs-to-broker</div>
      </div>
    </div>

    ${buildOperationalReports()}
  `;

  $('#rep-dataset').addEventListener('change', e => { repFilters.dataset = e.target.value; window.__renderers['reports'](); });
  window.PXUtils.bindSearchInput('#rep-search', {
    key: 'reports-search',
    setValue: value => { repFilters.search = value; },
    render: () => window.__renderers['reports']()
  });
  $('#rep-col-btn').addEventListener('click', e => cmOpenManager(storageKey, ds.defs, e.target, () => window.__renderers['reports']()));
  $('#rep-export-btn').addEventListener('click', () => cmExportCSV(storageKey, ds.defs, dsRows, repFilters.dataset, {}));
  // Dimension filter events (entity comes from the sidebar switcher, not a dropdown here)
  const rRe = () => window.__renderers['reports']();
  $('#rf-type').addEventListener('change', e => { rf.orderType = e.target.value; rRe(); });
  $('#rf-function').addEventListener('change', e => { rf.function = e.target.value; rRe(); });
  $('#rf-officer').addEventListener('change', e => { rf.officer = e.target.value; rRe(); });
  $('#rf-supplier').addEventListener('change', e => { rf.supplier = e.target.value; rRe(); });
  $('#rf-currency').addEventListener('change', e => { rf.currency = e.target.value; rRe(); });
  $('#rf-from').addEventListener('change', e => { rf.dateFrom = e.target.value; rRe(); });
  $('#rf-to').addEventListener('change', e => { rf.dateTo = e.target.value; rRe(); });
  const rfClr = $('#rf-clear');
  if (rfClr) rfClr.addEventListener('click', () => { ['orderType','function','officer','supplier','currency','dateFrom','dateTo'].forEach(k => rf[k]=''); rRe(); });
  $('#rep-backup-btn').addEventListener('click', () => openBackupDialog());
};

/* ============================================================
   BACKUP / EXPORT ALL — orders, shipments, payments, suppliers,
   officers, status_log → JSON or CSV (one CSV per collection).
============================================================ */

window.__renderers['erprecon'] = function() {
  const viewEl = $('#view-erprecon');
  const orders = state.data.orders;

  const erpOrders = orders.filter(o => isErpOrder(o));
  const manualOrders = orders.filter(o => !isErpOrder(o));
  const syncErrors = erpOrders.filter(o => o.erpSyncStatus === 'error');
  const warehouseBacked = erpOrders.filter(o => window.PXWarehouse && window.PXWarehouse.isWarehouseBacked(o));
  const excelFeedOrders = erpOrders.filter(o => o.integrationLayer === 'excel-import');
  // Status divergence: ERP says closed, Phoenix open (and vice versa) — uses erpPoStatus if present
  const erpClosedPhoenixOpen = erpOrders.filter(o => (o.erpPoStatus === 'Closed' || o.erpPoStatus === 'Cancelled') && !o.isClosed);
  const phoenixClosedErpOpen = erpOrders.filter(o => o.isClosed && o.erpPoStatus && !['Closed','Cancelled'].includes(o.erpPoStatus));
  // Field mismatches are only meaningful if the staging/sync service stores the ERP-side value separately.
  // Until that feed is connected, these lists stay empty by design.
  const supplierMismatch = erpOrders.filter(o => o.erpVendorName && o.supplier && o.erpVendorName !== o.supplier);
  const amountMismatch = erpOrders.filter(o => o.erpAmount != null && o.amount != null && Number(o.erpAmount) !== Number(o.amount));
  const currencyMismatch = erpOrders.filter(o => o.erpCurrency && o.currency && o.erpCurrency !== o.currency);
  // Orders where the last warehouse refresh CHANGED a key field (Amount/Currency/Requested
  // Receipt Date). Cleared each import — shows only the most recent refresh's changes.
  const refreshChanged = erpOrders.filter(o => Array.isArray(o.lastRefreshChanges) && o.lastRefreshChanges.length);
  const procurementExceptions = window.PXProcFollowup
    ? erpOrders.map(o => ({ order: o, exceptions: window.PXProcFollowup.erpExceptions(o) })).filter(x => x.exceptions.length)
    : [];
  const demoMode = !!(window.__isDemoMode && window.__isDemoMode());

  const lastSync = erpOrders.map(o => o.erpLastSyncedAt?.toDate ? o.erpLastSyncedAt.toDate() : (o.erpLastSyncedAt ? new Date(o.erpLastSyncedAt) : null)).filter(Boolean).sort((a,b)=>b-a)[0];

  const card = (title, rows, desc, rowFn, headers, cap = 5) => {
    const shown = rows.slice(0, cap);
    const extra = rows.length - shown.length;
    return `
    <div class="card" style="margin-bottom:14px">
      <div class="card-head" style="margin-bottom:8px"><h3>${title} <span class="text-muted" style="font-size:13px;font-weight:400">(${rows.length})</span></h3></div>
      ${desc ? `<p class="text-xs text-muted" style="margin-bottom:8px">${desc}</p>` : ''}
      ${rows.length ? `<div class="table-wrap"><table class="data">
        <thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${shown.map(rowFn).join('')}</tbody></table></div>`
      : '<p class="text-sm" style="color:var(--success)">✓ None</p>'}
    </div>`;
  };

  const orderRow = o => `<tr onclick="openOrderDetail('${o.id}')">
    <td><span class="mono">${escapeHtml(o.orderId||'—')}</span></td>
    <td class="truncate">${escapeHtml(o.supplier||'—')}</td>
    <td>${fmtMoney(o.amount,o.currency)}</td>
    <td>${isErpOrder(o)?renderErpBadge(o,true):'Manual'}</td>
  </tr>`;
  const procExceptionRow = x => `<tr onclick="openOrderDetail('${x.order.id}')">
    <td><span class="mono">${escapeHtml(x.order.orderId||'—')}</span></td>
    <td class="truncate">${escapeHtml(x.order.supplier||'—')}</td>
    <td>${x.exceptions.map(e => `<div><span class="badge ${e.level}" style="font-size:10px">${escapeHtml(e.level)}</span> ${escapeHtml(e.msg)}</div>`).join('')}</td>
    <td>${isErpOrder(x.order)?renderErpBadge(x.order,true):'Manual'}</td>
  </tr>`;

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title"><h1>ERP Reconciliation</h1>
        <span class="desc">Mismatches & sync health between Phoenix and the ERP/Data Warehouse feed</span></div>
      <div class="page-actions">
        <button class="btn btn-primary" id="erp-import-btn" title="Import open Purchase Orders from the Navision/BC Excel export (manual staging feed until the Data Warehouse sync is live)">⬆ Import POs from Excel</button>
        <input type="file" id="erp-import-file" accept=".xlsx" style="display:none" />
        <button class="btn" id="erp-statusmig-btn" title="One-off: import the old workbook's free-text STATUS history as follow-up notes on matching orders">⬆ Migrate legacy status log</button>
        <input type="file" id="erp-statusmig-file" accept=".xlsm,.xlsx" style="display:none" />
        ${demoMode ? '<button class="btn" id="erp-demo-btn" title="Demo helper: creates one sample ERP-sourced order with lines so you can preview the ERP experience">+ Sample ERP order</button>' : ''}
        <button class="btn" id="erp-recon-btn">Run reconciliation</button>
      </div>
    </div>
    <div id="erp-import-panel"></div>
    ${window.PXImportHistory ? window.PXImportHistory.renderHistoryMarkup() : ''}
    <div id="erp-statusmig-panel"></div>

    <div class="card" style="margin-bottom:16px;background:#f5f9fd;border-left:3px solid #2b5d8a">
      <div style="font-size:13px;color:#2b5d8a">
        <strong>Phoenix is an operational control layer on top of the ERP.</strong><br>
        Recommended integration path: <strong>Navision / Business Central → Data Warehouse / staging → controlled sync/API service → Phoenix</strong>. The browser should not connect directly to either ERP or the warehouse.<br>
        ERP/warehouse data is read-only. Operational follow-up is managed in Phoenix.
        ${lastSync ? `<br><span class="text-xs">Last ERP/feed sync: ${fmtDate(lastSync)}</span>` : '<br><span class="text-xs">Data Warehouse sync is not connected yet. Use the Excel import as the controlled manual feed until the approved sync is live.</span>'}
      </div>
    </div>

    <div class="metric-grid" style="margin-bottom:18px">
      <div class="metric"><div class="label">ERP-linked orders</div><div class="value">${erpOrders.length}</div></div>
      <div class="metric"><div class="label">Warehouse-backed</div><div class="value">${warehouseBacked.length}</div></div>
      <div class="metric ${excelFeedOrders.length?'accent':''}"><div class="label">Excel feed</div><div class="value">${excelFeedOrders.length}</div></div>
      <div class="metric ${manualOrders.length?'accent':''}"><div class="label">Manual (not in ERP)</div><div class="value">${manualOrders.length}</div></div>
      <div class="metric ${syncErrors.length?'danger':'success'}"><div class="label">Sync errors</div><div class="value">${syncErrors.length}</div></div>
      <div class="metric ${(erpClosedPhoenixOpen.length+phoenixClosedErpOpen.length)?'warn':'success'}"><div class="label">Status divergences</div><div class="value">${erpClosedPhoenixOpen.length+phoenixClosedErpOpen.length}</div></div>
      <div class="metric ${procurementExceptions.length?'warn':'success'}"><div class="label">Procurement exceptions</div><div class="value">${procurementExceptions.length}</div></div>
    </div>

    ${card('Phoenix orders not linked to ERP', manualOrders,
      'Manually-created orders with no ERP counterpart. Once the Data Warehouse feed is connected, approved POs arrive through the staging layer and this list should shrink to genuine manual exceptions.',
      orderRow, ['Order','Supplier','Amount','Source'])}

    ${card('Sync errors', syncErrors,
      'ERP-linked orders whose last sync failed.', orderRow, ['Order','Supplier','Amount','Source'])}

    ${card('ERP closed · Phoenix still open', erpClosedPhoenixOpen,
      'The ERP marked the PO closed/cancelled but the Phoenix operational record is still open.', orderRow, ['Order','Supplier','Amount','Source'])}

    ${card('Procurement ERP/DW exceptions', procurementExceptions,
      'Computed from the procurement follow-up engine: stale sync, supplier mapping, ERP/Phoenix status divergence, amount/currency/supplier differences.',
      procExceptionRow, ['Order','Supplier','Exception','Source'], 8)}

    ${card('Phoenix closed · ERP still open', phoenixClosedErpOpen,
      'Phoenix closed the operational record but the ERP PO is still open.', orderRow, ['Order','Supplier','Amount','Source'])}

    ${card('Changed on last refresh', refreshChanged,
      'Key fields (Amount, Currency, Requested Receipt Date) the most recent warehouse refresh updated. The warehouse value applies; this list is for officer review and clears on the next import.',
      (o) => {
        const chg = (o.lastRefreshChanges || []).map(ch =>
          `${escapeHtml(ch.label)}: <span style="color:var(--muted)">${escapeHtml(String(ch.old ?? '—'))}</span> → <strong>${escapeHtml(String(ch.new ?? '—'))}</strong>`
        ).join('<br>');
        return `<tr onclick="window.openOrderDetail && window.openOrderDetail('${escapeHtml(o.orderId)}')" style="cursor:pointer">
          <td class="mono">${escapeHtml(o.orderId || '')}</td>
          <td class="truncate">${escapeHtml(o.supplier || '')}</td>
          <td>${chg}</td>
          <td>${o.lastRefreshAt ? fmtDate(o.lastRefreshAt) : '—'}</td></tr>`;
      },
      ['Order','Supplier','Change (old → new)','Refreshed'], 8)}

    ${card('Supplier mismatch', supplierMismatch, 'ERP vendor name differs from the Phoenix supplier value.', orderRow, ['Order','Supplier','Amount','Source'])}
    ${card('Amount mismatch', amountMismatch, 'ERP PO amount differs from the Phoenix amount.', orderRow, ['Order','Supplier','Amount','Source'])}
    ${card('Currency mismatch', currencyMismatch, 'ERP currency differs from the Phoenix currency.', orderRow, ['Order','Supplier','Amount','Source'])}

    ${(window.__isDemoMode && window.__isDemoMode() && REF.demoResetEnabled && window.PXUtils.currentRole() === 'admin') ? `
    <div class="card" style="margin-top:28px;border:1px solid #e0b4b0;border-left:4px solid var(--danger,#b3261e);background:#fdf6f5">
      <div class="card-head" style="margin-bottom:6px"><h3 style="color:var(--danger,#b3261e)">⚠ Danger Zone — Clear all data (demo only)</h3></div>
      <p class="text-sm" style="margin-bottom:10px">Permanently deletes <strong>all orders, shipments, payment requests, suppliers, documents, follow-ups, issues, update requests, contact logs, KPI snapshots and history</strong>, across <strong>all entities</strong>. Officers, roles and system settings are kept. This cannot be undone — use it only to reset an isolated <strong>demo</strong> database. A successful <strong>Backup All</strong> is required first, and this tool must be disabled (<code>REF.demoResetEnabled = false</code>) before pilot use.</p>
      <div id="erp-purge-panel"></div>
      <button class="btn" id="erp-purge-btn" style="border-color:var(--danger,#b3261e);color:var(--danger,#b3261e)">Clear all data…</button>
    </div>` : ''}
  `;

  if (window.PXImportHistory) window.PXImportHistory.bindHistoryActions(viewEl);

  // ---- Danger Zone: clear all data ----
  const purgeBtn = $('#erp-purge-btn');
  if (purgeBtn) purgeBtn.addEventListener('click', () => {
    const counts = window.__purgeCounts ? window.__purgeCounts() : { _total: 0 };
    const panel = $('#erp-purge-panel');
    panel.innerHTML = `
      <div class="card" style="margin-bottom:12px;background:#fff;border:1px solid #e0b4b0">
        <p class="text-sm" style="margin-bottom:8px">This will permanently delete <strong>${counts._total}</strong> record(s):
          orders ${counts.orders||0} · shipments ${counts.shipments||0} · payments ${counts.payment_requests||0} ·
          suppliers ${counts.suppliers||0} · documents ${counts.documents||0} · follow-ups ${counts.followups||0} ·
          issues ${counts.issues||0} · update requests ${counts.updateRequests||0} · contact logs ${counts.contactLog||0} ·
          KPI snapshots ${counts.kpiSnapshot||0} · history ${counts.status_log||0}.</p>
        <div id="erp-purge-backup-gate" style="margin-bottom:10px"></div>
        <p class="text-sm" style="margin-bottom:6px">Type <strong>DELETE ALL</strong> to confirm:</p>
        <input type="text" id="erp-purge-confirm" class="input" placeholder="DELETE ALL" style="max-width:220px;margin-bottom:10px" autocomplete="off" />
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-danger" id="erp-purge-go" disabled>Permanently delete</button>
          <button class="btn btn-ghost" id="erp-purge-cancel">Cancel</button>
          <span id="erp-purge-progress" class="text-sm text-muted"></span>
        </div>
      </div>`;
    const confirmInput = $('#erp-purge-confirm');
    const goBtn = $('#erp-purge-go');
    // Require a successful Backup All in this session before the purge can run.
    const renderBackupGate = () => {
      const gate = $('#erp-purge-backup-gate');
      if (!gate) return;
      if (window.__backupDoneAt) {
        gate.innerHTML = `<span class="text-sm" style="color:var(--success)">✓ Backup All completed this session (${new Date(window.__backupDoneAt).toLocaleTimeString()}).</span>`;
      } else {
        gate.innerHTML = `<div class="card" style="background:#fbf7ee;border-left:3px solid var(--warn,#9a5b00);padding:8px 12px">
          <p class="text-sm" style="margin:0 0 6px">⚠ A full <strong>Backup All</strong> export is required before clearing data.</p>
          <button class="btn btn-sm" id="erp-purge-backup">💾 Run Backup All now</button></div>`;
        const bkBtn = $('#erp-purge-backup');
        if (bkBtn) bkBtn.addEventListener('click', () => { if (window.openBackupDialog) window.openBackupDialog(); });
      }
    };
    renderBackupGate();
    const updateGo = () => { goBtn.disabled = (confirmInput.value.trim().toUpperCase() !== 'DELETE ALL') || !window.__backupDoneAt; };
    confirmInput.focus();
    confirmInput.addEventListener('input', updateGo);
    // Re-check the backup gate when focus returns (after the backup dialog/download).
    window.addEventListener('focus', () => { renderBackupGate(); updateGo(); });
    $('#erp-purge-cancel').addEventListener('click', () => { panel.innerHTML = ''; });
    goBtn.addEventListener('click', async () => {
      if (confirmInput.value.trim().toUpperCase() !== 'DELETE ALL') return;
      if (!window.__backupDoneAt) { if (toast) toast('Run Backup All first.', 'warning'); return; }
      const prog = $('#erp-purge-progress');
      goBtn.disabled = true; goBtn.textContent = 'Deleting…';
      const cancelBtn = $('#erp-purge-cancel'); cancelBtn.textContent = 'Stop'; cancelBtn.onclick = () => window.__purgeCancel && window.__purgeCancel();
      // Persistent, view-independent progress bar (stays visible across tab switches).
      if (window.PXProgress) window.PXProgress.start('Clearing all data', { onStop: () => window.__purgeCancel && window.__purgeCancel() });
      try {
        const res = await window.__purgeAllData({ onProgress: ({ done, total, failed }) => {
          const detail = failed ? failed + ' failed' : '';
          if (prog) prog.textContent = `${done} / ${total} deleted${failed ? ' · ' + failed + ' failed' : ''}`;
          if (window.PXProgress) window.PXProgress.update(done, total, detail);
        }});
        if (prog) prog.textContent = `Done: ${res.done} deleted${res.failed ? ', ' + res.failed + ' failed' : ''}${res.cancelled ? ' (stopped early)' : ''}.`;
        if (window.PXProgress) window.PXProgress.finish(`Cleared ${res.done} records${res.cancelled ? ' (stopped early)' : ''}`);
        goBtn.textContent = 'Cleared ✓';
        if (toast) toast(`Cleared ${res.done} records`, res.failed ? 'warning' : 'success');
        setTimeout(() => window.__renderers['erprecon'] && window.__renderers['erprecon'](), 1500);
      } catch (e) {
        if (prog) prog.textContent = 'Failed: ' + (e.message || e);
        if (window.PXProgress) window.PXProgress.finish('Clear failed: ' + (e.message || e));
        goBtn.disabled = false; goBtn.textContent = 'Permanently delete';
        if (toast) toast('Clear failed: ' + (e.message || e), 'danger');
      }
    });
  });

  $('#erp-recon-btn').addEventListener('click', async () => { await window.PhoenixERP.reconcileERPData(); window.__renderers['erprecon'](); });

  // ---- Import POs from Excel (manual staging feed) ----
  const importBtn = $('#erp-import-btn');
  const fileInput = $('#erp-import-file');
  const panel = $('#erp-import-panel');
  let importCancel = { cancelled: false };
  if (importBtn && fileInput) {
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      panel.innerHTML = `<div class="card" style="margin:14px 0"><div class="text-sm">Reading <strong>${escapeHtml(file.name)}</strong>…</div></div>`;
      try {
        const buf = await file.arrayBuffer();
        const wb = await window.PXXlsxReader.readWorkbook(buf);
        const { candidates, stats, warnings, errors } = window.PXPoImport.buildCandidates(wb);
        const { toCreate, toUpdate, conflicts } = window.PXPoImport.splitNewExisting(candidates);
        renderImportPreview(panel, { candidates, stats, toCreate, toUpdate, conflicts, warnings, errors,
          fileName: file.name, fileMeta: { name: file.name, size: file.size, lastModified: file.lastModified, sheetNames: wb.sheetNames || [] } });
      } catch (err) {
        console.error(err);
        panel.innerHTML = `<div class="card" style="margin:14px 0;border-left:3px solid var(--danger)"><strong>Could not read the file.</strong><div class="text-sm text-muted">${escapeHtml(err.message || String(err))}</div></div>`;
      }
      fileInput.value = ''; // allow re-selecting same file
    });
  }

  function renderImportPreview(panel, ctx) {
    const { stats, toCreate, toUpdate, candidates } = ctx;
    const warnings = ctx.warnings || { groupedPOs: 0, totalLineRows: 0, supplierMatches: {}, unmatchedSuppliers: [] };
    const supplierMatches = warnings.supplierMatches || {};
    const unmatchedSuppliers = warnings.unmatchedSuppliers || [];
    const conflicts = ctx.conflicts || [];
    const errors = ctx.errors || [];
    const sheetRow = (name, label) => {
      const s = stats[name]; if (!s) return '';
      const fn = s.byFn || {};
      return `<tr>
        <td>${label}</td>
        <td class="num">${s.classified}</td>
        <td class="num">${fn.technical||0}</td>
        <td class="num">${fn.indirect||0}</td>
        <td class="num">${fn.supplychain||0}</td>
        <td class="num text-muted">${s.skippedClosed}</td>
        <td class="num text-muted">${s.skippedUnmatched}</td>
      </tr>`;
    };
    panel.innerHTML = `
      <div class="card" style="margin:14px 0">
        <div class="card-head" style="margin-bottom:8px"><h3>Import preview — ${escapeHtml(ctx.fileName)}</h3></div>
        <p class="text-xs text-muted" style="margin-bottom:10px">Only OPEN POs are imported. Function and local-currency handling use the active ERP Import Rules; POs matching no function rule are skipped. Nothing is written until you click <strong>Commit import</strong>.</p>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Sheet</th><th class="num">To import</th><th class="num">Technical</th><th class="num">Indirect</th><th class="num">Supply Chain</th><th class="num">Skipped (closed)</th><th class="num">Skipped (unmatched)</th></tr></thead>
          <tbody>
            ${sheetRow('FPO','FPO — Phoenix foreign')}
            ${sheetRow('LPO','LPO — Phoenix local')}
            ${sheetRow('Seybrew','Seybrew — Seychelles')}
            ${sheetRow('Edena','Edena — Business Central')}
          </tbody>
        </table></div>
        <div class="metric-grid" style="margin:14px 0">
          <div class="metric success"><div class="label">New orders to create</div><div class="value">${toCreate.length}</div></div>
          <div class="metric accent"><div class="label">Existing to update (ERP fields)</div><div class="value">${toUpdate.length}</div></div>
          <div class="metric"><div class="label">Total to write</div><div class="value">${candidates.length}</div></div>
        </div>
        ${candidates.length > 800 ? `<p class="text-xs" style="color:var(--warn,#9a5b00);margin-bottom:10px">⚠ ${candidates.length} records is a large write and may take a few minutes. You can cancel mid-way; records already written stay.</p>` : ''}
        ${warnings.groupedPOs ? `<div class="card" style="background:#fbf7ee;border-left:3px solid var(--warn,#9a5b00);margin-bottom:10px;padding:8px 12px"><p class="text-sm" style="margin:0">📑 <strong>${warnings.groupedPOs}</strong> purchase order(s) had multiple line rows in the workbook and were grouped into one PO each (master amount = sum of lines). ${warnings.totalLineRows} line row(s) → ${candidates.length} PO(s).</p></div>` : ''}
        <div class="card" style="background:#f7faf7;border-left:3px solid var(--success,#287a48);margin-bottom:10px;padding:8px 12px">
          <p class="text-sm" style="margin:0"><strong>Supplier links:</strong> ${supplierMatches.vendorNo || 0} by vendor code · ${supplierMatches.name || 0} by name · ${supplierMatches.alias || 0} by alias · ${supplierMatches.unmatched || 0} need mapping.</p>
          <div class="text-xs text-muted" style="margin-top:5px">Vendor name and vendor code remain ERP values on the PO. A successful match stores a separate Phoenix supplier-master link for reporting and performance history.</div>
        </div>
        ${unmatchedSuppliers.length ? `<div class="card" style="background:#fbf7ee;border-left:3px solid var(--warn,#9a5b00);margin-bottom:10px;padding:8px 12px">
          <p class="text-sm" style="margin:0 0 6px"><strong>⚠ ${unmatchedSuppliers.length} supplier link(s) need master-data mapping</strong> (the PO will still import):</p>
          <div class="text-xs text-muted">${unmatchedSuppliers.slice(0,12).map(item => `${escapeHtml(item.orderId)} <span style="opacity:.7">(${escapeHtml(item.entity)})</span>: ${escapeHtml(item.vendorName)} [${escapeHtml(item.vendorNo)}]`).join('<br>')}${unmatchedSuppliers.length > 12 ? `<br>… +${unmatchedSuppliers.length - 12} more` : ''}</div>
        </div>` : ''}
        ${conflicts.length ? `<div class="card" style="background:#fbf7ee;border-left:3px solid var(--warn,#9a5b00);margin-bottom:10px;padding:8px 12px">
          <p class="text-sm" style="margin:0 0 6px"><strong>⚠ ${conflicts.length} existing order(s) will change on update</strong> (ERP value differs from the current Phoenix value). Phoenix operational data — status, milestones, follow-ups — is preserved.</p>
          <div class="text-xs text-muted">${conflicts.slice(0,12).map(c => `${escapeHtml(c.orderId)} <span style="opacity:.7">(${escapeHtml(c.entity)})</span>: ${c.diffs.map(escapeHtml).join(', ')}`).join(' · ')}${conflicts.length>12?` … +${conflicts.length-12} more`:''}</div>
        </div>` : ''}
        ${errors.length ? `<div class="card" style="background:#fdf6f5;border-left:3px solid var(--danger,#b3261e);margin-bottom:10px;padding:8px 12px">
          <p class="text-sm" style="margin:0 0 6px;color:var(--danger,#b3261e)"><strong>✗ ${errors.length} PO(s) failed import validation and will be skipped</strong> (not written):</p>
          <div class="text-xs text-muted">${errors.slice(0,15).map(e => `${escapeHtml(e.orderId || e.sheet || '(no PO)')} <span style="opacity:.7">(${escapeHtml(e.entity||'?')})</span>: ${e.errors.map(escapeHtml).join('; ')}`).join('<br>')}${errors.length>15?`<br>… +${errors.length-15} more`:''}</div>
        </div>` : ''}
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-primary" id="erp-import-commit">Commit import (${candidates.length})</button>
          <button class="btn btn-ghost" id="erp-import-cancel">Cancel</button>
          <span id="erp-import-progress" class="text-sm text-muted"></span>
        </div>
      </div>`;

    $('#erp-import-cancel').addEventListener('click', () => { panel.innerHTML = ''; });
    $('#erp-import-commit').addEventListener('click', async () => {
      const commitBtn = $('#erp-import-commit');
      const cancelBtn = $('#erp-import-cancel');
      const prog = $('#erp-import-progress');
      const runId = window.PXImportHistory?.importRunId ? window.PXImportHistory.importRunId() : `IMP-${Date.now()}`;
      importCancel = { cancelled: false };
      commitBtn.disabled = true; commitBtn.textContent = 'Importing…';
      cancelBtn.textContent = 'Stop'; cancelBtn.onclick = () => { importCancel.cancelled = true; };
      // Persistent, view-independent progress bar (stays visible across tab switches).
      if (window.PXProgress) window.PXProgress.start('Importing purchase orders', { onStop: () => { importCancel.cancelled = true; } });
      const res = await window.PXPoImport.commitImport(candidates, {
        cancelRef: importCancel,
        runContext: { runId, fileMeta: ctx.fileMeta, stats, toCreate, toUpdate, conflicts, warnings, errors },
        onProgress: ({ done, total, created, updated, failed }) => {
          const detail = `${created} created · ${updated} updated${failed ? ' · ' + failed + ' failed' : ''}`;
          if (prog) prog.textContent = `${done} / ${total} processed · ${detail}`;
          if (window.PXProgress) window.PXProgress.update(done, total, detail);
        }
      });
      if (prog) prog.textContent = `Done: ${res.created} created, ${res.updated} updated${res.failed ? ', ' + res.failed + ' failed' : ''}${res.cancelled ? ' (stopped early)' : ''}.`;
      if (res.failed && res.rowErrors && res.rowErrors.length) {
        const rep = document.createElement('div');
        rep.className = 'card';
        rep.style = 'background:#fdf6f5;border-left:3px solid var(--danger,#b3261e);margin-top:10px;padding:8px 12px';
        rep.innerHTML = `<p class="text-sm" style="margin:0 0 6px;color:var(--danger,#b3261e)"><strong>${res.failed} row(s) failed to write:</strong></p>`
          + `<div class="text-xs text-muted">${res.rowErrors.slice(0,15).map(e => `${escapeHtml(e.orderId||'?')} (${escapeHtml(e.entity||'?')}): ${escapeHtml(e.error||'')}`).join('<br>')}${res.rowErrors.length>15?`<br>… +${res.rowErrors.length-15} more`:''}</div>`;
        panel.appendChild(rep);
      }
      if (window.PXProgress) window.PXProgress.finish(`Import complete — ${res.created} created, ${res.updated} updated${res.cancelled ? ' (stopped early)' : ''}`);
      commitBtn.textContent = 'Imported ✓';
      if (toast) toast(`Import complete: ${res.created} created, ${res.updated} updated`, res.failed ? 'warning' : 'success');
      // Refresh the reconciliation view counts after a moment (live subscription will also update).
      setTimeout(() => window.__renderers['erprecon'] && window.__renderers['erprecon'](), 1500);
    });
  }
  // ---- Migrate legacy status log (one-off) ----
  const smBtn = $('#erp-statusmig-btn');
  const smFile = $('#erp-statusmig-file');
  const smPanel = $('#erp-statusmig-panel');
  let smCancel = { cancelled: false };
  if (smBtn && smFile) {
    smBtn.addEventListener('click', () => smFile.click());
    smFile.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      smPanel.innerHTML = `<div class="card" style="margin:14px 0"><div class="text-sm">Reading <strong>${escapeHtml(file.name)}</strong>…</div></div>`;
      try {
        const buf = await file.arrayBuffer();
        const wb = await window.PXXlsxReader.readWorkbook(buf);
        const entries = window.PXStatusMigration.buildStatusMigration(wb);
        const matched = entries.filter(x => x.matched).length;
        const unmatched = entries.length - matched;
        smPanel.innerHTML = `
          <div class="card" style="margin:14px 0">
            <div class="card-head" style="margin-bottom:8px"><h3>Status-log migration preview — ${escapeHtml(file.name)}</h3></div>
            <p class="text-xs text-muted" style="margin-bottom:10px">Each legacy STATUS entry becomes a follow-up note on the matching order (tagged "Migrated from legacy tracker"). Re-running skips notes already migrated. Nothing is written until you click Commit.</p>
            <div class="metric-grid" style="margin:10px 0">
              <div class="metric success"><div class="label">Status entries found</div><div class="value">${entries.length}</div></div>
              <div class="metric accent"><div class="label">Match an existing order</div><div class="value">${matched}</div></div>
              <div class="metric"><div class="label">No matching order (skipped)</div><div class="value">${unmatched}</div></div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <button class="btn btn-primary" id="sm-commit" ${matched ? '' : 'disabled'}>Commit migration (${matched})</button>
              <button class="btn btn-ghost" id="sm-cancel">Cancel</button>
              <span id="sm-progress" class="text-sm text-muted"></span>
            </div>
          </div>`;
        $('#sm-cancel').addEventListener('click', () => { smPanel.innerHTML = ''; });
        $('#sm-commit').addEventListener('click', async () => {
          const cb = $('#sm-commit'), prog = $('#sm-progress');
          smCancel = { cancelled: false };
          cb.disabled = true; cb.textContent = 'Migrating…';
          if (window.PXProgress) window.PXProgress.start('Migrating legacy status log', { onStop: () => { smCancel.cancelled = true; } });
          const res = await window.PXStatusMigration.commitStatusMigration(entries, {
            cancelRef: smCancel,
            onProgress: ({ done, total, created, skipped }) => {
              const detail = `${created} added · ${skipped} already migrated`;
              if (prog) prog.textContent = `${done} / ${total} · ${detail}`;
              if (window.PXProgress) window.PXProgress.update(done, total, detail);
            }
          });
          if (prog) prog.textContent = `Done: ${res.created} notes added, ${res.skipped} already migrated, ${res.unmatched} unmatched${res.failed ? ', ' + res.failed + ' failed' : ''}.`;
          if (window.PXProgress) window.PXProgress.finish(`Status migration — ${res.created} notes added`);
          cb.textContent = 'Migrated ✓';
          if (toast) toast(`Status migration: ${res.created} notes added`, res.failed ? 'warning' : 'success');
        });
      } catch (err) {
        console.error(err);
        smPanel.innerHTML = `<div class="card" style="margin:14px 0;border-left:3px solid var(--danger)"><strong>Could not read the file.</strong><div class="text-sm text-muted">${escapeHtml(err.message || String(err))}</div></div>`;
      }
      smFile.value = '';
    });
  }
  const demoBtn = $('#erp-demo-btn');
  if (demoBtn) demoBtn.addEventListener('click', async () => {
    if (!confirm('Create one SAMPLE ERP-sourced order (with PO lines) for demo/preview?\n\nThis demo helper makes a normal order tagged as if it came from Navision, so you can see the ERP experience. You can delete it afterward like any order.')) return;
    const stamp = Date.now().toString().slice(-4);
    const sample = {
      orderId: 'FPO9' + stamp,
      orderType: 'foreign',
      erpSource: 'Navision',
      erpCompany: 'Phoenix Beverages Limited',
      erpVendorNo: 'V-10293',
      erpOrderNo: 'FPO9' + stamp,
      erpSystemId: 'NAV-' + stamp,
      erpSyncStatus: 'synced',
      erpLastSyncedAt: new Date(),
      supplier: 'SIDEL S.p.A.',
      currency: 'EUR',
      amount: 48500,
      dateOfOrder: new Date(),
      description: 'Filler spare parts — annual maintenance kit',
      category: 'Spare parts',
      function: 'technical',
      paymentTerms: '30% advance, 70% before shipment',
      status: 'Order sent to supplier',
      officerCode: state.officer?.code || '',
      isClosed: false,
      lines: [
        { erpOrderLineNo: 10000, itemNo: 'SP-4471', description: 'Valve seat assembly', quantity: 12, unitOfMeasure: 'PCS', unitCost: 1850, lineAmount: 22200, receivedQuantity: 12, outstandingQuantity: 0, expectedReceiptDate: null },
        { erpOrderLineNo: 20000, itemNo: 'SP-9982', description: 'Filling nozzle O-ring set', quantity: 50, unitOfMeasure: 'SET', unitCost: 210, lineAmount: 10500, receivedQuantity: 16, outstandingQuantity: 34, expectedReceiptDate: null },
        { erpOrderLineNo: 30000, itemNo: 'SP-1120', description: 'Servo drive belt', quantity: 8, unitOfMeasure: 'PCS', unitCost: 1975, lineAmount: 15800, receivedQuantity: 0, outstandingQuantity: 8, expectedReceiptDate: null }
      ],
    };
    try {
      await window.PXStore.createRecord('orders', sample, {
        permissionResource: 'erprecon',
        permissionAction: 'create',
        log: { recordType: 'order', action: 'created', details: 'Sample ERP order seeded' }
      });
      toast('Sample ERP order created: ' + sample.orderId, 'success');
    } catch (e) { toast('Could not create sample: ' + e.message, 'danger'); }
  });
};
