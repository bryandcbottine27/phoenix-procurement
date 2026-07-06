const { $, $$, fmtDate, escapeHtml, currentEntity, entityMeta, toast } = window.PXUtils;

/* ============================================================
   TAX PROVISION FORECAST — "TEPS"  (view)
   ============================================================
   Lists every shipment carrying a tax provision for the current entity, with the
   CFR / Insurance / Excise / VAT / Total breakdown and a grand total, plus Excel
   and CSV exports for A/C — reproducing the logistics TEPS PROVISION worksheet. */
window.__renderers['taxprovision'] = function () {
  const viewEl = $('#view-taxprovision');
  if (!viewEl) return;
  const ent = currentEntity();
  const meta = entityMeta(ent);
  const build = window.__teps_buildTaxProvision || (() => ({ rows: [], totals: {} }));
  const { rows, totals } = build({ entity: ent });

  // ---- Increment 2: actual vs estimate lookup ----
  const lcSummary = window.PXLandedCost ? window.PXLandedCost.buildActualSummary({ entity: ent }) : { rows: [], totals: { estimate:0, actual:0, variance:0, outstanding:0 } };
  const lcMap = {};
  lcSummary.rows.forEach(r => { lcMap[r.shipmentDocId] = r; });

  const f = (window.__state.filters.taxprovision || (window.__state.filters.taxprovision = { search: '' }));
  const q = (f.search || '').toLowerCase();
  const visible = rows.filter(r => !q || [r.fpo, r.supplier, r.commodity, r.mode].join(' ').toLowerCase().includes(q));

  const money = n => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const varSign = n => n >= 0 ? '+' : '';

  const viewMode = window.PXView.mode('teps-view');
  const tepsCard = r => {
    const lc = lcMap[r.shipmentDocId];
    const badges = [...(r.isAlcohol ? [{ text: 'ALC — excise', cls: 'warn' }] : [])];
    if (lc && lc.outstanding) badges.push({ text: 'Actual outstanding', cls: 'warn' });
    else if (lc && lc.actual != null) badges.push({ text: 'Actual entered', cls: 'success' });
    return window.PXCards.card({
      ref: r.fpo, entity: meta.short, entityAccent: meta.accent,
      title: `${r.commodity || '\u2014'} \u00b7 ${r.mode || ''}`, supplier: r.supplier,
      badges,
      dates: [{ label: 'ETA', value: r.eta ? fmtDate(r.eta) : '' }],
      amount: money(r.total) + ' MUR',
      note: lc && lc.actual != null
        ? `Actual MUR ${money(lc.actual)} \u00b7 Var ${varSign(lc.variance)}${money(lc.variance)}`
        : `VAT ${money(r.vat)} \u00b7 Excise ${money(r.excise)} \u00b7 CFR ${money(r.cfr)}`,
      onclick: `openShipmentDetail('${r.shipmentDocId}')`, actionLabel: 'Open'
    });
  };
  const cardsHtml = window.PXCards.grid(visible.map(tepsCard).join(''), `No shipments have a tax provision yet for ${meta.code}`);

  const lcTotals = lcSummary.totals;
  const hasActual = lcSummary.rows.some(r => r.actual != null);
  const varCol = lcTotals.variance > 0 ? 'var(--danger,#c0392b)' : lcTotals.variance < 0 ? 'var(--success,#27ae60)' : 'var(--text)';
  const outstandingCount = lcSummary.rows.filter(r => r.outstanding).length;

  const rowsHtml = visible.map(r => {
    const lc = lcMap[r.shipmentDocId];
    const outBadge = lc && lc.outstanding ? '<span class="badge warn" style="font-size:10px">Outstanding</span>' : '';
    const actualCell = lc && lc.actual != null ? money(lc.actual) : (outBadge || '<span class="text-muted">\u2014</span>');
    const varCell = lc && lc.variance != null
      ? `<span style="color:${lc.variance > 0 ? 'var(--danger,#c0392b)' : lc.variance < 0 ? 'var(--success,#27ae60)' : ''};font-weight:600">${varSign(lc.variance)}${money(lc.variance)}</span>`
      : '<span class="text-muted">\u2014</span>';
    return `
    <tr onclick="openShipmentDetail('${r.shipmentDocId}')" style="cursor:pointer">
      <td><span class="mono">${escapeHtml(r.fpo)}</span></td>
      <td class="truncate" title="${escapeHtml(r.supplier)}">${escapeHtml(r.supplier)}</td>
      <td>${escapeHtml(r.mode)}${r.isAlcohol ? ' <span class="est-tag" title="Alcoholic beverage \u2014 excise applies">ALC</span>' : ''}</td>
      <td class="truncate" title="${escapeHtml(r.commodity)}">${escapeHtml(r.commodity || '\u2014')}</td>
      <td>${r.eta ? fmtDate(r.eta) : '<span class="text-muted">\u2014</span>'}</td>
      <td class="num">${r.invoiceValue ? money(r.invoiceValue) + ' ' + escapeHtml(r.invoiceCurrency) : '\u2014'}</td>
      <td class="num">${money(r.cfr)}</td>
      <td class="num">${money(r.insurance)}</td>
      <td class="num">${r.excise ? money(r.excise) : '<span class="text-muted">\u2014</span>'}</td>
      <td class="num">${money(r.vat)}</td>
      <td class="num"><strong style="color:var(--copper,#A0522D)">${money(r.total)}</strong></td>
      <td class="num">${actualCell}</td>
      <td class="num">${varCell}</td>
    </tr>`;
  }).join('');

  const totalRow = visible.length ? `
    <tr style="background:var(--surface-warm);font-weight:700;border-top:2px solid var(--line)">
      <td colspan="6" style="text-align:right">TOTAL (MUR)</td>
      <td class="num">${money(totals.cfr)}</td>
      <td class="num">${money(totals.insurance)}</td>
      <td class="num">${money(totals.excise)}</td>
      <td class="num">${money(totals.vat)}</td>
      <td class="num" style="color:var(--copper,#A0522D)">${money(totals.total)}</td>
      <td class="num">${hasActual ? money(lcTotals.actual) : '<span class="text-muted">\u2014</span>'}</td>
      <td class="num">${hasActual ? `<span style="color:${varCol};font-weight:700">${varSign(lcTotals.variance)}${money(lcTotals.variance)}</span>` : '<span class="text-muted">\u2014</span>'}</td>
    </tr>` : '';

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title">
        <h1>Tax Provision Forecast \u2014 TEPS</h1>
        <span class="desc">${escapeHtml(meta.code)} \u2014 estimated Excise &amp; Duties + VAT payable to Customs (MRA), per shipment. ${visible.length} shipment${visible.length===1?'':'s'}.</span>
      </div>
      <div class="page-actions">
        ${window.PXView.toggle('teps-view')}
        <button class="btn btn-primary" id="teps-export-xlsx">\u2B07 Export for A/C (Excel)</button>
        <button class="btn btn-ghost" id="teps-export-csv">⤓ Excel</button>
      </div>
    </div>

    <div class="kpi-pill-row">
      <div class="kpi-pill"><div class="kpi-pill-label">Total provision (MUR)</div><div class="kpi-pill-value">${money(totals.total)}</div><div class="kpi-pill-sub">${rows.length} shipment${rows.length===1?'':'s'}</div></div>
      <div class="kpi-pill"><div class="kpi-pill-label">VAT (MUR)</div><div class="kpi-pill-value">${money(totals.vat)}</div></div>
      <div class="kpi-pill"><div class="kpi-pill-label">Excise &amp; Duties (MUR)</div><div class="kpi-pill-value">${money(totals.excise)}</div><div class="kpi-pill-sub">alcohol only</div></div>
      ${hasActual ? `
        <div class="kpi-pill"><div class="kpi-pill-label">Actual landed cost (MUR)</div><div class="kpi-pill-value">${money(lcTotals.actual)}</div><div class="kpi-pill-sub">${lcSummary.rows.filter(r=>r.actual!=null).length} entered</div></div>
        <div class="kpi-pill" style="border-color:${varCol}"><div class="kpi-pill-label">Net variance (MUR)</div><div class="kpi-pill-value" style="color:${varCol}">${varSign(lcTotals.variance)}${money(lcTotals.variance)}</div><div class="kpi-pill-sub">${lcTotals.variance > 0 ? 'over-provisioned' : lcTotals.variance < 0 ? 'under-provisioned' : 'exact'}</div></div>
      ` : ''}
      ${outstandingCount > 0 ? `<div class="kpi-pill" style="border-color:var(--warn,#e67e22)"><div class="kpi-pill-label">Outstanding actuals</div><div class="kpi-pill-value" style="color:var(--warn,#e67e22)">${outstandingCount}</div><div class="kpi-pill-sub">GRN received, awaiting cost</div></div>` : ''}
    </div>

    <div class="toolbar">
      <input type="search" id="teps-search" class="input" placeholder="Search FPO / supplier / commodity\u2026" value="${escapeHtml(f.search||'')}" style="max-width:280px">
    </div>

    <div class="info-banner">
      <strong>How this is calculated:</strong> CFR = Freight (MUR) + Invoice \u00d7 Rate; Insurance = CFR \u00d7 0.2% (editable); VAT = (CFR + Insurance) \u00d7 15% (editable); Excise &amp; Duties entered manually from MRA tariff (alcoholic beverages only). Once goods are received (GRN), enter the <strong>Actual Landed Cost (MUR)</strong> to close the variance. Click any row to open the shipment.
    </div>

    ${viewMode === 'cards' ? cardsHtml : (visible.length ? `<div class="table-wrap"><table class="data">
      <thead><tr>
        <th>FPO</th><th>Supplier</th><th>Mode</th><th>Commodity</th><th>ETA</th>
        <th class="num">Invoice</th><th class="num">CFR</th><th class="num">Insurance</th>
        <th class="num">Excise &amp; Duties</th><th class="num">VAT</th>
        <th class="num">Estimate (MUR)</th><th class="num">Actual (MUR)</th><th class="num">Variance</th>
      </tr></thead>
      <tbody>${rowsHtml}${totalRow}</tbody>
    </table></div>` : `<p class="op-empty">No shipments have a tax provision yet for ${escapeHtml(meta.code)}. Add the TEPS inputs on a shipment to see it here.</p>`)}
  `;

  const si = $('#teps-search');
  if (si) window.PXUtils.bindSearchInput(si, {
    key: 'teps-search',
    setValue: value => { f.search = value; },
    render: () => window.__renderers['taxprovision']()
  });
  window.PXView.bind('teps-view', () => window.__renderers['taxprovision'](), $('#view-taxprovision'));

  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = `tax-provision_${entityMeta(ent).short}_${stamp}`;
  const csvBtn = $('#teps-export-csv');
  if (csvBtn) csvBtn.addEventListener('click', () => {
    const csv = (window.__teps_buildCSV || (() => ''))({ entity: ent });
    if (window.__rep_downloadFile) window.__rep_downloadFile(baseName + '.csv', csv, 'text/csv');
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = baseName + '.csv'; a.click(); }
    if (toast) toast('Tax provision exported (CSV)', 'success');
  });
  const xlsxBtn = $('#teps-export-xlsx');
  if (xlsxBtn) xlsxBtn.addEventListener('click', () => {
    try {
      const blob = window.__teps_buildXLSX({ entity: ent });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = baseName + '.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      if (toast) toast('Tax provision exported (Excel)', 'success');
    } catch (e) { console.error(e); if (toast) toast('Excel export failed: ' + e.message, 'danger'); }
  });
};
