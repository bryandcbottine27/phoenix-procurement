/* teamWork.js — "Team Work" view. A supervisor/manager oversight screen showing the
   whole stream's live work (open orders grouped by officer, follow-ups due, pending
   payments), distinct from the personal "My Work" queue. Stream-scoped: a Technical
   supervisor sees Technical work only. Officers don't see this view (hidden via RBAC). */
(function () {
  const S = () => window.__state;
  const U = () => window.PXUtils || {};

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmtDate(d){ return (U().fmtDate ? U().fmtDate(d) : (d ? new Date(d).toLocaleDateString() : '—')); }

  function streamOf() {
    return (typeof window.__roleStream === 'function') ? window.__roleStream() : null;
  }
  function orderFn(o) {
    return (typeof window.__orderFunction === 'function') ? window.__orderFunction(o) : (o.function || '');
  }
  function officerName(code) {
    const list = (S() && S().data && S().data.officers) || [];
    const o = list.find(x => x.code === code);
    return o ? (o.fullName || o.code) : (code || '—');
  }

  // Orders in the current stream (or all, if the role isn't stream-locked, e.g. a senior
  // manager), for the active entity, not closed.
  function streamOrders() {
    const st = S(); if (!st || !st.data) return [];
    const ent = st.activeEntity;
    const stream = streamOf();
    const recEnt = (typeof window.recordEntity === 'function') ? window.recordEntity : (o => o.entity);
    return (st.data.orders || []).filter(o => {
      if (o.archived || o.isClosed) return false;
      if (recEnt(o) !== ent) return false;
      if (stream && orderFn(o) !== stream) return false;
      return true;
    });
  }

  window.__renderers['teamwork'] = function () {
    const el = document.getElementById('view-teamwork');
    if (!el) return;

    // Guard: only privileged roles (supervisor/manager/admin) should see this.
    const privileged = (typeof window.__isPrivileged === 'function') ? window.__isPrivileged() : false;
    if (!privileged) {
      el.innerHTML = `<div class="page-head"><div class="title"><h1>Team Work</h1></div></div>
        <div class="card"><p class="text-sm text-muted">Team Work is available to supervisors and managers. Your personal queue is under <strong>My Work</strong>.</p></div>`;
      return;
    }

    const orders = streamOrders();
    const streamLabel = (typeof window.departmentLabel === 'function') ? window.departmentLabel() : 'Team';
    const today = new Date();

    // Group open orders by officer.
    const byOfficer = {};
    orders.forEach(o => {
      const k = o.officerCode || '—';
      (byOfficer[k] = byOfficer[k] || []).push(o);
    });
    const officerCodes = Object.keys(byOfficer).sort((a, b) => byOfficer[b].length - byOfficer[a].length);

    // Follow-ups due (next follow-up date <= today) across the stream.
    const followUpsDue = orders.filter(o => o.nextSupplierFollowupDate && new Date(o.nextSupplierFollowupDate) <= today);

    // Overdue receipts across the stream.
    const overdue = orders.filter(o => o.requestedReceiptDate && new Date(o.requestedReceiptDate) < today
      && !(o.deliveryDate || o.actualReceiptDate));

    const open = (id) => `onclick="window.openOrderDetail && window.openOrderDetail('${esc(id)}')" style="cursor:pointer"`;

    const workloadRows = officerCodes.map(code => {
      const list = byOfficer[code];
      const od = list.filter(o => o.requestedReceiptDate && new Date(o.requestedReceiptDate) < today && !(o.deliveryDate||o.actualReceiptDate)).length;
      const fu = list.filter(o => o.nextSupplierFollowupDate && new Date(o.nextSupplierFollowupDate) <= today).length;
      return `<tr>
        <td>${esc(officerName(code))}</td>
        <td class="num">${list.length}</td>
        <td class="num">${od ? `<span class="badge danger" style="font-size:10px">${od}</span>` : '0'}</td>
        <td class="num">${fu ? `<span class="badge warn" style="font-size:10px">${fu}</span>` : '0'}</td>
      </tr>`;
    }).join('');

    const listCard = (title, rows, rowFn, headers, cap = 8) => {
      const shown = rows.slice(0, cap);
      return `<div class="card" style="margin-bottom:14px">
        <div class="card-head" style="margin-bottom:8px"><h3>${title} <span class="text-muted" style="font-size:13px;font-weight:400">(${rows.length})</span></h3></div>
        ${rows.length ? `<div class="table-wrap"><table class="data"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${shown.map(rowFn).join('')}</tbody></table></div>`
        : '<p class="text-sm" style="color:var(--success)">✓ Nothing outstanding</p>'}
      </div>`;
    };

    el.innerHTML = `
      <div class="page-head"><div class="title">
        <h1>Team Work</h1>
        <span class="desc">${esc(streamLabel)} · ${orders.length} open order(s) across ${officerCodes.length} officer(s)</span>
      </div></div>

      <div class="card" style="margin-bottom:14px">
        <div class="card-head" style="margin-bottom:8px"><h3>Team workload</h3></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Officer</th><th>Open orders</th><th>Overdue</th><th>Follow-up due</th></tr></thead>
          <tbody>${workloadRows || '<tr><td colspan="4" class="text-muted">No open orders in your stream.</td></tr>'}</tbody>
        </table></div>
      </div>

      ${listCard('Overdue receipts — whole team', overdue,
        o => `<tr ${open(o.orderId)}><td class="mono">${esc(o.orderId)}</td><td class="truncate">${esc(o.supplier||'')}</td><td>${esc(officerName(o.officerCode))}</td><td>${fmtDate(o.requestedReceiptDate)}</td></tr>`,
        ['Order','Supplier','Officer','Requested receipt'])}

      ${listCard('Follow-ups due — whole team', followUpsDue,
        o => `<tr ${open(o.orderId)}><td class="mono">${esc(o.orderId)}</td><td class="truncate">${esc(o.supplier||'')}</td><td>${esc(officerName(o.officerCode))}</td><td>${fmtDate(o.nextSupplierFollowupDate)}</td></tr>`,
        ['Order','Supplier','Officer','Next follow-up'])}
    `;
  };

  // Count badge in the nav (open orders in stream) — only meaningful for privileged roles.
  window.__teamWorkCount = function () {
    try {
      const privileged = (typeof window.__isPrivileged === 'function') ? window.__isPrivileged() : false;
      if (!privileged) return 0;
      return streamOrders().length;
    } catch (_) { return 0; }
  };
})();
