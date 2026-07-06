const { $, $$, escapeHtml, collection, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, toast,
  can, computeSupplierPerformance, fmtMoney, stripUndefined,
  currentEntity, recordEntity, entityMeta,
  cmGetColumns, cmRenderTable, cmOpenManager, cmExportCSV } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;

const supplierMapNorm = value => String(value || '').trim().toLowerCase();

async function applyVendorMapping(group, supplier) {
  if (!can('suppliers', 'edit')) throw new Error('You are not authorised to change supplier mappings.');
  if (!group || !supplier || !supplier.id) throw new Error('Choose a valid supplier.');
  if (supplier.archived) throw new Error('An archived supplier cannot receive an ERP vendor mapping.');

  const mappings = JSON.parse(JSON.stringify(supplier.erpMappings || []));
  const mappingIndex = mappings.findIndex(mapping => mapping &&
    supplierMapNorm(mapping.entity) === supplierMapNorm(group.entity) &&
    supplierMapNorm(mapping.erpSource) === supplierMapNorm(group.erpSource) &&
    supplierMapNorm(mapping.vendorNo) === supplierMapNorm(group.vendorNo));
  let supplierMappingChanged = false;
  if (mappingIndex < 0) {
    mappings.push({ entity: group.entity, erpSource: group.erpSource, vendorNo: group.vendorNo, active: true });
    supplierMappingChanged = true;
  } else if (mappings[mappingIndex].active === false) {
    mappings[mappingIndex].active = true;
    supplierMappingChanged = true;
  }

  // Keep every write in PXStore. Its supplier validation prevents this vendor
  // code being mapped to two active suppliers in the same entity/source.
  if (supplierMappingChanged) {
    await window.PXStore.updateRecord('suppliers', supplier.id, { erpMappings: mappings });
    supplier.erpMappings = mappings;
  }

  const orders = (state.data.orders || []).filter(order => group.orderDocIds.includes(order.id));
  for (const order of orders) {
    await window.PXStore.updateRecord('orders', order.id, {
      supplierId: supplier.id,
      supplierMatchMethod: 'vendorNo'
    }, { skipValidation: true, permissionResource: 'suppliers', permissionAction: 'edit' });
    // The Firestore subscription will confirm this shortly; update local state so
    // the task leaves the worklist immediately after a successful operation.
    order.supplierId = supplier.id;
    order.supplierMatchMethod = 'vendorNo';
  }
  return { ordersLinked: orders.length, supplierMappingChanged };
}

window.PXSupplierMapping = { applyVendorMapping };

function supplierBootstrapPlans(groups) {
  const byName = new Map();
  const skipped = [];
  (groups || []).filter(group => !group.mappedSupplier).forEach(group => {
    const name = String(group.vendorName || '').trim().replace(/\s+/g, ' ');
    if (!name || name === '—') { skipped.push(group); return; }
    const key = supplierMapNorm(name);
    if (!byName.has(key)) byName.set(key, { name, groups: [] });
    byName.get(key).groups.push(group);
  });
  return {
    plans: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    skipped
  };
}

async function bootstrapSupplierMasters(plans, opts = {}) {
  const cancelRef = opts.cancelRef || { cancelled: false };
  const result = { mastersCreated: 0, vendorLinks: 0, ordersLinked: 0, failed: [], cancelled: false };
  for (let index = 0; index < plans.length; index += 1) {
    if (cancelRef.cancelled) { result.cancelled = true; break; }
    const plan = plans[index];
    const mappings = plan.groups.map(group => ({
      entity: group.entity, erpSource: group.erpSource, vendorNo: group.vendorNo, active: true
    }));
    const supplierData = {
      name: plan.name,
      legalName: plan.name,
      active: true,
      erpMappings: mappings,
      notes: `Created from ERP vendor bootstrap (${mappings.map(mapping => `${mapping.erpSource}: ${mapping.vendorNo}`).join(', ')}).`
    };
    try {
      const created = await window.PXStore.createRecord('suppliers', supplierData, {
        log: { recordType: 'supplier', action: 'created', details: `ERP supplier master bootstrap: ${plan.name}` }
      });
      const supplier = { id: created.id, ...supplierData };
      let linkedForPlan = 0;
      for (const group of plan.groups) {
        const linked = await applyVendorMapping(group, supplier);
        linkedForPlan += linked.ordersLinked;
      }
      result.mastersCreated += 1;
      result.vendorLinks += plan.groups.length;
      result.ordersLinked += linkedForPlan;
    } catch (error) {
      result.failed.push({ name: plan.name, message: error.message || String(error) });
    }
    if (opts.onProgress) opts.onProgress({ done: index + 1, total: plans.length, result, current: plan.name });
  }
  return result;
}

