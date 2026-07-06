/* ============================================================
   DOCUMENTS — central document control centre (Records & Archives → Documents)
   ------------------------------------------------------------
   Lives under "Records & Archives" in the sidebar but DEFAULTS to ACTIVE documents.
   Status tabs: Active (default) · Missing · Expiring · Rejected · Archived,
   plus a Folders cabinet (one folder per PO). Entity-scoped like every page
   (Phoenix / Seychelles Breweries / Edena). Opening a PO folder reuses the
   exact per-PO folder + upload UI from the order detail.
   ============================================================ */
const { $, $$, escapeHtml, fmtDate, fmtMoney, statusBadgeClass, can,
  currentEntity, recordEntity, entityMeta, orderFunction } = window.PXUtils;
const state = window.__state;
const REF = window.REF;

let openOrderId = null;
window.__openDocFolder  = function (orderId) { openOrderId = orderId; renderDocuments(); window.scrollTo(0, 0); };
window.__closeDocFolder = function () { openOrderId = null; renderDocuments(); };

function docsForOrder(orderId) {
  const order = state.data.orders.find(o => o.id === orderId);
  if (order && window.PXDocuments) return window.PXDocuments.documentsForOrder(order, state.data);
  return state.data.documents.filter(d => !d.archived && d.relatedType === 'order' && d.relatedId === orderId);
}
const docLink = d => window.PXDocuments ? window.PXDocuments.documentLinkOf(d) : (d.documentUrl || d.url || d.link || '');
const docPresent = d => window.PXDocuments ? window.PXDocuments.isPresent(d) : (['received', 'approved'].includes(d.status) || d.fileData || docLink(d));
const expiryInfo = d => (window.__docExpiryInfo ? window.__docExpiryInfo(d) : null);

// Resolve a document's parent record → entity, label, and click-through.
function recParent(d) {
  if (d.relatedType === 'order')    { const o = state.data.orders.find(x => x.id === d.relatedId);    return o ? { ent: recordEntity(o), label: 'Order ' + (o.orderId || ''), go: () => window.__openDocFolder(o.id), order: o } : null; }
  if (d.relatedType === 'shipment') { const s = state.data.shipments.find(x => x.id === d.relatedId); return s ? { ent: recordEntity(s), label: 'Shipment ' + (s.shipmentId || ''), go: () => window.openShipmentDetail(s.id) } : null; }
  if (d.relatedType === 'payment')  { const p = state.data.payments.find(x => x.id === d.relatedId);  return p ? { ent: recordEntity(p), label: 'RFP ' + (p.rfpRef || ''), go: () => window.openPaymentDetail(p.id) } : null; }
  if (d.relatedType === 'supplier') { const s = state.data.suppliers.find(x => x.id === d.relatedId); return s ? { ent: 'shared', label: (s.name || 'Supplier') } : null; }
  return null;
}
const docInEntity = (d, ent) => { const p = recParent(d); return !p || p.ent === 'shared' || p.ent === ent; };

function renderDocuments() {
  const viewEl = $('#view-documents');
  if (!viewEl) return;
  const ent = currentEntity();
  const meta = entityMeta(ent) || {};
  if (openOrderId) {
    const o = state.data.orders.find(x => x.id === openOrderId);
    if (!o || recordEntity(o) !== ent) openOrderId = null;
  }
  if (openOrderId) { renderOpenFolder(viewEl, ent, meta); return; }

  const filters = state.filters.documents || (state.filters.documents = { search: '', fn: '', type: '', withFiles: false, tab: 'active' });
  if (!filters.tab) filters.tab = 'active';
  if (filters.tab === 'folders') renderFolderList(viewEl, ent, meta);
  else renderStatusList(viewEl, ent, meta, filters.tab);
}

