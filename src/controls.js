/* controls.js — Increment 5 engines (amendments / claims / delegation)
   Pure logic + render helpers + claim form handlers. Loaded after schema
   and before orders/officers/myWork so those modules can call the engines. */

/* ============================================================
   Increment 5a — Amendment Control (PXAmendments)
   ============================================================ */
(function () {
  const WATCHED = [
    { field: 'amount', label: 'Amount' },
    { field: 'currency', label: 'Currency' },
    { field: 'supplier', label: 'Supplier' },
    { field: 'description', label: 'Description' },
    { field: 'requestedReceiptDate', label: 'Requested Receipt Date' },
    { field: 'paymentTerms', label: 'Payment Terms' },
    { field: 'orderType', label: 'Order Type' },
    { field: 'function', label: 'Function' }
  ];

  function diff(existing, next, byCode) {
    if (!existing) return [];
    const now = new Date().toISOString();
    return WATCHED.filter(w => {
      const ov = existing[w.field] != null ? String(existing[w.field]) : '';
      const nv = next[w.field] != null ? String(next[w.field]) : '';
      return ov !== nv && (ov !== '' || nv !== '');
    }).map(w => ({
      id: `amd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      field: w.field, label: w.label,
      oldValue: existing[w.field] != null ? String(existing[w.field]) : '',
      newValue: next[w.field] != null ? String(next[w.field]) : '',
      reason: next.__amendmentReason || '',
      amendedBy: byCode || 'unknown', amendedAt: now
    }));
  }

  function merge(existingAmendments, newEntries) {
    return [...(Array.isArray(existingAmendments) ? existingAmendments : []), ...newEntries];
  }

  function renderHistory(amendments) {
    const esc = window.PXUtils ? window.PXUtils.escapeHtml : v => String(v || '');
    if (!amendments || !amendments.length)
      return '<p class="op-hint" style="padding:12px 0;color:var(--muted)">No amendments recorded for this order yet.</p>';
    const sorted = [...amendments].sort((a, b) => b.amendedAt.localeCompare(a.amendedAt));
    const rows = sorted.map(a => {
      const dt = a.amendedAt ? new Date(a.amendedAt).toLocaleString() : '—';
      return `<tr>
        <td>${esc(dt)}</td>
        <td>${esc(a.amendedBy || '?')}</td>
        <td><strong>${esc(a.label || a.field)}</strong></td>
        <td class="truncate" style="max-width:160px" title="${esc(a.oldValue)}"><span style="color:var(--danger,#c0392b);text-decoration:line-through">${esc(a.oldValue || '—')}</span></td>
        <td class="truncate" style="max-width:160px" title="${esc(a.newValue)}"><span style="color:var(--success,#27ae60)">${esc(a.newValue || '—')}</span></td>
        <td class="truncate">${esc(a.reason || '—')}</td>
      </tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="data">
      <thead><tr><th>When</th><th>By</th><th>Field</th><th>From</th><th>To</th><th>Reason</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  window.PXAmendments = { diff, merge, renderHistory, WATCHED };
})();

/* ============================================================
   Increment 5c — Claims (PXClaims)
   ============================================================ */
(function () {
  const TYPES = ['quality', 'quantity', 'damage', 'late_delivery', 'other'];
  const STATUSES = ['open', 'under_review', 'resolved', 'rejected'];
  const TYPE_LABELS = { quality: 'Quality', quantity: 'Quantity / Short', damage: 'Damage', late_delivery: 'Late Delivery', other: 'Other' };
  const STATUS_LABELS = { open: 'Open', under_review: 'Under Review', resolved: 'Resolved', rejected: 'Rejected' };
  const STATUS_CLS = { open: 'danger', under_review: 'warn', resolved: 'success', rejected: 'neutral' };

  function parseClaimAmount(value) {
    if (value == null || value === '') return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return undefined;
    return amount;
  }

  function newClaim(opts) {
    return {
      id: `clm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: opts.type || 'other', amount: parseClaimAmount(opts.amount), currency: opts.currency || 'MUR',
      status: 'open', raisedDate: opts.raisedDate || new Date().toISOString().slice(0, 10),
      resolvedDate: null, raisedBy: opts.raisedBy || '', assignedTo: opts.assignedTo || '', note: opts.note || ''
    };
  }

  function renderClaimsSection(order, editable) {
    const esc = window.PXUtils ? window.PXUtils.escapeHtml : v => String(v || '');
    const claims = Array.isArray(order.claims) ? order.claims : [];
    const open = claims.filter(c => c.status === 'open' || c.status === 'under_review').length;
    const totalValue = claims.reduce((a, c) => a + (Number(c.amount) || 0), 0);
    const rows = claims.length ? claims.map((c, idx) => {
      const badge = `<span class="badge ${STATUS_CLS[c.status] || 'neutral'}">${esc(STATUS_LABELS[c.status] || c.status)}</span>`;
      return `<tr>
        <td>${esc(TYPE_LABELS[c.type] || c.type)}</td>
        <td>${c.amount != null ? esc(String(c.amount)) + ' ' + esc(c.currency || 'MUR') : '<span class="text-muted">—</span>'}</td>
        <td>${badge}</td>
        <td>${c.raisedDate || '—'}</td>
        <td>${c.resolvedDate || '<span class="text-muted">—</span>'}</td>
        <td class="truncate">${esc(c.raisedBy || '—')}</td>
        <td class="truncate">${esc(c.note || '—')}</td>
        ${editable ? `<td><button class="btn btn-sm" onclick="window.__claimEdit('${esc(order.id)}',${idx})">Edit</button></td>` : ''}
      </tr>`;
    }).join('') : `<tr><td colspan="${editable ? 8 : 7}" class="text-muted" style="text-align:center;padding:12px">No claims raised for this order.</td></tr>`;

    return `
      ${open ? `<div class="info-banner" style="border-color:var(--danger,#c0392b);color:var(--danger,#c0392b)">${open} open claim${open > 1 ? 's' : ''} require attention${totalValue ? ` · Total value: MUR ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}.</div>` : ''}
      ${editable ? `<div style="margin-bottom:8px"><button class="btn btn-sm btn-primary" onclick="window.__claimNew('${esc(order.id)}')">+ Raise Claim</button></div>` : ''}
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Type</th><th>Value</th><th>Status</th><th>Raised</th><th>Resolved</th><th>By</th><th>Note</th>${editable ? '<th></th>' : ''}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  window.PXClaims = { newClaim, renderClaimsSection, TYPES, STATUSES, TYPE_LABELS, STATUS_LABELS };

  /* ---- claim new/edit modal handlers (rendered from order detail) ---- */
  window.__claimNew = function (orderId) {
    const o = (window.__state.data.orders || []).find(x => x.id === orderId);
    if (!o) return;
    const esc = window.PXUtils.escapeHtml;
    const officers = (window.__state.data.officers || []).filter(x => x.active !== false);
    window.openModal(`
      <div class="modal-head"><div><h2>Raise Claim — ${esc(o.orderId)}</h2></div>
        <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body"><form id="claim-form">
        <div class="form-grid cols-2">
          <div class="field-group"><label>Type <span class="req">*</span></label>
            <select name="type">${TYPES.map(t => `<option value="${t}">${TYPE_LABELS[t]}</option>`).join('')}</select></div>
          <div class="field-group"><label>Status</label>
            <select name="status">${STATUSES.map(s => `<option value="${s}">${STATUS_LABELS[s]}</option>`).join('')}</select></div>
          <div class="field-group"><label>Amount</label><input type="number" step="0.01" name="amount" placeholder="0.00" /></div>
          <div class="field-group"><label>Currency</label>
            <select name="currency">${['MUR', 'USD', 'EUR', 'GBP'].map(c => `<option value="${c}" ${c === 'MUR' ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div class="field-group"><label>Raised Date</label><input type="date" name="raisedDate" value="${new Date().toISOString().slice(0, 10)}" /></div>
          <div class="field-group"><label>Raised By</label>
            <select name="raisedBy"><option value="">— Select —</option>${officers.map(x => `<option value="${esc(x.code || '')}">${esc(x.fullName)} (${esc(x.code || '')})</option>`).join('')}</select></div>
          <div class="field-group"><label>Assigned To</label>
            <select name="assignedTo"><option value="">— Select —</option>${officers.map(x => `<option value="${esc(x.code || '')}">${esc(x.fullName)} (${esc(x.code || '')})</option>`).join('')}</select></div>
          <div class="field-group full"><label>Note</label><input type="text" name="note" maxlength="300" /></div>
        </div>
      </form></div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="save-claim">Raise Claim</button></div>
    `);
    const btn = document.getElementById('save-claim');
    if (btn) btn.addEventListener('click', async () => {
      const fd = new FormData(document.getElementById('claim-form'));
      const claim = newClaim({ type: fd.get('type'), amount: fd.get('amount') || null, currency: fd.get('currency'), raisedDate: fd.get('raisedDate'), raisedBy: fd.get('raisedBy'), assignedTo: fd.get('assignedTo'), note: fd.get('note') });
      if (claim.amount === undefined) {
        window.PXUtils.toast('Claim amount cannot be negative.', 'danger');
        return;
      }
      claim.status = fd.get('status') || 'open';
      const existing = Array.isArray(o.claims) ? o.claims : [];
      await window.PXStore.updateRecord('orders', orderId, { claims: [...existing, claim] });
      window.closeModal();
      if (window.openOrderDetail) setTimeout(() => window.openOrderDetail(orderId), 100);
    });
  };

  window.__claimEdit = function (orderId, idx) {
    const o = (window.__state.data.orders || []).find(x => x.id === orderId);
    if (!o || !Array.isArray(o.claims) || !o.claims[idx]) return;
    const c = o.claims[idx];
    const esc = window.PXUtils.escapeHtml;
    const officers = (window.__state.data.officers || []).filter(x => x.active !== false);
    window.openModal(`
      <div class="modal-head"><div><h2>Edit Claim — ${esc(o.orderId)}</h2></div>
        <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body"><form id="claim-edit-form">
        <div class="form-grid cols-2">
          <div class="field-group"><label>Type</label>
            <select name="type">${TYPES.map(t => `<option value="${t}" ${c.type === t ? 'selected' : ''}>${TYPE_LABELS[t]}</option>`).join('')}</select></div>
          <div class="field-group"><label>Status</label>
            <select name="status">${STATUSES.map(s => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select></div>
          <div class="field-group"><label>Amount</label><input type="number" step="0.01" name="amount" value="${c.amount || ''}" /></div>
          <div class="field-group"><label>Currency</label>
            <select name="currency">${['MUR', 'USD', 'EUR', 'GBP'].map(cur => `<option value="${cur}" ${c.currency === cur ? 'selected' : ''}>${cur}</option>`).join('')}</select></div>
          <div class="field-group"><label>Raised Date</label><input type="date" name="raisedDate" value="${c.raisedDate || ''}" /></div>
          <div class="field-group"><label>Resolved Date</label><input type="date" name="resolvedDate" value="${c.resolvedDate || ''}" /></div>
          <div class="field-group"><label>Raised By</label>
            <select name="raisedBy"><option value="">—</option>${officers.map(x => `<option value="${esc(x.code || '')}" ${c.raisedBy === x.code ? 'selected' : ''}>${esc(x.fullName)} (${esc(x.code || '')})</option>`).join('')}</select></div>
          <div class="field-group"><label>Assigned To</label>
            <select name="assignedTo"><option value="">—</option>${officers.map(x => `<option value="${esc(x.code || '')}" ${c.assignedTo === x.code ? 'selected' : ''}>${esc(x.fullName)} (${esc(x.code || '')})</option>`).join('')}</select></div>
          <div class="field-group full"><label>Note</label><input type="text" name="note" value="${esc(c.note || '')}" maxlength="300" /></div>
        </div>
      </form></div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="save-claim-edit">Save</button></div>
    `);
    const btn = document.getElementById('save-claim-edit');
    if (btn) btn.addEventListener('click', async () => {
      const fd = new FormData(document.getElementById('claim-edit-form'));
      const amount = parseClaimAmount(fd.get('amount'));
      if (amount === undefined) {
        window.PXUtils.toast('Claim amount cannot be negative.', 'danger');
        return;
      }
      const updated = { ...c, type: fd.get('type'), status: fd.get('status'), amount, currency: fd.get('currency'), raisedDate: fd.get('raisedDate'), resolvedDate: fd.get('resolvedDate') || null, raisedBy: fd.get('raisedBy'), assignedTo: fd.get('assignedTo'), note: fd.get('note') };
      const claims = [...o.claims]; claims[idx] = updated;
      await window.PXStore.updateRecord('orders', orderId, { claims });
      window.closeModal();
      if (window.openOrderDetail) setTimeout(() => window.openOrderDetail(orderId), 100);
    });
  };
})();

/* ============================================================
   Increment 5d — Delegation (PXDelegation)
   ============================================================ */
(function () {
  function activeFor(code) {
    const st = window.__state;
    if (!st || !code) return null;
    const officer = (st.data.officers || []).find(o => o.code === code);
    if (!officer || !officer.delegateToCode) return null;
    if (!officer.delegateUntil) return null;
    const until = new Date(officer.delegateUntil); until.setHours(23, 59, 59, 999);
    if (new Date() > until) return null;
    return { delegateTo: officer.delegateToCode, reason: officer.delegateReason || '' };
  }
  function delegatedTo(code) {
    const st = window.__state;
    if (!st || !code) return [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return (st.data.officers || [])
      .filter(o => o.delegateToCode === code && o.delegateUntil && new Date(o.delegateUntil) >= today)
      .map(o => ({ fromCode: o.code, fromName: o.fullName, until: o.delegateUntil, reason: o.delegateReason || '' }));
  }
  window.PXDelegation = { activeFor, delegatedTo };
})();
