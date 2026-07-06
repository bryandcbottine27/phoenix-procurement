/* contactLog.js — supplier communication log (the chase memory).
   A timestamped record of every contact on an order/shipment: when, direction,
   channel, who, what was said, and when a reply is expected. This is the follow-up
   app's memory of the relationship — status tells you WHERE an order is, the contact
   log tells you the CONVERSATION that got it there.

   Logging a chase also stamps the order's lastSupplierFollowupDate (read by the
   procurementFollowup chase engine), so the contact log and chase planning stay in
   sync. Auto-chase prompts (in My Work) read responseExpectedBy + last contact age. */
const { $, $$, fmtDate, escapeHtml, recordEntity, toast, can } = window.PXUtils;
const state = window.__state;
const REF = window.REF;

const CHANNELS = ['Email', 'Phone', 'Teams', 'Supplier portal', 'Meeting', 'WhatsApp', 'Other'];

/* ============================================================
   PXContactLog — engine
   ============================================================ */
(function () {
  function entriesForOrder(orderDocId) {
    if (!orderDocId) return [];
    return (state.data.contactLog || [])
      .filter(e => !e.archived && e.orderDocId === orderDocId)
      .sort((a, b) => String(b.contactDate || b.createdAt || '').localeCompare(String(a.contactDate || a.createdAt || '')));
  }
  function entriesForOrderId(orderId) {
    if (!orderId) return [];
    return (state.data.contactLog || [])
      .filter(e => !e.archived && e.orderId === orderId)
      .sort((a, b) => String(b.contactDate || b.createdAt || '').localeCompare(String(a.contactDate || a.createdAt || '')));
  }

  // Most recent contact date (any direction) for an order.
  function lastContactDate(order) {
    const list = entriesForOrder(order.id);
    return list.length ? (list[0].contactDate || list[0].createdAt || null) : null;
  }

  // Days since last contact (calendar), or null if never contacted.
  function daysSinceContact(order) {
    const d = lastContactDate(order);
    if (!d) return null;
    const then = new Date(d); if (isNaN(then)) return null;
    return Math.floor((Date.now() - then.getTime()) / 86400000);
  }

  // Open "awaiting reply" entries whose responseExpectedBy has passed.
  function overdueReplies(order) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return entriesForOrder(order.id).filter(e => {
      if (e.direction !== 'outbound' || !e.responseExpectedBy) return false;
      const due = new Date(e.responseExpectedBy);
      return !isNaN(due) && due < today;
    });
  }

  async function add(entry) {
    const permissionResource = entry.relatedType === 'shipment' ? 'shipments' : 'orders';
    if (!can(permissionResource, 'edit')) throw new Error('Not authorised to log contact for this record.');
    const me = state.officer || {};
    const rec = {
      entity: entry.entity,
      relatedType: entry.relatedType || 'order',
      orderId: entry.orderId || '',
      orderDocId: entry.orderDocId || null,
      shipmentId: entry.shipmentId || null,
      supplier: entry.supplier || '',
      contactDate: entry.contactDate || new Date().toISOString().slice(0, 10),
      direction: entry.direction || 'outbound',
      channel: entry.channel || 'Email',
      contactPerson: (entry.contactPerson || '').trim(),
      summary: (entry.summary || '').trim(),
      responseExpectedBy: entry.responseExpectedBy || null,
      officerCode: me.code || '',
      officerName: me.fullName || me.code || '',
      createdAt: new Date().toISOString()
    };
    const saved = await window.PXStore.createRecord('contactLog', rec, {
      permissionResource,
      permissionAction: 'edit',
      log: { recordType: rec.relatedType, recordId: rec.orderDocId || rec.shipmentId || rec.orderId,
             action: 'contact-logged', details: `${rec.direction} ${rec.channel}: ${rec.summary.slice(0, 80)}` }
    });
    // Keep the chase engine in sync: an outbound contact updates last-followup date,
    // and a forward-looking response date seeds the next chase if none is set.
    if (rec.relatedType === 'order' && rec.orderDocId) {
      const patch = { lastSupplierFollowupDate: rec.contactDate };
      const order = (state.data.orders || []).find(o => o.id === rec.orderDocId);
      if (rec.responseExpectedBy && order && !order.nextSupplierFollowupDate) {
        patch.nextSupplierFollowupDate = rec.responseExpectedBy;
      }
      try { await window.PXStore.updateRecord('orders', rec.orderDocId, patch, { skipValidation: true }); }
      catch (e) { /* non-fatal: the log entry itself is saved */ }
    }
    return saved;
  }

  window.PXContactLog = { entriesForOrder, entriesForOrderId, lastContactDate, daysSinceContact, overdueReplies, add, CHANNELS };
})();

