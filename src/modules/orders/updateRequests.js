/* updateRequests.js — Request For Update workflow.
   Used directly from Foreign/Local orders and Logistics Operations > Shipments. The
   workflow is entity-aware because each request stores the entity of the target
   record and the list screens already scope themselves via the sidebar entity. */
const { $, fmtDate, escapeHtml, recordEntity, toast, currentRole, can } = window.PXUtils;
const state = window.__state;

/* ============================================================
   PXUpdateRequests — engine (visibility / create / attend / SLA)
   ============================================================ */
(function () {
  const SLA_DAYS = 3; // officer should attend within 2-3 days; default target = +3 calendar days

  function roleKey() {
    return String(currentRole ? currentRole() : (state.officer?.role || 'admin'))
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
  }

  function canRequestUpdate(targetType) {
    const type = targetType === 'shipment' ? 'shipment' : 'order';
    const canViewTarget = type === 'shipment' ? can('shipments', 'view') : can('orders', 'view');
    const canCreateRequest = can('updateRequests', 'create');
    // Permission-based baseline: whoever can view the target and create update requests.
    if (!(canViewTarget && canCreateRequest)) return false;

    // Business rule: the SC Specialist and the Technical/Indirect Procurement Officers may
    // request updates on SHIPMENTS only — not on orders. (Their supervisors and managers
    // keep both.) Logistics/Demand officers are unaffected.
    const ORDER_REQUEST_EXCLUDED = new Set([
      'sc_officer',
      'procurement_technical_officer',
      'procurement_indirect_officer'
    ]);
    if (type === 'order' && ORDER_REQUEST_EXCLUDED.has(roleKey())) return false;

    return true;
  }

  function linkedOrderForShipment(shipment) {
    if (!shipment || !shipment.orderId) return null;
    return (state.data.orders || []).find(o => o.orderId === shipment.orderId) || null;
  }

  function assignedOfficersForOrder(order) {
    return [...new Set([order?.officerCode, order?.logisticOfficer].filter(Boolean))];
  }

  function assignedOfficersForShipment(shipment) {
    const linkedOrder = linkedOrderForShipment(shipment);
    return [...new Set([
      shipment?.logisticOfficer,
      linkedOrder?.logisticOfficer,
      linkedOrder?.officerCode
    ].filter(Boolean))];
  }

  function assignedOfficers(target) {
    if (!target) return [];
    return target.targetType === 'shipment'
      ? assignedOfficersForShipment(target.shipment)
      : assignedOfficersForOrder(target.order);
  }

  function requestTargetLabel(req) {
    const type = req?.targetType === 'shipment' ? 'shipment' : 'order';
    return type === 'shipment'
      ? (req.shipmentId || req.orderId || 'shipment')
      : (req.orderId || 'order');
  }

  function openForTarget(targetType, docId) {
    const type = targetType === 'shipment' ? 'shipment' : 'order';
    return (state.data.updateRequests || []).filter(r => {
      if (r.archived || r.status !== 'open') return false;
      const rt = r.targetType || 'order';
      return type === 'shipment'
        ? (rt === 'shipment' && r.shipmentDocId === docId)
        : (rt === 'order' && r.orderDocId === docId);
    });
  }

  function openFor(orderDocId) {
    return openForTarget('order', orderDocId);
  }

  function openForOfficer(code) {
    if (!code) return [];
    return (state.data.updateRequests || []).filter(r =>
      !r.archived && r.status === 'open' && Array.isArray(r.targetOfficers) && r.targetOfficers.includes(code));
  }

  function slaState(req) {
    if (!req || req.status !== 'open' || !req.dueDate) return 'open';
    const due = new Date(req.dueDate); due.setHours(23, 59, 59, 999);
    const now = new Date();
    const msLeft = due - now;
    if (msLeft < 0) return 'overdue';
    if (msLeft <= 86400000) return 'due-soon'; // within 1 day
    return 'on-track';
  }

  function resolveTarget(targetType, docId) {
    const type = targetType === 'shipment' ? 'shipment' : 'order';
    if (type === 'shipment') {
      const shipment = (state.data.shipments || []).find(x => x.id === docId);
      if (!shipment) return null;
      const order = linkedOrderForShipment(shipment);
      return { targetType: 'shipment', shipment, order };
    }
    const order = (state.data.orders || []).find(x => x.id === docId);
    return order ? { targetType: 'order', order } : null;
  }

  async function create({ targetType = 'order', order, shipment, message }) {
    const me = state.officer || {};
    const type = targetType === 'shipment' ? 'shipment' : 'order';
    const linkedOrder = order || (shipment ? linkedOrderForShipment(shipment) : null);
    const targetEntity = type === 'shipment'
      ? (shipment.entity || (linkedOrder ? recordEntity(linkedOrder) : 'Phoenix'))
      : recordEntity(linkedOrder);
    const due = new Date(); due.setDate(due.getDate() + SLA_DAYS);
    const target = { targetType: type, order: linkedOrder, shipment };
    const rec = {
      entity: targetEntity,
      targetType: type,
      orderId: linkedOrder?.orderId || shipment?.orderId || '',
      orderDocId: linkedOrder?.id || '',
      shipmentId: shipment?.shipmentId || '',
      shipmentDocId: shipment?.id || '',
      supplier: linkedOrder?.supplier || shipment?.supplier || '',
      message: (message || '').trim(),
      requestorCode: me.code || '',
      requestorName: me.fullName || me.code || 'Stakeholder',
      targetOfficers: assignedOfficers(target),
      status: 'open',
      dueDate: due.toISOString().slice(0, 10),
      createdAt: new Date().toISOString()
    };
    return window.PXStore.createRecord('updateRequests', rec, {
      log: { recordType: type, recordId: type === 'shipment' ? shipment?.id : linkedOrder?.id, action: 'update-requested',
             details: `Update requested by ${rec.requestorName}: ${rec.message.slice(0, 80)}` }
    });
  }

  async function attend(reqId, note) {
    const me = state.officer || {};
    const req = (state.data.updateRequests || []).find(r => r.id === reqId);
    const assigned = Array.isArray(req?.targetOfficers) && req.targetOfficers.includes(me.code || '');
    if (!can('updateRequests', 'edit') || (roleKey() !== 'admin' && !assigned)) {
      throw new Error('Not authorised to attend this update request.');
    }
    const type = req?.targetType === 'shipment' ? 'shipment' : 'order';
    return window.PXStore.updateRecord('updateRequests', reqId, {
      status: 'attended', attendedBy: me.code || '', attendedAt: new Date().toISOString(),
      attendNote: (note || '').trim()
    }, {
      log: { recordType: type, recordId: type === 'shipment' ? req?.shipmentDocId : req?.orderDocId, action: 'update-attended',
             details: `Update request attended by ${me.fullName || me.code || 'officer'}` }
    });
  }

  window.PXUpdateRequests = {
    assignedOfficers, assignedOfficersForOrder, assignedOfficersForShipment,
    openFor, openForTarget, openForOfficer, slaState, create, attend,
    canRequestUpdate, requestTargetLabel, resolveTarget, SLA_DAYS
  };

  // Sidebar / count hook: open requests routed to the current officer.
window.__updateRequestCount = function () {
    try { return openForOfficer((state.officer || {}).code).length; }
    catch (e) { return 0; }
  };
})();

