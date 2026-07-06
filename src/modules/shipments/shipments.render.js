const { $, $$, fmtDate, fmtDateISO, fmtMoney, daysBetween, escapeHtml, statusBadgeClass,
  collection, addDoc, doc, getDoc, updateDoc, deleteDoc, serverTimestamp, toast,
  cmGetColumns, cmRenderTable, cmOpenManager, cmExportCSV, fmtQuantityLines,
  checkShipmentDuplicates, shipmentDataQuality, isErpOrder, renderErpBadge,
  currentEntity, recordEntity, entityMeta, stripUndefined, canEditShipments,
  shipmentFollowupActionOpen } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;


window.__renderers['shipments'] = function() {
  const viewEl = $('#view-shipments');
  const ent = currentEntity();
  const orderForShipment = s => s && s.orderId ? state.data.orders.find(x => x.orderId === s.orderId) : null;
  const orderEntity = oid => { const o = state.data.orders.find(x => x.orderId === oid); return o ? recordEntity(o) : null; };
  const shipEntity = s => s.entity || orderEntity(s.orderId) || 'Phoenix';
  const ships = state.data.shipments.filter(s => !s.archived && shipEntity(s) === ent);
  const filters = state.filters.shipments || (state.filters.shipments = { search: '', status: '', stage: 'open' });
  if (!filters.type) filters.type = 'foreign';
  const shipmentOrderType = s => {
    const order = orderForShipment(s);
    if (order && order.orderType) return order.orderType;
    if (s.orderType) return s.orderType;
    return /^LP/i.test(String(s.orderId || s.shipmentId || '')) ? 'local' : 'foreign';
  };
  const foreignCount = ships.filter(s => shipmentOrderType(s) === 'foreign').length;
  const localCount = ships.filter(s => shipmentOrderType(s) === 'local').length;
  const useFilterPane = !!(window.APP_CONFIG && window.APP_CONFIG.bcStructure);

  let filtered = ships.filter(s => {
    if (filters.type !== 'all' && shipmentOrderType(s) !== filters.type) return false;
    const stg = s.stage || (s.completed ? 'completed' : 'in_progress');
    if (filters.stage === 'open' && stg === 'completed') return false;
    if (filters.stage === 'requested' && stg !== 'requested') return false;
    if (filters.stage === 'assigned' && stg !== 'assigned') return false;
    if (filters.stage === 'in_progress' && stg !== 'in_progress') return false;
    if (filters.stage === 'completed' && stg !== 'completed') return false;
    if (filters.status && s.status !== filters.status) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = [s.shipmentId, s.orderId, s.supplier, s.description, s.vesselFlight,
        s.shipmentCoverage, s.partialShipmentReason, s.receiptResult, s.followupAction, s.movementSummary].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const allStatuses = [...new Set(ships.map(s => s.status).filter(Boolean))].sort();
  const requestCount = ships.filter(s => (s.stage || '') === 'requested').length;
  const canAssign = canEditShipments();
  const canRequestShipmentUpdate = !!(window.PXUpdateRequests && window.PXUpdateRequests.canRequestUpdate('shipment'));
  const activeFilterCount = [
    filters.search, filters.status,
    filters.stage && filters.stage !== 'open' ? filters.stage : '',
    filters.type && filters.type !== 'foreign' ? filters.type : ''
  ].filter(Boolean).length;
  const stageOptions = [
    ['open', 'Open (all active)'],
    ['requested', 'Requests (awaiting assignment)'],
    ['assigned', 'Assigned'],
    ['in_progress', 'In Progress'],
    ['completed', 'Completed']
  ];
  const typeOptions = [
    ['foreign', 'Foreign Shipments', foreignCount],
    ['local', 'Local Shipments', localCount],
    ['all', 'All', ships.length]
  ];
  const shipmentFilterPaneHtml = `
    <aside class="bc-filter-pane" id="filterpane-shipments" aria-label="Filters">
      <div class="bc-filter-pane-head">
        <strong>Views</strong>
        <button class="bc-filter-close" id="filterpane-shipments-close" title="Hide filters">×</button>
      </div>
      <div class="bc-filter-views">
        ${typeOptions.map(([k,label,n]) => `<button class="bc-filter-view ${filters.type===k?'active':''}" data-shiptype="${k}">
          <span>${label}</span><span class="cnt">${n}</span>
        </button>`).join('')}
      </div>
      <div class="bc-filter-section-title">Filter list by:</div>
      <label class="bc-filter-field">
        <span>Search</span>
        <input type="search" placeholder="PO, supplier, vessel..." id="ship-search" value="${escapeHtml(filters.search)}" />
      </label>
      <label class="bc-filter-field">
        <span>Stage</span>
        <select id="ship-stage">
          ${stageOptions.map(([k,label]) => `<option value="${k}" ${filters.stage===k?'selected':''}>${escapeHtml(label)}</option>`).join('')}
        </select>
      </label>
      <label class="bc-filter-field">
        <span>Shipping Status</span>
        <select id="ship-status">
          <option value="">All shipping statuses</option>
          ${allStatuses.map(s => `<option value="${escapeHtml(s)}" ${filters.status===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}
        </select>
      </label>
      <div class="bc-filter-totals">
        <div class="bc-filter-section-title">Filter totals by...</div>
        <button class="bc-filter-reset" id="filterpane-shipments-reset" type="button">Reset filters</button>
      </div>
    </aside>`;
  const renderAction = s => {
    if (!s.followupAction || s.followupAction === 'No action') return '—';
    return shipmentFollowupActionOpen(s)
      ? `<span class="badge warn">${escapeHtml(s.followupAction)}</span>`
      : `<span class="badge success">${escapeHtml(s.followupAction)} processed</span>`;
  };

  // Column definitions for shipments
  const shipCols = [
    { key: 'shipmentId', label: 'Shipment', render: s => `<span class="mono">${escapeHtml(s.shipmentId || '—')}</span>`, raw: s => s.shipmentId },
    { key: 'orderType', label: 'Type', defaultVisible: true, render: s => {
        const type = shipmentOrderType(s);
        return `<span class="badge ${type === 'local' ? 'neutral' : 'info'}" style="font-size:10.5px">${type === 'local' ? 'Local' : 'Foreign'}</span>`;
      }, raw: s => shipmentOrderType(s) },
    { key: 'stage', label: 'Stage', render: s => { const stg = s.stage || (s.completed ? 'completed' : 'in_progress'); const m = REF.shipmentStages[stg] || {short:stg,badge:'neutral'}; return `<span class="badge ${m.badge}" style="font-size:10.5px">${escapeHtml(m.short)}</span>`; }, raw: s => s.stage },
    { key: 'orderId', label: 'Order', render: s => {
        const lo = s.orderId ? state.data.orders.find(ord => ord.orderId === s.orderId) : null;
        if (!s.orderId) return '<span class="badge danger" style="font-size:10px">⚠ no link</span>';
        if (!lo) return `<span class="mono" style="color:var(--danger)">${escapeHtml(s.orderId)} ⚠</span>`;
        return `<span class="mono" title="${escapeHtml(lo.description || '')}">${escapeHtml(s.orderId)}</span>${lo.category ? `<br><span class="text-xs text-muted">${escapeHtml(lo.category)}</span>` : ''}`;
      }, raw: s => s.orderId },
    { key: 'supplier', label: 'Supplier', render: s => `<span class="truncate" title="${escapeHtml(s.supplier||'')}">${escapeHtml(s.supplier || '—')}</span>`, raw: s => s.supplier },
    { key: 'description', label: 'Description', defaultVisible: false, render: s => `<span class="text-sm truncate" title="${escapeHtml(s.description||'')}" style="max-width:200px;display:inline-block">${escapeHtml(s.description || '—')}</span>`, raw: s => s.description },
    { key: 'quantityLines', label: 'Quantity', defaultVisible: false, render: s => `<span class="text-sm">${escapeHtml(fmtQuantityLines(s) || '—')}</span>`, csv: s => fmtQuantityLines(s) },
    { key: 'status', label: 'Shipping Status', render: s => s.status ? `<span class="badge ${statusBadgeClass(s.status)}">${escapeHtml(s.status)}</span>` : '<span class="text-xs text-muted">—</span>', raw: s => s.status },
    { key: 'shipmentCoverage', label: 'Scope', render: s => escapeHtml(s.shipmentCoverage || '—'), raw: s => s.shipmentCoverage },
    { key: 'followupAction', label: 'Action', render: renderAction, raw: s => s.followupAction },
    { key: 'receiptResult', label: 'Receipt Result', defaultVisible: false, render: s => escapeHtml(s.receiptResult || '—'), raw: s => s.receiptResult },
    { key: 'conveyance', label: 'Conveyance', defaultVisible: false, render: s => escapeHtml(s.conveyance || '—'), raw: s => s.conveyance },
    { key: 'shippingTerms', label: 'Terms', defaultVisible: false, render: s => escapeHtml(s.shippingTerms || '—'), raw: s => s.shippingTerms },
    { key: 'readyDate', label: 'Ready', defaultVisible: false, render: s => fmtDate(s.readyDate) || '—', raw: s => s.readyDate },
    { key: 'etd', label: 'ETD', render: s => fmtDate(s.etd) || '—', raw: s => s.etd },
    { key: 'eta', label: 'ETA', render: s => fmtDate(s.eta) || '—', raw: s => s.eta },
    { key: 'vesselFlight', label: 'Vessel/Flight', defaultVisible: false, render: s => escapeHtml(s.vesselFlight || '—'), raw: s => s.vesselFlight },
    { key: 'deliveryDate', label: 'Delivery', defaultVisible: false, render: s => fmtDate(s.deliveryDate) || '—', raw: s => s.deliveryDate },
    { key: 'grnDate', label: 'GRN', render: s => fmtDate(s.grnDate) || '—', raw: s => s.grnDate },
    { key: 'deliveryLocation', label: 'Delivery to', defaultVisible: false, render: s => escapeHtml(s.deliveryLocation || '—'), raw: s => s.deliveryLocation },
    { key: 'otif', label: 'OTIF', num: true, render: s => { const order = orderForShipment(s); const receipt = order && window.PXReceiptControl ? window.PXReceiptControl.shipmentReceiptDate(order, s) : (s.deliveryDate || s.grnDate); const o = (s.eta && receipt) ? daysBetween(s.eta, receipt) : null; return o!==null ? `<span style="${o>10?'color:var(--warn);font-weight:600':''}">${o}d</span>` : '—'; }, raw: s => { const order = orderForShipment(s); const receipt = order && window.PXReceiptControl ? window.PXReceiptControl.shipmentReceiptDate(order, s) : (s.deliveryDate || s.grnDate); return (s.eta && receipt) ? daysBetween(s.eta, receipt) : ''; } },
    { key: 'clearance', label: 'Clearance', num: true, defaultVisible: false, render: s => { const c = (s.docsToBrokerDate && s.clearanceDate) ? daysBetween(s.docsToBrokerDate, s.clearanceDate) : null; return c!==null ? `<span style="${c>3?'color:var(--warn);font-weight:600':''}">${c}d</span>` : '—'; }, raw: s => (s.docsToBrokerDate && s.clearanceDate) ? daysBetween(s.docsToBrokerDate, s.clearanceDate) : '' },
    { key: 'logisticOfficer', label: 'Logistic Officer', render: s => { const stg = s.stage || (s.completed ? 'completed' : 'in_progress'); return s.logisticOfficer ? escapeHtml(s.logisticOfficer) : (stg === 'requested' ? '<span class="badge accent" style="font-size:10px">unassigned</span>' : '—'); }, raw: s => s.logisticOfficer },
    { key: 'freightForwarder', label: 'Forwarder', defaultVisible: false, render: s => escapeHtml(s.freightForwarder || '—'), raw: s => s.freightForwarder },
    { key: 'carrier', label: 'Carrier', defaultVisible: false, render: s => escapeHtml(s.carrier || '—'), raw: s => s.carrier },
    { key: 'blAwbNumber', label: 'BL / AWB', defaultVisible: false, render: s => `<span class="mono text-sm">${escapeHtml(s.blAwbNumber || '—')}</span>`, raw: s => s.blAwbNumber },
    { key: 'containerNumber', label: 'Container', defaultVisible: false, render: s => `<span class="mono text-sm">${escapeHtml(s.containerNumber || '—')}</span>`, raw: s => s.containerNumber },
    { key: 'totalLandedCost', label: 'Landed Cost', num: true, defaultVisible: false, render: s => s.totalLandedCost != null ? fmtMoney(s.totalLandedCost, s.currency) : '—', raw: s => s.totalLandedCost }
  ];
  if (canRequestShipmentUpdate) {
    shipCols.push({
      key: 'requestUpdate', label: 'Update',
      render: s => {
        const n = window.PXUpdateRequests ? window.PXUpdateRequests.openForTarget('shipment', s.id).length : 0;
        return `<button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); openUpdateRequestModal('shipment','${s.id}')">Request update</button>${n ? ` <span class="badge warn" title="${n} open request(s)">${n}</span>` : ''}`;
      },
      csv: () => ''
    });
  }

  const mode = window.PXView.mode('shipments');
  const shipCard = s => {
    const em = entityMeta(shipEntity(s)) || {};
    const shipType = shipmentOrderType(s);
    const stg = s.stage || (s.completed ? 'completed' : 'in_progress');
    const sm = REF.shipmentStages[stg] || { short: stg, badge: 'neutral' };
    const eta = s.eta ? (s.eta.toDate ? s.eta.toDate() : new Date(s.eta)) : null;
    const order = orderForShipment(s);
    const receiptDate = order && window.PXReceiptControl ? window.PXReceiptControl.shipmentReceiptDate(order, s) : (s.deliveryDate || s.grnDate);
    const overdueEta = eta && stg !== 'completed' && !receiptDate && eta < new Date();
    let note = '';
    if (stg === 'requested' && !s.logisticOfficer) note = 'Unassigned — awaiting logistics officer';
    else if (overdueEta) note = 'Past ETA, not yet received';
    const openReqCount = window.PXUpdateRequests ? window.PXUpdateRequests.openForTarget('shipment', s.id).length : 0;
    return window.PXCards.card({
      ref: s.shipmentId || s.orderId || '—', entity: em.short, entityAccent: em.accent,
      title: s.orderId ? ('Order ' + s.orderId) : (s.description || ''), supplier: s.supplier,
      statusBadge: { text: sm.short, cls: sm.badge },
      badges: [
        { text: shipType === 'local' ? 'Local shipment' : 'Foreign shipment', cls: shipType === 'local' ? 'neutral' : 'info' },
        ...(s.status ? [{ text: s.status, cls: statusBadgeClass(s.status) }] : []),
        ...(s.shipmentCoverage ? [{ text: s.shipmentCoverage, cls: s.shipmentCoverage === 'Full order' ? 'neutral' : 'warn' }] : []),
        ...(shipmentFollowupActionOpen(s) ? [{ text: s.followupAction, cls: 'warn' }] : []),
        ...(openReqCount ? [{ text: openReqCount + ' update request' + (openReqCount > 1 ? 's' : ''), cls: 'warn' }] : [])
      ],
      dates: [
        { label: 'ETD', value: s.etd ? fmtDate(s.etd) : '' },
        { label: 'ETA', value: s.eta ? fmtDate(s.eta) : '', overdue: overdueEta },
        { label: 'Delivery', value: s.deliveryDate ? fmtDate(s.deliveryDate) : '' },
        { label: 'GRN', value: s.grnDate ? fmtDate(s.grnDate) : '' }
      ],
      amount: s.totalLandedCost != null ? fmtMoney(s.totalLandedCost, s.currency) : null,
      owner: s.logisticOfficer || '',
      note, onclick: `openShipmentDetail('${s.id}')`, actionLabel: 'Open',
      actions: canRequestShipmentUpdate ? [{ label: 'Request update', cls: 'btn-primary', onclick: `openUpdateRequestModal('shipment','${s.id}')` }] : []
    });
  };
  const cardsHtml = window.PXCards.grid(filtered.map(shipCard).join(''), 'No shipments match these filters');

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title">
        <h1>Import / Inbound Shipments</h1>
        <span class="desc">${filtered.length} of ${ships.length} shipment(s) — ${filters.type === 'local' ? 'Local shipment exceptions' : (filters.type === 'foreign' ? 'Foreign shipments' : 'All shipments')} · OTIF target 10d · Clearance target 3d${requestCount > 0 ? ` · <span style="color:var(--warn);font-weight:600">${requestCount} awaiting assignment</span>` : ''}</span>
      </div>
      <div class="page-actions">
        ${window.PXView.toggle('shipments')}
        <button class="btn bc-filter-command ${useFilterPane && !filters.filterPaneHidden ? 'btn-active' : ''}" id="filterpane-shipments-btn" title="Show or hide list filters">☰ Filters${activeFilterCount ? ` (${activeFilterCount})` : ''}</button>
        <div class="col-mgr"><button class="btn" id="ship-col-btn">⚙ Columns</button></div>
        <button class="btn" id="ship-export-btn">⤓ Export Excel</button>
        ${canAssign ? '<button class="btn" id="new-shipment">+ New Shipment (manual)</button>' : ''}
      </div>
    </div>
    ${useFilterPane ? `<div class="bc-filter-layout ${filters.filterPaneHidden ? 'pane-hidden' : ''}">
      ${shipmentFilterPaneHtml}
      <div class="bc-filter-content">` : `<div class="toolbar">
        <div class="search"><input type="search" placeholder="Search by PO, supplier, vessel…" id="ship-search" value="${escapeHtml(filters.search)}" /></div>
        <select id="ship-stage">
          ${stageOptions.map(([k,label]) => `<option value="${k}" ${filters.stage===k?'selected':''}>${escapeHtml(label)}</option>`).join('')}
        </select>
        <select id="ship-status">
          <option value="">All shipping statuses</option>
          ${allStatuses.map(s => `<option value="${escapeHtml(s)}" ${filters.status===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}
        </select>
        <div class="filter-count">${filtered.length}</div>
      </div>
      <div class="subtabs" style="margin-bottom:12px">
        <button class="subtab ${filters.type==='foreign'?'active':''}" data-shiptype="foreign">Foreign Shipments <span class="subtab-count">${foreignCount}</span></button>
        <button class="subtab ${filters.type==='local'?'active':''}" data-shiptype="local">Local Shipments <span class="subtab-count">${localCount}</span></button>
        <button class="subtab ${filters.type==='all'?'active':''}" data-shiptype="all">All <span class="subtab-count">${ships.length}</span></button>
      </div>`}
    ${mode === 'cards' ? cardsHtml : cmRenderTable('shipments', shipCols, filtered, {}, {
      onRowClick: 'openShipmentDetail',
      idField: 'id',
      emptyHtml: `<tr><td colspan="99" class="empty-state"><div class="ic">🚢</div><h3>No shipments match these filters</h3><p>Switch Foreign / Local / All or change the filter to see other stages.</p></td></tr>`
    })}
    ${useFilterPane ? `</div></div>` : ''}
  `;

  window.PXUtils.bindSearchInput('#ship-search', {
    key: 'shipments-search',
    setValue: value => { filters.search = value; },
    render: () => window.__renderers['shipments']()
  });
  $('#ship-status').addEventListener('change', e => { filters.status = e.target.value; window.__renderers['shipments'](); });
  $('#ship-stage').addEventListener('change', e => { filters.stage = e.target.value; window.__renderers['shipments'](); });
  $$('[data-shiptype]').forEach(btn => btn.addEventListener('click', () => { filters.type = btn.getAttribute('data-shiptype'); window.__renderers['shipments'](); }));
  const shipPaneToggle = $('#filterpane-shipments-btn');
  if (shipPaneToggle) shipPaneToggle.addEventListener('click', () => { filters.filterPaneHidden = !filters.filterPaneHidden; window.__renderers['shipments'](); });
  const shipPaneClose = $('#filterpane-shipments-close');
  if (shipPaneClose) shipPaneClose.addEventListener('click', () => { filters.filterPaneHidden = true; window.__renderers['shipments'](); });
  const shipPaneReset = $('#filterpane-shipments-reset');
  if (shipPaneReset) shipPaneReset.addEventListener('click', () => {
    filters.search = ''; filters.status = ''; filters.stage = 'open'; filters.type = 'foreign';
    window.__renderers['shipments']();
  });
  $('#ship-col-btn').addEventListener('click', e => cmOpenManager('shipments', shipCols, e.target, () => window.__renderers['shipments']()));
  $('#ship-export-btn').addEventListener('click', () => cmExportCSV('shipments', shipCols, filtered, 'shipments', {}));
  const newShipBtn = $('#new-shipment');
  if (newShipBtn) newShipBtn.addEventListener('click', () => window.openShipmentForm());
  window.PXView.bind('shipments', () => window.__renderers['shipments'](), viewEl);
};
