const { $, $$, fmtDate, fmtDateISO, escapeHtml, toast, can, stripUndefined,
  collection, addDoc, doc, updateDoc, deleteDoc, serverTimestamp } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;

const badgeForDocStatus = s => ({ missing:'danger', requested:'accent', received:'info', approved:'success', rejected:'danger' }[s] || 'neutral');
const documentLinkOf = d => (window.PXDocuments ? window.PXDocuments.documentLinkOf(d) : (d.documentUrl || d.url || d.link || ''));

// Expiry assessment for a document: returns {state, days, label} or null if no expiry.
function docExpiryInfo(d) {
  if (!d || !d.expiryDate) return null;
  const exp = d.expiryDate.toDate ? d.expiryDate.toDate() : new Date(d.expiryDate);
  if (isNaN(exp)) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const days = Math.round((exp - today) / 86400000);
  const alertDays = (d.expiryAlertDays != null) ? Number(d.expiryAlertDays) : (REF.defaultExpiryAlertDays || 30);
  if (days < 0) return { state:'expired', days, label:`Expired ${Math.abs(days)}d ago` };
  if (days <= alertDays) return { state:'soon', days, label:`Expires in ${days}d` };
  return { state:'ok', days, label:`Valid (${days}d)` };
}
const badgeForFollowup = s => ({ open:'accent', done:'success', cancelled:'neutral' }[s] || 'neutral');
const badgeForIssue = s => ({ open:'danger', resolved:'success' }[s] || 'neutral');
const badgeForSeverity = s => ({ critical:'danger', high:'warn', medium:'info', low:'neutral' }[(s||'').toLowerCase()] || 'neutral');
// days from today: negative = in the past (overdue / aged)
const opDaysFromToday = d => { if(!d) return null; const ms = (d.seconds?d.seconds*1000:(d instanceof Date?d.getTime():Date.parse(d))); if(isNaN(ms)) return null; return Math.round((ms - Date.now())/86400000); };
const issueIsOverdue = i => { const t = opDaysFromToday(i.targetResolutionDate); return i.status==='open' && t!==null && t < 0; };

/* Soft-delete / archive (audit-safe). Replaces hard delete for documents,
   followups and issues. Archived records are hidden by default but remain in
   Firestore and can be surfaced in reports. */
async function archiveOperationalRecord(coll, id, label) {
  if (!can(coll, 'archive')) { toast(`You can view ${label.toLowerCase()} records, but you are not authorised to archive them.`, 'warn'); return; }
  const reason = prompt(`Archive this ${label.toLowerCase()}? It will be hidden but kept for audit.\n\nOptional reason:`, '');
  if (reason === null) return; // cancelled
  try {
    await window.PXStore.archiveRecord(coll, id, reason);
    toast(`${label} archived`, 'success');
    closeModalToDetail();
  } catch (e) { toast('Archive failed: ' + e.message, 'danger'); }
}
// Restore an archived operational record (documents/followups/issues)
async function restoreOperationalRecord(coll, id, label) {
  if (!can(coll, 'archive')) { toast(`You can view ${label.toLowerCase()} records, but you are not authorised to restore them.`, 'warn'); return; }
  try {
    await window.PXStore.restoreRecord(coll, id);
    toast(`${label} restored`, 'success');
    closeModalToDetail();
  } catch (e) { toast('Restore failed: ' + e.message, 'danger'); }
}
window.restoreOperationalRecord = restoreOperationalRecord;

// Track which record a detail modal is currently showing, so live updates can refresh sections
let currentDetail = null; // { type, id }
window.__setDetailContext = (type, id) => { currentDetail = { type, id }; };
window.__clearDetailContext = () => { currentDetail = null; };
window.__refreshDetailSections = () => {
  if (!currentDetail) return;
  ['documents','followups','issues','updateRequests'].forEach(kind => {
    const mount = document.getElementById(`${kind}-section-${currentDetail.type}-${currentDetail.id}`);
    if (mount) {
      if (kind === 'documents') mount.innerHTML = documentsSectionHtml(currentDetail.type, currentDetail.id);
      if (kind === 'followups') mount.innerHTML = followupsSectionHtml(currentDetail.type, currentDetail.id);
      if (kind === 'issues') mount.innerHTML = issuesSectionHtml(currentDetail.type, currentDetail.id);
      if (kind === 'updateRequests' && window.renderUpdateRequestsSection) mount.innerHTML = window.renderUpdateRequestsSection(currentDetail.type, currentDetail.id);
    }
  });
};

