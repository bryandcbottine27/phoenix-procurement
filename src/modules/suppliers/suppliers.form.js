const { $, $$, escapeHtml, collection, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, toast,
  can, currentRole, computeSupplierPerformance, fmtMoney, stripUndefined,
  currentEntity, entityMeta, recordEntity,
  cmGetColumns, cmRenderTable, cmOpenManager, cmExportCSV } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;

const supplierDateInput = value => {
  if (!value) return '';
  const date = value.toDate ? value.toDate() : (value.seconds != null ? new Date(value.seconds * 1000) : new Date(value));
  return isNaN(date) ? '' : date.toISOString().slice(0, 10);
};
const supplierDateLabel = value => {
  const input = supplierDateInput(value);
  return input ? new Date(input + 'T00:00:00').toLocaleDateString() : '—';
};



function supplierPerformancePanel(s) {
  const p = computeSupplierPerformance(s);
  const stat = (label, val, warn) => `<div class="po-stat"><div class="po-stat-label">${label}</div><div class="po-stat-value" style="${warn?'color:var(--warn)':''}">${val}</div></div>`;
  const valByCur = Object.entries(p.openValueByCurrency);
  const entityRows = REF.entities.map(entity => {
    const metrics = computeSupplierPerformance(s, { entity: entity.code });
    const value = Object.entries(metrics.openValueByCurrency).map(([currency, amount]) => `${currency} ${fmtMoney(amount, currency)}`).join(' · ') || '—';
    return `<tr><td>${escapeHtml(entity.short || entity.code)}</td><td class="num">${metrics.openOrders}</td><td class="num">${metrics.lateOrders}</td><td class="num">${metrics.openShipmentIssues}</td><td>${value}</td></tr>`;
  }).join('');
  return `
    <div style="border-top:1px solid var(--line);margin:18px 0"></div>
    <div class="op-section">
      <div class="op-head"><h3>Supplier Performance <span class="op-count">computed from operational data</span></h3></div>
      <div class="po-summary" style="grid-template-columns:repeat(4,1fr)">
        ${stat('Total Orders', p.totalOrders)}
        ${stat('Open', p.openOrders)}
        ${stat('Closed', p.closedOrders)}
        ${stat('Late', p.lateOrders, p.lateOrders>0)}
      </div>
      <div class="po-summary" style="grid-template-columns:repeat(4,1fr);margin-top:10px">
        ${stat('Avg Delivery Delay', p.avgDeliveryDelay!=null?p.avgDeliveryDelay+'d':'—', p.avgDeliveryDelay>0)}
        ${stat('Avg Lead Time', p.avgLeadTime!=null?p.avgLeadTime+'d':'—')}
        ${stat('Open Issues', p.openShipmentIssues, p.openShipmentIssues>0)}
        ${stat('Overdue RFPs', p.overdueRfps, p.overdueRfps>0)}
      </div>
      <div class="po-summary" style="grid-template-columns:repeat(2,1fr);margin-top:10px">
        ${stat('Doc Issues (rejected)', p.docIssues, p.docIssues>0)}
        ${stat('Payment Issues', p.paymentIssues, p.paymentIssues>0)}
      </div>
      <div style="margin-top:12px;font-size:13px">
        <strong>Usual payment terms:</strong> ${escapeHtml(p.usualTerms)}<br>
        <strong>Open order value:</strong> ${valByCur.length ? valByCur.map(([c,v])=>`${c} ${fmtMoney(v,c)}`).join(' · ') : '—'}
      </div>
      <div class="text-xs text-muted" style="margin-top:8px">All figures are Phoenix-owned, computed live from orders, shipments, payments, documents and issues. The supplier rating above is the only stored performance attribute.</div>
      <div class="table-wrap" style="margin-top:14px"><table class="data"><thead><tr><th>Entity</th><th class="num">Open</th><th class="num">Late</th><th class="num">Issues</th><th>Open Value</th></tr></thead><tbody>${entityRows}</tbody></table></div>
    </div>`;
}

