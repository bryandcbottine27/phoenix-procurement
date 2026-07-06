const { $, $$, fmtDate, fmtDateISO, fmtMoney, escapeHtml, statusBadgeClass,
  collection, addDoc, doc, updateDoc, deleteDoc, setDoc, runTransaction, getDoc, getDocs,
  serverTimestamp, toast, computeMilestoneDate, query, where,
  checkRfpDuplicates, rfpDataQuality, can, currentEntity, recordEntity, entityMeta, stripUndefined,
  cmGetColumns, cmRenderTable, cmOpenManager, cmExportCSV } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;


window.__renderers['payments'] = function() {
  const viewEl = $('#view-payments');
  const ent = currentEntity();
  const payEntity = p => p.entity || (() => { const o = state.data.orders.find(x => x.orderId === p.orderId); return o ? recordEntity(o) : 'Phoenix'; })();
  // Derive Local / Foreign from the linked order (no field on the RFP itself).
  const payType = p => {
    const o = state.data.orders.find(x => x.orderId === p.orderId);
    return (o && o.orderType === 'local') ? 'local' : 'foreign';
  };
  const pays = state.data.payments.filter(p => !p.archived && payEntity(p) === ent);
  const filters = state.filters.payments || (state.filters.payments = { search: '', status: '', tab: 'foreign' });
  if (!filters.tab) filters.tab = 'foreign';
  const canCreatePayment = can('payments', 'create');
  const canEditPayment = can('payments', 'edit');
  const canApprovePayment = can('payments', 'approve');

  const foreignCount = pays.filter(p => payType(p) === 'foreign').length;
  const localCount = pays.filter(p => payType(p) === 'local').length;
  const useFilterPane = !!(window.APP_CONFIG && window.APP_CONFIG.bcStructure);
  const activeFilterCount = [
    filters.search, filters.status,
    filters.tab && filters.tab !== 'foreign' ? filters.tab : ''
  ].filter(Boolean).length;
  const tabOptions = [
    ['foreign', 'Foreign RFPs', foreignCount],
    ['local', 'Local RFPs', localCount]
  ];
  const paymentFilterPaneHtml = `
    <aside class="bc-filter-pane" id="filterpane-payments" aria-label="Filters">
      <div class="bc-filter-pane-head">
        <strong>Views</strong>
        <button class="bc-filter-close" id="filterpane-payments-close" title="Hide filters">×</button>
      </div>
      <div class="bc-filter-views">
        ${tabOptions.map(([k,label,n]) => `<button class="bc-filter-view ${filters.tab===k?'active':''}" data-paytab="${k}">
          <span>${label}</span><span class="cnt">${n}</span>
        </button>`).join('')}
      </div>
      <div class="bc-filter-section-title">Filter list by:</div>
      <label class="bc-filter-field">
        <span>Search</span>
        <input type="search" placeholder="RFP, FPO, supplier, invoice..." id="pay-search" value="${escapeHtml(filters.search)}" />
      </label>
      <label class="bc-filter-field">
        <span>Status</span>
        <select id="pay-status">
          <option value="">All statuses</option>
          ${REF.rfpStatuses.map(st => `<option value="${escapeHtml(st)}" ${filters.status===st?'selected':''}>${escapeHtml(st)}</option>`).join('')}
        </select>
      </label>
      <div class="bc-filter-totals">
        <div class="bc-filter-section-title">Filter totals by...</div>
        <button class="bc-filter-reset" id="filterpane-payments-reset" type="button">Reset filters</button>
      </div>
    </aside>`;

  let filtered = pays.filter(p => {
    if (payType(p) !== filters.tab) return false;
    if (filters.status && p.status !== filters.status) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = [p.rfpRef, p.orderId, p.supplier, p.invoiceNumber].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Column definitions for payment requests
  const payCols = [
    { key: 'rfpRef', label: 'RFP Ref', render: p => `<span class="mono" style="font-weight:600">${escapeHtml(p.rfpRef || '—')}</span>`, raw: p => p.rfpRef },
    { key: 'requestDate', label: 'Date', render: p => fmtDate(p.requestDate), raw: p => p.requestDate },
    { key: 'orderId', label: 'FPO', render: p => `<span class="mono">${escapeHtml(p.orderId || '—')}</span>`, raw: p => p.orderId },
    { key: 'supplier', label: 'Supplier', render: p => `<span class="truncate" title="${escapeHtml(p.supplier||'')}">${escapeHtml(p.supplier || '—')}</span>`, raw: p => p.supplier },
    { key: 'milestoneLabel', label: 'Milestone', defaultVisible: false, render: p => escapeHtml(p.milestoneLabel || (p.milestoneId ? 'linked' : '—')), raw: p => p.milestoneLabel },
    { key: 'amount', label: 'Amount', num: true, render: p => fmtMoney(p.amount, p.currency), raw: p => p.amount },
    { key: 'currency', label: 'Curr.', defaultVisible: false, render: p => escapeHtml(p.currency || '—'), raw: p => p.currency },
    { key: 'invoiceDate', label: 'Invoice Date', defaultVisible: false, render: p => fmtDate(p.invoiceDate) || '—', raw: p => p.invoiceDate },
    { key: 'dueDate', label: 'Due Date', render: p => fmtDate(p.dueDate), raw: p => p.dueDate },
    { key: 'paymentTerms', label: 'Terms', defaultVisible: false, render: p => `<span class="text-xs truncate" title="${escapeHtml(p.paymentTerms||'')}" style="max-width:140px;display:inline-block">${escapeHtml(p.paymentTerms || '—')}</span>`, raw: p => p.paymentTerms },
    { key: 'status', label: 'Status', render: p => `<span class="badge ${statusBadgeClass(p.status)}">${escapeHtml(p.status || '—')}</span>`, raw: p => p.status },
    { key: 'invoiceNumber', label: 'Invoice', render: p => `<span class="mono text-sm truncate" title="${escapeHtml(p.invoiceNumber||'')}">${escapeHtml(p.invoiceNumber || '—')}</span>`, raw: p => p.invoiceNumber },
    { key: 'grnNumber', label: 'GRN', defaultVisible: false, render: p => `<span class="mono text-sm">${escapeHtml(p.grnNumber || '—')}</span>`, raw: p => p.grnNumber },
    { key: 'iblValueDate', label: 'IBL Value Date', defaultVisible: false, render: p => fmtDate(p.iblValueDate) || '—', raw: p => p.iblValueDate },
    { key: 'requestedBy', label: 'By', render: p => escapeHtml(p.requestedBy || '—'), raw: p => p.requestedBy },
    { key: '_approved', label: 'Approved', render: p => `
        ${canApprovePayment ? `<label class="rfp-tick" title="Request for payment approved" onclick="event.stopPropagation()">
          <input type="checkbox" ${p.paymentApproved?'checked':''} onchange="event.stopPropagation(); window.__toggleRfpFlag('${p.id}','paymentApproved', this.checked, event)" />
          <span class="rfp-tick-date">${p.paymentApproved && p.paymentApprovedDate ? fmtDate(p.paymentApprovedDate) : ''}</span>
        </label>` : `<span class="badge ${p.paymentApproved ? 'success' : 'neutral'}">${p.paymentApproved ? 'approved' : 'not approved'}</span>${p.paymentApproved && p.paymentApprovedDate ? `<div class="text-xs text-muted">${fmtDate(p.paymentApprovedDate)}</div>` : ''}`}
      `, csv: p => p.paymentApproved ? ('approved ' + (p.paymentApprovedDate ? fmtDate(p.paymentApprovedDate) : '')) : '' },
    { key: '_paid', label: 'Paid', render: p => `
        ${canEditPayment ? `<label class="rfp-tick" title="Payment made" onclick="event.stopPropagation()">
          <input type="checkbox" ${p.isPaid?'checked':''} onchange="event.stopPropagation(); window.__toggleRfpFlag('${p.id}','isPaid', this.checked, event)" />
          <span class="rfp-tick-date">${p.isPaid && p.paidDate ? fmtDate(p.paidDate) : ''}</span>
        </label>` : `<span class="badge ${p.isPaid ? 'success' : 'neutral'}">${p.isPaid ? 'paid' : 'unpaid'}</span>${p.isPaid && p.paidDate ? `<div class="text-xs text-muted">${fmtDate(p.paidDate)}</div>` : ''}`}
      `, csv: p => p.isPaid ? ('paid ' + (p.paidDate ? fmtDate(p.paidDate) : '')) : '' },
    { key: '_form', label: 'Form', render: p => `<button class="btn btn-sm" onclick="event.stopPropagation(); printPaymentForm('${p.id}')">📄 Print</button>`, csv: () => '' }
  ];

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title">
        <h1>Payment Requests</h1>
        <span class="desc">${filtered.length} ${filters.tab} · ${pays.length} total payment request(s)</span>
      </div>
      <div class="page-actions">
        <button class="btn bc-filter-command ${useFilterPane && !filters.filterPaneHidden ? 'btn-active' : ''}" id="filterpane-payments-btn" title="Show or hide list filters">☰ Filters${activeFilterCount ? ` (${activeFilterCount})` : ''}</button>
        <div class="col-mgr"><button class="btn" id="pay-col-btn">⚙ Columns</button></div>
        <button class="btn" id="pay-export-btn">⤓ Export Excel</button>
        ${canCreatePayment ? '<button class="btn btn-primary" id="new-payment">+ New RFP</button>' : ''}
      </div>
    </div>
    ${useFilterPane ? `<div class="bc-filter-layout ${filters.filterPaneHidden ? 'pane-hidden' : ''}">
      ${paymentFilterPaneHtml}
      <div class="bc-filter-content">` : `<div class="toolbar">
        <div class="search"><input type="search" placeholder="Search RFP, FPO, supplier, invoice…" id="pay-search" value="${escapeHtml(filters.search)}" /></div>
        <select id="pay-status">
          <option value="">All statuses</option>
          ${REF.rfpStatuses.map(st => `<option value="${escapeHtml(st)}" ${filters.status===st?'selected':''}>${escapeHtml(st)}</option>`).join('')}
        </select>
        <div class="filter-count">${filtered.length}</div>
      </div>
      <div class="subtabs" style="margin-bottom:12px">
        <button class="subtab ${filters.tab==='foreign'?'active':''}" data-paytab="foreign">Foreign RFPs <span class="subtab-count">${foreignCount}</span></button>
        <button class="subtab ${filters.tab==='local'?'active':''}" data-paytab="local">Local RFPs <span class="subtab-count">${localCount}</span></button>
      </div>`}
    ${cmRenderTable('payments', payCols, filtered, {}, {
      onRowClick: 'openPaymentDetail',
      idField: 'id',
      emptyHtml: `<tr><td colspan="99" class="empty-state"><div class="ic">💰</div><h3>No ${filters.tab} payment requests</h3><p>${canCreatePayment ? 'Create one or switch tab.' : 'No payment request exists for this filter yet.'}</p></td></tr>`
    })}
    ${useFilterPane ? `</div></div>` : ''}
  `;

  window.PXUtils.bindSearchInput('#pay-search', {
    key: 'payments-search',
    setValue: value => { filters.search = value; },
    render: () => window.__renderers['payments']()
  });
  $('#pay-status').addEventListener('change', e => { filters.status = e.target.value; window.__renderers['payments'](); });
  $$('[data-paytab]').forEach(btn => btn.addEventListener('click', () => { filters.tab = btn.getAttribute('data-paytab'); window.__renderers['payments'](); }));
  const payPaneToggle = $('#filterpane-payments-btn');
  if (payPaneToggle) payPaneToggle.addEventListener('click', () => { filters.filterPaneHidden = !filters.filterPaneHidden; window.__renderers['payments'](); });
  const payPaneClose = $('#filterpane-payments-close');
  if (payPaneClose) payPaneClose.addEventListener('click', () => { filters.filterPaneHidden = true; window.__renderers['payments'](); });
  const payPaneReset = $('#filterpane-payments-reset');
  if (payPaneReset) payPaneReset.addEventListener('click', () => {
    filters.search = ''; filters.status = ''; filters.tab = 'foreign';
    window.__renderers['payments']();
  });
  $('#pay-col-btn').addEventListener('click', e => cmOpenManager('payments', payCols, e.target, () => window.__renderers['payments']()));
  $('#pay-export-btn').addEventListener('click', () => cmExportCSV('payments', payCols, filtered, 'payment_requests', {}));
  const newPayBtn = $('#new-payment');
  if (newPayBtn) newPayBtn.addEventListener('click', () => window.openPaymentForm());
};

/* Inline toggle for the Approved / Paid tick columns in the RFP list.
   Ticking opens a small date prompt (defaults to today) to confirm/change the date.
   Unticking clears the flag and its date immediately. */
window.__toggleRfpFlag = function (id, flag, checked, evt) {
  // The approval flag needs the distinct 'approve' permission (supervisor/manager only);
  // the paid flag stays on 'edit'.
  const needed = flag === 'paymentApproved' ? 'approve' : 'edit';
  if (!can('payments', needed)) {
    const msg = needed === 'approve'
      ? 'Only supervisors and managers can approve payment requests.'
      : 'You can view payment status, but you are not authorised to update it.';
    if (window.PXUtils && window.PXUtils.toast) window.PXUtils.toast(msg, 'warn');
    if (evt && evt.target) evt.target.checked = !checked;
    return;
  }
  if (!checked) { window.__saveRfpFlag(id, flag, false, null); return; }
  // Ticked: show a date-confirm popover anchored near the checkbox
  const anchor = evt && evt.target ? evt.target : null;
  window.__openRfpDatePrompt(id, flag, anchor);
};

window.__saveRfpFlag = async function (id, flag, checked, dateVal) {
  const neededSave = flag === 'paymentApproved' ? 'approve' : 'edit';
  if (!can('payments', neededSave)) {
    if (window.PXUtils && window.PXUtils.toast) window.PXUtils.toast(neededSave === 'approve' ? 'Only supervisors and managers can approve payment requests.' : 'You can view payment status, but you are not authorised to update it.', 'warn');
    return;
  }
  const state = window.__state;
  const p = state.data.payments.find(x => x.id === id);
  if (!p) return;
  const dateField = flag === 'paymentApproved' ? 'paymentApprovedDate' : 'paidDate';
  const patch = {};
  patch[flag] = checked;
  patch[dateField] = checked ? (dateVal ? new Date(dateVal) : new Date()) : null;
  p[flag] = patch[flag]; p[dateField] = patch[dateField];
  try {
    await window.PXStore.updateRecord('payment_requests', id, patch, { skipValidation: true });
    if (window.PXUtils && window.PXUtils.toast) window.PXUtils.toast(`${flag === 'paymentApproved' ? 'Approval' : 'Paid status'} ${checked ? 'set' : 'cleared'}`, 'success');
  } catch (e) {
    if (window.PXUtils && window.PXUtils.toast) window.PXUtils.toast('Update failed: ' + (e.message || e), 'danger');
  }
  if (window.__renderers && window.__renderers['payments']) window.__renderers['payments']();
};

/* Small inline date-confirm popover for the Approved / Paid ticks. */
window.__closeRfpDatePrompt = function () {
  const ex = document.getElementById('rfp-date-pop');
  if (ex) ex.remove();
  document.removeEventListener('keydown', window.__rfpDatePromptEsc, true);
};
window.__rfpDatePromptEsc = function (e) {
  if (e.key === 'Escape') { window.__closeRfpDatePrompt(); if (window.__renderers) window.__renderers['payments'](); }
};
window.__openRfpDatePrompt = function (id, flag, anchor) {
  window.__closeRfpDatePrompt();
  const state = window.__state;
  const p = state.data.payments.find(x => x.id === id);
  const label = flag === 'paymentApproved' ? 'Approved on' : 'Paid on';
  const existing = flag === 'paymentApproved' ? p && p.paymentApprovedDate : p && p.paidDate;
  const toISO = d => { try { const dt = d && d.toDate ? d.toDate() : (d ? new Date(d) : new Date()); return dt.toISOString().slice(0, 10); } catch (_) { return new Date().toISOString().slice(0, 10); } };
  const val = toISO(existing || new Date());
  const pop = document.createElement('div');
  pop.id = 'rfp-date-pop';
  pop.className = 'rfp-date-pop';
  pop.innerHTML = `
    <div class="rfp-date-pop-label">${label}</div>
    <input type="date" id="rfp-date-pop-input" value="${val}" />
    <div class="rfp-date-pop-actions">
      <button class="btn btn-sm" id="rfp-date-pop-cancel">Cancel</button>
      <button class="btn btn-sm btn-primary" id="rfp-date-pop-ok">Confirm</button>
    </div>`;
  document.body.appendChild(pop);
  // Position near the anchor (checkbox), kept within viewport
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    const pw = 220, ph = 130;
    let left = r.left + window.scrollX - 70;
    let top = r.bottom + window.scrollY + 6;
    if (left + pw > window.scrollX + document.documentElement.clientWidth) left = window.scrollX + document.documentElement.clientWidth - pw - 12;
    if (left < 8) left = 8;
    if (r.bottom + ph > document.documentElement.clientHeight) top = r.top + window.scrollY - ph - 6;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  } else {
    pop.style.left = '50%'; pop.style.top = '50%'; pop.style.transform = 'translate(-50%,-50%)';
  }
  const input = document.getElementById('rfp-date-pop-input');
  input.focus();
  document.getElementById('rfp-date-pop-ok').addEventListener('click', () => {
    const chosen = input.value;
    window.__closeRfpDatePrompt();
    window.__saveRfpFlag(id, flag, true, chosen);
  });
  document.getElementById('rfp-date-pop-cancel').addEventListener('click', () => {
    window.__closeRfpDatePrompt();
    if (window.__renderers) window.__renderers['payments'](); // re-render to reset the unticked-back checkbox
  });
  // Outside click closes (and cancels)
  setTimeout(() => {
    const onDoc = (e) => {
      if (!pop.contains(e.target)) {
        document.removeEventListener('mousedown', onDoc, true);
        window.__closeRfpDatePrompt();
        if (window.__renderers) window.__renderers['payments']();
      }
    };
    document.addEventListener('mousedown', onDoc, true);
  }, 0);
  document.addEventListener('keydown', window.__rfpDatePromptEsc, true);
};
