/* managementControls.js — value-added operational and KPI control views.
   These are read-only dashboards over existing Phoenix data. They do not create
   new operational records; they turn orders, shipments, payments, documents,
   issues, contact logs, update requests, and forecast rows into daily controls. */
const { $, $$, fmtDate, fmtMoney, escapeHtml, currentEntity, recordEntity, entityMeta,
  orderFunction, statusBadgeClass, cmExportCSV } = window.PXUtils;
const state = window.__state;
const REF = window.REF;

(function () {
  const DAY = 86400000;
  const OPEN_PAYMENT = status => !['paid', 'rejected', 'cancelled'].includes(String(status || '').toLowerCase());
  const ACTIVE_SHIPMENT = s => !s.archived && !(s.completed || s.stage === 'completed') && !s.grnDate;

  function asDate(value) {
    if (!value) return null;
    const d = value.toDate ? value.toDate() : (value instanceof Date ? value : new Date(value));
    return d && !isNaN(d) ? d : null;
  }
  function dayStart(value) {
    const d = asDate(value);
    if (!d) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function daysUntil(value) {
    const d = dayStart(value);
    if (!d) return null;
    const today = dayStart(new Date());
    return Math.round((d - today) / DAY);
  }
  function daysSince(value) {
    const n = daysUntil(value);
    return n === null ? null : -n;
  }
  function orderForShipment(s) {
    return (state.data.orders || []).find(o => o.orderId === s.orderId) || null;
  }
  function orderForPayment(p) {
    return (state.data.orders || []).find(o => o.orderId === p.orderId) || null;
  }
  function entityOfShipment(s) {
    const order = orderForShipment(s);
    return s.entity || (order ? recordEntity(order) : 'Phoenix');
  }
  function entityOfPayment(p) {
    const order = orderForPayment(p);
    return p.entity || (order ? recordEntity(order) : 'Phoenix');
  }
  function activeOrders(ent) {
    return (state.data.orders || []).filter(o => !o.archived && !o.isClosed && recordEntity(o) === ent);
  }
  function activeShipments(ent) {
    return (state.data.shipments || []).filter(s => ACTIVE_SHIPMENT(s) && entityOfShipment(s) === ent);
  }
  function openPayments(ent) {
    return (state.data.payments || []).filter(p => !p.archived && OPEN_PAYMENT(p.status) && entityOfPayment(p) === ent);
  }
  function linkedShipments(order) {
    return (state.data.shipments || []).filter(s => !s.archived && s.orderId === order.orderId);
  }
  function linkedPayments(order) {
    return (state.data.payments || []).filter(p => !p.archived && p.orderId === order.orderId);
  }
  function officerName(code) {
    const o = (state.data.officers || []).find(x => x.code === code);
    return o ? (o.fullName || o.code) : (code || '-');
  }
  function orderOwner(order) {
    return [order.officerCode, order.logisticOfficer].filter(Boolean).join(' / ') || '-';
  }
  function money(value, currency) {
    return value == null || value === '' ? '-' : fmtMoney(value, currency || '');
  }
  function riskLevel(score) {
    return score >= 75 ? 'danger' : score >= 45 ? 'warn' : 'info';
  }
  function riskLabel(score) {
    return score >= 75 ? 'High' : score >= 45 ? 'Medium' : 'Watch';
  }
  function badge(text, cls) {
    return `<span class="badge ${cls || 'neutral'}">${escapeHtml(text)}</span>`;
  }
  function safeRows(rows, empty, cols) {
    return rows.length ? rows.join('') : `<tr><td colspan="${cols}" class="empty-state"><h3>${escapeHtml(empty)}</h3></td></tr>`;
  }
  function exportRows(rows, filename) {
    if (cmExportCSV) cmExportCSV(rows, filename);
    else {
      const headers = Object.keys(rows[0] || { Empty: '' });
      const esc = value => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
      const csv = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = filename + '.csv';
      a.click();
    }
  }

  function buildExceptions(ent) {
    const PF = window.PXProcFollowup;
    if (!PF) return [];
    const ctx = PF.context();
    const rows = [];
    activeOrders(ent).forEach(order => {
      PF.orderChecks(order, ctx).forEach(check => rows.push({ order, check }));
    });
    const rank = { danger: 0, warn: 1, info: 2 };
    return rows.sort((a, b) => (rank[a.check.level] - rank[b.check.level]) || ((b.check.points || 0) - (a.check.points || 0)));
  }

  function buildOtifRisk(ent) {
    const PF = window.PXProcFollowup;
    const ctx = PF ? PF.context() : null;
    const rows = [];
    activeOrders(ent).forEach(order => {
      const shipments = linkedShipments(order);
      const active = shipments.filter(s => !s.completed && s.stage !== 'completed');
      const receiptDays = daysUntil(order.requestedReceiptDate);
      const needsShipment = window.PXUtils.orderNeedsShipment ? window.PXUtils.orderNeedsShipment(order) : order.orderType === 'foreign';
      const hasReceipt = shipments.some(s => s.grnDate || s.deliveryDate) || (order.receipts || []).some(r => r.grnDate);
      const signals = [];
      let score = 0;

      if (receiptDays !== null && !hasReceipt) {
        if (receiptDays < 0) { score += 35; signals.push(`Requested receipt overdue by ${Math.abs(receiptDays)}d`); }
        else if (receiptDays <= 7) { score += 25; signals.push(`Requested receipt in ${receiptDays}d`); }
        else if (receiptDays <= 14) { score += 12; signals.push(`Requested receipt in ${receiptDays}d`); }
      }
      if (needsShipment && !shipments.length) { score += 28; signals.push('No shipment record'); }
      if (needsShipment && active.length && active.every(s => !s.etd)) { score += 14; signals.push('No ETD on active shipment'); }
      if (active.some(s => s.eta && order.requestedReceiptDate && asDate(s.eta) > asDate(order.requestedReceiptDate))) {
        score += 20; signals.push('ETA after requested receipt');
      }
      if (active.some(s => s.eta && !s.actualArrivalDate && daysUntil(s.eta) < 0)) {
        score += 22; signals.push('ETA passed, no arrival');
      }
      if (active.some(s => Array.isArray(s.etaChangeHistory) && s.etaChangeHistory.length > 3)) {
        score += 10; signals.push('ETA changed repeatedly');
      }
      const expected = window.PXUtils.expectedDocsFor ? window.PXUtils.expectedDocsFor('order', order) : [];
      const present = (state.data.documents || []).filter(d => !d.archived && d.relatedType === 'order' && d.relatedId === order.id && (window.PXDocuments ? window.PXDocuments.isPresent(d) : d.documentUrl || d.fileData || ['received', 'approved'].includes(d.status))).map(d => d.documentType);
      const missingDocs = expected.filter(t => !present.includes(t));
      if (missingDocs.length && receiptDays !== null && receiptDays <= 14) { score += 10; signals.push(`${missingDocs.length} expected doc(s) missing`); }
      if (PF && ctx) {
        const checks = PF.orderChecks(order, ctx);
        const critical = checks.filter(c => c.level === 'danger').length;
        const warn = checks.filter(c => c.level === 'warn').length;
        score += critical * 10 + warn * 4;
      }
      if (score > 0) rows.push({ order, score: Math.min(100, score), level: riskLevel(score), signals, receiptDays, shipments });
    });
    return rows.sort((a, b) => b.score - a.score || ((a.receiptDays ?? 999) - (b.receiptDays ?? 999)));
  }

  function buildOfficerWorkload(ent) {
    const officers = (state.data.officers || []).filter(o => o.active !== false);
    const map = {};
    const ensure = code => {
      const key = code || '-';
      return map[key] || (map[key] = { code: key, name: officerName(key), orders: 0, shipments: 0, payments: 0, updateRequests: 0, issues: 0, critical: 0, dueSoon: 0, total: 0 });
    };
    officers.forEach(o => ensure(o.code));
    activeOrders(ent).forEach(o => {
      const r = ensure(o.officerCode || o.logisticOfficer);
      r.orders++;
      const d = daysUntil(o.requestedReceiptDate);
      if (d !== null && d <= 7) r.dueSoon++;
    });
    activeShipments(ent).forEach(s => {
      const r = ensure(s.logisticOfficer || s.clearanceOwner || orderForShipment(s)?.officerCode);
      r.shipments++;
      const d = daysUntil(s.eta || s.etd);
      if (d !== null && d <= 7) r.dueSoon++;
    });
    openPayments(ent).forEach(p => {
      const r = ensure(p.officerCode || p.createdBy || orderForPayment(p)?.officerCode);
      r.payments++;
      const d = daysUntil(p.dueDate);
      if (d !== null && d <= 7) r.dueSoon++;
    });
    (state.data.updateRequests || []).filter(r => !r.archived && r.status === 'open' && (r.entity || ent) === ent).forEach(req => {
      const targets = Array.isArray(req.targetOfficers) && req.targetOfficers.length ? req.targetOfficers : [req.assignedTo || req.targetOfficer || req.createdBy || '-'];
      targets.forEach(code => {
        const r = ensure(code);
        r.updateRequests++;
        const d = daysUntil(req.dueDate);
        if (d !== null && d < 0) r.critical++;
      });
    });
    (state.data.issues || []).filter(i => !i.archived && i.status === 'open' && (i.entity || ent) === ent).forEach(issue => {
      const r = ensure(issue.owner || issue.assignedTo || issue.officerCode || '-');
      r.issues++;
      const d = daysUntil(issue.targetResolutionDate);
      if (d !== null && d < 0) r.critical++;
    });
    buildExceptions(ent).filter(x => x.check.level === 'danger').forEach(({ order }) => ensure(order.officerCode || order.logisticOfficer).critical++);
    Object.values(map).forEach(r => { r.total = r.orders + r.shipments + r.payments + r.updateRequests + r.issues; });
    return Object.values(map).filter(r => r.total || r.code !== '-').sort((a, b) => b.critical - a.critical || b.total - a.total);
  }

  function buildPartialShipments(ent) {
    const groups = {};
    (state.data.shipments || []).filter(s => !s.archived && entityOfShipment(s) === ent).forEach(s => {
      const order = orderForShipment(s);
      const key = s.orderId || s.id;
      const g = groups[key] || (groups[key] = { order, orderId: key, shipments: [], flags: [] });
      g.shipments.push(s);
    });
    return Object.values(groups).map(g => {
      const partials = g.shipments.filter(s =>
        /partial|balance|replacement|split/i.test([s.shipmentCoverage, s.partialShipmentReason, s.receiptResult, s.followupAction].join(' ')) ||
        ['Partially received', 'Short received', 'Missing goods', 'Damaged goods', 'Over received'].includes(s.receiptResult || '')
      );
      if (g.shipments.length > 1) g.flags.push('Multiple shipment records');
      if (partials.length) g.flags.push('Partial / split / exception flagged');
      if (g.shipments.some(s => s.followupAction && s.followupAction !== 'No action' && s.followupActionStatus !== 'processed')) g.flags.push('Follow-up action open');
      return g;
    }).filter(g => g.flags.length).sort((a, b) => b.shipments.length - a.shipments.length);
  }

  function buildClearanceRows(ent) {
    return activeShipments(ent).filter(s => {
      const order = orderForShipment(s);
      return (order && order.orderType === 'foreign') || s.orderType === 'foreign' || s.mode || s.eta;
    }).map(s => {
      const order = orderForShipment(s);
      const etaDays = daysUntil(s.eta);
      const docs = window.PXShipmentDocs ? window.PXShipmentDocs.summary(s) : { total: 0, received: 0, complete: false };
      const arrived = !!(s.actualArrivalDate || s.portArrivalDate);
      const release = !!(s.customsReleaseDate || s.clearanceDate);
      const signals = [];
      let score = 0;
      if (etaDays !== null && etaDays <= 7 && !s.docsToBrokerDate) { score += 25; signals.push('Docs not sent to broker'); }
      if (etaDays !== null && etaDays <= 7 && !s.clearanceOwner) { score += 18; signals.push('No clearance owner'); }
      if (etaDays !== null && etaDays < 0 && !arrived) { score += 25; signals.push('ETA passed, no arrival'); }
      if (arrived && !s.clearanceStartDate) {
        const age = daysSince(s.portArrivalDate || s.actualArrivalDate);
        if (age !== null && age > 3) { score += 30; signals.push(`Arrived ${age}d, clearance not started`); }
      }
      if (s.clearanceStartDate && !release) {
        const age = daysSince(s.clearanceStartDate);
        if (age !== null && age > 5 && !(state.data.issues || []).some(i => !i.archived && i.status === 'open' && i.relatedType === 'shipment' && i.relatedId === s.id)) {
          score += 25; signals.push(`Clearance in progress ${age}d`);
        }
      }
      if (docs.total && !docs.complete && etaDays !== null && etaDays <= 7) { score += 15; signals.push(`${docs.received}/${docs.total} clearance docs ready`); }
      return { shipment: s, order, etaDays, docs, score: Math.min(100, score), level: riskLevel(score), signals };
    }).sort((a, b) => b.score - a.score || ((a.etaDays ?? 999) - (b.etaDays ?? 999)));
  }

  function buildPaymentExposure(ent) {
    const forecast = window.__pay_buildPaymentsForecast ? window.__pay_buildPaymentsForecast({ entity: ent }).rows : [];
    const rows = forecast.map(r => ({ ...r, source: 'milestone' }));
    openPayments(ent).forEach(p => {
      rows.push({
        source: 'rfp', orderId: p.orderId, orderDocId: orderForPayment(p)?.id, supplier: p.supplier || orderForPayment(p)?.supplier || '-',
        currency: p.currency || orderForPayment(p)?.currency || '-', amount: Number(p.amount || 0),
        forecastDate: asDate(p.dueDate), dueDate: p.dueDate, daysUntil: daysUntil(p.dueDate),
        rfpRef: p.rfpRef || '', invoiceNumber: p.invoiceNumber || '', status: p.status || 'draft'
      });
    });
    const buckets = {};
    rows.forEach(r => {
      const cur = r.currency || '-';
      const b = buckets[cur] || (buckets[cur] = { currency: cur, overdue: 0, due7: 0, due30: 0, later: 0, undated: 0, total: 0, count: 0 });
      const amount = Number(r.amount || 0);
      b.total += amount; b.count++;
      const d = r.daysUntil !== undefined ? r.daysUntil : daysUntil(r.forecastDate || r.dueDate);
      if (d === null) b.undated += amount;
      else if (d < 0) b.overdue += amount;
      else if (d <= 7) b.due7 += amount;
      else if (d <= 30) b.due30 += amount;
      else b.later += amount;
    });
    rows.sort((a, b) => ((a.daysUntil ?? 9999) - (b.daysUntil ?? 9999)));
    return { rows, buckets: Object.values(buckets).sort((a, b) => b.total - a.total) };
  }

  function buildCalendar(ent, daysAhead) {
    const horizon = daysAhead || 60;
    const events = [];
    const add = (date, type, label, detail, go, owner, level) => {
      const d = daysUntil(date);
      if (d === null || d < -7 || d > horizon) return;
      events.push({ date, days: d, type, label, detail, go, owner: owner || '-', level: level || (d < 0 ? 'danger' : d <= 7 ? 'warn' : 'neutral') });
    };
    activeOrders(ent).forEach(o => {
      add(o.requestedReceiptDate, 'Receipt', o.orderId || 'Order', `${o.supplier || '-'} - requested receipt`, `openOrderDetail('${o.id}')`, orderOwner(o));
      add(o.orderReadyDate, 'Order ready', o.orderId || 'Order', o.supplier || '-', `openOrderDetail('${o.id}')`, o.officerCode);
    });
    activeShipments(ent).forEach(s => {
      add(s.etd, 'ETD', s.shipmentId || s.orderId || 'Shipment', orderForShipment(s)?.supplier || '-', `openShipmentDetail('${s.id}')`, s.logisticOfficer);
      add(s.eta, 'ETA', s.shipmentId || s.orderId || 'Shipment', orderForShipment(s)?.supplier || '-', `openShipmentDetail('${s.id}')`, s.logisticOfficer || s.clearanceOwner);
      add(s.clearanceStartDate, 'Clearance', s.shipmentId || s.orderId || 'Shipment', 'clearance start', `openShipmentDetail('${s.id}')`, s.clearanceOwner);
    });
    openPayments(ent).forEach(p => add(p.dueDate, 'Payment', p.rfpRef || p.orderId || 'RFP', p.supplier || orderForPayment(p)?.supplier || '-', `openPaymentDetail('${p.id}')`, p.officerCode || p.createdBy));
    (state.data.followups || []).filter(f => !f.archived && f.status === 'open').forEach(f => {
      const targetEnt = f.relatedType === 'shipment' ? entityOfShipment((state.data.shipments || []).find(s => s.id === f.relatedId) || {}) :
        f.relatedType === 'payment' ? entityOfPayment((state.data.payments || []).find(p => p.id === f.relatedId) || {}) :
        recordEntity((state.data.orders || []).find(o => o.id === f.relatedId) || {});
      if (targetEnt !== ent) return;
      add(f.nextActionDueDate, 'Follow-up', f.nextAction || 'Follow-up', f.comment || '', f.relatedType === 'shipment' ? `openShipmentDetail('${f.relatedId}')` : f.relatedType === 'payment' ? `openPaymentDetail('${f.relatedId}')` : `openOrderDetail('${f.relatedId}')`, f.assignedTo || f.officer);
    });
    (state.data.updateRequests || []).filter(r => !r.archived && r.status === 'open' && (r.entity || ent) === ent)
      .forEach(r => add(r.dueDate, 'Update request', r.orderId || r.shipmentId || 'Update', r.message || '', r.targetType === 'shipment' && r.shipmentDocId ? `openShipmentDetail('${r.shipmentDocId}')` : r.orderDocId ? `openOrderDetail('${r.orderDocId}')` : '', (r.targetOfficers || []).join(' / ')));
    return events.sort((a, b) => (asDate(a.date) || 0) - (asDate(b.date) || 0));
  }

  function buildManagementData(ent) {
    return {
      exceptions: buildExceptions(ent),
      otifRisk: buildOtifRisk(ent),
      workload: buildOfficerWorkload(ent),
      partials: buildPartialShipments(ent),
      clearance: buildClearanceRows(ent),
      payments: buildPaymentExposure(ent),
      calendar: buildCalendar(ent, 60),
      scorecards: window.PXScorecard ? window.PXScorecard.buildScorecard({ entity: ent, type: 'all', fn: 'all' }) : []
    };
  }

  function pageHead(title, desc, actionHtml) {
    const ent = currentEntity();
    const meta = entityMeta(ent) || {};
    return `<div class="page-head"><div class="title"><h1>${escapeHtml(title)} <span class="badge" style="background:${meta.accent || '#888'};color:#fff;font-size:11px;vertical-align:middle">${escapeHtml(meta.code || ent)}</span></h1><span class="desc">${escapeHtml(desc)}</span></div>${actionHtml ? `<div class="page-actions">${actionHtml}</div>` : ''}</div>`;
  }
  function miniTable(headers, rows, empty) {
    return `<div class="table-wrap"><table class="data"><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="empty-state"><h3>${escapeHtml(empty)}</h3></td></tr>`}</tbody></table></div>`;
  }
  function navButton(view, label) {
    if (window.__viewLevel && window.__viewLevel(view) === 'none') return '';
    return `<button class="btn btn-sm" onclick="navigate('${view}')">${escapeHtml(label)}</button>`;
  }
  function actionButtons(buttons) {
    return buttons.map(b => navButton(b.view, b.label)).filter(Boolean).join('');
  }
  function managementTile(view, tone, label, value, sub) {
    if (window.__viewLevel && window.__viewLevel(view) === 'none') return '';
    return `<button class="mgmt-tile ${tone || 'neutral'}" onclick="navigate('${view}')"><span>${escapeHtml(label)}</span><strong>${value}</strong><small>${escapeHtml(sub)}</small></button>`;
  }

  function renderManagementCockpit() {
    const viewEl = $('#view-mgmtcockpit');
    if (!viewEl) return;
    const ent = currentEntity();
    const data = buildManagementData(ent);
    const criticalExceptions = data.exceptions.filter(x => x.check.level === 'danger').length;
    const highOtif = data.otifRisk.filter(r => r.score >= 75).length;
    const clearanceRisk = data.clearance.filter(r => r.score >= 45).length;
    const paymentDays = r => r.daysUntil ?? daysUntil(r.forecastDate || r.dueDate);
    const paymentRisk = data.payments.rows.filter(r => {
      const d = paymentDays(r);
      return d !== null && d <= 7;
    }).length;
    const dq = window.PXDataQuality ? window.PXDataQuality.buildReport({ entity: ent }) : null;
    const dqCritical = dq?.totals?.totalDanger || 0;
    const ownerPressure = data.workload.filter(r => r.critical || r.dueSoon || r.total >= 8);
    const weakSuppliers = data.scorecards.filter(s => s.rating < 60).slice(0, 8);

    const priority = [];
    data.exceptions.filter(x => x.check.level === 'danger').slice(0, 8).forEach(({ order, check }) => priority.push({
      sort: 10, area: 'Exception', priority: 'Critical', cls: 'danger', ref: order.orderId || '-', supplier: order.supplier || '-',
      owner: orderOwner(order), date: fmtDate(order.requestedReceiptDate) || '-', detail: check.msg, go: `openOrderDetail('${order.id}')`
    }));
    data.otifRisk.filter(r => r.score >= 75).slice(0, 8).forEach(r => priority.push({
      sort: 20, area: 'OTIF', priority: 'High risk', cls: r.level, ref: r.order.orderId || '-', supplier: r.order.supplier || '-',
      owner: orderOwner(r.order), date: fmtDate(r.order.requestedReceiptDate) || '-', detail: r.signals.slice(0, 3).join(' | '), go: `openOrderDetail('${r.order.id}')`
    }));
    data.clearance.filter(r => r.score >= 45).slice(0, 8).forEach(r => priority.push({
      sort: 30, area: 'Clearance', priority: riskLabel(r.score), cls: r.level, ref: r.shipment.shipmentId || r.shipment.orderId || '-',
      supplier: r.order?.supplier || '-', owner: officerName(r.shipment.clearanceOwner || r.shipment.logisticOfficer),
      date: fmtDate(r.shipment.eta) || '-', detail: r.signals.join(' | ') || 'Clearance follow-up required', go: `openShipmentDetail('${r.shipment.id}')`
    }));
    data.payments.rows.filter(r => {
      const d = paymentDays(r);
      return d !== null && d < 0;
    }).slice(0, 8).forEach(r => priority.push({
      sort: 40, area: 'Payment', priority: 'Overdue', cls: 'danger', ref: r.rfpRef || r.orderId || '-',
      supplier: r.supplier || '-', owner: '-', date: fmtDate(r.forecastDate || r.dueDate) || '-',
      detail: `${money(r.amount, r.currency)} overdue`, go: r.orderDocId ? `openOrderDetail('${r.orderDocId}')` : ''
    }));
    if (dq) {
      [
        ['orders', 'Order DQ', 'openOrderDetail'],
        ['shipments', 'Shipment DQ', 'openShipmentDetail'],
        ['payments', 'Payment DQ', 'openPaymentDetail'],
        ['suppliers', 'Supplier DQ', 'openSupplierDetail']
      ].forEach(([key, area, fn]) => {
        (dq[key] || []).filter(row => row.danger > 0).slice(0, 3).forEach(row => priority.push({
          sort: 50, area, priority: 'Data quality', cls: 'danger', ref: row.ref || '-',
          supplier: row.record?.supplier || row.label || '-', owner: '-', date: '-',
          detail: `${row.danger} critical data issue(s)`, go: window[fn] ? `${fn}('${row.id}')` : `navigate('dqcockpit')`
        }));
      });
    }
    const priorityRows = priority.sort((a, b) => a.sort - b.sort).slice(0, 14).map(item => `<tr ${item.go ? `onclick="${item.go}" style="cursor:pointer"` : ''}>
      <td>${badge(item.priority, item.cls)}</td><td>${escapeHtml(item.area)}</td><td class="mono">${escapeHtml(item.ref)}</td>
      <td>${escapeHtml(item.supplier)}</td><td>${escapeHtml(item.owner)}</td><td>${escapeHtml(item.date)}</td><td>${escapeHtml(item.detail)}</td>
    </tr>`);

    const deadlineRows = [
      ...data.calendar.filter(e => e.days <= 7).slice(0, 8).map(e => ({
        cls: e.level, band: e.days < 0 ? 'Overdue' : 'Due soon', type: e.type, ref: e.label, date: fmtDate(e.date) || '-', owner: e.owner || '-', detail: e.detail || '-', go: e.go
      })),
      ...data.payments.rows.filter(r => {
        const d = paymentDays(r);
        return d !== null && d >= 0 && d <= 7;
      }).slice(0, 6).map(r => ({
        cls: 'warn', band: 'Payment', type: r.source || 'payment', ref: r.rfpRef || r.orderId || '-', date: fmtDate(r.forecastDate || r.dueDate) || '-',
        owner: '-', detail: money(r.amount, r.currency), go: r.orderDocId ? `openOrderDetail('${r.orderDocId}')` : ''
      }))
    ].slice(0, 12).map(item => `<tr ${item.go ? `onclick="${item.go}" style="cursor:pointer"` : ''}>
      <td>${badge(item.band, item.cls)}</td><td>${escapeHtml(item.type)}</td><td class="mono">${escapeHtml(item.ref)}</td>
      <td>${escapeHtml(item.date)}</td><td>${escapeHtml(item.owner)}</td><td>${escapeHtml(item.detail)}</td>
    </tr>`);

    const workloadRows = ownerPressure.slice(0, 10).map(r => `<tr>
      <td>${escapeHtml(r.name)} <span class="text-xs text-muted">(${escapeHtml(r.code)})</span></td>
      <td class="num">${r.critical ? badge(String(r.critical), 'danger') : '0'}</td>
      <td class="num">${r.dueSoon ? badge(String(r.dueSoon), 'warn') : '0'}</td>
      <td class="num">${r.orders}</td><td class="num">${r.shipments}</td><td class="num">${r.payments}</td><td class="num" style="font-weight:700">${r.total}</td>
    </tr>`);

    const supplierRows = weakSuppliers.map(s => `<tr>
      <td>${escapeHtml(s.supplier)}</td><td class="num" style="font-weight:700;color:${s.rating < 45 ? 'var(--danger)' : 'var(--warn)'}">${s.rating}</td>
      <td class="num">${s.otif != null ? s.otif + '%' : '-'}</td><td class="num">${s.openOrders}</td>
      <td>${escapeHtml([s.ackDelayAvg != null ? 'Ack ' + s.ackDelayAvg + 'd' : '', s.etaChanges ? s.etaChanges + ' ETA changes' : '', s.receiptExceptions ? s.receiptExceptions + ' receipt exceptions' : '', s.issueCount ? s.issueCount + ' issue(s)' : ''].filter(Boolean).join(' | ') || '-')}</td>
    </tr>`);

    const managementActions = actionButtons([
      { view: 'exceptions', label: 'Review exceptions' },
      { view: 'otifrisk', label: 'Review OTIF risk' },
      { view: 'clearance', label: 'Review clearance' },
      { view: 'paymentexposure', label: 'Review payments' },
      { view: 'dqcockpit', label: 'Review data quality' },
      { view: 'workload', label: 'Review workload' },
      { view: 'managementpack', label: 'Open management pack' }
    ]);

    viewEl.innerHTML = `
      ${pageHead('Management Cockpit', 'One-page procurement and logistics control room for the active entity.', navButton('managementpack', 'Open Management Pack'))}
      <div class="mgmt-summary-grid">
        ${managementTile('exceptions', 'danger', 'Critical exceptions', criticalExceptions, 'stuck order controls')}
        ${managementTile('otifrisk', 'warn', 'High OTIF risk', highOtif, 'orders at risk')}
        ${managementTile('clearance', 'warn', 'Clearance risk', clearanceRisk, 'shipment controls')}
        ${managementTile('paymentexposure', 'primary', 'Payment due / overdue', paymentRisk, 'next 7 days')}
        ${managementTile('dqcockpit', 'danger', 'Data quality critical', dqCritical, 'blocking fields')}
        ${managementTile('workload', 'neutral', 'Officer pressure', ownerPressure.length, 'owners to review')}
      </div>

      <div class="mgmt-band">
        <div class="mgmt-band-head">
          <div><h3>Management priorities</h3><span>Critical items ranked across orders, shipments, payments, and data quality.</span></div>
          <div class="mgmt-actions">${managementActions}</div>
        </div>
        ${miniTable(['Priority','Area','Ref','Supplier','Owner','Date','Control signal'], priorityRows, 'No immediate management-priority items for this entity.')}
      </div>

      <div class="mgmt-split">
        <div class="mgmt-band">
          <div class="mgmt-band-head">
            <div><h3>Next 7 days</h3><span>Due dates and operational events requiring attention.</span></div>
            <div class="mgmt-actions">${actionButtons([{ view: 'opcalendar', label: 'Open calendar' }, { view: 'paymentexposure', label: 'Review payments' }])}</div>
          </div>
          ${miniTable(['Band','Type','Ref','Date','Owner','Detail'], deadlineRows, 'No due or overdue events in the next 7 days.')}
        </div>

        <div class="mgmt-band">
          <div class="mgmt-band-head">
            <div><h3>Owner pressure</h3><span>Officers with critical, due-soon, or heavy open workload.</span></div>
            <div class="mgmt-actions">${navButton('workload', 'Review workload')}</div>
          </div>
          ${miniTable(['Officer','Critical','Due soon','Orders','Shipments','Payments','Total'], workloadRows, 'No workload pressure signals for this entity.')}
        </div>
      </div>

      <div class="mgmt-band">
        <div class="mgmt-band-head">
          <div><h3>Supplier weak spots</h3><span>Lowest-rated suppliers by live operational performance.</span></div>
          <div class="mgmt-actions">${navButton('scorecards', 'Open scorecards')}</div>
        </div>
        ${miniTable(['Supplier','Rating','OTIF','Open POs','Signals'], supplierRows, 'No supplier below rating threshold.')}
      </div>`;
  }

  function renderOtifRisk() {
    const viewEl = $('#view-otifrisk');
    if (!viewEl) return;
    const ent = currentEntity();
    const rows = buildOtifRisk(ent);
    viewEl.innerHTML = `
      ${pageHead('OTIF Risk Forecast', 'Predicted on-time/in-full risk before the requested receipt date.', `<button class="btn btn-sm" id="otif-export">⤓ Export Excel</button>`)}
      <div class="kpi-pill-row">
        <div class="kpi-pill"><div class="kpi-pill-label">High risk</div><div class="kpi-pill-value">${rows.filter(r => r.score >= 75).length}</div></div>
        <div class="kpi-pill"><div class="kpi-pill-label">Medium risk</div><div class="kpi-pill-value">${rows.filter(r => r.score >= 45 && r.score < 75).length}</div></div>
        <div class="kpi-pill"><div class="kpi-pill-label">Watch</div><div class="kpi-pill-value">${rows.filter(r => r.score < 45).length}</div></div>
      </div>
      ${miniTable(['Risk','Score','PO','Supplier','Req. Receipt','Owner','Signals'], rows.map(r => `<tr onclick="openOrderDetail('${r.order.id}')" style="cursor:pointer"><td>${badge(riskLabel(r.score), r.level)}</td><td class="num">${r.score}</td><td class="mono">${escapeHtml(r.order.orderId || '-')}</td><td>${escapeHtml(r.order.supplier || '-')}</td><td>${fmtDate(r.order.requestedReceiptDate) || '-'}</td><td>${escapeHtml(orderOwner(r.order))}</td><td>${escapeHtml(r.signals.join(' | '))}</td></tr>`), 'No active OTIF risk signals.')}
    `;
    $('#otif-export')?.addEventListener('click', () => exportRows(rows.map(r => ({ Risk: riskLabel(r.score), Score: r.score, PO: r.order.orderId || '', Supplier: r.order.supplier || '', RequestedReceipt: fmtDate(r.order.requestedReceiptDate), Owner: orderOwner(r.order), Signals: r.signals.join(' | ') })), 'otif-risk-' + ent));
  }

  function renderWorkload() {
    const viewEl = $('#view-workload');
    if (!viewEl) return;
    const ent = currentEntity();
    const rows = buildOfficerWorkload(ent);
    viewEl.innerHTML = `
      ${pageHead('Officer Workload & SLA', 'Open workload by officer across orders, shipments, payments, issues, and update requests.', `<button class="btn btn-sm" id="workload-export">⤓ Export Excel</button>`)}
      ${miniTable(['Officer','Open orders','Shipments','Payments','Issues','Update requests','Due soon','Critical/overdue','Total'], rows.map(r => `<tr><td>${escapeHtml(r.name)} <span class="text-xs text-muted">(${escapeHtml(r.code)})</span></td><td class="num">${r.orders}</td><td class="num">${r.shipments}</td><td class="num">${r.payments}</td><td class="num">${r.issues}</td><td class="num">${r.updateRequests}</td><td class="num">${r.dueSoon ? badge(String(r.dueSoon), 'warn') : '0'}</td><td class="num">${r.critical ? badge(String(r.critical), 'danger') : '0'}</td><td class="num" style="font-weight:700">${r.total}</td></tr>`), 'No officer workload for this entity.')}
    `;
    $('#workload-export')?.addEventListener('click', () => exportRows(rows.map(r => ({ Officer: r.name, Code: r.code, Orders: r.orders, Shipments: r.shipments, Payments: r.payments, Issues: r.issues, UpdateRequests: r.updateRequests, DueSoon: r.dueSoon, Critical: r.critical, Total: r.total })), 'officer-workload-' + ent));
  }

  function renderPartials() {
    const viewEl = $('#view-partials');
    if (!viewEl) return;
    const ent = currentEntity();
    const groups = buildPartialShipments(ent);
    const rows = groups.map(g => `<tr ${g.order ? `onclick="openOrderDetail('${g.order.id}')" style="cursor:pointer"` : ''}><td class="mono">${escapeHtml(g.orderId || '-')}</td><td>${escapeHtml(g.order?.supplier || '-')}</td><td>${g.shipments.map(s => `<button class="btn btn-sm btn-ghost" onclick="event.stopPropagation(); openShipmentDetail('${s.id}')">${escapeHtml(s.shipmentId || s.orderId || 'Shipment')}</button>`).join(' ')}</td><td>${escapeHtml(g.shipments.map(s => s.status || s.stage || '-').join(' | '))}</td><td>${escapeHtml(g.flags.join(' | '))}</td></tr>`);
    viewEl.innerHTML = `${pageHead('Partial Shipment Control', 'PO-level view of split, balance, replacement, and receipt-exception shipments.', `<button class="btn btn-sm" id="partial-export">⤓ Export Excel</button>`)}${miniTable(['PO','Supplier','Shipments','Status','Control signal'], rows, 'No partial or split shipment controls are open.')}`;
    $('#partial-export')?.addEventListener('click', () => exportRows(groups.map(g => ({ PO: g.orderId, Supplier: g.order?.supplier || '', Shipments: g.shipments.map(s => s.shipmentId || s.orderId).join(' | '), Status: g.shipments.map(s => s.status || s.stage || '').join(' | '), Flags: g.flags.join(' | ') })), 'partial-shipments-' + ent));
  }

  function renderClearance() {
    const viewEl = $('#view-clearance');
    if (!viewEl) return;
    const ent = currentEntity();
    const rows = buildClearanceRows(ent);
    viewEl.innerHTML = `
      ${pageHead('Clearance Readiness', 'Broker documents, ETA/arrival, clearance owner, release and GRN readiness.', `<button class="btn btn-sm" id="clearance-export">⤓ Export Excel</button>`)}
      <div class="kpi-pill-row">
        <div class="kpi-pill"><div class="kpi-pill-label">At risk</div><div class="kpi-pill-value">${rows.filter(r => r.score >= 45).length}</div></div>
        <div class="kpi-pill"><div class="kpi-pill-label">ETA <= 7d</div><div class="kpi-pill-value">${rows.filter(r => r.etaDays !== null && r.etaDays <= 7).length}</div></div>
        <div class="kpi-pill"><div class="kpi-pill-label">No owner</div><div class="kpi-pill-value">${rows.filter(r => !r.shipment.clearanceOwner).length}</div></div>
      </div>
      ${miniTable(['Risk','Shipment','Supplier','ETA','Docs','Broker docs','Owner','Signals'], rows.map(r => `<tr onclick="openShipmentDetail('${r.shipment.id}')" style="cursor:pointer"><td>${r.score ? badge(riskLabel(r.score), r.level) : badge('OK', 'success')}</td><td class="mono">${escapeHtml(r.shipment.shipmentId || r.shipment.orderId || '-')}</td><td>${escapeHtml(r.order?.supplier || '-')}</td><td>${fmtDate(r.shipment.eta) || '-'}</td><td>${r.docs.total ? `${r.docs.received}/${r.docs.total}` : '-'}</td><td>${fmtDate(r.shipment.docsToBrokerDate) || '-'}</td><td>${escapeHtml(officerName(r.shipment.clearanceOwner))}</td><td>${escapeHtml(r.signals.join(' | ') || 'On track')}</td></tr>`), 'No active foreign shipments need clearance follow-up.')}
    `;
    $('#clearance-export')?.addEventListener('click', () => exportRows(rows.map(r => ({ Risk: riskLabel(r.score), Score: r.score, Shipment: r.shipment.shipmentId || r.shipment.orderId || '', PO: r.shipment.orderId || '', Supplier: r.order?.supplier || '', ETA: fmtDate(r.shipment.eta), DocsReady: r.docs.total ? `${r.docs.received}/${r.docs.total}` : '', DocsToBroker: fmtDate(r.shipment.docsToBrokerDate), Owner: r.shipment.clearanceOwner || '', Signals: r.signals.join(' | ') })), 'clearance-readiness-' + ent));
  }

  function renderPaymentExposure() {
    const viewEl = $('#view-paymentexposure');
    if (!viewEl) return;
    const ent = currentEntity();
    const data = buildPaymentExposure(ent);
    const totalByCur = data.buckets.map(b => `<tr><td>${escapeHtml(b.currency)}</td><td class="num">${money(b.overdue, b.currency)}</td><td class="num">${money(b.due7, b.currency)}</td><td class="num">${money(b.due30, b.currency)}</td><td class="num">${money(b.later, b.currency)}</td><td class="num" style="font-weight:700">${money(b.total, b.currency)}</td><td class="num">${b.count}</td></tr>`);
    const rows = data.rows.slice(0, 80).map(r => {
      const d = r.daysUntil ?? daysUntil(r.forecastDate || r.dueDate);
      const cls = d !== null && d < 0 ? 'danger' : d !== null && d <= 7 ? 'warn' : 'neutral';
      return `<tr ${r.orderDocId ? `onclick="openOrderDetail('${r.orderDocId}')" style="cursor:pointer"` : ''}><td>${badge(d === null ? 'Undated' : d < 0 ? 'Overdue' : d <= 7 ? 'Due <=7d' : d <= 30 ? 'Due <=30d' : 'Later', cls)}</td><td class="mono">${escapeHtml(r.rfpRef || r.orderId || '-')}</td><td>${escapeHtml(r.supplier || '-')}</td><td>${fmtDate(r.forecastDate || r.dueDate) || '-'}</td><td class="num">${money(r.amount, r.currency)}</td><td>${escapeHtml(r.source || '-')}</td></tr>`;
    });
    viewEl.innerHTML = `${pageHead('Payment Exposure', 'Forthcoming and open-payment exposure by currency, due band, supplier and PO.', `<button class="btn btn-sm" id="paymentexp-export">⤓ Export Excel</button>`)}${miniTable(['Currency','Overdue','Due <=7d','Due <=30d','Later','Total','Items'], totalByCur, 'No payment exposure found.')}${miniTable(['Band','Ref / PO','Supplier','Date','Amount','Source'], rows, 'No payment rows found.')}`;
    $('#paymentexp-export')?.addEventListener('click', () => exportRows(data.rows.map(r => ({ BandDays: r.daysUntil ?? daysUntil(r.forecastDate || r.dueDate), Ref: r.rfpRef || '', PO: r.orderId || '', Supplier: r.supplier || '', Date: fmtDate(r.forecastDate || r.dueDate), Currency: r.currency || '', Amount: r.amount || '', Source: r.source || '' })), 'payment-exposure-' + ent));
  }

  function renderCalendar() {
    const viewEl = $('#view-opcalendar');
    if (!viewEl) return;
    const ent = currentEntity();
    const f = state.filters.opcalendar || (state.filters.opcalendar = { range: 60, type: '' });
    let rows = buildCalendar(ent, Number(f.range) || 60);
    if (f.type) rows = rows.filter(r => r.type === f.type);
    const types = [...new Set(buildCalendar(ent, Number(f.range) || 60).map(r => r.type))].sort();
    viewEl.innerHTML = `
      ${pageHead('Operational Calendar', 'Upcoming receipt, shipment, clearance, payment, follow-up, and update-request dates.', `<button class="btn btn-sm" id="cal-export">⤓ Export Excel</button>`)}
      <div class="toolbar">
        <select id="cal-range"><option value="30" ${String(f.range)==='30'?'selected':''}>Next 30 days</option><option value="60" ${String(f.range)==='60'?'selected':''}>Next 60 days</option><option value="90" ${String(f.range)==='90'?'selected':''}>Next 90 days</option></select>
        <select id="cal-type"><option value="">All event types</option>${types.map(t => `<option value="${escapeHtml(t)}" ${f.type===t?'selected':''}>${escapeHtml(t)}</option>`).join('')}</select>
        <div class="filter-count">${rows.length}</div>
      </div>
      ${miniTable(['Date','Days','Type','Record','Detail','Owner'], rows.map(r => `<tr ${r.go ? `onclick="${r.go}" style="cursor:pointer"` : ''}><td>${fmtDate(r.date) || '-'}</td><td>${badge(String(r.days), r.level)}</td><td>${escapeHtml(r.type)}</td><td class="mono">${escapeHtml(r.label)}</td><td>${escapeHtml(r.detail || '-')}</td><td>${escapeHtml(r.owner || '-')}</td></tr>`), 'No events in this range.')}
    `;
    $('#cal-range')?.addEventListener('change', e => { f.range = e.target.value; renderCalendar(); });
    $('#cal-type')?.addEventListener('change', e => { f.type = e.target.value; renderCalendar(); });
    $('#cal-export')?.addEventListener('click', () => exportRows(rows.map(r => ({ Date: fmtDate(r.date), Days: r.days, Type: r.type, Record: r.label, Detail: r.detail, Owner: r.owner })), 'operational-calendar-' + ent));
  }

  function managementPackRows(ent) {
    const data = buildManagementData(ent);
    const rows = [];
    data.exceptions.slice(0, 30).forEach(({ order, check }) => rows.push({ Section: 'Exceptions', Priority: check.level, Record: order.orderId || '', Supplier: order.supplier || '', Owner: orderOwner(order), Date: '', Amount: '', Detail: check.msg }));
    data.otifRisk.slice(0, 30).forEach(r => rows.push({ Section: 'OTIF Risk', Priority: riskLabel(r.score), Record: r.order.orderId || '', Supplier: r.order.supplier || '', Owner: orderOwner(r.order), Date: fmtDate(r.order.requestedReceiptDate), Amount: '', Detail: r.signals.join(' | ') }));
    data.clearance.filter(r => r.score > 0).slice(0, 30).forEach(r => rows.push({ Section: 'Clearance', Priority: riskLabel(r.score), Record: r.shipment.shipmentId || r.shipment.orderId || '', Supplier: r.order?.supplier || '', Owner: r.shipment.clearanceOwner || r.shipment.logisticOfficer || '', Date: fmtDate(r.shipment.eta), Amount: '', Detail: r.signals.join(' | ') }));
    data.payments.rows.filter(r => (r.daysUntil ?? daysUntil(r.forecastDate || r.dueDate)) <= 30).slice(0, 30).forEach(r => rows.push({ Section: 'Payment Exposure', Priority: (r.daysUntil ?? daysUntil(r.forecastDate || r.dueDate)) < 0 ? 'Overdue' : 'Due', Record: r.rfpRef || r.orderId || '', Supplier: r.supplier || '', Owner: '', Date: fmtDate(r.forecastDate || r.dueDate), Amount: `${r.currency || ''} ${r.amount || ''}`, Detail: r.source || '' }));
    data.partials.slice(0, 30).forEach(g => rows.push({ Section: 'Partial Shipments', Priority: 'Control', Record: g.orderId || '', Supplier: g.order?.supplier || '', Owner: orderOwner(g.order || {}), Date: '', Amount: '', Detail: g.flags.join(' | ') }));
    data.scorecards.filter(s => s.rating < 60).slice(0, 20).forEach(s => rows.push({ Section: 'Supplier Reliability', Priority: 'Low rating', Record: '', Supplier: s.supplier, Owner: '', Date: '', Amount: '', Detail: `Rating ${s.rating}; OTIF ${s.otif ?? '-'}; open POs ${s.openOrders}` }));
    return rows;
  }

  function managementPackSummary(ent) {
    const data = buildManagementData(ent);
    const rows = managementPackRows(ent);
    const criticalExceptions = data.exceptions.filter(x => x.check.level === 'danger').length;
    const highOtif = data.otifRisk.filter(r => r.score >= 75).length;
    const clearanceRisk = data.clearance.filter(r => r.score >= 45).length;
    const paymentDue = data.payments.rows.filter(r => (r.daysUntil ?? daysUntil(r.forecastDate || r.dueDate)) <= 7).length;
    const paymentOverdue = data.payments.rows.filter(r => (r.daysUntil ?? daysUntil(r.forecastDate || r.dueDate)) < 0).length;
    const partialControls = data.partials.length;
    const weakSuppliers = data.scorecards.filter(s => s.rating < 60).length;
    const officerPressure = data.workload.filter(r => r.critical || r.dueSoon || r.total >= 8).length;
    const focusAreas = [];
    if (criticalExceptions) focusAreas.push('exceptions');
    if (highOtif) focusAreas.push('OTIF risk');
    if (clearanceRisk) focusAreas.push('clearance');
    if (paymentOverdue || paymentDue) focusAreas.push('payments');
    if (partialControls) focusAreas.push('partial shipments');
    if (weakSuppliers) focusAreas.push('supplier reliability');
    if (officerPressure) focusAreas.push('officer workload');
    return {
      entity: ent,
      generatedAt: new Date().toISOString(),
      packLines: rows.length,
      sectionCount: new Set(rows.map(r => r.Section)).size,
      criticalExceptions,
      highOtif,
      clearanceRisk,
      paymentDue,
      paymentOverdue,
      partialControls,
      weakSuppliers,
      officerPressure,
      focusAreas,
      narrative: focusAreas.length
        ? `Management focus: ${focusAreas.join(', ')}.`
        : 'No major management exceptions are currently open for this entity.'
    };
  }

  function managementPackExportRows(ent) {
    const summary = managementPackSummary(ent);
    return [
      { Section: 'Executive Summary', Priority: 'Summary', Record: summary.entity, Supplier: '', Owner: '', Date: fmtDate(new Date()), Amount: '', Detail: summary.narrative },
      { Section: 'Executive Summary', Priority: 'Critical exceptions', Record: '', Supplier: '', Owner: '', Date: '', Amount: '', Detail: String(summary.criticalExceptions) },
      { Section: 'Executive Summary', Priority: 'High OTIF risk', Record: '', Supplier: '', Owner: '', Date: '', Amount: '', Detail: String(summary.highOtif) },
      { Section: 'Executive Summary', Priority: 'Clearance risk', Record: '', Supplier: '', Owner: '', Date: '', Amount: '', Detail: String(summary.clearanceRisk) },
      { Section: 'Executive Summary', Priority: 'Payment due <=7d', Record: '', Supplier: '', Owner: '', Date: '', Amount: '', Detail: String(summary.paymentDue) },
      { Section: 'Executive Summary', Priority: 'Officer pressure', Record: '', Supplier: '', Owner: '', Date: '', Amount: '', Detail: String(summary.officerPressure) },
      ...managementPackRows(ent)
    ];
  }

  function renderManagementPack() {
    const viewEl = $('#view-managementpack');
    if (!viewEl) return;
    const ent = currentEntity();
    const rows = managementPackRows(ent);
    const summary = managementPackSummary(ent);
    viewEl.innerHTML = `${pageHead('Monthly Management Pack', 'One-click control extract for weekly or monthly procurement/logistics review.', `<button class="btn btn-primary" id="pack-export">Export Pack CSV</button>`)}
      <div class="kpi-pill-row">
        <div class="kpi-pill"><div class="kpi-pill-label">Pack lines</div><div class="kpi-pill-value">${rows.length}</div></div>
        <div class="kpi-pill"><div class="kpi-pill-label">Sections</div><div class="kpi-pill-value">${new Set(rows.map(r => r.Section)).size}</div></div>
        <div class="kpi-pill"><div class="kpi-pill-label">Critical exceptions</div><div class="kpi-pill-value">${summary.criticalExceptions}</div></div>
        <div class="kpi-pill"><div class="kpi-pill-label">High OTIF risk</div><div class="kpi-pill-value">${summary.highOtif}</div></div>
        <div class="kpi-pill"><div class="kpi-pill-label">Payments due</div><div class="kpi-pill-value">${summary.paymentDue}</div></div>
      </div>
      <div class="mgmt-band">
        <div class="mgmt-band-head"><div><h3>Executive summary</h3><span>Auto-generated operating focus for the current weekly/monthly pack.</span></div></div>
        <div class="info-banner">${escapeHtml(summary.narrative)}</div>
        ${miniTable(['Signal','Count'], [
          `<tr><td>Critical exceptions</td><td class="num">${summary.criticalExceptions}</td></tr>`,
          `<tr><td>High OTIF risk</td><td class="num">${summary.highOtif}</td></tr>`,
          `<tr><td>Clearance risk</td><td class="num">${summary.clearanceRisk}</td></tr>`,
          `<tr><td>Payment due <= 7d</td><td class="num">${summary.paymentDue}</td></tr>`,
          `<tr><td>Officer pressure</td><td class="num">${summary.officerPressure}</td></tr>`
        ], 'No summary signals.')}
      </div>
      ${miniTable(['Section','Priority','Record','Supplier','Owner','Date','Amount','Detail'], rows.slice(0, 120).map(r => `<tr><td>${escapeHtml(r.Section)}</td><td>${escapeHtml(r.Priority)}</td><td class="mono">${escapeHtml(r.Record)}</td><td>${escapeHtml(r.Supplier)}</td><td>${escapeHtml(r.Owner)}</td><td>${escapeHtml(r.Date)}</td><td>${escapeHtml(r.Amount)}</td><td>${escapeHtml(r.Detail)}</td></tr>`), 'No management-pack exceptions for this entity.')}`;
    $('#pack-export')?.addEventListener('click', () => exportRows(managementPackExportRows(ent), 'management-pack-' + ent));
  }

  window.PXManagementControls = {
    buildExceptions, buildOtifRisk, buildOfficerWorkload, buildPartialShipments,
    buildClearanceRows, buildPaymentExposure, buildCalendar, buildManagementData,
    managementPackRows, managementPackSummary, managementPackExportRows
  };
  window.__renderers['mgmtcockpit'] = renderManagementCockpit;
  window.__renderers['otifrisk'] = renderOtifRisk;
  window.__renderers['workload'] = renderWorkload;
  window.__renderers['partials'] = renderPartials;
  window.__renderers['clearance'] = renderClearance;
  window.__renderers['paymentexposure'] = renderPaymentExposure;
  window.__renderers['opcalendar'] = renderCalendar;
  window.__renderers['managementpack'] = renderManagementPack;
  window.__mgmtCockpitCount = () => {
    const ent = currentEntity();
    const data = buildManagementData(ent);
    return data.exceptions.filter(x => x.check.level === 'danger').length
      + data.otifRisk.filter(x => x.score >= 75).length
      + data.clearance.filter(x => x.score >= 75).length
      + data.payments.rows.filter(x => (x.daysUntil ?? daysUntil(x.forecastDate || x.dueDate)) < 0).length;
  };
  window.__otifRiskCount = () => buildOtifRisk(currentEntity()).filter(x => x.score >= 45).length;
  window.__clearanceRiskCount = () => buildClearanceRows(currentEntity()).filter(x => x.score >= 45).length;
  window.__paymentExposureCount = () => buildPaymentExposure(currentEntity()).rows.filter(x => (x.daysUntil ?? daysUntil(x.forecastDate || x.dueDate)) <= 7).length;
})();