function openSupplierScorecard(s) {
  const render = (entity = '', from = '', to = '') => {
    const score = computeSupplierPerformance(s, { entity, from, to });
    const cell = (label, value) => `<div class="po-stat"><div class="po-stat-label">${label}</div><div class="po-stat-value">${value == null ? '—' : value + '%'}</div></div>`;
    return `<div class="form-grid cols-3"><div class="field-group"><label>Entity</label><select id="score-entity"><option value="">All entities</option>${REF.entities.map(e => `<option value="${e.code}" ${entity===e.code?'selected':''}>${escapeHtml(e.short)}</option>`).join('')}</select></div><div class="field-group"><label>From</label><input id="score-from" type="date" value="${escapeHtml(from)}"></div><div class="field-group"><label>To</label><input id="score-to" type="date" value="${escapeHtml(to)}"></div></div><div class="po-summary" style="grid-template-columns:repeat(4,1fr);margin-top:14px">${cell('Overall',score.overallScore)}${cell('On-time delivery',score.deliveryScore)}${cell('Issue control',score.issueScore)}${cell('Payment control',score.paymentScore)}</div><div class="table-wrap" style="margin-top:14px"><table class="data"><tbody><tr><th>Orders</th><td>${score.totalOrders}</td><th>Completed deliveries</th><td>${score.completedDeliveries}</td></tr><tr><th>On-time deliveries</th><td>${score.onTimeDeliveries}</td><th>Open issues</th><td>${score.openShipmentIssues}</td></tr><tr><th>Overdue RFPs</th><td>${score.overdueRfps}</td><th>Rejected documents</th><td>${score.docIssues}</td></tr></tbody></table></div><p class="text-xs text-muted" style="margin-top:10px">Scores are live operational indicators, not an automatic supplier rating. A blank score means there is not yet enough relevant operational data.</p>`;
  };
  window.openModal(`<div class="modal-head"><div><h2>Supplier Performance Scorecard</h2><div class="sub">${escapeHtml(s.name || '')}</div></div><button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div><div class="modal-body" id="supplier-score-body">${render()}</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>`);
  const bind = () => ['score-entity','score-from','score-to'].forEach(id => { const el=$('#'+id); if(el) el.addEventListener('change', () => { const entity=$('#score-entity').value, from=$('#score-from').value, to=$('#score-to').value; $('#supplier-score-body').innerHTML=render(entity,from,to); bind(); }); });
  bind();
}

const mergeKey = mapping => [mapping.entity, mapping.erpSource, mapping.vendorNo].map(v => String(v || '').trim().toLowerCase()).join('|');
const contactKey = contact => [contact.email, contact.name, contact.entity, contact.purpose].map(v => String(v || '').trim().toLowerCase()).join('|');

