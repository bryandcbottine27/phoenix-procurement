/* exports.js — Outbound / Exports module (logistics-owned).
   Tracks goods sent OUT: samples, returns to supplier, and round-trip items sent for
   repair / refurbishment / calibration that come back. Distinct from inbound shipments
   and deliberately kept out of inbound OTIF. Round-trip items carry an expected return
   date and are flagged overdue if not back in time; the key metric is TURNAROUND
   (dispatch → received back). Logistics create/edit; procurement, supply chain and
   stakeholders can view. */
(function () {
  const U = window.PXUtils;
  const state = window.__state;

  function E() { return U.currentEntity(); }
  const toDate = v => { if (!v) return null; if (v.toDate) { try { return v.toDate(); } catch (_) { return null; } } const d = new Date(v); return isNaN(d) ? null : d; };
  const daysBetween = (a, b) => { const da = toDate(a), db = toDate(b); if (!da || !db) return null; return Math.round((db - da) / 86400000); };

  function forEntity() {
    return (state.data.exports || []).filter(x => !x.archived && (U.recordEntity(x) === E()));
  }
  function isRoundTrip(x) { return x.tripType === 'round_trip'; }
  function statusList(x) {
    return isRoundTrip(x) ? REF.exportStatusesRoundTrip : REF.exportStatusesOneWay;
  }
  // An export is "out" (awaiting return) if round-trip, dispatched, and not yet received back / closed.
  function isOut(x) {
    if (!isRoundTrip(x)) return false;
    if (['Received back', 'Closed', 'Cancelled'].includes(x.status)) return false;
    return !!x.dispatchDate && !x.receivedBackDate;
  }
  function isOverdue(x) {
    if (!isOut(x)) return false;
    const exp = toDate(x.expectedReturnDate);
    return exp && exp < new Date();
  }
  // Turnaround in days: dispatch → received back (round-trip) or dispatch → delivered (one-way).
  function turnaround(x) {
    if (isRoundTrip(x)) return (x.dispatchDate && x.receivedBackDate) ? daysBetween(x.dispatchDate, x.receivedBackDate) : null;
    return (x.dispatchDate && x.deliveredDate) ? daysBetween(x.dispatchDate, x.deliveredDate) : null;
  }
  function reasonLabel(key) { const r = (REF.exportReasons || []).find(r => r.key === key); return r ? r.label : (key || '—'); }

  // Metrics for the current entity: counts + average turnaround by reason.
  function metrics() {
    const rows = forEntity();
    const out = rows.filter(isOut);
    const overdue = rows.filter(isOverdue);
    const openOneWay = rows.filter(x => !isRoundTrip(x) && !['Delivered', 'Closed', 'Cancelled'].includes(x.status));
    // avg turnaround by reason (completed round-trips)
    const byReason = {};
    rows.forEach(x => {
      const t = turnaround(x);
      if (t == null || t < 0) return;
      const k = x.reason || 'other';
      (byReason[k] = byReason[k] || []).push(t);
    });
    const turnaroundByReason = Object.keys(byReason).map(k => ({
      reason: k, label: reasonLabel(k), count: byReason[k].length,
      avg: Math.round(byReason[k].reduce((a, b) => a + b, 0) / byReason[k].length)
    })).sort((a, b) => b.avg - a.avg);
    return { total: rows.length, out: out.length, overdue: overdue.length, openOneWay: openOneWay.length, turnaroundByReason };
  }

  window.PXExports = { forEntity, isRoundTrip, statusList, isOut, isOverdue, turnaround, reasonLabel, metrics };

  /* ---------------- next reference ---------------- */
  function nextExportRef() {
    const year = new Date().getFullYear();
    const prefix = `EXP-${year}-`;
    const nums = (state.data.exports || [])
      .map(x => String(x.exportRef || ''))
      .filter(r => r.startsWith(prefix))
      .map(r => parseInt(r.slice(prefix.length), 10))
      .filter(n => !isNaN(n));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return prefix + String(next).padStart(4, '0');
  }

  /* ---------------- VIEW ---------------- */
  window.__renderers = window.__renderers || {};
  window.__renderers['exports'] = function () {
    const el = document.getElementById('view-exports');
    if (!el) return;
    const can = U.can;
    const rows = forEntity();
    const m = metrics();
    const canCreate = can('exports', 'create');

    const esc = U.escapeHtml;
    const badge = s => `<span class="badge ${exportStatusBadge(s)}">${esc(s || '—')}</span>`;

    const metricCards = `
      <div class="metric-grid" style="margin-bottom:16px">
        <div class="metric"><div class="label">Total exports</div><div class="value">${m.total}</div></div>
        <div class="metric ${m.out ? '' : ''}"><div class="label">Currently out (round-trip)</div><div class="value">${m.out}</div></div>
        <div class="metric ${m.overdue ? 'danger' : 'success'}"><div class="label">Overdue returns</div><div class="value">${m.overdue}</div></div>
        <div class="metric"><div class="label">Open one-way</div><div class="value">${m.openOneWay}</div></div>
      </div>`;

    const turnaroundPanel = m.turnaroundByReason.length ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h3>Average turnaround by reason (days out → back)</h3></div>
        <table class="data-table"><thead><tr><th>Reason</th><th class="num">Completed</th><th class="num">Avg days</th></tr></thead>
        <tbody>${m.turnaroundByReason.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${r.count}</td><td class="num">${r.avg}</td></tr>`).join('')}</tbody></table>
      </div>` : '';

    const listRows = rows.slice().sort((a, b) => (toDate(b.dispatchDate) || 0) - (toDate(a.dispatchDate) || 0)).map(x => {
      const over = isOverdue(x);
      const t = turnaround(x);
      return `<tr class="clickable-row" onclick="window.__openExportDetail('${x.id}')">
        <td><strong>${esc(x.exportRef || '—')}</strong>${over ? ' <span class="badge danger" style="font-size:10px">OVERDUE</span>' : ''}</td>
        <td>${esc(x.itemDescription || '—')}</td>
        <td><span class="badge neutral" style="font-size:10.5px">${isRoundTrip(x) ? 'Round-trip' : 'One-way'}</span></td>
        <td>${esc(reasonLabel(x.reason))}</td>
        <td>${esc(x.destination || '—')}</td>
        <td>${esc(x.mode || '—')}</td>
        <td>${badge(x.status)}</td>
        <td>${U.fmtDate(x.dispatchDate) || '—'}</td>
        <td>${isRoundTrip(x) ? (U.fmtDate(x.expectedReturnDate) || '—') : '—'}</td>
        <td class="num">${t != null ? t + 'd' : '—'}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div class="page-head">
        <div class="title"><h1>Exports / Outbound</h1>
          <span class="desc">Logistics-owned outbound movements — samples, returns, repair / calibration round-trips. Not part of inbound OTIF.</span></div>
        <div class="page-actions">${canCreate ? `<button class="btn btn-primary" onclick="window.__openExportForm()">+ New Export</button>` : ''}</div>
      </div>
      ${metricCards}
      ${turnaroundPanel}
      <div class="card">
        <div class="card-head"><h3>All exports (${rows.length})</h3></div>
        ${rows.length ? `<table class="data-table"><thead><tr>
          <th>Ref</th><th>Item</th><th>Trip</th><th>Reason</th><th>Destination</th><th>Mode</th><th>Status</th><th>Dispatched</th><th>Exp. return</th><th class="num">Turnaround</th>
        </tr></thead><tbody>${listRows}</tbody></table>`
        : `<div class="empty-state"><h3>No exports yet</h3><p>${canCreate ? 'Create the first outbound movement with “+ New Export”.' : 'Logistics will record outbound movements here.'}</p></div>`}
      </div>`;
  };

  function exportStatusBadge(s) {
    s = String(s || '').toLowerCase();
    if (s === 'closed' || s === 'received back') return 'success';
    if (s === 'cancelled') return 'danger';
    if (s === 'delivered') return 'info';
    if (s.includes('transit')) return 'primary';
    if (s === 'dispatched') return 'accent';
    return 'neutral';
  }

  /* ---------------- FORM ---------------- */
  window.__openExportForm = function (exportId) {
    const can = U.can;
    const isEdit = !!exportId;
    if (!isEdit && !can('exports', 'create')) { U.toast('You can view exports, but you are not authorised to create one.', 'warn'); return; }
    if (isEdit && !can('exports', 'edit')) { U.toast('You can view exports, but you are not authorised to edit them.', 'warn'); return; }
    const x = isEdit ? (state.data.exports || []).find(e => e.id === exportId) || {} : {};
    const esc = U.escapeHtml;
    const officers = (state.data.officers || []).filter(o => o.active !== false);
    const reasonOpts = (REF.exportReasons || []).map(r => `<option value="${r.key}" data-trip="${r.trip}" ${x.reason === r.key ? 'selected' : ''}>${esc(r.label)}</option>`).join('');
    const modeOpts = (REF.exportModes || []).map(mo => `<option ${x.mode === mo ? 'selected' : ''}>${mo}</option>`).join('');
    const trip = x.tripType || 'one_way';
    const statuses = (trip === 'round_trip' ? REF.exportStatusesRoundTrip : REF.exportStatusesOneWay);
    const statusOpts = statuses.map(s => `<option ${x.status === s ? 'selected' : ''}>${s}</option>`).join('');
    const orderOpts = ['<option value="">— none —</option>'].concat(
      (state.data.orders || []).filter(o => !o.archived && U.recordEntity(o) === E())
        .slice(0, 400)
        .map(o => `<option value="${esc(o.orderId)}" ${x.linkedOrderId === o.orderId ? 'selected' : ''}>${esc(o.orderId)} — ${esc((o.description || '').slice(0, 40))}</option>`)
    ).join('');

    window.openModal(`
      <div class="modal-head"><div><h2>${isEdit ? 'Edit' : 'New'} Export</h2>
        <div class="sub">${isEdit ? esc(x.exportRef || '') : 'Outbound movement — ' + esc(E())}</div></div>
        <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div class="op-hint" style="margin-bottom:12px">Round-trip reasons (repair, refurbishment, calibration) track the return leg and turnaround; set an <strong>expected return date</strong> so overdue returns are flagged. A SharePoint link is recommended for export documents.</div>
        <div class="form-grid cols-2">
          <div class="field-group"><label>Trip Type</label>
            <select name="tripType" id="exp-trip">
              <option value="one_way" ${trip === 'one_way' ? 'selected' : ''}>One-way (sample / return / scrap)</option>
              <option value="round_trip" ${trip === 'round_trip' ? 'selected' : ''}>Round-trip (repair / refurbishment / calibration)</option>
            </select></div>
          <div class="field-group"><label>Reason</label><select name="reason" id="exp-reason">${reasonOpts}</select></div>
          <div class="field-group full"><label>Item description</label><input type="text" name="itemDescription" value="${esc(x.itemDescription || '')}" placeholder="e.g. Endress+Hauser flow meter, S/N 12345" /></div>
          <div class="field-group"><label>Quantity</label><input type="text" name="quantity" value="${esc(x.quantity || '')}" /></div>
          <div class="field-group"><label>Transport mode</label><select name="mode">${modeOpts}</select></div>
          <div class="field-group"><label>Carrier / courier</label><input type="text" name="carrier" value="${esc(x.carrier || '')}" placeholder="DHL, Emirates SkyCargo…" /></div>
          <div class="field-group"><label>Tracking / AWB</label><input type="text" name="trackingRef" value="${esc(x.trackingRef || '')}" /></div>
          <div class="field-group"><label>Destination (vendor)</label><input type="text" name="destination" value="${esc(x.destination || '')}" /></div>
          <div class="field-group"><label>Destination country</label><input type="text" name="destinationCountry" value="${esc(x.destinationCountry || '')}" /></div>
          <div class="field-group"><label>Linked PO / order <span style="text-transform:none;font-weight:400;color:var(--muted-soft)">(optional; typical for round-trip)</span></label>
            <select name="linkedOrderId">${orderOpts}</select></div>
          <div class="field-group"><label>Project ref (if no PO)</label><input type="text" name="projectRef" value="${esc(x.projectRef || '')}" /></div>
          <div class="field-group"><label>Status</label><select name="status" id="exp-status">${statusOpts}</select></div>
          <div class="field-group"><label>Logistics officer</label>
            <select name="logisticOfficer"><option value="">—</option>${officers.map(o => `<option value="${esc(o.code)}" ${x.logisticOfficer === o.code ? 'selected' : ''}>${esc(o.fullName || o.code)}</option>`).join('')}</select></div>
          <div class="field-group"><label>Dispatch date</label><input type="date" name="dispatchDate" value="${U.fmtDateISO(x.dispatchDate)}" /></div>
          <div class="field-group"><label>Delivered to vendor</label><input type="date" name="deliveredDate" value="${U.fmtDateISO(x.deliveredDate)}" /></div>
          <div class="field-group exp-rt"><label>Expected return</label><input type="date" name="expectedReturnDate" value="${U.fmtDateISO(x.expectedReturnDate)}" /></div>
          <div class="field-group exp-rt"><label>Return dispatched</label><input type="date" name="returnDispatchDate" value="${U.fmtDateISO(x.returnDispatchDate)}" /></div>
          <div class="field-group exp-rt"><label>Received back</label><input type="date" name="receivedBackDate" value="${U.fmtDateISO(x.receivedBackDate)}" /></div>
          <div class="field-group"><label>Declared value</label><input type="number" step="0.01" name="value" value="${x.value != null ? x.value : ''}" /></div>
          <div class="field-group"><label>Currency</label><input type="text" name="currency" value="${esc(x.currency || '')}" placeholder="EUR" /></div>
          <div class="field-group full"><label>Document link (SharePoint / OneDrive)</label><input type="text" name="documentUrl" value="${esc(x.documentUrl || '')}" placeholder="https://phoenixbev.sharepoint.com/..." /></div>
          <div class="field-group full"><label>Notes</label><textarea name="notes" rows="2">${esc(x.notes || '')}</textarea></div>
        </div>
      </div>
      <div class="modal-foot">
        ${isEdit && can('exports', 'archive') ? `<button class="btn btn-ghost" onclick="window.__archiveExport('${x.id}')">Archive</button>` : '<span></span>'}
        <div><button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="exp-save">${isEdit ? 'Save' : 'Create export'}</button></div>
      </div>`);

    // Toggle round-trip fields + status list when trip type changes
    const tripSel = document.getElementById('exp-trip');
    const reasonSel = document.getElementById('exp-reason');
    const statusSel = document.getElementById('exp-status');
    const applyTripUi = () => {
      const rt = tripSel.value === 'round_trip';
      document.querySelectorAll('.exp-rt').forEach(n => n.style.display = rt ? '' : 'none');
      const list = rt ? REF.exportStatusesRoundTrip : REF.exportStatusesOneWay;
      const cur = statusSel.value;
      statusSel.innerHTML = list.map(s => `<option ${cur === s ? 'selected' : ''}>${s}</option>`).join('');
    };
    // When reason changes, default the trip type to the reason's natural trip
    reasonSel.addEventListener('change', () => {
      const opt = reasonSel.selectedOptions[0];
      const t = opt && opt.getAttribute('data-trip');
      if (t) { tripSel.value = t; applyTripUi(); }
    });
    tripSel.addEventListener('change', applyTripUi);
    applyTripUi();

    document.getElementById('exp-save').addEventListener('click', async () => {
      const g = n => { const el = document.querySelector(`[name="${n}"]`); return el ? el.value : ''; };
      const dv = n => { const v = g(n); return v ? new Date(v) : null; };
      const payload = {
        entity: isEdit ? (x.entity || E()) : E(),
        exportRef: isEdit ? x.exportRef : nextExportRef(),
        tripType: g('tripType'), reason: g('reason'), mode: g('mode'),
        carrier: g('carrier').trim(), trackingRef: g('trackingRef').trim(),
        destination: g('destination').trim(), destinationCountry: g('destinationCountry').trim(),
        itemDescription: g('itemDescription').trim(), quantity: g('quantity').trim(),
        linkedOrderId: g('linkedOrderId') || null, projectRef: g('projectRef').trim() || null,
        status: g('status'),
        dispatchDate: dv('dispatchDate'), deliveredDate: dv('deliveredDate'),
        expectedReturnDate: dv('expectedReturnDate'), returnDispatchDate: dv('returnDispatchDate'),
        receivedBackDate: dv('receivedBackDate'),
        value: g('value') !== '' ? Number(g('value')) : null, currency: g('currency').trim() || null,
        logisticOfficer: g('logisticOfficer') || null,
        documentUrl: g('documentUrl').trim() || null, notes: g('notes').trim() || null,
        updatedBy: state.officer?.code || '', updatedAt: new Date().toISOString()
      };
      try {
        if (isEdit) {
          await window.PXStore.updateRecord('exports', x.id, payload, { skipValidation: true });
          U.toast('Export updated', 'success');
        } else {
          payload.createdBy = state.officer?.code || ''; payload.createdAt = new Date().toISOString();
          await window.PXStore.createRecord('exports', payload, { skipValidation: true });
          U.toast(`Export ${payload.exportRef} created`, 'success');
        }
        window.closeModal();
      } catch (e) { U.toast('Save failed: ' + (e.message || e), 'danger'); }
    });
  };

  window.__archiveExport = async function (id) {
    if (!U.can('exports', 'archive')) { U.toast('Not authorised to archive exports.', 'warn'); return; }
    if (!confirm('Archive this export record? It will be hidden from the list.')) return;
    try { await window.PXStore.updateRecord('exports', id, { archived: true, updatedAt: new Date().toISOString() }, { skipValidation: true }); U.toast('Export archived', 'success'); window.closeModal(); }
    catch (e) { U.toast('Archive failed: ' + (e.message || e), 'danger'); }
  };

  /* ---------------- DETAIL ---------------- */
  window.__openExportDetail = function (id) {
    const x = (state.data.exports || []).find(e => e.id === id);
    if (!x) return;
    const esc = U.escapeHtml, can = U.can;
    const rt = isRoundTrip(x);
    const t = turnaround(x);
    const linkedOrder = x.linkedOrderId ? (state.data.orders || []).find(o => o.orderId === x.linkedOrderId) : null;
    const row = (k, v) => `<dt>${k}</dt><dd>${v || '<span class="empty">—</span>'}</dd>`;
    window.openModal(`
      <div class="modal-head"><div><h2>${esc(x.exportRef || 'Export')}</h2>
        <div class="sub">${rt ? 'Round-trip' : 'One-way'} · ${esc(reasonLabel(x.reason))} · ${esc(x.status || '')}${isOverdue(x) ? ' · <span style="color:var(--danger)">RETURN OVERDUE</span>' : ''}</div></div>
        <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <dl class="detail-grid">
          ${row('Item', esc(x.itemDescription))}
          ${row('Quantity', esc(x.quantity))}
          ${row('Destination', esc(x.destination) + (x.destinationCountry ? ', ' + esc(x.destinationCountry) : ''))}
          ${row('Mode / carrier', esc(x.mode) + (x.carrier ? ' · ' + esc(x.carrier) : ''))}
          ${row('Tracking', esc(x.trackingRef))}
          ${row('Linked PO', linkedOrder ? esc(linkedOrder.orderId) : (x.projectRef ? esc(x.projectRef) + ' (project)' : ''))}
          ${row('Logistics officer', esc(x.logisticOfficer))}
          ${row('Dispatched', U.fmtDate(x.dispatchDate))}
          ${row('Delivered to vendor', U.fmtDate(x.deliveredDate))}
          ${rt ? row('Expected return', U.fmtDate(x.expectedReturnDate)) : ''}
          ${rt ? row('Return dispatched', U.fmtDate(x.returnDispatchDate)) : ''}
          ${rt ? row('Received back', U.fmtDate(x.receivedBackDate)) : ''}
          ${row('Turnaround', t != null ? t + ' days' : '')}
          ${row('Declared value', x.value != null ? U.fmtMoney(x.value, x.currency || '') : '')}
          ${x.documentUrl ? row('Documents', `<a href="${esc(x.documentUrl)}" target="_blank" rel="noopener">open link ↗</a>`) : ''}
          ${row('Notes', esc(x.notes))}
        </dl>
      </div>
      <div class="modal-foot"><span></span><div>
        <button class="btn" onclick="closeModal()">Close</button>
        ${can('exports', 'edit') ? `<button class="btn btn-primary" onclick="window.__openExportForm('${x.id}')">Edit</button>` : ''}
      </div></div>`);
  };

  // sidebar count: overdue returns (attention badge)
  window.__exportsOverdueCount = function () {
    try { return forEntity().filter(isOverdue).length; } catch (_) { return 0; }
  };
})();
