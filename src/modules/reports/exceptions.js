/* exceptions.js — Stuck-orders / exceptions board.
   One operational view answering "what is stuck and whose?" across the active entity.
   This is presentation over PXProcFollowup.orderChecks() (acknowledgement, promises,
   follow-ups, receipts, shipments, payments, issues, ERP exceptions) — it does not
   recompute logic. Exceptions are grouped by type (most-severe-then-most-frequent),
   each expandable to the affected orders, with a by-officer roll-up for handover and
   accountability. Visible to all officers; the roll-up is the cross-officer view. */
const { $, $$, fmtDate, escapeHtml, currentEntity, recordEntity, entityMeta, orderFunction } = window.PXUtils;
const state = window.__state;
const REF = window.REF;

window.__renderers['exceptions'] = function () {
  const viewEl = $('#view-exceptions');
  if (!viewEl) return;
  const ent = currentEntity();
  const meta = entityMeta(ent) || {};
  const PF = window.PXProcFollowup;
  if (!PF) { viewEl.innerHTML = '<div class="info-banner">Follow-up engine unavailable.</div>'; return; }

  const f = state.filters.exceptions || (state.filters.exceptions = { officer: '', severity: '', type: '' });
  const ctx = PF.context();

  // Active, entity-scoped orders only.
  const orders = (state.data.orders || []).filter(o => !o.archived && recordEntity(o) === ent && !o.isClosed);
  const officerMap = Object.fromEntries((state.data.officers || []).map(o => [o.code, o.fullName || o.code]));

  // Build a flat list of { order, check } exceptions, applying filters.
  const sevRank = { danger: 0, warn: 1, info: 2 };
  const flat = [];
  orders.forEach(o => {
    const checks = PF.orderChecks(o, ctx);
    checks.forEach(c => {
      if (f.severity && c.level !== f.severity) return;
      if (f.officer && o.officerCode !== f.officer && o.logisticOfficer !== f.officer) return;
      if (f.type && c.key !== f.type) return;
      flat.push({ order: o, check: c });
    });
  });

  // --- Group by exception type (key) ---
  const groups = new Map();
  flat.forEach(({ order, check }) => {
    const g = groups.get(check.key) || { key: check.key, level: check.level, label: check.msg.replace(/\d+/g, 'N'), items: [] };
    // keep the most severe level seen for this key
    if (sevRank[check.level] < sevRank[g.level]) g.level = check.level;
    g.items.push({ order, check });
    groups.set(check.key, g);
  });
  const groupList = [...groups.values()].sort((a, b) =>
    (sevRank[a.level] - sevRank[b.level]) || (b.items.length - a.items.length));

  // --- Owner roll-up: per officer, count of stuck orders + danger-level exceptions ---
  const byOfficer = {};
  const stuckOrderIds = new Set(flat.map(x => x.order.id));
  flat.forEach(({ order, check }) => {
    const code = order.officerCode || '—';
    const r = byOfficer[code] || (byOfficer[code] = { code, orders: new Set(), danger: 0, total: 0 });
    r.orders.add(order.id); r.total++; if (check.level === 'danger') r.danger++;
  });
  const ownerRows = Object.values(byOfficer)
    .map(r => ({ code: r.code, name: officerMap[r.code] || r.code, orders: r.orders.size, danger: r.danger, total: r.total }))
    .sort((a, b) => b.danger - a.danger || b.orders - a.orders);

  const sevBadge = lvl => lvl === 'danger' ? '<span class="badge danger">Critical</span>'
    : lvl === 'warn' ? '<span class="badge warn">Warning</span>' : '<span class="badge neutral">Info</span>';

  const totalDanger = flat.filter(x => x.check.level === 'danger').length;
  const totalWarn = flat.filter(x => x.check.level === 'warn').length;

  // Officer + type filter options
  const officers = (state.data.officers || []).filter(o => o.active !== false);
  const typeOpts = [...groups.values()].sort((a,b)=>(sevRank[a.level]-sevRank[b.level])).map(g => g.key);

  const orderRow = ({ order, check }) => {
    const owner = [order.officerCode, order.logisticOfficer].filter(Boolean).join(' / ') || '—';
    const fn = orderFunction(order);
    const fnShort = REF.functions[fn] ? REF.functions[fn].short : fn;
    return `<tr onclick="openOrderDetail('${order.id}')" style="cursor:pointer">
      <td><span class="mono">${escapeHtml(order.orderId || '—')}</span></td>
      <td class="truncate" title="${escapeHtml(order.supplier||'')}">${escapeHtml(order.supplier || '—')}</td>
      <td class="text-xs">${escapeHtml((order.orderType||'foreign')==='foreign'?'Foreign':'Local')} · ${escapeHtml(fnShort)}</td>
      <td class="text-sm">${escapeHtml(check.msg)}</td>
      <td class="text-xs">${escapeHtml(owner)}</td>
    </tr>`;
  };

  const drill = (g) => `
    <details class="dq-drill" style="margin:8px 0;border:1px solid var(--line);border-radius:6px">
      <summary style="cursor:pointer;padding:10px 12px;font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:10px">
        <span>${sevBadge(g.level)} ${escapeHtml(g.label)}</span>
        <span class="badge ${g.level==='danger'?'danger':'warn'}">${g.items.length} order${g.items.length===1?'':'s'}</span>
      </summary>
      <div style="padding:0 12px 12px">
        <div class="table-wrap"><table class="data">
          <thead><tr><th>PO</th><th>Supplier</th><th>Type/Fn</th><th>Exception</th><th>Owner (P/L)</th></tr></thead>
          <tbody>${g.items
            .sort((a,b)=>(b.check.points||0)-(a.check.points||0))
            .map(orderRow).join('')}</tbody>
        </table></div>
      </div>
    </details>`;

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title"><h1>Exceptions</h1>
        <span class="desc">${escapeHtml(meta.code || ent)} — what is stuck across active orders, and whose. ${stuckOrderIds.size} order(s) with ${flat.length} open exception(s).</span>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm" id="exc-export">⤓ Export Excel</button>
      </div>
    </div>

    <div class="kpi-pill-row">
      <div class="kpi-pill"><div class="kpi-pill-label">orders stuck</div><div class="kpi-pill-value">${stuckOrderIds.size}</div></div>
      <div class="kpi-pill"><div class="kpi-pill-label">critical exceptions</div><div class="kpi-pill-value" style="color:var(--danger,#c0392b)">${totalDanger}</div></div>
      <div class="kpi-pill"><div class="kpi-pill-label">warnings</div><div class="kpi-pill-value" style="color:var(--warn,#e67e22)">${totalWarn}</div></div>
      <div class="kpi-pill"><div class="kpi-pill-label">exception types</div><div class="kpi-pill-value">${groupList.length}</div></div>
    </div>

    <div class="toolbar" style="flex-wrap:wrap;gap:8px">
      <select id="exc-severity">
        <option value="">All severities</option>
        <option value="danger" ${f.severity==='danger'?'selected':''}>Critical only</option>
        <option value="warn" ${f.severity==='warn'?'selected':''}>Warnings</option>
        <option value="info" ${f.severity==='info'?'selected':''}>Info</option>
      </select>
      <select id="exc-officer">
        <option value="">All officers</option>
        ${officers.map(o=>`<option value="${escapeHtml(o.code)}" ${f.officer===o.code?'selected':''}>${escapeHtml(o.fullName||o.code)} (${escapeHtml(o.code)})</option>`).join('')}
      </select>
      ${f.type ? `<button class="btn btn-sm" id="exc-clear-type">Clear type filter ✕</button>` : ''}
    </div>

    ${flat.length === 0
      ? '<div class="info-banner" style="border-color:var(--success,#27ae60);color:var(--success,#27ae60)">✓ Nothing is stuck for this entity under the current filters. Every active order is progressing.</div>'
      : `
        <h3 style="margin:20px 0 8px">Exceptions by type</h3>
        ${groupList.map(drill).join('')}

        <h3 style="margin:24px 0 8px">By officer <span class="hint" style="text-transform:none;font-weight:400;color:var(--muted-soft);font-size:11px">(stuck orders &amp; critical count — for handover)</span></h3>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Officer</th><th class="num">Orders stuck</th><th class="num">Critical</th><th class="num">Total exceptions</th></tr></thead>
          <tbody>${ownerRows.map(r => `<tr>
            <td>${escapeHtml(r.name)} <span class="text-xs text-muted">(${escapeHtml(r.code)})</span></td>
            <td class="num" style="font-weight:700">${r.orders}</td>
            <td class="num">${r.danger ? `<span class="badge danger">${r.danger}</span>` : '0'}</td>
            <td class="num">${r.total}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      `}
  `;

  // Wiring
  const reRender = () => window.__renderers['exceptions']();
  const sevSel = $('#exc-severity'); if (sevSel) sevSel.addEventListener('change', e => { f.severity = e.target.value; reRender(); });
  const offSel = $('#exc-officer'); if (offSel) offSel.addEventListener('change', e => { f.officer = e.target.value; reRender(); });
  const clr = $('#exc-clear-type'); if (clr) clr.addEventListener('click', () => { f.type = ''; reRender(); });
  const exp = $('#exc-export');
  if (exp) exp.addEventListener('click', () => {
    const rows = flat.map(({ order, check }) => ({
      PO: order.orderId || '', Supplier: order.supplier || '',
      Type: (order.orderType||'foreign'), Function: orderFunction(order),
      Severity: check.level, Exception: check.msg,
      Officer: order.officerCode || '', Logistics: order.logisticOfficer || ''
    }));
    if (window.PXUtils.cmExportCSV) window.PXUtils.cmExportCSV(rows, 'exceptions-' + (meta.code||ent));
    else {
      const head = Object.keys(rows[0]||{Exception:''});
      const csv = [head.join(','), ...rows.map(r => head.map(h => `"${String(r[h]).replace(/"/g,'""')}"`).join(','))].join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `exceptions-${meta.code||ent}.csv`; a.click();
    }
  });
};

// Count hook for the sidebar badge: stuck orders in the active entity.
window.__exceptionsCount = function () {
  try {
    const PF = window.PXProcFollowup; if (!PF) return 0;
    const ent = window.PXUtils.currentEntity();
    const recE = window.PXUtils.recordEntity;
    const ctx = PF.context();
    const stuck = (state.data.orders || []).filter(o =>
      !o.archived && recE(o) === ent && !o.isClosed && PF.orderChecks(o, ctx).some(c => c.level === 'danger'));
    return stuck.length;
  } catch (e) { return 0; }
};