/* ============================================================
   Log-a-chase modal
   ============================================================ */
window.openContactLogModal = function (recordDocId, opts) {
  opts = opts || {};
  // Permission (defense in depth — the buttons are also hidden by role): logging a
  // supplier contact is an operational write, gated like follow-ups. Read-only roles
  // (e.g. stakeholder, finance) may see the log but not add to it.
  if (window.PXUtils && window.PXUtils.can && !window.PXUtils.can('followups', 'create')) {
    window.PXUtils.toast('You can view the contact log, but you are not authorised to add entries.', 'warn');
    return;
  }
  const relatedType = opts.relatedType || 'order';
  let rec, ent, orderId, shipmentId = null, supplierName;
  if (relatedType === 'shipment') {
    rec = state.data.shipments.find(x => x.id === recordDocId);
    if (!rec) { toast('Shipment not found', 'danger'); return; }
    const linkedOrder = (state.data.orders || []).find(o => o.orderId === rec.orderId);
    ent = linkedOrder ? recordEntity(linkedOrder) : (rec.entity || 'Phoenix');
    orderId = rec.orderId || '';
    shipmentId = rec.shipmentId || rec.id;
    supplierName = rec.supplier || '';
  } else {
    rec = state.data.orders.find(x => x.id === recordDocId);
    if (!rec) { toast('Order not found', 'danger'); return; }
    ent = recordEntity(rec);
    orderId = rec.orderId || '';
    supplierName = rec.supplier || '';
  }
  const permissionResource = relatedType === 'shipment' ? 'shipments' : 'orders';
  if (!can(permissionResource, 'edit')) {
    toast('You can view this record, but you are not authorised to log contacts.', 'warn');
    return;
  }
  const o = rec;
  // Supplier contacts for the quick-pick, if the supplier master has them.
  const supplier = (state.data.suppliers || []).find(s => recordEntity(s) === ent &&
    (s.id === o.supplierId || String(s.name || '').trim().toLowerCase() === String(supplierName || '').trim().toLowerCase()));
  const contacts = (supplier && Array.isArray(supplier.contacts)) ? supplier.contacts.filter(c => c.active !== false) : [];
  const today = new Date().toISOString().slice(0, 10);
  const headRef = relatedType === 'shipment' ? (shipmentId || orderId) : orderId;

  window.openModal(`
    <div class="modal-head"><div><h2>Log a contact — ${escapeHtml(headRef || 'Record')}</h2>
      <div class="sub">${escapeHtml(supplierName || '')}</div></div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <form id="cl-form">
        <div class="form-grid">
          <div class="field-group"><label>Date <span class="req">*</span></label>
            <input type="date" name="contactDate" value="${today}" required /></div>
          <div class="field-group"><label>Direction <span class="req">*</span></label>
            <select name="direction">
              <option value="outbound">We contacted them</option>
              <option value="inbound">They responded to us</option>
            </select></div>
          <div class="field-group"><label>Channel</label>
            <select name="channel">${window.PXContactLog.CHANNELS.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select></div>
          <div class="field-group"><label>Contact person</label>
            ${contacts.length
              ? `<input name="contactPerson" list="cl-contacts" placeholder="Name…" />
                 <datalist id="cl-contacts">${contacts.map(c => `<option value="${escapeHtml(c.name || '')}">${escapeHtml([c.role, c.email].filter(Boolean).join(' · '))}</option>`).join('')}</datalist>`
              : `<input name="contactPerson" placeholder="Name…" />`}
          </div>
          <div class="field-group full"><label>Summary <span class="req">*</span></label>
            <textarea name="summary" rows="3" placeholder="What was said / asked / agreed…" required></textarea></div>
          <div class="field-group"><label>Response expected by <span class="text-xs text-muted">(optional)</span></label>
            <input type="date" name="responseExpectedBy" /></div>
        </div>
      </form>
      ${relatedType === 'order' ? '<div class="info-banner text-sm">Logging an outbound contact updates this order\'s last-follow-up date. If you set a "response expected by" date and no next chase is planned, it becomes the next chase date.</div>' : ''}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="cl-save">Save contact</button></div>
  `);

  const btn = $('#cl-save');
  if (btn) btn.addEventListener('click', async () => {
    const fd = new FormData($('#cl-form'));
    const summary = (fd.get('summary') || '').trim();
    if (!summary) { toast('Please enter a short summary.', 'warn'); return; }
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving…';
    try {
      await window.PXContactLog.add({
        entity: ent, relatedType, orderId,
        orderDocId: relatedType === 'order' ? o.id : null,
        shipmentId, supplier: supplierName,
        contactDate: fd.get('contactDate') || today,
        direction: fd.get('direction') || 'outbound',
        channel: fd.get('channel') || 'Email',
        contactPerson: fd.get('contactPerson') || '',
        summary,
        responseExpectedBy: fd.get('responseExpectedBy') || null
      });
      window.closeModal();
      toast('Contact logged.', 'success');
      if (window.__refreshDetailSections) window.__refreshDetailSections();
      if (state.view === 'mywork') window.__renderers['mywork']();
      if (opts.onDone) opts.onDone();
    } catch (e) {
      btn.disabled = false; btn.innerHTML = 'Save contact';
      toast('Could not save the contact.', 'danger');
    }
  });
};

