const { $, $$, fmtDate, fmtMoney, escapeHtml, currentEntity, recordEntity, entityMeta, toast } = window.PXUtils;
const state = window.__state;
const REF = window.REF;

/* ============================================================
   FORTHCOMING PAYMENTS — milestone-driven forecast (view)
   ============================================================
   Forthcoming payment is per PURCHASE ORDER and per MILESTONE attached to it.
   The Accounts (A/C) department reads this PO-by-PO, extracts the milestone
   payment lines, and adds them to their overall payment follow-up sheet — so the
   default arrangement is grouped by Purchase Order, and an Export CSV gives them
   one row per PO + milestone to paste into that sheet.

   Engine: window.__pay_buildPaymentsForecast (flat) /
           window.__pay_buildPaymentsForecastByPO (grouped) /
           window.__pay_buildForecastCSV (A/C export).
   Includes ALL unpaid milestones (RFP-raised and not-yet-raised). Entity-aware. */
window.__renderers['forecast'] = function () {
  const viewEl = $('#view-forecast');
  if (!viewEl) return;
  const ent = currentEntity();
  const meta = entityMeta(ent);
  const buildFlat = window.__pay_buildPaymentsForecast || (() => ({ rows: [], byCurrency: {} }));
  const buildPO = window.__pay_buildPaymentsForecastByPO || (() => []);
  const { byCurrency } = buildFlat({ entity: ent });

  const f = state.filters.forecast || (state.filters.forecast = { band: '', search: '', mode: 'po' });
  if (!f.mode) f.mode = 'po';
  const viewMode = window.PXView.mode('forecast-view');
  const fcCard = r => window.PXCards.card({
    ref: r.orderId, entity: entityMeta(r.entity).short, entityAccent: entityMeta(r.entity).accent,
    title: `${r.description || ''}${r.description ? ' · ' : ''}${r.milestoneLabel || ''}${r.percent ? ` (${r.percent}%)` : ''}`,
    supplier: r.supplier,
    statusBadge: r.daysUntil == null ? { text: 'no date', cls: 'neutral' } : (r.daysUntil < 0 ? { text: `${Math.abs(r.daysUntil)}d overdue`, cls: 'danger' } : { text: `in ${r.daysUntil}d`, cls: r.daysUntil <= 7 ? 'warn' : 'neutral' }),
    badges: r.rfpRaised ? [{ text: 'RFP raised', cls: 'info' }] : [],
    dates: [{ label: 'Forecast', value: r.forecastDate ? fmtDate(r.forecastDate) : '', overdue: r.overdue }],
    amount: r.amount != null ? fmtMoney(r.amount, r.currency) : null,
    note: r.isEstimate ? 'Estimated date — updates when a firm trigger date is recorded' : '',
    onclick: `openOrderDetail('${r.orderDocId}')`, actionLabel: 'Open'
  });

  const bandMatch = r => {
    if (!f.band) return true;
    const d = r.daysUntil;
    if (f.band === 'overdue')  return d != null && d < 0;
    if (f.band === '30')       return d != null && d >= 0 && d <= 30;
    if (f.band === '60')       return d != null && d > 30 && d <= 60;
    if (f.band === '90')       return d != null && d > 60 && d <= 90;
    if (f.band === 'later')    return d == null || d > 90;
    return true;
  };
  const searchMatch = r => {
    if (!f.search) return true;
    const q = f.search.toLowerCase();
    return [r.orderId, r.supplier, r.milestoneLabel, r.rfpRef].join(' ').toLowerCase().includes(q);
  };

  const curPills = Object.keys(byCurrency).sort().map(cur => {
    const c = byCurrency[cur];
    return `<div class="kpi-pill">
      <div class="kpi-pill-label">${escapeHtml(cur)} forthcoming</div>
      <div class="kpi-pill-value">${fmtMoney(c.total, cur)}</div>
      <div class="kpi-pill-sub">${c.count} milestone${c.count===1?'':'s'}${c.overdue ? ` · <span style="color:var(--danger)">${fmtMoney(c.overdue, cur)} overdue</span>` : ''}</div>
    </div>`;
  }).join('');

  const bandBtn = (val, label) => `<button class="chip ${f.band===val?'chip-active':''}" data-band="${val}">${label}</button>`;
  const dayCell = r => {
    if (r.daysUntil == null) return '<span class="text-muted">—</span>';
    if (r.daysUntil < 0)  return `<span class="doc-exp doc-exp-expired">${Math.abs(r.daysUntil)}d overdue</span>`;
    if (r.daysUntil <= 7) return `<span class="doc-exp doc-exp-soon">in ${r.daysUntil}d</span>`;
    return `in ${r.daysUntil}d`;
  };
  const estTag = r => r.isEstimate ? `<span class="est-tag" title="Estimated from ${escapeHtml(r.estimateBasis || 'order data')} — no firm trigger date yet">est.</span>` : '';
  const rfpCell = r => r.rfpRaised ? `<span class="badge badge-info" title="RFP ${escapeHtml(r.rfpRef||'')} raised, not yet paid">RFP raised</span>` : '<span class="text-muted text-xs">not raised</span>';

  let bodyHtml = '', countLabel = '';
  if (f.mode === 'po') {
    let groups = buildPO({ entity: ent });
    groups = groups.map(g => ({ ...g, milestones: g.milestones.filter(m => bandMatch(m) && searchMatch(m)) }))
                   .filter(g => g.milestones.length);
    const poCount = groups.length;
    const msCount = groups.reduce((s, g) => s + g.milestones.length, 0);
    countLabel = `${poCount} PO${poCount===1?'':'s'} · ${msCount} milestone${msCount===1?'':'s'}`;
    // One line per milestone, PO info repeated on each line (grouped by PO, PO order preserved).
    const rowsHtml = groups.map(g => g.milestones.map(m => `
      <tr class="${m.overdue ? 'row-overdue' : ''}" onclick="openOrderDetail('${g.orderDocId}')" style="cursor:pointer">
        <td><span class="entity-badge" style="background:${entityMeta(g.entity).accent};color:#fff">${entityMeta(g.entity).short}</span></td>
        <td><span class="mono">${escapeHtml(g.orderId)}</span></td>
        <td class="truncate" title="${escapeHtml(g.description||'')}">${escapeHtml(g.description||'—')}</td>
        <td class="truncate" title="${escapeHtml(g.supplier)}">${escapeHtml(g.supplier)}</td>
        <td>${escapeHtml(m.milestoneLabel)}${m.percent ? ` <span class="text-muted text-xs">(${m.percent}%)</span>` : ''}</td>
        <td class="num">${m.amount != null ? fmtMoney(m.amount, g.currency) : '<span class="text-muted">—</span>'}</td>
        <td>${m.forecastDate ? fmtDate(m.forecastDate) : '<span class="text-muted">no date</span>'} ${estTag(m)}</td>
        <td>${dayCell(m)}</td>
        <td>${rfpCell(m)}</td>
      </tr>`).join('')).join('');
    bodyHtml = groups.length ? `<div class="table-wrap"><table class="data"><thead><tr>
        <th></th><th>FPO</th><th>Description</th><th>Supplier</th><th>Milestone</th><th class="num">Amount</th>
        <th>Forecast date</th><th>When</th><th>RFP</th>
      </tr></thead><tbody>${rowsHtml}</tbody></table></div>`
      : `<p class="op-empty">No forthcoming payments match this filter.</p>`;
    if (viewMode === 'cards') {
      const flat = groups.flatMap(g => g.milestones.map(m => ({ ...m, entity: g.entity, orderId: g.orderId, description: g.description, supplier: g.supplier, currency: g.currency, orderDocId: g.orderDocId })));
      bodyHtml = window.PXCards.grid(flat.map(fcCard).join(''), 'No forthcoming payments match this filter');
    }
  } else {
    let rows = buildFlat({ entity: ent }).rows.filter(r => bandMatch(r) && searchMatch(r));
    countLabel = `${rows.length} milestone${rows.length===1?'':'s'}`;
    const rowsHtml = rows.map(r => `
      <tr class="${r.overdue ? 'row-overdue' : ''}" onclick="openOrderDetail('${r.orderDocId}')" style="cursor:pointer">
        <td><span class="entity-badge" style="background:${entityMeta(r.entity).accent};color:#fff">${entityMeta(r.entity).short}</span></td>
        <td><span class="mono">${escapeHtml(r.orderId)}</span></td>
        <td class="truncate" title="${escapeHtml(r.description||'')}">${escapeHtml(r.description||'—')}</td>
        <td class="truncate" title="${escapeHtml(r.supplier)}">${escapeHtml(r.supplier)}</td>
        <td>${escapeHtml(r.milestoneLabel)}${r.percent ? ` <span class="text-muted text-xs">(${r.percent}%)</span>` : ''}</td>
        <td class="num">${r.amount != null ? fmtMoney(r.amount, r.currency) : '<span class="text-muted">—</span>'}</td>
        <td>${r.forecastDate ? fmtDate(r.forecastDate) : '<span class="text-muted">no date</span>'} ${estTag(r)}</td>
        <td>${dayCell(r)}</td>
        <td>${rfpCell(r)}</td>
      </tr>`).join('');
    bodyHtml = rows.length ? `<div class="table-wrap"><table class="data"><thead><tr>
        <th></th><th>FPO</th><th>Description</th><th>Supplier</th><th>Milestone</th><th class="num">Amount</th>
        <th>Forecast date</th><th>When</th><th>RFP</th>
      </tr></thead><tbody>${rowsHtml}</tbody></table></div>`
      : `<p class="op-empty">No forthcoming payments match this filter.</p>`;
    if (viewMode === 'cards') bodyHtml = window.PXCards.grid(rows.map(fcCard).join(''), 'No forthcoming payments match this filter');
  }

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title">
        <h1>Forthcoming Payments</h1>
        <span class="desc">${escapeHtml(meta.code)} — per Purchase Order and per milestone. ${countLabel}.</span>
      </div>
      <div class="page-actions">
        ${window.PXView.toggle('forecast-view')}
        <button class="btn btn-primary" id="forecast-export-xlsx">⬇ Export for A/C (Excel)</button>
        <button class="btn btn-ghost" id="forecast-export-csv">⤓ Excel</button>
      </div>
    </div>

    <div class="kpi-pill-row">${curPills || '<div class="text-muted">No forthcoming payments for this entity.</div>'}</div>

    <div class="toolbar">
      <div class="chip-row">
        <button class="chip ${f.mode==='po'?'chip-active':''}" data-mode="po">By Purchase Order</button>
        <button class="chip ${f.mode==='flat'?'chip-active':''}" data-mode="flat">By date</button>
      </div>
      <div class="chip-row" style="margin-left:12px">
        ${bandBtn('', 'All')}${bandBtn('overdue', 'Overdue')}${bandBtn('30', '≤ 30 days')}${bandBtn('60', '31–60')}${bandBtn('90', '61–90')}${bandBtn('later', '90+ / undated')}
      </div>
      <input type="search" id="forecast-search" class="input" placeholder="Search FPO / supplier / milestone…" value="${escapeHtml(f.search)}" style="max-width:240px;margin-left:auto">
    </div>

    <div class="info-banner">
      <strong>For Accounts:</strong> this lists every unpaid milestone (including those with an RFP already raised) grouped under its Purchase Order. <strong>Estimated dates</strong> (<span class="est-tag">est.</span>) use the order's requested receipt date, else order-ready date, else order date + ${REF.forecastDefaultLeadDays || 60} days, and update automatically once the real trigger date is recorded. Use <strong>Export for A/C</strong> to pull one row per PO + milestone into your payment follow-up sheet.
    </div>

    ${bodyHtml}
  `;

  $$('#view-forecast [data-mode]').forEach(b => b.addEventListener('click', () => {
    f.mode = b.getAttribute('data-mode'); window.__renderers['forecast']();
  }));
  window.PXView.bind('forecast-view', () => window.__renderers['forecast'](), $('#view-forecast'));
  $$('#view-forecast [data-band]').forEach(b => b.addEventListener('click', () => {
    f.band = b.getAttribute('data-band'); window.__renderers['forecast']();
  }));
  const si = $('#forecast-search');
  if (si) window.PXUtils.bindSearchInput(si, {
    key: 'forecast-search',
    setValue: value => { f.search = value; },
    render: () => window.__renderers['forecast']()
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = `forthcoming-payments_${entityMeta(ent).short}_${stamp}`;
  const csvBtn = $('#forecast-export-csv');
  if (csvBtn) csvBtn.addEventListener('click', () => {
    const csv = (window.__pay_buildForecastCSV || (() => ''))({ entity: ent });
    if (window.__rep_downloadFile) window.__rep_downloadFile(baseName + '.csv', csv, 'text/csv');
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = baseName + '.csv'; a.click();
    }
    if (toast) toast('Forthcoming payments exported (CSV)', 'success');
  });
  const xlsxBtn = $('#forecast-export-xlsx');
  if (xlsxBtn) xlsxBtn.addEventListener('click', () => {
    try {
      const blob = window.__pay_buildForecastXLSX({ entity: ent });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = baseName + '.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      if (toast) toast('Forthcoming payments exported (Excel)', 'success');
    } catch (e) {
      console.error(e);
      if (toast) toast('Excel export failed: ' + e.message, 'danger');
    }
  });
};

window.__forecastCount = function () {
  try {
    const ent = currentEntity();
    const build = window.__pay_buildPaymentsForecast;
    if (!build) return 0;
    return build({ entity: ent }).rows.length;
  } catch (e) { return 0; }
};
