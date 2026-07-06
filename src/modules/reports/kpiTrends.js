/* kpiTrends.js — KPI Trends view + capture engine.
   Turns point-in-time KPIs into month-on-month trends. Built for go-live with
   2024→today history: backfill computes date-bucketable KPIs (OTIF, MTTO, lateness,
   clearance) for past months from real GRN/order dates, so the trend is not empty on
   day one; count KPIs (open orders, overdue) trend forward from first snapshot. Old
   or incomplete orders never block — the null-tolerant PXKpi engine just excludes
   them from a KPI's sample. Charts are inline SVG (no new dependency). */
const { $, $$, escapeHtml, currentEntity, entityMeta, recordEntity, fmtDate, toast, isPrivileged } = window.PXUtils;
const state = window.__state;

/* ============================================================
   PXKpiSnapshot — capture / backfill engine
   ============================================================ */
(function () {
  function snapshotsFor(entity) {
    return (state.data.kpiSnapshot || [])
      .filter(s => !s.archived && s.entity === entity)
      .sort((a, b) => String(a.period).localeCompare(String(b.period)));
  }
  function hasPeriod(entity, period) {
    return snapshotsFor(entity).some(s => s.period === period);
  }

  // Capture the current month's KPIs for an entity (manual or auto).
  async function capture(entity, source) {
    const period = window.PXKpi.periodKey(new Date());
    const values = window.PXKpi.compute(entity); // point-in-time, full set
    const existing = snapshotsFor(entity).find(s => s.period === period);
    const rec = {
      entity, period, values,
      capturedAt: new Date().toISOString(),
      capturedBy: (state.officer && state.officer.code) || (source === 'auto' ? 'auto' : ''),
      source: source || 'manual'
    };
    if (existing) {
      await window.PXStore.updateRecord('kpiSnapshot', existing.id, rec);
      return 'updated';
    }
    await window.PXStore.createRecord('kpiSnapshot', rec);
    return 'created';
  }

  // Backfill past months for the date-bucketable KPIs from historical dates.
  // Only fills periods that have no snapshot yet, and only the backfill-able KPIs.
  // Returns the number of periods written. Safe to re-run.
  async function backfill(entity, monthsBack) {
    monthsBack = monthsBack || 30; // covers 2024→today comfortably
    const now = new Date();
    let written = 0;
    for (let i = monthsBack; i >= 1; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const period = window.PXKpi.periodKey(d);
      if (hasPeriod(entity, period)) continue;
      const win = window.PXKpi.periodWindow(period);
      const v = window.PXKpi.compute(entity, { window: win });
      // Only write a backfill snapshot if the window actually had eligible data,
      // so we don't create empty rows for months with no activity.
      const hasData = (v.otifSample || 0) + (v.mttoSample || 0) + (v.latenessSample || 0) + (v.clearanceSample || 0) > 0;
      if (!hasData) continue;
      await window.PXStore.createRecord('kpiSnapshot', {
        entity, period, values: v,
        capturedAt: new Date().toISOString(), capturedBy: 'system', source: 'backfill'
      });
      written++;
    }
    return written;
  }

  // Auto-capture: on first app load in a new month, snapshot the prior month once.
  // (We snapshot the month that just ended so it reflects a full period.)
  async function autoCaptureIfDue(entity) {
    try {
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevPeriod = window.PXKpi.periodKey(prev);
      // Only auto-capture the previous month, and only if missing.
      if (!hasPeriod(entity, prevPeriod)) {
        const win = window.PXKpi.periodWindow(prevPeriod);
        const v = window.PXKpi.compute(entity, { window: win });
        const hasData = (v.otifSample || 0) + (v.mttoSample || 0) + (v.latenessSample || 0) + (v.clearanceSample || 0) > 0;
        if (hasData) {
          await window.PXStore.createRecord('kpiSnapshot', {
            entity, period: prevPeriod, values: v,
            capturedAt: new Date().toISOString(), capturedBy: 'auto', source: 'auto'
          });
        }
      }
    } catch (e) { /* never block app load on snapshot */ }
  }

  window.PXKpiSnapshot = { snapshotsFor, hasPeriod, capture, backfill, autoCaptureIfDue };
})();

/* ============================================================
   Inline SVG sparkline / bar chart
   ============================================================ */
