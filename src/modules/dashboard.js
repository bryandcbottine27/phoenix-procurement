const { $, $$, fmtDate, fmtMoney, daysBetween, escapeHtml, statusBadgeClass, generateMilestonesFromTerm, computeMilestoneDate, milestoneStatus, orderFunction, currentEntity, recordEntity, entityMeta } = window.PXUtils;
const state = window.__state;
const REF = window.REF;

/* ===== Dashboard filter bar ===== */
function renderDashboardFilters(f) {
  const el = $('#dashboard-filters');
  if (!el) return;
  const orders = state.data.orders;
  const officers = [...new Set(orders.map(o => o.officerCode).filter(Boolean))].sort();
  const officerMap = Object.fromEntries(state.data.officers.map(o => [o.code, o.fullName || o.code]));
  const suppliers = [...new Set(orders.map(o => o.supplier).filter(Boolean))].sort();
  const currencies = [...new Set(orders.map(o => o.currency).filter(Boolean))].sort();
  const active = f.orderType || f.function || f.officer || f.supplier || f.currency || f.dateFrom || f.dateTo;

  el.innerHTML = `
    <div class="toolbar" style="flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <select id="df-type">
        <option value="">All orders</option>
        <option value="foreign" ${f.orderType==='foreign'?'selected':''}>Foreign only</option>
        <option value="local" ${f.orderType==='local'?'selected':''}>Local only</option>
      </select>
      <select id="df-function">
        <option value="">All functions</option>
        <option value="technical" ${f.function==='technical'?'selected':''}>Technical</option>
        <option value="indirect" ${f.function==='indirect'?'selected':''}>Indirect</option>
        <option value="supplychain" ${f.function==='supplychain'?'selected':''}>Supply Chain</option>
      </select>
      <select id="df-officer">
        <option value="">All officers</option>
        ${officers.map(o => `<option value="${escapeHtml(o)}" ${f.officer===o?'selected':''}>${escapeHtml(officerMap[o]||o)}</option>`).join('')}
      </select>
      <select id="df-supplier">
        <option value="">All suppliers</option>
        ${suppliers.map(s => `<option value="${escapeHtml(s)}" ${f.supplier===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}
      </select>
      <select id="df-currency">
        <option value="">All currencies</option>
        ${currencies.map(c => `<option value="${escapeHtml(c)}" ${f.currency===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}
      </select>
      <label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:4px">From <input type="date" id="df-from" value="${f.dateFrom||''}" style="width:auto" /></label>
      <label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:4px">To <input type="date" id="df-to" value="${f.dateTo||''}" style="width:auto" /></label>
      ${active ? '<button class="btn btn-sm" id="df-clear">Clear filters</button>' : ''}
    </div>
  `;
  const rerender = () => window.__renderers['dashboard']();
  $('#df-type').addEventListener('change', e => { f.orderType = e.target.value; rerender(); });
  $('#df-function').addEventListener('change', e => { f.function = e.target.value; rerender(); });
  $('#df-officer').addEventListener('change', e => { f.officer = e.target.value; rerender(); });
  $('#df-supplier').addEventListener('change', e => { f.supplier = e.target.value; rerender(); });
  $('#df-currency').addEventListener('change', e => { f.currency = e.target.value; rerender(); });
  $('#df-from').addEventListener('change', e => { f.dateFrom = e.target.value; rerender(); });
  $('#df-to').addEventListener('change', e => { f.dateTo = e.target.value; rerender(); });
  const clr = $('#df-clear');
  if (clr) clr.addEventListener('click', () => {
    Object.keys(f).forEach(k => f[k] = '');
    rerender();
  });
}

window.__renderers['dashboard'] = function() {
  const f = state.filters.dashboard || (state.filters.dashboard = {
    orderType: '', function: '', officer: '', supplier: '', currency: '', dateFrom: '', dateTo: ''
  });
  const viewEl = $('#view-dashboard');
  if (!viewEl) return;
  const dashEnt = currentEntity();
  const dashMeta = entityMeta(dashEnt) || {};
  const activeDashFilters = [f.orderType, f.function, f.officer, f.supplier, f.currency, f.dateFrom, f.dateTo].filter(Boolean).length;
  const actionLink = (label, view) => `<button class="bc-rc-action" onclick="navigate('${view}')">› ${escapeHtml(label)}</button>`;

  viewEl.innerHTML = `
    <div class="bc-role-center">
      <div class="bc-rc-toplinks">
        <div class="bc-rc-company">
          <strong>${escapeHtml(dashEnt)}</strong>
          ${dashMeta.short ? `<span class="badge" style="background:${dashMeta.accent || 'var(--primary)'};color:#fff">${escapeHtml(dashMeta.short)}</span>` : ''}
        </div>
        <nav class="bc-rc-links" aria-label="Dashboard shortcuts">
          <button onclick="navigate('mywork')">My Work</button>
          <button onclick="navigate('orders-foreign-technical')">Foreign Orders</button>
          <button onclick="navigate('orders-local-technical')">Local Orders</button>
          <button onclick="navigate('shipments')">Shipments</button>
          <button onclick="navigate('forecast')">Forthcoming Payments</button>
          <button onclick="navigate('reports')">Reports</button>
        </nav>
      </div>

      <div class="bc-rc-hero">
        <div class="bc-rc-summary">
          <div class="bc-rc-eyebrow">Summary</div>
          <div class="bc-rc-statement" id="dashboard-summary">Preparing ${escapeHtml(dashEnt)} overview...</div>
          <div class="bc-rc-dots"><span></span><span></span><span class="on"></span></div>
        </div>
        <div class="bc-rc-actions">
          <div class="bc-rc-actions-title">Actions</div>
          <div class="bc-rc-action-grid">
            ${actionLink('New Order', 'orders-foreign-technical')}
            ${actionLink('Import from ERP', 'erprecon')}
            ${actionLink('Assign Shipments', 'shipments')}
            ${actionLink('Payment Requests', 'payments')}
            ${actionLink('Exceptions', 'exceptions')}
            ${actionLink('Export Reports', 'reports')}
            ${actionLink('Supplier Scorecards', 'scorecards')}
            ${actionLink('Management Pack', 'managementpack')}
          </div>
        </div>
      </div>

      <div id="dashboard-firstrun"></div>

      <details class="bc-rc-filterbox" ${activeDashFilters ? 'open' : ''}>
        <summary>Filters${activeDashFilters ? ` (${activeDashFilters})` : ''}</summary>
        <div id="dashboard-filters"></div>
      </details>

      <section class="bc-rc-section">
        <div class="bc-rc-section-head">
          <h2>Activities</h2>
          <span class="text-xs text-muted" id="dashboard-as-of"></span>
        </div>
        <div class="metric-grid bc-activity-strip" id="metric-grid"></div>
      </section>

      <section class="bc-rc-tile-area">
        <div class="bc-rc-tile-group">
          <h3>Foreign Orders</h3>
          <div class="bc-rc-tile-row" id="dashboard-foreign-tiles"></div>
        </div>
        <div class="bc-rc-tile-group">
          <h3>Local Orders</h3>
          <div class="bc-rc-tile-row" id="dashboard-local-tiles"></div>
        </div>
        <div class="bc-rc-tile-group">
          <h3>Logistics</h3>
          <div class="bc-rc-tile-row" id="dashboard-logistics-tiles"></div>
        </div>
        <div class="bc-rc-tile-group">
          <h3>Finance & Controls</h3>
          <div class="bc-rc-tile-row" id="dashboard-control-tiles"></div>
        </div>
      </section>

      <section class="bc-rc-section">
        <div class="bc-rc-section-head">
          <h2>Business Assistance</h2>
        </div>
        <div class="bc-rc-panel-grid">
          <div class="bc-rc-panel">
            <div class="card-head"><h3>Procurement Risk &amp; Ageing</h3></div>
            <div id="risk-ageing-panel"></div>
          </div>
          <div class="bc-rc-panel">
            <div class="card-head"><h3>Supplier Chase Plan</h3></div>
            <div id="supplier-chase-panel"></div>
          </div>
          <div class="bc-rc-panel">
            <div class="card-head"><h3>Shipment Status Distribution</h3></div>
            <div class="bar-list" id="status-bars"></div>
          </div>
          <div class="bc-rc-panel">
            <div class="card-head"><h3>Workload by Officer</h3></div>
            <div class="bar-list" id="officer-bars"></div>
          </div>
          <div class="bc-rc-panel wide">
            <div class="card-head"><h3>Upcoming Payments — Next 30 Days</h3></div>
            <div id="upcoming-payments"></div>
          </div>
          <div class="bc-rc-panel">
            <div class="card-head"><h3>Alerts</h3></div>
            <div id="alerts-panel"></div>
          </div>
        </div>
      </section>
    </div>
  `;

  // Render filter bar
  renderDashboardFilters(f);

  // First-run guidance: when the whole app has no orders yet, point the user at how
  // to populate it instead of showing empty tables with no direction.
  const frEl = $('#dashboard-firstrun');
  if (frEl) {
    const totalOrders = (state.data.orders || []).filter(o => !o.archived).length;
    if (totalOrders === 0) {
      frEl.innerHTML = `
        <div class="info-banner" style="display:flex;gap:14px;align-items:flex-start;padding:16px">
          <div style="font-size:22px;line-height:1">👋</div>
          <div>
            <div style="font-weight:600;margin-bottom:4px">No orders yet — let's get data in</div>
            <div class="text-sm text-muted" style="margin-bottom:10px">Phoenix Procurement sits on top of your ERP. Populate it by importing your Navision / Business Central export, or load a sample order to explore the features.</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-sm btn-primary" onclick="navigate('erprecon')">Import from ERP</button>
              <button class="btn btn-sm" onclick="navigate('reports')">Load a sample order</button>
            </div>
          </div>
        </div>`;
    } else {
      frEl.innerHTML = '';
    }
  }

  // Apply order-level filters
  // Trend indicator (▲/▼ vs last captured month) from kpiSnapshot history.
  // Returns a small inline span, or '' when there isn't enough history.
  const kpiTrend = (key) => {
    try {
      const META = window.PXKpi && window.PXKpi.META;
      const snaps = (state.data.kpiSnapshot || []).filter(s => !s.archived && s.entity === dashEnt)
        .sort((a, b) => String(a.period).localeCompare(String(b.period)));
      const vals = snaps.map(s => s.values && s.values[key]).filter(v => v != null);
      if (vals.length < 2 || !META || !META[key]) return '';
      const cur = vals[vals.length - 1], prev = vals[vals.length - 2];
      if (cur === prev) return '<span class="kpi-delta muted" title="No change vs last month">→</span>';
      const upGood = META[key].upGood;
      const better = upGood == null ? null : (upGood ? cur > prev : cur < prev);
      const cls = better == null ? 'muted' : better ? 'success' : 'danger';
      const arrow = cur > prev ? '▲' : '▼';
      return `<span class="kpi-delta ${cls}" title="vs last captured month (${prev})">${arrow}</span>`;
    } catch (e) { return ''; }
  };
  const dateFrom = f.dateFrom ? new Date(f.dateFrom) : null;
  const dateTo = f.dateTo ? new Date(f.dateTo + 'T23:59:59') : null;
  function orderPasses(o) {
    if (recordEntity(o) !== dashEnt) return false;
    if (f.orderType && o.orderType !== f.orderType) return false;
    if (f.function && orderFunction(o) !== f.function) return false;
    if (f.officer && o.officerCode !== f.officer) return false;
    if (f.supplier && o.supplier !== f.supplier) return false;
    if (f.currency && o.currency !== f.currency) return false;
    if (dateFrom || dateTo) {
      const d = o.dateOfOrder?.toDate ? o.dateOfOrder.toDate() : (o.dateOfOrder ? new Date(o.dateOfOrder) : null);
      if (!d) return false;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
    }
    return true;
  }

  // === Compute metrics (against filtered data) ===
  const allOrders = state.data.orders;
  const orders = allOrders.filter(orderPasses);
  const orderIdSet = new Set(orders.map(o => o.orderId));
  // Shipments & payments are always scoped to the current entity's orders
  const ships = state.data.shipments.filter(s => orderIdSet.has(s.orderId));
  const pays = state.data.payments.filter(p => orderIdSet.has(p.orderId));

  const openForeign = orders.filter(o => o.orderType === 'foreign' && !o.isClosed).length;
  const openLocal = orders.filter(o => o.orderType === 'local' && !o.isClosed).length;
  const inTransit = ships.filter(s => (s.status||'').toLowerCase().includes('transit')).length;
  const underClearance = ships.filter(s => (s.status||'').toLowerCase().includes('clearance')).length;

  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);
  const overdue = pays.filter(p => {
    if (['paid','rejected'].includes(p.status)) return false;
    const d = p.dueDate?.toDate ? p.dueDate.toDate() : (p.dueDate ? new Date(p.dueDate) : null);
    return d && d < now;
  }).length;
  const upcoming = pays.filter(p => {
    if (['paid','rejected'].includes(p.status)) return false;
    const d = p.dueDate?.toDate ? p.dueDate.toDate() : (p.dueDate ? new Date(p.dueDate) : null);
    return d && d >= now && d <= in30;
  }).sort((a,b) => {
    const da = a.dueDate?.toDate ? a.dueDate.toDate() : new Date(a.dueDate);
    const db = b.dueDate?.toDate ? b.dueDate.toDate() : new Date(b.dueDate);
    return da - db;
  });

  // === Milestone-level upcoming payments (foreign orders only) ===
  const upcomingMilestones = [];
  orders.filter(o => !o.isClosed && o.milestones).forEach(o => {
    o.milestones.forEach(m => {
      if (m.paidDate) return;
      const exp = computeMilestoneDate(m, o, ships) || (m.expectedDateOverride ? (m.expectedDateOverride.toDate ? m.expectedDateOverride.toDate() : new Date(m.expectedDateOverride)) : null);
      if (!exp) return;
      if (exp >= now && exp <= in30) {
        upcomingMilestones.push({ order: o, milestone: m, dueDate: exp });
      }
    });
  });
  upcomingMilestones.sort((a, b) => a.dueDate - b.dueDate);

  // OTIF + clearance averages (shipment-level KPIs)
  // (Shipment lateness + clearance now come from PXKpi below — see _k.)


  const procCtx = window.PXProcFollowup ? window.PXProcFollowup.context() : null;
  const procDash = window.PXProcFollowup ? window.PXProcFollowup.dashboard(orders, procCtx) : null;

  // ===== MTTO (Mean Time To Order) =====
  // Days between IPR HOD Approved Date and Date of Order
  let mttoTotal = 0, mttoCount = 0;
  orders.forEach(o => {
    if (o.iprApprovedDate && o.dateOfOrder) {
      const d = daysBetween(o.iprApprovedDate, o.dateOfOrder);
      if (d !== null && d >= 0) { mttoTotal += d; mttoCount++; }
    }
  });
  const mtto = mttoCount ? (mttoTotal / mttoCount).toFixed(1) : '—';

  // OTIF / lateness / clearance come from the single PXKpi engine so the dashboard and
  // the KPI Trends view can never disagree — and both use the TRUE received date
  // (actual arrival / service completion) rather than the store's GRN paperwork date.
  const _k = (window.PXKpi ? window.PXKpi.compute(dashEnt) : {}) || {};
  const avgOtif = (_k.avgLateness == null ? '—' : _k.avgLateness.toFixed ? _k.avgLateness.toFixed(1) : String(_k.avgLateness));
  const avgClr = (_k.avgClearance == null ? '—' : _k.avgClearance.toFixed ? _k.avgClearance.toFixed(1) : String(_k.avgClearance));
  const otifPct = (_k.otifPct == null ? null : _k.otifPct);
  const otifOnTime = _k.otifOnTime || 0, otifEligible = _k.otifSample || 0;
  const otifDisplay = otifPct !== null ? otifPct + '%' : '—';

  // Render metrics
  const metrics = [
    { label: 'Open Foreign Orders', value: openForeign, cls: 'primary' },
    { label: 'Open Local Orders', value: openLocal, cls: 'accent' },
    { label: 'Shipments In Transit', value: inTransit, cls: '' },
    { label: 'Under Clearance', value: underClearance, cls: '' },
    { label: 'Overdue Payments', value: overdue, cls: overdue > 0 ? 'danger' : 'success' },
    ...(procDash ? [
      { label: 'High-Risk Orders', value: procDash.highRisk.length, unit: procDash.criticalRisk.length ? `(${procDash.criticalRisk.length} critical)` : '', cls: procDash.criticalRisk.length ? 'danger' : (procDash.highRisk.length ? 'warn' : 'success') },
      { label: 'Supplier Follow-Ups Due', value: procDash.followupsDue.length, cls: procDash.followupsDue.length ? 'warn' : 'success' },
      { label: 'Promise Overdue', value: procDash.promiseOverdue.length, cls: procDash.promiseOverdue.length ? 'danger' : 'success' },
      { label: 'ERP/DW Exceptions', value: procDash.erpExceptionRows.length, cls: procDash.erpExceptionRows.length ? 'warn' : 'success' }
    ] : []),
    { label: 'MTTO — Mean Time to Order', value: mtto, unit: 'days', cls: mtto === '—' ? '' : (parseFloat(mtto) > 5 ? 'warn' : 'success'), trend: kpiTrend('mtto') },
    { label: 'OTIF — On Time In Full', value: otifDisplay, unit: otifEligible > 0 ? `(${otifOnTime}/${otifEligible})` : '', cls: otifPct === null ? '' : (otifPct >= 90 ? 'success' : (otifPct >= 70 ? 'warn' : 'danger')), trend: kpiTrend('otifPct') },
    { label: 'Shipment Lateness avg.', value: avgOtif, unit: 'days vs ETA', cls: parseFloat(avgOtif) > 10 ? 'warn' : 'success', trend: kpiTrend('avgLateness') },
    { label: 'Avg Clearance (target 3d)', value: avgClr, unit: 'days', cls: parseFloat(avgClr) > 3 ? 'warn' : 'success', trend: kpiTrend('avgClearance') },
    { label: 'Active Suppliers', value: state.data.suppliers.filter(s => s.active !== false && recordEntity(s) === dashEnt).length, cls: '' }
  ];
  const lateReadySummary = ships.filter(s => {
    if (s.completed) return false;
    const d = s.readyDate?.toDate ? s.readyDate.toDate() : (s.readyDate ? new Date(s.readyDate) : null);
    return d && d < now && !s.etd;
  });
  const attentionCount = overdue
    + (procDash ? procDash.criticalRisk.length + procDash.promiseOverdue.length + procDash.erpExceptionRows.length : 0)
    + lateReadySummary.length;
  const openShipments = ships.filter(s => !(s.completed || s.stage === 'completed')).length;
  const openPayments = pays.filter(p => !['paid','rejected'].includes(p.status)).length;
  const activeSupplierCount = state.data.suppliers.filter(s => s.active !== false && recordEntity(s) === dashEnt).length;
  const entOrderIds = new Set(orders.map(o => o.id));
  const entShipIds = new Set(ships.map(s => s.id));
  const entPayIds = new Set(pays.map(p => p.id));
  const activeDocs = (state.data.documents || []).filter(d => !d.archived &&
    ((d.relatedType === 'order' && entOrderIds.has(d.relatedId)) ||
     (d.relatedType === 'shipment' && entShipIds.has(d.relatedId)) ||
     (d.relatedType === 'payment' && entPayIds.has(d.relatedId)))).length;
  const dqCount = window.__dqCriticalCount ? window.__dqCriticalCount() : 0;
  const exceptionCount = window.__exceptionsCount ? window.__exceptionsCount() : 0;
  const tile = (label, value, sub, view, tone) => `
    <button class="bc-rc-tile ${tone || ''}" ${view ? `onclick="navigate('${view}')"` : ''}>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      ${sub ? `<small>${escapeHtml(sub)}</small>` : ''}
      <i>›</i>
    </button>`;
  const fnOpen = (typeKey, fnKey) => orders.filter(o => o.orderType === typeKey && orderFunction(o) === fnKey && !o.isClosed).length;
  const summaryEl = $('#dashboard-summary');
  if (summaryEl) {
    summaryEl.innerHTML = attentionCount
      ? `${attentionCount} item${attentionCount === 1 ? '' : 's'} need attention in <em>${escapeHtml(dashEnt)}</em>`
      : `No critical action is overdue for <em>${escapeHtml(dashEnt)}</em>`;
  }
  const foreignTiles = $('#dashboard-foreign-tiles');
  if (foreignTiles) foreignTiles.innerHTML = [
    tile('Technical', fnOpen('foreign', 'technical'), 'open FPOs', 'orders-foreign-technical', 'primary'),
    tile('Indirect', fnOpen('foreign', 'indirect'), 'open FPOs', 'orders-foreign-indirect', 'primary'),
    tile('Supply Chain', fnOpen('foreign', 'supplychain'), 'open FPOs', 'orders-foreign-supplychain', 'primary')
  ].join('');
  const localTiles = $('#dashboard-local-tiles');
  if (localTiles) localTiles.innerHTML = [
    tile('Technical', fnOpen('local', 'technical'), 'open LPOs', 'orders-local-technical', 'soft'),
    tile('Indirect', fnOpen('local', 'indirect'), 'open LPOs', 'orders-local-indirect', 'soft'),
    tile('Supply Chain', fnOpen('local', 'supplychain'), 'open LPOs', 'orders-local-supplychain', 'soft')
  ].join('');
  const logisticsTiles = $('#dashboard-logistics-tiles');
  if (logisticsTiles) logisticsTiles.innerHTML = [
    tile('Active Shipments', openShipments, 'import / inbound', 'shipments', 'primary'),
    tile('In Transit', inTransit, 'current movement', 'shipments', ''),
    tile('Under Clearance', underClearance, 'broker / customs', 'clearance', underClearance ? 'warn' : ''),
    tile('No ETD After Ready', lateReadySummary.length, 'needs logistics update', 'shipments', lateReadySummary.length ? 'warn' : 'soft')
  ].join('');
  const controlTiles = $('#dashboard-control-tiles');
  if (controlTiles) controlTiles.innerHTML = [
    tile('Open RFPs', openPayments, 'payment requests', 'payments', ''),
    tile('Overdue Payments', overdue, 'past due', 'payments', overdue ? 'danger' : 'soft'),
    tile('Forthcoming', upcoming.length + upcomingMilestones.length, 'next 30 days', 'forecast', 'primary'),
    tile('Data Quality', dqCount, 'critical fields', 'dqcockpit', dqCount ? 'danger' : 'soft'),
    tile('Exceptions', exceptionCount, 'active controls', 'exceptions', exceptionCount ? 'warn' : 'soft'),
    tile('Documents', activeDocs, 'active records', 'documents', ''),
    tile('Suppliers', activeSupplierCount, 'active masters', 'suppliers', 'soft')
  ].join('');
  $('#metric-grid').innerHTML = metrics.map(m => `
    <div class="metric ${m.cls}">
      <div class="label">${escapeHtml(m.label)}</div>
      <div class="value">${escapeHtml(String(m.value))}${m.unit ? `<span class="unit">${m.unit}</span>` : ''}${m.trend || ''}</div>
    </div>
  `).join('');

  if (procDash && $('#risk-ageing-panel')) {
    const topRows = procDash.topRisk.filter(r => r.risk.score > 0).slice(0, 8);
    $('#risk-ageing-panel').innerHTML = `
      ${procDash.buckets.length ? `<div class="bar-list" style="margin-bottom:12px">
        ${procDash.buckets.map(b => {
          const pct = procDash.rows.length ? Math.round((b.count / procDash.rows.length) * 100) : 0;
          return `<div class="bar-item">
            <div class="lbl truncate" title="${escapeHtml(b.label)}">${escapeHtml(b.label)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
            <div class="val">${b.count}</div>
          </div>`;
        }).join('')}
      </div>` : '<div class="text-muted text-sm">No open orders for this filter.</div>'}
      ${topRows.length ? `<div class="table-wrap"><table class="data" style="margin:-1px 0">
        <thead><tr><th>Order</th><th>Supplier</th><th>Risk</th><th>Reason</th></tr></thead>
        <tbody>${topRows.map(r => `<tr onclick="openOrderDetail('${r.order.id}')">
          <td><span class="mono">${escapeHtml(r.order.orderId || '—')}</span></td>
          <td class="truncate">${escapeHtml(r.order.supplier || '—')}</td>
          <td><span class="badge ${r.risk.cls}">${escapeHtml(r.risk.level)} ${r.risk.score}</span></td>
          <td class="text-xs truncate" title="${escapeHtml(r.risk.reasons[0] || '')}">${escapeHtml(r.risk.reasons[0] || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<div class="text-muted text-sm">No elevated procurement risk detected.</div>'}
    `;
  }

  if (procDash && $('#supplier-chase-panel')) {
    const chaseRows = procDash.rows
      .filter(r => r.chase.next || r.commitment.current || r.risk.level === 'critical' || r.risk.level === 'high')
      .sort((a, b) => {
        const da = a.chase.next ? a.chase.next.getTime() : 9999999999999;
        const db = b.chase.next ? b.chase.next.getTime() : 9999999999999;
        if (da !== db) return da - db;
        return b.risk.score - a.risk.score;
      })
      .slice(0, 10);
    $('#supplier-chase-panel').innerHTML = chaseRows.length ? `<div class="table-wrap"><table class="data" style="margin:-1px 0">
      <thead><tr><th>Next</th><th>Order</th><th>Supplier</th><th>Commitment</th></tr></thead>
      <tbody>${chaseRows.map(r => `<tr onclick="openOrderDetail('${r.order.id}')">
        <td style="${r.chase.overdue ? 'color:var(--danger);font-weight:600' : ''}">${r.chase.next ? fmtDate(r.chase.next) : '—'}</td>
        <td><span class="mono">${escapeHtml(r.order.orderId || '—')}</span><br><span class="badge ${r.risk.cls}" style="font-size:10px">${escapeHtml(r.risk.level)}</span></td>
        <td class="truncate">${escapeHtml(r.order.supplier || '—')}</td>
        <td style="${r.commitment.overdue ? 'color:var(--danger);font-weight:600' : ''}">${r.commitment.current ? fmtDate(r.commitment.current) : '—'}${r.commitment.revisions ? '<br><span class="text-xs text-muted">' + r.commitment.revisions + ' revision(s)</span>' : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<div class="text-muted text-sm">No supplier chase dates or commitment risks recorded.</div>';
  }

  // Status distribution
  const statusCounts = {};
  ships.filter(s => !s.completed).forEach(s => {
    const k = s.status || '(no status)';
    statusCounts[k] = (statusCounts[k]||0) + 1;
  });
  const total = Object.values(statusCounts).reduce((a,b) => a+b, 0) || 1;
  const sortedStatus = Object.entries(statusCounts).sort((a,b) => b[1]-a[1]);
  $('#status-bars').innerHTML = sortedStatus.length ? sortedStatus.map(([k, v]) => `
    <div class="bar-item">
      <div class="lbl truncate" title="${escapeHtml(k)}">${escapeHtml(k)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(v/total)*100}%"></div></div>
      <div class="val">${v}</div>
    </div>
  `).join('') : '<div class="text-muted text-sm">No active shipments.</div>';

  // Officer workload
  const officerCounts = {};
  orders.filter(o => !o.isClosed).forEach(o => {
    const k = o.officerCode || '—';
    officerCounts[k] = (officerCounts[k]||0) + 1;
  });
  const totalOf = Object.values(officerCounts).reduce((a,b) => a+b, 0) || 1;
  const sortedOff = Object.entries(officerCounts).sort((a,b) => b[1]-a[1]);
  $('#officer-bars').innerHTML = sortedOff.length ? sortedOff.map(([k, v]) => {
    const off = state.data.officers.find(o => o.code === k);
    const name = off?.fullName || k;
    return `<div class="bar-item">
      <div class="lbl">${escapeHtml(name)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(v/totalOf)*100}%"></div></div>
      <div class="val">${v}</div>
    </div>`;
  }).join('') : '<div class="text-muted text-sm">No open orders.</div>';

  // Upcoming payments — combines RFPs already created with milestones not yet RFP'd
  const combined = [];
  upcoming.forEach(p => combined.push({
    type: 'rfp',
    dueDate: p.dueDate?.toDate ? p.dueDate.toDate() : new Date(p.dueDate),
    label: p.rfpRef || 'RFP',
    orderId: p.orderId,
    supplier: p.supplier,
    amount: p.amount,
    currency: p.currency,
    onclick: `openPaymentDetail('${p.id}')`
  }));
  upcomingMilestones.forEach(um => combined.push({
    type: 'milestone',
    dueDate: um.dueDate,
    label: um.milestone.label + ' (' + um.milestone.percent + '%)',
    orderId: um.order.orderId,
    supplier: um.order.supplier,
    amount: um.milestone.amount,
    currency: um.order.currency,
    onclick: `openOrderDetail('${um.order.id}')`
  }));
  combined.sort((a, b) => a.dueDate - b.dueDate);

  $('#upcoming-payments').innerHTML = combined.length ? `
    <table class="data" style="margin: -8px 0;">
      <thead><tr><th>Due</th><th>What</th><th>Order</th><th>Supplier</th><th class="num">Amount</th></tr></thead>
      <tbody>
        ${combined.slice(0, 12).map(p => {
          const days = Math.round((p.dueDate - now) / 86400000);
          return `<tr onclick="${p.onclick}">
            <td><span class="mono">${fmtDate(p.dueDate)}</span><br><span class="text-xs text-muted">${days}d</span></td>
            <td><span class="badge ${p.type === 'rfp' ? 'info' : 'accent'}" style="font-size:10px">${p.type === 'rfp' ? 'RFP' : 'Milestone'}</span>
                <div class="text-xs text-muted truncate" style="max-width:160px" title="${escapeHtml(p.label||'')}">${escapeHtml(p.label||'')}</div></td>
            <td><span class="mono">${escapeHtml(p.orderId||'')}</span></td>
            <td class="truncate" title="${escapeHtml(p.supplier||'')}">${escapeHtml(p.supplier||'')}</td>
            <td class="num">${fmtMoney(p.amount, p.currency)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  ` : '<div class="text-muted text-sm">No payments due in next 30 days.</div>';

  // Alerts
  const alerts = [];
  if (overdue > 0) alerts.push({ kind: 'danger', msg: `<strong>${overdue} payment(s) overdue.</strong> <a href="#payments">Review →</a>` });
  if (procDash && procDash.criticalRisk.length > 0) alerts.push({ kind: 'danger', msg: `<strong>${procDash.criticalRisk.length} critical procurement risk order(s).</strong> Review the Risk & Ageing panel.` });
  if (procDash && procDash.promiseOverdue.length > 0) alerts.push({ kind: 'warn', msg: `<strong>${procDash.promiseOverdue.length} supplier commitment(s) overdue.</strong> Chase supplier or escalate.` });
  if (procDash && procDash.erpExceptionRows.length > 0) alerts.push({ kind: 'warn', msg: `<strong>${procDash.erpExceptionRows.length} ERP/Data Warehouse exception(s).</strong> Check ERP Reconciliation.` });
  // shipments with missing ETA past due
  const lateReady = ships.filter(s => {
    if (s.completed) return false;
    const d = s.readyDate?.toDate ? s.readyDate.toDate() : (s.readyDate ? new Date(s.readyDate) : null);
    return d && d < now && !s.etd;
  });
  if (lateReady.length > 0) alerts.push({ kind: 'warn', msg: `<strong>${lateReady.length} shipment(s) past ready date</strong> with no ETD recorded.` });
  // orders pending acknowledgement > 7 days
  const noAck = orders.filter(o => {
    if (o.isClosed) return false;
    if (o.orderAcknowledgedDate) return false;
    const d = o.dateOfOrder?.toDate ? o.dateOfOrder.toDate() : (o.dateOfOrder ? new Date(o.dateOfOrder) : null);
    return d && (now - d) > 7 * 86400000;
  });
  if (noAck.length > 0) alerts.push({ kind: 'info', msg: `${noAck.length} order(s) over 7 days old without supplier acknowledgement.` });

  $('#alerts-panel').innerHTML = alerts.length ? alerts.map(a => `
    <div class="alert-row ${a.kind}"><div class="grow">${a.msg}</div></div>
  `).join('') : '<div class="text-muted text-sm">No alerts. All quiet on the docks.</div>';

  $('#dashboard-as-of').textContent = 'as of ' + new Date().toLocaleString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const refreshBtn = $('#refresh-dashboard');
  if (refreshBtn) refreshBtn.addEventListener('click', () => window.renderView && window.renderView('dashboard'));
};
