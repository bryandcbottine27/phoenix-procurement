const { $, $$, fmtDate, fmtDateISO, fmtMoney, escapeHtml, statusBadgeClass, daysBetween,
  collection, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, toast,
  generateMilestonesFromTerm, computeMilestoneDate, milestoneStatus,
  orderFunction, functionForCategory, orderNeedsShipment, canEditOrders, canEditShipments,
  checkOrderDuplicates, orderDataQuality, orderHealth, buildOrderTimeline,
  isErpOrder, fieldEditable, erpFieldClass, erpSourceOf, erpBadgeFor, renderErpBadge,
  orderHasLines, orderLineSum, stripUndefined,
  currentEntity, recordEntity, entityMeta, makeShipmentSequenceId, shipmentBelongsToOrder, shipmentFollowupActionOpen } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;

const calcOrderMTTO = window.__ord_calcOrderMTTO, calcOrderOTIF = window.__ord_calcOrderOTIF;

function linkedShipmentsForDetail(order) {
  if (!order || !order.orderId) return [];
  return (state.data.shipments || []).filter(s => !s.archived &&
    shipmentBelongsToOrder(s, order));
}

function shipmentByReceipt(order, receipt) {
  if (!receipt || !receipt.shipmentId) return null;
  return linkedShipmentsForDetail(order).find(s =>
    String(receipt.shipmentId) === String(s.id || '') || String(receipt.shipmentId) === String(s.shipmentId || '')) || null;
}

function grnStatusBadge(status) {
  const key = String(status || 'fully received').toLowerCase();
  const cls = key === 'cancelled' ? 'neutral' : (key === 'pending' ? 'accent' : (key === 'partially received' ? 'warn' : 'success'));
  return `<span class="badge ${cls}" style="font-size:10.5px">${escapeHtml(status || 'fully received')}</span>`;
}

function grnScopeKey(order, shipmentId) {
  return ('grn_' + (order?.id || order?.orderId || 'order') + '_' + (shipmentId || 'all')).replace(/[^a-zA-Z0-9_]/g, '_');
}

function canEditGrns() {
  return canEditOrders() || canEditShipments();
}