function openSupplierBootstrapDialog(groups) {
  const activeSuppliers = (state.data.suppliers || []).filter(supplier => !supplier.archived);
  if (activeSuppliers.length) {
    toast('Bulk bootstrap is only available while the supplier master is empty. Use the mapping worklist for controlled matching.', 'warning');
    return;
  }
  const { plans, skipped } = supplierBootstrapPlans(groups);
  const vendorLinks = plans.reduce((total, plan) => total + plan.groups.length, 0);
  const orders = plans.reduce((total, plan) => total + plan.groups.reduce((count, group) => count + group.orderDocIds.length, 0), 0);
  const multiCodePlans = plans.filter(plan => plan.groups.length > 1).length;
  if (!plans.length) { toast('No valid ERP vendors are available to bootstrap.', 'warning'); return; }
  window.openModal(`
    <div class="modal-head"><div><h2>Bootstrap Supplier Masters</h2><div class="sub">Create controlled masters from imported ERP vendor codes</div></div><button class="btn btn-ghost btn-icon" onclick="closeModal()" title="Close">x</button></div>
    <div class="modal-body">
      <div class="warning-banner"><strong>This is a one-time master-data bootstrap.</strong> It will create <strong>${plans.length}</strong> supplier master record(s), register <strong>${vendorLinks}</strong> ERP vendor-code mapping(s), and link <strong>${orders}</strong> imported purchase order(s).</div>
      <div class="info-banner" style="margin-top:12px">Only exact, normalised display-name duplicates are combined into one supplier master with multiple ERP vendor codes. No fuzzy matching is used. ${multiCodePlans ? `${multiCodePlans} supplier master(s) will contain more than one ERP code.` : ''}</div>
      ${skipped.length ? `<div class="warning-banner" style="margin-top:12px">${skipped.length} vendor group(s) have no usable vendor name and will remain on the worklist for manual review.</div>` : ''}
      <div class="field-group" style="margin-top:16px"><label>Confirmation</label><input id="supplier-bootstrap-confirm" autocomplete="off" placeholder="Type BOOTSTRAP ${plans.length} to continue" /><div class="hint">Supplier rating, contacts, payment terms, country, and aliases remain blank for later enrichment. The ERP name and code are retained without alteration.</div></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="supplier-bootstrap-go">Create and Link</button></div>
  `);
  $('#supplier-bootstrap-go').addEventListener('click', async () => {
    if ($('#supplier-bootstrap-confirm').value.trim().toUpperCase() !== `BOOTSTRAP ${plans.length}`) {
      toast(`Type BOOTSTRAP ${plans.length} to confirm this supplier-master creation.`, 'danger');
      return;
    }
    const button = $('#supplier-bootstrap-go');
    const cancelRef = { cancelled: false };
    button.disabled = true; button.textContent = 'Creating...';
    if (window.PXProgress) window.PXProgress.start('Creating supplier masters', { onStop: () => { cancelRef.cancelled = true; } });
    try {
      const result = await bootstrapSupplierMasters(plans, {
        cancelRef,
        onProgress: ({ done, total, result: progress, current }) => {
          if (window.PXProgress) window.PXProgress.update(done, total, `${progress.ordersLinked} order(s) linked - ${current}`);
        }
      });
      if (window.PXProgress) window.PXProgress.finish(`Supplier bootstrap: ${result.mastersCreated} master(s), ${result.ordersLinked} order(s) linked${result.cancelled ? ' (stopped)' : ''}`);
      if (result.failed.length) {
        toast(`${result.mastersCreated} supplier master(s) created; ${result.failed.length} require review.`, 'warning');
      } else {
        toast(`${result.mastersCreated} supplier master(s) created and ${result.ordersLinked} order(s) linked.`, 'success');
      }
      window.closeModal();
      window.__renderers['suppliers']();
    } catch (error) {
      if (window.PXProgress) window.PXProgress.finish('Supplier bootstrap stopped');
      toast('Supplier bootstrap stopped: ' + (error.message || error), 'danger');
      button.disabled = false; button.textContent = 'Create and Link';
    }
  });
}

