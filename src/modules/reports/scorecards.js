/* scorecards.js — Increment 5b: Supplier Scorecards
   Aggregates per-supplier KPIs across orders/shipments for the current
   entity. No stored fields. Rating = OTIF×0.4 + DQ×0.3 + punctuality×0.3. */
const { $, $$, fmtDate, escapeHtml, currentEntity, entityMeta, toast } = window.PXUtils;

/* ---------- engine ---------- */
(function () {
  function buildScorecard(opts) {
    opts = opts || {};
    const ent = opts.entity || (window.PXUtils ? window.PXUtils.currentEntity() : 'Phoenix');
    const typeFilter = opts.type || 'all';        // 'all' | 'foreign' | 'local'
    const fnFilter = opts.fn || 'all';            // 'all' | 'technical' | 'indirect' | 'supplychain'
    const st = window.__state;
    if (!st) return [];
    const recE = window.PXUtils.recordEntity;
    const ordFn = window.PXUtils.orderFunction;
    const diffDays = (a, b) => a && b ? Math.round((new Date(b) - new Date(a)) / 86400000) : null;

    const orders = st.data.orders.filter(o =>
      !o.archived && recE(o) === ent && o.supplier
      && (typeFilter === 'all' || (o.orderType || 'foreign') === typeFilter)
      && (fnFilter === 'all' || (ordFn ? ordFn(o) : o.function) === fnFilter));
    const map = {};
    orders.forEach(o => { (map[o.supplier] || (map[o.supplier] = { supplier: o.supplier, orders: [], shipments: [] })).orders.push(o); });
    // Only attach shipments whose linked order is in the filtered set (keeps OTIF consistent with the segment).
    const orderIdSet = new Set(orders.map(o => o.orderId));
    st.data.shipments.filter(s => !s.archived && orderIdSet.has(s.orderId)).forEach(s => {
      const o = st.data.orders.find(x => x.orderId === s.orderId);
      if (o && map[o.supplier]) map[o.supplier].shipments.push({ ...s, _order: o });
    });

    const dqFn = window.PXUtils.orderDataQuality;
    // Pass the full Data Quality context (shipments, calendars, helper fns) so the
    // shipment-aware checks inside orderDataQuality score accurately — same context
    // dqCockpit and order detail use. Build once per scorecard pass, not per supplier.
    const dqCtx = window.PXUtils.dataQualityContext ? window.PXUtils.dataQualityContext() : {};

    return Object.values(map).map(sup => {
      const os = sup.orders, sh = sup.shipments;
      const totalOrders = os.length;
      const openOrders = os.filter(o => !o.isClosed).length;
      const closedOrders = os.filter(o => o.isClosed).length;

      const withDates = sh.filter(s => s.grnDate && s._order && s._order.requestedReceiptDate);
      const onTime = withDates.filter(s => new Date(s.grnDate) <= new Date(s._order.requestedReceiptDate)).length;
      const otif = withDates.length ? Math.round(onTime / withDates.length * 100) : null;

      const delays = withDates.map(s => diffDays(s._order.requestedReceiptDate, s.grnDate)).filter(d => d != null);
      const avgDelay = delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : null;

      const spend = os.reduce((a, o) => a + (Number(o.amount) || 0), 0);
      const currency = os[0] && os[0].currency ? os[0].currency : '';
      const claimCount = os.reduce((a, o) => a + (Array.isArray(o.claims) ? o.claims.filter(c => c.status === 'open' || c.status === 'under_review').length : 0), 0);
      const ackDelays = os.map(o => diffDays(o.orderSentToSupplierDate || o.dateOfOrder, o.orderAcknowledgedDate)).filter(d => d != null && d >= 0);
      const ackDelayAvg = ackDelays.length ? Math.round(ackDelays.reduce((a, b) => a + b, 0) / ackDelays.length) : null;
      const readyDelays = os.map(o => diffDays(o.orderAcknowledgedDate || o.dateOfOrder, o.orderReadyDate)).filter(d => d != null && d >= 0);
      const readyDelayAvg = readyDelays.length ? Math.round(readyDelays.reduce((a, b) => a + b, 0) / readyDelays.length) : null;
      const etaChanges = sh.reduce((a, s) => a + (Array.isArray(s.etaChangeHistory) ? s.etaChangeHistory.length : 0), 0);
      const receiptExceptions = sh.filter(s => ['Partially received', 'Short received', 'Missing goods', 'Damaged goods', 'Over received'].includes(s.receiptResult || '') || (s.followupAction && s.followupAction !== 'No action')).length;
      const orderDocIds = new Set(os.map(o => o.id));
      const shipDocIds = new Set(sh.map(s => s.id));
      const docIssues = (st.data.documents || []).filter(d => !d.archived &&
        ((d.relatedType === 'order' && orderDocIds.has(d.relatedId)) || (d.relatedType === 'shipment' && shipDocIds.has(d.relatedId))) &&
        ['requested', 'rejected', 'missing'].includes(d.status || '')).length;
      const issueCount = (st.data.issues || []).filter(i => !i.archived && i.status === 'open' &&
        ((i.relatedType === 'order' && orderDocIds.has(i.relatedId)) || (i.relatedType === 'shipment' && shipDocIds.has(i.relatedId)))).length;

      const dqScores = dqFn ? os.map(o => { const i = dqFn(o, dqCtx); const d = i.filter(x => x.level === 'danger').length; const w = i.filter(x => x.level === 'warn').length; return Math.max(0, 100 - d * 10 - w * 3); }) : [];
      const dqScore = dqScores.length ? Math.round(dqScores.reduce((a, b) => a + b, 0) / dqScores.length) : null;

      const delayPenalty = avgDelay != null ? Math.max(0, 100 - Math.min(100, Math.abs(Math.min(0, avgDelay || 0)) * 5)) : 100;
      const reliabilityPenalty = Math.min(25, etaChanges * 2 + receiptExceptions * 5 + docIssues * 2 + issueCount * 4);
      const rating = Math.max(0, Math.round((otif != null ? otif : 100) * 0.4 + (dqScore != null ? dqScore : 100) * 0.3 + delayPenalty * 0.3 - reliabilityPenalty));

      return { supplier: sup.supplier, totalOrders, openOrders, closedOrders, otif, avgDelay, spend, currency, claimCount, dqScore, rating,
        ackDelayAvg, readyDelayAvg, etaChanges, receiptExceptions, docIssues, issueCount };
    }).sort((a, b) => a.rating - b.rating);
  }
  window.PXScorecard = { buildScorecard };
})();

