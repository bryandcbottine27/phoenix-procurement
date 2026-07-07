const { $, $$, fmtDate, fmtDateISO, fmtMoney, daysBetween, escapeHtml, statusBadgeClass,
  collection, addDoc, doc, getDoc, updateDoc, deleteDoc, serverTimestamp, toast,
  cmGetColumns, cmRenderTable, cmOpenManager, cmExportCSV, fmtQuantityLines,
  checkShipmentDuplicates, shipmentDataQuality, isErpOrder, renderErpBadge,
  currentEntity, recordEntity, entityMeta, stripUndefined, orderFunction, canEditShipments,
  shipmentStatusOptionsHtml, makeShipmentSequenceId, shipmentSequence } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;


window.openShipmentForm = function(shipId = null, orderId = '', supplier = '', opts = {}) {
  const isEdit = !!shipId;
  // Permission (defense in depth — the buttons are also hidden by role): shipments
  // are created/edited by logistics + admin. Other roles are view-only.
  if (!isEdit && !window.PXUtils.can('shipments', 'create')) {
    window.PXUtils.toast('You can view shipments, but you are not authorised to create one.', 'warn');
    return;
  }
  if (isEdit && !window.PXUtils.can('shipments', 'edit')) {
    window.PXUtils.toast('You can view shipments, but you are not authorised to edit them.', 'warn');
    return;
  }
  // For a new partial shipment, compute the next shipment sequence for this order.
  let presetShipmentId = '';
  if (!isEdit && orderId) {
    presetShipmentId = makeShipmentSequenceId(orderId);
  }
  const s = isEdit
    ? state.data.shipments.find(x => x.id === shipId)
    : {
        orderId,
        supplier,
        shipmentId: presetShipmentId,
        stage: opts.partial ? 'in_progress' : 'requested',
        status: opts.partial ? 'Collection to be arranged' : 'Shipment request received',
        shipmentCoverage: opts.partial ? 'Balance shipment' : 'Full order',
        partialShipmentReason: opts.partial ? 'Backorder / balance shipment' : '',
        expectedCompleteAfterShipment: opts.partial ? '' : 'yes',
        receiptResult: 'Not received yet'
      };
  if (!s) { toast('Shipment not found', 'danger'); return; }
  // Snapshot the record version at open time, to detect another officer saving first.
  const loadedUpdatedAt = isEdit ? (s.updatedAt || null) : null;

  // Permission: only logistics + admin may open the editable form at all
  if (!canEditShipments()) {
    if (isEdit) {
      toast('Shipments are edited by logistics. Opening read-only view instead.', 'warn');
      return window.openShipmentDetail(shipId);
    }
    toast('Only logistics can add or edit shipments', 'danger');
    return;
  }

  // Linked order (source of truth for PO details)
  const linkedOrder = s.orderId ? state.data.orders.find(o => o.orderId === s.orderId) : null;
  const optList = (list, current) => (list || []).map(v => `<option value="${escapeHtml(v)}" ${current===v?'selected':''}>${escapeHtml(v)}</option>`).join('');
  const yesNoOptions = current => [
    ['','—'],
    ['yes','Yes'],
    ['no','No']
  ].map(([v, label]) => `<option value="${v}" ${current===v?'selected':''}>${label}</option>`).join('');
  const priorCreateNextSource = data => {
    if (!data || !data.orderId) return null;
    const newSeq = shipmentSequence(data);
    return state.data.shipments
      .filter(sh => !sh.archived && sh.orderId === data.orderId && sh.id !== shipId &&
        sh.followupAction === 'Create next shipment' &&
        sh.followupActionStatus !== 'processed' && !sh.followupActionProcessedAt)
      .filter(sh => {
        const oldSeq = shipmentSequence(sh);
        return newSeq == null || oldSeq == null || oldSeq < newSeq;
      })
      .sort((a, b) => (shipmentSequence(b) || 0) - (shipmentSequence(a) || 0))[0] || null;
  };

  // Role gating
  const canAssign = canEditShipments();
  const stg = s.stage || 'requested';

  // Logistic officers for the assignment dropdown (role = logistics, plus admins)
  const logisticOfficers = state.data.officers.filter(o => (o.role === 'admin' || String(o.role || '').startsWith('logistics')) && o.active !== false);

  window.openModal(`
    <div class="modal-head">
      <div>
        <h2>${isEdit ? 'Shipment' : 'New Shipment'} ${escapeHtml(s.shipmentId || '')}</h2>
        <div class="sub">${REF.shipmentStages[stg] ? REF.shipmentStages[stg].label : stg}${s.requestedBy ? ' · requested by ' + escapeHtml(s.requestedBy) : ''}</div>
      </div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">

      ${linkedOrder ? `
        <div class="card mb-16" style="border-left:3px solid var(--primary); background:var(--primary-soft)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em">Purchase Order details (read-only, from linked order)</div>
            <button class="btn btn-sm" type="button" onclick="event.preventDefault(); closeModal(); setTimeout(() => openOrderDetail('${linkedOrder.id}'), 100)">View Order →</button>
          </div>
          <dl class="kv-grid" style="grid-template-columns:130px 1fr 130px 1fr;font-size:12.5px;gap:5px 14px">
            <dt>Order</dt><dd class="mono" style="font-weight:600">${escapeHtml(linkedOrder.orderId)}</dd>
            <dt>Supplier</dt><dd>${escapeHtml(linkedOrder.supplier || '—')}</dd>
            <dt>Category</dt><dd>${escapeHtml(linkedOrder.category || '—')}</dd>
            <dt>${(window.__iprLabel ? window.__iprLabel(linkedOrder) : 'IPR No.').replace(' No.', ' Number')}</dt><dd class="mono">${escapeHtml(linkedOrder.iprNumber || '—')}</dd>
            <dt>Description</dt><dd style="white-space:pre-wrap">${escapeHtml(linkedOrder.description || '—')}</dd>
            <dt>Quantity</dt><dd>${linkedOrder.quantity != null && linkedOrder.quantity !== '' ? escapeHtml(String(linkedOrder.quantity)) : '—'}</dd>
            <dt>Order Value</dt><dd style="font-weight:600">${fmtMoney(linkedOrder.amount, linkedOrder.currency)}</dd>
            <dt>Requested Receipt</dt><dd>${fmtDate(linkedOrder.requestedReceiptDate) || '—'}</dd>
          </dl>
        </div>
      ` : `
        <div class="alert-row danger" style="margin-bottom:14px">
          <div class="grow"><strong>No linked order found.</strong> This shipment references ${s.orderId ? '<span class="mono">'+escapeHtml(s.orderId)+'</span> which no longer exists' : 'no order'}. ${canAssign ? 'Pick a valid order below.' : 'Ask a manager to fix the link.'}</div>
        </div>
      `}

      <form id="ship-form">
        <input type="hidden" name="shipmentId" value="${escapeHtml(s.shipmentId||'')}" />
        <input type="hidden" name="supplier" value="${escapeHtml(s.supplier||linkedOrder?.supplier||'')}" />
        <input type="hidden" name="description" value="${escapeHtml(s.description||linkedOrder?.description||'')}" />

        <!-- ASSIGNMENT — Logistics Manager / admin only -->
        <div class="section-divider">Assignment ${canAssign ? '' : '<span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--muted-soft);font-size:11px">(managers only)</span>'}</div>
        <div class="form-grid cols-3">
          ${!linkedOrder && canAssign ? `
          <div class="field-group">
            <label>Linked Order <span class="req">*</span></label>
            <select name="orderId" required id="ship-order-select">
              <option value="">— Pick the PO —</option>
              ${state.data.orders.filter(ord => !ord.noShipment && recordEntity(ord) === currentEntity())
                .sort((a,b) => (b.dateOfOrder?.toDate ? b.dateOfOrder.toDate() : new Date(b.dateOfOrder||0)) - (a.dateOfOrder?.toDate ? a.dateOfOrder.toDate() : new Date(a.dateOfOrder||0)))
                .map(ord => `<option value="${escapeHtml(ord.orderId)}" ${s.orderId===ord.orderId?'selected':''}>${escapeHtml(ord.orderId)} (${ord.orderType === 'foreign' ? 'Foreign' : 'Local'}) — ${escapeHtml(ord.supplier||'')}</option>`).join('')}
            </select>
          </div>
          ` : `<input type="hidden" name="orderId" value="${escapeHtml(s.orderId||'')}" />`}
          <div class="field-group">
            <label>Stage</label>
            <select name="stage" ${canAssign ? '' : 'disabled'}>
              ${Object.entries(REF.shipmentStages).map(([k, v]) => `<option value="${k}" ${stg===k?'selected':''}>${escapeHtml(v.label)}</option>`).join('')}
            </select>
            ${!canAssign ? '<div class="hint">Set by logistics manager</div>' : ''}
          </div>
          <div class="field-group">
            <label>Logistic Officer (assigned)</label>
            <select name="logisticOfficer" ${canAssign ? '' : 'disabled'}>
              <option value="">— Unassigned —</option>
              <option value="Divish Koowaroo" ${s.logisticOfficer==='Divish Koowaroo'?'selected':''}>Divish Koowaroo</option>
              <option value="Miguel Cotte" ${s.logisticOfficer==='Miguel Cotte'?'selected':''}>Miguel Cotte</option>
              <option value="Vishesh Choa" ${s.logisticOfficer==='Vishesh Choa'?'selected':''}>Vishesh Choa</option>
              <option value="Jaypal Hauradhun" ${s.logisticOfficer==='Jaypal Hauradhun'?'selected':''}>Jaypal Hauradhun</option>
              ${logisticOfficers.filter(o => !['Divish Koowaroo','Miguel Cotte','Vishesh Choa','Jaypal Hauradhun'].includes(o.fullName)).map(o => `<option value="${escapeHtml(o.fullName||'')}" ${s.logisticOfficer===o.fullName?'selected':''}>${escapeHtml(o.fullName||'')}</option>`).join('')}
            </select>
            ${canAssign ? '<div class="hint">Manager assigns the officer who will process this</div>' : '<div class="hint">Assigned by manager</div>'}
          </div>
        </div>

        <div class="section-divider">Shipping Setup</div>
        <div class="form-grid cols-3">
          <div class="field-group">
            <label>Shipping Terms</label>
            <select name="shippingTerms">
              <option value="">—</option>
              ${REF.shippingTerms.map(t => `<option value="${t}" ${s.shippingTerms===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="field-group">
            <label>Conveyance</label>
            <select name="conveyance">
              <option value="">—</option>
              ${REF.conveyance.map(c => `<option value="${escapeHtml(c)}" ${s.conveyance===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}
            </select>
          </div>
          <div class="field-group">
            <label>Packing Details</label>
            <input type="text" name="packingDetails" list="packing-list" value="${escapeHtml(s.packingDetails||'')}" placeholder="e.g. 1X40FT" />
            <datalist id="packing-list">
              ${REF.packing.map(p => `<option value="${escapeHtml(p)}"></option>`).join('')}
            </datalist>
          </div>
          <div class="field-group">
            <label>Delivery Location</label>
            <select name="deliveryLocation">
              <option value="">—</option>
              ${REF.locations.map(l => `<option value="${escapeHtml(l)}" ${s.deliveryLocation===l?'selected':''}>${escapeHtml(l)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="section-divider">Shipment Scope &amp; Exception Control</div>
        <div class="form-grid cols-3">
          <div class="field-group">
            <label>Shipment Coverage</label>
            <select name="shipmentCoverage">
              <option value="">—</option>
              ${optList(REF.shipmentCoverageOptions, s.shipmentCoverage || '')}
            </select>
          </div>
          <div class="field-group">
            <label>Partial / Split Reason</label>
            <select name="partialShipmentReason">
              <option value="">—</option>
              ${optList(REF.partialShipmentReasons, s.partialShipmentReason || '')}
            </select>
          </div>
          <div class="field-group">
            <label>Expected Complete After This?</label>
            <select name="expectedCompleteAfterShipment">
              ${yesNoOptions(s.expectedCompleteAfterShipment || '')}
            </select>
          </div>
          <div class="field-group">
            <label>Same Vessel / Flight?</label>
            <select name="sameMovement">
              ${yesNoOptions(s.sameMovement || '')}
            </select>
            <div class="hint">Use Yes when multiple lots remain one logistics movement.</div>
          </div>
          <div class="field-group">
            <label>Transport Split?</label>
            <select name="transportSplit">
              ${yesNoOptions(s.transportSplit || '')}
            </select>
            <div class="hint">Use Yes when separate shipment records are needed by mode/route.</div>
          </div>
          <div class="field-group">
            <label>Receipt Result</label>
            <select name="receiptResult">
              <option value="">—</option>
              ${optList(REF.shipmentReceiptResults, s.receiptResult || '')}
            </select>
          </div>
          <div class="field-group">
            <label>Action Required</label>
            <select name="followupAction">
              <option value="">—</option>
              ${optList(REF.shipmentFollowupActions, s.followupAction || '')}
            </select>
          </div>
          <div class="field-group full">
            <label>What Is Moving / Control Note</label>
            <textarea name="movementSummary" placeholder="Short control summary only, e.g. urgent motor by air; balance spare parts by sea; S1 split into two lots on same vessel.">${escapeHtml(s.movementSummary || '')}</textarea>
            <div class="hint">Do not reproduce ERP PO lines here. ERP remains the item-line source of truth.</div>
          </div>
        </div>

        <div class="section-divider">Quantity / Packaging</div>
        <div id="ship-qty-container"></div>

        <div class="section-divider">Timeline</div>
        <div class="form-grid cols-3">
          <div class="field-group"><label>Status</label>
            <select name="status">
              <option value="">—</option>
              ${shipmentStatusOptionsHtml(s.status)}
            </select>
          </div>
          <div class="field-group"><label>Shipment Mode</label>
            <select name="shipmentMode">
              <option value="">—</option>
              ${REF.shipmentModes.map(m => `<option value="${m}" ${s.shipmentMode===m?'selected':''}>${m.charAt(0).toUpperCase()+m.slice(1)}</option>`).join('')}
            </select>
          </div>
          <div class="field-group"><label>Ready Date</label><input type="date" name="readyDate" value="${fmtDateISO(s.readyDate)}" /></div>
          <div class="field-group"><label>ETD</label><input type="date" name="etd" value="${fmtDateISO(s.etd)}" /></div>
          <div class="field-group"><label>Actual Departure</label><input type="date" name="actualDepartureDate" value="${fmtDateISO(s.actualDepartureDate)}" /></div>
          <div class="field-group"><label>ETA</label><input type="date" name="eta" value="${fmtDateISO(s.eta)}" />${Array.isArray(s.etaChangeHistory) && s.etaChangeHistory.length ? `<div class="hint">ETA changed ${s.etaChangeHistory.length} time(s); changes are logged automatically.</div>` : ''}</div>
          <div class="field-group"><label>Actual Arrival</label><input type="date" name="actualArrivalDate" value="${fmtDateISO(s.actualArrivalDate)}" /><div class="hint">True date goods arrived — this drives OTIF/punctuality (not the GRN date). Use Port Arrival below for sea-container tracking.</div></div>
          <div class="field-group"><label>Delivery Date</label><input type="date" name="deliveryDate" value="${fmtDateISO(s.deliveryDate)}" /><div class="hint">Preferred receipt date for OTIF; GRN date remains the fallback.</div></div>
          <div class="field-group"><label>Vessel / Flight</label><input type="text" name="vesselFlight" value="${escapeHtml(s.vesselFlight||'')}" /></div>
          <div class="field-group"><label>GRN Number</label><input type="text" name="grnNumber" value="${escapeHtml(s.grnNumber||'')}" /></div>
          <div class="field-group"><label>GRN Date</label><input type="date" name="grnDate" value="${fmtDateISO(s.grnDate)}" /><div class="hint">Store's GRN paperwork date. Used as receipt fallback when Delivery Date is blank.</div></div>
          <div class="field-group">
            <label>Completed</label>
            <label style="font-weight:normal;padding-top:8px"><input type="checkbox" name="completed" ${s.completed?'checked':''} style="width:auto;margin-right:6px"> Mark as completed</label>
          </div>
        </div>

        <div class="section-divider">Shipping Documents</div>
        <div class="form-grid cols-3">
          <div class="field-group"><label>Invoice Received</label><input type="date" name="invoiceReceivedDate" value="${fmtDateISO(s.invoiceReceivedDate)}" /></div>
          <div class="field-group"><label>Packing List</label><input type="date" name="packingListDate" value="${fmtDateISO(s.packingListDate)}" /></div>
          <div class="field-group"><label>Bill of Lading / AWB</label><input type="date" name="blDate" value="${fmtDateISO(s.blDate)}" /></div>
          <div class="field-group"><label>COA</label><input type="date" name="coaDate" value="${fmtDateISO(s.coaDate)}" /></div>
          <div class="field-group"><label>Health Certificate</label><input type="date" name="healthCertDate" value="${fmtDateISO(s.healthCertDate)}" /></div>
          <div class="field-group full"><label>Other Documents</label><input type="text" name="otherDocs" value="${escapeHtml(s.otherDocs||'')}" placeholder="Free text" /></div>
        </div>

        ${linkedOrder && linkedOrder.orderType === 'foreign' ? `
        <div class="section-divider">Import / Clearance Tracking</div>
        <div class="form-grid cols-3">
          <div class="field-group"><label>Logistic / Booking Date</label><input type="date" name="bookingDate" value="${fmtDateISO(s.bookingDate)}" /></div>
          <div class="field-group"><label>Shipping Docs V/S FPO</label><input type="date" name="shippingDocsDate" value="${fmtDateISO(s.shippingDocsDate)}" /><div class="hint">Receipt / validation / modification of shipping docs against FPO</div></div>
          <div class="field-group"><label>Invoice Sent to Accounts</label><input type="date" name="invoiceToAccountsDate" value="${fmtDateISO(s.invoiceToAccountsDate)}" /><div class="hint">For costing purposes</div></div>
          <div class="field-group"><label>COA Posted Date</label><input type="date" name="coaPostedDate" value="${fmtDateISO(s.coaPostedDate)}" /></div>
          <div class="field-group"><label>No. of Containers</label><input type="number" name="containerCount" step="1" min="0" value="${s.containerCount!=null?s.containerCount:''}" /></div>
          <div class="field-group"><label>Clearance Owner</label><select name="clearanceOwner"><option value="">-</option>${state.data.officers.filter(officer => officer.active !== false).map(officer => `<option value="${escapeHtml(officer.code||'')}" ${s.clearanceOwner===officer.code?'selected':''}>${escapeHtml(officer.fullName||officer.code)} (${escapeHtml(officer.code||'')})</option>`).join('')}</select></div>
          <div class="field-group"><label>Clearance Start Date</label><input type="date" name="clearanceStartDate" value="${fmtDateISO(s.clearanceStartDate)}" /></div>
          <div class="field-group full"><label>Clearance Status</label><input type="text" name="clearanceStatus" value="${escapeHtml(s.clearanceStatus||'')}" placeholder="e.g. UNDER CLEARANCE 07/05/26 · clearance obtained 10/06/2026" /></div>
        </div>

        ${(s.mode||s.shipmentMode||'').toLowerCase() === 'sea' ? `
        <div class="section-divider">Container Demurrage &amp; Detention Tracker <span class="hint" style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--muted-soft);font-size:11px">(Increment 3 — sea shipments only)</span></div>
        <div class="form-grid cols-3">
          <div class="field-group"><label>Port Arrival Date <span class="hint" style="text-transform:none;font-weight:400;font-size:10px">vessel/container at discharge port</span></label><input type="date" name="portArrivalDate" value="${fmtDateISO(s.portArrivalDate)}" /></div>
          <div class="field-group"><label>Demurrage Free Days</label><input type="number" step="1" min="0" name="demurrageFreeDays" value="${s.demurrageFreeDays??''}" placeholder="e.g. 7" /></div>
          <div class="field-group"><label>Container Pickup Date <span class="hint" style="text-transform:none;font-weight:400;font-size:10px">leaves port — dem. stops, det. starts</span></label><input type="date" name="containerPickupDate" value="${fmtDateISO(s.containerPickupDate)}" /></div>
          <div class="field-group"><label>Detention Free Days</label><input type="number" step="1" min="0" name="detentionFreeDays" value="${s.detentionFreeDays??''}" placeholder="e.g. 14" /></div>
          <div class="field-group"><label>Empty Return Date <span class="hint" style="text-transform:none;font-weight:400;font-size:10px">container back to shipping line</span></label><input type="date" name="containerReturnDate" value="${fmtDateISO(s.containerReturnDate)}" /></div>
          <div class="field-group"><label>Tracker Currency</label>
            <select name="trackerCurrency">
              ${['USD','EUR','GBP','MUR','AED'].map(c=>`<option value="${c}" ${(s.trackerCurrency||'USD')===c?'selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="field-group"><label>Demurrage Rate / container / day</label><input type="number" step="0.01" min="0" name="demurrageRatePerDay" value="${s.demurrageRatePerDay??''}" placeholder="e.g. 50" /></div>
          <div class="field-group"><label>Detention Rate / container / day</label><input type="number" step="0.01" min="0" name="detentionRatePerDay" value="${s.detentionRatePerDay??''}" placeholder="e.g. 25" /></div>
        </div>
        <div id="dem-status-bar" style="margin-bottom:12px;padding:10px 14px;border-radius:6px;border:1px solid var(--line);background:var(--surface-warm);display:none">
          <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
            <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:4px">Demurrage clock</div><div id="dem-status-dem" style="font-size:13px;font-weight:600">—</div></div>
            <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:4px">Detention clock</div><div id="dem-status-det" style="font-size:13px;font-weight:600">—</div></div>
            <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:4px">Projected exposure</div><div id="dem-status-cost" style="font-size:13px;font-weight:700;color:var(--danger,#c0392b)">—</div></div>
          </div>
        </div>
        ` : ''}
        ` : ''}

        <div class="section-divider">Logistics Partners &amp; Tracking</div>
        <div class="form-grid cols-3">
          <div class="field-group"><label>Freight Forwarder</label><input type="text" name="freightForwarder" value="${escapeHtml(s.freightForwarder||'')}" placeholder="e.g. DHL Global" /></div>
          <div class="field-group"><label>Customs Broker</label><input type="text" name="customsBroker" value="${escapeHtml(s.customsBroker||'')}" placeholder="Clearing agent" /></div>
          <div class="field-group"><label>Carrier / Line / Airline</label><input type="text" name="carrier" value="${escapeHtml(s.carrier||'')}" placeholder="e.g. CMA CGM" /></div>
          <div class="field-group"><label>Booking Reference</label><input type="text" name="bookingReference" value="${escapeHtml(s.bookingReference||'')}" /></div>
          <div class="field-group"><label>Tracking Number</label><input type="text" name="trackingNumber" value="${escapeHtml(s.trackingNumber||'')}" /></div>
          <div class="field-group"><label>BL / AWB Number</label><input type="text" name="blAwbNumber" value="${escapeHtml(s.blAwbNumber||'')}" /></div>
          <div class="field-group"><label>Container Number</label><input type="text" name="containerNumber" value="${escapeHtml(s.containerNumber||'')}" /></div>
          <div class="field-group"><label>Seal Number</label><input type="text" name="sealNumber" value="${escapeHtml(s.sealNumber||'')}" /></div>
          <div class="field-group"><label>Port of Loading</label><input type="text" name="portOfLoading" value="${escapeHtml(s.portOfLoading||'')}" placeholder="e.g. Genoa" /></div>
          <div class="field-group"><label>Port of Discharge</label><input type="text" name="portOfDischarge" value="${escapeHtml(s.portOfDischarge||'')}" placeholder="e.g. Port Louis" /></div>
        </div>

        <div class="section-divider">Tax Provision Forecast — TEPS <span class="hint" style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--muted-soft);font-size:11px">(Excise/Duties &amp; VAT estimate for A/C cash provisioning)</span></div>
        <div class="form-grid cols-3">
          <div class="field-group"><label>Total Invoice (goods)</label><input type="number" step="0.01" name="invoiceValue" value="${s.invoiceValue??''}" class="teps-input" /></div>
          <div class="field-group"><label>Invoice Currency</label>
            <select name="invoiceCurrency" class="teps-input">
              <option value="">—</option>
              ${(REF.currencies||['USD','EUR','GBP','ZAR','AUD','CHF','MUR']).map(c=>`<option value="${c}" ${s.invoiceCurrency===c?'selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="field-group"><label>Exchange Rate (to MUR)</label><input type="number" step="0.0001" name="exchangeRate" value="${s.exchangeRate??''}" class="teps-input" /></div>
          <div class="field-group"><label>Freight (in MUR)</label><input type="number" step="0.01" name="tepsFreight" value="${s.tepsFreight??''}" class="teps-input" /></div>
          <div class="field-group"><label>Insurance Rate (%)</label><input type="number" step="0.01" name="insuranceRate" value="${s.insuranceRate ?? 0.2}" class="teps-input" /></div>
          <div class="field-group"><label>VAT Rate (%)</label><input type="number" step="0.01" name="vatRate" value="${s.vatRate ?? 15}" class="teps-input" /></div>
          <div class="field-group">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" name="isAlcohol" class="teps-input" ${s.isAlcohol ? 'checked' : ''} style="width:auto;margin:0" />
              Alcoholic beverage?
            </label>
            <span class="hint" style="font-size:10px;color:var(--muted-soft)">Excise &amp; Duties applies to alcohol only</span>
          </div>
          <div class="field-group"><label>Excise &amp; Duties <span class="hint" style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--muted-soft);font-size:10px">(alcohol only — from MRA)</span></label><input type="number" step="0.01" name="exciseDuties" value="${s.exciseDuties??''}" class="teps-input" /><span id="teps-excise-reminder" style="display:none;font-size:10px;color:var(--copper,#A0522D);margin-top:2px">Marked alcoholic — remember to enter Excise &amp; Duties from the MRA tariff.</span></div>
        </div>
        <div class="card" style="background:var(--surface-warm);padding:12px 14px;margin-bottom:8px">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px">
            <div>CFR Value (MUR)<div id="teps-cfr" style="font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:14px;color:var(--text)">—</div></div>
            <div>Insurance (MUR)<div id="teps-ins" style="font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:14px;color:var(--text)">—</div></div>
            <div>VAT (MUR)<div id="teps-vat" style="font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:14px;color:var(--text)">—</div></div>
          </div>
          <div style="border-top:1px solid var(--line);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;font-weight:600">Total Provision (Excise &amp; Duties + VAT)</span>
            <span id="teps-total" style="font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:16px;color:var(--copper, #A0522D)">—</span>
          </div>
        </div>

        <div class="section-divider">Landed Cost <span class="hint" style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--muted-soft);font-size:11px">(Phoenix-owned — operational visibility, not ERP accounting)</span></div>
        <div class="form-grid cols-3">
          <div class="field-group"><label>Freight Cost</label><input type="number" step="0.01" name="freightCost" value="${s.freightCost??''}" class="lc-input" /></div>
          <div class="field-group"><label>Insurance</label><input type="number" step="0.01" name="insuranceCost" value="${s.insuranceCost??''}" class="lc-input" /></div>
          <div class="field-group"><label>Customs Duty</label><input type="number" step="0.01" name="customsDuty" value="${s.customsDuty??''}" class="lc-input" /></div>
          <div class="field-group"><label>VAT</label><input type="number" step="0.01" name="vat" value="${s.vat??''}" class="lc-input" /></div>
          <div class="field-group"><label>Broker Fee</label><input type="number" step="0.01" name="brokerFee" value="${s.brokerFee??''}" class="lc-input" /></div>
          <div class="field-group"><label>Port / Storage Charges</label><input type="number" step="0.01" name="portStorageCharges" value="${s.portStorageCharges??''}" class="lc-input" /></div>
          <div class="field-group"><label>Demurrage</label><input type="number" step="0.01" name="demurrage" value="${s.demurrage??''}" class="lc-input" /></div>
          <div class="field-group"><label>Detention</label><input type="number" step="0.01" name="detention" value="${s.detention??''}" class="lc-input" /></div>
          <div class="field-group"><label>Other Charges</label><input type="number" step="0.01" name="otherCharges" value="${s.otherCharges??''}" class="lc-input" /></div>
        </div>
        <div class="card" style="background:var(--surface-warm);padding:10px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;font-weight:600">Total Landed Cost (charges)</span>
          <span id="lc-total" style="font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:15px">—</span>
        </div>

        <div class="section-divider">Actual Landed Cost vs TEPS Estimate <span class="hint" style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--muted-soft);font-size:11px">(Increment 2 — enter once final duty/VAT/freight invoices received)</span></div>
        <div class="form-grid cols-3">
          <div class="field-group"><label>Actual Landed Cost (MUR) <span class="hint" style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--muted-soft);font-size:10px">post-clearance total</span></label><input type="number" step="0.01" name="actualLandedCostMUR" value="${s.actualLandedCostMUR??''}" id="alc-input" /></div>
          <div class="field-group"><label>Date Confirmed</label><input type="date" name="actualLandedCostDate" value="${fmtDateISO(s.actualLandedCostDate)}" /></div>
          <div class="field-group"><label>Note <span class="hint" style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--muted-soft);font-size:10px">e.g. customs decl. ref</span></label><input type="text" name="actualLandedCostNote" value="${escapeHtml(s.actualLandedCostNote||'')}" maxlength="200" /></div>
        </div>
        <div id="alc-variance-bar" style="display:none;margin-bottom:12px;padding:10px 14px;border-radius:6px;border:1px solid var(--line);background:var(--surface-warm)">
          <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:center">
            <div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;font-weight:600">TEPS Estimate</span><span id="alc-estimate" style="font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:14px;color:var(--copper,#A0522D)">—</span></div>
            <div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;font-weight:600">Actual (MUR)</span><span id="alc-actual" style="font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:14px">—</span></div>
            <div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;font-weight:600">Variance</span><span id="alc-var" style="font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:14px">—</span></div>
            <div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;font-weight:600">Var %</span><span id="alc-var-pct" style="font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:14px">—</span></div>
          </div>
        </div>

        <div class="section-divider">Clearance &amp; KPIs</div>
        <div class="form-grid cols-3">
          <div class="field-group"><label>Docs to Broker</label><input type="date" name="docsToBrokerDate" value="${fmtDateISO(s.docsToBrokerDate)}" /></div>
          <div class="field-group"><label>Clearance Obtained</label><input type="date" name="clearanceDate" value="${fmtDateISO(s.clearanceDate)}" /></div>
          <div class="field-group"><label>Customs Release Date</label><input type="date" name="customsReleaseDate" value="${fmtDateISO(s.customsReleaseDate)}" /></div>
        </div>
      </form>
    </div>
    <div class="modal-foot">
      ${isEdit && window.PXUtils.can('shipments','archive') ? '<button class="btn btn-danger" id="delete-ship-btn" style="margin-right:auto">Archive</button>' : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="save-ship-btn">${isEdit ? 'Save Changes' : 'Create Shipment'}</button>
    </div>
  `, true);

  /* ===== Quantity / Packaging repeatable rows ===== */
  let qtyLines = Array.isArray(s.quantityLines) && s.quantityLines.length
    ? s.quantityLines.map(l => ({ qty: l.qty ?? '', unit: l.unit ?? '' }))
    : (s.quantity ? [{ qty: '', unit: '', legacyNote: String(s.quantity) }] : []);

  function renderQtyRows() {
    const c = $('#ship-qty-container');
    if (!c) return;
    c.innerHTML = `
      ${qtyLines.length === 0 ? '<div class="text-xs text-muted" style="margin-bottom:8px">No packaging lines yet. Add how the goods arrive (e.g. 2 Wooden Crate(s) + 1 Carton(s)).</div>' : ''}
      ${qtyLines.map((l, idx) => `
        <div class="form-grid cols-3" style="margin-bottom:8px;align-items:end">
          <div class="field-group" style="margin:0">
            ${idx === 0 ? '<label>Number</label>' : ''}
            <input type="number" min="0" step="1" data-qrow="${idx}" data-qfield="qty" value="${l.qty ?? ''}" placeholder="e.g. 2" />
          </div>
          <div class="field-group" style="margin:0">
            ${idx === 0 ? '<label>Unit</label>' : ''}
            <select data-qrow="${idx}" data-qfield="unit">
              <option value="">— unit —</option>
              ${REF.packagingUnits.map(u => `<option value="${escapeHtml(u)}" ${l.unit===u?'selected':''}>${escapeHtml(u)}</option>`).join('')}
            </select>
          </div>
          <div class="field-group" style="margin:0">
            ${idx === 0 ? '<label>&nbsp;</label>' : ''}
            <button type="button" class="btn btn-sm" data-qremove="${idx}" style="color:var(--danger)">✕ Remove</button>
          </div>
          ${l.legacyNote ? `<div class="text-xs text-muted" style="grid-column:1/-1;margin-top:-4px">Legacy value: "${escapeHtml(l.legacyNote)}" — re-enter as number + unit.</div>` : ''}
        </div>
      `).join('')}
      <button type="button" class="btn btn-sm" id="ship-qty-add">+ Add packaging line</button>
    `;
    c.querySelectorAll('[data-qrow]').forEach(el => {
      el.addEventListener('change', e => {
        const idx = +e.target.dataset.qrow, field = e.target.dataset.qfield;
        qtyLines[idx][field] = field === 'qty' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
      });
    });
    c.querySelectorAll('[data-qremove]').forEach(el => {
      el.addEventListener('click', e => { qtyLines.splice(+e.target.dataset.qremove, 1); renderQtyRows(); });
    });
    const addBtn = $('#ship-qty-add');
    if (addBtn) addBtn.addEventListener('click', () => { qtyLines.push({ qty: '', unit: '' }); renderQtyRows(); });
  }
  renderQtyRows();

  /* ===== Live landed-cost total ===== */
  function recalcLandedCost() {
    const totalEl = $('#lc-total');
    if (!totalEl) return;
    let sum = 0, any = false;
    $$('.lc-input').forEach(inp => { const v = parseFloat(inp.value); if (!isNaN(v)) { sum += v; any = true; } });
    const cur = (linkedOrder && linkedOrder.currency) || s.currency || '';
    totalEl.textContent = any ? `${cur} ${sum.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}` : '—';
  }
  $$('.lc-input').forEach(inp => inp.addEventListener('input', recalcLandedCost));
  recalcLandedCost();

  /* ===== Live TEPS tax-provision calc =====
     CFR = Freight(MUR) + Invoice*Rate ; Insurance = CFR*ins% ;
     VAT = (CFR + Insurance)*vat% ; Total = VAT + Excise&Duties. */
  function recalcTeps() {
    const cfrEl = $('#teps-cfr'); if (!cfrEl) return;
    const num = n => { const v = parseFloat(($$(`[name="${n}"]`)[0]||{}).value); return isNaN(v) ? 0 : v; };
    const has = n => { const el = $$(`[name="${n}"]`)[0]; return el && el.value !== '' && !isNaN(parseFloat(el.value)); };
    const invoice = num('invoiceValue'), rate = num('exchangeRate'), freight = num('tepsFreight');
    const insRate = has('insuranceRate') ? num('insuranceRate') : 0.2;
    const vatRate = has('vatRate') ? num('vatRate') : 15;
    const excise = num('exciseDuties');
    const cfr = freight + invoice * rate;
    const insurance = cfr * (insRate / 100);
    const vat = (cfr + insurance) * (vatRate / 100);
    const total = vat + excise;
    const anyInput = has('invoiceValue') || has('tepsFreight') || has('exciseDuties');
    const fmt = v => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    cfrEl.textContent = anyInput ? fmt(cfr) : '—';
    $('#teps-ins').textContent = anyInput ? fmt(insurance) : '—';
    $('#teps-vat').textContent = anyInput ? fmt(vat) : '—';
    $('#teps-total').textContent = anyInput ? `MUR ${fmt(total)}` : '—';
    // Alcohol reminder: show if ticked but Excise empty
    const alc = $$('[name="isAlcohol"]')[0];
    const rem = $('#teps-excise-reminder');
    if (rem) rem.style.display = (alc && alc.checked && !has('exciseDuties')) ? 'block' : 'none';
  }
  $$('.teps-input').forEach(inp => {
    inp.addEventListener('input', recalcTeps);
    inp.addEventListener('change', recalcTeps);
  });
  recalcTeps();

  /* ===== Live Actual Landed Cost vs TEPS variance (Increment 2) ===== */
  function recalcALCVariance() {
    const bar = $('#alc-variance-bar');
    if (!bar) return;
    const alcEl = $('#alc-input');
    const alcVal = alcEl ? parseFloat(alcEl.value) : NaN;
    const tepsTotalEl = $('#teps-total');
    let estimate = null;
    if (tepsTotalEl && tepsTotalEl.textContent && tepsTotalEl.textContent !== '—') {
      const v = parseFloat(tepsTotalEl.textContent.replace(/[^0-9.]/g, ''));
      if (!isNaN(v) && v > 0) estimate = v;
    }
    if (isNaN(alcVal) || alcVal <= 0) { bar.style.display = 'none'; return; }
    bar.style.display = 'block';
    const fmt = v => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const estEl = $('#alc-estimate'), actEl = $('#alc-actual'), varEl = $('#alc-var'), pctEl = $('#alc-var-pct');
    if (estEl) estEl.textContent = estimate != null ? `MUR ${fmt(estimate)}` : '—';
    if (actEl) actEl.textContent = `MUR ${fmt(alcVal)}`;
    if (estimate != null) {
      const variance = alcVal - estimate;
      const pct = estimate !== 0 ? (variance / estimate * 100) : null;
      const col = variance > 0 ? 'var(--danger,#c0392b)' : variance < 0 ? 'var(--success,#27ae60)' : 'var(--text)';
      const sign = variance >= 0 ? '+' : '';
      if (varEl) { varEl.textContent = `${sign}MUR ${fmt(variance)}`; varEl.style.color = col; }
      if (pctEl) { pctEl.textContent = pct != null ? `${sign}${pct.toFixed(1)}%` : '—'; pctEl.style.color = col; }
    } else {
      if (varEl) { varEl.textContent = '—'; varEl.style.color = ''; }
      if (pctEl) { pctEl.textContent = '—'; pctEl.style.color = ''; }
    }
  }
  const alcInp = $('#alc-input');
  if (alcInp) alcInp.addEventListener('input', recalcALCVariance);
  $$('.teps-input').forEach(inp => inp.addEventListener('input', recalcALCVariance));
  recalcALCVariance();

  /* ===== Live Container Tracker status (Increment 3) ===== */
  (function() {
    const bar = $('#dem-status-bar');
    if (!bar || !window.PXDemurrage) return;
    function update() {
      const g = name => { const el = $$(`[name="${name}"]`)[0]; return el ? el.value : ''; };
      const synthetic = {
        portArrivalDate: g('portArrivalDate'), containerPickupDate: g('containerPickupDate'),
        containerReturnDate: g('containerReturnDate'), demurrageFreeDays: g('demurrageFreeDays') || null,
        detentionFreeDays: g('detentionFreeDays') || null, demurrageRatePerDay: g('demurrageRatePerDay') || null,
        detentionRatePerDay: g('detentionRatePerDay') || null, trackerCurrency: g('trackerCurrency') || 'USD',
        containerCount: g('containerCount') || 1
      };
      if (!synthetic.portArrivalDate) { bar.style.display = 'none'; return; }
      bar.style.display = 'block';
      const t = window.PXDemurrage.forShipment(synthetic);
      const statusLabel = { overdue:'OVERDUE', warning:'AT RISK', clear:'OK', closed:'CLOSED', inactive:'NOT STARTED', 'active-no-limit':'RUNNING' };
      const statusCol = { overdue:'var(--danger,#c0392b)', warning:'var(--warn,#e67e22)', clear:'var(--success,#27ae60)', closed:'var(--muted)', inactive:'var(--muted)', 'active-no-limit':'var(--text)' };
      const clockText = clock => {
        const lbl = statusLabel[clock.status] || clock.status;
        const col = statusCol[clock.status] || 'var(--text)';
        const detail = clock.elapsed != null ? ` · ${clock.elapsed}d elapsed` : '';
        const rem = clock.remaining != null ? (clock.remaining >= 0 ? `, ${clock.remaining}d remaining` : `, ${-clock.remaining}d over`) : '';
        return `<span style="color:${col}">${lbl}${detail}${rem}</span>`;
      };
      const demEl = $('#dem-status-dem'); if (demEl) demEl.innerHTML = clockText(t.demurrage);
      const detEl = $('#dem-status-det'); if (detEl) detEl.innerHTML = (t.demurrage.status !== 'inactive' && synthetic.containerPickupDate)
        ? clockText(t.detention) : '<span class="text-muted">awaiting pickup</span>';
      const costEl = $('#dem-status-cost');
      if (costEl) costEl.textContent = t.totalCost != null
        ? `${t.cur} ${t.totalCost.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} projected` : '—';
    }
    ['portArrivalDate','containerPickupDate','containerReturnDate','demurrageFreeDays',
     'detentionFreeDays','demurrageRatePerDay','detentionRatePerDay','containerCount'].forEach(name => {
      const el = $$(`[name="${name}"]`)[0];
      if (el) { el.addEventListener('input', update); el.addEventListener('change', update); }
    });
    update();
  })();

  // When picking an order (only shown for managers fixing an orphan), sync hidden fields
  const orderSelect = $('#ship-order-select');
  if (orderSelect) {
    orderSelect.addEventListener('change', e => {
      const picked = state.data.orders.find(ord => ord.orderId === e.target.value);
      if (picked) {
        const supEl = $$('input[name="supplier"]')[0];
        const descEl = $$('input[name="description"]')[0];
        if (supEl) supEl.value = picked.supplier || '';
        if (descEl && !descEl.value) descEl.value = picked.description || '';
      }
    });
  }

  // When a logistic officer is assigned and stage is still 'requested', auto-advance to 'assigned'
  const stageSelect = $$('select[name="stage"]')[0];
  const officerSelect = $$('select[name="logisticOfficer"]')[0];
  if (officerSelect && stageSelect) {
    officerSelect.addEventListener('change', e => {
      if (e.target.value && stageSelect.value === 'requested') {
        stageSelect.value = 'assigned';
      }
    });
  }

  $('#save-ship-btn').addEventListener('click', async () => {
    const fd = new FormData($('#ship-form'));
    const data = {};
    fd.forEach((v, k) => {
      if (v === '' || v === null) data[k] = null;
      else if (k === 'completed') data[k] = v === 'on';
      else if (k.endsWith('Date') || k === 'etd' || k === 'eta') data[k] = v ? new Date(v) : null;
      else data[k] = v;
    });
    if (!data.shipmentId) { toast('Shipment ID is required', 'danger'); return; }
    if (!data.orderId) { toast('A linked purchase order is required for every shipment', 'danger'); return; }
    // Soft duplicate warning for shipment ID reuse
    const shipDupW = checkShipmentDuplicates(data, state.data.shipments, isEdit, isEdit ? shipId : null);
    if (shipDupW.length) {
      toast(shipDupW[0], 'danger');
      return;
    }
    // Validate the linked order actually exists
    const linkedOrder = state.data.orders.find(ord => ord.orderId === data.orderId);
    if (!linkedOrder) { toast('Linked order not found: ' + data.orderId, 'danger'); return; }
    if (linkedOrder.noShipment) { toast('This linked order is marked as no shipment required.', 'danger'); return; }
    // Sync derived fields from the order (single source of truth)
    data.supplier = linkedOrder.supplier || data.supplier || null;
    data.category = linkedOrder.category || null;
    if (!data.description) data.description = linkedOrder.description || null;

    // Stage / completed coherence: 'completed' stage sets completed flag and vice versa
    if (data.stage === 'completed') data.completed = true;
    else data.completed = false;
    if (!data.stage) data.stage = s.stage || 'requested';

    // Keep a compact, immutable operational history only when a previously-set ETA changes.
    // The first ETA is a plan, not a change; history is capped to keep Firestore records small.
    const dayKey = value => { const date = value && (value.toDate ? value.toDate() : new Date(value)); return date && !isNaN(date) ? date.toISOString().slice(0, 10) : ''; };
    if (isEdit && dayKey(s.eta) && dayKey(data.eta) && dayKey(s.eta) !== dayKey(data.eta)) {
      const history = Array.isArray(s.etaChangeHistory) ? s.etaChangeHistory.slice(-49) : [];
      history.push({ previousEta: dayKey(s.eta), newEta: dayKey(data.eta), changedAt: new Date(), changedBy: state.officer?.code || '' });
      data.etaChangeHistory = history;
    } else if (isEdit) {
      data.etaChangeHistory = Array.isArray(s.etaChangeHistory) ? s.etaChangeHistory : [];
    } else {
      data.etaChangeHistory = [];
    }

    // Quantity / packaging lines (logistics). Keep only rows with a unit or a number.
    data.quantityLines = qtyLines
      .filter(l => (l.qty !== '' && l.qty != null) || l.unit)
      .map(l => ({ qty: (l.qty === '' || l.qty == null) ? null : Number(l.qty), unit: l.unit || null }));

    // Landed cost: coerce numeric cost fields, compute total (Phoenix-owned)
    const costKeys = ['freightCost','insuranceCost','customsDuty','vat','brokerFee','portStorageCharges','demurrage','detention','otherCharges'];
    let landedTotal = 0, anyCost = false;
    costKeys.forEach(k => {
      const v = (data[k] === '' || data[k] == null) ? null : Number(data[k]);
      data[k] = (v === null || isNaN(v)) ? null : v;
      if (data[k] != null) { landedTotal += data[k]; anyCost = true; }
    });
    data.totalLandedCost = anyCost ? landedTotal : null;

    // TEPS tax provision: coerce inputs, compute & persist CFR/Insurance/VAT/Total (Phoenix-owned forecast)
    const tepsNumKeys = ['invoiceValue','exchangeRate','tepsFreight','insuranceRate','vatRate','exciseDuties'];
    tepsNumKeys.forEach(k => {
      const v = (data[k] === '' || data[k] == null) ? null : Number(data[k]);
      data[k] = (v === null || isNaN(v)) ? null : v;
    });
    data.isAlcohol = !!data.isAlcohol;
    // Supply-chain numeric field
    if (data.containerCount != null && data.containerCount !== '') {
      const cc = parseInt(data.containerCount, 10); data.containerCount = isNaN(cc) ? null : cc;
    } else { data.containerCount = null; }
    const _inv = data.invoiceValue || 0, _rate = data.exchangeRate || 0, _frt = data.tepsFreight || 0;
    const _insRate = data.insuranceRate == null ? 0.2 : data.insuranceRate;
    const _vatRate = data.vatRate == null ? 15 : data.vatRate;
    const _excise = data.exciseDuties || 0;
    const _hasTeps = data.invoiceValue != null || data.tepsFreight != null || data.exciseDuties != null;
    if (_hasTeps) {
      data.cfrValue = _frt + _inv * _rate;
      data.tepsInsurance = data.cfrValue * (_insRate / 100);
      data.tepsVat = (data.cfrValue + data.tepsInsurance) * (_vatRate / 100);
      data.totalProvision = data.tepsVat + _excise;
    } else {
      data.cfrValue = null; data.tepsInsurance = null; data.tepsVat = null; data.totalProvision = null;
    }

    if (window.PXValidators) {
      const v = window.PXValidators.validate('shipment', data, isEdit ? s : null);
      if (!v.ok) { toast('Cannot save: ' + v.errors[0], 'danger'); return; }
      if (v.warnings.length && !confirm('Please confirm:\n\n• ' + v.warnings.join('\n• ') + '\n\nSave anyway?')) return;
    }

    $('#save-ship-btn').disabled = true;
    $('#save-ship-btn').innerHTML = '<span class="spinner"></span> Saving…';
    try {
      // Inherit entity from the linked order (shipments belong to an order's entity)
      if (!data.entity) { const lo = state.data.orders.find(o => o.orderId === data.orderId); data.entity = lo ? recordEntity(lo) : currentEntity(); }
      if (isEdit) {
        await window.PXStore.updateRecord('shipments', shipId, data, { expectedUpdatedAt: loadedUpdatedAt });
        toast('Shipment updated', 'success');
      } else {
        const sourceShipment = priorCreateNextSource(data);
        await window.PXStore.createRecord('shipments', data, { log: { recordType: 'shipment', action: 'created', details: 'Shipment linked to ' + data.orderId } });
        if (sourceShipment) {
          await window.PXStore.updateRecord('shipments', sourceShipment.id, {
            followupActionStatus: 'processed',
            followupActionProcessedAt: new Date(),
            followupActionProcessedBy: state.officer?.code || '',
            followupActionProcessedByShipmentId: data.shipmentId || null
          }, { log: { recordType: 'shipment', action: 'followup-action-processed', details: `${sourceShipment.shipmentId || sourceShipment.orderId}: Create next shipment processed by ${data.shipmentId || 'new shipment'}` } });
        }
        toast('Shipment created and linked to ' + data.orderId, 'success');
      }
      window.closeModal();
    } catch (err) {
      console.error(err);
      if (err && err.code === 'STALE_WRITE') {
        toast('This shipment was changed by someone else while you had it open. Your changes were not saved — please close, reopen the shipment to see the latest, and re-apply your edits.', 'danger');
      } else {
        toast('Save failed: ' + err.message, 'danger');
      }
      $('#save-ship-btn').disabled = false;
      $('#save-ship-btn').innerHTML = isEdit ? 'Save Changes' : 'Create Shipment';
    }
  });

  if (isEdit) {
    const delShipBtn = $('#delete-ship-btn');
    if (delShipBtn) delShipBtn.addEventListener('click', async () => {
      if (!confirm('Archive this shipment? It will be hidden from the active list but kept for audit history. You can restore it later.')) return;
      const reason = prompt('Optional reason for archiving:', '') || null;
      try { await window.PXStore.archiveRecord('shipments', shipId, reason); toast('Shipment archived', 'success'); window.closeModal(); }
      catch (err) { toast('Archive failed: ' + err.message, 'danger'); }
    });
  }
};
