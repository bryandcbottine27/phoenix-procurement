const { $, $$, fmtDate, fmtDateISO, fmtMoney, escapeHtml, statusBadgeClass, daysBetween,
  collection, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, toast,
  generateMilestonesFromTerm, computeMilestoneDate, milestoneStatus,
  orderFunction, functionForCategory, canEditOrders, canEditShipments,
  checkOrderDuplicates, orderDataQuality, orderHealth, buildOrderTimeline,
  isErpOrder, fieldEditable, erpFieldClass, erpSourceOf, erpBadgeFor, renderErpBadge,
  orderHasLines, orderLineSum, stripUndefined,
  currentEntity, recordEntity, entityMeta, currentRole, orderStatusOptionsHtml, shipmentBelongsToOrder } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;


window.openOrderForm = function(orderId = null, type = 'foreign', fn = null) {
  const isEdit = !!orderId;
  // Permission: only procurement + admin may create/edit orders
  if (!canEditOrders()) {
    toast('Orders are created and edited by procurement', 'danger');
    return;
  }
  const o = isEdit ? state.data.orders.find(x => x.id === orderId) : { orderType: type, currency: 'EUR', entity: currentEntity() };
  if (!o) { toast('Order not found', 'danger'); return; }
  // Snapshot the record version at open time, to detect another officer saving first.
  const loadedUpdatedAt = isEdit ? (o.updatedAt || null) : null;
  type = o.orderType || type;
  // Preselect function from caller (when creating from a function-specific list)
  // or from existing order, or default to null
  const currentFunction = isEdit ? orderFunction(o) : fn;
  // Categories available for this function (if any)
  const availableCategories = currentFunction
    ? REF.categories.filter(c => REF.categoryToFunction[c] === currentFunction)
    : REF.categories;
  const isSupplyChainForm = currentFunction === 'supplychain';
  const orderEntity = recordEntity(o);
  const localCurrencies = orderEntity === 'Seychelles Breweries' ? ['SCR','MUR','EUR','USD']
    : orderEntity === 'Edena' ? ['EUR'] : ['MUR','EUR','USD'];
  const localCurrencyHint = orderEntity === 'Seychelles Breweries' ? 'SCR, MUR, EUR or USD'
    : orderEntity === 'Edena' ? 'EUR' : 'MUR, EUR or USD';

  const officers = state.data.officers.filter(off => off.active !== false);
  // Archived/inactive suppliers remain visible on historic orders, but are not
  // offered for a newly selected supplier on an operational order. Suppliers are per-entity,
  // so only this order's entity's suppliers are offered.
  const suppliers = state.data.suppliers.filter(s => !s.archived && s.active !== false && recordEntity(s) === orderEntity);

  // Payment terms lock rule: terms (and milestone schedule) stay freely editable UNTIL a payment
  // request has been issued against the order. "Issued" = any milestone carries an rfpRef or a
  // paidDate, or any non-archived payment request references this order. Before that, the officer
  // can freely change the term (e.g. correcting a vague Navision term).
  const anyRfpIssued = (function () {
    if (!isEdit) return false;
    const msIssued = (o.milestones || []).some(m => m.rfpRef || m.paidDate);
    const payIssued = (state.data.payments || []).some(p =>
      !p.archived && (p.orderId === o.orderId) && !['rejected'].includes(p.status));
    return msIssued || payIssued;
  })();

  window.openModal(`
    <div class="modal-head">
      <div>
        <h2>${isEdit ? 'Edit Order' : 'New ' + (type === 'foreign' ? 'Foreign' : 'Local') + ' Order'}${currentFunction ? ' — ' + escapeHtml(REF.functions[currentFunction]?.short || currentFunction) : ''}</h2>
        <div class="sub">${isEdit ? escapeHtml(o.orderId || '') : 'Stage 1 — Order placement'}</div>
      </div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <form id="order-form">
        <div class="form-grid cols-3">
          <div class="field-group">
            <label>Entity <span class="req">*</span></label>
            <select name="entity" required>
              ${REF.entities.map(e => `<option value="${escapeHtml(e.code)}" ${recordEntity(o)===e.code?'selected':''}>${escapeHtml(e.code)}</option>`).join('')}
            </select>
          </div>
          <div class="field-group">
            <label>Order Type <span class="req">*</span></label>
            <select name="orderType" required ${isEdit ? 'disabled' : ''}>
              <option value="foreign" ${type==='foreign'?'selected':''}>Foreign (FPO)</option>
              <option value="local" ${type==='local'?'selected':''}>Local (LPO)</option>
            </select>
          </div>
          <div class="field-group">
            <label>Order Number <span class="req">*</span></label>
            <input type="text" name="orderId" value="${escapeHtml(o.orderId||'')}" placeholder="${type==='foreign'?'FPO12345':'LPO10014000'}" required class="${erpFieldClass(o,'orderId')}" ${fieldEditable(o,'orderId')?'':'readonly'} />
            ${isErpOrder(o) ? '<div class="erp-field-note">⛓ From Navision</div>' : '<div class="hint">e.g. FPO12345 or LPO10014000</div>'}
          </div>
          <div class="field-group">
            <label>${(window.__iprLabel ? window.__iprLabel(o) : 'IPR No.').replace(' No.', ' Number')}</label>
            <input type="text" name="iprNumber" value="${escapeHtml(o.iprNumber||'')}" placeholder="${(window.__iprLabel && window.__iprLabel(o)==='PQ No.') ? 'PQ142935' : 'IPR142935'}" class="${erpFieldClass(o,'iprNumber')}" ${fieldEditable(o,'iprNumber')?'':'readonly'} />
            ${isErpOrder(o) ? '<div class="erp-field-note">⛓ From Navision</div>' : ''}
          </div>
          <div class="field-group">
            <label>IPR HOD Approved Date</label>
            <input type="date" name="iprApprovedDate" value="${fmtDateISO(o.iprApprovedDate)}" class="${erpFieldClass(o,'iprApprovedDate')}" ${fieldEditable(o,'iprApprovedDate')?'':'readonly'} />
            ${isErpOrder(o) ? '<div class="erp-field-note">⛓ From Navision</div>' : '<div class="hint">Used to compute MTTO</div>'}
          </div>
          <div class="field-group">
            <label>Category${currentFunction ? ' <span class="hint" style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--muted-soft);font-size:11px">(within ' + escapeHtml(REF.functions[currentFunction]?.short || '') + ')</span>' : ''}</label>
            <select name="category">
              <option value="">—</option>
              ${availableCategories.map(c => `<option value="${escapeHtml(c)}" ${o.category===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}
            </select>
            ${isErpOrder(o) ? `<div class="erp-field-note override">⛓ From Navision — you can override${(o.userOverrides||[]).includes('category') ? ' (overridden)' : ''}</div>` : ''}
          </div>
          <div class="field-group">
            <label>Claimant</label>
            <input type="text" name="claimant" value="${escapeHtml(o.claimant||'')}" placeholder="Department / requester name" />
          </div>
          <div class="field-group">
            <label>Purchasing Officer <span class="req">*</span></label>
            ${(() => {
              // On an EXISTING order, only supervisors/managers can change the assigned
              // officer (reassignment). On a NEW order anyone creating it can set it.
              const canReassign = !!(window.PXUtils && window.PXUtils.canReassignOrders && window.PXUtils.canReassignOrders());
              const lock = o.id && !canReassign;
              return `<select name="officerCode" required ${lock ? 'disabled' : ''}>
              <option value="">—</option>
              ${officers.map(off => `<option value="${escapeHtml(off.code)}" ${o.officerCode===off.code?'selected':''}>${escapeHtml(off.code)} — ${escapeHtml(off.fullName||'')}</option>`).join('')}
            </select>${lock ? '<div class="hint">Only a supervisor or manager can reassign the purchasing officer.</div>' : ''}`;
            })()}
          </div>
          <div class="field-group">
            <label>Shipment</label>
            <label class="check-inline"><input type="checkbox" name="noShipment" ${o.noShipment?'checked':''} /> No shipment — intangible order (service, works, licence, subscription, etc.)</label>
            <div class="hint">Tick for intangible items (foreign or local): no shipment is tracked; receipts are recorded as one or more GRNs directly on the order. Leave unticked for tangible goods, which are received via shipment(s).</div>
            <div class="hint">Tick for services, civil works, maintenance, etc. — hides the shipment tab and all shipment fields for this order.</div>
          </div>
        </div>

        <div class="section-divider">Request Details</div>
        <div class="form-grid cols-3">
          <div class="field-group">
            <label>Date Requested By Dept</label>
            <input type="date" name="dateRequestedByDept" value="${fmtDateISO(o.dateRequestedByDept)}" />
          </div>
          <div class="field-group">
            <label>Date of Order <span class="req">*</span></label>
            <input type="date" name="dateOfOrder" value="${fmtDateISO(o.dateOfOrder)}" required class="${erpFieldClass(o,'dateOfOrder')}" ${fieldEditable(o,'dateOfOrder')?'':'readonly'} />
            ${isErpOrder(o) ? '<div class="erp-field-note">⛓ From Navision</div>' : ''}
          </div>
          <div class="field-group">
            <label>Requested Receipt Date</label>
            <input type="date" name="requestedReceiptDate" value="${fmtDateISO(o.requestedReceiptDate)}" />
            <div class="hint">Used to compute OTIF</div>
          </div>
          <div class="field-group">
            <label>Order Sent to Supplier</label>
            <input type="date" name="orderSentToSupplierDate" value="${fmtDateISO(o.orderSentToSupplierDate)}" />
            <div class="hint">Date the PO was actually sent to the supplier</div>
          </div>
          <div class="field-group">
            <label>Order Acknowledged</label>
            <input type="date" name="orderAcknowledgedDate" value="${fmtDateISO(o.orderAcknowledgedDate)}" />
          </div>
          ${type === 'foreign' ? `
          <div class="field-group">
            <label>Order Ready Date</label>
            <input type="date" name="orderReadyDate" value="${fmtDateISO(o.orderReadyDate)}" />
            <div class="hint">Date supplier confirmed goods are ready</div>
          </div>
          ` : ''}
        </div>

        <div class="section-divider">Supplier Commitment &amp; Follow-Up</div>
        <div class="form-grid cols-3">
          <div class="field-group">
            <label>Supplier Promised Date</label>
            <input type="date" name="supplierPromisedDate" value="${fmtDateISO(o.supplierPromisedDate)}" />
            <div class="hint">Original supplier commitment for readiness / delivery.</div>
          </div>
          <div class="field-group">
            <label>Revised Promise Date</label>
            <input type="date" name="supplierRevisedPromisedDate" value="${fmtDateISO(o.supplierRevisedPromisedDate)}" />
          </div>
          <div class="field-group">
            <label>Revision Count</label>
            <input type="number" name="supplierPromiseRevisionCount" min="0" step="1" value="${o.supplierPromiseRevisionCount ?? ''}" />
          </div>
          <div class="field-group">
            <label>Last Supplier Follow-Up</label>
            <input type="date" name="lastSupplierFollowupDate" value="${fmtDateISO(o.lastSupplierFollowupDate)}" />
          </div>
          <div class="field-group">
            <label>Next Supplier Follow-Up</label>
            <input type="date" name="nextSupplierFollowupDate" value="${fmtDateISO(o.nextSupplierFollowupDate)}" />
          </div>
          <div class="field-group">
            <label>Follow-Up Method</label>
            <select name="followupMethod">
              <option value="">—</option>
              ${['Email','Phone','Teams','Supplier portal','Meeting','Other'].map(m => `<option value="${escapeHtml(m)}" ${o.followupMethod===m?'selected':''}>${escapeHtml(m)}</option>`).join('')}
            </select>
          </div>
          <div class="field-group">
            <label>Follow-Up Cadence (working days)</label>
            <input type="number" name="followupFrequencyDays" min="0" step="1" value="${o.followupFrequencyDays ?? ''}" placeholder="e.g. 5" />
          </div>
          <div class="field-group">
            <label>Order Criticality</label>
            <select name="orderCriticality">
              ${['normal','low','high','critical'].map(v => `<option value="${v}" ${(o.orderCriticality||'normal')===v?'selected':''}>${v.charAt(0).toUpperCase()+v.slice(1)}</option>`).join('')}
            </select>
          </div>
          <div class="field-group">
            <label>Escalation Owner</label>
            <select name="escalationOwner">
              <option value="">—</option>
              ${officers.map(off => `<option value="${escapeHtml(off.code)}" ${o.escalationOwner===off.code?'selected':''}>${escapeHtml(off.code)} — ${escapeHtml(off.fullName||'')}</option>`).join('')}
            </select>
          </div>
          <div class="field-group">
            <label>Escalation Date</label>
            <input type="date" name="escalationDate" value="${fmtDateISO(o.escalationDate)}" />
          </div>
          <div class="field-group">
            <label>Escalation Level</label>
            <input type="number" name="escalationLevel" min="0" step="1" value="${o.escalationLevel ?? ''}" placeholder="0" />
          </div>
          <div class="field-group full">
            <label>Supplier Delay Reason</label>
            <input type="text" name="supplierDelayReason" value="${escapeHtml(o.supplierDelayReason||'')}" placeholder="Reason given by supplier / forwarder" />
          </div>
          <div class="field-group full">
            <label>Supplier Reply / Commitment Notes</label>
            <textarea name="supplierReplySummary" placeholder="Latest supplier reply, commitment or blocker">${escapeHtml(o.supplierReplySummary||'')}</textarea>
          </div>
        </div>

        ${type === 'foreign' ? `
        <div class="section-divider">Shipment Planning</div>
        <div class="form-grid cols-3">
          <div class="field-group">
            <label>Incoterm</label>
            <select name="incoterm"><option value="">-</option>${(REF.incoterms || []).map(term => `<option value="${term}" ${o.incoterm===term?'selected':''}>${term}</option>`).join('')}</select>
          </div>
          <div class="field-group">
            <label>Planned Shipment Mode</label>
            <select name="plannedShipmentMode"><option value="">-</option>${REF.shipmentModes.map(mode => `<option value="${mode}" ${o.plannedShipmentMode===mode?'selected':''}>${mode.charAt(0).toUpperCase()+mode.slice(1)}</option>`).join('')}</select>
          </div>
          <div class="field-group">
            <label>Planned Freight Forwarder</label>
            <input type="text" name="plannedFreightForwarder" value="${escapeHtml(o.plannedFreightForwarder||'')}" placeholder="Forwarder / shipping line" />
          </div>
          <div class="field-group full">
            <label>Shipment Plan Notes</label>
            <textarea name="shipmentPlanNotes" placeholder="Booking, routing, consolidation, or supplier dispatch notes">${escapeHtml(o.shipmentPlanNotes||'')}</textarea>
          </div>
        </div>
        ` : ''}

        <div class="section-divider">Supplier &amp; Goods</div>
        <div class="form-grid">
          <div class="field-group full">
            <label>Supplier <span class="req">*</span></label>
            <input type="text" name="supplier" list="supplier-list" value="${escapeHtml(o.supplier||'')}" required placeholder="Type or pick" class="${erpFieldClass(o,'supplier')}" ${fieldEditable(o,'supplier')?'':'readonly'} />
            <datalist id="supplier-list">
              ${suppliers.map(s => `<option value="${escapeHtml(s.name)}"></option>`).join('')}
            </datalist>
            ${isErpOrder(o) ? '<div class="erp-field-note">⛓ From Navision</div>' : '<div class="hint">If new, you can add it to the Suppliers list later.</div>'}
          </div>
          <div class="field-group full">
            <label>Description <span class="req">*</span></label>
            <textarea name="description" required placeholder="Goods description" class="${erpFieldClass(o,'description')}" ${fieldEditable(o,'description')?'':'readonly'}>${escapeHtml(o.description||'')}</textarea>
            ${isErpOrder(o) ? '<div class="erp-field-note">⛓ From Navision</div>' : ''}
          </div>
        </div>

        <div id="supplychain-items-section" style="${isSupplyChainForm ? '' : 'display:none'}">
          <div class="section-divider">Supply Chain Items</div>
          <div class="op-hint" style="margin-bottom:10px">Add one row per item. Detailed Description and Quantity apply to Supply Chain orders only.</div>
          <div id="supplychain-items-container"></div>
        </div>

        <div class="section-divider">Financials</div>
        <div class="form-grid cols-3">
          <div class="field-group">
            <label>Currency <span class="req">*</span></label>
            <select name="currency" required class="${erpFieldClass(o,'currency')}" ${fieldEditable(o,'currency')?'':'disabled'}>
              ${(type === 'local' ? localCurrencies : REF.currencies).map(c => `<option value="${c}" ${o.currency===c?'selected':''}>${c}</option>`).join('')}
            </select>
            ${isErpOrder(o) ? '<div class="erp-field-note">⛓ From Navision</div>' : (type === 'local' ? `<div class="hint">Local orders: ${localCurrencyHint}</div>` : '')}
          </div>
          <div class="field-group">
            <label>Amount <span class="req">*</span></label>
            <input type="number" name="amount" step="0.01" value="${o.amount||''}" required id="order-amount-input" class="${erpFieldClass(o,'amount')}" ${fieldEditable(o,'amount')?'':'readonly'} />
            ${isErpOrder(o) ? '<div class="erp-field-note">⛓ From Navision</div>' : ''}
          </div>
          <div class="field-group">
            <label>Forthcoming Payment Date</label>
            <input type="date" name="forthcomingPaymentDate" value="${fmtDateISO(o.forthcomingPaymentDate)}" />
          </div>
          <div class="field-group">
            <label>Payment Due Date</label>
            <input type="date" name="paymentDueDate" value="${fmtDateISO(o.paymentDueDate)}" />
          </div>
          <div class="field-group full">
            <label>Payment Terms</label>
            <input type="text" name="paymentTerms" id="order-payment-terms" list="order-payment-terms-list"
                   value="${escapeHtml(o.paymentTerms || '')}"
                   placeholder="Pick a standard term, or type a custom one (e.g. 35% advance; 65% against BL)"
                   autocomplete="off" ${anyRfpIssued ? 'readonly' : ''} />
            <datalist id="order-payment-terms-list">
              ${REF.paymentTerms.map(t => `<option value="${escapeHtml(t)}"></option>`).join('')}
            </datalist>
            <div class="hint">${anyRfpIssued
              ? '🔒 Locked — a payment request has been issued against this order. Reject/remove the RFP to change the term.'
              : (type === 'foreign'
                  ? 'Pick a standard term to auto-generate milestones, or type any <strong>custom</strong> term and set milestones manually below.'
                  : 'Standard or custom payment term. Tick "staged payment" below to schedule milestones.')}</div>
            ${isErpOrder(o) ? `<div class="erp-field-note override">⛓ From Navision — you can override${(o.userOverrides||[]).includes('paymentTerms') ? ' (overridden)' : ''}</div>` : ''}
          </div>
          ${type === 'local' ? `
          <div class="field-group full">
            <label class="check-inline"><input type="checkbox" name="stagedPayment" id="order-staged-payment" ${o.stagedPayment?'checked':''} /> Staged payment (schedule milestones for this local order)</label>
            <div class="hint">Tick if this local order is paid in stages (e.g. advance + balance). Leave unticked for a single payment on the due date.</div>
          </div>
          ` : ''}
        </div>

        <div id="milestone-section" style="${(type === 'foreign' || o.stagedPayment) ? '' : 'display:none'}">
          <div class="section-divider">Payment Schedule (Milestones)</div>
          <div id="milestone-panel-container"></div>
        </div>

        <div class="section-divider">Status &amp; Tracking</div>
        <div class="form-grid cols-3">
          <div class="field-group">
            <label>Current Status</label>
            <select name="status">
              <option value="">—</option>
              ${orderStatusOptionsHtml(o.status)}
            </select>
            <div class="hint">Order follow-up runs from supplier acknowledgement through readiness, logistics handover, receipt, and closure.</div>
          </div>
          <div class="field-group full">
            <label>Notes</label>
            <textarea name="notes" placeholder="Free-text remarks">${escapeHtml(o.notes||'')}</textarea>
          </div>
        </div>

        ${isEdit ? `
          <div class="section-divider">Closure</div>
          <div class="form-grid">
            <div class="field-group">
              <label><input type="checkbox" name="isClosed" ${o.isClosed?'checked':''} style="width:auto;margin-right:6px;vertical-align:middle"> Close this order</label>
              <div class="hint">Closed orders are hidden from the default Open view.</div>
            </div>
          </div>
        ` : ''}
      </form>
    </div>
    <div class="modal-foot">
      ${isEdit && window.PXUtils.can('orders','archive') ? '<button class="btn btn-danger" id="delete-order-btn" style="margin-right:auto">Archive</button>' : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="save-order-btn">${isEdit ? 'Save Changes' : 'Create Order'}</button>
    </div>
  `, true);

  // Supply Chain orders capture Detailed Description and Quantity per item, not on
  // the order header. Older Supply Chain orders with a header quantity get one
  // editable starter row so the data can be moved forward without losing it.
  let workingSupplyChainItems = Array.isArray(o.supplyChainItems)
    ? o.supplyChainItems.map(item => ({ ...item }))
    : [];
  if (isSupplyChainForm && !workingSupplyChainItems.length && o.quantity != null && o.quantity !== '') {
    workingSupplyChainItems.push({
      id: 'sci_' + Date.now(),
      detailedDescription: '',
      quantity: o.quantity
    });
  }

  const newSupplyChainItem = () => ({
    id: 'sci_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    detailedDescription: '',
    quantity: ''
  });

  function selectedOrderFunction() {
    const category = $('select[name="category"]')?.value || '';
    return category ? (REF.categoryToFunction[category] || null) : currentFunction;
  }

  function renderSupplyChainItems() {
    const container = $('#supplychain-items-container');
    if (!container) return;
    container.innerHTML = `
      ${workingSupplyChainItems.length ? `
        <div style="display:grid;grid-template-columns:36px minmax(0,1fr) 150px 40px;gap:8px;align-items:end;margin-bottom:6px;font-size:10px;color:var(--muted-soft);text-transform:uppercase;font-weight:600;letter-spacing:0.05em">
          <span>#</span><span>Detailed Description</span><span>Quantity</span><span></span>
        </div>
        ${workingSupplyChainItems.map((item, index) => `
          <div class="supplychain-item-row" data-item-index="${index}" style="display:grid;grid-template-columns:36px minmax(0,1fr) 150px 40px;gap:8px;align-items:end;margin-bottom:8px">
            <div class="mono text-xs" style="padding:9px 0;color:var(--muted)">${index + 1}</div>
            <textarea data-item-field="detailedDescription" placeholder="Item specification / detailed description">${escapeHtml(item.detailedDescription || '')}</textarea>
            <input data-item-field="quantity" type="number" step="any" min="0" value="${item.quantity ?? ''}" placeholder="Quantity" />
            <button type="button" class="btn btn-sm btn-ghost" data-item-action="remove" title="Remove item">✕</button>
          </div>
        `).join('')}
      ` : '<p class="text-sm text-muted" style="margin:0 0 8px">No items added yet.</p>'}
      <button type="button" class="btn btn-sm" id="add-supplychain-item">+ Add Item</button>
    `;

    container.querySelectorAll('[data-item-field]').forEach(input => {
      input.addEventListener('input', event => {
        const row = event.target.closest('[data-item-index]');
        const index = Number(row.dataset.itemIndex);
        workingSupplyChainItems[index][event.target.dataset.itemField] = event.target.value;
      });
    });
    container.querySelectorAll('[data-item-action="remove"]').forEach(button => {
      button.addEventListener('click', event => {
        const index = Number(event.target.closest('[data-item-index]').dataset.itemIndex);
        workingSupplyChainItems.splice(index, 1);
        renderSupplyChainItems();
      });
    });
    const addButton = container.querySelector('#add-supplychain-item');
    if (addButton) addButton.addEventListener('click', () => {
      workingSupplyChainItems.push(newSupplyChainItem());
      renderSupplyChainItems();
    });
  }

  function refreshSupplyChainItemsVisibility() {
    const section = $('#supplychain-items-section');
    if (!section) return;
    const applies = selectedOrderFunction() === 'supplychain';
    section.style.display = applies ? '' : 'none';
    if (applies) renderSupplyChainItems();
  }

  const categorySelect = $('select[name="category"]');
  if (categorySelect) categorySelect.addEventListener('change', refreshSupplyChainItemsVisibility);
  if (isSupplyChainForm) renderSupplyChainItems();

  /* ===== MILESTONE PANEL (foreign orders only) =====
     Working copy of milestones the user can edit before save. */
  let workingMilestones = (o.milestones || []).map(m => ({ ...m }));
  // Milestones apply to all foreign orders, and to local orders flagged staged-payment.
  let milestonesEnabled = (type === 'foreign') || !!o.stagedPayment;

  function recalcWorkingMilestoneAmounts() {
    const orderAmount = parseFloat($('#order-amount-input')?.value) || 0;
    const allocated = window.PXUtils.allocateMilestoneAmounts
      ? window.PXUtils.allocateMilestoneAmounts(orderAmount, workingMilestones)
      : [];
    workingMilestones.forEach((m, idx) => {
      if (m.rfpRef || m.paidDate) return;
      const allocatedAmount = allocated[idx];
      m.amount = allocatedAmount != null ? allocatedAmount : +((orderAmount * (m.percent || 0) / 100).toFixed(2));
    });
  }

  function renderMilestonePanel() {
    if (!milestonesEnabled) return;
    const container = $('#milestone-panel-container');
    if (!container) return;

    const orderAmount = parseFloat($('#order-amount-input')?.value) || 0;
    const totalPct = workingMilestones.reduce((s, m) => s + (parseFloat(m.percent) || 0), 0);
    const totalAmt = workingMilestones.reduce((s, m) => s + (parseFloat(m.amount) || 0), 0);
    const pctOk = Math.abs(totalPct - 100) < 0.01;
    const amtOk = Math.abs(totalAmt - orderAmount) < 0.5;

    container.innerHTML = `
      <div class="milestone-panel">
        <div class="panel-head">
          <div style="font-size:13px;color:var(--muted)">
            ${workingMilestones.length === 0
              ? 'No milestones — single payment on Payment Due Date.'
              : workingMilestones.length + ' milestone(s)'}
          </div>
          <div class="sum-info ${pctOk?'good':'bad'}">
            Sum: ${totalPct.toFixed(0)}% / 100% · ${fmtMoney(totalAmt)} / ${fmtMoney(orderAmount)}
          </div>
        </div>
        ${workingMilestones.length > 0 ? `
          <div style="display:grid;grid-template-columns:24px 1fr 70px 130px 130px 100px 40px;gap:8px;font-size:10px;color:var(--muted-soft);text-transform:uppercase;font-weight:600;padding:0 0 4px;letter-spacing:0.05em">
            <span>#</span><span>Label</span><span style="text-align:right">%</span><span>Amount</span><span>Expected Date</span><span>Status</span><span></span>
          </div>
          ${workingMilestones.map((m, idx) => {
            const exp = computeMilestoneDate(m, o, state.data.shipments);
            const expDisplay = m.expectedDateOverride
              ? fmtDateISO(m.expectedDateOverride)
              : (exp ? fmtDateISO(exp) : '');
            const status = milestoneStatus(m, exp || m.expectedDateOverride);
            const anchorLabel = REF.anchorEvents[m.anchor] || m.anchor || 'manual';
            const locked = !!(m.rfpRef || m.paidDate);  // locked once linked to an RFP
            const badgeClass = status === 'paid' ? 'success' : status === 'overdue' ? 'danger' : status === 'due-soon' ? 'warn' : status === 'rfp-raised' ? 'info' : 'accent';
            return `
              <div class="milestone-row ${status}" data-idx="${idx}">
                <div class="seq">${idx + 1}</div>
                <input class="label-in" data-field="label" value="${escapeHtml(m.label || '')}" placeholder="Label" ${locked?'readonly':''} />
                <input class="pct-in" data-field="percent" type="number" step="0.01" value="${m.percent ?? ''}" placeholder="%" ${locked?'readonly':''} />
                <input class="amount-in" data-field="amount" type="number" step="0.01" value="${m.amount ?? ''}" placeholder="Amount" ${locked?'readonly':''} />
                <input data-field="expectedDateOverride" type="date" value="${expDisplay}"
                       title="${exp ? 'Auto from ' + anchorLabel : 'Set manually'}" ${locked?'readonly':''} />
                <span class="badge ${badgeClass}" style="font-size:10.5px;justify-self:start">${status}</span>
                ${locked ? '<span class="text-xs text-muted" title="Locked: RFP raised">🔒</span>' : `<button type="button" class="remove-btn" data-action="remove" title="Remove">✕</button>`}
                <div class="anchor-hint">Anchor: ${escapeHtml(anchorLabel)}${m.offset ? ' · ' + (m.offset > 0 ? '+' : '') + m.offset + ' days' : ''}${m.rfpRef ? ' · RFP: ' + escapeHtml(m.rfpRef) : ''}${m.paidDate ? ' · Paid: ' + fmtDate(m.paidDate) : ''}${m.legacy ? ' · Legacy paid (no RFP)' : ''}</div>
              </div>
            `;
          }).join('')}
        ` : ''}
        <div style="display:flex;gap:8px;margin-top:10px">
          <button type="button" class="btn btn-sm" id="add-milestone">+ Add Milestone</button>
          ${workingMilestones.length > 0 ? '<button type="button" class="btn btn-sm" id="clear-milestones">Clear All</button>' : ''}
          ${orderAmount > 0 && workingMilestones.length > 0 && !amtOk ? '<button type="button" class="btn btn-sm" id="recalc-amounts">Recalc amounts from %</button>' : ''}
        </div>
      </div>
    `;

    // wire events
    container.querySelectorAll('.milestone-row input, .milestone-row select').forEach(el => {
      el.addEventListener('change', e => {
        const row = e.target.closest('.milestone-row');
        const idx = parseInt(row.dataset.idx);
        const field = e.target.dataset.field;
        const val = e.target.value;
        if (field === 'percent') {
          workingMilestones[idx].percent = parseFloat(val) || 0;
          recalcWorkingMilestoneAmounts();
        } else if (field === 'amount') {
          workingMilestones[idx].amount = parseFloat(val) || 0;
        } else if (field === 'expectedDateOverride') {
          workingMilestones[idx].expectedDateOverride = val ? new Date(val) : null;
        } else {
          workingMilestones[idx][field] = val;
        }
        renderMilestonePanel();
      });
    });
    container.querySelectorAll('[data-action="remove"]').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = parseInt(e.target.closest('.milestone-row').dataset.idx);
        const m = workingMilestones[idx];
        if (m.rfpRef || m.paidDate) { toast('Cannot remove a milestone with an RFP attached. Delete the RFP first.', 'danger'); return; }
        workingMilestones.splice(idx, 1);
        renderMilestonePanel();
      });
    });
    const addBtn = container.querySelector('#add-milestone');
    if (addBtn) addBtn.addEventListener('click', () => {
      workingMilestones.push({
        id: 'm_' + Date.now(),
        seq: workingMilestones.length + 1,
        label: 'Milestone ' + (workingMilestones.length + 1),
        percent: 0,
        amount: 0,
        anchor: 'order_placement',
        offset: 0
      });
      renderMilestonePanel();
    });
    const clearBtn = container.querySelector('#clear-milestones');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      if (confirm('Remove all milestones?')) { workingMilestones = []; renderMilestonePanel(); }
    });
    const recalcBtn = container.querySelector('#recalc-amounts');
    if (recalcBtn) recalcBtn.addEventListener('click', () => {
      recalcWorkingMilestoneAmounts();
      renderMilestonePanel();
    });
  }

  // Initial render of milestone panel (foreign always; local only if staged)
  if (milestonesEnabled) renderMilestonePanel();

  // Local "staged payment" toggle: show/hide the milestone section and enable the panel
  const stagedCheckbox = $('#order-staged-payment');
  if (stagedCheckbox) {
    stagedCheckbox.addEventListener('change', e => {
      milestonesEnabled = e.target.checked;
      const section = $('#milestone-section');
      if (section) section.style.display = milestonesEnabled ? '' : 'none';
      if (milestonesEnabled) {
        // Seed from the selected term if no milestones yet
        if (workingMilestones.length === 0) {
          const term = $('#order-payment-terms') ? $('#order-payment-terms').value : '';
          const amt = parseFloat(($('#order-amount-input') || {}).value) || 0;
          const generated = generateMilestonesFromTerm(term, amt);
          if (generated.length) workingMilestones = generated;
        }
        renderMilestonePanel();
      }
    });
  }

  // Auto-regenerate milestones when payment term changes (foreign + staged-local)
  if (type === 'foreign' || stagedCheckbox) {
    const termSelect = $('#order-payment-terms');
    if (termSelect) {
      termSelect.addEventListener('change', e => {
        if (!milestonesEnabled) return;
        const newTerm = e.target.value;
        const orderAmt = parseFloat($('#order-amount-input').value) || 0;
        const generated = generateMilestonesFromTerm(newTerm, orderAmt);
        if (generated.length === 0 && newTerm) {
          // Custom / unrecognised term — keep the term, let the officer set milestones manually.
          if (!confirm('No pre-defined schedule for this term. Keep it as a custom term and set milestones manually?')) {
            e.target.value = o.paymentTerms || '';
            return;
          }
          // Accept the custom term; do not wipe existing manual milestones.
          return;
        }
        if (workingMilestones.length > 0 && workingMilestones.some(m => m.paidDate || m.rfpRef)) {
          // A payment request exists — regenerating would lose linked RFP/paid data. Block & revert.
          alert('A payment request has already been issued against this order, so the schedule is locked. Reject/remove the RFP first to change the term.');
          e.target.value = o.paymentTerms || '';
          return;
        }
        workingMilestones = generated;
        renderMilestonePanel();
      });
    }
    // Auto-update amounts when order amount changes
    const amountInput = $('#order-amount-input');
    if (amountInput) {
      amountInput.addEventListener('input', () => {
        if (!milestonesEnabled) return;
        recalcWorkingMilestoneAmounts();
        renderMilestonePanel();
      });
    }
  }

  // ===== Non-blocking "date already past" note =====
  // Lets users enter already-closed / historical orders freely; just informs them.
  (function wirePastDateNotes() {
    const form = $('#order-form');
    if (!form) return;
    const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
    const noteFor = inp => {
      const grp = inp.closest('.field-group'); if (!grp) return;
      let note = grp.querySelector('.past-date-note');
      const v = inp.value ? new Date(inp.value) : null;
      const isPast = v && !isNaN(v) && v < todayMid;
      if (isPast) {
        if (!note) {
          note = document.createElement('div');
          note.className = 'hint past-date-note';
          note.textContent = 'ⓘ This date is already in the past — fine for closed / historical orders.';
          grp.appendChild(note);
        }
      } else if (note) { note.remove(); }
    };
    form.querySelectorAll('input[type="date"]').forEach(inp => {
      noteFor(inp);
      inp.addEventListener('change', () => noteFor(inp));
    });
  })();

  $('#save-order-btn').addEventListener('click', async () => {
    const form = $('#order-form');
    const fd = new FormData(form);
    const data = {};
    fd.forEach((v, k) => {
      if (v === '' || v === null) { data[k] = null; }
      else if (k === 'amount' || k === 'quantity') { data[k] = parseFloat(v); }
      else if (['supplierPromiseRevisionCount', 'followupFrequencyDays', 'escalationLevel'].includes(k)) { data[k] = parseInt(v, 10); }
      else if (k === 'isClosed') { data[k] = v === 'on'; }
      else if (k === 'noShipment') { data[k] = v === 'on'; }
      else if (k.endsWith('Date')) { data[k] = v ? new Date(v) : null; }
      else { data[k] = v; }
    });
    // Unchecked checkboxes are absent from FormData — set explicitly.
    if (data.noShipment === undefined) data.noShipment = false;
    if (!isEdit && data.isClosed === undefined) data.isClosed = false;
    // If the Purchasing Officer field was locked (non-reassign user editing an existing
    // order), it's disabled and therefore absent from FormData — keep the current officer
    // rather than blanking it.
    if (isEdit && data.officerCode === undefined && o && o.officerCode) data.officerCode = o.officerCode;

    if (!data.orderId || !data.supplier || !data.description || !data.amount) {
      toast('Please fill all required fields', 'danger'); return;
    }
    if (!isEdit) {
      const existing = state.data.orders.find(x => x.orderId === data.orderId);
      if (existing) { toast('Order number already exists: ' + data.orderId, 'danger'); return; }
    }

    // Soft duplicate warnings (non-blocking — ask for confirmation)
    const dupWarnings = checkOrderDuplicates(data, state.data.orders, isEdit, isEdit ? o.id : null);
    if (dupWarnings.length) {
      if (!confirm('Possible duplicate detected:\n\n• ' + dupWarnings.join('\n• ') + '\n\nSave anyway?')) return;
    }

    // Set function field — from category mapping if a category was picked,
    // else from the preselected function (creating from function-specific list),
    // else null.
    data.function = data.category ? (REF.categoryToFunction[data.category] || null) : (currentFunction || null);

    // Supply Chain orders hold Detailed Description and Quantity per item. The
    // legacy header quantity remains untouched on old records for compatibility.
    if (data.function === 'supplychain') {
      const items = workingSupplyChainItems.map((item, index) => ({
        id: item.id || 'sci_' + Date.now() + '_' + index,
        detailedDescription: String(item.detailedDescription || '').trim(),
        quantity: item.quantity === '' || item.quantity == null ? null : Number(item.quantity)
      }));
      const invalidItem = items.find(item => !item.detailedDescription || !Number.isFinite(item.quantity) || item.quantity <= 0);
      if (invalidItem) {
        toast('Each Supply Chain item needs a detailed description and a quantity greater than zero.', 'danger');
        return;
      }
      if (!items.length && !isEdit) {
        toast('Add at least one Supply Chain item before creating the order.', 'danger');
        return;
      }
      data.supplyChainItems = items;
    } else if (isEdit && Array.isArray(o.supplyChainItems)) {
      // Never discard existing Supply Chain item history when another function is edited.
      data.supplyChainItems = o.supplyChainItems;
    }

    // === ERP scaffolding: preserve source + locked fields, track overrides ===
    if (isEdit && isErpOrder(o)) {
      // Carry forward ERP metadata (all of it — Phoenix never edits these)
      data.erpSource = erpSourceOf(o);
      data.erpCompany = o.erpCompany || null;
      data.erpVendorNo = o.erpVendorNo || null;
      data.erpOrderNo = o.erpOrderNo || null;
      data.erpOrderLineNo = o.erpOrderLineNo || null;
      data.erpItemNo = o.erpItemNo || null;
      data.erpSystemId = o.erpSystemId || null;
      data.erpLastSyncedAt = o.erpLastSyncedAt || null;
      data.erpSyncStatus = o.erpSyncStatus || 'synced';
      data.erpSyncError = o.erpSyncError || null;
      if (o.lines) data.lines = o.lines; // preserve ERP line data if present
      // Disabled/readonly locked fields don't submit reliably — restore from original.
      REF.erpOwnership.erpLocked.forEach(k => { data[k] = (o[k] === undefined ? null : o[k]); });
      // Track overrides on the fill-once fields (paymentTerms, category)
      const overrides = new Set(o.userOverrides || []);
      let newlyOverridden = false;
      REF.erpOwnership.erpFillOnce.forEach(k => {
        if ((data[k] || '') !== (o[k] || '')) { overrides.add(k); newlyOverridden = true; }
      });
      data.userOverrides = [...overrides];
      // Stamp manual-override metadata (Phoenix-owned audit of who overrode an ERP fill-once field)
      if (newlyOverridden) {
        data.manualOverrideBy = state.officer.code || state.user.email;
        data.manualOverrideAt = new Date();
        data.manualOverrideReason = data.manualOverrideReason || o.manualOverrideReason || 'User adjusted operational field';
      } else {
        data.manualOverrideBy = o.manualOverrideBy || null;
        data.manualOverrideAt = o.manualOverrideAt || null;
        data.manualOverrideReason = o.manualOverrideReason || null;
      }
    } else if (!isEdit) {
      // New manual order created in-app
      data.erpSource = 'Manual';
      data.erpSyncStatus = 'manual';
      data.erpLastSyncedAt = null;
    } else {
      // Existing manual order — keep whatever source it had (default manual)
      data.source = o.source || 'manual';
    }

    // Link every new or newly-selected supplier to the stable supplier-master ID.
    // The display name remains the ERP-provided / user-entered order value; the ID
    // protects supplier performance and history when a supplier is renamed later.
    const normSupplier = value => String(value || '').trim().toLowerCase();
    const supplierTextChanged = !isEdit || normSupplier(data.supplier) !== normSupplier(o.supplier);
    const supplierMatch = window.PXSupplierMap && window.PXSupplierMap.matchSupplier({
      name: data.supplier,
      vendorNo: data.erpVendorNo,
      entity: data.entity || recordEntity(o),
      erpSource: data.erpSource
    });
    if (supplierMatch) {
      const selectedSupplier = supplierMatch.supplier;
      const supplierControlChanged = !isEdit || supplierTextChanged || o.supplierId !== selectedSupplier.id;
      data.supplierId = selectedSupplier.id;
      data.supplierMatchMethod = supplierMatch.method || 'manual';

      if (supplierControlChanged && selectedSupplier.active === false) {
        toast('This supplier is inactive and cannot be selected for a new or amended order.', 'danger');
        return;
      }
      if (supplierControlChanged && selectedSupplier.supplierRating === 'blocked') {
        if (currentRole() !== 'admin') {
          toast('This supplier is blocked. An administrator must authorise any override.', 'danger');
          return;
        }
        const reason = prompt('This supplier is blocked. Enter the authorised override reason, or Cancel to stop.');
        if (reason === null || !reason.trim()) return;
        data.supplierOverrideReason = reason.trim();
        data.supplierOverrideBy = (state.officer && state.officer.code) || state.user?.email || 'admin';
        data.supplierOverrideAt = new Date();
      } else if (supplierControlChanged && selectedSupplier.supplierRating === 'watchlist') {
        if (!confirm('This supplier is on the watchlist. Continue with this order?')) return;
        data.supplierOverrideReason = null;
        data.supplierOverrideBy = null;
        data.supplierOverrideAt = null;
      } else if (supplierControlChanged) {
        data.supplierOverrideReason = null;
        data.supplierOverrideBy = null;
        data.supplierOverrideAt = null;
      }
    } else if (supplierTextChanged) {
      // An order may still be saved for a newly encountered ERP vendor, but it is
      // explicitly marked for master-data follow-up instead of silently unlinked.
      data.supplierId = null;
      data.supplierMatchMethod = 'unmatched';
      data.supplierOverrideReason = null;
      data.supplierOverrideBy = null;
      data.supplierOverrideAt = null;
    } else if (isEdit) {
      data.supplierId = o.supplierId || null;
      data.supplierMatchMethod = o.supplierMatchMethod || (o.supplierId ? 'manual' : 'unmatched');
    }

    // Staged-payment flag for local orders (drives milestone availability)
    if (type === 'local') {
      data.stagedPayment = !!($('#order-staged-payment') && $('#order-staged-payment').checked);
    }
    const wantsMilestones = (type === 'foreign') || (type === 'local' && data.stagedPayment);

    // Attach milestones for foreign orders and staged-payment local orders
    if (wantsMilestones) {
      if (workingMilestones.length > 0) {
        const totalPct = workingMilestones.reduce((s, m) => s + (parseFloat(m.percent) || 0), 0);
        if (Math.abs(totalPct - 100) > 0.01) {
          if (!confirm(`Milestone percentages sum to ${totalPct}% (not 100%). Save anyway?`)) return;
        }
      }
      // Strip helper undefined fields, normalize
      const milestoneAllocatedAmounts = window.PXUtils.milestoneAmountsLookPercentDerived && window.PXUtils.milestoneAmountsLookPercentDerived(data.amount, workingMilestones)
        ? window.PXUtils.allocateMilestoneAmounts(data.amount, workingMilestones)
        : null;
      data.milestones = workingMilestones.map((m, idx) => ({
        id: m.id || 'm_' + Date.now() + '_' + idx,
        seq: idx + 1,
        label: m.label || '',
        percent: parseFloat(m.percent) || 0,
        amount: milestoneAllocatedAmounts ? milestoneAllocatedAmounts[idx] : (parseFloat(m.amount) || 0),
        anchor: m.anchor || null,
        offset: parseInt(m.offset) || 0,
        expectedDateOverride: m.expectedDateOverride || null,
        rfpRef: m.rfpRef || null,
        paidDate: m.paidDate || null,
        notes: m.notes || ''
      }));
      if (type === 'local') data.orderReadyDate = null; // local: no shipping ready date
    } else {
      // No milestones (local without staged payment)
      data.milestones = null;
      data.orderReadyDate = null;
    }

    // ===== Close-order checklist (when newly closing) =====
    const newlyClosing = data.isClosed && !o.isClosed;
    if (newlyClosing) { data.closedAt = new Date(); }
    else if (!data.isClosed) { data.closedAt = null; } // reopened
    if (newlyClosing) {
      const ships = state.data.shipments.filter(s => s.orderId === data.orderId);
      const pays = state.data.payments.filter(p => p.orderId === data.orderId);
      const ms = (type === 'foreign' && data.milestones) ? data.milestones : [];
      const today = new Date(); today.setHours(0,0,0,0);
      const checklist = [];
      if (type === 'foreign' && !data.noShipment) {
        const notReceived = ships.filter(s => !(s.stage === 'completed' || s.completed)).length;
        checklist.push([notReceived === 0 && ships.length > 0, ships.length === 0 ? 'No shipments recorded for this foreign order' : `${notReceived} shipment(s) not yet received`]);
        const noGrn = ships.filter(s => (s.stage === 'completed' || s.completed) && !s.grnDate).length;
        checklist.push([noGrn === 0, noGrn ? `${noGrn} completed shipment(s) missing GRN` : 'GRN recorded where applicable']);
        const unpaidMs = ms.filter(m => !m.paidDate).length;
        checklist.push([unpaidMs === 0, unpaidMs ? `${unpaidMs} milestone(s) still unpaid` : 'All milestones paid']);
      }
      const overduePays = pays.filter(p => {
        if (['paid','rejected'].includes(p.status)) return false;
        const d = p.dueDate?.toDate ? p.dueDate.toDate() : (p.dueDate ? new Date(p.dueDate) : null);
        return d && d < today;
      }).length;
      checklist.push([overduePays === 0, overduePays ? `${overduePays} overdue payment request(s)` : 'No overdue payment requests']);
      const unpaidRfp = pays.filter(p => !['paid','rejected'].includes(p.status)).length;
      checklist.push([unpaidRfp === 0, unpaidRfp ? `${unpaidRfp} payment request(s) not yet paid` : 'All payment requests settled']);
      checklist.push([!!data.notes, data.notes ? 'Closure notes entered' : 'No closure notes entered']);

      const failed = checklist.filter(c => !c[0]);
      const summary = checklist.map(c => `${c[0] ? '✅' : '⚠️'} ${c[1]}`).join('\n');
      if (failed.length) {
        if (!confirm(`Close-order checklist for ${data.orderId}:\n\n${summary}\n\n${failed.length} item(s) incomplete. Close the order anyway?`)) {
          $('#save-order-btn').disabled = false;
          $('#save-order-btn').innerHTML = isEdit ? 'Save Changes' : 'Create Order';
          return;
        }
      } else {
        if (!confirm(`Close-order checklist for ${data.orderId}:\n\n${summary}\n\nAll checks passed. Close this order?`)) return;
      }
    }

    // Centralised validation (Stage 2c): errors block; warnings ask for confirmation.
    if (window.PXValidators) {
      const v = window.PXValidators.validate('order', data, isEdit ? o : null);
      if (!v.ok) { toast('Cannot save: ' + v.errors[0], 'danger'); return; }
      if (v.warnings.length && !confirm('Please confirm:\n\n• ' + v.warnings.join('\n• ') + '\n\nSave anyway?')) return;
    }

    // Increment 5a: amendment reason prompt when a tracked PO field changed
    if (isEdit && window.PXAmendments) {
      const changed = window.PXAmendments.diff(o, data, '');
      if (changed.length) {
        const reason = prompt('You changed: ' + changed.map(c => c.label).join(', ') + '\n\nEnter amendment reason (Cancel to abandon save):');
        if (reason === null) return;
        data.__amendmentReason = reason.trim();
      }
    }

    $('#save-order-btn').disabled = true;
    $('#save-order-btn').innerHTML = '<span class="spinner"></span> Saving…';
    try {
      if (isEdit) {
        // Increment 5a: log amendments before write
        if (window.PXAmendments) {
          const byCode = (state.officer && state.officer.code) || 'unknown';
          const amds = window.PXAmendments.diff(o, data, byCode);
          if (amds.length) data.amendments = window.PXAmendments.merge(o.amendments, amds);
        }
        delete data.__amendmentReason;
        await window.PXStore.updateRecord('orders', orderId, data, { expectedUpdatedAt: loadedUpdatedAt });
        if (data.status && data.status !== o.status) {
          await window.PXStore.logStatusChange('order', orderId, 'status-change', 'Status changed to: ' + data.status);
        }
        toast('Order updated', 'success');
      } else {
        const created = await window.PXStore.createRecord('orders', data);
        await window.PXStore.logStatusChange('order', created.id, 'created', 'Order created — ' + (data.status || 'no status'));
        toast('Order created', 'success');
      }
      window.closeModal();
    } catch (err) {
      console.error(err);
      if (err && err.code === 'STALE_WRITE') {
        toast('This order was changed by someone else while you had it open. Your changes were not saved — please close, reopen the order to see the latest, and re-apply your edits.', 'danger');
      } else {
        toast('Save failed: ' + err.message, 'danger');
      }
      $('#save-order-btn').disabled = false;
      $('#save-order-btn').innerHTML = isEdit ? 'Save Changes' : 'Create Order';
    }
  });

  if (isEdit) {
    const delBtn = $('#delete-order-btn');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!confirm('Archive this order? It will be hidden from the active list but kept for audit history (linked shipments and payments are not affected). You can restore it later.')) return;
      const reason = prompt('Optional reason for archiving:', '') || null;
      try {
        await window.PXStore.archiveRecord('orders', orderId, reason);
        toast('Order archived', 'success');
        window.closeModal();
      } catch (err) { toast('Archive failed: ' + err.message, 'danger'); }
    });
  }
};


window.exportOrdersCSV = function(rows, viewKey) {
  const shipmentStatusForOrder = o => {
    if ((o.orderType || '') !== 'foreign' || !o.orderId) return '';
    const ships = (state.data.shipments || []).filter(s =>
      !s.archived && shipmentBelongsToOrder(s, o));
    if (!ships.length) return '';
    const active = ships.filter(s => !(s.completed || s.stage === 'completed'));
    const picked = (active.length ? active : ships)[0];
    const stage = picked.stage || (picked.completed ? 'completed' : 'in_progress');
    return picked.status || (REF.shipmentStages[stage]?.short || stage || '');
  };
  const cols = ['orderId','orderType','function','dateOfOrder','iprApprovedDate','dateRequestedByDept','requestedReceiptDate','orderReadyDate','supplierPromisedDate','supplierRevisedPromisedDate','supplierPromiseRevisionCount','lastSupplierFollowupDate','nextSupplierFollowupDate','followupMethod','orderCriticality','escalationOwner','escalationDate','escalationLevel','procRiskLevel','procRiskScore','ageingBucket','erpExceptionCount','officerCode','supplier','claimant','description','iprNumber','category','quantity','currency','amount','paymentTerms','paymentDueDate','status','shipmentStatus','isClosed'];
  const header = cols.join(',');
  const body = rows.map(o => cols.map(c => {
    let v = c === 'function' ? orderFunction(o)
      : c === 'shipmentStatus' ? shipmentStatusForOrder(o)
      : c === 'procRiskLevel' ? (window.PXProcFollowup ? window.PXProcFollowup.riskScore(o).level : '')
      : c === 'procRiskScore' ? (window.PXProcFollowup ? window.PXProcFollowup.riskScore(o).score : '')
      : c === 'ageingBucket' ? (window.PXProcFollowup ? window.PXProcFollowup.ageingBucket(o).label : '')
      : c === 'erpExceptionCount' ? (window.PXProcFollowup ? window.PXProcFollowup.erpExceptions(o).length : '')
      : o[c];
    if (v?.toDate) v = fmtDate(v);
    if (v === null || v === undefined) v = '';
    v = String(v).replace(/"/g, '""');
    return /[,"\n]/.test(v) ? `"${v}"` : v;
  }).join(',')).join('\n');
  const csv = header + '\n' + body;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `phoenix_orders_${viewKey}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
};