/* ---------- view ---------- */
window.__renderers['scorecards'] = function () {
  const viewEl = $('#view-scorecards');
  if (!viewEl) return;
  const ent = currentEntity();
  const meta = entityMeta(ent);
  if (!window.PXScorecard) { viewEl.innerHTML = '<p class="op-empty">Scorecard engine unavailable.</p>'; return; }

  const ratingColor = r => r >= 80 ? 'var(--success,#27ae60)' : r >= 60 ? 'var(--warn,#e67e22)' : 'var(--danger,#c0392b)';
  const pct = v => v != null ? v + '%' : '<span class="text-muted">—</span>';
  const money = (v, cur) => v ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur ? ' ' + cur : '') : '<span class="text-muted">—</span>';
  const delay = d => d == null ? '<span class="text-muted">—</span>' : d === 0 ? '<span style="color:var(--success,#27ae60)">On time</span>' : d > 0 ? `<span style="color:var(--danger,#c0392b)">+${d}d late</span>` : `<span style="color:var(--success,#27ae60)">${Math.abs(d)}d early</span>`;

  // Segregation filters (entity is already applied via the sidebar switcher).
  const f = (window.__state.filters.scorecards || (window.__state.filters.scorecards = { type: 'all', fn: 'all' }));
  if (f.category !== undefined) { delete f.category; if (f.fn === undefined) f.fn = 'all'; } // migrate old state
  const FN = window.REF.functions;  // { technical:{short}, indirect:{short}, supplychain:{short} }

  const rows = window.PXScorecard.buildScorecard({ entity: ent, type: f.type, fn: f.fn });

  const tableRows = rows.map(r => `
    <tr>
      <td><strong>${escapeHtml(r.supplier)}</strong></td>
      <td class="num" style="font-weight:700;color:${ratingColor(r.rating)}">${r.rating}</td>
      <td class="num">${r.totalOrders}</td>
      <td class="num">${r.openOrders}</td>
      <td class="num">${pct(r.otif)}</td>
      <td class="num">${delay(r.avgDelay)}</td>
      <td class="num">${r.dqScore != null ? r.dqScore : '<span class="text-muted">—</span>'}</td>
      <td class="num">${r.claimCount ? `<span style="color:var(--danger,#c0392b);font-weight:600">${r.claimCount}</span>` : '0'}</td>
      <td class="num">${r.ackDelayAvg != null ? r.ackDelayAvg + 'd' : '<span class="text-muted">—</span>'}</td>
      <td class="num">${r.etaChanges || 0}</td>
      <td class="num">${r.receiptExceptions || 0}</td>
      <td class="num">${money(r.spend, r.currency)}</td>
    </tr>`).join('');

  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  const avgRating = avg(rows.map(r => r.rating));
  const avgOtif = avg(rows.filter(r => r.otif != null).map(r => r.otif));
  const segLabel = (f.type === 'all' ? 'All orders' : f.type === 'foreign' ? 'Foreign' : 'Local')
                 + (f.fn === 'all' ? '' : ' · ' + (FN[f.fn] ? FN[f.fn].short : f.fn));

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title"><h1>Supplier Scorecards</h1>
        <span class="desc">${escapeHtml(meta.code)} · ${escapeHtml(segLabel)} — ${rows.length} supplier${rows.length === 1 ? '' : 's'}. Ranked by overall rating.</span>
      </div>
    </div>
    <div class="toolbar">
      <select id="scorecard-type">
        <option value="all" ${f.type==='all'?'selected':''}>All orders (Local + Foreign)</option>
        <option value="foreign" ${f.type==='foreign'?'selected':''}>Foreign only</option>
        <option value="local" ${f.type==='local'?'selected':''}>Local only</option>
      </select>
      <select id="scorecard-fn">
        <option value="all" ${f.fn==='all'?'selected':''}>All functions</option>
        <option value="technical" ${f.fn==='technical'?'selected':''}>${escapeHtml(FN.technical.short)}</option>
        <option value="indirect" ${f.fn==='indirect'?'selected':''}>${escapeHtml(FN.indirect.short)}</option>
        <option value="supplychain" ${f.fn==='supplychain'?'selected':''}>${escapeHtml(FN.supplychain.short)}</option>
      </select>
      <div class="filter-count">${rows.length}</div>
    </div>
    <div class="kpi-pill-row">
      <div class="kpi-pill"><div class="kpi-pill-label">Suppliers scored</div><div class="kpi-pill-value">${rows.length}</div><div class="kpi-pill-sub">${escapeHtml(segLabel)}</div></div>
      ${avgRating != null ? `<div class="kpi-pill" style="border-color:${ratingColor(avgRating)}"><div class="kpi-pill-label">Avg rating</div><div class="kpi-pill-value" style="color:${ratingColor(avgRating)}">${avgRating}</div><div class="kpi-pill-sub">/ 100</div></div>` : ''}
      ${avgOtif != null ? `<div class="kpi-pill"><div class="kpi-pill-label">Avg OTIF</div><div class="kpi-pill-value">${avgOtif}%</div></div>` : ''}
    </div>
    <div class="info-banner">Rating = OTIF% × 0.4 + Data Quality × 0.3 + Delivery punctuality × 0.3. OTIF requires Requested Receipt Date and GRN Date on shipments. Scoped to ${escapeHtml(meta.code)}${f.type==='all'?'':' · '+(f.type==='foreign'?'Foreign':'Local')+' orders'}${f.fn==='all'?'':' · '+(FN[f.fn]?FN[f.fn].short:f.fn)}.</div>
    ${rows.length ? `<div class="table-wrap"><table class="data">
      <thead><tr>
        <th>Supplier</th><th class="num">Rating</th><th class="num">Total POs</th><th class="num">Open</th>
        <th class="num">OTIF %</th><th class="num">Avg Delay</th><th class="num">DQ Score</th>
        <th class="num">Open Claims</th><th class="num">Ack Delay</th><th class="num">ETA Changes</th>
        <th class="num">Receipt Exceptions</th><th class="num">Total Spend</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>`
    : `<p class="op-empty">No suppliers match this segment for ${escapeHtml(meta.code)}.</p>`}
  `;

  const typeSel = $('#scorecard-type');
  if (typeSel) typeSel.addEventListener('change', e => { f.type = e.target.value; window.__renderers['scorecards'](); });
  const catSel = $('#scorecard-fn');
  if (catSel) catSel.addEventListener('change', e => { f.fn = e.target.value; window.__renderers['scorecards'](); });
};