async function mergeSupplier(source, target, reason) {
  if (currentRole() !== 'admin') throw new Error('Only administrators can merge supplier records.');
  if (!source || !target || source.id === target.id) throw new Error('Choose a different surviving supplier.');
  const targetMappings = JSON.parse(JSON.stringify(target.erpMappings || []));
  const mappingKeys = new Set(targetMappings.map(mergeKey));
  (source.erpMappings || []).forEach(mapping => { if (!mappingKeys.has(mergeKey(mapping))) { targetMappings.push(mapping); mappingKeys.add(mergeKey(mapping)); } });
  const targetContacts = JSON.parse(JSON.stringify(target.contacts || []));
  const contactKeys = new Set(targetContacts.map(contactKey));
  (source.contacts || []).forEach(contact => { if (!contactKeys.has(contactKey(contact))) { targetContacts.push(contact); contactKeys.add(contactKey(contact)); } });
  const aliases = [...new Set([...(target.aliases || []), source.name, source.legalName, ...(source.aliases || [])].map(v => String(v || '').trim()).filter(Boolean))];
  const mergedBy = (state.officer && state.officer.code) || state.user?.email || 'unknown';
  const mergeEntry = { sourceId: source.id, sourceName: source.name || 'Unnamed supplier', mergedAt: new Date(), mergedBy, reason };
  await window.PXStore.updateRecord('suppliers', target.id, {
    erpMappings: targetMappings, contacts: targetContacts, aliases,
    mergedSupplierHistory: [...(target.mergedSupplierHistory || []), mergeEntry]
  });

  const related = [
    ['orders', (state.data.orders || []).filter(record => record.supplierId === source.id), { supplierId: target.id, supplierMatchMethod: 'manual' }],
    ['documents', (state.data.documents || []).filter(record => record.relatedType === 'supplier' && record.relatedId === source.id), { relatedId: target.id }],
    ['followups', (state.data.followups || []).filter(record => record.relatedType === 'supplier' && record.relatedId === source.id), { relatedId: target.id }],
    ['issues', (state.data.issues || []).filter(record => (record.relatedType === 'supplier' && record.relatedId === source.id) || record._key === `supplier:${source.id}`), { relatedId: target.id, _key: `supplier:${target.id}` }]
  ];
  const counts = {};
  for (const [collectionName, records, patch] of related) {
    counts[collectionName] = records.length;
    for (const record of records) await window.PXStore.updateRecord(collectionName, record.id, patch, {
      skipValidation: true, permissionResource: 'suppliers', permissionAction: 'edit'
    });
  }
  await window.PXStore.updateRecord('suppliers', source.id, { mergedIntoSupplierId: target.id, mergedAt: new Date(), mergedBy, mergeReason: reason }, { skipValidation: true });
  await window.PXStore.archiveRecord('suppliers', source.id, `Merged into ${target.name || target.id}: ${reason}`);
  return counts;
}

function openSupplierMergeDialog(source) {
  if (currentRole() !== 'admin') { toast('Only administrators can merge supplier records.', 'danger'); return; }
  const targets = (state.data.suppliers || []).filter(s => !s.archived && s.id !== source.id);
  if (!targets.length) { toast('A second active supplier is required to perform a merge.', 'warning'); return; }
  window.openModal(`<div class="modal-head"><div><h2>Merge Supplier</h2><div class="sub">${escapeHtml(source.name || '')} will be archived as a duplicate</div></div><button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
    <div class="modal-body"><div class="form-grid"><div class="field-group full"><label>Surviving Supplier</label><select id="merge-target"><option value="">Select supplier…</option>${targets.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name || 'Unnamed supplier')}</option>`).join('')}</select></div><div class="field-group full"><label>Merge Reason <span class="req">*</span></label><textarea id="merge-reason" placeholder="Why these supplier records are duplicates"></textarea></div><div class="field-group full"><label>Confirmation</label><input id="merge-confirm" placeholder="Type MERGE to confirm" autocomplete="off"><div class="hint">ERP mappings, contacts, linked orders, supplier documents, follow-ups and issues move to the surviving supplier. The source remains archived for audit.</div></div></div></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-danger" id="merge-go">Merge Supplier</button></div>`);
  $('#merge-go').addEventListener('click', async () => {
    const target = targets.find(s => s.id === $('#merge-target').value), reason = $('#merge-reason').value.trim();
    if (!target || !reason || $('#merge-confirm').value.trim().toUpperCase() !== 'MERGE') { toast('Select a survivor, enter a reason, and type MERGE to confirm.', 'danger'); return; }
    const button = $('#merge-go'); button.disabled = true; button.textContent = 'Merging…';
    try { const counts = await mergeSupplier(source, target, reason); toast(`Merged into ${target.name}: ${counts.orders} order(s), ${counts.documents} document(s), ${counts.followups} follow-up(s), ${counts.issues} issue(s) moved`, 'success'); window.closeModal(); window.__renderers['suppliers'](); }
    catch (error) { toast('Merge stopped: ' + error.message + '. Review the affected records before retrying.', 'danger'); button.disabled = false; button.textContent = 'Merge Supplier'; }
  });
}