/* ---------- shared header (page head + status tabs) ---------- */
function computeCounts(ent) {
  const docs = state.data.documents.filter(d => docInEntity(d, ent));
  const active = docs.filter(d => !d.archived);
  const expiring = active.filter(d => { const e = expiryInfo(d); return e && (e.state === 'soon' || e.state === 'expired'); });
  const rejected = active.filter(d => d.status === 'rejected');
  const archived = docs.filter(d => d.archived);
  return { active: active.length, missing: missingItems(ent).length, expiring: expiring.length, rejected: rejected.length, archived: archived.length };
}
function tabBarHtml(ent, active) {
  const c = computeCounts(ent);
  const tabs = [
    ['active', 'Active', c.active], ['missing', 'Missing', c.missing], ['expiring', 'Expiring', c.expiring],
    ['rejected', 'Rejected', c.rejected], ['archived', 'Archived', c.archived], ['folders', 'Folders', null]
  ];
  return `<div class="doc-tabs">${tabs.map(([k, label, n]) =>
    `<button class="doc-tab ${active === k ? 'active' : ''}" data-doctab="${k}">${label}${n != null ? ` <span class="doc-tab-count">${n}</span>` : ''}</button>`).join('')}</div>`;
}
function bindTabs(viewEl, ent, meta) {
  const filters = state.filters.documents;
  viewEl.querySelectorAll('[data-doctab]').forEach(b => b.addEventListener('click', () => { filters.tab = b.dataset.doctab; renderDocuments(); }));
}

/* ---------- Missing required documents (expected − present) ---------- */
function missingItems(ent) {
  const out = [];
  const present = (ctx, id) => state.data.documents.filter(d => !d.archived && d.relatedType === ctx && d.relatedId === id && docPresent(d)).map(d => d.documentType);
  const consider = [];
  state.data.orders.filter(o => !o.archived && recordEntity(o) === ent).forEach(o => consider.push(['order', o, 'Order ' + (o.orderId || ''), () => window.__openDocFolder(o.id)]));
  state.data.shipments.filter(s => !s.archived && recordEntity(s) === ent).forEach(s => consider.push(['shipment', s, 'Shipment ' + (s.shipmentId || ''), () => window.openShipmentDetail(s.id)]));
  state.data.payments.filter(p => !p.archived && recordEntity(p) === ent).forEach(p => consider.push(['payment', p, 'RFP ' + (p.rfpRef || ''), () => window.openPaymentDetail(p.id)]));
  consider.forEach(([ctx, rec, label, go]) => {
    const expected = window.PXUtils.expectedDocsFor ? window.PXUtils.expectedDocsFor(ctx, rec) : [];
    const have = present(ctx, rec.id);
    expected.filter(e => !have.includes(e)).forEach(docType => out.push({ ctx, rec, label, go, docType }));
  });
  return out;
}