function openVendorMappingDialog(group) {
  const suppliers = (state.data.suppliers || []).filter(s => !s.archived);
  const defaultSupplierId = group.mappedSupplier?.id || '';
  window.openModal(`
    <div class="modal-head">
      <div><h2>Map ERP Vendor</h2><div class="sub">${escapeHtml(group.vendorName)} · ${escapeHtml(group.vendorNo)}</div></div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="field-group"><label>Entity</label><input value="${escapeHtml(group.entity)}" readonly></div>
        <div class="field-group"><label>ERP Source</label><input value="${escapeHtml(group.erpSource)}" readonly></div>
        <div class="field-group full"><label>Link to Existing Supplier</label>
          <select id="map-existing-supplier">
            <option value="">${suppliers.length ? 'Select supplier…' : 'No supplier master records yet'}</option>
            ${suppliers.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === defaultSupplierId ? 'selected' : ''}>${escapeHtml(s.name || 'Unnamed supplier')}${s.active === false ? ' (inactive)' : ''}</option>`).join('')}
          </select>
          <div class="hint">${group.mappedSupplier ? `This vendor code is already recorded on ${escapeHtml(group.mappedSupplier.name)}; this action links the affected orders.` : 'The vendor code will be added to the chosen supplier for this entity and ERP source.'}</div>
        </div>
      </div>
      <div class="text-sm" style="margin-top:12px">Affected orders: <strong>${group.orderDocIds.length}</strong> · ${group.orderIds.slice(0, 8).map(escapeHtml).join(', ')}${group.orderIds.length > 8 ? ` +${group.orderIds.length - 8} more` : ''}</div>
    </div>
    <div class="modal-foot">
      <button class="btn" id="map-create-supplier" style="margin-right:auto">Create New Supplier</button>
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="map-link-supplier" ${suppliers.length ? '' : 'disabled'}>Link Orders</button>
    </div>
  `);
  $('#map-link-supplier').addEventListener('click', async () => {
    const selectedId = $('#map-existing-supplier').value;
    const supplier = suppliers.find(item => item.id === selectedId);
    if (!supplier) { toast('Select the supplier to link.', 'danger'); return; }
    const button = $('#map-link-supplier'); button.disabled = true; button.textContent = 'Linking…';
    try {
      const result = await applyVendorMapping(group, supplier);
      toast(`Vendor linked to ${supplier.name}: ${result.ordersLinked} order(s) updated`, 'success');
      window.closeModal();
      window.__renderers['suppliers']();
    } catch (error) {
      toast('Could not map vendor: ' + error.message, 'danger');
      button.disabled = false; button.textContent = 'Link Orders';
    }
  });
  $('#map-create-supplier').addEventListener('click', () => {
    window.closeModal();
    window.openSupplierForm(null, {
      seed: {
        name: group.vendorName === '—' ? '' : group.vendorName,
        legalName: group.vendorName === '—' ? '' : group.vendorName,
        erpMappings: [{ entity: group.entity, erpSource: group.erpSource, vendorNo: group.vendorNo, active: true }]
      },
      afterCreate: async supplier => {
        const result = await applyVendorMapping(group, supplier);
        toast(`New supplier linked: ${result.ordersLinked} order(s) updated`, 'success');
        window.__renderers['suppliers']();
      }
    });
  });
}

function renderSupplierMappingWorklist(viewEl, filters) {
  const groups = window.PXSupplierMap?.unmappedImportVendors ? window.PXSupplierMap.unmappedImportVendors() : [];
  const mayEdit = can('suppliers', 'edit');
  const mayCreate = can('suppliers', 'create');
  const activeSupplierCount = (state.data.suppliers || []).filter(supplier => !supplier.archived).length;
  const canBootstrap = mayCreate && activeSupplierCount === 0 && groups.some(group => !group.mappedSupplier);
  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title"><h1>Supplier Mapping Worklist</h1><span class="desc">${groups.length} ERP vendor${groups.length === 1 ? '' : 's'} requiring a supplier-master link</span></div>
      <div class="page-actions">${canBootstrap ? '<button class="btn btn-primary" id="sup-bootstrap-masters">Bootstrap Supplier Masters</button>' : ''}<button class="btn" id="sup-worklist-back">Suppliers</button></div>
    </div>
    ${canBootstrap ? '<div class="info-banner">The supplier master is empty. Bootstrap creates controlled supplier-master records from the current ERP vendor codes, then links the imported orders. Use this once; future mappings remain a reviewed, one-vendor-at-a-time action.</div>' : ''}
    <div class="supplier-map-grid">
      ${groups.length ? groups.map((group, index) => `
        <article class="supplier-map-card">
          <div class="supplier-map-card-head"><div><h3>${escapeHtml(group.vendorName)}</h3><div class="mono text-sm">${escapeHtml(group.vendorNo)}</div></div><span class="badge ${group.mappedSupplier ? 'accent' : 'warn'}">${group.orderDocIds.length} order${group.orderDocIds.length === 1 ? '' : 's'}</span></div>
          <dl class="supplier-map-meta"><dt>Entity</dt><dd>${escapeHtml(group.entity)}</dd><dt>ERP</dt><dd>${escapeHtml(group.erpSource)}</dd><dt>Orders</dt><dd>${group.orderIds.slice(0, 5).map(escapeHtml).join(', ')}${group.orderIds.length > 5 ? ` +${group.orderIds.length - 5}` : ''}</dd></dl>
          ${group.mappedSupplier ? `<div class="text-xs text-muted" style="margin-bottom:10px">Mapping already exists for ${escapeHtml(group.mappedSupplier.name)}; link the imported orders now.</div>` : ''}
          ${mayEdit ? `<button class="btn btn-primary" data-map-group="${index}">${group.mappedSupplier ? 'Link Imported Orders' : 'Resolve Mapping'}</button>` : ''}
        </article>`).join('') : '<div class="empty-state"><div class="ic">✓</div><h3>No supplier mappings need attention</h3><p>Every imported ERP vendor with a vendor code is linked to a supplier master record.</p></div>'}
    </div>
  `;
  $('#sup-worklist-back').addEventListener('click', () => { filters.mappingWorklist = false; window.__renderers['suppliers'](); });
  const bootstrapButton = $('#sup-bootstrap-masters');
  if (bootstrapButton) bootstrapButton.addEventListener('click', () => openSupplierBootstrapDialog(groups));
  $$('[data-map-group]').forEach(button => button.addEventListener('click', () => openVendorMappingDialog(groups[Number(button.dataset.mapGroup)])));
}