window.openSupplierForm = function(supId = null, opts = {}) {
  const isEdit = !!supId;
  const canWriteSupplier = isEdit ? can('suppliers', 'edit') : can('suppliers', 'create');
  if (!canWriteSupplier && !isEdit) { toast('You can view suppliers, but you are not authorised to create them.', 'warn'); return; }
  const s = isEdit ? state.data.suppliers.find(x => x.id === supId) : { active: true, entity: currentEntity(), ...(opts.seed || {}) };
  if (!s) { toast('Supplier not found', 'danger'); return; }
  const supEntity = recordEntity(s);
  window.openModal(`
    <div class="modal-head">
      <div><h2>${canWriteSupplier ? (isEdit?'Edit Supplier':'New Supplier') : 'Supplier'}</h2><div class="sub">${escapeHtml(s.name || '')}${canWriteSupplier ? '' : ' · view only'}</div></div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <form id="sup-form">
        <div class="form-grid">
          <div class="field-group"><label>Entity <span class="req">*</span> <span class="text-xs text-muted">(suppliers are per-entity)</span></label>
            <select name="entity" ${isEdit ? 'disabled' : ''}>
              ${REF.entities.map(e => `<option value="${escapeHtml(e.code)}" ${supEntity===e.code?'selected':''}>${escapeHtml(e.short || e.code)}</option>`).join('')}
            </select>
            ${isEdit ? '<div class="hint">Entity is fixed once a supplier is created. Create a separate record under another entity if needed.</div>' : ''}
          </div>
          <div class="field-group full"><label>Supplier Name <span class="req">*</span></label><input name="name" value="${escapeHtml(s.name||'')}" required /></div>
          <div class="field-group full"><label>Legal / Registered Name <span class="text-xs text-muted">(for ERP matching)</span></label><input name="legalName" value="${escapeHtml(s.legalName||'')}" placeholder="As registered in the ERP / on invoices" /></div>
          <div class="field-group"><label>Country</label><input name="country" value="${escapeHtml(s.country||'')}" /></div>
          <div class="field-group"><label>Default Currency</label>
            <select name="defaultCurrency">
              <option value="">—</option>
              ${REF.currencies.map(c => `<option value="${c}" ${s.defaultCurrency===c?'selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="field-group full"><label>Default Payment Terms</label>
            <input name="defaultTerms" value="${escapeHtml(s.defaultTerms||'')}" list="terms-list" />
            <datalist id="terms-list">${REF.paymentTerms.map(t => `<option value="${escapeHtml(t)}">`).join('')}</datalist>
          </div>
          <div class="field-group full"><label>Aliases / Former Names</label>
            <textarea name="aliases" placeholder="One per line. e.g. ORICON&#10;MANJUSHREE TECHNOPACK">${(s.aliases||[]).join('\n')}</textarea>
            <div class="hint">Helps reconcile historical name variants.</div>
          </div>
          <div class="field-group full"><label>ERP Vendor Mapping <span class="text-xs text-muted">(per entity / source — used during import &amp; reconciliation)</span></label>
            <div id="erp-map-rows"></div>
            <button type="button" class="btn btn-sm" id="erp-map-add" style="margin-top:6px">+ Add mapping</button>
            <div class="hint">The same supplier can have different vendor numbers in Phoenix (Navision) and Seychelles (Business Central). Effective dates preserve the Navision-to-BC migration history.</div>
          </div>
          <div class="field-group full"><label>Supplier Contacts</label>
            <div id="supplier-contact-rows"></div>
            <button type="button" class="btn btn-sm" id="supplier-contact-add" style="margin-top:6px">+ Add contact</button>
            <div class="hint">Keep the commercial, logistics and accounts contacts separately so follow-up is directed to the right person.</div>
          </div>
          <div class="field-group full"><label>Notes</label><textarea name="notes" placeholder="General supplier notes only">${escapeHtml(s.notes||'')}</textarea></div>
          <div class="field-group"><label>Status</label>
            <label style="padding-top:8px"><input type="checkbox" name="active" ${s.active !== false ? 'checked' : ''} style="width:auto;margin-right:6px"> Active</label>
          </div>
          <div class="field-group"><label>Supplier Rating <span class="text-xs text-muted">(Phoenix-owned)</span></label>
            <select name="supplierRating">
              <option value="">— not rated —</option>
              ${REF.supplierRatings.map(r => `<option value="${r}" ${s.supplierRating===r?'selected':''}>${r}</option>`).join('')}
            </select>
          </div>
          <div class="field-group full"><label>Rating Review Reason</label><textarea name="supplierRatingReason" placeholder="Reason for the rating; mandatory for watchlist and blocked suppliers">${escapeHtml(s.supplierRatingReason||'')}</textarea></div>
          <div class="field-group"><label>Next Rating Review</label><input type="date" name="supplierRatingReviewDate" value="${supplierDateInput(s.supplierRatingReviewDate)}"></div>
          ${isEdit ? `<div class="field-group"><label>Last Rating Review</label><div class="hint" style="padding-top:9px">${escapeHtml(s.supplierRatingReviewedBy || '—')} · ${supplierDateLabel(s.supplierRatingReviewedAt)}</div></div>` : ''}
        </div>
      </form>
      ${isEdit ? supplierPerformancePanel(s) : ''}
      ${isEdit && Array.isArray(s.supplierRatingHistory) && s.supplierRatingHistory.length ? `
        <div style="border-top:1px solid var(--line);margin:18px 0"></div>
        <div class="op-section"><div class="op-head"><h3>Rating Review History <span class="op-count">${s.supplierRatingHistory.length}</span></h3></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>Rating</th><th>Reason</th><th>Next Review</th><th>Reviewed By</th><th>Reviewed At</th></tr></thead><tbody>
            ${s.supplierRatingHistory.slice().reverse().slice(0, 10).map(review => `<tr><td>${escapeHtml(review.rating || '—')}</td><td>${escapeHtml(review.reason || '—')}</td><td>${supplierDateLabel(review.reviewDate)}</td><td>${escapeHtml(review.reviewedBy || '—')}</td><td>${supplierDateLabel(review.reviewedAt)}</td></tr>`).join('')}
          </tbody></table></div>
        </div>` : ''}
      ${isEdit ? `
        <div style="border-top:1px solid var(--line);margin:18px 0"></div>
        <div id="documents-section-supplier-${s.id}">${window.renderDocumentsSection ? window.renderDocumentsSection('supplier', s.id) : ''}</div>
        <div style="height:18px"></div>
        <div id="followups-section-supplier-${s.id}">${window.renderFollowupsSection ? window.renderFollowupsSection('supplier', s.id) : ''}</div>
      ` : ''}
    </div>
    <div class="modal-foot">
      ${isEdit ? '<button class="btn" id="supplier-scorecard" style="margin-right:auto">Scorecard</button>' : ''}
      ${isEdit && currentRole() === 'admin' && !s.archived ? '<button class="btn" id="merge-sup">Merge</button>' : ''}
      ${isEdit && window.PXUtils.can('suppliers','archive') ? (s.archived ? '<button class="btn" id="restore-sup">Restore</button>' : '<button class="btn btn-danger" id="del-sup">Archive</button>') : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      ${canWriteSupplier ? `<button class="btn btn-primary" id="save-sup">${isEdit?'Save':'Create'}</button>` : '<span class="text-xs text-muted" style="align-self:center">View only — supplier master data is maintained by authorised users</span>'}
    </div>
  `);
  if (isEdit && window.__setDetailContext) window.__setDetailContext('supplier', s.id);

  // ---- ERP vendor mapping editor (per entity/source) ----
  let mappings = JSON.parse(JSON.stringify(s.erpMappings || []));
  const entOpts = sel => REF.entities.map(e => `<option value="${e.code}" ${sel===e.code?'selected':''}>${e.short} — ${escapeHtml(e.code)}</option>`).join('');
  const srcOpts = sel => REF.erpSources.filter(x => x !== 'Manual').map(x => `<option ${sel===x?'selected':''}>${x}</option>`).join('');
  function renderMappings() {
    const box = $('#erp-map-rows'); if (!box) return;
    if (!mappings.length) { box.innerHTML = '<div class="text-xs text-muted" style="padding:4px 0">No ERP vendor mappings yet — import/reconciliation will fall back to name matching.</div>'; return; }
    box.innerHTML = mappings.map((m, i) => `
      <div class="erp-map-row" data-i="${i}" style="display:grid;grid-template-columns:1.3fr 1.1fr 1fr 1fr 1fr auto auto;gap:6px;align-items:center;margin-bottom:6px">
        <select data-f="entity">${entOpts(m.entity)}</select>
        <select data-f="erpSource">${srcOpts(m.erpSource)}</select>
        <input data-f="vendorNo" placeholder="Vendor No." value="${escapeHtml(m.vendorNo||'')}" autocomplete="off" />
        <input type="date" data-f="effectiveFrom" title="Effective from" value="${supplierDateInput(m.effectiveFrom)}" />
        <input type="date" data-f="effectiveTo" title="Effective to" value="${supplierDateInput(m.effectiveTo)}" />
        <label class="text-xs" style="white-space:nowrap;display:flex;align-items:center;gap:3px"><input type="checkbox" data-f="active" ${m.active!==false?'checked':''} style="width:auto"> active</label>
        <button type="button" class="btn btn-sm" data-rm="${i}" title="Remove">✕</button>
      </div>`).join('');
  }
  const mapBox = $('#erp-map-rows');
  if (mapBox) {
    const sync = e => {
      const row = e.target.closest('.erp-map-row'); if (!row) return;
      const i = +row.dataset.i, f = e.target.dataset.f; if (f == null) return;
      mappings[i][f] = (e.target.type === 'checkbox') ? e.target.checked : e.target.value;
    };
    mapBox.addEventListener('input', sync);
    mapBox.addEventListener('change', sync);
    mapBox.addEventListener('click', e => { if (e.target.dataset.rm != null) { mappings.splice(+e.target.dataset.rm, 1); renderMappings(); } });
    const addBtn = $('#erp-map-add');
    if (addBtn) addBtn.addEventListener('click', () => {
      mappings.push({ entity: REF.entities[0].code, erpSource: 'Navision', vendorNo: '', effectiveFrom: '', effectiveTo: '', active: true });
      renderMappings();
    });
    renderMappings();
  }

  // ---- Supplier contacts: operational contacts are structured, not buried in notes. ----
  let contacts = JSON.parse(JSON.stringify(s.contacts || []));
  const contactEntityOptions = selected => `<option value="">All entities</option>${REF.entities.map(entity => `<option value="${entity.code}" ${selected===entity.code?'selected':''}>${escapeHtml(entity.short || entity.code)}</option>`).join('')}`;
  const contactPurposeOptions = selected => ['general','commercial','logistics','accounts','quality','technical'].map(value => `<option value="${value}" ${selected===value?'selected':''}>${value}</option>`).join('');
  const contactEscalationOptions = selected => ['primary','escalation','executive'].map(value => `<option value="${value}" ${selected===value?'selected':''}>${value}</option>`).join('');
  function renderContacts() {
    const box = $('#supplier-contact-rows'); if (!box) return;
    if (!contacts.length) {
      box.innerHTML = '<div class="text-xs text-muted" style="padding:4px 0">No contacts recorded yet.</div>';
      return;
    }
    box.innerHTML = contacts.map((contact, i) => `
      <div class="supplier-contact-row" data-i="${i}">
        <input data-f="name" placeholder="Name" value="${escapeHtml(contact.name || '')}" autocomplete="off" />
        <input data-f="role" placeholder="Role / department" value="${escapeHtml(contact.role || '')}" autocomplete="off" />
        <select data-f="entity" title="Entity">${contactEntityOptions(contact.entity || '')}</select>
        <select data-f="purpose" title="Purpose">${contactPurposeOptions(contact.purpose || 'general')}</select>
        <select data-f="escalationLevel" title="Escalation level">${contactEscalationOptions(contact.escalationLevel || 'primary')}</select>
        <input data-f="email" type="email" placeholder="Email" value="${escapeHtml(contact.email || '')}" autocomplete="off" />
        <input data-f="phone" placeholder="Phone" value="${escapeHtml(contact.phone || '')}" autocomplete="off" />
        <label class="text-xs"><input type="checkbox" data-f="preferred" ${contact.preferred ? 'checked' : ''} style="width:auto"> preferred</label>
        <label class="text-xs"><input type="checkbox" data-f="active" ${contact.active !== false ? 'checked' : ''} style="width:auto"> active</label>
        <button type="button" class="btn btn-sm" data-rm="${i}" title="Remove contact">✕</button>
      </div>`).join('');
  }
  const contactBox = $('#supplier-contact-rows');
  if (contactBox) {
    const syncContact = event => {
      const row = event.target.closest('.supplier-contact-row'); if (!row) return;
      const index = Number(row.dataset.i), field = event.target.dataset.f; if (!field) return;
      contacts[index][field] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    };
    contactBox.addEventListener('input', syncContact);
    contactBox.addEventListener('change', syncContact);
    contactBox.addEventListener('click', event => {
      if (event.target.dataset.rm == null) return;
      contacts.splice(Number(event.target.dataset.rm), 1);
      renderContacts();
    });
    $('#supplier-contact-add').addEventListener('click', () => {
      contacts.push({ id: 'contact_' + Date.now(), name: '', role: '', entity: '', purpose: 'general', escalationLevel: 'primary', email: '', phone: '', preferred: false, active: true });
      renderContacts();
    });
    renderContacts();
  }

  function applySupplierReadOnly() {
    if (canWriteSupplier) return;
    $$('#sup-form input, #sup-form select, #sup-form textarea').forEach(el => {
      if (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date' || el.type === 'number') el.disabled = true;
      else el.readOnly = true;
    });
    $$('#erp-map-add, #supplier-contact-add, #sup-form [data-rm]').forEach(el => { el.style.display = 'none'; });
  }
  applySupplierReadOnly();

  const saveSupBtn = $('#save-sup');
  if (saveSupBtn) saveSupBtn.addEventListener('click', async () => {
    const fd = new FormData($('#sup-form'));
    const data = {};
    fd.forEach((v, k) => { data[k] = v; });
    data.name = (fd.get('name') || '').trim();
    // Entity: fixed on edit (select is disabled, so not in FormData); from the form for new records.
    data.entity = isEdit ? supEntity : (fd.get('entity') || currentEntity());
    data.active = fd.get('active') === 'on';
    data.legalName = (fd.get('legalName')||'').trim();
    data.aliases = (fd.get('aliases')||'').split('\n').map(x => x.trim()).filter(Boolean);
    data.erpMappings = mappings
      .map(m => ({ entity: m.entity, erpSource: m.erpSource, vendorNo: (m.vendorNo||'').trim(), effectiveFrom: m.effectiveFrom || null, effectiveTo: m.effectiveTo || null, active: m.active !== false }))
      .filter(m => m.vendorNo && m.entity);
    data.contacts = contacts.map((contact, index) => ({
      id: contact.id || 'contact_' + Date.now() + '_' + index,
      name: String(contact.name || '').trim(),
      role: String(contact.role || '').trim(),
      entity: String(contact.entity || '').trim(),
      purpose: String(contact.purpose || 'general').trim(),
      escalationLevel: String(contact.escalationLevel || 'primary').trim(),
      email: String(contact.email || '').trim(),
      phone: String(contact.phone || '').trim(),
      preferred: !!contact.preferred,
      active: contact.active !== false
    })).filter(contact => contact.name || contact.email || contact.phone);
    data.supplierRatingReason = String(fd.get('supplierRatingReason') || '').trim();
    data.supplierRatingReviewDate = fd.get('supplierRatingReviewDate') ? new Date(fd.get('supplierRatingReviewDate')) : null;
    const ratingChanged = !isEdit || data.supplierRating !== (s.supplierRating || '');
    const ratingReviewChanged = ratingChanged || data.supplierRatingReason !== (s.supplierRatingReason || '') || supplierDateInput(data.supplierRatingReviewDate) !== supplierDateInput(s.supplierRatingReviewDate);
    if (data.supplierRating === 'blocked' && ratingChanged && currentRole() !== 'admin') {
      toast('Only an administrator may mark a supplier as blocked.', 'danger'); return;
    }
    if (ratingReviewChanged && (data.supplierRating || data.supplierRatingReason || data.supplierRatingReviewDate)) {
      const reviewedBy = (state.officer && state.officer.code) || state.user?.email || 'unknown';
      data.supplierRatingReviewedBy = reviewedBy;
      data.supplierRatingReviewedAt = new Date();
      data.supplierRatingHistory = [...(s.supplierRatingHistory || []), {
        id: 'rating_' + Date.now(),
        rating: data.supplierRating || null,
        reason: data.supplierRatingReason || null,
        reviewDate: data.supplierRatingReviewDate || null,
        reviewedBy,
        reviewedAt: new Date(),
        approvedBy: ['watchlist', 'blocked'].includes(data.supplierRating) && currentRole() === 'admin' ? reviewedBy : null
      }];
    }
    if (!data.name) { toast('Name required', 'danger'); return; }
    if (window.PXValidators) {
      const v = window.PXValidators.validate('supplier', data, isEdit ? s : null);
      if (!v.ok) { toast('Cannot save: ' + v.errors[0], 'danger'); return; }
      if (v.warnings.length && !confirm('Please confirm:\n\n• ' + v.warnings.join('\n• ') + '\n\nSave anyway?')) return;
    }
    try {
      if (isEdit) await window.PXStore.updateRecord('suppliers', supId, data);
      else {
        const created = await window.PXStore.createRecord('suppliers', data);
        if (opts.afterCreate) {
          try { await opts.afterCreate({ id: created.id, ...data }); }
          catch (postCreateError) {
            toast('Supplier was created, but order backfill needs attention: ' + postCreateError.message, 'warning');
            window.closeModal();
            return;
          }
        }
      }
      toast('Saved', 'success');
      window.closeModal();
    } catch (err) { toast('Save failed: ' + err.message, 'danger'); }
  });
  if (isEdit) { const dsup = $('#del-sup'); if (dsup) dsup.addEventListener('click', async () => {
    if (!confirm('Archive supplier? It will be hidden from the active list but kept for audit history. You can restore it later.')) return;
    const reason = prompt('Optional reason for archiving:', '') || null;
    try { await window.PXStore.archiveRecord('suppliers', supId, reason); toast('Supplier archived', 'success'); window.closeModal(); }
    catch (err) { toast('Archive failed: ' + err.message, 'danger'); }
  }); }
  if (isEdit) { const restore = $('#restore-sup'); if (restore) restore.addEventListener('click', async () => {
    try { await window.PXStore.restoreRecord('suppliers', supId); toast('Supplier restored', 'success'); window.closeModal(); }
    catch (err) { toast('Restore failed: ' + err.message, 'danger'); }
  }); }
  if (isEdit) { const merge = $('#merge-sup'); if (merge) merge.addEventListener('click', () => openSupplierMergeDialog(s)); }
  if (isEdit) { const scorecard = $('#supplier-scorecard'); if (scorecard) scorecard.addEventListener('click', () => openSupplierScorecard(s)); }
};
// Documents/follow-ups return-to-context uses openSupplierDetail; suppliers use the form.
window.openSupplierDetail = window.openSupplierForm;