window.renderUpdateRequestsSection = function (targetType, docId) {
  const type = targetType === 'shipment' ? 'shipment' : 'order';
  const list = (state.data.updateRequests || [])
    .filter(req => !req.archived && (type === 'shipment'
      ? req.targetType === 'shipment' && req.shipmentDocId === docId
      : (req.targetType || 'order') === 'order' && req.orderDocId === docId))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const rows = list.map(req => {
    const sla = window.PXUpdateRequests ? window.PXUpdateRequests.slaState(req) : 'open';
    const statusClass = req.status === 'attended' ? 'success' : (sla === 'overdue' ? 'danger' : 'warn');
    return `<tr>
      <td><span class="badge ${statusClass}">${escapeHtml(req.status || 'open')}</span></td>
      <td>${fmtDate(req.createdAt) || '-'}</td>
      <td>${fmtDate(req.dueDate) || '-'}</td>
      <td>${escapeHtml(req.requestorName || req.requestorCode || 'stakeholder')}</td>
      <td style="white-space:pre-wrap">${escapeHtml(req.message || '')}</td>
      <td>${req.attendedAt ? `${escapeHtml(req.attendedBy || '-')} · ${fmtDate(req.attendedAt)}` : '-'}</td>
      <td style="white-space:pre-wrap">${escapeHtml(req.attendNote || '')}</td>
    </tr>`;
  }).join('');
  return `<div class="op-section">
    <div class="op-head"><h3>Update Requests <span class="op-count">${list.length}</span></h3></div>
    ${list.length ? `<div class="table-wrap"><table class="data">
      <thead><tr><th>Status</th><th>Requested</th><th>Due</th><th>From</th><th>Request</th><th>Attended</th><th>Reply</th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<p class="op-empty">No update requests recorded.</p>'}
  </div>`;
};

/* ============================================================
   Request For Update — modal (raise) and attend
   ============================================================ */
window.openUpdateRequestModal = function (targetTypeOrOrderDocId, maybeDocId) {
  const targetType = maybeDocId ? targetTypeOrOrderDocId : 'order';
  const docId = maybeDocId || targetTypeOrOrderDocId;
  const target = window.PXUpdateRequests.resolveTarget(targetType, docId);
  if (!target) { toast(targetType === 'shipment' ? 'Shipment not found' : 'Order not found', 'danger'); return; }
  if (!window.PXUpdateRequests.canRequestUpdate(target.targetType)) {
    toast('You do not have access to request updates from this section.', 'warn');
    return;
  }

  const o = target.order;
  const s = target.shipment;
  const label = target.targetType === 'shipment'
    ? (s.shipmentId || s.orderId || 'Shipment')
    : (o.orderId || 'Order');
  const subtitle = target.targetType === 'shipment'
    ? `${s.orderId || ''} · ${s.supplier || o?.supplier || ''}`
    : (o.supplier || '');
  const officers = window.PXUpdateRequests.assignedOfficers(target);
  const officerNames = officers.map(code => {
    const off = state.data.officers.find(x => x.code === code);
    return off ? `${escapeHtml(off.fullName || off.code)} (${escapeHtml(code)})` : escapeHtml(code);
  });
  const existing = window.PXUpdateRequests.openForTarget(target.targetType, docId);

  window.openModal(`
    <div class="modal-head"><div><h2>Request an update — ${escapeHtml(label)}</h2>
      <div class="sub">${escapeHtml(subtitle)}</div></div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      ${officers.length
        ? `<div class="info-banner">This will notify the assigned officer${officers.length>1?'s':''}: <strong>${officerNames.join(', ')}</strong>. They should attend within ${window.PXUpdateRequests.SLA_DAYS} days. Your request stays visible to them until attended.</div>`
        : `<div class="info-banner" style="border-color:var(--warn,#e67e22);color:var(--warn,#e67e22)">No purchasing or logistics officer is assigned yet, so there is no one to notify. Please contact procurement/logistics directly.</div>`}
      ${existing.length ? `<div class="info-banner" style="border-color:var(--warn,#e67e22)">There ${existing.length===1?'is':'are'} already ${existing.length} open request${existing.length>1?'s':''} on this ${target.targetType}. You can still add another if it concerns something different.</div>` : ''}
      <form id="ur-form">
        <div class="field-group full"><label>What do you need? <span class="req">*</span></label>
          <textarea name="message" rows="4" placeholder="e.g. Please confirm the current shipment status and revised ETA for this PO." required></textarea>
        </div>
      </form>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="ur-send" ${officers.length ? '' : 'disabled'}>Send request</button></div>
  `);

  const btn = $('#ur-send');
  if (btn) btn.addEventListener('click', async () => {
    const msg = ($('#ur-form textarea[name="message"]').value || '').trim();
    if (!msg) { toast('Please describe what you need.', 'warn'); return; }
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending...';
    try {
      await window.PXUpdateRequests.create({ targetType: target.targetType, order: o, shipment: s, message: msg });
      window.closeModal();
      toast('Request sent to the assigned officer(s).', 'success');
      if (state.view && (state.view.startsWith('orders-') || state.view === 'shipments' || state.view === 'mywork')) {
        window.renderView(state.view);
      }
    } catch (e) {
      btn.disabled = false; btn.innerHTML = 'Send request';
      toast('Could not send the request.', 'danger');
    }
  });
};

window.openAttendRequestModal = function (reqId) {
  const req = state.data.updateRequests.find(r => r.id === reqId);
  if (!req) { toast('Request not found', 'danger'); return; }
  const meCode = (state.officer || {}).code || '';
  const assigned = Array.isArray(req.targetOfficers) && req.targetOfficers.includes(meCode);
  if (!can('updateRequests', 'edit') || (currentRole() !== 'admin' && !assigned)) {
    toast('Only the assigned officer or an administrator can mark this request as attended.', 'warn');
    return;
  }
  const type = req.targetType === 'shipment' ? 'shipment' : 'order';
  const label = window.PXUpdateRequests.requestTargetLabel(req);
  window.openModal(`
    <div class="modal-head"><div><h2>Attend update request — ${escapeHtml(label)}</h2>
      <div class="sub">From ${escapeHtml(req.requestorName || 'stakeholder')}</div></div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <div class="info-banner">Requested ${req.createdAt ? fmtDate(req.createdAt) : ''}${req.dueDate ? ` · due ${fmtDate(req.dueDate)}` : ''}</div>
      <p style="white-space:pre-wrap;padding:8px 12px;background:var(--surface-warm);border-radius:6px;border:1px solid var(--line)">${escapeHtml(req.message || '')}</p>
      <form id="attend-form">
        <div class="field-group full"><label>Reply / what you did <span class="text-xs text-muted">(optional, shared with the requestor)</span></label>
          <textarea name="note" rows="3" placeholder="e.g. ETA confirmed as 14 July; tracking shared by email."></textarea>
        </div>
      </form>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      ${type === 'shipment'
        ? `<button class="btn" onclick="openShipmentDetail('${req.shipmentDocId}')">Open shipment</button>`
        : `<button class="btn" onclick="openOrderDetail('${req.orderDocId}')">Open order</button>`}
      <button class="btn btn-primary" id="attend-send">Mark attended</button>
    </div>
  `);
  const btn = $('#attend-send');
  if (btn) btn.addEventListener('click', async () => {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving...';
    try {
      await window.PXUpdateRequests.attend(reqId, $('#attend-form textarea[name="note"]').value);
      window.closeModal();
      toast('Request marked attended.', 'success');
      if (state.view) window.renderView(state.view);
      if (window.__refreshDetailSections) window.__refreshDetailSections();
    } catch (e) {
      btn.disabled = false; btn.innerHTML = 'Mark attended';
      toast('Could not update the request.', 'danger');
    }
  });
};