function renderOrderGrnsSection(order, opts = {}) {
  const rc = window.PXReceiptControl;
  const allShipments = linkedShipmentsForDetail(order);
  const scopeShipment = opts.shipmentId ? allShipments.find(s => String(s.id) === String(opts.shipmentId) || String(s.shipmentId) === String(opts.shipmentId)) : null;
  const receipts = scopeShipment && rc ? rc.shipmentGrns(order, scopeShipment) : (Array.isArray(order.receipts) ? order.receipts : []);
  const activeCount = rc ? receipts.filter(rc.grnCountsAsReceipt).length : receipts.length;
  const scopeKey = grnScopeKey(order, opts.shipmentId || '');
  const editable = canEditGrns();
  const rows = receipts.length ? receipts.map(receipt => {
    const ship = shipmentByReceipt(order, receipt);
    const shipLabel = ship ? (ship.shipmentId || ship.id) : (receipt.shipmentId ? receipt.shipmentId : 'Order-level');
    return `<tr>
      <td class="mono">${escapeHtml(receipt.grnRef || receipt.grnNumber || '—')}</td>
      <td>${fmtDate(receipt.grnDate || receipt.actualReceiptDate) || '—'}</td>
      <td>${escapeHtml(shipLabel)}</td>
      <td>${grnStatusBadge(receipt.status)}</td>
      <td>${escapeHtml(receipt.notes || '—')}</td>
      <td>${editable ? `<button class="btn btn-sm btn-ghost" onclick="event.stopPropagation(); __removeOrderGrn('${order.id}','${escapeHtml(receipt.receiptId || '')}','${scopeKey}','${scopeShipment ? escapeHtml(scopeShipment.id) : ''}')">Remove</button>` : ''}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="6" class="text-muted">No GRN recorded yet.</td></tr>`;
  const shipOptions = ['<option value="">Order-level GRN</option>'].concat(allShipments.map(s => `<option value="${escapeHtml(s.id)}" ${(scopeShipment && s.id === scopeShipment.id) ? 'selected' : ''}>${escapeHtml(s.shipmentId || s.orderId || s.id)}</option>`)).join('');
  return `
    <div class="card" style="padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px">
        <div>
          <h3 style="margin:0">${scopeShipment ? 'Shipment GRNs' : 'GRN Control'}</h3>
          <div class="text-xs text-muted">${activeCount} active GRN(s)${scopeShipment ? ` linked to ${escapeHtml(scopeShipment.shipmentId || scopeShipment.id)}` : ' recorded on this order'}</div>
        </div>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>GRN Number</th><th>GRN Date</th><th>Linked Shipment</th><th>Status</th><th>Remarks</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${editable ? `
        <div class="section-divider" style="margin-top:16px">Add GRN</div>
        <div class="form-grid cols-3">
          <div class="field-group"><label>GRN Number</label><input type="text" id="${scopeKey}-ref" placeholder="e.g. GRN12345" /></div>
          <div class="field-group"><label>GRN Date</label><input type="date" id="${scopeKey}-date" /></div>
          <div class="field-group"><label>Linked Shipment</label><select id="${scopeKey}-shipment" ${scopeShipment ? 'disabled' : ''}>${shipOptions}</select></div>
          <div class="field-group"><label>Status</label><select id="${scopeKey}-status">${(REF.grnStatuses || ['pending','partially received','fully received','cancelled']).map(s => `<option value="${escapeHtml(s)}" ${s === 'fully received' ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select></div>
          <div class="field-group full"><label>Remarks / notes</label><input type="text" id="${scopeKey}-notes" placeholder="Optional notes" /></div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); __saveOrderGrn('${order.id}','${scopeShipment ? escapeHtml(scopeShipment.id) : ''}','${scopeKey}')">Add GRN</button>
        <div class="text-xs text-muted mt-8">GRNs are kept on the order. If linked to a shipment, the shipment summary is updated for lists, KPIs and reports.</div>
      ` : '<div class="text-xs text-muted mt-16">GRNs are view-only for your role.</div>'}
    </div>`;
}

window.renderOrderGrnsSection = renderOrderGrnsSection;

window.openOrderDetail = function(orderId) {
  const o = state.data.orders.find(x => x.id === orderId);
  if (!o) { toast('Order not found', 'danger'); return; }
  const officer = state.data.officers.find(off => off.code === o.officerCode);
  const linkedShipments = linkedShipmentsForDetail(o);
  const linkedPayments = state.data.payments.filter(p => p.orderId === o.orderId);
  // Only logistics + admin can edit shipments or add partial shipments.
  // Procurement officers can request the first shipment and view details.
  const canEditShip = canEditShipments();
  const canOperateOrders = canEditOrders();
  const canLogOrderContact = canOperateOrders;
  const canRequestShipmentFromOrder = canOperateOrders;
  const canCreatePayments = !!(window.PXUtils && window.PXUtils.can && window.PXUtils.can('payments', 'create'));
  const canRequestOrderUpdate = !!(window.PXUpdateRequests && window.PXUpdateRequests.canRequestUpdate('order'));
  const canRequestShipmentUpdate = !!(window.PXUpdateRequests && window.PXUpdateRequests.canRequestUpdate('shipment'));
  const hasShipments = linkedShipments.length > 0;
  const defaultShipmentRequired = orderNeedsShipment(o);
  const shipmentTabVisible = defaultShipmentRequired || hasShipments || (!o.noShipment && canOperateOrders);
  const shipmentActionBadge = s => {
    if (!s.followupAction || s.followupAction === 'No action') return '—';
    return shipmentFollowupActionOpen(s)
      ? `<span class="badge warn" style="font-size:10px">${escapeHtml(s.followupAction)}</span>`
      : `<span class="badge success" style="font-size:10px">${escapeHtml(s.followupAction)} processed</span>`;
  };
  const supplierLinkLabel = {
    vendorNo: 'linked by vendor code',
    name: 'linked by vendor name',
    alias: 'linked by supplier alias',
    manual: 'manually linked'
  }[o.supplierMatchMethod] || '';
  const supplierLink = o.supplierId
    ? `<span class="badge success" style="font-size:10px">${escapeHtml(supplierLinkLabel || 'supplier linked')}</span>`
    : (o.supplierMatchMethod === 'unmatched' ? '<span class="badge warn" style="font-size:10px">supplier mapping needed</span>' : '');

  window.__cardContext = {
    type: 'order', record: o, linkedPayments, linkedShipments,
    caps: {
      edit: canEditOrders(),
      requestUpdate: canRequestOrderUpdate,
      logContact: canLogOrderContact,
      createPayment: canCreatePayments
    }
  };
  window.openModal(`
    <div class="modal-head">
      <div>
        <h2>${escapeHtml(o.orderId || 'Order')} ${(() => { const m = entityMeta(recordEntity(o)); return `<span class="entity-badge" style="background:${m.accent};color:#fff">${m.short}</span>`; })()} ${isErpOrder(o) ? renderErpBadge(o) : ''}${(Array.isArray(o.lastRefreshChanges) && o.lastRefreshChanges.length) ? `<span class="badge warn" style="font-size:10px;margin-left:4px" title="${escapeHtml(o.lastRefreshChanges.map(ch => `${ch.label}: ${ch.old ?? '—'} → ${ch.new ?? '—'}`).join(' · '))}">↻ Updated on last refresh</span>` : ''}</h2>
        <div class="sub">${escapeHtml(o.orderType === 'foreign' ? 'Foreign Order' : 'Local Order')} · ${escapeHtml(o.supplier || '')}${isErpOrder(o) && o.erpLastSyncedAt ? ' · synced ' + fmtDate(o.erpLastSyncedAt) : ''}</div>
      </div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="detail-tabs">
        <div class="detail-tab active" data-tab="info">Information</div>
        <div class="detail-tab" data-tab="lines">PO Lines${orderHasLines(o) ? ` (${o.lines.length})` : ''}</div>
        ${shipmentTabVisible ? `<div class="detail-tab" data-tab="shipments">Shipments (${linkedShipments.length})</div>` : ''}
        <div class="detail-tab" data-tab="grns">GRNs (${(o.receipts || []).length})</div>
        <div class="detail-tab" data-tab="payments">Payments ${(() => {
          const totalRfp = linkedPayments.length;
          const paidRfp = linkedPayments.filter(p => p.status === 'paid').length;
          return `(${totalRfp} RFP${totalRfp === 1 ? '' : ''} / ${paidRfp} paid)`;
        })()}</div>
        <div class="detail-tab" data-tab="timeline">Timeline</div>
        <div class="detail-tab" data-tab="financial">Financial</div>
        <div class="detail-tab" data-tab="documents">Documents</div>
        <div class="detail-tab" data-tab="followups">Follow-up</div>
        <div class="detail-tab" data-tab="amendments">Amendments${Array.isArray(o.amendments) && o.amendments.length ? ` (${o.amendments.length})` : ''}</div>
        <div class="detail-tab" data-tab="claims">Claims${Array.isArray(o.claims) && o.claims.filter(c => c.status === 'open' || c.status === 'under_review').length ? ` <span class="badge danger" style="font-size:10px;padding:1px 5px">${o.claims.filter(c => c.status === 'open' || c.status === 'under_review').length}</span>` : ''}</div>
      </div>
      <div id="tab-info">
        <div class="status-bar">
          <span class="badge ${statusBadgeClass(o.status)}" style="font-size:12px;padding:4px 10px">${escapeHtml(o.status || 'No status')}</span>
          ${o.isClosed ? '<span class="badge success">Closed</span>' : '<span class="badge primary">Open</span>'}
          ${window.PXProcFollowup ? window.PXProcFollowup.riskBadge(o) : ''}
          ${window.PXProcFollowup ? window.PXProcFollowup.ageingBadge(o) : ''}
          ${(() => {
            const mtto = calcOrderMTTO(o);
            return mtto !== null ? `<span class="badge ${mtto > 5 ? 'warn' : 'success'}" style="font-size:12px;padding:4px 10px">MTTO ${mtto}d</span>` : '';
          })()}
          ${(() => {
            if (!defaultShipmentRequired && !hasShipments && !(o.receipts || []).length) return '';
            const otif = calcOrderOTIF(o, state.data.shipments);
            if (otif.status === 'na') return '';
            const cls = otif.status === 'on_time' ? 'success' : (otif.status === 'late' ? 'danger' : 'accent');
            return `<span class="badge ${cls}" style="font-size:12px;padding:4px 10px">OTIF: ${otif.label}</span>`;
          })()}
        </div>
        ${(() => {
          const health = orderHealth(o, state.data.shipments, state.data.payments);
          const dq = orderDataQuality(o, window.PXUtils.dataQualityContext ? window.PXUtils.dataQualityContext() : {});
          const allIssues = [...health.issues, ...dq];
          // de-dupe by message
          const seen = new Set();
          const issues = allIssues.filter(i => { if (seen.has(i.msg)) return false; seen.add(i.msg); return true; });
          const chips = `
            <div class="health-chips">
              ${shipmentTabVisible ? `<span class="health-chip">🚢 <strong>${health.shipments}</strong> shipment(s)</span>` : ''}
              <span class="health-chip">💰 <strong>${health.payments}</strong> RFP(s)</span>
              ${(o.milestones && o.milestones.length) ? `<span class="health-chip">📋 <strong>${health.unpaidMilestones}</strong> unpaid milestone(s)</span>` : ''}
              ${health.overduePayments ? `<span class="health-chip" style="border-color:var(--danger)">⚠ <strong>${health.overduePayments}</strong> overdue payment(s)</span>` : ''}
            </div>`;
          const issueList = issues.length ? `
            <div class="card" style="margin-bottom:14px;padding:12px 14px;background:var(--surface-warm)">
              <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Health &amp; data checks</div>
              <ul class="dq-list">
                ${issues.map(i => `<li class="dq-item ${i.level}"><span class="dq-dot"></span><span>${escapeHtml(i.msg)}</span></li>`).join('')}
              </ul>
            </div>` : '';
          return chips + issueList;
        })()}
        ${isErpOrder(o) ? `
          <div class="card" style="margin-bottom:14px;padding:12px 14px;border-left:3px solid #2b5d8a;background:#f5f9fd">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <div style="font-size:11px;color:#2b5d8a;text-transform:uppercase;letter-spacing:0.05em;font-weight:700">ERP Link</div>
              ${renderErpBadge(o)}
            </div>
            <dl class="kv-grid" style="grid-template-columns:130px 1fr 130px 1fr;font-size:12px;gap:4px 14px">
              <dt>ERP Source</dt><dd>${escapeHtml(erpSourceOf(o))}</dd>
              <dt>Company</dt><dd>${escapeHtml(o.erpCompany || '—')}</dd>
              <dt>Vendor No.</dt><dd class="mono">${escapeHtml(o.erpVendorNo || '—')}</dd>
              <dt>ERP Order No.</dt><dd class="mono">${escapeHtml(o.erpOrderNo || '—')}</dd>
              <dt>System ID</dt><dd class="mono">${escapeHtml(o.erpSystemId || '—')}</dd>
              <dt>Last Synced</dt><dd>${o.erpLastSyncedAt ? fmtDate(o.erpLastSyncedAt) : '—'}</dd>
              <dt>Sync Status</dt><dd>${escapeHtml(o.erpSyncStatus || 'synced')}</dd>
              <dt>Integration Layer</dt><dd>${escapeHtml(o.integrationLayer || '—')}</dd>
              <dt>Warehouse Source</dt><dd>${escapeHtml(o.warehouseSource || '—')}</dd>
              <dt>Warehouse Batch</dt><dd class="mono">${escapeHtml(o.warehouseBatchId || '—')}</dd>
              <dt>Warehouse Loaded</dt><dd>${o.warehouseLoadedAt ? fmtDate(o.warehouseLoadedAt) : '—'}</dd>
              ${o.erpSyncError ? `<dt>Sync Error</dt><dd style="color:var(--danger)">${escapeHtml(o.erpSyncError)}</dd>` : ''}
            </dl>
            ${window.PXProcFollowup && window.PXProcFollowup.erpExceptions(o).length ? `
              <div style="margin-top:10px;padding-top:8px;border-top:1px solid #d6e6f3">
                ${window.PXProcFollowup.erpExceptions(o).map(e => `<div class="dq-item ${e.level}" style="margin:4px 0"><span class="dq-dot"></span><span>${escapeHtml(e.msg)}</span></div>`).join('')}
              </div>
            ` : ''}
            <div style="font-size:11.5px;color:#2b5d8a;margin-top:8px;padding-top:8px;border-top:1px solid #d6e6f3">
              ⛓ ERP data is read-only here. Operational follow-up is managed in Phoenix.
            </div>
          </div>
        ` : ''}
        ${(() => {
          // Business Central detail fields (Seychelles / Edena). Shown only when at least
          // one is populated, so Phoenix orders don't display an empty BC card.
          const bc = [
            ['Amount Incl. VAT', o.amountInclVat != null ? fmtMoney(o.amountInclVat, o.currency) : null],
            ['Due Date', o.paymentDueDate ? fmtDate(o.paymentDueDate) : null],
            ['Location Code', o.locationCode], ['Department Code', o.departmentCode],
            ['Logistic Status', o.logisticStatus],
            ['Received Not Invoiced', o.amountReceivedNotInvoiced != null ? fmtMoney(o.amountReceivedNotInvoiced, o.currency) : null]
          ].filter(([, v]) => v != null && v !== '');
          if (!bc.length) return '';
          return `<div class="info-card">
            <h3>Business Central details</h3>
            <dl class="kv-grid" style="grid-template-columns:150px 1fr 150px 1fr;font-size:12px;gap:4px 14px;padding:12px 14px">
              ${bc.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd${/Amount|Received/.test(k) ? ' class="mono"' : ''}>${escapeHtml(String(v))}</dd>`).join('')}
            </dl>
          </div>`;
        })()}
        ${orderHasLines(o) ? (() => {
          const sum = orderLineSum(o);
          const matches = o.amount != null && Math.abs(sum - Number(o.amount)) < 0.01;
          // Received / outstanding % by units across all lines
          let ordered = 0, received = 0;
          o.lines.forEach(l => {
            const q = Number(l.quantity);
            if (!isNaN(q)) {
              ordered += q;
              const r = (l.receivedQuantity != null) ? Number(l.receivedQuantity)
                      : (l.outstandingQuantity != null) ? (q - Number(l.outstandingQuantity)) : 0;
              received += isNaN(r) ? 0 : Math.max(0, Math.min(q, r));
            }
          });
          const recvPct = ordered > 0 ? Math.round((received / ordered) * 100) : 0;
          const outPct = ordered > 0 ? 100 - recvPct : 0;
          return `
          <div class="card" style="margin-bottom:14px;padding:12px 14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;font-weight:700">PO Lines (${o.lines.length})</div>
              ${o.amount != null ? `<span class="po-line-match ${matches?'ok':'diff'}">${matches?'✓ lines match order amount':'⚠ lines ≠ order amount'}</span>` : ''}
            </div>
            <div class="po-summary">
              <div class="po-stat">
                <div class="po-stat-label">Total Amount</div>
                <div class="po-stat-value">${fmtMoney(o.amount, o.currency)}</div>
              </div>
              <div class="po-stat">
                <div class="po-stat-label">Received</div>
                <div class="po-stat-value">${recvPct}%</div>
              </div>
              <div class="po-stat">
                <div class="po-stat-label">Outstanding</div>
                <div class="po-stat-value" style="${outPct>0?'color:var(--warn)':''}">${outPct}%</div>
              </div>
            </div>
            <div class="text-xs text-muted" style="margin-top:10px">⛓ Line-level detail is maintained in the ERP. Phoenix shows this summary for operational follow-up.</div>
          </div>`;
        })() : ''}
        ${window.PXReadiness ? `<div class="rd-row">
          ${defaultShipmentRequired && !o.isClosed ? window.renderReadinessPanel(window.PXReadiness.forOrderShipment(o)) : ''}
          ${window.renderReadinessPanel(window.PXReadiness.forOrderClosure(o))}
        </div>` : ''}
        <div class="info-cards">
          ${window.PXProcFollowup ? (() => {
            const pf = window.PXProcFollowup;
            const risk = pf.riskScore(o);
            const age = pf.ageingBucket(o);
            const c = pf.commitment(o);
            const chase = pf.nextChase(o);
            const activity = pf.lastActivity(o);
            const activityAge = activity ? (window.PXUtils.workingDaysSince ? window.PXUtils.workingDaysSince(activity.date, recordEntity(o)) : daysBetween(activity.date, new Date())) : null;
            return `
          <div class="info-card full proc-followup-card">
            <h4>Procurement Follow-Up</h4>
            <div class="followup-summary-grid">
              <div>
                <div class="stk-label">Risk</div>
                <div class="stk-val">${pf.riskBadge(o)}</div>
              </div>
              <div>
                <div class="stk-label">Ageing Stage</div>
                <div class="stk-val">${pf.ageingBadge(o)}</div>
              </div>
              <div>
                <div class="stk-label">Next Chase</div>
                <div class="stk-val ${chase.overdue ? 'text-danger' : ''}">${chase.next ? fmtDate(chase.next) : '—'}${chase.method ? ' · ' + escapeHtml(chase.method) : ''}</div>
              </div>
              <div>
                <div class="stk-label">Supplier Commitment</div>
                <div class="stk-val ${c.overdue ? 'text-danger' : ''}">${c.current ? fmtDate(c.current) : '—'}${c.revisions ? ' · ' + c.revisions + ' revision(s)' : ''}</div>
              </div>
              <div>
                <div class="stk-label">Last Activity</div>
                <div class="stk-val">${activity ? escapeHtml(activity.label) + ' · ' + fmtDate(activity.date) + (activityAge !== null ? ' · ' + activityAge + ' wd ago' : '') : '—'}</div>
              </div>
              <div>
                <div class="stk-label">Escalation</div>
                <div class="stk-val">${escapeHtml(o.escalationOwner || '—')}${o.escalationDate ? ' · ' + fmtDate(o.escalationDate) : ''}${o.escalationLevel ? ' · L' + escapeHtml(o.escalationLevel) : ''}</div>
              </div>
            </div>
            ${risk.reasons.length ? `<ul class="dq-list" style="margin-top:10px">${risk.reasons.map(msg => `<li class="dq-item ${risk.level === 'critical' ? 'danger' : risk.level === 'high' ? 'warn' : 'info'}"><span class="dq-dot"></span><span>${escapeHtml(msg)}</span></li>`).join('')}</ul>` : '<div class="text-xs text-muted" style="margin-top:8px">No major procurement follow-up risk detected.</div>'}
            ${(o.supplierDelayReason || o.supplierReplySummary) ? `<div class="text-sm" style="margin-top:10px;white-space:pre-wrap">${escapeHtml([o.supplierDelayReason, o.supplierReplySummary].filter(Boolean).join('\\n'))}</div>` : ''}
          </div>`;
          })() : ''}
          <div class="info-card">
            <h4>Order Information</h4>
            <dl class="kv-grid">
              <dt>Supplier</dt><dd>${escapeHtml(o.supplier || '—')} ${supplierLink}</dd>
              <dt>Description</dt><dd style="white-space:pre-wrap">${escapeHtml(o.description || '—')}</dd>
              <dt>Category</dt><dd>${escapeHtml(o.category || '—')}${o.noShipment ? ' <span class="badge neutral" style="font-size:10px">no shipment</span>' : ''}</dd>
              ${o.orderType === 'foreign' ? `<dt>Incoterm</dt><dd>${escapeHtml(o.incoterm || o.erpShipmentMethod || '—')}</dd>` : ''}
              <dt>Officer</dt><dd>${escapeHtml(officer?.fullName || o.officerCode || '—')}</dd>
              <dt>Claimant</dt><dd>${escapeHtml(o.claimant || '—')}</dd>
              <dt>${(window.__iprLabel ? window.__iprLabel(o) : 'IPR No.').replace(' No.', ' Number')}</dt><dd class="mono">${escapeHtml(o.iprNumber || '—')}</dd>
              <dt>IPR HOD Approved</dt><dd>${fmtDate(o.iprApprovedDate) || '<span class="empty">—</span>'}</dd>
            </dl>
          </div>
          <div class="info-card">
            <h4>Key Dates</h4>
            <dl class="kv-grid">
              <dt>Date of Order</dt><dd>${fmtDate(o.dateOfOrder) || '<span class="empty">—</span>'}</dd>
              <dt>Date Requested</dt><dd>${fmtDate(o.dateRequestedByDept) || '<span class="empty">—</span>'}</dd>
              <dt>Requested Receipt</dt><dd>${fmtDate(o.requestedReceiptDate) || '<span class="empty">—</span>'}</dd>
              <dt>Order Sent to Supplier</dt><dd>${fmtDate(o.orderSentToSupplierDate) || '<span class="empty">—</span>'}</dd>
              <dt>Order Acknowledged</dt><dd>${fmtDate(o.orderAcknowledgedDate) || '<span class="empty">awaiting</span>'}</dd>
              ${o.orderType === 'foreign' ? `<dt>Order Ready Date</dt><dd>${fmtDate(o.orderReadyDate) || '<span class="empty">—</span>'}</dd>` : ''}
            </dl>
          </div>
          <div class="info-card">
            <h4>Financials</h4>
            <dl class="kv-grid">
              <dt>Amount</dt><dd style="font-weight:600">${fmtMoney(o.amount, o.currency) || '—'}</dd>
              ${orderFunction(o) === 'supplychain' && Array.isArray(o.supplyChainItems) && o.supplyChainItems.length
                ? `<dt>Supply Chain Items</dt><dd>${o.supplyChainItems.length} item(s) recorded</dd>`
                : `<dt>Quantity</dt><dd>${o.quantity != null && o.quantity !== '' ? escapeHtml(String(o.quantity)) : '<span class="empty">—</span>'}</dd>`}
              <dt>Payment Terms</dt><dd>${escapeHtml(o.paymentTerms || '—')}</dd>
              <dt>Forthcoming Payment</dt><dd>${fmtDate(o.forthcomingPaymentDate) || '—'}</dd>
              <dt>Payment Due</dt><dd>${fmtDate(o.paymentDueDate) || '—'}</dd>
              ${linkedPayments.length ? linkedPayments.map(p => `
              <dt>RFP ${escapeHtml(p.rfpRef || '')}</dt><dd>${fmtDate(p.requestDate) || '<span class="empty">no date</span>'} · ${escapeHtml(p.status || '')}</dd>
              <dt style="padding-left:10px;color:var(--muted-soft)">↳ Approval</dt><dd>${p.paymentApproved ? '<span class="badge success" style="font-size:10px">✓ Approved</span>' + (p.paymentApprovedBy ? ' by ' + escapeHtml(p.paymentApprovedBy) : '') + (p.paymentApprovedDate ? ' · ' + fmtDate(p.paymentApprovedDate) : '') : '<span class="empty">Not approved</span>'}</dd>
              `).join('') : '<dt>Payment Requests</dt><dd><span class="empty">None yet</span></dd>'}
            </dl>
          </div>
          <div class="info-card${shipmentTabVisible && linkedShipments.length ? ' full' : ''}">
            <h4>Status &amp; Tracking</h4>
            <dl class="kv-grid">
              <dt>Status</dt><dd><span class="badge ${statusBadgeClass(o.status)}">${escapeHtml(o.status || 'No status')}</span></dd>
              <dt>State</dt><dd>${o.isClosed ? 'Closed' : 'Open'}</dd>
              <dt>Type</dt><dd>${escapeHtml(o.orderType === 'foreign' ? 'Foreign' : 'Local')} · ${escapeHtml(REF.functions[orderFunction(o)]?.short || '—')}</dd>
              <dt>Shipment</dt><dd>${defaultShipmentRequired ? 'Required' : (hasShipments ? 'Exceptional / optional' : (o.noShipment ? '<span class="empty">Not required (service / works)</span>' : '<span class="empty">Normally received by order GRN</span>'))}</dd>
              ${defaultShipmentRequired || hasShipments ? `<dt>Shipment Plan</dt><dd>${escapeHtml([o.plannedShipmentMode, o.plannedFreightForwarder].filter(Boolean).join(' · ') || '—')}</dd>` : ''}
              ${(defaultShipmentRequired || hasShipments) && o.shipmentPlanNotes ? `<dt>Shipment Plan Notes</dt><dd style="white-space:pre-wrap">${escapeHtml(o.shipmentPlanNotes)}</dd>` : ''}
              <dt>Payment Requests</dt><dd>${linkedPayments.length} (${linkedPayments.filter(p => p.paymentApproved).length} approved · ${linkedPayments.filter(p => p.isPaid).length} paid)</dd>
              ${(() => { const mtto = calcOrderMTTO(o); return mtto !== null ? `<dt>MTTO</dt><dd>${mtto} day(s)</dd>` : ''; })()}
            </dl>
            ${shipmentTabVisible ? (linkedShipments.length ? linkedShipments.map(s => {
              const expectedDocs = [
                ['Invoice', s.invoiceReceivedDate],
                ['Packing List', s.packingListDate],
                ['Bill of Lading / AWB', s.blDate],
                ['COA', s.coaDate],
                ['Health Cert', s.healthCertDate]
              ];
              const missing = expectedDocs.filter(([, d]) => !d).map(([n]) => n);
              const uploaded = expectedDocs.filter(([, d]) => d).length;
              const receiptDate = window.PXReceiptControl ? window.PXReceiptControl.shipmentReceiptDate(o, s) : (s.deliveryDate || s.grnDate);
              const otif = (s.eta && receiptDate) ? daysBetween(s.eta, receiptDate) : null;
              const clr = (s.docsToBrokerDate && s.clearanceDate) ? daysBetween(s.docsToBrokerDate, s.clearanceDate) : null;
              return `
              <div class="ship-track">
                <div class="ship-track-head">🚢 ${escapeHtml(s.shipmentId || s.orderId || 'Shipment')} ${s.status ? `<span class="badge ${statusBadgeClass(s.status)}" style="font-size:10px">${escapeHtml(s.status)}</span>` : ''}</div>
                <div class="ship-track-grid">
                  <div>
                    <div class="stk-label">Shipping Terms</div>
                    <div class="stk-val">${escapeHtml(s.shippingTerms || '—')}</div>
                  </div>
                  <div>
                    <div class="stk-label">Shipment Scope</div>
                    <div class="stk-val">
                      ${escapeHtml(s.shipmentCoverage || '—')}${s.partialShipmentReason ? ' · ' + escapeHtml(s.partialShipmentReason) : ''}
                      ${s.followupAction && s.followupAction !== 'No action' ? `<br>${shipmentActionBadge(s)}` : ''}
                    </div>
                  </div>
                  <div>
                    <div class="stk-label">Timeline</div>
                    <div class="stk-val">
                      ${escapeHtml(s.mode || '—')} · ETD ${fmtDate(s.etd) || '—'} · ETA ${fmtDate(s.eta) || '—'}<br>
                      Vessel/Flight: ${escapeHtml(s.vesselFlight || '—')}
                    </div>
                  </div>
                  <div>
                    <div class="stk-label">Shipping Documents</div>
                    <div class="stk-val">${missing.length === 0 ? (uploaded ? '<span class="badge success" style="font-size:10px">All received</span>' : '<span class="empty">none uploaded</span>') : `<span class="badge warn" style="font-size:10px">Missing</span> ${missing.map(escapeHtml).join(', ')}`}</div>
                  </div>
                  <div>
                    <div class="stk-label">Tax Provision (TEPS)</div>
                    <div class="stk-val">${s.totalProvision != null ? '<strong style="color:var(--copper,#A0522D)">' + fmtMoney(s.totalProvision, 'MUR') + '</strong>' : '<span class="empty">—</span>'}</div>
                  </div>
                  <div>
                    <div class="stk-label">Clearance</div>
                    <div class="stk-val">
                      ${s.clearanceStatus ? escapeHtml(s.clearanceStatus) + '<br>' : ''}
                      Docs to broker: ${fmtDate(s.docsToBrokerDate) || '—'} · Cleared: ${fmtDate(s.clearanceDate) || '—'}
                    </div>
                  </div>
                  <div>
                    <div class="stk-label">KPIs</div>
                    <div class="stk-val">
                      OTIF: ${otif !== null ? `<span class="badge ${otif <= 10 ? 'success' : 'warn'}" style="font-size:10px">${otif}d / 10d</span>` : '—'}
                      · Clearance: ${clr !== null ? clr + 'd' : '—'}
                      · Delivery/GRN: ${fmtDate(receiptDate) || '—'}
                    </div>
                  </div>
                </div>
              </div>`;
            }).join('') : '<div class="text-xs text-muted" style="margin-top:10px">No shipment recorded yet.</div>') : ''}
          </div>
          <div class="info-card full">
            <h4>Notes</h4>
            <div style="white-space:pre-wrap;font-size:13px;color:var(--ink-soft)">${escapeHtml(o.notes || '—')}</div>
          </div>
        </div>
      </div>
      ${shipmentTabVisible ? `
      <div id="tab-shipments" class="hidden">
        ${linkedShipments.length ? `
          <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--muted)">
            <span>${linkedShipments.length} shipment(s) linked to this order</span>
            <span>
              ${(() => {
                const completed = linkedShipments.filter(s => s.completed).length;
                const inTransit = linkedShipments.filter(s => (s.status||'').toLowerCase().includes('transit')).length;
                return `${completed} completed · ${inTransit} in transit`;
              })()}
            </span>
          </div>
          ${linkedShipments.map(s => {
            const receiptDate = window.PXReceiptControl ? window.PXReceiptControl.shipmentReceiptDate(o, s) : (s.deliveryDate || s.grnDate);
            const otifD = (s.eta && receiptDate) ? daysBetween(s.eta, receiptDate) : null;
            const docsTotal = 5;
            const docsHave = [s.invoiceReceivedDate, s.packingListDate, s.blDate, s.coaDate, s.healthCertDate].filter(Boolean).length;
            return `
              <div class="card" style="margin-bottom:10px;padding:14px">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px">
                  <div>
                    <div style="font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:600">${escapeHtml(s.shipmentId || s.orderId)}</div>
                    <div style="font-size:12px;color:var(--muted);margin-top:2px">${escapeHtml(s.description || '')}</div>
                  </div>
                  <div style="display:flex;gap:6px;flex-shrink:0">
                    <span class="badge ${statusBadgeClass(s.status)}">${escapeHtml(s.status||'—')}</span>
                    ${s.completed ? '<span class="badge success">Completed</span>' : ''}
                    ${otifD !== null ? `<span class="badge ${otifD <= 10 ? 'success' : 'warn'}" style="font-size:10.5px">OTIF ${otifD}d</span>` : ''}
                  </div>
                </div>
                <dl class="kv-grid" style="grid-template-columns: 110px 1fr 110px 1fr; font-size:12.5px; gap:5px 12px; margin-bottom:10px">
                  <dt>Conveyance</dt><dd>${escapeHtml(s.conveyance || '—')}</dd>
                  <dt>Shipping Terms</dt><dd>${escapeHtml(s.shippingTerms || '—')}</dd>
                  <dt>Ready Date</dt><dd>${fmtDate(s.readyDate) || '—'}</dd>
                  <dt>Vessel/Flight</dt><dd>${escapeHtml(s.vesselFlight || '—')}</dd>
                  <dt>ETD</dt><dd>${fmtDate(s.etd) || '—'}</dd>
                  <dt>ETA</dt><dd>${fmtDate(s.eta) || '—'}</dd>
                  <dt>Logistic Officer</dt><dd>${escapeHtml(s.logisticOfficer || '—')}</dd>
                  <dt>Delivery to</dt><dd>${escapeHtml(s.deliveryLocation || '—')}</dd>
                  <dt>Delivery Date</dt><dd>${fmtDate(s.deliveryDate) || '—'}</dd>
                  <dt>GRN Number</dt><dd class="mono">${escapeHtml(s.grnNumber || '—')}</dd>
                  <dt>GRN Date</dt><dd>${fmtDate(s.grnDate) || '—'}</dd>
                  <dt>Scope</dt><dd>${escapeHtml(s.shipmentCoverage || '—')}${s.partialShipmentReason ? ' · ' + escapeHtml(s.partialShipmentReason) : ''}</dd>
                  <dt>Action</dt><dd>${shipmentActionBadge(s)}</dd>
                  <dt>Quantity</dt><dd>${escapeHtml(window.PXUtils.fmtQuantityLines(s) || '—')}</dd>
                </dl>
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted);padding-top:8px;border-top:1px solid var(--line)">
                  <span>📄 Documents: ${docsHave}/${docsTotal} received</span>
                  <span style="display:flex;gap:6px">
                    <button class="btn btn-sm" onclick="closeModal(); setTimeout(() => openShipmentDetail('${s.id}'), 100)">View Full Detail</button>
                    ${canRequestShipmentUpdate ? `<button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); openUpdateRequestModal('shipment','${s.id}')">Request update</button>` : ''}
                    ${canEditShip ? `<button class="btn btn-sm btn-primary" onclick="closeModal(); setTimeout(() => openShipmentForm('${s.id}'), 100)">Edit Shipment</button>` : ''}
                  </span>
                </div>
              </div>
            `;
          }).join('')}
        ` : '<p class="text-muted text-sm">No shipments yet. The procurement officer requests the first shipment below.</p>'}
        ${!hasShipments && canRequestShipmentFromOrder && !o.noShipment ? `
          <button class="btn btn-primary mt-16" onclick="event.stopPropagation(); requestShipment('${o.id}')">📦 Request Shipment</button>
          <div class="text-xs text-muted mt-8">One click creates the shipment request. Logistics will assign it to an officer and fill the shipping details. Local orders only use this when an exceptional shipment is needed.</div>
        ` : (!hasShipments ? `
          <div class="text-xs text-muted mt-16">${o.noShipment ? 'This order is marked as no shipment required.' : 'No shipment request exists yet. Local orders normally receive by order-level GRN.'}</div>
        ` : (canEditShip ? `
          <button class="btn btn-primary mt-16" onclick="closeModal(); setTimeout(() => addPartialShipment('${o.id}'), 100)">+ Add Partial Shipment</button>
          <div class="text-xs text-muted mt-8">For orders arriving in multiple partial shipments. Opens the full shipping form for the next shipment record (${makeShipmentSequenceId(o.orderId)}).</div>
        ` : `
          <div class="text-xs text-muted mt-16">This order already has a shipment request. Additional partial shipments are added by logistics.</div>
        `))}
      </div>
      ` : ''}
      <div id="tab-grns" class="hidden">
        ${renderOrderGrnsSection(o)}
      </div>
      <div id="tab-payments" class="hidden">
        ${o.milestones && o.milestones.length > 0 ? `
          ${o.milestones.some(m => m.paidDate && !m.rfpRef) ? `
            <div class="alert-row warn" style="margin-bottom:12px">
              <div class="grow"><strong>Legacy paid milestone(s)</strong> — these were marked paid before RFP enforcement.
                Raise a retrospective RFP if you need formal documentation.</div>
            </div>
          ` : ''}
          <h3 style="margin-bottom:10px">Payment Schedule</h3>
          <div class="milestone-panel" style="margin-bottom: 16px">
            <div class="milestone-summary-bar">
              ${o.milestones.map(m => {
                const exp = computeMilestoneDate(m, o, state.data.shipments);
                const st = milestoneStatus(m, exp);
                return `<div class="seg ${st}" style="flex: ${m.percent || 1}" title="${escapeHtml(m.label)} (${m.percent}%) - ${st}"></div>`;
              }).join('')}
            </div>
            <div style="margin-top:14px">
              ${o.milestones.map((m, idx) => {
                const exp = computeMilestoneDate(m, o, state.data.shipments) || m.expectedDateOverride;
                const st = milestoneStatus(m, exp);
                const anchorLabel = REF.anchorEvents[m.anchor] || m.anchor || 'manual';
                const linkedRfp = m.rfpRef ? state.data.payments.find(p => p.rfpRef === m.rfpRef) : null;
                const legacy = m.paidDate && !m.rfpRef;
                return `
                  <div class="milestone-row ${st}" style="grid-template-columns: 24px 1fr 60px 110px 110px 90px auto">
                    <div class="seq">${idx + 1}</div>
                    <div class="label-in" style="border:none;padding:0;background:none">
                      <strong>${escapeHtml(m.label)}</strong>
                      <div class="anchor-hint" style="grid-column: unset">${escapeHtml(anchorLabel)}${m.offset ? ' · ' + (m.offset > 0 ? '+' : '') + m.offset + 'd' : ''}${m.rfpRef ? ' · <strong>RFP: ' + escapeHtml(m.rfpRef) + '</strong>' : ''}${m.paidDate ? ' · Paid: ' + fmtDate(m.paidDate) : ''}${legacy ? ' · <span style="color:var(--warn)">legacy</span>' : ''}</div>
                    </div>
                    <div class="pct-in" style="border:none;padding:0;background:none">${m.percent}%</div>
                    <div class="amount-in" style="border:none;padding:0;background:none">${fmtMoney(m.amount, o.currency)}</div>
                    <div style="font-size:12px">${exp ? fmtDate(exp) : '<span style="color:var(--muted-soft)">—</span>'}</div>
                    <span class="badge ${st === 'paid' ? 'success' : st === 'overdue' ? 'danger' : st === 'due-soon' ? 'warn' : st === 'rfp-raised' ? 'info' : 'accent'}" style="font-size:10.5px;justify-self:start">${st}</span>
                    <div style="justify-self:end">
                      ${m.paidDate
                        ? (linkedRfp ? `<button class="btn btn-sm" onclick="event.stopPropagation(); closeModal(); setTimeout(() => openPaymentDetail('${linkedRfp.id}'), 100)">View RFP</button>` : '')
                        : m.rfpRef
                          ? (linkedRfp ? `<button class="btn btn-sm" onclick="event.stopPropagation(); closeModal(); setTimeout(() => openPaymentDetail('${linkedRfp.id}'), 100)">View RFP</button>` : '<span class="text-xs text-muted">RFP ref orphaned</span>')
                          : (canCreatePayments
                            ? `<button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); closeModal(); setTimeout(() => openPaymentForm(null, '${escapeHtml(o.orderId)}', '${m.id}'), 100)">+ Raise RFP</button>`
                            : '<span class="text-xs text-muted">No RFP raised</span>')
                      }
                      ${legacy && canCreatePayments ? `<button class="btn btn-sm" style="margin-left:6px" onclick="event.stopPropagation(); closeModal(); setTimeout(() => openPaymentForm(null, '${escapeHtml(o.orderId)}', '${m.id}'), 100)" title="Raise retrospective RFP">+ Retro RFP</button>` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:12px;padding-top:10px;border-top:1px solid var(--line);font-size:13px">
              <span>Paid: <strong>${fmtMoney(o.milestones.filter(m => m.paidDate).reduce((s,m) => s + (m.amount||0), 0), o.currency)}</strong></span>
              <span>Outstanding: <strong>${fmtMoney(o.milestones.filter(m => !m.paidDate).reduce((s,m) => s + (m.amount||0), 0), o.currency)}</strong></span>
              <span>Total: <strong>${fmtMoney((o.amount || 0), o.currency)}</strong></span>
            </div>
          </div>
        ` : ''}
        <h3 style="margin-bottom:10px">Payment Requests (RFP)</h3>
        ${linkedPayments.length ? `
          <table class="data">
            <thead><tr><th>RFP Ref</th><th>Status</th><th>Invoice</th><th>Amount</th><th>Due</th></tr></thead>
            <tbody>
              ${linkedPayments.map(p => `<tr onclick="closeModal(); setTimeout(() => openPaymentDetail('${p.id}'), 100)">
                <td><span class="mono">${escapeHtml(p.rfpRef||'—')}</span></td>
                <td><span class="badge ${statusBadgeClass(p.status)}">${escapeHtml(p.status||'—')}</span></td>
                <td class="mono text-sm">${escapeHtml(p.invoiceNumber||'—')}</td>
                <td class="num">${fmtMoney(p.amount, p.currency)}</td>
                <td>${fmtDate(p.dueDate)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        ` : '<p class="text-muted text-sm">No payment requests raised yet.</p>'}
        ${canCreatePayments
          ? `<button class="btn mt-16" onclick="closeModal(); setTimeout(() => openPaymentForm(null, '${escapeHtml(o.orderId)}'), 100)">+ Create Payment Request</button>`
          : '<div class="text-xs text-muted mt-16">Payment requests are view-only for your role. You can see whether an RFP exists and whether it has been paid.</div>'}
      </div>

      <div id="tab-timeline" class="hidden">
        ${renderTimelineTab(o)}
      </div>
      <div id="tab-financial" class="hidden">
        ${renderFinancialTab(o)}
      </div>
      <div id="tab-lines" class="hidden">
        ${renderLinesTab(o)}
      </div>
      <div id="tab-documents" class="hidden">
        <div id="documents-section-order-${o.id}">${window.renderDocumentsSection ? window.renderDocumentsSection('order', o.id) : ''}</div>
      </div>
      <div id="tab-followups" class="hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 10px">
          <h3 style="margin:0">Communication log</h3>
          ${canLogOrderContact ? `<button class="btn btn-sm btn-primary" onclick="openContactLogModal('${o.id}')">+ Log contact</button>` : ''}
        </div>
        <div id="contactlog-section-order-${o.id}">${window.renderContactLogTimeline ? window.renderContactLogTimeline(o.id) : ''}</div>
        <div id="updateRequests-section-order-${o.id}" style="margin-top:18px">${window.renderUpdateRequestsSection ? window.renderUpdateRequestsSection('order', o.id) : ''}</div>
        <h3 style="margin:20px 0 12px">Follow-up tasks</h3>
        <div id="followups-section-order-${o.id}">${window.renderFollowupsSection ? window.renderFollowupsSection('order', o.id) : ''}</div>
      </div>
      <div id="tab-amendments" class="hidden">
        <h3 style="margin:0 0 12px">Amendment History</h3>
        ${window.PXAmendments ? window.PXAmendments.renderHistory(o.amendments) : '<p class="text-muted">Amendment engine unavailable.</p>'}
      </div>
      <div id="tab-claims" class="hidden">
        <h3 style="margin:0 0 12px">Claims</h3>
        ${window.PXClaims ? window.PXClaims.renderClaimsSection(o, canEditOrders()) : '<p class="text-muted">Claims engine unavailable.</p>'}
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Close</button>
      ${canLogOrderContact ? `<button class="btn" onclick="openContactLogModal('${o.id}')">Log contact</button>` : ''}
      ${canRequestOrderUpdate ? `<button class="btn" onclick="openUpdateRequestModal('order','${o.id}')">Request update</button>` : ''}
      ${canEditOrders() ? `<button class="btn btn-primary" onclick="closeModal(); setTimeout(() => openOrderForm('${o.id}'), 100)">Edit Order</button>` : '<span class="text-xs text-muted" style="align-self:center">View only — orders are maintained by procurement</span>'}
    </div>
  `, true);

  if (window.__setDetailContext) window.__setDetailContext('order', o.id);
  $$('.detail-tab').forEach(t => t.addEventListener('click', () => {
    $$('.detail-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    ['info','lines','shipments','grns','payments','timeline','financial','documents','followups','amendments','claims'].forEach(k => { const el = $('#tab-'+k); if (el) el.classList.toggle('hidden', k !== t.dataset.tab); });
  }));
};

async function updateShipmentGrnSummary(order, shipment, receipts) {
  if (!shipment || !window.PXReceiptControl) return;
  const mergedOrder = { ...order, receipts };
  const grns = window.PXReceiptControl.shipmentGrns(mergedOrder, shipment)
    .filter(window.PXReceiptControl.grnCountsAsReceipt)
    .sort((a, b) => {
      const da = new Date(a.grnDate || a.actualReceiptDate || 0);
      const db = new Date(b.grnDate || b.actualReceiptDate || 0);
      return db - da;
    });
  const latest = grns[0] || null;
  const patch = {
    grnDate: latest ? (latest.grnDate || latest.actualReceiptDate || null) : null,
    grnNumber: latest ? (latest.grnRef || latest.grnNumber || null) : null
  };
  await window.PXStore.updateRecord('shipments', shipment.id, patch, {
    skipValidation: true,
    permissionResource: canEditShipments() ? 'shipments' : 'orders',
    permissionAction: 'edit'
  });
}

function reopenAfterGrn(orderId, scopeShipmentId) {
  const shipment = scopeShipmentId ? state.data.shipments.find(s => s.id === scopeShipmentId) : null;
  closeModal();
  setTimeout(() => {
    if (shipment && window.openShipmentDetail) window.openShipmentDetail(shipment.id);
    else if (window.openOrderDetail) window.openOrderDetail(orderId);
  }, 120);
}

window.__saveOrderGrn = async function(orderId, scopeShipmentId, scopeKey) {
  if (!canEditGrns()) { toast('GRNs are view-only for your role.', 'warn'); return; }
  const order = state.data.orders.find(x => x.id === orderId);
  if (!order) { toast('Order not found', 'danger'); return; }
  const ref = (document.getElementById(scopeKey + '-ref')?.value || '').trim();
  const date = document.getElementById(scopeKey + '-date')?.value || '';
  const status = document.getElementById(scopeKey + '-status')?.value || 'fully received';
  const notes = (document.getElementById(scopeKey + '-notes')?.value || '').trim();
  const selectedShip = scopeShipmentId || document.getElementById(scopeKey + '-shipment')?.value || '';
  if (!ref) { toast('Enter the GRN number.', 'warn'); return; }
  if (!date) { toast('Enter the GRN date.', 'warn'); return; }
  const receipts = Array.isArray(order.receipts) ? order.receipts.slice() : [];
  receipts.push(stripUndefined({
    receiptId: 'GRN' + Date.now().toString(36),
    shipmentId: selectedShip || null,
    grnRef: ref,
    grnNumber: ref,
    grnDate: date,
    status,
    notes: notes || null,
    recordedBy: state.officer?.code || '',
    recordedAt: new Date().toISOString()
  }));
  try {
    await window.PXStore.updateRecord('orders', orderId, { receipts: stripUndefined(receipts) }, {
      skipValidation: true,
      permissionResource: canEditOrders() ? 'orders' : 'shipments',
      permissionAction: 'edit'
    });
    const shipment = selectedShip ? state.data.shipments.find(s => s.id === selectedShip || s.shipmentId === selectedShip) : null;
    if (shipment) await updateShipmentGrnSummary(order, shipment, receipts);
    toast('GRN recorded', 'success');
    reopenAfterGrn(orderId, scopeShipmentId || '');
  } catch (err) {
    console.error(err);
    toast('Failed to save GRN: ' + (err.message || err), 'danger');
  }
};

window.__removeOrderGrn = async function(orderId, receiptId, scopeKey, scopeShipmentId) {
  if (!canEditGrns()) { toast('GRNs are view-only for your role.', 'warn'); return; }
  if (!confirm('Remove this GRN row?')) return;
  const order = state.data.orders.find(x => x.id === orderId);
  if (!order) { toast('Order not found', 'danger'); return; }
  const oldReceipt = (order.receipts || []).find(r => r.receiptId === receiptId);
  const receipts = (order.receipts || []).filter(r => r.receiptId !== receiptId);
  try {
    await window.PXStore.updateRecord('orders', orderId, { receipts: stripUndefined(receipts) }, {
      skipValidation: true,
      permissionResource: canEditOrders() ? 'orders' : 'shipments',
      permissionAction: 'edit'
    });
    const shipId = scopeShipmentId || oldReceipt?.shipmentId || '';
    const shipment = shipId ? state.data.shipments.find(s => s.id === shipId || s.shipmentId === shipId) : null;
    if (shipment) await updateShipmentGrnSummary(order, shipment, receipts);
    toast('GRN removed', 'success');
    reopenAfterGrn(orderId, scopeShipmentId || '');
  } catch (err) {
    console.error(err);
    toast('Failed to remove GRN: ' + (err.message || err), 'danger');
  }
};

/* ---------- Performance Timeline tab (Feature 6) ---------- */
function renderTimelineTab(o) {
  if (!window.PXTimeline) return '<p class="text-xs text-muted">Timeline engine unavailable.</p>';
  const { rows, summary } = window.PXTimeline.forOrder(o);
  const srcLabel = { order: 'order', shipment: 'shipment', payment: 'payment', manual: 'manual' };
  const delayCell = r => {
    if (r.delayDays == null) return '<span class="text-muted">—</span>';
    if (r.delayDays > 0) return `<span style="color:var(--danger);font-weight:600">+${r.delayDays}d late</span>`;
    if (r.delayDays < 0) return `<span style="color:var(--success)">${r.delayDays}d early</span>`;
    return '<span style="color:var(--success)">on time</span>';
  };
  // Visual track: position each completed milestone between first and last actual.
  const span = (summary.firstActual && summary.lastActual) ? (summary.lastActual - summary.firstActual) : 0;
  const dots = rows.filter(r => r.actual).map(r => {
    const pct = span > 0 ? Math.round((r.actual - summary.firstActual) / span * 100) : 0;
    const color = (r.delayDays != null && r.delayDays > 0) ? 'var(--danger)' : (r.delayDays != null ? 'var(--success)' : 'var(--muted)');
    return `<div class="tl-dot" style="left:${pct}%;background:${color}" title="${escapeHtml(r.label)} — ${fmtDate(r.actual)}${r.delayDays!=null?` (${r.delayDays>0?'+':''}${r.delayDays}d vs plan)`:''}"></div>`;
  }).join('');

  const rowsHtml = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.label)}${r.manual ? ' <span class="text-xs text-muted">(manual)</span>' : ''}</td>
      <td>${r.planned ? fmtDate(r.planned) : '<span class="text-muted">—</span>'}</td>
      <td>${r.actual ? `${fmtDate(r.actual)} <span class="tl-src">${srcLabel[r.source]||''}</span>` : '<span class="text-muted">—</span>'}</td>
      <td>${delayCell(r)}</td>
      <td>${r.leadDays != null ? r.leadDays + 'd' : '<span class="text-muted">—</span>'}</td>
    </tr>`).join('');

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap">
      <div class="text-sm text-muted">
        ${summary.completed}/${summary.total} milestones recorded${summary.totalLeadDays != null ? ` · total lead time <strong>${summary.totalLeadDays}d</strong>` : ''}${summary.lateCount ? ` · <span style="color:var(--danger)">${summary.lateCount} late vs plan</span>` : ''}${summary.onTimeCount ? ` · ${summary.onTimeCount} on/ahead` : ''}
      </div>
      ${canEditOrders() ? `<button class="btn btn-sm" onclick="openTimelineEditor('${o.id}')">Edit planned / actual dates</button>` : ''}
    </div>
    ${span > 0 ? `<div class="tl-track">${dots}</div>
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin:4px 2px 16px">
      <span>${fmtDate(summary.firstActual)}</span><span>${fmtDate(summary.lastActual)}</span></div>` : ''}
    <div class="table-wrap"><table class="data resizable" data-colw="order-timeline">
      <thead><tr><th>Milestone</th><th>Planned</th><th>Actual</th><th>Delay</th><th>Lead</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
    <p class="text-xs text-muted" style="margin-top:10px">Actuals are drawn from the order, its shipments and its payment requests (single source of truth). Planned dates and the manual actuals (departure, arrival) are set here; planned dates are prepared to be ERP/supplier-sourced later.</p>`;
}

/* ---------- PO Financial & Receipt Control tab (Feature 5) ---------- */
function renderFinancialTab(o) {
  if (!window.PXFinancial) return '<p class="text-xs text-muted">Financial engine unavailable.</p>';
  const f = window.PXFinancial.forOrder(o);
  const money = (a, c) => (a == null ? '<span class="text-muted">—</span>' : fmtMoney(a, c));
  const curRows = f.byCurrency.map(c => `
    <tr>
      <td><strong>${escapeHtml(c.currency)}</strong></td>
      <td class="num">${money(c.poAmount, c.currency)}</td>
      <td class="num">${money(c.requested, c.currency)}</td>
      <td class="num">${money(c.approved, c.currency)}</td>
      <td class="num">${money(c.paid, c.currency)}</td>
      <td class="num" style="${c.outstanding > 0 ? 'color:var(--warn,#9a5b00);font-weight:600' : (c.outstanding < 0 ? 'color:var(--danger)' : '')}">${money(c.outstanding, c.currency)}</td>
    </tr>`).join('');

  const rfpRows = f.rfps.length ? f.rfps.map(p => `
    <tr ${`onclick="openPaymentDetail('${p.id}')" style="cursor:pointer"`}>
      <td>${escapeHtml(p.rfpRef || '—')}</td>
      <td>${escapeHtml(p.invoiceNumber || '—')}</td>
      <td class="num">${fmtMoney(p.amount, p.currency || f.poCurrency)}</td>
      <td><span class="badge ${statusBadgeClass(p.status)}">${escapeHtml(p.status || '—')}</span></td>
      <td>${(p.paymentApproved || ['approved','paid'].includes(p.status)) ? '✓' : '—'}</td>
      <td>${(p.isPaid || p.status === 'paid') ? '✓ ' + (fmtDate(p.paidDate) || '') : '—'}</td>
    </tr>`).join('') : `<tr><td colspan="6" class="text-muted">No payment requests yet.</td></tr>`;

  const warnLevel = { danger: 'var(--danger)', warn: 'var(--warn,#9a5b00)', info: 'var(--muted)' };
  const warnsHtml = f.warnings.length ? `
    <div class="card" style="margin:14px 0;padding:10px 14px;background:#fbf7ee;border-left:3px solid var(--warn,#9a5b00)">
      <div class="doc-checklist-head" style="margin-bottom:6px">Control warnings</div>
      <ul class="rd-list">${f.warnings.map(w => `<li class="rd-item"><span class="rd-ico" style="color:${warnLevel[w.level]}">${w.level==='danger'?'✕':(w.level==='info'?'ℹ':'⚠')}</span><span>${escapeHtml(w.msg)}</span></li>`).join('')}</ul>
    </div>` : `<div class="rd-panel rd-ready" style="margin:14px 0"><div class="rd-head"><strong>No control exceptions</strong><span class="badge success">Clean</span></div></div>`;

  return `
    <div class="text-sm text-muted" style="margin-bottom:10px">
      PO <strong>${escapeHtml(o.orderId || '')}</strong> · ${escapeHtml(f.poCurrency)} ${f.poAmount ? fmtMoney(f.poAmount, f.poCurrency) : ''}
      ${f.quantity != null ? ` · ordered qty <strong>${escapeHtml(String(f.quantity))}</strong>` : ''}${f.lines ? ` · ${f.lines} PO line(s)` : ''}
      · receipts: ${f.receipts.shipments} shipment(s), ${f.receipts.withGrn} shipment receipt(s), ${f.receipts.orderGrns || 0} order GRN(s), ${f.receipts.completed} completed shipment(s)
    </div>
    ${warnsHtml}
    <h4 style="margin:14px 0 6px">By currency</h4>
    <div class="table-wrap"><table class="data resizable" data-colw="order-financial">
      <thead><tr><th>Currency</th><th class="num">PO amount</th><th class="num">Requested</th><th class="num">Approved</th><th class="num">Paid</th><th class="num">Outstanding</th></tr></thead>
      <tbody>${curRows}</tbody>
    </table></div>
    <p class="text-xs text-muted" style="margin:6px 2px 14px">Values are grouped by currency and never combined into a single mixed total. ${f.hasFx ? '' : 'No exchange rate, rate date and source are recorded on this order, so no base-currency conversion is shown.'}</p>
    <h4 style="margin:14px 0 6px">Payment requests</h4>
    <div class="table-wrap"><table class="data resizable" data-colw="order-financial-rfps">
      <thead><tr><th>RFP</th><th>Invoice no.</th><th class="num">Amount</th><th>Status</th><th>Approved</th><th>Paid</th></tr></thead>
      <tbody>${rfpRows}</tbody>
    </table></div>
    <p class="text-xs text-muted" style="margin-top:10px">Ordered (PO) and received (GRN) come from the order and its shipments; invoiced/requested/approved/paid from its payment requests. Outstanding = PO amount − paid (per currency).</p>`;
}

/* ---------- PO Lines: fulfilment / receipt / closure control (Increment 1) ---------- */
function renderLinesTab(o) {
  if (!window.PXLineFulfilment) return '<p class="text-xs text-muted">Line engine unavailable.</p>';
  const f = window.PXLineFulfilment.forOrder(o);
  if (!f.hasLines) {
    const manualItems = orderFunction(o) === 'supplychain' && Array.isArray(o.supplyChainItems)
      ? o.supplyChainItems : [];
    if (manualItems.length) {
      return `<div class="op-hint" style="margin-bottom:10px">Supply Chain item details are recorded on this order. ERP PO-line fulfilment and GRN controls activate when ERP line data is available.</div>
        <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Detailed Description</th><th class="num">Quantity</th></tr></thead><tbody>
          ${manualItems.map((item, index) => `<tr><td>${index + 1}</td><td style="white-space:pre-wrap">${escapeHtml(item.detailedDescription || '—')}</td><td class="num">${item.quantity != null ? escapeHtml(String(item.quantity)) : '—'}</td></tr>`).join('')}
        </tbody></table></div>`;
    }
    return `<div class="op-hint">No ERP PO lines are attached to this order yet. Line-level fulfilment, receipt and closure control activate automatically when the ERP import carries PO lines for this PO.${o.quantity != null ? ` (Legacy order header quantity: <strong>${escapeHtml(String(o.quantity))}</strong>.)` : ''}</div>`;
  }
  const sb = s => ({ 'open': 'neutral', 'part received': 'warn', 'received': 'success', 'cancelled': 'neutral' }[s] || 'neutral');
  const canEdit = canEditOrders();
  const warn = [].concat(f.orderWarnings, f.errors);
  const banner = `<div class="rd-panel ${f.canClose ? 'rd-ready' : 'rd-blocked'}" style="margin-bottom:12px">
      <div class="rd-head"><strong>Line fulfilment</strong><span class="badge ${f.canClose ? 'success' : 'warn'}">${f.received}/${f.totalLines} received${f.open ? ` · ${f.open} open` : ''}${f.cancelled ? ` · ${f.cancelled} cancelled` : ''}</span></div>
      ${warn.length ? `<ul class="rd-list">${warn.map(w => `<li class="rd-item no"><span class="rd-ico" style="color:${w.level === 'error' ? 'var(--danger)' : 'var(--warn,#9a5b00)'}">${w.level === 'error' ? '✕' : '⚠'}</span><span>${escapeHtml(w.msg)}</span></li>`).join('')}</ul>` : '<div class="text-xs text-muted">All lines accounted for — the order may be closed once no lines remain open.</div>'}
    </div>`;
  const rows = f.lines.map(l => {
    const expd = l.expectedDeliveryDate ? fmtDate(l.expectedDeliveryDate) : '—';
    const actd = l.actualReceiptDate ? fmtDate(l.actualReceiptDate) : '—';
    const overdue = l.open && l.expectedDeliveryDate && new Date(l.expectedDeliveryDate) < new Date();
    return `<tr>
      <td class="mono">${escapeHtml(String(l.lineNo != null ? l.lineNo : l.key))}</td>
      <td>${escapeHtml(l.itemNumber || '—')}</td>
      <td>${escapeHtml(l.description || '—')}</td>
      <td class="num">${l.ordered}${l.uom ? ' ' + escapeHtml(l.uom) : ''}</td>
      <td class="num">${l.received}</td>
      <td class="num">${l.cancelled || 0}</td>
      <td class="num" style="${l.remaining > 0 ? 'color:var(--warn,#9a5b00);font-weight:600' : ''}">${l.remaining}</td>
      <td><span class="badge ${sb(l.status)}">${l.status}</span>${l.closed ? ' <span class="badge neutral" style="font-size:10px">closed</span>' : ''}${l.warnings.some(w => w.level === 'error') ? ' <span class="badge danger" style="font-size:10px">over-receipt</span>' : ''}</td>
      <td class="${overdue ? 'text-danger' : ''}">${expd}${overdue ? ' · overdue' : ''}</td>
      <td>${actd}</td>
      <td>${l.shipments.length ? escapeHtml(l.shipments.join(', ')) : '—'}</td>
      <td>${l.grns.length ? l.grns.map(g => escapeHtml(g.ref || (g.date ? fmtDate(g.date) : 'GRN'))).join(', ') : '—'}</td>
      <td>${canEdit ? `<button class="btn btn-sm" onclick="openLineControl('${o.id}','${encodeURIComponent(l.key)}')">Manage</button>` : ''}</td>
    </tr>`;
  }).join('');
  return `${banner}
    <div class="op-hint" style="margin:6px 0 10px">ERP line master (line, item, ordered, UoM, expected date) is read-only. Received quantity, GRN, shipment links, over-receipt exceptions and per-line closure are Phoenix-owned and recorded here. An order cannot be closed while any line is open.</div>
    <div class="table-wrap"><table class="data" data-colw="po-lines">
      <thead><tr><th>Line</th><th>Item</th><th>Description</th><th class="num">Ordered</th><th class="num">Rcvd</th><th class="num">Cancl</th><th class="num">Remain</th><th>Status</th><th>Expected</th><th>Actual</th><th>Shipment(s)</th><th>GRN ref(s)</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

window.openLineControl = function (orderId, lineKeyEnc) {
  if (!canEditOrders()) { toast('View only — orders are maintained by procurement', 'warn'); return; }
  const lineKey = decodeURIComponent(lineKeyEnc);
  const o = state.data.orders.find(x => x.id === orderId); if (!o) return;
  const l = window.PXLineFulfilment.forOrder(o).lines.find(x => x.key === lineKey); if (!l) return;
  const ships = state.data.shipments.filter(s => !s.archived && s.orderId === o.orderId);
  const shipOpts = ['<option value="">— shipment (optional) —</option>'].concat(ships.map(s => `<option value="${s.id}">${escapeHtml(s.shipmentId || s.id)}</option>`)).join('');
  const receiptRows = l.receipts.length ? l.receipts.map(r => `<tr><td>${escapeHtml(r.grnRef || '—')}</td><td>${r.grnDate ? fmtDate(r.grnDate) : '—'}</td><td class="num">${r.receivedQty}</td><td>${escapeHtml(r.shipmentId || '—')}</td><td>${r.exceptionApproved ? '<span class="badge warn" style="font-size:10px">exc</span>' : ''}</td><td><button class="btn btn-sm btn-ghost" onclick="__removeReceipt('${orderId}','${r.receiptId}')">✕</button></td></tr>`).join('') : '<tr><td colspan="6" class="text-muted">No receipts recorded yet.</td></tr>';
  window.openModal(`
    <div class="modal-head"><div><h2>Manage PO line ${escapeHtml(String(l.lineNo != null ? l.lineNo : l.key))}</h2><div class="sub">${escapeHtml(o.orderId || '')} · ${escapeHtml(l.description || l.itemNumber || '')}</div></div><button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="po-summary" style="margin-bottom:12px">
        <div class="po-stat"><div class="po-stat-label">Ordered</div><div class="po-stat-value">${l.ordered}${l.uom ? ' ' + escapeHtml(l.uom) : ''}</div></div>
        <div class="po-stat"><div class="po-stat-label">Received</div><div class="po-stat-value">${l.received}</div></div>
        <div class="po-stat"><div class="po-stat-label">Cancelled</div><div class="po-stat-value">${l.cancelled || 0}</div></div>
        <div class="po-stat"><div class="po-stat-label">Remaining</div><div class="po-stat-value" style="${l.remaining > 0 ? 'color:var(--warn)' : ''}">${l.remaining}</div></div>
      </div>
      <h4>Goods receipts (GRN)</h4>
      <div class="table-wrap"><table class="data"><thead><tr><th>GRN ref</th><th>Date</th><th class="num">Qty</th><th>Shipment</th><th></th><th></th></tr></thead><tbody>${receiptRows}</tbody></table></div>
      <h4 style="margin-top:14px">Record a receipt</h4>
      <div class="form-grid cols-2">
        <label>Quantity received<input type="number" id="rc-qty" step="any" min="0"></label>
        <label>GRN / receipt ref<input type="text" id="rc-ref"></label>
        <label>Receipt date<input type="date" id="rc-date"></label>
        <label>Linked shipment<select id="rc-ship">${shipOpts}</select></label>
      </div>
      <label style="display:block;margin-top:8px"><input type="checkbox" id="rc-exc" style="width:auto;margin-right:6px;vertical-align:middle">Approve over-receipt exception (received may exceed ordered)</label>
      <input type="text" id="rc-exc-reason" placeholder="Exception reason" style="margin-top:6px;display:none">
      <hr style="margin:16px 0;border:none;border-top:1px solid var(--line)">
      <h4>Line closure (Phoenix control)</h4>
      <label style="display:block"><input type="checkbox" id="lc-closed" ${l.closed ? 'checked' : ''} style="width:auto;margin-right:6px;vertical-align:middle">Close this line</label>
      <input type="text" id="lc-reason" placeholder="Closure reason (e.g. short-close agreed, cancelled, fully received)" value="${escapeHtml(l.closureReason || '')}" style="margin-top:6px">
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="__saveLineControl('${orderId}','${encodeURIComponent(lineKey)}')">Save</button>
    </div>`, true);
  setTimeout(() => { const exc = document.getElementById('rc-exc'); if (exc) exc.addEventListener('change', () => { document.getElementById('rc-exc-reason').style.display = exc.checked ? 'block' : 'none'; }); }, 0);
};

window.__saveLineControl = async function (orderId, lineKeyEnc) {
  if (!canEditOrders()) { toast('View only — orders are maintained by procurement', 'warn'); return; }
  const lineKey = decodeURIComponent(lineKeyEnc);
  const o = state.data.orders.find(x => x.id === orderId); if (!o) return;
  const l = window.PXLineFulfilment.forOrder(o).lines.find(x => x.key === lineKey); if (!l) return;
  const qty = parseFloat(document.getElementById('rc-qty').value);
  const ref = (document.getElementById('rc-ref').value || '').trim();
  const date = document.getElementById('rc-date').value;
  const ship = document.getElementById('rc-ship').value;
  const exc = document.getElementById('rc-exc').checked;
  const excReason = (document.getElementById('rc-exc-reason').value || '').trim();
  const closed = document.getElementById('lc-closed').checked;
  const reason = (document.getElementById('lc-reason').value || '').trim();
  const receipts = Array.isArray(o.receipts) ? o.receipts.slice() : [];
  const addingReceipt = !isNaN(qty) && qty > 0;
  if (addingReceipt) {
    if (l.received + qty > (l.ordered - l.cancelled) + 0.0001 && !exc) { toast('Received exceeds ordered — tick the over-receipt exception to proceed.', 'error'); return; }
    if (!ref) { toast('Enter the GRN reference for the receipt.', 'error'); return; }
    if (!date) { toast('Enter the GRN date for the receipt.', 'error'); return; }
    receipts.push({ receiptId: 'R' + Date.now().toString(36), lineId: lineKey, shipmentId: ship || null, grnRef: ref || null, grnNumber: ref || null, grnDate: date || null, receivedQty: qty, status: 'fully received', exceptionApproved: !!exc, exceptionReason: exc ? excReason : null, exceptionApprovedBy: exc ? (state.officer?.code || '') : null, notes: null, recordedBy: (state.officer?.code || ''), recordedAt: new Date().toISOString() });
  }
  const tracking = Array.isArray(o.lineTracking) ? o.lineTracking.slice() : [];
  let t = tracking.find(x => String(x.lineId) === lineKey);
  if (!t) { t = { lineId: lineKey }; tracking.push(t); }
  t.closed = closed; t.closureReason = closed ? reason : ''; t.exceptionApproved = exc || t.exceptionApproved || false;
  t.updatedBy = state.officer?.code || ''; t.updatedAt = new Date().toISOString();
  try {
    await window.PXStore.updateRecord('orders', orderId, { receipts: stripUndefined(receipts), lineTracking: stripUndefined(tracking) });
    const linkedShipment = ship ? state.data.shipments.find(s => s.id === ship || s.shipmentId === ship) : null;
    if (linkedShipment) await updateShipmentGrnSummary(o, linkedShipment, receipts);
    toast(addingReceipt ? 'Receipt recorded' : 'Line updated', 'success');
    closeModal(); if (window.openOrderDetail) window.openOrderDetail(orderId);
  } catch (e) { console.error(e); toast('Save failed', 'error'); }
};

window.__removeReceipt = async function (orderId, receiptId) {
  if (!canEditOrders()) { toast('View only — orders are maintained by procurement', 'warn'); return; }
  const o = state.data.orders.find(x => x.id === orderId); if (!o) return;
  const oldReceipt = (o.receipts || []).find(r => r.receiptId === receiptId);
  const receipts = (o.receipts || []).filter(r => r.receiptId !== receiptId);
  try {
    await window.PXStore.updateRecord('orders', orderId, { receipts: stripUndefined(receipts) });
    const linkedShipment = oldReceipt?.shipmentId ? state.data.shipments.find(s => s.id === oldReceipt.shipmentId || s.shipmentId === oldReceipt.shipmentId) : null;
    if (linkedShipment) await updateShipmentGrnSummary(o, linkedShipment, receipts);
    toast('Receipt removed', 'success'); closeModal(); if (window.openOrderDetail) window.openOrderDetail(orderId);
  }
  catch (e) { console.error(e); toast('Failed', 'error'); }
};

window.openTimelineEditor = function(orderId) {
  const o = state.data.orders.find(x => x.id === orderId);
  if (!o) return;
  if (!canEditOrders()) { window.PXUtils.toast && window.PXUtils.toast('View only — orders are maintained by procurement', 'warn'); return; }
  const milestones = window.REF.timelineMilestones || [];
  const planned = o.plannedDates || {};
  const actual = o.actualDates || {};
  const iso = v => { const d = window.PXTimeline._toDate(v); return d ? d.toISOString().slice(0, 10) : ''; };
  const rows = milestones.map(m => `
    <tr>
      <td style="white-space:nowrap">${escapeHtml(m.label)}</td>
      <td><input type="date" name="plan_${m.key}" value="${iso(planned[m.key])}" /></td>
      <td>${m.src === 'manual'
        ? `<input type="date" name="act_${m.key}" value="${iso(actual[m.key])}" />`
        : `<span class="text-xs text-muted">from ${m.src.split(':')[0] === 'order' ? 'order' : (m.src.split(':')[0] === 'ship' ? 'shipment' : 'payment')}${actual[m.key] ? ' · override set' : ''}</span>${actual[m.key] ? `<input type="date" name="act_${m.key}" value="${iso(actual[m.key])}" style="margin-top:4px" />` : ''}`}</td>
    </tr>`).join('');
  window.openModal(`
    <div class="modal-head"><div><h2>Timeline Dates</h2><div class="sub">${escapeHtml(o.orderId || '')} — planned vs actual</div></div>
      <button class="btn btn-ghost btn-icon" onclick="closeModalToDetail && closeModalToDetail()">✕</button></div>
    <div class="modal-body">
      <p class="text-xs text-muted" style="margin-bottom:10px">Set <strong>planned/commitment</strong> dates for any milestone. Actuals for milestones that have no source field (departure, arrival) can be entered here; all other actuals come from the order, its shipments and its payments and are edited there.</p>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Milestone</th><th>Planned</th><th>Actual</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModalToDetail && closeModalToDetail()">Cancel</button>
      <button class="btn btn-primary" id="save-timeline">Save</button>
    </div>`, false);
  $('#save-timeline').addEventListener('click', async () => {
    const g = n => { const el = document.querySelector(`[name="${n}"]`); return el && el.value ? el.value : ''; };
    const plannedOut = {}, actualOut = {};
    milestones.forEach(m => {
      const pv = g('plan_' + m.key); if (pv) plannedOut[m.key] = new Date(pv);
      const el = document.querySelector(`[name="act_${m.key}"]`);
      if (el && el.value) actualOut[m.key] = new Date(el.value);
    });
    try {
      await window.PXStore.updateRecord('orders', o.id, { plannedDates: plannedOut, actualDates: actualOut });
      window.PXUtils.toast && window.PXUtils.toast('Timeline dates saved', 'success');
      if (window.closeModalToDetail) window.closeModalToDetail();
    } catch (e) { window.PXUtils.toast && window.PXUtils.toast('Save failed: ' + (e.message || e), 'danger'); }
  });
};