/* ============================ DOCUMENTS ============================ */
// Show-archived toggle (per detail view session). Toggled by the section header control.
window.__opShowArchived = window.__opShowArchived || { documents: false, followups: false, issues: false };
window.__toggleOpArchived = function(kind) {
  window.__opShowArchived[kind] = !window.__opShowArchived[kind];
  if (window.__refreshDetailSections) window.__refreshDetailSections();
};
function docsFor(type, id) {
  const showArch = window.__opShowArchived.documents;
  if (type === 'order' && window.PXDocuments) {
    const order = state.data.orders.find(o => o.id === id);
    if (order) return window.PXDocuments.documentsForOrder(order, state.data, { showArchived: showArch });
  }
  return state.data.documents.filter(d => (showArch || !d.archived) && d.relatedType === type && d.relatedId === id)
    .sort((a,b) => (b.addedAt?.seconds||0) - (a.addedAt?.seconds||0));
}
function documentsSectionHtml(type, id) {
  const docs = docsFor(type, id);
  const directDocs = docs.filter(d => d.relatedType === type && d.relatedId === id);
  // Expected documents for this context, applying configurable rules (shipment mode,
  // order type, foreign/local, function) so we don't raise false "missing" alerts.
  let parentRecord = null;
  if (type === 'order') parentRecord = state.data.orders.find(o => o.id === id);
  else if (type === 'shipment') parentRecord = state.data.shipments.find(s => s.id === id);
  else if (type === 'payment') parentRecord = state.data.payments.find(p => p.id === id);
  else if (type === 'supplier') parentRecord = state.data.suppliers.find(s => s.id === id);
  const expected = window.PXUtils.expectedDocsFor ? window.PXUtils.expectedDocsFor(type, parentRecord || {}) : ((REF.expectedDocuments && REF.expectedDocuments[type]) || []);
  const presentTypes = directDocs.map(d => d.documentType);
  const missingExpected = expected.filter(t => !presentTypes.includes(t));
  const checklistHtml = expected.length ? `
    <div class="doc-checklist">
      <div class="doc-checklist-head">Expected documents</div>
      <div class="doc-chips">
        ${expected.map(t => {
          const has = presentTypes.includes(t);
          const d = directDocs.find(x => x.documentType === t);
          const ok = has && (d.status==='received' || d.status==='approved');
          return `<span class="doc-chip ${ok?'ok':has?'partial':'missing'}" title="${has?escapeHtml(d.status):'no record yet'}">${ok?'✓':has?'•':'○'} ${escapeHtml(t)}</span>`;
        }).join('')}
      </div>
      ${missingExpected.length ? `<div class="doc-missing-note">${missingExpected.length} expected document${missingExpected.length>1?'s':''} not yet recorded.</div>` : '<div class="doc-missing-note ok">All expected documents recorded.</div>'}
    </div>` : '';
  const archivedCount = type === 'order' && window.PXDocuments && parentRecord
    ? window.PXDocuments.documentsForOrder(parentRecord, state.data, { showArchived: true }).filter(d => d.archived).length
    : state.data.documents.filter(d => d.archived && d.relatedType === type && d.relatedId === id).length;
  const showArch = window.__opShowArchived.documents;

  // Render a single document row (shared by folder + flat views)
  const docRow = d => {
    const exp = docExpiryInfo(d);
    const rowType = d.relatedType || type;
    const rowId = d.relatedId || id;
    const path = window.PXDocuments ? window.PXDocuments.folderPathFor(d, state.data) : (d.documentFolderPath || '');
    return `<tr${d.archived?' class="op-archived-row"':''}>
      <td>${escapeHtml(d.documentType||'—')}${d.required?'<span class="doc-req" title="Required document">REQ</span>':''}${d.archived?'<span class="doc-archived-tag" title="Archived">archived</span>':''}</td>
      <td class="truncate" title="${escapeHtml(d.documentName||'')}">${escapeHtml(d.documentName||'—')}</td>
      <td><span class="badge ${badgeForDocStatus(d.status)}">${escapeHtml(d.status||'—')}</span>${d.verifiedAt?'<span class="doc-verified" title="Verified by '+escapeHtml(d.verifiedBy||'')+'">✓ verified</span>':''}</td>
      <td>${fmtDate(d.receivedDate)||'—'}</td>
      <td>${d.expiryDate?`${fmtDate(d.expiryDate)}${exp&&exp.state!=='ok'?`<span class="doc-exp doc-exp-${exp.state}">${exp.label}</span>`:''}`:'—'}</td>
      <td>${d.version?escapeHtml(String(d.version)):'—'}</td>
      <td>${documentLinkOf(d)
          ? `<a href="${escapeHtml(documentLinkOf(d))}" target="_blank" rel="noopener" class="op-link">open ↗</a>`
          : (d.fileData
            ? `<a href="#" class="op-link" onclick="event.preventDefault(); window.__openStoredFile('${d.id}')" title="${escapeHtml(d.fileName||'file')}">📎 open file</a>`
            : '<span class="text-xs text-muted">no link</span>')}</td>
      <td class="actions">
        ${d.archived
          ? (can('documents','archive') ? `<button class="btn btn-sm" onclick="restoreOperationalRecord('documents','${d.id}','Document')">Restore</button>` : '')
          : (can('documents','edit') ? `<button class="btn btn-sm" onclick="openDocumentForm('${rowType}','${rowId}','${d.id}')">Edit</button>` : '')}
      </td>
    </tr>${path?`<tr class="op-note-row"><td colspan="8" class="op-note">Future folder: ${escapeHtml(path)}</td></tr>`:''}${d.rejectedReason&&d.status==='rejected'?`<tr class="op-note-row"><td colspan="8" class="op-note" style="color:var(--danger)">Rejected: ${escapeHtml(d.rejectedReason)}</td></tr>`:''}${d.notes?`<tr class="op-note-row"><td colspan="8" class="op-note">Note: ${escapeHtml(d.notes)}</td></tr>`:''}`;
  };
  const tableWrap = rows => `<div class="table-wrap"><table class="data">
        <thead><tr><th>Type</th><th>Name</th><th>Status</th><th>Received</th><th>Expiry</th><th>Ver.</th><th>File / Link</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;

  // ORDER: group all PO-linked documents into SharePoint-ready folders
  // (PO / Shipping Documents / Payment / GRN).
  let bodyHtml;
  if (type === 'order') {
    const folders = window.PXDocuments ? window.PXDocuments.folders() : (REF.documentFolders || []);
    const folderOf = d => window.PXDocuments ? window.PXDocuments.normalizeFolderKey(d.folder, d.documentType) : (d.folder || (REF.documentTypeFolder[d.documentType] || 'purchase_order'));
    bodyHtml = `<div class="doc-folders">` + folders.map(f => {
      const fdocs = docs.filter(d => folderOf(d) === f.key);
      const folderPath = window.PXDocuments ? window.PXDocuments.folderPathFor({ relatedType: type, relatedId: id, folder: f.key }, state.data) : f.label;
      return `
        <div class="doc-folder">
          <div class="doc-folder-head">
            <span class="doc-folder-name">${f.icon} ${escapeHtml(f.label)} <span class="op-count">${fdocs.length}</span></span>
            ${can('documents','create') ? `<button class="btn btn-sm" onclick="openDocumentForm('${type}','${id}',null,'${f.key}')">+ Add to ${escapeHtml(f.label)}</button>` : ''}
          </div>
          <div class="op-hint" style="margin:0 0 8px">Future folder: ${escapeHtml(folderPath)}</div>
          ${fdocs.length ? tableWrap(fdocs.map(docRow).join('')) : '<p class="op-empty" style="margin:6px 0 0">No files in this folder yet.</p>'}
        </div>`;
    }).join('') + `</div>`;
  } else {
    bodyHtml = docs.length ? tableWrap(docs.map(docRow).join('')) : '<p class="op-empty">No documents yet.</p>';
  }

  return `
    <div class="op-section">
      <div class="op-head">
        <h3>Documents <span class="op-count">${docs.length}</span></h3>
        <div style="display:flex;gap:6px;align-items:center">
          ${archivedCount ? `<button class="btn btn-sm btn-ghost" onclick="window.__toggleOpArchived('documents')">${showArch?'Hide':'Show'} archived (${archivedCount})</button>` : ''}
          ${can('documents','create') ? `<button class="btn btn-sm" onclick="openDocumentForm('${type}','${id}')">+ Add document</button>` : ''}
        </div>
      </div>
      <div class="op-hint">${type === 'order' ? 'Files are organised into one parent folder per purchase order with PO, Shipping Documents, Payment and GRN sub-folders. On go-live these paths map to SharePoint folders.' : 'Upload a file (demo cloud storage) or paste a SharePoint/OneDrive link.'}</div>
      ${checklistHtml}
      ${bodyHtml}
    </div>`;
}
window.openDocumentForm = function(type, id, docId, presetFolder) {
  if (!can('documents', docId ? 'edit' : 'create')) { toast('You can view documents, but you are not authorised to change them.', 'warn'); return; }
  const existing = docId ? state.data.documents.find(d => d.id === docId) : null;
  const d = existing || {};
  const curFolder = window.PXDocuments ? window.PXDocuments.normalizeFolderKey(d.folder || presetFolder, d.documentType) : (d.folder || presetFolder || (REF.documentTypeFolder[d.documentType] || 'purchase_order'));
  const currentDocumentUrl = d.documentUrl || d.url || d.link || '';
  const currentPath = window.PXDocuments ? window.PXDocuments.folderPathFor({ ...d, relatedType: type, relatedId: id, folder: curFolder }, state.data) : '';
  window.openModal(`
    <div class="modal-head"><div><h2>${docId?'Edit':'Add'} Document</h2><div class="sub">${type} · ${id}</div></div>
      <button class="btn btn-ghost btn-icon" onclick="closeModalToDetail()">✕</button></div>
    <div class="modal-body">
      <div class="op-hint" style="margin-bottom:12px">A SharePoint / OneDrive <strong>link is the recommended way</strong> to attach documents — files stay governed in Microsoft 365. The file upload below is a <strong>demo</strong> store (base64 in Firestore, <strong>≤600&nbsp;KB</strong>) so small files survive a refresh; on go-live it is replaced by a SharePoint link.</div>
      <div class="form-grid cols-2">
        <div class="field-group"><label>Document Type</label>
          <select name="documentType" id="doc-type-select">${REF.documentTypes.map(t=>`<option ${d.documentType===t?'selected':''}>${t}</option>`).join('')}</select></div>
        <div class="field-group"><label>Folder</label>
          <select name="folder" id="doc-folder-select">${(REF.documentFolders||[]).map(f=>`<option value="${f.key}" ${curFolder===f.key?'selected':''}>${f.icon} ${escapeHtml(f.label)}</option>`).join('')}</select></div>
        <div class="field-group full"><label>Future SharePoint Folder</label>
          <div id="doc-folder-path-preview" class="hint" style="border:1px solid var(--line);border-radius:6px;padding:8px;background:var(--surface-muted,#f7f4ef)">${escapeHtml(currentPath)}</div></div>
        <div class="field-group"><label>Status</label>
          <select name="status" id="doc-status">${REF.documentStatuses.map(s=>`<option ${d.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
        <div class="field-group full"><label>Document Name</label>
          <input type="text" name="documentName" value="${escapeHtml(d.documentName||'')}" placeholder="e.g. BL-2026-0481" /></div>
        <div class="field-group full"><label>Document Link (URL / file path)</label>
          <input type="text" name="documentUrl" value="${escapeHtml(currentDocumentUrl)}" placeholder="https://phoenixbev.sharepoint.com/..." />
          <div class="hint">Paste the SharePoint / OneDrive link (recommended — documents stay governed in Microsoft 365), or a network file path. The app stores the link, not the file.</div></div>
        <div class="field-group full"><label>Or Upload a File <span style="text-transform:none;font-weight:400;color:var(--muted-soft)">(demo storage — max 600 KB; a SharePoint link is recommended and replaces this on go-live)</span></label>
          <input type="file" name="docFile" id="doc-file-input" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt" />
          <div class="hint" id="doc-file-status">${d.fileData ? `📎 Stored: ${escapeHtml(d.fileName||'file')} (${d.fileSize?Math.round(d.fileSize/1024):'?'} KB) — re-uploading replaces it.` : 'For the demo, small files are stored securely in the cloud and survive refresh.'}</div></div>
        <div class="field-group"><label>Received Date</label>
          <input type="date" name="receivedDate" value="${fmtDateISO(d.receivedDate)}" /></div>
        <div class="field-group"><label>Expiry Date</label>
          <input type="date" name="expiryDate" value="${fmtDateISO(d.expiryDate)}" /></div>
        <div class="field-group"><label>Version</label>
          <input type="text" name="version" value="${escapeHtml(d.version||'')}" placeholder="e.g. 1, Rev B" /></div>
        <div class="field-group"><label>Expiry Alert (days before)</label>
          <input type="number" name="expiryAlertDays" value="${d.expiryAlertDays!=null?d.expiryAlertDays:''}" placeholder="${REF.defaultExpiryAlertDays}" min="0" /></div>
        <div class="field-group">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" name="required" ${d.required?'checked':''} style="width:auto"> Required document</label>
        </div>
        <div class="field-group">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" name="verified" ${d.verifiedAt?'checked':''} style="width:auto"> Mark verified / approved</label>
        </div>
        <div class="field-group full" id="doc-reject-wrap" style="${d.status==='rejected'?'':'display:none'}"><label>Rejection Reason</label>
          <input type="text" name="rejectedReason" value="${escapeHtml(d.rejectedReason||'')}" placeholder="Why was it rejected?" /></div>
        <div class="field-group full"><label>Notes</label>
          <textarea name="notes" placeholder="Optional notes">${escapeHtml(d.notes||'')}</textarea></div>
      </div>
    </div>
    <div class="modal-foot">
      ${docId && can('documents','archive') ? `<button class="btn" style="color:var(--danger)" onclick="deleteDocument('${docId}')">Archive</button>`:''}
      <button class="btn" onclick="closeModalToDetail()">Cancel</button>
      <button class="btn btn-primary" id="save-doc">${docId?'Save':'Add'}</button>
    </div>
  `, false);
  // Show rejection reason only when status = rejected
  const stSel = document.getElementById('doc-status');
  if (stSel) stSel.addEventListener('change', () => {
    const w = document.getElementById('doc-reject-wrap');
    if (w) w.style.display = (stSel.value === 'rejected') ? '' : 'none';
  });
  // ---- Demo file upload: read small files to base64, stored in Firestore ----
  // Auto-pick the folder when document type changes (unless the user already chose one)
  const typeSel = document.getElementById('doc-type-select');
  const folderSel = document.getElementById('doc-folder-select');
  const pathPreview = document.getElementById('doc-folder-path-preview');
  const refreshPathPreview = () => {
    if (!pathPreview || !window.PXDocuments) return;
    pathPreview.textContent = window.PXDocuments.folderPathFor({
      ...d,
      relatedType: type,
      relatedId: id,
      documentType: typeSel ? typeSel.value : d.documentType,
      folder: folderSel ? folderSel.value : curFolder
    }, state.data);
  };
  if (typeSel && folderSel) {
    typeSel.addEventListener('change', () => {
      const suggested = window.PXDocuments ? window.PXDocuments.defaultFolderForType(typeSel.value) : REF.documentTypeFolder[typeSel.value];
      if (suggested) folderSel.value = suggested;
      refreshPathPreview();
    });
    folderSel.addEventListener('change', refreshPathPreview);
  }
  let pendingFile = null; // { data, name, size, mime } or null = unchanged
  const fileInput = document.getElementById('doc-file-input');
  const fileStatus = document.getElementById('doc-file-status');
  const MAX_FILE_BYTES = 600 * 1024; // 600 KB cap — well within Firestore's ~1 MB doc limit, leaving room for the rest of the record
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) { pendingFile = null; return; }
      if (f.size > MAX_FILE_BYTES) {
        if (fileStatus) fileStatus.innerHTML = `<span style="color:var(--danger)">✗ ${escapeHtml(f.name)} is ${Math.round(f.size/1024)} KB — over the 600 KB demo limit. Paste a SharePoint/OneDrive link instead (recommended for any real document).</span>`;
        fileInput.value = ''; pendingFile = null; return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        pendingFile = { data: reader.result, name: f.name, size: f.size, mime: f.type || 'application/octet-stream' };
        if (fileStatus) fileStatus.innerHTML = `📎 Ready to store: <strong>${escapeHtml(f.name)}</strong> (${Math.round(f.size/1024)} KB). Click ${docId?'Save':'Add'} to upload.`;
      };
      reader.onerror = () => { fileInput.value = ''; pendingFile = null; if (fileStatus) fileStatus.innerHTML = `<span style="color:var(--danger)">✗ Could not read ${escapeHtml(f.name)}. The file may be locked or corrupted — try again, or paste a SharePoint/OneDrive link instead.</span>`; };
      reader.readAsDataURL(f);
    });
  }

  $('#save-doc').addEventListener('click', async () => {
    const g = n => { const el = document.querySelector(`[name="${n}"]`); return el ? el.value : ''; };
    const gc = n => { const el = document.querySelector(`[name="${n}"]`); return el ? el.checked : false; };
    const verified = gc('verified');
    let payload = {
      relatedType: type, relatedId: id,
      documentType: g('documentType'), documentName: g('documentName').trim(),
      folder: window.PXDocuments ? window.PXDocuments.normalizeFolderKey(g('folder'), g('documentType')) : (g('folder') || (REF.documentTypeFolder[g('documentType')] || 'purchase_order')),
      documentUrl: g('documentUrl').trim(), status: g('status'),
      receivedDate: g('receivedDate') ? new Date(g('receivedDate')) : null,
      expiryDate: g('expiryDate') ? new Date(g('expiryDate')) : null,
      notes: g('notes').trim(),
      required: gc('required'),
      version: g('version').trim() || null,
      expiryAlertDays: g('expiryAlertDays') !== '' ? Number(g('expiryAlertDays')) : null,
      rejectedReason: g('status') === 'rejected' ? (g('rejectedReason').trim() || null) : null,
      erpDocumentId: existing?.erpDocumentId || null,
      updatedAt: serverTimestamp(), updatedBy: state.officer?.code || ''
    };
    // Demo file storage: attach newly-read file, or preserve existing on edit
    if (pendingFile) {
      payload.fileData = pendingFile.data;
      payload.fileName = pendingFile.name;
      payload.fileSize = pendingFile.size;
      payload.fileMime = pendingFile.mime;
    } else if (existing) {
      payload.fileData = existing.fileData || null;
      payload.fileName = existing.fileName || null;
      payload.fileSize = existing.fileSize || null;
      payload.fileMime = existing.fileMime || null;
    }
    // Verified stamp (set once when ticked; cleared if un-ticked)
    if (verified) {
      payload.verifiedBy = existing?.verifiedBy || state.officer?.code || '';
      payload.verifiedAt = existing?.verifiedAt || serverTimestamp();
    } else {
      payload.verifiedBy = null; payload.verifiedAt = null;
    }
    if (window.PXDocuments) payload = { ...payload, ...window.PXDocuments.buildMetadata(payload, { existing }) };
    if (window.PXValidators) {
      const v = window.PXValidators.validate('document', payload, existing || null);
      if (!v.ok) { toast('Cannot save: ' + v.errors[0], 'danger'); return; }
      if (v.warnings.length && !confirm('Please confirm:\n\n• ' + v.warnings.join('\n• ') + '\n\nSave anyway?')) return;
    }
    try {
      if (docId) await window.PXStore.updateRecord('documents', docId, payload);
      else { payload.addedBy = state.officer?.code || ''; payload.addedAt = serverTimestamp(); payload.archived = false; await window.PXStore.createRecord('documents', payload); }
      toast('Document saved','success'); closeModalToDetail();
    } catch(e){
      const hint = pendingFile ? ' — if this keeps failing, the file may be too large for demo storage; paste a SharePoint/OneDrive link instead.' : '';
      toast('Save failed: ' + (e.message || e) + hint, 'danger');
    }
  });
};
window.deleteDocument = async function(docId){
  archiveOperationalRecord('documents', docId, 'Document');
};