/* ---------- Status list (Active / Missing / Expiring / Rejected / Archived) ---------- */
function renderStatusList(viewEl, ent, meta, tab) {
  const filters = state.filters.documents;
  const q = (filters.search || '').toLowerCase();
  const titleMap = { active: 'Active', missing: 'Missing', expiring: 'Expiring', rejected: 'Rejected', archived: 'Archived' };
  const vmode = window.PXView.mode('documents-status');
  window.__docRowGo = i => { const r = (window.__docStatusRows || [])[i]; if (r && r.go) r.go(); };

  let bodyHtml = '';
  if (tab === 'missing') {
    let items = missingItems(ent);
    if (q) items = items.filter(m => (m.label + ' ' + m.docType).toLowerCase().includes(q));
    window.__docStatusRows = items.map((m, i) => ({ go: m.go }));
    const rows = items.map((m, i) => `
      <tr data-rowidx="${i}" style="cursor:pointer">
        <td>${escapeHtml(m.docType)}</td>
        <td>${escapeHtml(m.label)}</td>
        <td>${escapeHtml(m.ctx)}</td>
        <td><span class="badge danger">missing</span></td>
      </tr>`).join('');
    bodyHtml = `<div class="table-wrap"><table class="data resizable" data-colw="doc-missing">
      <thead><tr><th>Required document</th><th>Record</th><th>Context</th><th>Status</th></tr></thead>
      <tbody>${rows || emptyRow(4, 'No missing required documents 🎉')}</tbody></table></div>`;
    if (vmode === 'cards') bodyHtml = window.PXCards.grid(items.map((m, i) => window.PXCards.card({
      ref: m.docType, entity: meta.short || ent, entityAccent: meta.accent, title: m.label,
      statusBadge: { text: 'missing', cls: 'danger' }, badges: [{ text: m.ctx, cls: 'neutral' }],
      note: 'Required document not yet filed', onclick: 'window.__docRowGo(' + i + ')', actionLabel: 'Open record'
    })).join(''), 'No missing required documents 🎉');
  } else {
    let docs = state.data.documents.filter(d => docInEntity(d, ent));
    if (tab === 'active') docs = docs.filter(d => !d.archived);
    else if (tab === 'archived') docs = docs.filter(d => d.archived);
    else if (tab === 'rejected') docs = docs.filter(d => !d.archived && d.status === 'rejected');
    else if (tab === 'expiring') docs = docs.filter(d => { if (d.archived) return false; const e = expiryInfo(d); return e && (e.state === 'soon' || e.state === 'expired'); });
    if (q) docs = docs.filter(d => { const p = recParent(d); return (`${d.documentType} ${d.fileName || ''} ${p ? p.label : ''} ${d.status || ''}`).toLowerCase().includes(q); });
    docs.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
    window.__docStatusRows = docs.map(d => { const p = recParent(d); return { go: p && p.go }; });
    const rows = docs.map((d, i) => {
      const p = recParent(d);
      const e = expiryInfo(d);
      const expCell = e && e.date ? `<span class="${e.state === 'expired' ? 'text-danger' : (e.state === 'soon' ? 'text-warn' : '')}">${fmtDate(e.date)}${e.state === 'expired' ? ' · expired' : (e.state === 'soon' ? ' · soon' : '')}</span>` : '—';
      return `<tr data-rowidx="${i}" ${p && p.go ? 'style="cursor:pointer"' : ''}>
        <td><span class="mono">${escapeHtml(d.documentType || '—')}</span></td>
        <td>${escapeHtml(d.fileName || (docLink(d) ? 'link' : '—'))}</td>
        <td>${p ? escapeHtml(p.label) : '—'}</td>
        <td><span class="badge ${docStatusBadge(d.status)}">${escapeHtml(d.status || (d.fileData ? 'received' : '—'))}</span></td>
        <td>${expCell}</td>
      </tr>`;
    }).join('');
    bodyHtml = `<div class="table-wrap"><table class="data resizable" data-colw="doc-status">
      <thead><tr><th>Type</th><th>File / link</th><th>Record</th><th>Status</th><th>Expiry</th></tr></thead>
      <tbody>${rows || emptyRow(5, `No ${tab} documents for ${escapeHtml(ent)}`)}</tbody></table></div>`;
    if (vmode === 'cards') bodyHtml = window.PXCards.grid(docs.map((d, i) => {
      const p = recParent(d); const e = expiryInfo(d);
      return window.PXCards.card({
        ref: d.documentType || '—', entity: meta.short || ent, entityAccent: meta.accent,
        title: d.fileName || (docLink(d) ? 'link' : ''), supplier: p ? p.label : '',
        statusBadge: { text: d.status || (d.fileData ? 'received' : '—'), cls: docStatusBadge(d.status) },
        dates: e && e.date ? [{ label: 'Expiry', value: fmtDate(e.date) + (e.state === 'expired' ? ' · expired' : (e.state === 'soon' ? ' · soon' : '')), overdue: e.state === 'expired' }] : [],
        onclick: p && p.go ? 'window.__docRowGo(' + i + ')' : '', actionLabel: 'Open record'
      });
    }).join(''), `No ${tab} documents for ${ent}`);
  }

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title">
        <h1>Documents <span class="badge" style="background:${meta.accent || '#888'};color:#fff;font-size:11px;vertical-align:middle">${escapeHtml(ent)}</span></h1>
        <span class="desc">Document control centre — showing <strong>${titleMap[tab] || tab}</strong> documents. Filed under Records &amp; Archives, but active documents are the default view.</span>
      </div>
    </div>
    ${tabBarHtml(ent, tab)}
    <div class="toolbar">
      ${window.PXView.toggle('documents-status')}
      <div class="search"><input type="search" id="doc-search" placeholder="Search type, record, file…" value="${escapeHtml(filters.search)}" /></div>
    </div>
    ${bodyHtml}`;

  bindTabs(viewEl, ent, meta);
  window.PXView.bind('documents-status', () => renderStatusList(viewEl, ent, meta, tab), viewEl);
  window.PXUtils.bindSearchInput('#doc-search', {
    key: 'documents-status-search',
    setValue: value => { filters.search = value; },
    render: () => renderStatusList(viewEl, ent, meta, tab)
  });
  viewEl.querySelectorAll('tr[data-rowidx]').forEach(tr => tr.addEventListener('click', () => { const r = (window.__docStatusRows || [])[+tr.dataset.rowidx]; if (r && r.go) r.go(); }));
}
function emptyRow(cols, msg) { return `<tr><td colspan="${cols}" class="empty-state"><div class="ic">📄</div><h3>${msg}</h3></td></tr>`; }
function docStatusBadge(s) { return { missing: 'danger', requested: 'accent', received: 'info', approved: 'success', rejected: 'danger' }[s] || 'neutral'; }

/* ---------- Folders cabinet: one row per PO ---------- */
function renderFolderList(viewEl, ent, meta) {
  const orders = state.data.orders.filter(o => !o.archived && recordEntity(o) === ent);
  const officers = state.data.officers || [];
  const officerMap = Object.fromEntries(officers.map(o => [o.code, o.fullName || o.code]));
  const filters = state.filters.documents;
  const withCounts = orders.map(o => ({ o, files: docsForOrder(o.id).length }));
  let filtered = withCounts.filter(({ o, files }) => {
    if (filters.withFiles && files === 0) return false;
    if (filters.fn && orderFunction(o) !== filters.fn) return false;
    if (filters.type && o.orderType !== filters.type) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = [o.orderId, o.supplier, o.description, o.iprNumber, o.officerCode, o.category].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  filtered.sort((a, b) => {
    if ((b.files > 0) !== (a.files > 0)) return (b.files > 0) - (a.files > 0);
    const da = a.o.dateOfOrder?.toDate ? a.o.dateOfOrder.toDate() : new Date(a.o.dateOfOrder || 0);
    const db = b.o.dateOfOrder?.toDate ? b.o.dateOfOrder.toDate() : new Date(b.o.dateOfOrder || 0);
    return db - da;
  });
  const totalFolders = withCounts.length;
  const foldersWithFiles = withCounts.filter(x => x.files > 0).length;
  const totalFiles = withCounts.reduce((s, x) => s + x.files, 0);
  const colDefs = [['po', 'PO Folder'], ['supplier', 'Supplier'], ['description', 'Description'],
    ['type', 'Type'], ['fn', 'Function'], ['files', 'Files', true], ['officer', 'Officer'], ['status', 'Status']];
  const thWidth = k => { try { const w = JSON.parse(localStorage.getItem('phoenix_colw_documents') || '{}')[k]; return w ? ` style="width:${w}px"` : ''; } catch (_) { return ''; } };
  const rows = filtered.map(({ o, files }) => `
    <tr onclick="window.__openDocFolder('${o.id}')" style="cursor:pointer">
      <td><span class="doc-folder-cell">${files > 0 ? '📁' : '📂'} <span class="mono">${escapeHtml(o.orderId || '—')}</span></span></td>
      <td class="col-supplier"><span class="truncate">${escapeHtml(o.supplier || '—')}</span></td>
      <td class="col-description"><span class="wrap">${escapeHtml(o.description || '—')}</span></td>
      <td>${escapeHtml(o.orderType === 'foreign' ? 'Foreign' : 'Local')}</td>
      <td>${escapeHtml(REF.functions[orderFunction(o)]?.short || '—')}</td>
      <td class="num">${files > 0 ? `<span class="doc-file-count">${files}</span>` : '<span class="text-muted">0</span>'}</td>
      <td>${escapeHtml(officerMap[o.officerCode] || o.officerCode || '—')}</td>
      <td><span class="badge ${statusBadgeClass(o.status)}">${escapeHtml(o.status || '—')}</span></td>
    </tr>`).join('');
  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title">
        <h1>Documents <span class="badge" style="background:${meta.accent || '#888'};color:#fff;font-size:11px;vertical-align:middle">${escapeHtml(ent)}</span></h1>
        <span class="desc">${foldersWithFiles} folder(s) with files · ${totalFiles} file(s) stored · ${totalFolders} PO folder(s) · click a folder to open</span>
      </div>
    </div>
    ${tabBarHtml(ent, 'folders')}
    <div class="op-hint" style="margin:0 0 12px">Every purchase order has its own parent folder. Open one to file documents into PO, Shipping Documents, Payment and GRN sub-folders. Shipping documents linked to shipment records are grouped under that PO's shipping folder and carry the shipment reference in the future SharePoint path.</div>
    <div class="toolbar">
      <div class="search"><input type="search" id="doc-search" placeholder="Search PO, supplier, description…" value="${escapeHtml(filters.search)}" /></div>
      <select id="doc-type">
        <option value="">All types</option>
        <option value="foreign" ${filters.type === 'foreign' ? 'selected' : ''}>Foreign</option>
        <option value="local" ${filters.type === 'local' ? 'selected' : ''}>Local</option>
      </select>
      <select id="doc-fn">
        <option value="">All functions</option>
        ${Object.entries(REF.functions).map(([k, v]) => `<option value="${k}" ${filters.fn === k ? 'selected' : ''}>${escapeHtml(v.label || k)}</option>`).join('')}
      </select>
      <label class="doc-filter-toggle"><input type="checkbox" id="doc-withfiles" ${filters.withFiles ? 'checked' : ''}/> With files only</label>
      <div class="filter-count">${filtered.length}</div>
    </div>
    <div class="table-wrap orders-table"><div class="table-scroll"><table class="data resizable" data-colw="documents">
      <thead><tr>${colDefs.map(([k, label, num]) => `<th class="${num ? 'num ' : ''}col-${k}" data-colkey="${k}"${thWidth(k)}>${label}<span class="col-resize" data-resize="${k}"></span></th>`).join('')}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${colDefs.length}" class="empty-state"><div class="ic">📂</div><h3>No PO folders for ${escapeHtml(ent)}</h3><p>Create orders and they'll appear here as folders ready for documents.</p></td></tr>`}</tbody>
  </table></div></div>`;
  bindTabs(viewEl, ent, meta);
  window.PXUtils.bindSearchInput('#doc-search', {
    key: 'documents-folders-search',
    setValue: value => { filters.search = value; },
    render: () => renderFolderList(viewEl, ent, meta)
  });
  $('#doc-type').addEventListener('change', e => { filters.type = e.target.value; renderFolderList(viewEl, ent, meta); });
  $('#doc-fn').addEventListener('change', e => { filters.fn = e.target.value; renderFolderList(viewEl, ent, meta); });
  $('#doc-withfiles').addEventListener('change', e => { filters.withFiles = e.target.checked; renderFolderList(viewEl, ent, meta); });
}

/* ---------- Open folder: reuse the per-PO folder + upload UI ---------- */
function renderOpenFolder(viewEl, ent, meta) {
  const o = state.data.orders.find(x => x.id === openOrderId);
  if (!o) { openOrderId = null; renderFolderList(viewEl, ent, meta); return; }
  const fileCount = docsForOrder(o.id).length;
  const folderPath = window.PXDocuments ? window.PXDocuments.orderFolderName(o) : (o.orderId || 'Order');
  const folderUI = window.renderDocumentsSection ? window.renderDocumentsSection('order', o.id) : '<p class="op-empty">Documents module not available.</p>';
  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title">
        <h1><span class="doc-back" onclick="window.__closeDocFolder()" title="Back to all folders">←</span>
          📁 ${escapeHtml(o.orderId || 'Order')}
          <span class="badge" style="background:${meta.accent || '#888'};color:#fff;font-size:11px;vertical-align:middle">${escapeHtml(ent)}</span></h1>
        <span class="desc">${escapeHtml(o.supplier || '—')} · ${escapeHtml(o.description || '')} · ${fileCount} file(s) · future parent folder: ${escapeHtml(folderPath)} · <span class="badge ${statusBadgeClass(o.status)}" style="vertical-align:middle">${escapeHtml(o.status || '—')}</span></span>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm btn-ghost" onclick="window.__closeDocFolder()">← All folders</button>
        <button class="btn btn-sm" onclick="window.openOrderDetail('${o.id}')">Open full order ↗</button>
      </div>
    </div>
    <div class="doc-folder-page">${folderUI}</div>`;
}

window.__renderers['documents'] = renderDocuments;
