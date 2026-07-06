const { $, $$, fmtDate, fmtDateISO, fmtMoney, daysBetween, escapeHtml, statusBadgeClass,
  collection, addDoc, doc, getDoc, updateDoc, deleteDoc, serverTimestamp, toast,
  cmGetColumns, cmRenderTable, cmOpenManager, cmExportCSV, fmtQuantityLines,
  checkShipmentDuplicates, shipmentDataQuality, isErpOrder, renderErpBadge,
  currentEntity, recordEntity, entityMeta, stripUndefined, orderFunction, canEditShipments,
  shipmentFollowupActionOpen } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;


window.openShipmentDetail = function(shipId) {
  const s = state.data.shipments.find(x => x.id === shipId);
  if (!s) { toast('Shipment not found', 'danger'); return; }
  const docsChecklist = [
    ['Invoice', s.invoiceReceivedDate],
    ['Packing List', s.packingListDate],
    ['Bill of Lading / AWB', s.blDate],
    ['COA', s.coaDate],
    ['Health Cert', s.healthCertDate]
  ];

  // Find the linked order (if any) so we can show its context
  const linkedOrder = s.orderId ? state.data.orders.find(o => o.orderId === s.orderId) : null;
  const receiptDate = linkedOrder && window.PXReceiptControl ? window.PXReceiptControl.shipmentReceiptDate(linkedOrder, s) : (s.deliveryDate || s.grnDate);
  const otif = (s.eta && receiptDate) ? daysBetween(s.eta, receiptDate) : null;
  const clr = (s.docsToBrokerDate && s.clearanceDate) ? daysBetween(s.docsToBrokerDate, s.clearanceDate) : null;
  const canRequestShipmentUpdate = !!(window.PXUpdateRequests && window.PXUpdateRequests.canRequestUpdate('shipment'));
  const canLogShipmentContact = canEditShipments();
  const ynLabel = v => v === 'yes' ? 'Yes' : (v === 'no' ? 'No' : '—');
  const actionBadge = action => action && action !== 'No action'
    ? (shipmentFollowupActionOpen(s) ? `<span class="badge warn">${escapeHtml(action)}</span>` : `<span class="badge success">${escapeHtml(action)} processed</span>`)
    : escapeHtml(action || '—');

  window.openModal(`
    <div class="modal-head">
      <div>
        <h2>${escapeHtml(s.shipmentId || 'Shipment')}</h2>
        <div class="sub">${escapeHtml(s.orderId || '')} · ${escapeHtml(s.supplier || '')}</div>
      </div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">

      ${linkedOrder ? `
        <div class="card mb-16" style="border-left: 3px solid var(--primary); background: var(--primary-soft)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
            <div>
              <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Linked ${linkedOrder.orderType === 'local' ? 'Local' : 'Foreign'} Order ${isErpOrder(linkedOrder) ? renderErpBadge(linkedOrder, true) : ''}</div>
              <div style="font-family:'IBM Plex Mono',monospace;font-size:15px;font-weight:600;color:var(--primary-dark)">${escapeHtml(linkedOrder.orderId)}</div>
            </div>
            <button class="btn btn-sm" onclick="event.stopPropagation(); closeModal(); setTimeout(() => openOrderDetail('${linkedOrder.id}'), 100)">View Full Order →</button>
          </div>
          <dl class="kv-grid" style="grid-template-columns: 140px 1fr; font-size:12.5px; gap:6px 14px">
            <dt>Supplier</dt><dd>${escapeHtml(linkedOrder.supplier || '—')}</dd>
            <dt>Description</dt><dd style="white-space:pre-wrap">${escapeHtml(linkedOrder.description || '—')}</dd>
            <dt>Quantity</dt><dd>${linkedOrder.quantity != null && linkedOrder.quantity !== '' ? escapeHtml(String(linkedOrder.quantity)) : '<span class="empty">—</span>'}</dd>
            <dt>Category</dt><dd>${escapeHtml(linkedOrder.category || '—')}</dd>
            <dt>${(window.__iprLabel ? window.__iprLabel(linkedOrder) : 'IPR No.').replace(' No.', ' Number')}</dt><dd class="mono">${escapeHtml(linkedOrder.iprNumber || '—')}</dd>
            <dt>Order Value</dt><dd style="font-weight:600">${fmtMoney(linkedOrder.amount, linkedOrder.currency)}</dd>
            <dt>Requested Receipt</dt><dd>${fmtDate(linkedOrder.requestedReceiptDate) || '<span class="empty">—</span>'}</dd>
            <dt>Order Status</dt><dd><span class="badge ${statusBadgeClass(linkedOrder.status)}">${escapeHtml(linkedOrder.status || '—')}</span></dd>
            <dt>Purchasing Officer</dt><dd>${escapeHtml(linkedOrder.officerCode || '—')}</dd>
          </dl>
        </div>
      ` : (s.orderId ? `
        <div class="alert-row danger" style="margin-bottom: 12px">
          <div class="grow"><strong>Orphaned shipment</strong> — links to order <span class="mono">${escapeHtml(s.orderId)}</span> which no longer exists. Click Edit and re-link to a valid order.</div>
        </div>
      ` : `
        <div class="alert-row warn" style="margin-bottom: 12px">
          <div class="grow"><strong>No linked order</strong> — this shipment is not tied to any purchase order. Click Edit and pick one.</div>
        </div>
      `)}

      <div class="status-bar">
        ${(() => { const st = s.stage || (s.completed ? 'completed' : 'in_progress'); const m = REF.shipmentStages[st] || {short:st,badge:'neutral'}; return `<span class="badge ${m.badge}" style="font-size:12px;padding:4px 10px">${escapeHtml(m.short)}</span>`; })()}
        ${s.status ? `<span class="badge ${statusBadgeClass(s.status)}" style="font-size:12px;padding:4px 10px">${escapeHtml(s.status)}</span>` : ''}
        ${s.logisticOfficer ? `<span class="badge info" style="font-size:11.5px">👤 ${escapeHtml(s.logisticOfficer)}</span>` : '<span class="badge accent" style="font-size:11.5px">unassigned</span>'}
        ${otif !== null ? `<span class="badge ${otif <= 10 ? 'success' : 'warn'}">OTIF ${otif}d / target 10d</span>` : ''}
        ${clr !== null ? `<span class="badge ${clr <= 3 ? 'success' : 'warn'}">Clearance ${clr}d / target 3d</span>` : ''}
      </div>
      ${(() => {
        const dq = shipmentDataQuality(s, window.PXUtils.dataQualityContext ? window.PXUtils.dataQualityContext() : {});
        return dq.length ? `<div class="card" style="margin-bottom:14px;padding:10px 14px;background:var(--surface-warm)">
          <ul class="dq-list">${dq.map(i => `<li class="dq-item ${i.level}"><span class="dq-dot"></span><span>${escapeHtml(i.msg)}</span></li>`).join('')}</ul>
        </div>` : '';
      })()}
      ${window.PXReadiness && !(s.completed || s.stage === 'completed') ? window.renderReadinessPanel(window.PXReadiness.forShipmentReceipt(s)) : ''}
      ${window.renderShipmentJourney ? window.renderShipmentJourney(s) : ''}
      ${window.renderShipmentDocs ? window.renderShipmentDocs(s) : ''}
      <div class="info-cards">
        <div class="info-card">
          <h4>Timeline</h4>
          <dl class="kv-grid">
            <dt>Ready Date</dt><dd>${fmtDate(s.readyDate) || '<span class="empty">—</span>'}</dd>
            <dt>ETD</dt><dd>${fmtDate(s.etd) || '<span class="empty">—</span>'}</dd>
            <dt>Actual Departure</dt><dd>${fmtDate(s.actualDepartureDate) || '<span class="empty">—</span>'}</dd>
            <dt>ETA</dt><dd>${fmtDate(s.eta) || '<span class="empty">—</span>'}</dd>
            <dt>Actual Arrival</dt><dd>${fmtDate(s.actualArrivalDate) || '<span class="empty">—</span>'}</dd>
            ${Array.isArray(s.etaChangeHistory) && s.etaChangeHistory.length ? `<dt>ETA Changes</dt><dd>${s.etaChangeHistory.length} recorded</dd>` : ''}
            <dt>Vessel / Flight</dt><dd>${escapeHtml(s.vesselFlight || '—')}</dd>
            <dt>Delivery Date</dt><dd>${fmtDate(s.deliveryDate) || '<span class="empty">—</span>'}</dd>
            <dt>GRN Number</dt><dd class="mono">${escapeHtml(s.grnNumber || '—')}</dd>
            <dt>GRN Date</dt><dd>${fmtDate(s.grnDate) || '—'}${receiptDate && !s.deliveryDate && s.grnDate ? ' <span class="text-xs text-muted">(fallback receipt date)</span>' : ''}</dd>
            <dt>Logistic Officer</dt><dd>${escapeHtml(s.logisticOfficer || '—')}</dd>
            <dt>Delivery Location</dt><dd>${escapeHtml(s.deliveryLocation || '—')}</dd>
          </dl>
        </div>

        <div class="info-card">
          <h4>Shipping Terms</h4>
          <dl class="kv-grid">
            <dt>Shipping Terms</dt><dd>${escapeHtml(s.shippingTerms || '—')}</dd>
            <dt>Conveyance</dt><dd>${escapeHtml(s.conveyance || '—')}</dd>
            <dt>Packing</dt><dd>${escapeHtml(s.packingDetails || '—')}</dd>
            <dt>Quantity / Packaging</dt><dd>${escapeHtml(fmtQuantityLines(s) || '—')}</dd>
            <dt>Category</dt><dd>${escapeHtml(s.category || '—')}</dd>
          </dl>
        </div>

        <div class="info-card">
          <h4>Shipment Scope &amp; Exception Control</h4>
          <dl class="kv-grid">
            <dt>Coverage</dt><dd>${escapeHtml(s.shipmentCoverage || '—')}</dd>
            <dt>Partial / Split Reason</dt><dd>${escapeHtml(s.partialShipmentReason || '—')}</dd>
            <dt>Same Vessel / Flight</dt><dd>${escapeHtml(ynLabel(s.sameMovement))}</dd>
            <dt>Transport Split</dt><dd>${escapeHtml(ynLabel(s.transportSplit))}</dd>
            <dt>Complete After This</dt><dd>${escapeHtml(ynLabel(s.expectedCompleteAfterShipment))}</dd>
            <dt>Receipt Result</dt><dd>${escapeHtml(s.receiptResult || '—')}</dd>
            <dt>Action Required</dt><dd>${actionBadge(s.followupAction)}</dd>
            ${s.followupActionProcessedBy ? `<dt>Processed By</dt><dd class="mono">${escapeHtml(s.followupActionProcessedBy)}</dd>` : ''}
            ${s.followupActionProcessedAt ? `<dt>Processed At</dt><dd>${fmtDate(s.followupActionProcessedAt)}</dd>` : ''}
            ${s.followupActionProcessedByShipmentId ? `<dt>Processed Via Shipment</dt><dd class="mono">${escapeHtml(s.followupActionProcessedByShipmentId)}</dd>` : ''}
            <dt>Control Note</dt><dd style="white-space:pre-wrap">${escapeHtml(s.movementSummary || '—')}</dd>
          </dl>
        </div>

        ${linkedOrder && linkedOrder.orderType === 'foreign' ? `
        <div class="info-card">
          <h4>Import / Clearance Tracking</h4>
          <dl class="kv-grid">
            <dt>Logistic / Booking</dt><dd>${fmtDate(s.bookingDate) || '<span class="empty">—</span>'}</dd>
            <dt>Shipping Docs V/S FPO</dt><dd>${fmtDate(s.shippingDocsDate) || '<span class="empty">—</span>'}</dd>
            <dt>Invoice to Accounts</dt><dd>${fmtDate(s.invoiceToAccountsDate) || '<span class="empty">—</span>'}</dd>
            <dt>COA Posted</dt><dd>${fmtDate(s.coaPostedDate) || '<span class="empty">—</span>'}</dd>
            <dt>No. of Containers</dt><dd>${s.containerCount != null && s.containerCount !== '' ? escapeHtml(String(s.containerCount)) : '<span class="empty">—</span>'}</dd>
            <dt>Clearance Owner</dt><dd>${escapeHtml(s.clearanceOwner || '—')}</dd>
            <dt>Clearance Started</dt><dd>${fmtDate(s.clearanceStartDate) || '<span class="empty">—</span>'}</dd>
            <dt>Clearance Status</dt><dd style="white-space:pre-wrap">${escapeHtml(s.clearanceStatus || '—')}</dd>
          </dl>
        </div>
        ` : ''}

        ${(s.freightForwarder||s.customsBroker||s.carrier||s.blAwbNumber||s.containerNumber||s.trackingNumber||s.bookingReference||s.portOfLoading||s.portOfDischarge||s.sealNumber) ? `
        <div class="info-card">
          <h4>Logistics Partners &amp; Tracking</h4>
          <dl class="kv-grid">
            ${s.freightForwarder ? `<dt>Freight Forwarder</dt><dd>${escapeHtml(s.freightForwarder)}</dd>` : ''}
            ${s.customsBroker ? `<dt>Customs Broker</dt><dd>${escapeHtml(s.customsBroker)}</dd>` : ''}
            ${s.carrier ? `<dt>Carrier / Line</dt><dd>${escapeHtml(s.carrier)}</dd>` : ''}
            ${s.bookingReference ? `<dt>Booking Ref</dt><dd class="mono">${escapeHtml(s.bookingReference)}</dd>` : ''}
            ${s.trackingNumber ? `<dt>Tracking No.</dt><dd class="mono">${escapeHtml(s.trackingNumber)}</dd>` : ''}
            ${s.blAwbNumber ? `<dt>BL / AWB</dt><dd class="mono">${escapeHtml(s.blAwbNumber)}</dd>` : ''}
            ${s.containerNumber ? `<dt>Container</dt><dd class="mono">${escapeHtml(s.containerNumber)}</dd>` : ''}
            ${s.sealNumber ? `<dt>Seal</dt><dd class="mono">${escapeHtml(s.sealNumber)}</dd>` : ''}
            ${s.portOfLoading ? `<dt>Port of Loading</dt><dd>${escapeHtml(s.portOfLoading)}</dd>` : ''}
            ${s.portOfDischarge ? `<dt>Port of Discharge</dt><dd>${escapeHtml(s.portOfDischarge)}</dd>` : ''}
          </dl>
        </div>` : ''}

        ${s.totalProvision != null ? `
        <div class="info-card">
          <h4>Tax Provision Forecast — TEPS</h4>
          <dl class="kv-grid">
            ${s.invoiceValue != null ? `<dt>Total Invoice</dt><dd>${fmtMoney(s.invoiceValue, s.invoiceCurrency || '')}</dd>` : ''}
            ${s.exchangeRate != null ? `<dt>Rate (to MUR)</dt><dd>${s.exchangeRate}</dd>` : ''}
            ${s.tepsFreight != null ? `<dt>Freight (MUR)</dt><dd>${fmtMoney(s.tepsFreight, 'MUR')}</dd>` : ''}
            ${s.cfrValue != null ? `<dt>CFR Value</dt><dd>${fmtMoney(s.cfrValue, 'MUR')}</dd>` : ''}
            ${s.tepsInsurance != null ? `<dt>Insurance</dt><dd>${fmtMoney(s.tepsInsurance, 'MUR')}</dd>` : ''}
            <dt>Excise &amp; Duties${s.isAlcohol ? ' <span class="est-tag">ALC</span>' : ''}</dt><dd>${s.exciseDuties != null && s.exciseDuties !== '' ? fmtMoney(s.exciseDuties, 'MUR') : '—'}</dd>
            ${s.tepsVat != null ? `<dt>VAT</dt><dd>${fmtMoney(s.tepsVat, 'MUR')}</dd>` : ''}
            <dt style="font-weight:700">Total Provision (estimate)</dt><dd style="font-weight:700;color:var(--copper,#A0522D)">${fmtMoney(s.totalProvision, 'MUR')}</dd>
            ${(function(){
              if (!window.PXLandedCost) return '';
              const lc = window.PXLandedCost.forShipment(s);
              if (lc.actual == null) {
                return lc.outstanding
                  ? `<dt style="grid-column:1/-1;color:var(--warn,#e67e22);font-size:11px;margin-top:6px">⚠ GRN recorded — actual landed cost not yet entered</dt><dd></dd>`
                  : '';
              }
              const fmt = v => v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
              const sign = lc.variance >= 0 ? '+' : '';
              const col = lc.variance > 0 ? 'var(--danger,#c0392b)' : lc.variance < 0 ? 'var(--success,#27ae60)' : 'var(--text)';
              return `
                <dt style="font-weight:700">Actual Landed Cost</dt><dd style="font-weight:700">MUR ${fmt(lc.actual)}</dd>
                <dt>Variance (actual − est.)</dt><dd style="color:${col};font-weight:600">${sign}MUR ${fmt(lc.variance)}${lc.variancePct!=null?' ('+sign+lc.variancePct.toFixed(1)+'%)':''}</dd>
                ${s.actualLandedCostDate ? `<dt>Confirmed on</dt><dd>${fmtDate(s.actualLandedCostDate)}</dd>` : ''}
                ${s.actualLandedCostNote ? `<dt>Note</dt><dd>${escapeHtml(s.actualLandedCostNote)}</dd>` : ''}
              `;
            })()}
          </dl>
          <div class="text-xs text-muted" style="margin-top:8px">Excise/Duties &amp; VAT estimate for A/C.</div>
        </div>` : ''}

        ${s.totalLandedCost != null ? `
        <div class="info-card">
          <h4>Landed Cost</h4>
          <dl class="kv-grid">
            ${s.freightCost != null ? `<dt>Freight</dt><dd>${fmtMoney(s.freightCost, s.currency || (linkedOrder&&linkedOrder.currency))}</dd>` : ''}
            ${s.insuranceCost != null ? `<dt>Insurance</dt><dd>${fmtMoney(s.insuranceCost, s.currency || (linkedOrder&&linkedOrder.currency))}</dd>` : ''}
            ${s.customsDuty != null ? `<dt>Customs Duty</dt><dd>${fmtMoney(s.customsDuty, s.currency || (linkedOrder&&linkedOrder.currency))}</dd>` : ''}
            ${s.vat != null ? `<dt>VAT</dt><dd>${fmtMoney(s.vat, s.currency || (linkedOrder&&linkedOrder.currency))}</dd>` : ''}
            ${s.brokerFee != null ? `<dt>Broker Fee</dt><dd>${fmtMoney(s.brokerFee, s.currency || (linkedOrder&&linkedOrder.currency))}</dd>` : ''}
            ${s.portStorageCharges != null ? `<dt>Port / Storage</dt><dd>${fmtMoney(s.portStorageCharges, s.currency || (linkedOrder&&linkedOrder.currency))}</dd>` : ''}
            ${s.demurrage != null ? `<dt>Demurrage</dt><dd>${fmtMoney(s.demurrage, s.currency || (linkedOrder&&linkedOrder.currency))}</dd>` : ''}
            ${s.detention != null ? `<dt>Detention</dt><dd>${fmtMoney(s.detention, s.currency || (linkedOrder&&linkedOrder.currency))}</dd>` : ''}
            ${s.otherCharges != null ? `<dt>Other</dt><dd>${fmtMoney(s.otherCharges, s.currency || (linkedOrder&&linkedOrder.currency))}</dd>` : ''}
            <dt style="font-weight:700">Total Landed Cost</dt><dd style="font-weight:700">${fmtMoney(s.totalLandedCost, s.currency || (linkedOrder&&linkedOrder.currency))}</dd>
          </dl>
        </div>` : ''}

        <div class="info-card">
          <h4>Document Checklist</h4>
          <div style="display: flex; flex-wrap: wrap; gap: 8px">
            ${docsChecklist.map(([name, d]) => `
              <span class="badge ${d ? 'success' : 'neutral'}">${d ? '✓' : '○'} ${escapeHtml(name)}${d ? ' · ' + fmtDate(d) : ''}</span>
            `).join('')}
          </div>
        </div>

        <div class="info-card">
          <h4>Clearance</h4>
          <dl class="kv-grid">
            <dt>Docs to Broker</dt><dd>${fmtDate(s.docsToBrokerDate) || '<span class="empty">—</span>'}</dd>
            <dt>Clearance Obtained</dt><dd>${fmtDate(s.clearanceDate) || '<span class="empty">—</span>'}</dd>
            <dt>Customs Release</dt><dd>${fmtDate(s.customsReleaseDate) || '<span class="empty">—</span>'}</dd>
            <dt>Delivery Date</dt><dd>${fmtDate(s.deliveryDate) || '<span class="empty">—</span>'}</dd>
          </dl>
        </div>
      </div>

      <div style="border-top:1px solid var(--line);margin:18px 0"></div>
      ${linkedOrder && window.renderOrderGrnsSection ? `<div id="grn-section-shipment-${s.id}">${window.renderOrderGrnsSection(linkedOrder, { shipmentId: s.id })}</div><div style="height:18px"></div>` : ''}
      <div id="issues-section-shipment-${s.id}">${window.renderIssuesSection ? window.renderIssuesSection('shipment', s.id) : ''}</div>
      <div style="height:18px"></div>
      <div id="documents-section-shipment-${s.id}">${window.renderDocumentsSection ? window.renderDocumentsSection('shipment', s.id) : ''}</div>
      <div style="height:18px"></div>
      <div id="updateRequests-section-shipment-${s.id}">${window.renderUpdateRequestsSection ? window.renderUpdateRequestsSection('shipment', s.id) : ''}</div>
      <div style="height:18px"></div>
      <div id="followups-section-shipment-${s.id}">${window.renderFollowupsSection ? window.renderFollowupsSection('shipment', s.id) : ''}</div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Close</button>
      ${canLogShipmentContact ? `<button class="btn" onclick="openContactLogModal('${s.id}', {relatedType:'shipment'})">Log contact</button>` : ''}
      ${canRequestShipmentUpdate ? `<button class="btn" onclick="openUpdateRequestModal('shipment','${s.id}')">Request update</button>` : ''}
      ${canEditShipments() ? `<button class="btn btn-primary" onclick="closeModal(); setTimeout(() => openShipmentForm('${s.id}'), 100)">Edit Shipment</button>` : '<span class="text-xs text-muted" style="align-self:center">View only — shipping details are maintained by logistics</span>'}
    </div>
  `, true);
  if (window.__setDetailContext) window.__setDetailContext('shipment', s.id);
};