/* Demo: open a Firestore-stored (base64) file in a new tab. Real deployment links to SharePoint. */
window.__openStoredFile = function(docId){
  const state = window.__state;
  const d = (state.data.documents || []).find(x => x.id === docId);
  if (!d || !d.fileData) { if (window.PXUtils?.toast) window.PXUtils.toast('No stored file found', 'warning'); return; }
  try {
    // Convert the data URL to a Blob so it opens reliably (and downloads with its name)
    const parts = d.fileData.split(',');
    const mime = (parts[0].match(/data:([^;]+)/) || [,'application/octet-stream'])[1];
    const bin = atob(parts[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    // For non-inline types, also offer a download
    if (!w) {
      const a = document.createElement('a'); a.href = url; a.download = d.fileName || 'document'; a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    if (window.PXUtils?.toast) window.PXUtils.toast('Could not open file: ' + (e.message || e), 'danger');
  }
};

/* ============================ FOLLOW-UPS ============================ */
function followupsFor(type, id) {
  const showArch = window.__opShowArchived.followups;
  return state.data.followups.filter(f => (showArch || !f.archived) && f.relatedType === type && f.relatedId === id)
    .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
}
function followupsSectionHtml(type, id) {
  const items = followupsFor(type, id);
  const officerName = c => { const o = state.data.officers.find(x=>x.code===c); return o?.fullName || c || '—'; };
  const showArch = window.__opShowArchived.followups;
  const archivedCount = state.data.followups.filter(f => f.archived && f.relatedType === type && f.relatedId === id).length;
  return `
    <div class="op-section">
      <div class="op-head">
        <h3>Follow-up Log <span class="op-count">${items.length}</span></h3>
        <div style="display:flex;gap:6px;align-items:center">
          ${archivedCount ? `<button class="btn btn-sm btn-ghost" onclick="window.__toggleOpArchived('followups')">${showArch?'Hide':'Show'} archived (${archivedCount})</button>` : ''}
          ${can('followups','create') ? `<button class="btn btn-sm" onclick="openFollowupForm('${type}','${id}')">+ Add follow-up</button>` : ''}
        </div>
      </div>
      ${items.length ? `<div class="op-feed">${items.map(f => `
        <div class="op-entry ${f.archived?'op-archived-row':''} ${f.status==='done'?'is-done':f.status==='cancelled'?'is-cancelled':''}">
          <div class="op-entry-top">
            <span class="op-author">${escapeHtml(officerName(f.officer))}</span>
            <span class="op-when">${f.createdAt?fmtDate(f.createdAt):''}</span>
            <span class="badge ${badgeForFollowup(f.status)}" style="font-size:10px">${escapeHtml(f.status||'open')}</span>
            ${f.archived?'<span class="doc-archived-tag" title="Archived">archived</span>':''}
          </div>
          <div class="op-comment">${escapeHtml(f.comment||'')}</div>
          ${f.nextAction?`<div class="op-next">➡ Next: ${escapeHtml(f.nextAction)}${f.nextActionDueDate?` <strong>(by ${fmtDate(f.nextActionDueDate)})</strong>`:''}${f.assignedTo?` · @${escapeHtml(f.assignedTo)}`:''}</div>`:''}
          <div class="op-entry-actions">
            ${f.archived
              ? (can('followups','archive') ? `<button class="btn btn-sm" onclick="restoreOperationalRecord('followups','${f.id}','Follow-up')">Restore</button>` : '')
              : (can('followups','edit') ? `<button class="btn btn-sm" onclick="openFollowupForm('${type}','${id}','${f.id}')">Edit</button>${f.status==='open'?`<button class="btn btn-sm" onclick="markFollowupDone('${f.id}')">Mark done</button>`:''}` : '')}
          </div>
        </div>`).join('')}</div>` : '<p class="op-empty">No follow-ups yet. Log supplier replies, chasing, handovers, next actions.</p>'}
    </div>`;
}
window.openFollowupForm = function(type, id, fId) {
  if (!can('followups', fId ? 'edit' : 'create')) { toast('You can view follow-ups, but you are not authorised to change them.', 'warn'); return; }
  const existing = fId ? state.data.followups.find(f => f.id === fId) : null;
  const f = existing || {};
  const officers = state.data.officers;
  window.openModal(`
    <div class="modal-head"><div><h2>${fId?'Edit':'Add'} Follow-up</h2><div class="sub">${type} · ${id}</div></div>
      <button class="btn btn-ghost btn-icon" onclick="closeModalToDetail()">✕</button></div>
    <div class="modal-body">
      <div class="form-grid cols-2">
        <div class="field-group full"><label>Comment / Update</label>
          <textarea name="comment" placeholder="e.g. Called supplier — confirmed dispatch next week">${escapeHtml(f.comment||'')}</textarea></div>
        <div class="field-group full"><label>Next Action (optional)</label>
          <input type="text" name="nextAction" value="${escapeHtml(f.nextAction||'')}" placeholder="e.g. Chase BL copy" /></div>
        <div class="field-group"><label>Next Action Due</label>
          <input type="date" name="nextActionDueDate" value="${fmtDateISO(f.nextActionDueDate)}" /></div>
        <div class="field-group"><label>Assigned To</label>
          <select name="assignedTo"><option value="">— Anyone —</option>${officers.map(o=>`<option value="${escapeHtml(o.code)}" ${f.assignedTo===o.code?'selected':''}>${escapeHtml(o.code)} — ${escapeHtml(o.fullName||'')}</option>`).join('')}</select></div>
        <div class="field-group"><label>Status</label>
          <select name="status">${REF.followupStatuses.map(s=>`<option ${f.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
      </div>
    </div>
    <div class="modal-foot">
      ${fId && can('followups','archive') ? `<button class="btn" style="color:var(--danger)" onclick="deleteFollowup('${fId}')">Archive</button>`:''}
      <button class="btn" onclick="closeModalToDetail()">Cancel</button>
      <button class="btn btn-primary" id="save-fu">${fId?'Save':'Add'}</button>
    </div>
  `, false);
  $('#save-fu').addEventListener('click', async () => {
    const g = n => { const el = document.querySelector(`[name="${n}"]`); return el ? el.value : ''; };
    if (!g('comment').trim()) { toast('Comment is required','danger'); return; }
    const payload = {
      relatedType: type, relatedId: id, comment: g('comment').trim(),
      nextAction: g('nextAction').trim(), nextActionDueDate: g('nextActionDueDate')?new Date(g('nextActionDueDate')):null,
      assignedTo: g('assignedTo'), status: g('status'),
      updatedAt: serverTimestamp(), updatedBy: state.officer?.code || ''
    };
    try {
      if (fId) await window.PXStore.updateRecord('followups', fId, payload);
      else { payload.officer = state.officer?.code || ''; payload.createdAt = serverTimestamp(); await window.PXStore.createRecord('followups', payload); }
      toast('Follow-up saved','success'); closeModalToDetail();
    } catch(e){ toast('Save failed: '+e.message,'danger'); }
  });
};
window.markFollowupDone = async function(fId){
  if (!can('followups','edit')) { toast('You can view follow-ups, but you are not authorised to update them.', 'warn'); return; }
  try { await window.PXStore.updateRecord('followups', fId, { status:'done' }); toast('Marked done','success'); }
  catch(e){ toast('Failed: '+e.message,'danger'); }
};
window.deleteFollowup = async function(fId){
  archiveOperationalRecord('followups', fId, 'Follow-up');
};

/* ============================ ISSUES ============================ */
function issuesSectionHtml(type, id) {
  // Supports BOTH the standardized relatedType/relatedId and the legacy _key format.
  const showArch = window.__opShowArchived.issues;
  const matchRec = i => (i.relatedType === type && i.relatedId === id) || i._key === `${type}:${id}`;
  const items = state.data.issues.filter(i => (showArch || !i.archived) && matchRec(i))
    .sort((a,b) => (b.openedDate?.seconds||0) - (a.openedDate?.seconds||0));
  const archivedCount = state.data.issues.filter(i => i.archived && matchRec(i)).length;
  return `
    <div class="op-section">
      <div class="op-head">
        <h3>Issues / Exceptions <span class="op-count">${items.filter(i=>i.status==='open').length} open</span></h3>
        <div style="display:flex;gap:6px;align-items:center">
          ${archivedCount ? `<button class="btn btn-sm btn-ghost" onclick="window.__toggleOpArchived('issues')">${showArch?'Hide':'Show'} archived (${archivedCount})</button>` : ''}
          ${can('issues','create') ? `<button class="btn btn-sm" onclick="openIssueForm('${type}','${id}')">+ Log issue</button>` : ''}
        </div>
      </div>
      ${items.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Type</th><th>Severity</th><th>Status</th><th>Owner</th><th>Opened</th><th>Target</th><th></th></tr></thead>
        <tbody>${items.map(i=>{
          const overdue = issueIsOverdue(i);
          const t = opDaysFromToday(i.targetResolutionDate);
          const targetCell = !i.targetResolutionDate ? '—'
            : (overdue ? `<span style="color:var(--danger)">${fmtDate(i.targetResolutionDate)} · overdue ${Math.abs(t)}d</span>`
                       : `${fmtDate(i.targetResolutionDate)}${t!=null?` · ${t}d`:''}`);
          const esc = Number(i.escalationLevel||0) > 0 ? `<span class="badge warn" title="Escalated${i.escalatedTo?' to '+escapeHtml(i.escalatedTo):''}">⬆ L${i.escalationLevel}${i.escalatedTo?' → '+escapeHtml(i.escalatedTo):''}</span>` : '';
          return `<tr${i.archived?' class="op-archived-row"':''}>
          <td>${escapeHtml(i.issueType||'—')}${i.dataQualityKey?'<span class="badge neutral" style="margin-left:5px" title="Created from a Data Quality Cockpit finding">DQ</span>':''}${i.archived?'<span class="doc-archived-tag" title="Archived">archived</span>':''}${esc}</td>
          <td><span class="badge ${badgeForSeverity(i.severity)}">${escapeHtml(i.severity||'—')}</span></td>
          <td><span class="badge ${badgeForIssue(i.status)}">${escapeHtml(i.status||'open')}</span></td>
          <td>${escapeHtml(i.owner||'—')}</td>
          <td>${fmtDate(i.openedDate)||'—'}</td>
          <td>${targetCell}</td>
          <td class="actions">${i.archived
            ? (can('issues','archive') ? `<button class="btn btn-sm" onclick="restoreOperationalRecord('issues','${i.id}','Issue')">Restore</button>` : '')
            : (can('issues','edit') ? `<button class="btn btn-sm" onclick="openIssueForm('${type}','${id}','${i.id}')">Edit</button>${i.status==='open'?`<button class="btn btn-sm" onclick="resolveIssue('${i.id}')">Resolve</button>`:''}` : '')}</td>
        </tr>${i.actionNotes?`<tr class="op-note-row"><td colspan="7" class="op-note">📝 ${escapeHtml(i.actionNotes)}${i.responsibleParty?` <span class="text-xs text-muted">· party: ${escapeHtml(i.responsibleParty)}</span>`:''}${i.issueCategory?` <span class="text-xs text-muted">· ${escapeHtml(i.issueCategory)}</span>`:''}</td></tr>`:''}`;}).join('')}
        </tbody></table></div>` : '<p class="op-empty">No issues logged.</p>'}
    </div>`;
}
window.openIssueForm = function(type, id, issueId) {
  if (!can('issues', issueId ? 'edit' : 'create')) { toast('You can view issues, but you are not authorised to change them.', 'warn'); return; }
  const existing = issueId ? state.data.issues.find(i => i.id === issueId) : null;
  const i = existing || {};
  const dataQualitySource = i.dataQualityKey ? `
        <div class="info-banner" style="margin-bottom:14px"><strong>Data-quality action</strong><br>${escapeHtml(i.dataQualityMessage || 'Source finding details are unavailable.')}<span class="text-xs text-muted"> Source level: ${escapeHtml(i.dataQualityLevel || 'unknown')}.</span></div>` : '';
  window.openModal(`
    <div class="modal-head"><div><h2>${issueId?'Edit':'Log'} Issue</h2><div class="sub">${type} · ${id}</div></div>
      <button class="btn btn-ghost btn-icon" onclick="closeModalToDetail()">✕</button></div>
    <div class="modal-body">
      ${dataQualitySource}
      <div class="form-grid cols-2">
        <div class="field-group"><label>Issue Type</label>
          <select name="issueType">${REF.issueTypes.map(t=>`<option ${i.issueType===t?'selected':''}>${t}</option>`).join('')}</select></div>
        <div class="field-group"><label>Cause / Category</label>
          <select name="issueCategory"><option value=""${i.issueCategory?'':' selected'}>—</option>${REF.issueCategories.map(t=>`<option ${i.issueCategory===t?'selected':''}>${t}</option>`).join('')}</select></div>
        <div class="field-group"><label>Severity</label>
          <select name="severity">${REF.issueSeverities.map(s=>`<option ${ (i.severity||'medium')===s?'selected':''}>${s}</option>`).join('')}</select></div>
        <div class="field-group"><label>Operational Impact</label>
          <select name="impactType"><option value=""${i.impactType?'':' selected'}>—</option>${REF.issueImpactTypes.map(t=>`<option ${i.impactType===t?'selected':''}>${t}</option>`).join('')}</select></div>
        <div class="field-group"><label>Responsible Party</label>
          <select name="responsibleParty"><option value=""${i.responsibleParty?'':' selected'}>—</option>${REF.issueResponsibleParties.map(t=>`<option ${i.responsibleParty===t?'selected':''}>${t}</option>`).join('')}</select></div>
        <div class="field-group"><label>Target Resolution Date</label>
          <input type="date" name="targetResolutionDate" value="${fmtDateISO(i.targetResolutionDate)}" /></div>
        <div class="field-group"><label>Status</label>
          <select name="status">${REF.issueStatuses.map(s=>`<option ${i.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
        <div class="field-group"><label>Owner</label>
          <input type="text" name="owner" value="${escapeHtml(i.owner||state.officer?.code||'')}" /></div>
        <div class="field-group"><label>Escalation Level</label>
          <select name="escalationLevel">${REF.escalationLevels.map(e=>`<option value="${e.v}" ${Number(i.escalationLevel||0)===e.v?'selected':''}>${e.l}</option>`).join('')}</select></div>
        <div class="field-group"><label>Escalated To <span class="text-xs text-muted">(officer code)</span></label>
          <input type="text" name="escalatedTo" value="${escapeHtml(i.escalatedTo||'')}" placeholder="e.g. BB" /></div>
        <div class="field-group"><label>Resolution Code</label>
          <select name="resolutionCode"><option value=""${i.resolutionCode?'':' selected'}>—</option>${REF.issueResolutionCodes.map(t=>`<option ${i.resolutionCode===t?'selected':''}>${t}</option>`).join('')}</select></div>
        <div class="field-group"><label>Resolved Date</label>
          <input type="date" name="resolvedDate" value="${fmtDateISO(i.resolvedDate)}" /></div>
        <div class="field-group full"><label>Action Notes</label>
          <textarea name="actionNotes" placeholder="What's the problem and what's being done">${escapeHtml(i.actionNotes||'')}</textarea></div>
      </div>
    </div>
    <div class="modal-foot">
      ${issueId && can('issues','archive') ? `<button class="btn" style="color:var(--danger)" onclick="deleteIssue('${issueId}')">Archive</button>`:''}
      <button class="btn" onclick="closeModalToDetail()">Cancel</button>
      <button class="btn btn-primary" id="save-issue">${issueId?'Save':'Log'}</button>
    </div>
  `, false);
  $('#save-issue').addEventListener('click', async () => {
    const g = n => { const el = document.querySelector(`[name="${n}"]`); return el ? el.value : ''; };
    const linkedShip = state.data.shipments.find(s => s.id === id);
    const payload = {
      // Standardized linkage (same shape as documents/followups) ...
      relatedType: type, relatedId: id,
      // ... plus legacy _key kept for backward compatibility
      _key: `${type}:${id}`,
      shipmentId: type==='shipment' ? (linkedShip?.shipmentId || id) : null,
      shipmentDocId: type==='shipment' ? id : null,
      orderId: linkedShip?.orderId || (type==='order' ? (state.data.orders.find(o=>o.id===id)?.orderId||null) : null),
      issueType: g('issueType'), status: g('status'), owner: g('owner').trim(),
      issueCategory: g('issueCategory') || null,
      severity: g('severity') || 'medium',
      impactType: g('impactType') || null,
      responsibleParty: g('responsibleParty') || null,
      targetResolutionDate: g('targetResolutionDate') ? new Date(g('targetResolutionDate')) : null,
      escalationLevel: Number(g('escalationLevel') || 0),
      escalatedTo: g('escalatedTo').trim() || null,
      resolutionCode: g('resolutionCode') || null,
      actionNotes: g('actionNotes').trim(),
      resolvedDate: g('resolvedDate')?new Date(g('resolvedDate')): (g('status')==='resolved'? new Date(): null),
      updatedAt: serverTimestamp(), updatedBy: state.officer?.code || ''
    };
    // Stamp who/when on resolution (only when transitioning to resolved and not already stamped).
    if (payload.status === 'resolved') {
      payload.resolvedAt = (existing && existing.resolvedAt) ? existing.resolvedAt : new Date();
      payload.resolvedBy = (existing && existing.resolvedBy) ? existing.resolvedBy : (state.officer?.code || '');
      if (!payload.resolvedDate) payload.resolvedDate = new Date();
    }
    try {
      if (issueId) await window.PXStore.updateRecord('issues', issueId, payload);
      else { payload.openedBy = state.officer?.code||''; payload.openedDate = serverTimestamp(); payload.archived = false; await window.PXStore.createRecord('issues', payload); }
      toast('Issue saved','success'); closeModalToDetail();
    } catch(e){ toast('Save failed: '+e.message,'danger'); }
  });
};
window.resolveIssue = async function(issueId){
  if (!can('issues','edit')) { toast('You can view issues, but you are not authorised to resolve them.', 'warn'); return; }
  try { await window.PXStore.updateRecord('issues', issueId, { status:'resolved', resolvedDate:new Date(), resolvedAt:new Date(), resolvedBy: state.officer?.code || '' }); toast('Issue resolved','success'); }
  catch(e){ toast('Failed: '+e.message,'danger'); }
};
window.deleteIssue = async function(issueId){
  archiveOperationalRecord('issues', issueId, 'Issue');
};

/* ============================ READINESS GATES (Feature 3) ============================
   Computes pass/fail completeness checks for the key lifecycle gates, reusing the
   document (expectedDocsFor), issue, milestone and workflow data already in state.
   Read-only. Exposed as window.PXReadiness + window.renderReadinessPanel. */
(function(){
  const PX = () => window.PXUtils;
  const st = () => window.__state;
  const dpresent = v => !!v;
  const docPresent = d => ['received','approved'].includes(d.status) || d.fileData || documentLinkOf(d);
  function docCoverage(context, record){
    const expected = (PX().expectedDocsFor ? PX().expectedDocsFor(context, record) : []) || [];
    const have = st().data.documents.filter(d => !d.archived && d.relatedType===context && d.relatedId===record.id && docPresent(d)).map(d=>d.documentType);
    const missing = expected.filter(e => !have.includes(e));
    return { expected, missing, ok: missing.length===0 };
  }
  const ordById = oid => st().data.orders.find(o => o.orderId===oid);
  const linkedShipments = order => st().data.shipments.filter(s=>!s.archived && s.orderId===order.orderId);
  const linkedPayments  = order => st().data.payments.filter(p=>!p.archived && p.orderId===order.orderId);
  const shipDone = s => s.completed === true || s.stage === 'completed' || /received|completed|closed/.test((s.status||'').toLowerCase());
  const criticalIssuesFor = ids => st().data.issues.filter(i => !i.archived && i.status==='open' && ['high','critical'].includes((i.severity||'').toLowerCase()) && ids.includes(i.relatedId));
  const result = (gate, gateLabel, checks) => ({ gate, gateLabel, checks, passed: checks.filter(c=>c.ok).length, total: checks.length, ready: checks.every(c=>c.ok) });

  function forOrderShipment(order){
    const checks = [
      { label:'PO sent to supplier', ok: dpresent(order.orderSentToSupplierDate), detail:'set the PO sent date' },
      { label:'Supplier acknowledgement', ok: dpresent(order.orderAcknowledgedDate), detail:'awaiting supplier acknowledgement' },
      { label:'Supplier, currency & amount set', ok: !!(order.supplier && order.currency && order.amount), detail:'complete the order basics' },
      { label:'Requested receipt date set', ok: dpresent(order.requestedReceiptDate), detail:'set requested receipt date' }
    ];
    const dc = docCoverage('order', order);
    checks.push({ label:'Order documents complete', ok: dc.ok, detail: dc.missing.length?`missing: ${dc.missing.join(', ')}`:'' });
    return result('order_shipment','Ready for shipment', checks);
  }
  function forShipmentReceipt(shipment){
    const dc = docCoverage('shipment', shipment);
    return result('shipment_receipt','Ready for clearance / receipt', [
      { label:'Logistics officer assigned', ok: !!shipment.logisticOfficer, detail:'assign a logistics officer' },
      { label:'Transport details available', ok: !!(shipment.vesselFlight || shipment.mode), detail:'add vessel/flight or transport mode' },
      { label:'ETA available', ok: dpresent(shipment.eta), detail:'set ETA' },
      { label:'Required documents received', ok: dc.ok, detail: dc.missing.length?`missing: ${dc.missing.join(', ')}`:'' }
    ]);
  }
  function forPaymentProcessing(payment){
    const order = ordById(payment.orderId);
    const milestoneBased = order && Array.isArray(order.milestones) && order.milestones.length>0;
    const dc = docCoverage('payment', payment);
    const checks = [
      { label:'Invoice number', ok: !!payment.invoiceNumber, detail:'enter supplier invoice number' },
      { label:'Amount set', ok: Number(payment.amount)>0, detail:'enter amount' },
      { label:'Linked to a PO', ok: !!payment.orderId, detail:'link to an order' }
    ];
    if (milestoneBased) checks.push({ label:'Linked to a milestone', ok: !!payment.milestoneId, detail:'link to a payment milestone' });
    checks.push({ label:'Approval obtained', ok: !!(payment.paymentApproved || ['approved','paid'].includes(payment.status)), detail:'requires payment approval' });
    checks.push({ label:'Payment documents complete', ok: dc.ok, detail: dc.missing.length?`missing: ${dc.missing.join(', ')}`:'' });
    return result('payment_processing','Ready for processing', checks);
  }
  function forOrderClosure(order){
    const needsShip = !PX().orderNeedsShipment || PX().orderNeedsShipment(order);
    const ships = linkedShipments(order);
    const pays = linkedPayments(order);
    const recordIds = [order.id, ...ships.map(s=>s.id), ...pays.map(p=>p.id)];
    const shipsOk = !needsShip || order.noShipment || (ships.length>0 && ships.every(shipDone));
    const shipsDetail = (!needsShip || order.noShipment) ? '' : (ships.length===0 ? 'no shipment recorded yet' : `${ships.filter(s=>!shipDone(s)).length} shipment(s) not completed`);
    const outstandingPays = pays.filter(p => !['paid','rejected'].includes(p.status));
    const unpaidMs = (Array.isArray(order.milestones)?order.milestones:[]).filter(m=>!m.paidDate).length;
    const paysOk = outstandingPays.length===0 && unpaidMs===0;
    const crit = criticalIssuesFor(recordIds);
    const odc = docCoverage('order', order);
    const sdcMissing = ships.reduce((n,s)=> n + docCoverage('shipment', s).missing.length, 0);
    const docsOk = odc.ok && sdcMissing===0;
    return result('order_closure','Ready for closure', [
      { label:'Shipments completed or not required', ok: !!shipsOk, detail: shipsDetail },
      { label:'Payments completed or closed', ok: paysOk, detail: paysOk?'':`${outstandingPays.length} open RFP(s)${unpaidMs?`, ${unpaidMs} unpaid milestone(s)`:''}` },
      { label:'No critical open issues', ok: crit.length===0, detail: crit.length?`${crit.length} critical/high issue(s) open`:'' },
      { label:'Required documents complete', ok: docsOk, detail: docsOk?'':`${odc.missing.length + sdcMissing} document(s) missing` }
    ]);
  }
  window.PXReadiness = { forOrderShipment, forShipmentReceipt, forPaymentProcessing, forOrderClosure };

  window.renderReadinessPanel = function(res, opts){
    opts = opts || {};
    if (!res) return '';
    const esc = PX().escapeHtml;
    const items = res.checks.map(c => `<li class="rd-item ${c.ok?'ok':'no'}"><span class="rd-ico">${c.ok?'✓':'✗'}</span><span>${esc(c.label)}${(!c.ok && c.detail)?` <span class="rd-detail">— ${esc(c.detail)}</span>`:''}</span></li>`).join('');
    return `<div class="rd-panel ${res.ready?'rd-ready':'rd-blocked'}">
      <div class="rd-head"><strong>${esc(opts.title||res.gateLabel)}</strong>
        <span class="badge ${res.ready?'success':'warn'}">${res.ready?'Ready':res.passed+'/'+res.total}</span></div>
      <ul class="rd-list">${items}</ul></div>`;
  };
})();

// Re-open the relevant detail after closing a sub-form (so user returns to context)
window.closeModalToDetail = function(){
  window.closeModal();
  if (currentDetail) {
    const { type, id } = currentDetail;
    setTimeout(() => {
      if (type === 'order' && window.openOrderDetail) window.openOrderDetail(id);
      else if (type === 'shipment' && window.openShipmentDetail) window.openShipmentDetail(id);
      else if (type === 'payment' && window.openPaymentDetail) window.openPaymentDetail(id);
      else if (type === 'supplier' && window.openSupplierDetail) window.openSupplierDetail(id);
    }, 80);
  }
};

// Expose section HTML builders for detail screens
window.renderDocumentsSection = documentsSectionHtml;
window.renderFollowupsSection = followupsSectionHtml;
window.renderIssuesSection = issuesSectionHtml;
window.__docExpiryInfo = docExpiryInfo;

/* ============================ RESIZABLE COLUMNS ============================
   Makes every <table class="data"> column drag-resizable. Widths persist in
   localStorage keyed by the table's column signature (header texts), so the same
   list keeps your widths across sessions. Re-runs safely after each view render. */
(function () {
  const LS_PREFIX = 'phoenix_colw_';
  function sigFor(table) {
    const ths = Array.from(table.querySelectorAll('thead th'));
    const txt = ths.map(th => (th.textContent || '').trim().slice(0, 12)).join('|');
    return LS_PREFIX + (txt ? hash(txt) : 'cols') + '_' + ths.length;
  }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; } return Math.abs(h).toString(36); }
  function loadWidths(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } }
  function saveWidths(key, arr) { try { localStorage.setItem(key, JSON.stringify(arr)); } catch (_) {} }

  function install(table) {
    if (table.__resizable) { applySaved(table); return; }
    table.__resizable = true;
    table.classList.add('resizable-cols');
    const ths = Array.from(table.querySelectorAll('thead th'));
    if (!ths.length) return;
    const key = sigFor(table);
    applySaved(table);
    ths.forEach((th, idx) => {
      if (idx === ths.length - 1) return; // don't add handle to the last (actions) column
      const handle = document.createElement('span');
      handle.className = 'col-resize-handle';
      th.appendChild(handle);
      let startX = 0, startW = 0;
      const onMove = (e) => {
        const dx = (e.touches ? e.touches[0].clientX : e.clientX) - startX;
        const w = Math.max(48, startW + dx);
        th.style.width = w + 'px'; th.style.minWidth = w + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        document.body.style.userSelect = '';
        // persist all widths
        const widths = Array.from(table.querySelectorAll('thead th')).map(h => h.style.width || '');
        saveWidths(key, widths);
      };
      const onDown = (e) => {
        e.preventDefault(); e.stopPropagation();
        startX = e.touches ? e.touches[0].clientX : e.clientX;
        startW = th.getBoundingClientRect().width;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        document.body.style.userSelect = 'none';
      };
      handle.addEventListener('mousedown', onDown);
      handle.addEventListener('touchstart', onDown, { passive: false });
      // Double-click handle resets that column to auto
      handle.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        th.style.width = ''; th.style.minWidth = '';
        const widths = Array.from(table.querySelectorAll('thead th')).map(h => h.style.width || '');
        saveWidths(key, widths);
      });
    });
  }
  function applySaved(table) {
    const ths = Array.from(table.querySelectorAll('thead th'));
    if (!ths.length) return;
    const saved = loadWidths(sigFor(table));
    if (saved && saved.length === ths.length) {
      ths.forEach((th, i) => { if (saved[i]) { th.style.width = saved[i]; th.style.minWidth = saved[i]; } });
    }
  }
  window.__installColumnResizers = function () {
    document.querySelectorAll('table.data').forEach(install);
  };
})();
