const { $, $$, fmtDate, fmtDateISO, fmtMoney, escapeHtml, statusBadgeClass,
  collection, addDoc, doc, updateDoc, deleteDoc, setDoc, runTransaction, getDoc, getDocs,
  serverTimestamp, toast, computeMilestoneDate, query, where,
  checkRfpDuplicates, rfpDataQuality, can, currentEntity, recordEntity, entityMeta, stripUndefined,
  cmGetColumns, cmRenderTable, cmOpenManager, cmExportCSV } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;


window.openPaymentDetail = function(payId) {
  const p = state.data.payments.find(x => x.id === payId);
  if (!p) { toast('Payment request not found', 'danger'); return; }
  window.openModal(`
    <div class="modal-head">
      <div>
        <h2>${escapeHtml(p.rfpRef || 'Payment Request')}</h2>
        <div class="sub">${escapeHtml(p.orderId || '')} · ${escapeHtml(p.supplier || '')}</div>
      </div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="status-bar">
        <span class="badge ${statusBadgeClass(p.status)}" style="font-size:12px;padding:4px 10px">${escapeHtml(p.status || 'No status')}</span>
      </div>
      ${(() => {
        const dq = rfpDataQuality(p, window.PXUtils.dataQualityContext ? window.PXUtils.dataQualityContext() : {});
        return dq.length ? `<div class="card" style="margin-bottom:14px;padding:10px 14px;background:var(--surface-warm)">
          <ul class="dq-list">${dq.map(i => `<li class="dq-item ${i.level}"><span class="dq-dot"></span><span>${escapeHtml(i.msg)}</span></li>`).join('')}</ul>
        </div>` : '';
      })()}
      ${window.PXReadiness && p.status !== 'paid' ? window.renderReadinessPanel(window.PXReadiness.forPaymentProcessing(p)) : ''}
      <div class="info-cards">
        <div class="info-card">
          <h4>RFP &amp; Order</h4>
          <dl class="kv-grid">
            <dt>RFP Reference</dt><dd class="mono" style="font-weight:600">${escapeHtml(p.rfpRef || '—')}</dd>
            <dt>Request Date</dt><dd>${fmtDate(p.requestDate) || '<span class="empty">—</span>'}</dd>
            <dt>Order Number</dt><dd class="mono">${escapeHtml(p.orderId || '—')}</dd>
            <dt>Supplier</dt><dd>${escapeHtml(p.supplier || '—')}</dd>
            <dt>Special Remarks</dt><dd>${escapeHtml(p.specialRemarks || '—')}</dd>
            <dt>Requested By</dt><dd>${escapeHtml(p.requestedBy || '—')}</dd>
          </dl>
        </div>
        <div class="info-card">
          <h4>Invoice &amp; Amount</h4>
          <dl class="kv-grid">
            <dt>Invoice No.</dt><dd class="mono">${escapeHtml(p.invoiceNumber || '—')}</dd>
            <dt>Invoice Date</dt><dd>${fmtDate(p.invoiceDate) || '<span class="empty">—</span>'}</dd>
            <dt>Amount</dt><dd style="font-weight:600">${fmtMoney(p.amount, p.currency)}</dd>
            <dt>Due Date</dt><dd>${fmtDate(p.dueDate) || '<span class="empty">—</span>'}</dd>
            <dt>Payment Terms</dt><dd>${escapeHtml(p.paymentTerms || '—')}</dd>
            <dt>GRN</dt><dd>${escapeHtml(p.grnNumber || '—')}${p.grnDate ? ' · ' + fmtDate(p.grnDate) : ''}</dd>
          </dl>
        </div>
        <div class="info-card">
          <h4>Approval &amp; Payment</h4>
          <dl class="kv-grid">
            <dt>Status</dt><dd><span class="badge ${statusBadgeClass(p.status)}">${escapeHtml(p.status || '—')}</span></dd>
            <dt>Payment Approved</dt><dd>${p.paymentApproved ? '<span class="badge success">✓ Approved</span>' + (p.paymentApprovedBy ? ' by ' + escapeHtml(p.paymentApprovedBy) : '') + (p.paymentApprovedDate ? ' · ' + fmtDate(p.paymentApprovedDate) : '') : (p.approvedBy ? escapeHtml(p.approvedBy) + ' · ' + fmtDate(p.approvedDate) : '<span class="empty">Not approved</span>')}</dd>
            <dt>Paid</dt><dd>${p.isPaid ? '<span class="badge success">✓ Paid</span>' + (p.paidDate ? ' · ' + fmtDate(p.paidDate) : '') : '<span class="empty">Not paid</span>'}</dd>
          </dl>
        </div>
        <div class="info-card">
          <h4>IBL &amp; Other</h4>
          <dl class="kv-grid">
            <dt>IBL Request</dt><dd>${fmtDate(p.iblRequestDate) || '<span class="empty">—</span>'}</dd>
            <dt>IBL Value Date</dt><dd>${fmtDate(p.iblValueDate) || '<span class="empty">—</span>'}</dd>
            <dt>Coca-Cola</dt><dd>${escapeHtml(p.cocaColaParticipation || 'N/A')}</dd>
          </dl>
        </div>
      </div>

      <div style="border-top:1px solid var(--line);margin:18px 0"></div>
      <div id="documents-section-payment-${p.id}">${window.renderDocumentsSection ? window.renderDocumentsSection('payment', p.id) : ''}</div>
      <div style="height:18px"></div>
      <div id="followups-section-payment-${p.id}">${window.renderFollowupsSection ? window.renderFollowupsSection('payment', p.id) : ''}</div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Close</button>
      <button class="btn" onclick="printPaymentForm('${p.id}')">📄 Print RFP Form</button>
      ${can('payments','edit') ? `<button class="btn btn-primary" onclick="closeModal(); setTimeout(() => openPaymentForm('${p.id}'), 100)">Edit</button>` : '<span class="text-xs text-muted" style="align-self:center">View only</span>'}
    </div>
  `, true);
  if (window.__setDetailContext) window.__setDetailContext('payment', p.id);
};