/* ============================================================
   Timeline renderer (for the order detail)
   ============================================================ */
window.renderContactLogTimeline = function (orderDocId) {
  const list = window.PXContactLog.entriesForOrder(orderDocId);
  if (!list.length) {
    return `<p class="op-hint text-sm text-muted">No contacts logged yet. Use "Log contact" to start the conversation history.</p>`;
  }
  const dirBadge = d => d === 'inbound'
    ? '<span class="badge info" style="font-size:10px">← reply</span>'
    : '<span class="badge accent" style="font-size:10px">→ sent</span>';
  return `<div class="contact-timeline">${list.map(e => {
    const overdue = e.direction === 'outbound' && e.responseExpectedBy &&
      new Date(e.responseExpectedBy) < new Date(new Date().toDateString());
    return `
      <div class="ctl-entry">
        <div class="ctl-dot"></div>
        <div class="ctl-body">
          <div class="ctl-head">
            ${dirBadge(e.direction)}
            <span class="ctl-date mono">${fmtDate(e.contactDate)}</span>
            <span class="text-xs text-muted">${escapeHtml(e.channel || '')}${e.contactPerson ? ' · ' + escapeHtml(e.contactPerson) : ''}</span>
            ${e.officerName ? `<span class="text-xs text-muted">· by ${escapeHtml(e.officerName)}</span>` : ''}
          </div>
          <div class="ctl-summary">${escapeHtml(e.summary || '')}</div>
          ${e.responseExpectedBy ? `<div class="text-xs ${overdue ? 'text-danger' : 'text-muted'}">Reply expected by ${fmtDate(e.responseExpectedBy)}${overdue ? ' · overdue' : ''}</div>` : ''}
        </div>
      </div>`;
  }).join('')}</div>`;
};
