const { $, $$, fmtDate, fmtDateISO, fmtMoney, escapeHtml, statusBadgeClass,
  collection, addDoc, doc, updateDoc, deleteDoc, setDoc, runTransaction, getDoc, getDocs,
  serverTimestamp, toast, computeMilestoneDate, query, where,
  checkRfpDuplicates, rfpDataQuality, can, currentEntity, recordEntity, entityMeta, stripUndefined,
  cmGetColumns, cmRenderTable, cmOpenManager, cmExportCSV } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;

const nextRfpRef = window.__pay_nextRfpRef, syncMilestoneFromRfp = window.__pay_syncMilestoneFromRfp;

window.openPaymentForm = async function(payId = null, orderIdPrefill = null, milestoneIdPrefill = null) {
  const isEdit = !!payId;
  if (!isEdit && !can('payments', 'create')) {
    toast('You can view payment requests, but you are not authorised to create an RFP.', 'warn');
    return;
  }
  if (isEdit && !can('payments', 'edit')) {
    toast('You can view payment requests, but you are not authorised to edit them.', 'warn');
    return;
  }
  const p = isEdit ? state.data.payments.find(x => x.id === payId) : { status: 'draft', currency: 'EUR' };
  if (!p) { toast('Payment request not found', 'danger'); return; }
  // Snapshot the record version at open time, to detect another officer saving first.
  const loadedUpdatedAt = isEdit ? (p.updatedAt || null) : null;

  let prefillMilestone = null;
  if (!isEdit && orderIdPrefill) {
    const ord = state.data.orders.find(o => o.orderId === orderIdPrefill);
    if (ord) {
      p.orderId = ord.orderId;
      p.supplier = ord.supplier;
      p.currency = ord.currency;
      p.paymentTerms = ord.paymentTerms;
      p.description = ord.description;
      // If milestone specified, prefill amount/date from milestone instead of order
      if (milestoneIdPrefill && ord.milestones) {
        const milestoneIndex = ord.milestones.findIndex(m => m.id === milestoneIdPrefill);
        prefillMilestone = milestoneIndex >= 0 ? ord.milestones[milestoneIndex] : null;
        if (prefillMilestone) {
          const allocatedAmounts = window.PXUtils.milestoneAmountsLookPercentDerived && window.PXUtils.milestoneAmountsLookPercentDerived(ord.amount, ord.milestones)
            ? window.PXUtils.allocateMilestoneAmounts(ord.amount, ord.milestones)
            : null;
          p.amount = allocatedAmounts ? allocatedAmounts[milestoneIndex] : prefillMilestone.amount;
          p.milestoneId = prefillMilestone.id;
          p.milestoneLabel = prefillMilestone.label;
          // due date = milestone's computed expected date, falling back to override
          const exp = computeMilestoneDate(prefillMilestone, ord, state.data.shipments) || prefillMilestone.expectedDateOverride;
          p.dueDate = exp;
          p.specialRemarks = prefillMilestone.label + ' (' + prefillMilestone.percent + '% of order)';
        }
      } else {
        p.amount = ord.amount;
        p.dueDate = ord.paymentDueDate;
      }
    }
  }

  window.openModal(`
    <div class="modal-head">
      <div>
        <h2>${isEdit ? 'Edit Payment Request' : 'New Payment Request'}</h2>
        <div class="sub">${isEdit ? escapeHtml(p.rfpRef||'') : 'RFP — will auto-number on save'}</div>
      </div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      ${prefillMilestone ? `
        <div class="alert-row info" style="margin-bottom:14px">
          <div class="grow">
            <strong>Raising RFP for milestone:</strong> ${escapeHtml(prefillMilestone.label)}
            (${prefillMilestone.percent}%, ${fmtMoney(prefillMilestone.amount, p.currency)})
            <div class="text-xs text-muted" style="margin-top:2px">
              Amount, currency, and due date are pre-filled from the milestone.
              When this RFP is marked <strong>paid</strong>, the milestone will automatically flip to paid.
            </div>
          </div>
        </div>
      ` : ''}
      <form id="pay-form">
        ${prefillMilestone ? `<input type="hidden" name="milestoneId" value="${escapeHtml(prefillMilestone.id)}" />` : (p.milestoneId ? `<input type="hidden" name="milestoneId" value="${escapeHtml(p.milestoneId)}" />` : '')}
        <div class="form-grid cols-3">
          <div class="field-group">
            <label>RFP Reference</label>
            <input type="text" name="rfpRef" value="${escapeHtml(p.rfpRef||'')}" placeholder="auto" ${isEdit?'':'readonly'} />
            <div class="hint">${isEdit ? 'Edit only if necessary' : 'Auto-generated: 2026/IMP/NNN'}</div>
          </div>
          <div class="field-group">
            <label>Request Date</label>
            <input type="date" name="requestDate" value="${fmtDateISO(p.requestDate) || fmtDateISO(new Date())}" />
          </div>
          <div class="field-group">
            <label>Status</label>
            <select name="status">
              ${REF.rfpStatuses.map(st => `<option value="${st}" ${p.status===st?'selected':''}>${st}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="section-divider">Approval</div>
        <div class="form-grid cols-3">
          <div class="field-group">
            <label>&nbsp;</label>
            ${can('payments','approve')
              ? `<label class="check-inline"><input type="checkbox" name="paymentApproved" ${p.paymentApproved?'checked':''} /> Request for Payment approved</label>
            <div class="hint">When ticked, shows as approved on the linked Purchase Order.</div>`
              : `<label class="check-inline"><input type="checkbox" name="paymentApproved" ${p.paymentApproved?'checked':''} disabled /> Request for Payment approved</label>
            <div class="hint">Only supervisors and managers can approve payment requests.</div>`}
          </div>
          <div class="field-group">
            <label>Approved By</label>
            <select name="paymentApprovedBy">
              <option value="">—</option>
              <option value="AB" ${p.paymentApprovedBy==='AB'?'selected':''}>AB</option>
              <option value="MC" ${p.paymentApprovedBy==='MC'?'selected':''}>MC</option>
            </select>
          </div>
          <div class="field-group">
            <label>Approval Date</label>
            <input type="date" name="paymentApprovedDate" value="${fmtDateISO(p.paymentApprovedDate)}" />
          </div>
          <div class="field-group">
            <label>&nbsp;</label>
            <label class="check-inline"><input type="checkbox" name="isPaid" ${p.isPaid?'checked':''} /> Payment made (paid)</label>
          </div>
          <div class="field-group">
            <label>Paid Date</label>
            <input type="date" name="paidDate" value="${fmtDateISO(p.paidDate)}" />
          </div>
        </div>

        <div class="section-divider">Link to Order</div>
        <div class="form-grid cols-3">
          <div class="field-group">
            <label>Order Number <span class="req">*</span></label>
            <input type="text" name="orderId" value="${escapeHtml(p.orderId||'')}" list="pay-order-list" required />
            <datalist id="pay-order-list">
              ${state.data.orders.filter(o => !o.isClosed).map(o => `<option value="${escapeHtml(o.orderId)}">${escapeHtml(o.supplier||'')} - ${fmtMoney(o.amount, o.currency)}</option>`).join('')}
            </datalist>
          </div>
          <div class="field-group">
            <label>Supplier <span class="req">*</span></label>
            <input type="text" name="supplier" value="${escapeHtml(p.supplier||'')}" required />
          </div>
          <div class="field-group">
            <label>Special Remarks</label>
            <input type="text" name="specialRemarks" value="${escapeHtml(p.specialRemarks||p.description||'')}" placeholder="e.g. Cooling Compressor For Brewery" />
          </div>
        </div>

        <div class="section-divider">Invoice &amp; Amount</div>
        <div class="form-grid cols-3">
          <div class="field-group">
            <label>Invoice Number</label>
            <input type="text" name="invoiceNumber" value="${escapeHtml(p.invoiceNumber||'')}" />
          </div>
          <div class="field-group">
            <label>Invoice Date</label>
            <input type="date" name="invoiceDate" value="${fmtDateISO(p.invoiceDate)}" />
          </div>
          <div class="field-group">
            <label>Currency <span class="req">*</span></label>
            <select name="currency" required>
              ${REF.currencies.map(c => `<option value="${c}" ${p.currency===c?'selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="field-group">
            <label>Amount <span class="req">*</span></label>
            <input type="number" name="amount" step="0.01" value="${p.amount||''}" required />
          </div>
          <div class="field-group">
            <label>Due Date <span class="req">*</span></label>
            <input type="date" name="dueDate" value="${fmtDateISO(p.dueDate)}" required />
          </div>
          <div class="field-group">
            <label>Payment Terms / Downpayment</label>
            <input type="text" name="paymentTerms" value="${escapeHtml(p.paymentTerms||'')}" placeholder="e.g. 40% UPON READINESS OF DISPATCH" />
          </div>
        </div>

        <div class="section-divider">GRN &amp; Approvals</div>
        <div class="form-grid cols-3">
          <div class="field-group">
            <label>GRN Number</label>
            <input type="text" name="grnNumber" value="${escapeHtml(p.grnNumber||'')}" />
          </div>
          <div class="field-group">
            <label>GRN Date</label>
            <input type="date" name="grnDate" value="${fmtDateISO(p.grnDate)}" />
          </div>
          <div class="field-group">
            <label>IBL Request Date</label>
            <input type="date" name="iblRequestDate" value="${fmtDateISO(p.iblRequestDate)}" />
          </div>
          <div class="field-group">
            <label>IBL Value Date</label>
            <input type="date" name="iblValueDate" value="${fmtDateISO(p.iblValueDate)}" />
          </div>
          <div class="field-group">
            <label>Payment Reference</label>
            <input type="text" name="paymentReference" value="${escapeHtml(p.paymentReference||'')}" placeholder="Bank / transaction reference" />
          </div>
          <div class="field-group full">
            <label>Coca-Cola Participation</label>
            <input type="text" name="cocaColaParticipation" value="${escapeHtml(p.cocaColaParticipation || 'N/A')}" />
          </div>
        </div>
      </form>
    </div>
    <div class="modal-foot">
      ${isEdit && window.PXUtils.can('payments','archive') ? '<button class="btn btn-danger" id="delete-pay-btn" style="margin-right:auto">Archive</button>' : ''}
      ${isEdit ? '<button class="btn" id="print-from-form">📄 Print RFP Form</button>' : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="save-pay-btn">${isEdit ? 'Save Changes' : 'Create RFP'}</button>
    </div>
  `, true);

  $('#save-pay-btn').addEventListener('click', async () => {
    const fd = new FormData($('#pay-form'));
    const data = {};
    fd.forEach((v, k) => {
      if (v === '' || v === null) data[k] = null;
      else if (k === 'amount') data[k] = parseFloat(v);
      else if (k === 'paymentApproved') data[k] = v === 'on';
      else if (k === 'isPaid') data[k] = v === 'on';
      else if (k.endsWith('Date')) data[k] = v ? new Date(v) : null;
      else data[k] = v;
    });
    // Unchecked checkbox is absent from FormData
    if (data.paymentApproved === undefined) data.paymentApproved = false;
    if (data.isPaid === undefined) data.isPaid = false;

    if (!data.orderId || !data.supplier || !data.amount || !data.dueDate) {
      toast('Fill all required fields', 'danger'); return;
    }

    // Soft duplicate warnings (non-blocking)
    const dupW = checkRfpDuplicates(data, state.data.payments, isEdit, isEdit ? payId : null);
    if (dupW.length) {
      if (!confirm('Possible duplicate payment request:\n\n• ' + dupW.join('\n• ') + '\n\nContinue anyway?')) return;
    }

    if (window.PXValidators) {
      const v = window.PXValidators.validate('payment', data, isEdit ? p : null);
      if (!v.ok) { toast('Cannot save: ' + v.errors[0], 'danger'); return; }
      if (v.warnings.length && !confirm('Please confirm:\n\n• ' + v.warnings.join('\n• ') + '\n\nSave anyway?')) return;
    }

    $('#save-pay-btn').disabled = true;
    $('#save-pay-btn').innerHTML = '<span class="spinner"></span> Saving…';
    try {
      // Entity: follow the linked order, else the current entity context
      const linkedOrd = state.data.orders.find(o => o.orderId === data.orderId);
      const payEntity = (linkedOrd && recordEntity(linkedOrd)) || currentEntity();
      data.entity = payEntity;
      let rfpRefForSync = data.rfpRef;
      let savedId = payId;
      if (isEdit) {
        await window.PXStore.updateRecord('payment_requests', payId, data, { expectedUpdatedAt: loadedUpdatedAt });
        toast('Payment request updated', 'success');
      } else {
        if (!data.rfpRef) data.rfpRef = await nextRfpRef(payEntity);
        rfpRefForSync = data.rfpRef;
        data.requestedBy = state.officer.code || state.user.email;
        const created = await window.PXStore.createRecord('payment_requests', data,
          { log: { recordType: 'payment', action: 'created', details: 'RFP ' + data.rfpRef + ' raised' } });
        savedId = created.id;
        toast(`RFP ${data.rfpRef} created`, 'success');
      }

      // === Sync milestone status on the linked order ===
      if (data.milestoneId && data.orderId) {
        await syncMilestoneFromRfp(data.orderId, data.milestoneId, {
          rfpRef: rfpRefForSync,
          status: data.status,
          iblValueDate: data.iblValueDate,
          requestDate: data.requestDate
        });
      }

      window.closeModal();
    } catch (err) {
      console.error(err);
      if (err && err.code === 'STALE_WRITE') {
        toast('This payment request was changed by someone else while you had it open. Your changes were not saved — please close, reopen the RFP to see the latest, and re-apply your edits.', 'danger');
      } else {
        toast('Save failed: ' + err.message, 'danger');
      }
      $('#save-pay-btn').disabled = false;
      $('#save-pay-btn').innerHTML = isEdit ? 'Save Changes' : 'Create RFP';
    }
  });

  if (isEdit) {
    const delPayBtn = $('#delete-pay-btn');
    if (delPayBtn) delPayBtn.addEventListener('click', async () => {
      if (!confirm('Archive this payment request?\n\nIt will be hidden from the active list but kept for audit history. Any linked milestone reverts to unpaid. You can restore it later.')) return;
      const reason = prompt('Optional reason for archiving:', '') || null;
      try {
        // Unlink milestone first (milestone reverts to unpaid)
        if (p.milestoneId && p.orderId) {
          await syncMilestoneFromRfp(p.orderId, p.milestoneId, { unlink: true });
        }
        await window.PXStore.archiveRecord('payment_requests', payId, reason);
        toast('Payment request archived', 'success'); window.closeModal();
      }
      catch (err) { toast('Archive failed: ' + err.message, 'danger'); }
    });
    $('#print-from-form').addEventListener('click', () => { window.closeModal(); setTimeout(() => window.printPaymentForm(payId), 100); });
  }
};

/* ============================================================
   syncMilestoneFromRfp — keep order.milestones in sync with the RFP
   ============================================================
   Called whenever an RFP linked to a milestone is created/updated/deleted.
   - On RFP create/update with status != 'paid': set milestone.rfpRef
   - On RFP status='paid':  set milestone.paidDate (= iblValueDate if filled, else requestDate, else today)
   - On RFP delete: clear rfpRef and paidDate, milestone returns to 'planned'
============================================================ */
