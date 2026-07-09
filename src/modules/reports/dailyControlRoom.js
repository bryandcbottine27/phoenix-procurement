/* dailyControlRoom.js - operating cadence views over existing control engines.
   Adds read-only daily/weekly/monthly control surfaces without creating a new
   collection or changing the Phoenix/ERP ownership boundary. */
const { $, fmtDate, fmtMoney, escapeHtml, currentEntity, recordEntity, entityMeta,
  orderFunction, cmExportCSV } = window.PXUtils;
const state = window.__state;

(function () {
  const DAY = 86400000;
  const VALID_FUNCTIONS = new Set(['technical', 'indirect', 'supplychain']);
  const VALID_ORDER_TYPES = new Set(['foreign', 'local']);

  function asDate(value) {
    if (!value) return null;
    const date = value.toDate ? value.toDate() : (value instanceof Date ? value : new Date(value));
    return date && !isNaN(date) ? date : null;
  }
  function dayStart(value) {
    const date = asDate(value);
    if (!date) return null;
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }
  function daysUntil(value) {
    const target = dayStart(value);
    if (!target) return null;
    const today = dayStart(new Date());
    return Math.round((target - today) / DAY);
  }
  function daysSince(value) {
    const days = daysUntil(value);
    return days === null ? null : -days;
  }
  function workingSince(value, entity) {
    return window.PXUtils.workingDaysSince ? window.PXUtils.workingDaysSince(value, entity) : daysSince(value);
  }
  function workingUntil(value, entity) {
    return window.PXUtils.workingDaysUntil ? window.PXUtils.workingDaysUntil(value, entity) : daysUntil(value);
  }
  function activeOrders(ent) {
    return (state.data.orders || []).filter(order => !order.archived && !order.isClosed && recordEntity(order) === ent);
  }
  function orderOwner(order) {
    return [order.officerCode, order.logisticOfficer].filter(Boolean).join(' / ') || '-';
  }
  function officerName(code) {
    const officer = (state.data.officers || []).find(item => item.code === code);
    return officer ? (officer.fullName || officer.code) : (code || '-');
  }
  function badge(text, cls) {
    return `<span class="badge ${cls || 'neutral'}">${escapeHtml(text)}</span>`;
  }
  function priorityClass(score) {
    return score >= 80 ? 'danger' : score >= 45 ? 'warn' : 'accent';
  }
  function priorityLabel(score) {
    return score >= 80 ? 'Critical' : score >= 45 ? 'Due' : 'Watch';
  }
  function pageHead(title, desc, actionHtml) {
    const ent = currentEntity();
    const meta = entityMeta(ent) || {};
    return `<div class="page-head"><div class="title"><h1>${escapeHtml(title)} <span class="badge" style="background:${meta.accent || '#888'};color:#fff;font-size:11px;vertical-align:middle">${escapeHtml(meta.code || ent)}</span></h1><span class="desc">${escapeHtml(desc)}</span></div>${actionHtml ? `<div class="page-actions">${actionHtml}</div>` : ''}</div>`;
  }
  function miniTable(headers, rows, empty) {
    return `<div class="table-wrap"><table class="data"><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="empty-state"><h3>${escapeHtml(empty)}</h3></td></tr>`}</tbody></table></div>`;
  }
  function navButton(view, label) {
    if (window.__viewLevel && window.__viewLevel(view) === 'none') return '';
    return `<button class="btn btn-sm" onclick="navigate('${view}')">${escapeHtml(label)}</button>`;
  }
  function exportRows(rows, filename) {
    if (cmExportCSV) {
      cmExportCSV(rows, filename);
      return;
    }
    const headers = Object.keys(rows[0] || { Empty: '' });
    const escapeCell = value => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
    const csv = [headers.join(','), ...rows.map(row => headers.map(header => escapeCell(row[header])).join(','))].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = filename + '.csv';
    link.click();
  }
  function managementData(ent) {
    const MC = window.PXManagementControls;
    return MC && MC.buildManagementData ? MC.buildManagementData(ent) : {
      exceptions: [], otifRisk: [], workload: [], partials: [],
      clearance: [], payments: { rows: [], buckets: [] }, calendar: [], scorecards: []
    };
  }
  function latestContact(order) {
    return (state.data.contactLog || [])
      .filter(item => !item.archived && (item.orderDocId === order.id || item.orderId === order.orderId || item.relatedId === order.id))
      .map(item => ({ item, date: asDate(item.contactDate || item.createdAt) }))
      .filter(entry => entry.date)
      .sort((a, b) => b.date - a.date)[0]?.item || null;
  }
  function responseExpectedContact(order) {
    return (state.data.contactLog || [])
      .filter(item => !item.archived && (item.orderDocId === order.id || item.orderId === order.orderId || item.relatedId === order.id) && item.responseExpectedBy)
      .map(item => ({ item, days: workingUntil(item.responseExpectedBy, recordEntity(order)) }))
      .filter(entry => entry.days !== null && entry.days <= 3)
      .sort((a, b) => a.days - b.days)[0] || null;
  }
  function addSignal(list, key, score, label, dueDate, detail) {
    list.push({ key, score, label, dueDate, detail: detail || label });
  }

  function buildSupplierChasePlan(ent) {
    const PF = window.PXProcFollowup;
    const ctx = PF ? PF.context() : null;
    const rows = [];
    activeOrders(ent).forEach(order => {
      const entity = recordEntity(order);
      const signals = [];
      const sentAge = workingSince(order.orderSentToSupplierDate, entity);
      if (order.orderSentToSupplierDate && !order.orderAcknowledgedDate && sentAge !== null && sentAge > 3) {
        addSignal(signals, 'acknowledgement', 42, 'Supplier acknowledgement overdue', order.orderSentToSupplierDate, `${sentAge} working day(s) since PO sent`);
      }

      const commitment = PF ? PF.commitment(order, ctx) : null;
      if (commitment && commitment.current && commitment.daysUntil !== null) {
        if (commitment.overdue) addSignal(signals, 'promise', 55, 'Supplier promise overdue', commitment.current, `${Math.abs(commitment.daysUntil)} working day(s) overdue`);
        else if (commitment.daysUntil <= 7) addSignal(signals, 'promise', 20, 'Supplier promise approaching', commitment.current, `Due in ${commitment.daysUntil} working day(s)`);
      } else if (order.orderAcknowledgedDate) {
        addSignal(signals, 'promise-missing', 18, 'Supplier promise missing', order.orderAcknowledgedDate, 'Acknowledged PO has no supplier commitment date');
      }

      const chase = PF ? PF.nextChase(order) : null;
      if (chase && chase.next && chase.daysUntil !== null) {
        if (chase.overdue) addSignal(signals, 'next-chase', 48, 'Next supplier chase overdue', chase.next, `${Math.abs(chase.daysUntil)} working day(s) overdue`);
        else if (chase.dueSoon) addSignal(signals, 'next-chase', 28, 'Next supplier chase due soon', chase.next, `Due in ${chase.daysUntil} working day(s)`);
      }

      const expected = responseExpectedContact(order);
      if (expected) {
        const score = expected.days < 0 ? 45 : 24;
        addSignal(signals, 'reply-expected', score, expected.days < 0 ? 'Supplier reply overdue' : 'Supplier reply due soon', expected.item.responseExpectedBy, expected.item.summary || 'Reply expected from supplier');
      }

      const last = latestContact(order);
      const cadence = Number(order.followupFrequencyDays || 0) || 7;
      const lastAge = last ? workingSince(last.contactDate || last.createdAt, entity) : null;
      if (!last && order.orderSentToSupplierDate && sentAge !== null && sentAge > 5) {
        addSignal(signals, 'no-contact', 24, 'No contact log after PO sent', order.orderSentToSupplierDate, `${sentAge} working day(s) since PO sent`);
      } else if (lastAge !== null && lastAge > cadence) {
        addSignal(signals, 'cadence', 22, 'Follow-up cadence missed', last.contactDate || last.createdAt, `${lastAge} working day(s) since last contact`);
      }

      const checks = PF ? PF.orderChecks(order, ctx) : [];
      const selected = checks.filter(check => [
        'ready-no-shipment',
        'requested-receipt-overdue',
        'requested-receipt-approaching'
      ].includes(check.key));
      selected.forEach(check => addSignal(signals, check.key, check.level === 'danger' ? 44 : 18, check.msg, order.requestedReceiptDate || order.orderReadyDate, check.msg));

      if (!signals.length) return;
      const score = Math.min(100, signals.reduce((sum, item) => sum + item.score, 0));
      const firstDue = signals.map(item => asDate(item.dueDate)).filter(Boolean).sort((a, b) => a - b)[0] || null;
      const action = recommendedSupplierAction(order, signals);
      rows.push({
        order,
        supplier: order.supplier || '-',
        owner: order.officerCode || order.logisticOfficer || '-',
        score,
        level: priorityClass(score),
        dueDate: firstDue,
        action,
        signals
      });
    });
    rows.sort((a, b) => b.score - a.score || ((asDate(a.dueDate) || 0) - (asDate(b.dueDate) || 0)));

    const groups = new Map();
    rows.forEach(row => {
      const key = String(row.supplier || '-').trim().toLowerCase() || '-';
      const group = groups.get(key) || {
        supplier: row.supplier || '-',
        orders: 0,
        critical: 0,
        dueSoon: 0,
        valueByCurrency: {},
        owners: new Set(),
        actions: new Set(),
        nextDue: null,
        topScore: 0,
        orderIds: []
      };
      group.orders += 1;
      if (row.score >= 80) group.critical += 1;
      else group.dueSoon += 1;
      group.topScore = Math.max(group.topScore, row.score);
      group.owners.add(row.owner || '-');
      group.actions.add(row.action);
      group.orderIds.push(row.order.orderId || '-');
      const amount = Number(row.order.amount || 0);
      const currency = row.order.currency || '-';
      if (amount) group.valueByCurrency[currency] = (group.valueByCurrency[currency] || 0) + amount;
      const due = asDate(row.dueDate);
      if (due && (!group.nextDue || due < group.nextDue)) group.nextDue = due;
      groups.set(key, group);
    });
    return {
      rows,
      groups: [...groups.values()].sort((a, b) => b.topScore - a.topScore || b.orders - a.orders)
    };
  }

  function recommendedSupplierAction(order, signals) {
    const keys = new Set(signals.map(item => item.key));
    if (keys.has('acknowledgement')) return 'Request acknowledgement';
    if (keys.has('promise') || keys.has('supplier-promise-overdue')) return 'Confirm revised promise';
    if (keys.has('ready-no-shipment')) return 'Handover ready goods to logistics';
    if (keys.has('reply-expected')) return 'Chase supplier response';
    if (keys.has('requested-receipt-overdue')) return 'Escalate delivery recovery';
    if (order.escalationOwner || order.escalationLevel) return 'Update escalation';
    return 'Log supplier chase';
  }

  function buildExceptionWorkbench(ent) {
    const rows = [];
    const PF = window.PXProcFollowup;

    activeOrders(ent).forEach(order => {
      const rawFunction = String(order.function || '').trim().toLowerCase();
      const resolvedFunction = String(orderFunction(order) || '').trim().toLowerCase();
      const rawOrderType = String(order.orderType || '').trim().toLowerCase();
      if (!rawFunction || !VALID_FUNCTIONS.has(resolvedFunction)) {
        rows.push({
          type: 'Classification',
          severity: 'warn',
          record: order.orderId || '-',
          supplier: order.supplier || '-',
          owner: orderOwner(order),
          detail: 'Order has no stored procurement function.',
          action: 'Review import rules or order function',
          go: `openOrderDetail('${order.id}')`
        });
      }
      if (!rawOrderType || !VALID_ORDER_TYPES.has(rawOrderType)) {
        rows.push({
          type: 'Classification',
          severity: 'warn',
          record: order.orderId || '-',
          supplier: order.supplier || '-',
          owner: orderOwner(order),
          detail: 'Order has no valid foreign/local order type.',
          action: 'Review order type mapping',
          go: `openOrderDetail('${order.id}')`
        });
      }
      if (PF) {
        PF.erpExceptions(order).forEach(exception => {
          rows.push({
            type: 'ERP/DW',
            severity: exception.level || 'warn',
            record: order.orderId || '-',
            supplier: order.supplier || '-',
            owner: orderOwner(order),
            detail: exception.msg,
            action: exception.key === 'supplier-unmapped' ? 'Open supplier mapping' : 'Review ERP reconciliation',
            go: exception.key === 'supplier-unmapped' ? 'window.__openSupplierMappingWorklist()' : `openOrderDetail('${order.id}')`
          });
        });
      }
    });

    const supplierGroups = window.PXSupplierMap?.unmappedImportVendors ? window.PXSupplierMap.unmappedImportVendors() : [];
    supplierGroups.filter(group => group.entity === ent).forEach(group => {
      rows.push({
        type: 'Supplier mapping',
        severity: 'warn',
        record: group.vendorNo || '-',
        supplier: group.vendorName || '-',
        owner: '-',
        detail: `${group.orderDocIds.length} imported order(s) need a supplier-master link.`,
        action: 'Resolve supplier mapping',
        go: 'window.__openSupplierMappingWorklist()'
      });
    });

    (state.data.importRuns || []).forEach(run => {
      (run.importRun?.rowErrors || run.rowErrors || []).forEach(error => {
        if (error.entity && error.entity !== ent) return;
        rows.push({
          type: 'Import error',
          severity: 'danger',
          record: error.orderId || run.importRun?.runId || run.id || '-',
          supplier: '-',
          owner: '-',
          detail: error.error || error.message || 'Import row failed.',
          action: 'Review ERP reconciliation import history',
          go: "navigate('erprecon')"
        });
      });
    });

    const rank = { danger: 0, warn: 1, info: 2 };
    return rows.sort((a, b) => (rank[a.severity] - rank[b.severity]) || a.type.localeCompare(b.type));
  }

  function buildDailyControl(ent) {
    const data = managementData(ent);
    const chase = buildSupplierChasePlan(ent);
    const exceptions = buildExceptionWorkbench(ent);
    const myWork = window.__myWorkCompute ? window.__myWorkCompute({ renderDom: false, entityOverride: ent }) : null;
    const paymentDue = data.payments.rows.filter(row => (row.daysUntil ?? daysUntil(row.forecastDate || row.dueDate)) <= 7);
    const paymentOverdue = paymentDue.filter(row => (row.daysUntil ?? daysUntil(row.forecastDate || row.dueDate)) < 0);
    const todayItems = [];
    data.exceptions.filter(item => item.check.level === 'danger').slice(0, 8).forEach(({ order, check }) => todayItems.push({
      priority: 'Critical',
      area: 'Exception',
      ref: order.orderId || '-',
      supplier: order.supplier || '-',
      owner: orderOwner(order),
      dueDate: '',
      action: check.msg,
      go: `openOrderDetail('${order.id}')`
    }));
    chase.rows.filter(row => row.score >= 45).slice(0, 8).forEach(row => todayItems.push({
      priority: priorityLabel(row.score),
      area: 'Supplier chase',
      ref: row.order.orderId || '-',
      supplier: row.supplier,
      owner: row.owner,
      dueDate: fmtDate(row.dueDate),
      action: row.action + ': ' + row.signals.map(signal => signal.label).slice(0, 2).join(' | '),
      go: `openOrderDetail('${row.order.id}')`
    }));
    data.clearance.filter(row => row.score >= 45).slice(0, 6).forEach(row => todayItems.push({
      priority: priorityLabel(row.score),
      area: 'Clearance',
      ref: row.shipment.shipmentId || row.shipment.orderId || '-',
      supplier: row.order?.supplier || '-',
      owner: row.shipment.clearanceOwner || row.shipment.logisticOfficer || '-',
      dueDate: fmtDate(row.shipment.eta),
      action: row.signals.join(' | ') || 'Clearance risk',
      go: `openShipmentDetail('${row.shipment.id}')`
    }));
    paymentDue.slice(0, 6).forEach(row => todayItems.push({
      priority: (row.daysUntil ?? daysUntil(row.forecastDate || row.dueDate)) < 0 ? 'Critical' : 'Due',
      area: 'Payment',
      ref: row.rfpRef || row.orderId || '-',
      supplier: row.supplier || '-',
      owner: '-',
      dueDate: fmtDate(row.forecastDate || row.dueDate),
      action: `${row.currency || ''} ${row.amount || ''} ${row.source || ''}`.trim(),
      go: row.orderDocId ? `openOrderDetail('${row.orderDocId}')` : ''
    }));
    exceptions.filter(row => row.severity === 'danger').slice(0, 6).forEach(row => todayItems.push({
      priority: 'Critical',
      area: row.type,
      ref: row.record,
      supplier: row.supplier,
      owner: row.owner,
      dueDate: '',
      action: row.detail,
      go: row.go
    }));
    return {
      data,
      chase,
      exceptions,
      myWork,
      paymentDue,
      paymentOverdue,
      todayItems
    };
  }

  function renderDailyControl() {
    const viewEl = $('#view-dailycontrol');
    if (!viewEl) return;
    const ent = currentEntity();
    const control = buildDailyControl(ent);
    const criticalExceptions = control.data.exceptions.filter(item => item.check.level === 'danger').length;
    const highOtif = control.data.otifRisk.filter(row => row.score >= 75).length;
    const clearanceRisk = control.data.clearance.filter(row => row.score >= 45).length;
    const supplierDue = control.chase.rows.filter(row => row.score >= 45).length;
    const workActions = control.myWork ? control.myWork.actionCount : 0;
    const exceptionWork = control.exceptions.filter(row => row.severity !== 'info').length;
    const packSummary = window.PXManagementControls?.managementPackSummary
      ? window.PXManagementControls.managementPackSummary(ent)
      : null;

    const rowHtml = control.todayItems
      .sort((a, b) => (a.priority === 'Critical' ? -1 : 0) - (b.priority === 'Critical' ? -1 : 0))
      .slice(0, 40)
      .map(row => `<tr ${row.go ? `onclick="${row.go}" style="cursor:pointer"` : ''}><td>${badge(row.priority, row.priority === 'Critical' ? 'danger' : 'warn')}</td><td>${escapeHtml(row.area)}</td><td class="mono">${escapeHtml(row.ref)}</td><td>${escapeHtml(row.supplier)}</td><td>${escapeHtml(row.owner)}</td><td>${escapeHtml(row.dueDate || '-')}</td><td>${escapeHtml(row.action)}</td></tr>`);
    const calendarRows = control.data.calendar.slice(0, 12).map(event => `<tr ${event.go ? `onclick="${event.go}" style="cursor:pointer"` : ''}><td>${fmtDate(event.date) || '-'}</td><td>${badge(String(event.days), event.level)}</td><td>${escapeHtml(event.type)}</td><td class="mono">${escapeHtml(event.label)}</td><td>${escapeHtml(event.owner || '-')}</td><td>${escapeHtml(event.detail || '-')}</td></tr>`);
    const cadenceRows = [
      ['Daily', 'Start with My Work and Daily Control Room.', `${workActions} personal action(s); ${criticalExceptions} critical exception(s).`, 'mywork'],
      ['Weekly', 'Run Supplier Chase Plan, Officer Workload and Payment Exposure.', `${supplierDue} supplier chase item(s); ${control.paymentDue.length} payment item(s) due within 7 days.`, 'supplierchase'],
      ['Monthly', 'Export Management Pack and review KPI Trends/Supplier Scorecards.', packSummary ? `${packSummary.packLines} management-pack line(s); ${packSummary.focusAreas.join(', ') || 'no major focus area'}.` : 'Open management pack for the current summary.', 'managementpack']
    ].map(row => `<tr><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${navButton(row[3], 'Open')}</td></tr>`);

    viewEl.innerHTML = `
      ${pageHead('Daily Control Room', 'Daily, weekly and monthly operating cadence from the live control engines.', `<button class="btn btn-primary" id="daily-export">Export Daily Brief</button>`)}
      <div class="mgmt-summary-grid">
        <button class="mgmt-tile danger" onclick="navigate('exceptions')"><span>Critical exceptions</span><strong>${criticalExceptions}</strong><small>stuck controls</small></button>
        <button class="mgmt-tile warn" onclick="navigate('supplierchase')"><span>Supplier chase due</span><strong>${supplierDue}</strong><small>acknowledgement, promise, reply</small></button>
        <button class="mgmt-tile warn" onclick="navigate('otifrisk')"><span>High OTIF risk</span><strong>${highOtif}</strong><small>orders at risk</small></button>
        <button class="mgmt-tile primary" onclick="navigate('paymentexposure')"><span>Payments due</span><strong>${control.paymentDue.length}</strong><small>${control.paymentOverdue.length} overdue</small></button>
        <button class="mgmt-tile neutral" onclick="navigate('clearance')"><span>Clearance risk</span><strong>${clearanceRisk}</strong><small>ETA, broker docs, owner</small></button>
        <button class="mgmt-tile danger" onclick="navigate('exceptionworkbench')"><span>Data remediation</span><strong>${exceptionWork}</strong><small>classification, mapping, import</small></button>
      </div>

      <div class="mgmt-band">
        <div class="mgmt-band-head"><div><h3>Today control queue</h3><span>Items that need management attention today across procurement, logistics, finance and data quality.</span></div><div class="mgmt-actions">${navButton('mywork', 'Open My Work')} ${navButton('mgmtcockpit', 'Open Cockpit')}</div></div>
        ${miniTable(['Priority','Area','Ref','Supplier','Owner','Date','Action'], rowHtml, 'No critical daily control items for this entity.')}
      </div>

      <div class="mgmt-split">
        <div class="mgmt-band">
          <div class="mgmt-band-head"><div><h3>Next operating dates</h3><span>Operational events from the 60-day calendar.</span></div><div class="mgmt-actions">${navButton('opcalendar', 'Open Calendar')}</div></div>
          ${miniTable(['Date','Days','Type','Record','Owner','Detail'], calendarRows, 'No upcoming control dates in the current horizon.')}
        </div>
        <div class="mgmt-band">
          <div class="mgmt-band-head"><div><h3>Operating cadence</h3><span>Daily, weekly and monthly rhythm for the control tower.</span></div></div>
          ${miniTable(['Cadence','Routine','Current signal','Link'], cadenceRows, 'No cadence rows available.')}
        </div>
      </div>
    `;
    $('#daily-export')?.addEventListener('click', () => exportRows(control.todayItems.map(row => ({
      Priority: row.priority,
      Area: row.area,
      Ref: row.ref,
      Supplier: row.supplier,
      Owner: row.owner,
      Date: row.dueDate,
      Action: row.action
    })), 'daily-control-room-' + ent));
  }

  function renderSupplierChase() {
    const viewEl = $('#view-supplierchase');
    if (!viewEl) return;
    const ent = currentEntity();
    const plan = buildSupplierChasePlan(ent);
    const summaryRows = plan.groups.map(group => {
      const amount = Object.entries(group.valueByCurrency).map(([currency, value]) => fmtMoney(value, currency)).join(' | ') || '-';
      const action = [...group.actions][0] || 'Review';
      return `<tr><td>${badge(priorityLabel(group.topScore), priorityClass(group.topScore))}</td><td>${escapeHtml(group.supplier)}</td><td class="num">${group.orders}</td><td>${escapeHtml([...group.owners].join(' / ') || '-')}</td><td>${fmtDate(group.nextDue) || '-'}</td><td>${escapeHtml(amount)}</td><td>${escapeHtml(action)}</td></tr>`;
    });
    const detailRows = plan.rows.map(row => `<tr onclick="openOrderDetail('${row.order.id}')" style="cursor:pointer"><td>${badge(priorityLabel(row.score), row.level)}</td><td class="mono">${escapeHtml(row.order.orderId || '-')}</td><td>${escapeHtml(row.supplier)}</td><td>${escapeHtml(officerName(row.owner))}</td><td>${fmtDate(row.dueDate) || '-'}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.signals.map(signal => signal.detail).join(' | '))}</td></tr>`);
    viewEl.innerHTML = `
      ${pageHead('Supplier Chase Plan', 'Grouped supplier follow-up plan for acknowledgement, promises, replies and delivery recovery.', `<button class="btn btn-sm" id="supplier-chase-export">Export Chase Plan</button>`)}
      <div class="kpi-pill-row">
        <div class="kpi-pill"><div class="kpi-pill-label">Supplier groups</div><div class="kpi-pill-value">${plan.groups.length}</div></div>
        <div class="kpi-pill"><div class="kpi-pill-label">Critical groups</div><div class="kpi-pill-value">${plan.groups.filter(group => group.topScore >= 80).length}</div></div>
        <div class="kpi-pill"><div class="kpi-pill-label">Order actions</div><div class="kpi-pill-value">${plan.rows.length}</div></div>
      </div>
      <div class="mgmt-band">
        <div class="mgmt-band-head"><div><h3>Supplier roll-up</h3><span>One line per supplier for the weekly chase meeting.</span></div></div>
        ${miniTable(['Priority','Supplier','Orders','Owners','Next due','Open value','Recommended action'], summaryRows, 'No supplier chase items are due.')}
      </div>
      <div class="mgmt-band">
        <div class="mgmt-band-head"><div><h3>Order-level chase list</h3><span>Click an order to log contact, update promise, or escalate.</span></div></div>
        ${miniTable(['Priority','PO','Supplier','Owner','Due date','Action','Signals'], detailRows, 'No order-level supplier chase items are due.')}
      </div>
    `;
    $('#supplier-chase-export')?.addEventListener('click', () => exportRows(plan.rows.map(row => ({
      Priority: priorityLabel(row.score),
      Score: row.score,
      PO: row.order.orderId || '',
      Supplier: row.supplier,
      Owner: row.owner,
      DueDate: fmtDate(row.dueDate),
      Action: row.action,
      Signals: row.signals.map(signal => signal.detail).join(' | ')
    })), 'supplier-chase-plan-' + ent));
  }

  function renderExceptionWorkbench() {
    const viewEl = $('#view-exceptionworkbench');
    if (!viewEl) return;
    const ent = currentEntity();
    const rows = buildExceptionWorkbench(ent);
    const danger = rows.filter(row => row.severity === 'danger').length;
    const supplierMap = rows.filter(row => row.type === 'Supplier mapping').length;
    const classification = rows.filter(row => row.type === 'Classification').length;
    const rowHtml = rows.map(row => `<tr ${row.go ? `onclick="${row.go}" style="cursor:pointer"` : ''}><td>${badge(row.severity === 'danger' ? 'Critical' : row.severity === 'warn' ? 'Warning' : 'Info', row.severity)}</td><td>${escapeHtml(row.type)}</td><td class="mono">${escapeHtml(row.record)}</td><td>${escapeHtml(row.supplier)}</td><td>${escapeHtml(row.owner)}</td><td>${escapeHtml(row.detail)}</td><td>${escapeHtml(row.action)}</td></tr>`);
    viewEl.innerHTML = `
      ${pageHead('Exception Workbench', 'Single remediation queue for classification, supplier mapping, ERP/DW and import exceptions.', `<button class="btn btn-sm" id="exception-workbench-export">Export Workbench</button>`)}
      <div class="info-banner">Backend sync exceptions are also available through the function-key API at /api/worklists/unclassified for BI/admin tooling. This browser view uses the live Firestore import, supplier and ERP exception signals.</div>
      <div class="kpi-pill-row">
        <div class="kpi-pill"><div class="kpi-pill-label">Open exceptions</div><div class="kpi-pill-value">${rows.length}</div></div>
        <div class="kpi-pill"><div class="kpi-pill-label">Critical</div><div class="kpi-pill-value">${danger}</div></div>
        <div class="kpi-pill"><div class="kpi-pill-label">Supplier mapping</div><div class="kpi-pill-value">${supplierMap}</div></div>
        <div class="kpi-pill"><div class="kpi-pill-label">Classification</div><div class="kpi-pill-value">${classification}</div></div>
      </div>
      <div class="mgmt-band">
        <div class="mgmt-band-head"><div><h3>Remediation queue</h3><span>Use this before testing imports or KPI packs so bad mappings do not pollute the signal.</span></div><div class="mgmt-actions">${navButton('suppliers', 'Suppliers')} ${navButton('erprecon', 'ERP Reconciliation')} ${navButton('erpimportrules', 'Import Rules')}</div></div>
        ${miniTable(['Severity','Type','Record','Supplier','Owner','Issue','Suggested action'], rowHtml, 'No open exception-workbench items for this entity.')}
      </div>
    `;
    $('#exception-workbench-export')?.addEventListener('click', () => exportRows(rows.map(row => ({
      Severity: row.severity,
      Type: row.type,
      Record: row.record,
      Supplier: row.supplier,
      Owner: row.owner,
      Issue: row.detail,
      SuggestedAction: row.action
    })), 'exception-workbench-' + ent));
  }

  window.__openSupplierMappingWorklist = function () {
    const filters = state.filters.suppliers || (state.filters.suppliers = { search: '', showArchived: false, mappingWorklist: false });
    filters.mappingWorklist = true;
    navigate('suppliers');
  };

  window.PXDailyControls = {
    buildDailyControl,
    buildSupplierChasePlan,
    buildExceptionWorkbench
  };
  window.__renderers['dailycontrol'] = renderDailyControl;
  window.__renderers['supplierchase'] = renderSupplierChase;
  window.__renderers['exceptionworkbench'] = renderExceptionWorkbench;
  window.__dailyControlCount = () => {
    const control = buildDailyControl(currentEntity());
    return control.todayItems.filter(item => item.priority === 'Critical').length;
  };
  window.__supplierChaseCount = () => buildSupplierChasePlan(currentEntity()).rows.filter(row => row.score >= 45).length;
  window.__exceptionWorkbenchCount = () => buildExceptionWorkbench(currentEntity()).filter(row => row.severity !== 'info').length;
})();