window.printPaymentForm = function(payId) {
  const p = state.data.payments.find(x => x.id === payId);
  if (!p) { toast('Not found', 'danger'); return; }
  const fmtDD = d => fmtDate(d) || '';
  const html = `
    <div class="print-form">
      <div class="ref-no">${escapeHtml(p.rfpRef || '')}</div>
      <h1>PHOENIX BEVERAGES LIMITED</h1>
      <h2>REQUEST FOR PAYMENT</h2>

      <div class="row"><div class="lbl">TO</div><div class="sep">:</div><div class="val">ACCOUNTS DEPARTMENT</div></div>
      <div class="row"><div class="lbl">FROM</div><div class="sep">:</div><div class="val">PROCUREMENT DEPARTMENT — IMPORT SECTION</div></div>
      <div class="row"><div class="lbl">DATE</div><div class="sep">:</div><div class="val">${fmtDD(p.requestDate)}</div></div>
      <div class="row"><div class="lbl">PAYMENT ORDER</div><div class="sep">:</div><div class="val">${escapeHtml(p.orderId || '')}</div></div>
      <div class="row"><div class="lbl">GRN</div><div class="sep">:</div><div class="val">${escapeHtml(p.grnNumber || '')}</div></div>
      <div class="row"><div class="lbl">GRN DATE</div><div class="sep">:</div><div class="val">${fmtDD(p.grnDate)}</div></div>
      <div style="margin-top:16px"></div>
      <div class="row"><div class="lbl">TO</div><div class="sep">:</div><div class="val">${escapeHtml(p.supplier || '')}</div></div>
      <div class="row"><div class="lbl">INVOICE NO.</div><div class="sep">:</div><div class="val">${escapeHtml(p.invoiceNumber || '')}</div></div>
      <div class="row"><div class="lbl">INVOICE DATE</div><div class="sep">:</div><div class="val">${fmtDD(p.invoiceDate)}</div></div>

      <div class="for-row">
        <div class="for">FOR : ${fmtMoney(p.amount, '')}</div>
      </div>

      <div class="row"><div class="lbl">CURRENCY</div><div class="sep">:</div><div class="val">${escapeHtml(p.currency || '')}</div></div>
      <div class="row"><div class="lbl">DUE DATE</div><div class="sep">:</div><div class="val">${fmtDD(p.dueDate)}</div></div>

      <div class="remarks">
        <div class="row"><div class="lbl">SPECIAL REMARKS</div><div class="sep">:</div><div class="val">${escapeHtml(p.specialRemarks || '')}</div></div>
      </div>
      ${p.paymentTerms ? `<div class="note">NOTE</div><div>${escapeHtml(p.paymentTerms)}</div>` : ''}

      <div style="margin-top:24px"><strong>PARTICIPATION OF COCA COLA: ${escapeHtml(p.cocaColaParticipation || 'N/A')}</strong></div>

      <div class="signature">
        <div class="line"></div>
        <div><strong>Signature</strong></div>
        <div style="font-size:11pt;margin-top:6px">${escapeHtml(p.requestedBy || '')}</div>
      </div>
    </div>
  `;
  $('#print-form-content').innerHTML = html;
  $('#print-view').classList.add('show');
  setTimeout(() => window.scrollTo(0, 0), 50);
};
