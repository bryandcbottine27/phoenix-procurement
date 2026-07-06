/* bcCardPage.js — turns the order/shipment DETAIL (normally a modal) into a full-page
   Business Central "card page": a back link, an action ribbon, the tabbed content laid
   out with a FactBox rail, replacing the list until you go Back.

   Strategy (low-risk): we WRAP window.openModal. The detail content and all its wiring
   are generated exactly as before by openOrderDetail(); we simply intercept the mount.
   When the html is a detail (contains .detail-tabs) AND bcStructure is on, we re-host it
   as a card page. Everything else still opens as a normal modal. closeModal() returns to
   the list. This is fully reversible by flipping APP_CONFIG.bcCardPage to false. */
(function () {
  function enabled() {
    return !(window.APP_CONFIG && (window.APP_CONFIG.bcStructure === false || window.APP_CONFIG.bcCardPage === false));
  }

  let previousView = null;          // the list view to return to on Back
  const origOpenModal = window.openModal;
  const origCloseModal = window.closeModal;

  // Parse the detail html string into {headInner, bodyInner} using a detached DOM.
  function splitDetail(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const head = tmp.querySelector('.modal-head');
    const body = tmp.querySelector('.modal-body');
    if (!body || !body.querySelector('.detail-tabs')) return null;   // not a detail
    return { head, body };
  }

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmtMoney(n, cur){ if (n==null||isNaN(n)) return '—'; return (cur?cur+' ':'') + Number(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function fmtDate(d){ return (window.PXUtils&&window.PXUtils.fmtDate)?window.PXUtils.fmtDate(d):(d?new Date(d).toLocaleDateString():'—'); }

  // Build the "At a glance" FactBox from the current order context.
  function buildFactBox() {
    const ctx = window.__cardContext;
    if (!ctx || ctx.type !== 'order' || !ctx.record) return '';
    const o = ctx.record;
    const pays = ctx.linkedPayments || [];
    const paidCount = pays.filter(p => p.paymentMade || p.paidDate).length;
    const today = new Date();
    const overduePays = pays.filter(p => !(p.paymentMade||p.paidDate) && p.paymentDueDate && new Date(p.paymentDueDate) < today).length;
    const received = !!(o.deliveryDate || o.actualReceiptDate);
    let otif = '—';
    if (!received && o.requestedReceiptDate) {
      const days = Math.floor((today - new Date(o.requestedReceiptDate)) / 86400000);
      otif = days > 0 ? `<span style="color:var(--danger)">${days}d overdue</span>` : `${Math.abs(days)}d to go`;
    } else if (received) { otif = '<span style="color:var(--success)">received</span>'; }
    const ships = ctx.linkedShipments || [];
    const shipStatus = ships.length ? esc(ships[0].status || ships[0].shipmentStatus || 'in progress') : '—';

    return `<aside class="factbox">
      <div class="factbox-head"><div class="t">At a glance</div></div>
      <div class="factbox-sec">
        <div class="lbl">Attention</div>
        <div class="fb-row"><span class="k">OTIF</span><span class="v">${otif}</span></div>
        <div class="fb-row"><span class="k">Payments</span><span class="v">${paidCount} / ${pays.length} paid${overduePays?` · <span style="color:var(--danger)">${overduePays} overdue</span>`:''}</span></div>
        <div class="fb-row"><span class="k">Shipment</span><span class="v">${shipStatus}</span></div>
      </div>
      <div class="factbox-sec">
        <div class="lbl">Order</div>
        <div class="fb-row"><span class="k">Amount</span><span class="v">${fmtMoney(o.amount, o.currency)}</span></div>
        <div class="fb-row"><span class="k">Supplier</span><span class="v" style="max-width:150px;text-align:right">${esc(o.supplier||'—')}</span></div>
        <div class="fb-row"><span class="k">Officer</span><span class="v">${esc(o.officerCode||'—')}</span></div>
        <div class="fb-row"><span class="k">Req. receipt</span><span class="v">${o.requestedReceiptDate?fmtDate(o.requestedReceiptDate):'—'}</span></div>
      </div>
    </aside>`;
  }

  // Build the action ribbon from capabilities.
  function buildRibbon() {
    const ctx = window.__cardContext;
    if (!ctx || !ctx.record) return '';
    const o = ctx.record, caps = ctx.caps || {};
    const btn = (label, handler, primary) => `<button class="card-rbtn${primary?' primary':''}" data-cardaction="${handler}">${label}</button>`;
    let grp1 = '', grp2 = '';
    if (caps.edit) grp1 += btn('✎ Edit', 'edit', true);
    if (caps.requestUpdate) grp2 += btn('⟳ Request update', 'requestUpdate');
    if (caps.logContact) grp2 += btn('✓ Log contact', 'logContact');
    if (caps.createPayment) grp2 += btn('＋ Add payment', 'addPayment');
    const grp3 = btn('🖨 Print', 'print');
    return `<div class="card-ribbon">
      ${grp1?`<div class="grp">${grp1}</div>`:''}
      ${grp2?`<div class="grp">${grp2}</div>`:''}
      <div class="grp">${grp3}</div>
    </div>`;
  }

  function wireRibbon(shell) {
    const ctx = window.__cardContext;
    const o = ctx && ctx.record;
    if (!o) return;
    shell.querySelectorAll('[data-cardaction]').forEach(b => {
      b.addEventListener('click', () => {
        const a = b.getAttribute('data-cardaction');
        if (a === 'edit' && window.openOrderForm) { window.closeModal(); setTimeout(() => window.openOrderForm(o.id), 60); }
        else if (a === 'print') window.print();
        else if (a === 'requestUpdate' && window.openUpdateRequestModal) window.openUpdateRequestModal('order', o.id);
        else if (a === 'logContact' && window.openContactLogModal) window.openContactLogModal(o.id);
        else if (a === 'addPayment' && window.openPaymentForm) { window.closeModal(); setTimeout(() => window.openPaymentForm(null, o.orderId), 60); }
      });
    });
  }

  // Build the card-page chrome around the existing head + body nodes.
  function mountCard(head, body) {
    const view = document.getElementById('view-ordercard');
    if (!view) return false;

    const h2 = head ? head.querySelector('h2') : null;
    const sub = head ? head.querySelector('.sub') : null;
    const titleHtml = h2 ? h2.innerHTML : 'Record';
    const subHtml = sub ? sub.innerHTML : '';
    const backLabel = (previousView && window.__viewTitle) ? window.__viewTitle(previousView) : 'Back';
    const factbox = buildFactBox();

    const shell = document.createElement('div');
    shell.className = 'bc-card-page';
    shell.innerHTML = `
      <div class="card-topbar">
        <button class="card-back" id="bc-card-back">‹ ${backLabel}</button>
      </div>
      <div class="card-title-row">
        <div class="card-title"><h1>${titleHtml}</h1>${subHtml ? `<div class="sub">${subHtml}</div>` : ''}</div>
      </div>
      ${buildRibbon()}
      <div class="card-page-body${factbox ? ' has-factbox' : ''}">
        <div class="card-main"></div>
        ${factbox}
      </div>
    `;
    // Move the existing body (tabs + panels, fully wired) into the main column untouched.
    shell.querySelector('.card-main').appendChild(body);

    view.innerHTML = '';
    view.appendChild(shell);

    const back = shell.querySelector('#bc-card-back');
    if (back) back.addEventListener('click', () => { origCloseModal(); goBack(); });
    wireRibbon(shell);

    if (window.navigate) window.navigate('ordercard');
    return true;
  }

  function goBack() {
    const target = previousView || 'dashboard';
    previousView = null;
    if (window.navigate) window.navigate(target);
  }

  // ---- Wrap openModal ----
  window.openModal = function (html, wide) {
    if (enabled() && typeof html === 'string') {
      const parts = splitDetail(html);
      if (parts) {
        // Remember where we came from (current view) so Back can return.
        previousView = (window.__state && window.__state.view) || previousView;
        if (previousView === 'ordercard') previousView = 'dashboard';
        // Clear the modal backdrop in case something opened it, then mount the card.
        try { origCloseModal(); } catch (_) {}
        if (mountCard(parts.head, parts.body)) return;
      }
    }
    return origOpenModal(html, wide);
  };

  // ---- Wrap closeModal so detail "Close" buttons return to the list ----
  window.closeModal = function () {
    // If we're on the card page, closing means going back to the list.
    if (window.__state && window.__state.view === 'ordercard') {
      goBack();
      return;
    }
    return origCloseModal();
  };

  // Renderer for the card view (content is injected by mountCard; nothing to build here,
  // but the view must have a registered renderer to satisfy the nav system).
  window.__renderers = window.__renderers || {};
  window.__renderers['ordercard'] = function () { /* content mounted by bcCardPage */ };
})();
