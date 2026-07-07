const { $, $$, fmtDate, fmtDateISO, fmtMoney, escapeHtml, statusBadgeClass, daysBetween,
  collection, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, toast,
  generateMilestonesFromTerm, computeMilestoneDate, milestoneStatus,
  orderFunction, functionForCategory, canEditOrders, canEditShipments,
  checkOrderDuplicates, orderDataQuality, orderHealth, buildOrderTimeline,
  isErpOrder, fieldEditable, erpFieldClass, erpSourceOf, erpBadgeFor, renderErpBadge,
  orderHasLines, orderLineSum, stripUndefined,
  currentEntity, recordEntity, entityMeta } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;

const getDefaultColumns = window.__ord_getDefaultColumns, loadColPrefs = window.__ord_loadColPrefs, saveColPrefs = window.__ord_saveColPrefs, getOrderedColumns = window.__ord_getOrderedColumns;

function renderOrdersList(type, fn) {
  // viewKey is e.g. "foreign-technical" — used for filter state keys, DOM ids, column prefs
  const viewKey = type + '-' + fn;
  const viewEl = $('#view-orders-' + viewKey);
  if (!viewEl) return;
  const functionMeta = REF.functions[fn];
  const functionLabel = functionMeta ? functionMeta.label : fn;
  const functionShort = functionMeta ? functionMeta.short : fn;
  const functionCategories = Object.entries(REF.categoryToFunction)
    .filter(([cat, f]) => f === fn).map(([cat]) => cat);

  // Filter to this orderType + function + current entity
  const ent = currentEntity();
  viewEl.dataset.renderEntity = ent;
  viewEl.dataset.renderScope = viewKey;
  const orders = state.data.orders.filter(o => !o.archived && o.orderType === type && orderFunction(o) === fn && recordEntity(o) === ent);
  const officers = state.data.officers;
  const officerMap = Object.fromEntries(officers.map(o => [o.code, o.fullName || o.code]));
  const ctx = { officerMap };

  const filters = state.filters[viewKey] || (state.filters[viewKey] = { search: '', officer: '', status: '', closed: 'open' });
  if (!filters.closed) filters.closed = 'open';

  // BC view tabs: a lightweight "saved view" filter layered on top of the base filters.
  // Default 'allopen'. Values: allopen | overdue | awaiting | closed.
  const bcView = filters.bcView || 'allopen';
  const _today = new Date();
  const _receiptCounts = r => window.PXReceiptControl
    ? window.PXReceiptControl.grnCountsAsReceipt(r)
    : !!(r && !['pending', 'cancelled'].includes(String(r.status || '').toLowerCase()) && (r.grnDate || r.actualReceiptDate || r.grnRef || r.grnNumber));
  const _isReceived = o => {
    if (o.deliveryDate || o.actualReceiptDate || (Array.isArray(o.receipts) && o.receipts.some(_receiptCounts))) return true;
    return (state.data.shipments || []).some(s =>
      !s.archived
      && window.PXUtils.shipmentBelongsToOrder
      && window.PXUtils.shipmentBelongsToOrder(s, o)
      && (s.deliveryDate || s.grnDate));
  };
  const _isOverdue = o => {
    if (o.isClosed) return false;
    const rr = o.requestedReceiptDate ? new Date(o.requestedReceiptDate) : null;
    return rr && rr < _today && !_isReceived(o);
  };
  const _isAwaiting = o => !o.isClosed && !_isReceived(o);
  function passesBcView(o) {
    switch (bcView) {
      case 'overdue':  return _isOverdue(o);
      case 'awaiting': return _isAwaiting(o);
      case 'closed':   return !!o.isClosed;
      case 'allopen':
      default:         return !o.isClosed;
    }
  }

  let filtered = orders.filter(o => {
    if (!passesBcView(o)) return false;
    if (filters.closed === 'open' && o.isClosed) return false;
    if (filters.closed === 'closed' && !o.isClosed) return false;
    if (filters.officer && o.officerCode !== filters.officer) return false;
    if (filters.status && o.status !== filters.status) return false;
    if (filters.category && o.category !== filters.category) return false;
    if (filters.ipr) {
      if (!String(o.iprNumber || '').toLowerCase().includes(filters.ipr.toLowerCase())) return false;
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = [o.orderId, o.supplier, o.claimant, o.description, o.iprNumber, o.officerCode, o.category].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Per-column filters + sort (from the column header controls).
  if (window.PXOrderSortFilter) {
    filtered = window.PXOrderSortFilter.applyColumnFilters(filtered, filters.colFilters);
    window.PXOrderSortFilter.applyColumnSort(filtered, filters.sortKey, filters.sortDir);
  }

  const columns = getOrderedColumns(viewKey, type);
  const visibleCols = columns.filter(c => c.visible);
  const canRequestOrderUpdate = !!(window.PXUpdateRequests && window.PXUpdateRequests.canRequestUpdate('order'));
  const allOfficers = [...new Set(orders.map(o => o.officerCode).filter(Boolean))].sort();
  const allStatuses = [...new Set(orders.map(o => o.status).filter(Boolean))].sort();
  const allCats = [...new Set(orders.map(o => o.category).filter(Boolean))].sort();
  const useFilterPane = !!(window.APP_CONFIG && window.APP_CONFIG.bcStructure);
  const activeFilterCount = [
    filters.search, filters.ipr, filters.officer, filters.status, filters.category,
    filters.closed && filters.closed !== 'open' ? filters.closed : ''
  ].filter(Boolean).length + ((filters.colFilters && Object.values(filters.colFilters).some(v => (v || '').trim())) ? 1 : 0);
  const viewOptions = [['allopen','All open'],['overdue','Overdue'],['awaiting','Awaiting receipt'],['closed','Closed']];
  const viewCount = k => orders.filter(o => {
    if (k === 'overdue') return _isOverdue(o);
    if (k === 'awaiting') return _isAwaiting(o);
    if (k === 'closed') return !!o.isClosed;
    return !o.isClosed;
  }).length;
  const bcViewTabsHtml = `<div class="bc-view-tabs" id="bc-tabs-${viewKey}">
    ${viewOptions.map(([k,label]) => `<div class="bc-view-tab ${bcView===k?'active':''}" data-bcview="${k}">${label} <span class="cnt">${viewCount(k)}</span></div>`).join('')}
  </div>`;
  const orderFilterPaneHtml = `
    <aside class="bc-filter-pane" id="filterpane-${viewKey}" aria-label="Filters">
      <div class="bc-filter-pane-head">
        <strong>Views</strong>
        <button class="bc-filter-close" id="filterpane-${viewKey}-close" title="Hide filters">×</button>
      </div>
      <div class="bc-filter-views">
        ${viewOptions.map(([k,label]) => `<button class="bc-filter-view ${bcView===k?'active':''}" data-bcview="${k}">
          <span>${label}</span><span class="cnt">${viewCount(k)}</span>
        </button>`).join('')}
      </div>
      <div class="bc-filter-section-title">Filter list by:</div>
      <label class="bc-filter-field">
        <span>Search</span>
        <input type="search" placeholder="PO, supplier, claimant..." id="${viewKey}-search" value="${escapeHtml(filters.search)}" />
      </label>
      <label class="bc-filter-field">
        <span>${escapeHtml(window.__iprLabel ? window.__iprLabel({ entity: ent }) : 'IPR No.')}</span>
        <input type="text" id="${viewKey}-ipr" value="${escapeHtml(filters.ipr || '')}" placeholder="Filter by IPR..." />
      </label>
      <label class="bc-filter-field">
        <span>Officer (P/L)</span>
        <select id="${viewKey}-officer">
          <option value="">All officers</option>
          ${allOfficers.map(o => `<option value="${escapeHtml(o)}" ${filters.officer===o?'selected':''}>${escapeHtml(officerMap[o] || o)}</option>`).join('')}
        </select>
      </label>
      <label class="bc-filter-field">
        <span>Status</span>
        <select id="${viewKey}-status">
          <option value="">All statuses</option>
          ${allStatuses.map(s => `<option value="${escapeHtml(s)}" ${filters.status===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}
        </select>
      </label>
      <label class="bc-filter-field">
        <span>Category</span>
        <select id="${viewKey}-category">
          <option value="">All categories</option>
          ${allCats.map(c => `<option value="${escapeHtml(c)}" ${filters.category===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}
        </select>
      </label>
      <label class="bc-filter-field">
        <span>Open</span>
        <select id="${viewKey}-closed">
          <option value="open" ${filters.closed==='open'?'selected':''}>Yes</option>
          <option value="closed" ${filters.closed==='closed'?'selected':''}>No - closed only</option>
          <option value="all" ${filters.closed==='all'?'selected':''}>All</option>
        </select>
      </label>
      <button class="bc-filter-add" id="colfilter-${viewKey}-btn" type="button">+ Filter...</button>
      <div class="bc-filter-totals">
        <div class="bc-filter-section-title">Filter totals by...</div>
        <button class="bc-filter-reset" id="filterpane-${viewKey}-reset" type="button">Reset filters</button>
      </div>
    </aside>`;

  // Card-first view (default); Table available via toggle. Both share the same filtered set.
  const vkey = 'orders-' + viewKey;
  const mode = window.PXView.mode(vkey);
  const ordCard = o => {
    const em = entityMeta(recordEntity(o)) || {};
    const needBy = o.requestedReceiptDate;
    const nd = needBy ? (needBy.toDate ? needBy.toDate() : new Date(needBy)) : null;
    const overdue = nd && !o.isClosed && nd < new Date();
    const pf = window.PXProcFollowup || null;
    const risk = pf ? pf.riskScore(o) : null;
    const chase = pf ? pf.nextChase(o) : null;
    let note = '';
    if (!o.isClosed && !o.orderAcknowledgedDate) note = 'Awaiting supplier acknowledgement';
    else if (overdue) note = 'Past requested receipt date';
    else if (risk && risk.reasons.length && ['high', 'critical'].includes(risk.level)) note = risk.reasons[0];
    const openReqCount = window.PXUpdateRequests ? window.PXUpdateRequests.openForTarget('order', o.id).length : 0;
    return window.PXCards.card({
      ref: o.orderId || '—', entity: em.short, entityAccent: em.accent,
      title: o.description, supplier: o.supplier,
      statusBadge: { text: o.status || (o.isClosed ? 'closed' : 'open'), cls: statusBadgeClass(o.status) },
      badges: [
        ...(o.isClosed ? [{ text: 'Closed', cls: 'success' }] : []),
        ...(risk && ['high', 'critical'].includes(risk.level) ? [{ text: `Risk ${risk.level} ${risk.score}`, cls: risk.cls }] : []),
        ...(openReqCount ? [{ text: openReqCount + ' update request' + (openReqCount > 1 ? 's' : ''), cls: 'warn' }] : [])
      ],
      dates: [
        { label: 'PO', value: o.dateOfOrder ? fmtDate(o.dateOfOrder) : '' },
        { label: 'Need-by', value: needBy ? fmtDate(needBy) : '', overdue },
        ...(chase && chase.next ? [{ label: 'Next chase', value: fmtDate(chase.next), overdue: chase.overdue }] : [])
      ],
      amount: o.amount != null ? fmtMoney(o.amount, o.currency) : null,
      owner: officerMap[o.officerCode] || o.officerCode || '',
      note, onclick: `openOrderDetail('${o.id}')`, actionLabel: 'Open',
      actions: canRequestOrderUpdate ? [{ label: 'Request update', cls: 'btn-primary', onclick: `openUpdateRequestModal('order','${o.id}')` }] : []
    });
  };
  const cardsHtml = window.PXCards.grid(filtered.map(ordCard).join(''), `No ${type} orders in ${functionShort} match these filters`);

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title">
        <h1>${type === 'foreign' ? 'Foreign' : 'Local'} Orders — ${escapeHtml(functionShort)}</h1>
        <span class="desc">${filtered.length} of ${orders.length} order(s) · Categories: ${functionCategories.map(c => `<span class="badge neutral" style="font-size:10px;margin-left:2px">${escapeHtml(c)}</span>`).join(' ')}</span>
      </div>
      <div class="page-actions">
        ${window.PXView.toggle(vkey)}
        <button class="btn bc-filter-command ${useFilterPane && !filters.filterPaneHidden ? 'btn-active' : ''}" id="filterpane-${viewKey}-btn" title="Show or hide list filters">☰ Filters${activeFilterCount ? ` (${activeFilterCount})` : ''}</button>
        <button class="btn" id="density-${viewKey}-btn" title="Toggle row density">${window.__getDensity && window.__getDensity()==='compact' ? '↕ Comfortable' : '↕ Compact'}</button>
        <div class="col-mgr">
          <button class="btn" id="col-mgr-${viewKey}-btn">⚙ Columns</button>
        </div>
        ${!useFilterPane ? `<button class="btn ${filters.showColFilters ? 'btn-active' : ''}" id="colfilter-${viewKey}-btn" title="Show per-column filters">⧩ Filter${(filters.colFilters && Object.values(filters.colFilters).some(v => (v||'').trim())) ? ' •' : ''}</button>` : ''}
        <button class="btn" id="export-${viewKey}-csv">⤓ Export Excel</button>
        ${canEditOrders() ? `<button class="btn btn-primary" id="new-${viewKey}-order">+ New ${type === 'foreign' ? 'FPO' : 'LPO'}</button>` : ''}
      </div>
    </div>
    ${useFilterPane ? `<div class="bc-filter-layout ${filters.filterPaneHidden ? 'pane-hidden' : ''}">
      ${orderFilterPaneHtml}
      <div class="bc-filter-content">` : `${bcViewTabsHtml}
      <div class="toolbar">
        <div class="search"><input type="search" placeholder="Search by PO, supplier, claimant, description, IPR, category…" id="${viewKey}-search" value="${escapeHtml(filters.search)}" /></div>
        <select id="${viewKey}-officer">
          <option value="">All officers</option>
          ${allOfficers.map(o => `<option value="${escapeHtml(o)}" ${filters.officer===o?'selected':''}>${escapeHtml(officerMap[o] || o)}</option>`).join('')}
        </select>
        <select id="${viewKey}-status">
          <option value="">All statuses</option>
          ${allStatuses.map(s => `<option value="${escapeHtml(s)}" ${filters.status===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}
        </select>
        <select id="${viewKey}-closed">
          <option value="open" ${filters.closed==='open'?'selected':''}>Open only</option>
          <option value="closed" ${filters.closed==='closed'?'selected':''}>Closed only</option>
          <option value="all" ${filters.closed==='all'?'selected':''}>All</option>
        </select>
        <div class="filter-count">${filtered.length}</div>
      </div>`}
    ${mode === 'cards' ? cardsHtml : `<div class="table-wrap orders-table">
      ${canEditOrders() ? `<div class="bulk-bar" id="bulk-bar-${viewKey}" style="display:none;align-items:center;gap:12px;padding:8px 12px;margin-bottom:8px;background:var(--surface-warm);border:1px solid var(--line);border-radius:6px">
        <strong id="bulk-count-${viewKey}" style="font-size:13px">0 selected</strong>
        <button class="btn btn-sm btn-primary" id="bulk-update-${viewKey}">Bulk update…</button>
        <button class="btn btn-sm" id="bulk-clear-${viewKey}">Clear</button>
        <span class="hint" style="font-size:11px;color:var(--muted-soft)">Validation &amp; audit run on each order.</span>
      </div>` : ''}
      <div class="table-scroll">
        <table class="data resizable" data-colw="orderslist-${viewKey}">
          <thead>
            <tr>
              ${canEditOrders() ? `<th class="col-bulksel" style="width:34px;text-align:center"><input type="checkbox" id="bulk-all-${viewKey}" title="Select all shown" /></th>` : ''}
              ${visibleCols.map(c => `<th class="${c.num?'num ':''}col-${escapeHtml(c.key)} sortable-col" data-colkey="${escapeHtml(c.key)}"${(() => { try { const w = JSON.parse(localStorage.getItem('phoenix_colw_orderslist-'+viewKey)||'{}')[c.key]; return w?` style="width:${w}px"`:''; } catch(_) { return ''; } })()}><span class="th-label" onclick="event.stopPropagation(); window.PXOrderSortFilter && window.PXOrderSortFilter.toggleSort('${viewKey}','${escapeHtml(c.key)}')" title="Sort by ${escapeHtml(c.label)}">${escapeHtml(c.label)}${window.PXOrderSortFilter ? window.PXOrderSortFilter.sortGlyph(viewKey, c.key) : ''}</span><span class="col-resize" data-resize="${escapeHtml(c.key)}"></span></th>`).join('')}
              ${canRequestOrderUpdate ? '<th class="actions">Update</th>' : ''}
            </tr>
            ${filters.showColFilters ? `<tr class="col-filter-row">
              ${canEditOrders() ? '<th></th>' : ''}
              ${visibleCols.map(c => `<th class="col-${escapeHtml(c.key)}"><input type="text" class="col-filter-input" data-colkey="${escapeHtml(c.key)}" value="${escapeHtml((filters.colFilters && filters.colFilters[c.key]) || '')}" placeholder="Filter…" oninput="window.PXOrderSortFilter && window.PXOrderSortFilter.setColumnFilter('${viewKey}','${escapeHtml(c.key)}', this.value)" onclick="event.stopPropagation()" /></th>`).join('')}
              ${canRequestOrderUpdate ? '<th></th>' : ''}
            </tr>` : ''}
          </thead>
          <tbody>
            ${filtered.length === 0 ? `
              <tr><td colspan="${visibleCols.length + (canEditOrders()?1:0) + (canRequestOrderUpdate?1:0)}" class="empty-state">
                ${orders.length === 0 ? `
                  <div class="ic">📦</div>
                  <h3>No ${type} orders in ${escapeHtml(functionShort)} yet</h3>
                  <p>${canEditOrders() ? 'Import from ERP, load a sample order in Reports, or create one to get started.' : 'Orders will appear here once procurement imports or creates them.'}</p>
                ` : `
                  <div class="ic">📋</div>
                  <h3>No ${type} orders in ${escapeHtml(functionShort)} match these filters</h3>
                  <p>Adjust filters${canEditOrders() ? ' or create a new one' : ''}.</p>
                `}
              </td></tr>
            ` : filtered.map(o => `
              <tr data-oid="${o.id}">
                ${canEditOrders() ? `<td class="col-bulksel" style="text-align:center" onclick="event.stopPropagation()"><input type="checkbox" class="bulk-row-${viewKey}" value="${o.id}" /></td>` : ''}
                ${visibleCols.map(c => `<td class="col-${c.key}${c.num?' num':''}" onclick="openOrderDetail('${o.id}')">${c.render(o, ctx)}</td>`).join('')}
                ${canRequestOrderUpdate ? `<td class="actions" onclick="event.stopPropagation()"><button class="btn btn-sm btn-primary" onclick="openUpdateRequestModal('order','${o.id}')">Request update</button>${(() => { const n = window.PXUpdateRequests ? window.PXUpdateRequests.openForTarget('order', o.id).length : 0; return n ? ` <span class="badge warn" title="${n} open request(s)">${n}</span>` : ''; })()}</td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>`}
    ${useFilterPane ? `</div></div>` : ''}
  `;

  const s = $('#'+viewKey+'-search');
  window.PXUtils.bindSearchInput(s, {
    key: 'orders-' + viewKey + '-search',
    setValue: value => { filters.search = value; },
    render: () => renderOrdersList(type, fn)
  });
  const iprInput = $('#'+viewKey+'-ipr');
  if (iprInput) window.PXUtils.bindSearchInput(iprInput, {
    key: 'orders-' + viewKey + '-ipr',
    setValue: value => { filters.ipr = value; },
    render: () => renderOrdersList(type, fn)
  });
  const officerFilter = $('#'+viewKey+'-officer');
  if (officerFilter) officerFilter.addEventListener('change', e => { filters.officer = e.target.value; renderOrdersList(type, fn); });
  const statusFilter = $('#'+viewKey+'-status');
  if (statusFilter) statusFilter.addEventListener('change', e => { filters.status = e.target.value; renderOrdersList(type, fn); });
  const categoryFilter = $('#'+viewKey+'-category');
  if (categoryFilter) categoryFilter.addEventListener('change', e => { filters.category = e.target.value; renderOrdersList(type, fn); });
  const closedFilter = $('#'+viewKey+'-closed');
  if (closedFilter) closedFilter.addEventListener('change', e => { filters.closed = e.target.value; renderOrdersList(type, fn); });
  // BC view-tab clicks
  const bcTabs = document.getElementById('bc-tabs-'+viewKey);
  if (bcTabs) bcTabs.querySelectorAll('.bc-view-tab').forEach(tab => {
    tab.addEventListener('click', () => { filters.bcView = tab.getAttribute('data-bcview'); renderOrdersList(type, fn); });
  });
  viewEl.querySelectorAll('.bc-filter-view').forEach(tab => {
    tab.addEventListener('click', () => { filters.bcView = tab.getAttribute('data-bcview'); renderOrdersList(type, fn); });
  });
  const paneToggle = $('#filterpane-'+viewKey+'-btn');
  if (paneToggle) paneToggle.addEventListener('click', () => { filters.filterPaneHidden = !filters.filterPaneHidden; renderOrdersList(type, fn); });
  const paneClose = $('#filterpane-'+viewKey+'-close');
  if (paneClose) paneClose.addEventListener('click', () => { filters.filterPaneHidden = true; renderOrdersList(type, fn); });
  const paneReset = $('#filterpane-'+viewKey+'-reset');
  if (paneReset) paneReset.addEventListener('click', () => {
    filters.search = ''; filters.ipr = ''; filters.officer = ''; filters.status = ''; filters.category = '';
    filters.closed = 'open'; filters.colFilters = {}; filters.sortKey = null; filters.sortDir = null;
    renderOrdersList(type, fn);
  });
  const newOrderBtn = $('#new-'+viewKey+'-order');
  if (newOrderBtn) newOrderBtn.addEventListener('click', () => window.openOrderForm(null, type, fn));
  $('#export-'+viewKey+'-csv').addEventListener('click', () => window.exportOrdersCSV(filtered, viewKey));
  $('#col-mgr-'+viewKey+'-btn').addEventListener('click', e => openColumnManager(viewKey, type, e.target));
  { const fb = $('#colfilter-'+viewKey+'-btn'); if (fb) fb.addEventListener('click', () => window.PXOrderSortFilter && window.PXOrderSortFilter.toggleFilterRow(viewKey)); }
  { const db = $('#density-'+viewKey+'-btn'); if (db) db.addEventListener('click', () => { window.__toggleDensity(); renderOrdersList(type, fn); }); }

  // ===== Bulk selection + bulk update (table mode) =====
  if (canEditOrders() && mode !== 'cards') {
    const bar      = $('#bulk-bar-'+viewKey);
    const countEl  = $('#bulk-count-'+viewKey);
    const allBox   = $('#bulk-all-'+viewKey);
    const rowBoxes = () => $$('.bulk-row-'+viewKey);
    const selectedIds = () => rowBoxes().filter(b => b.checked).map(b => b.value);
    const refreshBar = () => {
      const n = selectedIds().length;
      if (countEl) countEl.textContent = n + ' selected';
      if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
      if (allBox) {
        const boxes = rowBoxes();
        allBox.checked = boxes.length > 0 && n === boxes.length;
        allBox.indeterminate = n > 0 && n < boxes.length;
      }
    };
    if (allBox) allBox.addEventListener('change', e => { rowBoxes().forEach(b => { b.checked = e.target.checked; }); refreshBar(); });
    rowBoxes().forEach(b => b.addEventListener('change', refreshBar));
    const clearBtn = $('#bulk-clear-'+viewKey);
    if (clearBtn) clearBtn.addEventListener('click', () => { rowBoxes().forEach(b => { b.checked = false; }); refreshBar(); });
    const updBtn = $('#bulk-update-'+viewKey);
    if (updBtn) updBtn.addEventListener('click', () => openBulkUpdateModal(selectedIds(), () => renderOrdersList(type, fn)));
    refreshBar();
  }

  window.PXView.bind(vkey, () => renderOrdersList(type, fn), viewEl);
}

/* ===== Column Manager — drag/drop reorder + show/hide ===== */
function openColumnManager(viewKey, type, anchor) {
  // viewKey = "foreign-technical" etc; type = "foreign" | "local"
  // close any existing panel
  $$('.col-mgr-panel').forEach(p => p.remove());
  const columns = getOrderedColumns(viewKey, type);
  const fn = viewKey.split('-').slice(1).join('-');  // e.g. "supplychain"
  const panel = document.createElement('div');
  panel.className = 'col-mgr-panel';
  panel.innerHTML = `
    <div class="head">Drag to reorder · tick to show</div>
    ${columns.map(c => `
      <div class="col-mgr-item" draggable="true" data-key="${c.key}">
        <span class="grip">⋮⋮</span>
        <input type="checkbox" id="col-${c.key}" ${c.visible?'checked':''} />
        <label for="col-${c.key}">${escapeHtml(c.label)}</label>
      </div>
    `).join('')}
    <div class="col-mgr-foot">
      <button id="col-reset">Reset to defaults</button>
      <button id="col-close">Done</button>
    </div>
  `;
  anchor.parentElement.appendChild(panel);
  if (window.__positionColMgrPanel) window.__positionColMgrPanel(panel, anchor);

  function getCurrentPrefs() {
    const items = panel.querySelectorAll('.col-mgr-item');
    const order = Array.from(items).map(i => i.dataset.key);
    const visible = {};
    items.forEach(i => { visible[i.dataset.key] = i.querySelector('input').checked; });
    return { order, visible };
  }

  // Drag and drop
  let draggedEl = null;
  panel.querySelectorAll('.col-mgr-item').forEach(item => {
    item.addEventListener('dragstart', e => { draggedEl = item; item.classList.add('dragging'); });
    item.addEventListener('dragend', e => { item.classList.remove('dragging'); panel.querySelectorAll('.col-mgr-item').forEach(i => i.classList.remove('drag-over')); });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      if (draggedEl !== item) item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', e => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      e.preventDefault();
      if (draggedEl !== item) {
        const all = Array.from(panel.querySelectorAll('.col-mgr-item'));
        const fromIdx = all.indexOf(draggedEl);
        const toIdx = all.indexOf(item);
        if (fromIdx < toIdx) item.after(draggedEl); else item.before(draggedEl);
      }
      item.classList.remove('drag-over');
    });
  });

  // Checkbox changes: save the preference silently but DO NOT re-render the whole list
  // on every tick (that destroyed this panel and forced one-at-a-time selection). The
  // list refreshes once when the user clicks Done / closes the panel.
  panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      saveColPrefs(viewKey, getCurrentPrefs());
    });
  });

  panel.querySelector('#col-close').addEventListener('click', () => {
    saveColPrefs(viewKey, getCurrentPrefs());
    panel.remove();
    renderOrdersList(type, fn);
  });
  panel.querySelector('#col-reset').addEventListener('click', () => {
    localStorage.removeItem('phoenix_cols_' + viewKey);
    panel.remove();
    renderOrdersList(type, fn);
  });

  // After drag-drop, save on any drop event
  panel.addEventListener('drop', () => {
    setTimeout(() => saveColPrefs(viewKey, getCurrentPrefs()), 50);
  });

  // close on outside click
  setTimeout(() => {
    document.addEventListener('click', function dismiss(ev) {
      if (!panel.contains(ev.target) && ev.target !== anchor) {
        saveColPrefs(viewKey, getCurrentPrefs());
        panel.remove();
        renderOrdersList(type, fn);
        document.removeEventListener('click', dismiss);
      }
    });
  }, 100);
}

/* ===== Bulk update modal — apply one field/value to many orders at once =====
   Repetitive officer task (e.g. "these five shipped Tuesday"). Each order is written
   through PXStore.updateRecord so validation + audit logging run per record. Locked
   ERP fields and closed-order rules are respected by the normal write path. */
function openBulkUpdateModal(ids, onDone) {
  if (!ids || !ids.length) { toast('Select at least one order first.', 'warn'); return; }
  const orders = ids.map(id => state.data.orders.find(o => o.id === id)).filter(Boolean);
  if (!orders.length) { toast('Selected orders not found.', 'danger'); return; }

  // Fields safe to bulk-set (operational, Phoenix-owned, no per-order computation needed).
  const canReassign = !!(window.PXUtils && window.PXUtils.canReassignOrders && window.PXUtils.canReassignOrders());
  const FIELDS = [
    { key: 'status',                    label: 'Current Status',         input: 'select', options: REF.orderFollowupStatuses || REF.statuses },
    { key: 'orderSentToSupplierDate',   label: 'Order Sent to Supplier', input: 'date' },
    { key: 'orderAcknowledgedDate',     label: 'Order Acknowledged',     input: 'date' },
    { key: 'orderReadyDate',            label: 'Order Ready Date',       input: 'date' },
    { key: 'requestedReceiptDate',      label: 'Requested Receipt Date', input: 'date' },
    // Reassigning the purchasing officer is a supervisor/manager action only.
    ...(canReassign ? [{ key: 'officerCode', label: 'Purchasing Officer', input: 'officer' }] : []),
  ];
  const officers = state.data.officers.filter(o => o.active !== false);

  const fieldOptions = FIELDS.map((f, i) => `<option value="${i}">${escapeHtml(f.label)}</option>`).join('');
  window.openModal(`
    <div class="modal-head"><div><h2>Bulk update ${orders.length} order${orders.length>1?'s':''}</h2>
      <div class="sub">${orders.slice(0,6).map(o=>escapeHtml(o.orderId)).join(', ')}${orders.length>6?` +${orders.length-6} more`:''}</div></div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
    <div class="modal-body"><form id="bulk-form">
      <div class="form-grid cols-2">
        <div class="field-group"><label>Field to update</label>
          <select name="field" id="bulk-field">${fieldOptions}</select></div>
        <div class="field-group" id="bulk-value-wrap"></div>
      </div>
      <div class="info-banner" style="margin-top:8px">Applies the same value to every selected order. Each save is validated and audit-logged individually; any order that fails validation is reported and skipped, the rest still save.</div>
    </form></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="bulk-apply">Apply to ${orders.length} order${orders.length>1?'s':''}</button></div>
  `);

  function renderValueInput() {
    const f = FIELDS[parseInt($('#bulk-field').value, 10)];
    const wrap = $('#bulk-value-wrap');
    if (!wrap || !f) return;
    let inner = '';
    if (f.input === 'select') {
      inner = `<label>${escapeHtml(f.label)}</label><select name="value"><option value="">— Select —</option>${f.options.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select>`;
    } else if (f.input === 'date') {
      inner = `<label>${escapeHtml(f.label)}</label><input type="date" name="value" />`;
    } else if (f.input === 'officer') {
      inner = `<label>${escapeHtml(f.label)}</label><select name="value"><option value="">— Select —</option>${officers.map(o=>`<option value="${escapeHtml(o.code||'')}">${escapeHtml(o.fullName||o.code)} (${escapeHtml(o.code||'')})</option>`).join('')}</select>`;
    }
    wrap.innerHTML = inner;
  }
  $('#bulk-field').addEventListener('change', renderValueInput);
  renderValueInput();

  $('#bulk-apply').addEventListener('click', async () => {
    const f = FIELDS[parseInt($('#bulk-field').value, 10)];
    const raw = (new FormData($('#bulk-form'))).get('value');
    if (!raw) { toast('Choose a value to apply.', 'warn'); return; }
    const value = f.input === 'date' ? new Date(raw) : raw;

    const btn = $('#bulk-apply');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Applying…';
    let ok = 0; const failures = [];
    for (const o of orders) {
      try {
        await window.PXStore.updateRecord('orders', o.id, { [f.key]: value }, {
          log: { recordType: 'order', action: 'bulk-update', details: `Bulk set ${f.label} = ${raw}` }
        });
        ok++;
      } catch (e) {
        failures.push(`${o.orderId}: ${(e && e.message) ? e.message : 'update failed'}`);
      }
    }
    closeModal();
    if (failures.length) {
      toast(`${ok} updated, ${failures.length} skipped. ${failures[0]}`, failures.length === orders.length ? 'danger' : 'warn');
    } else {
      toast(`${ok} order${ok>1?'s':''} updated — ${f.label} set.`, 'success');
    }
    if (typeof onDone === 'function') onDone();
  });
}

window.__renderers['orders-foreign-technical']   = () => renderOrdersList('foreign', 'technical');
window.__renderers['orders-foreign-indirect']    = () => renderOrdersList('foreign', 'indirect');
window.__renderers['orders-foreign-supplychain'] = () => renderOrdersList('foreign', 'supplychain');
window.__renderers['orders-local-technical']     = () => renderOrdersList('local', 'technical');
window.__renderers['orders-local-indirect']      = () => renderOrdersList('local', 'indirect');
window.__renderers['orders-local-supplychain']   = () => renderOrdersList('local', 'supplychain');

/* ---------- Closed Orders (own page, current entity, all types/functions) ---------- */
function renderClosedOrders() {
  const viewEl = $('#view-closedorders');
  if (!viewEl) return;
  const ent = currentEntity();
  const meta = entityMeta(ent) || {};
  const closed = state.data.orders.filter(o => !o.archived && o.isClosed && recordEntity(o) === ent);
  const officers = state.data.officers || [];
  const officerMap = Object.fromEntries(officers.map(o => [o.code, o.fullName || o.code]));

  const filters = state.filters.closedorders || (state.filters.closedorders = { search: '', fn: '', type: '' });
  const useFilterPane = !!(window.APP_CONFIG && window.APP_CONFIG.bcStructure);
  let filtered = closed.filter(o => {
    if (filters.fn && orderFunction(o) !== filters.fn) return false;
    if (filters.type && o.orderType !== filters.type) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = [o.orderId, o.supplier, o.description, o.iprNumber, o.officerCode, o.category].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  // Most recently closed first (fall back to order date)
  filtered.sort((a, b) => {
    const da = a.closedAt?.toDate ? a.closedAt.toDate() : (a.closedAt ? new Date(a.closedAt) : (a.dateOfOrder?.toDate ? a.dateOfOrder.toDate() : new Date(a.dateOfOrder || 0)));
    const db_ = b.closedAt?.toDate ? b.closedAt.toDate() : (b.closedAt ? new Date(b.closedAt) : (b.dateOfOrder?.toDate ? b.dateOfOrder.toDate() : new Date(b.dateOfOrder || 0)));
    return db_ - da;
  });

  const totalValue = filtered.reduce((s, o) => s + (Number(o.amount) || 0), 0);
  const activeFilterCount = [filters.search, filters.fn, filters.type].filter(Boolean).length;
  const closedTypeOptions = [
    ['', 'All closed', closed.length],
    ['foreign', 'Foreign', closed.filter(o => o.orderType === 'foreign').length],
    ['local', 'Local', closed.filter(o => o.orderType === 'local').length]
  ];
  const closedFilterPaneHtml = `
    <aside class="bc-filter-pane" id="filterpane-closedorders" aria-label="Filters">
      <div class="bc-filter-pane-head">
        <strong>Views</strong>
        <button class="bc-filter-close" id="filterpane-closedorders-close" title="Hide filters">×</button>
      </div>
      <div class="bc-filter-views">
        ${closedTypeOptions.map(([k,label,n]) => `<button class="bc-filter-view ${filters.type===k?'active':''}" data-closed-type="${escapeHtml(k)}">
          <span>${escapeHtml(label)}</span><span class="cnt">${n}</span>
        </button>`).join('')}
      </div>
      <div class="bc-filter-section-title">Filter list by:</div>
      <label class="bc-filter-field">
        <span>Search</span>
        <input type="search" id="closed-search" placeholder="PO, supplier, description..." value="${escapeHtml(filters.search)}" />
      </label>
      <label class="bc-filter-field">
        <span>Function</span>
        <select id="closed-fn">
          <option value="">All functions</option>
          ${Object.entries(REF.functions).map(([k, v]) => `<option value="${k}" ${filters.fn===k?'selected':''}>${escapeHtml(v.label || k)}</option>`).join('')}
        </select>
      </label>
      <div class="bc-filter-totals">
        <div class="bc-filter-section-title">Filter totals by...</div>
        <button class="bc-filter-reset" id="filterpane-closedorders-reset" type="button">Reset filters</button>
      </div>
    </aside>`;
  const rows = filtered.map(o => `
    <tr onclick="openOrderDetail('${o.id}')" style="cursor:pointer">
      <td><span class="mono">${escapeHtml(o.orderId || '—')}</span></td>
      <td>${escapeHtml(o.orderType === 'foreign' ? 'Foreign' : 'Local')}</td>
      <td>${escapeHtml(REF.functions[orderFunction(o)]?.short || '—')}</td>
      <td class="col-supplier"><span class="truncate">${escapeHtml(o.supplier || '—')}</span></td>
      <td class="col-description"><span class="wrap">${escapeHtml(o.description || '—')}</span></td>
      <td class="num">${fmtMoney(o.amount, o.currency) || '—'}</td>
      <td>${escapeHtml(officerMap[o.officerCode] || o.officerCode || '—')}</td>
      <td>${fmtDate(o.dateOfOrder) || '—'}</td>
      <td><span class="badge ${statusBadgeClass(o.status)}">${escapeHtml(o.status || '—')}</span></td>
    </tr>`).join('');

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title">
        <h1>Closed Orders <span class="badge" style="background:${meta.accent || '#888'};color:#fff;font-size:11px;vertical-align:middle">${escapeHtml(ent)}</span></h1>
        <span class="desc">${filtered.length} closed order(s) · total value ${fmtMoney(totalValue, filtered[0]?.currency || 'MUR')} · click any row to view</span>
      </div>
      <div class="page-actions">
        <button class="btn bc-filter-command ${useFilterPane && !filters.filterPaneHidden ? 'btn-active' : ''}" id="filterpane-closedorders-btn" title="Show or hide list filters">☰ Filters${activeFilterCount ? ` (${activeFilterCount})` : ''}</button>
      </div>
    </div>
    ${useFilterPane ? `<div class="bc-filter-layout ${filters.filterPaneHidden ? 'pane-hidden' : ''}">
      ${closedFilterPaneHtml}
      <div class="bc-filter-content">` : `<div class="toolbar">
        <div class="search"><input type="search" id="closed-search" placeholder="Search PO, supplier, description…" value="${escapeHtml(filters.search)}" /></div>
        <select id="closed-type">
          <option value="">All types</option>
          <option value="foreign" ${filters.type==='foreign'?'selected':''}>Foreign</option>
          <option value="local" ${filters.type==='local'?'selected':''}>Local</option>
        </select>
        <select id="closed-fn">
          <option value="">All functions</option>
          ${Object.entries(REF.functions).map(([k, v]) => `<option value="${k}" ${filters.fn===k?'selected':''}>${escapeHtml(v.label || k)}</option>`).join('')}
        </select>
        <div class="filter-count">${filtered.length}</div>
      </div>`}
    <div class="table-wrap orders-table"><div class="table-scroll"><table class="data resizable" data-colw="closedorders">
      <thead><tr>${[['po','PO'],['type','Type'],['fn','Function'],['supplier','Supplier'],['description','Description'],['amount','Amount',true],['officer','Officer'],['orderdate','Order Date'],['status','Status']].map(([k,label,num]) => `<th class="${num?'num ':''}col-${k}" data-colkey="${k}"${(() => { try { const w = JSON.parse(localStorage.getItem('phoenix_colw_closedorders')||'{}')[k]; return w?` style="width:${w}px"`:''; } catch(_) { return ''; } })()}>${label}<span class="col-resize" data-resize="${k}"></span></th>`).join('')}</tr></thead>
      <tbody>${rows || `<tr><td colspan="9" class="empty-state"><div class="ic">📦</div><h3>No closed orders for ${escapeHtml(ent)}</h3><p>Orders you close will appear here, still fully viewable.</p></td></tr>`}</tbody>
    </table></div></div>
    ${useFilterPane ? `</div></div>` : ''}
  `;
  window.PXUtils.bindSearchInput('#closed-search', {
    key: 'closedorders-search',
    setValue: value => { filters.search = value; },
    render: () => renderClosedOrders()
  });
  const closedType = $('#closed-type');
  if (closedType) closedType.addEventListener('change', e => { filters.type = e.target.value; renderClosedOrders(); });
  const closedFn = $('#closed-fn');
  if (closedFn) closedFn.addEventListener('change', e => { filters.fn = e.target.value; renderClosedOrders(); });
  viewEl.querySelectorAll('[data-closed-type]').forEach(btn => btn.addEventListener('click', () => { filters.type = btn.getAttribute('data-closed-type'); renderClosedOrders(); }));
  const closedPaneToggle = $('#filterpane-closedorders-btn');
  if (closedPaneToggle) closedPaneToggle.addEventListener('click', () => { filters.filterPaneHidden = !filters.filterPaneHidden; renderClosedOrders(); });
  const closedPaneClose = $('#filterpane-closedorders-close');
  if (closedPaneClose) closedPaneClose.addEventListener('click', () => { filters.filterPaneHidden = true; renderClosedOrders(); });
  const closedPaneReset = $('#filterpane-closedorders-reset');
  if (closedPaneReset) closedPaneReset.addEventListener('click', () => {
    filters.search = ''; filters.fn = ''; filters.type = '';
    renderClosedOrders();
  });
}
window.__renderers['closedorders'] = renderClosedOrders;