function kpiChart(series, opts) {
  opts = opts || {};
  const pts = series.filter(p => p.value !== null && p.value !== undefined);
  if (pts.length < 2) return '<div class="text-xs text-muted" style="padding:14px 0">Not enough history yet — trends appear once two or more periods are captured.</div>';
  const w = 320, h = 70, pad = 6;
  const vals = pts.map(p => p.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const x = i => pad + (i * (w - 2 * pad)) / (pts.length - 1);
  const y = v => h - pad - ((v - min) / (max - min)) * (h - 2 * pad);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1], prev = pts[pts.length - 2];
  const upGood = opts.upGood;
  const improving = upGood === null ? null : (upGood ? last.value >= prev.value : last.value <= prev.value);
  const stroke = improving === null ? 'var(--muted,#888)' : improving ? 'var(--success,#27ae60)' : 'var(--danger,#c0392b)';
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="2" fill="${stroke}"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" style="overflow:visible">
    <path d="${line}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
  </svg>`;
}

/* ============================================================
   View
   ============================================================ */
window.__renderers['kpitrends'] = function () {
  const viewEl = $('#view-kpitrends');
  if (!viewEl) return;
  const ent = currentEntity();
  const meta = entityMeta(ent) || {};
  const canCaptureKpi = isPrivileged ? isPrivileged() : false;
  const META = window.PXKpi.META;
  const snaps = window.PXKpiSnapshot.snapshotsFor(ent);

  // Series per KPI across captured periods.
  const periods = snaps.map(s => s.period);
  const seriesFor = key => snaps.map(s => ({ period: s.period, value: (s.values && s.values[key] != null) ? s.values[key] : null }));

  // Current live values (so the latest tile shows "now" even before this month's capture).
  const live = window.PXKpi.compute(ent);

  const tile = (key) => {
    const m = META[key];
    const series = seriesFor(key);
    // Append a live point for the current month if not already captured.
    const curPeriod = window.PXKpi.periodKey(new Date());
    if (!periods.includes(curPeriod) && live[key] != null) series.push({ period: curPeriod, value: live[key] });
    const withVals = series.filter(p => p.value != null);
    const current = withVals.length ? withVals[withVals.length - 1].value : null;
    const prev = withVals.length > 1 ? withVals[withVals.length - 2].value : null;
    let arrow = '', cls = 'muted';
    if (current != null && prev != null && m.upGood !== null) {
      const better = m.upGood ? current >= prev : current <= prev;
      const same = current === prev;
      arrow = same ? '→' : (current > prev ? '▲' : '▼');
      cls = same ? 'muted' : (better ? 'success' : 'danger');
    }
    const disp = current == null ? '—' : (m.unit === '%' ? current + '%' : current + (m.unit ? ' ' + m.unit : ''));
    const delta = (current != null && prev != null) ? (current - prev).toFixed(m.unit === '%' ? 0 : 1) : null;
    return `<div class="kpi-trend-card">
      <div class="kt-head">
        <span class="kt-label">${escapeHtml(m.label)}</span>
        ${arrow ? `<span class="kt-arrow ${cls}">${arrow}${delta != null ? ' ' + (delta > 0 ? '+' : '') + delta : ''}</span>` : ''}
      </div>
      <div class="kt-value">${disp}</div>
      <div class="kt-chart">${kpiChart(series, { upGood: m.upGood })}</div>
      <div class="kt-foot text-xs text-muted">${withVals.length} period(s)${!m.backfill ? ' · forward-only' : ''}</div>
    </div>`;
  };

  const keys = ['otifPct', 'avgLateness', 'avgClearance', 'mtto', 'overduePayments', 'openOrders', 'highRisk'];

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title"><h1>KPI Trends</h1>
        <span class="desc">${escapeHtml(meta.code || ent)} — month-on-month performance. ${snaps.length} period(s) captured.</span>
      </div>
      ${canCaptureKpi ? `<div class="page-actions">
        <button class="btn btn-sm" id="kt-backfill" title="Compute past months from historical order/GRN dates">Backfill history</button>
        <button class="btn btn-sm btn-primary" id="kt-capture">Capture this month</button>
      </div>` : '<div class="page-actions"><span class="text-xs text-muted">View only</span></div>'}
    </div>

    <div class="info-banner text-sm">Trends are captured monthly (automatically on first use each month, or manually here). On go-live, use <strong>Backfill history</strong> once to compute OTIF, lead-time, lateness and clearance for past months from your 2024-onward order and GRN dates. Count metrics (open orders, overdue, risk) trend forward from the first capture. Old or incomplete orders are simply excluded from a metric's sample — they never block a calculation.</div>

    ${snaps.length === 0
      ? '<div class="info-banner" style="border-color:var(--warn,#e67e22)">No snapshots captured yet. Click <strong>Backfill history</strong> to populate past months from existing data, or <strong>Capture this month</strong> to start the series.</div>'
      : ''}

    <div class="kpi-trend-grid">
      ${keys.map(tile).join('')}
    </div>

    ${snaps.length ? `<div style="margin-top:18px"><button class="btn btn-sm" id="kt-export">⤓ Export Excel</button></div>` : ''}
  `;

  // Wiring
  const capBtn = $('#kt-capture');
  if (capBtn) capBtn.addEventListener('click', async () => {
    capBtn.disabled = true; capBtn.textContent = 'Capturing…';
    try { const r = await window.PXKpiSnapshot.capture(ent, 'manual'); toast(`This month's KPIs ${r}.`, 'success'); window.__renderers['kpitrends'](); }
    catch (e) { toast('Capture failed.', 'danger'); capBtn.disabled = false; capBtn.textContent = 'Capture this month'; }
  });

  const bfBtn = $('#kt-backfill');
  if (bfBtn) bfBtn.addEventListener('click', async () => {
    if (!confirm('Compute KPI snapshots for past months from existing order/GRN dates? This fills OTIF, lead-time, lateness and clearance history. Safe to run once at go-live.')) return;
    bfBtn.disabled = true; bfBtn.textContent = 'Backfilling…';
    try { const n = await window.PXKpiSnapshot.backfill(ent, 30); toast(n ? `Backfilled ${n} past period(s).` : 'No past periods with enough data to backfill.', n ? 'success' : 'warn'); window.__renderers['kpitrends'](); }
    catch (e) { toast('Backfill failed.', 'danger'); }
    bfBtn.disabled = false; bfBtn.textContent = 'Backfill history';
  });

  const expBtn = $('#kt-export');
  if (expBtn) expBtn.addEventListener('click', () => {
    const head = ['period', ...keys];
    const rows = snaps.map(s => [s.period, ...keys.map(k => (s.values && s.values[k] != null) ? s.values[k] : '')]);
    const csv = [head.join(','), ...rows.map(r => r.join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `kpi-trends-${meta.code || ent}.csv`; a.click();
  });
};