window.__renderers['suppliers'] = function() {
  const viewEl = $('#view-suppliers');
  const ent = currentEntity();
  const meta = entityMeta(ent) || {};
  const allSuppliers = (state.data.suppliers || []).filter(s => recordEntity(s) === ent);
  const archivedCount = allSuppliers.filter(s => s.archived).length;
  const filters = state.filters.suppliers || (state.filters.suppliers = { search: '', showArchived: false, mappingWorklist: false });
  if (filters.mappingWorklist) { renderSupplierMappingWorklist(viewEl, filters); return; }
  const mappingCount = window.PXSupplierMap?.unmappedImportVendors ? window.PXSupplierMap.unmappedImportVendors().length : 0;
  const sups = allSuppliers.filter(s => filters.showArchived ? s.archived : !s.archived);

  // This entity's ERP vendor code(s) for a supplier, from its per-entity erpMappings.
  const vendorCodeFor = s => {
    const norm = v => String(v || '').trim().toLowerCase();
    const codes = (s.erpMappings || [])
      .filter(m => m.active !== false && norm(m.entity) === norm(ent))
      .map(m => m.vendorNo).filter(Boolean);
    return [...new Set(codes)].join(', ');
  };

  let filtered = sups.filter(s => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!(s.name||'').toLowerCase().includes(q) && !(s.country||'').toLowerCase().includes(q) && !vendorCodeFor(s).toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const ratingBadge = r => {
    const map = { preferred:'success', normal:'neutral', watchlist:'accent', blocked:'danger' };
    return r ? `<span class="badge ${map[r]||'neutral'}">${escapeHtml(r)}</span>` : '<span class="text-xs text-muted">—</span>';
  };
  const supCols = [
    { key: 'name', label: 'Name', render: s => `<span style="font-weight:600">${escapeHtml(s.name || '—')}</span>`, raw: s => s.name },
    { key: 'vendorCode', label: 'Vendor Code', render: s => { const c = vendorCodeFor(s); return c ? `<span class="mono text-sm">${escapeHtml(c)}</span>` : '<span class="text-xs text-muted">—</span>'; }, csv: s => vendorCodeFor(s) },
    { key: 'rating', label: 'Rating', render: s => ratingBadge(s.supplierRating), csv: s => s.supplierRating || '' },
    { key: 'country', label: 'Country', render: s => escapeHtml(s.country || '—'), raw: s => s.country },
    { key: 'defaultCurrency', label: 'Default Currency', defaultVisible: false, render: s => `<span class="mono">${escapeHtml(s.defaultCurrency || '—')}</span>`, raw: s => s.defaultCurrency },
    { key: 'defaultTerms', label: 'Default Terms', render: s => `<span class="text-sm">${escapeHtml(s.defaultTerms || '—')}</span>`, raw: s => s.defaultTerms },
    { key: 'openOrders', label: 'Open Orders', num: true, render: s => { const p = computeSupplierPerformance(s); return p.openOrders || 0; }, csv: s => computeSupplierPerformance(s).openOrders },
    { key: 'lateOrders', label: 'Late', num: true, render: s => { const p = computeSupplierPerformance(s); return p.lateOrders ? `<span class="line-outstanding">${p.lateOrders}</span>` : '0'; }, csv: s => computeSupplierPerformance(s).lateOrders },
    { key: 'openIssues', label: 'Open Issues', num: true, render: s => { const p = computeSupplierPerformance(s); return p.openShipmentIssues ? `<span class="line-outstanding">${p.openShipmentIssues}</span>` : '0'; }, csv: s => computeSupplierPerformance(s).openShipmentIssues },
    { key: 'overdueDocs', label: 'Doc Issues', num: true, defaultVisible: false, render: s => { const p = computeSupplierPerformance(s); return p.docIssues || 0; }, csv: s => computeSupplierPerformance(s).docIssues },
    { key: 'aliases', label: 'Aliases', defaultVisible: false, render: s => `<span class="text-sm text-muted">${(s.aliases||[]).slice(0,2).map(escapeHtml).join('; ')}${(s.aliases||[]).length > 2 ? '…' : ''}</span>`, csv: s => (s.aliases||[]).join('; ') },
    { key: 'notes', label: 'Notes', defaultVisible: false, render: s => `<span class="text-sm truncate" title="${escapeHtml(s.notes||'')}" style="max-width:200px;display:inline-block">${escapeHtml(s.notes || '—')}</span>`, raw: s => s.notes },
    { key: 'active', label: 'Status', render: s => s.archived ? '<span class="badge neutral">Archived</span>' : (s.active === false ? '<span class="badge neutral">Inactive</span>' : '<span class="badge success">Active</span>'), csv: s => s.archived ? 'Archived' : (s.active === false ? 'Inactive' : 'Active') }
  ];

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title"><h1>Suppliers</h1><span class="desc">${escapeHtml(meta.code || ent)} — ${filtered.length} of ${sups.length} ${filters.showArchived ? 'archived' : 'active'} supplier(s) for this entity</span></div>
      <div class="page-actions">
        ${mappingCount ? `<button class="btn" id="sup-mapping-worklist">Mapping Worklist (${mappingCount})</button>` : ''}
        ${archivedCount ? `<button class="btn" id="sup-archive-toggle">${filters.showArchived ? 'Active suppliers' : `Archived (${archivedCount})`}</button>` : ''}
        <div class="col-mgr"><button class="btn" id="sup-col-btn">⚙ Columns</button></div>
        <button class="btn" id="sup-export-btn">⤓ Export Excel</button>
        ${can('suppliers','create') ? '<button class="btn btn-primary" id="new-supplier">+ New Supplier</button>' : ''}
      </div>
    </div>
    <div class="toolbar">
      <div class="search"><input type="search" placeholder="Search name, country or vendor code…" id="sup-search" value="${escapeHtml(filters.search)}" /></div>
      <div class="filter-count">${filtered.length}</div>
    </div>
    ${cmRenderTable('suppliers', supCols, filtered, {}, {
      onRowClick: 'openSupplierForm',
      idField: 'id',
      emptyHtml: `<tr><td colspan="99" class="empty-state"><div class="ic">🏭</div><h3>${filters.showArchived ? 'No archived suppliers' : 'No suppliers yet'}</h3><p>${filters.showArchived ? 'Archived suppliers can be restored from their record.' : 'Add one to enable controlled order selection and ERP matching.'}</p></td></tr>`
    })}
  `;
  window.PXUtils.bindSearchInput('#sup-search', {
    key: 'suppliers-search',
    setValue: value => { filters.search = value; },
    render: () => window.__renderers['suppliers']()
  });
  const archiveToggle = $('#sup-archive-toggle');
  if (archiveToggle) archiveToggle.addEventListener('click', () => { filters.showArchived = !filters.showArchived; window.__renderers['suppliers'](); });
  const mappingWorklist = $('#sup-mapping-worklist');
  if (mappingWorklist) mappingWorklist.addEventListener('click', () => { filters.mappingWorklist = true; window.__renderers['suppliers'](); });
  $('#sup-col-btn').addEventListener('click', e => cmOpenManager('suppliers', supCols, e.target, () => window.__renderers['suppliers']()));
  $('#sup-export-btn').addEventListener('click', () => cmExportCSV('suppliers', supCols, filtered, 'suppliers', {}));
  const newSupBtn = $('#new-supplier');
  if (newSupBtn) newSupBtn.addEventListener('click', () => window.openSupplierForm());
};
