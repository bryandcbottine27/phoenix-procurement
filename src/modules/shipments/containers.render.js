/* containers.render.js — Increment 3: Container Tracker view
   Tracks demurrage (port dwell) and detention (importer hold) for all
   active sea shipments that have a portArrivalDate. Uses PXDemurrage
   (shipments.service.js). Phoenix-owned operational visibility. */
const { $, $$, fmtDate, escapeHtml, currentEntity, entityMeta, toast } = window.PXUtils;

window.__renderers['containers'] = function () {
  const viewEl = $('#view-containers');
  if (!viewEl) return;
  const ent = currentEntity();
  const meta = entityMeta(ent);
  if (!window.PXDemurrage) { viewEl.innerHTML = '<p class="op-empty">Container tracker engine not loaded.</p>'; return; }

  const rows = window.PXDemurrage.buildTrackerList({ entity: ent });
  const money = (n, cur) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur ? ' ' + cur : '');

  const statusBadge = status => {
    const map = { overdue: ['OVERDUE', 'danger'], warning: ['AT RISK', 'warn'], clear: ['OK', 'success'],
      closed: ['CLOSED', 'neutral'], inactive: ['NOT STARTED', 'neutral'], 'active-no-limit': ['RUNNING', 'info'] };
    const [label, cls] = map[status] || [status, 'neutral'];
    return `<span class="badge ${cls}">${label}</span>`;
  };
  const clockCell = clock => {
    if (clock.status === 'inactive') return '<span class="text-muted">—</span>';
    const col = { overdue: 'var(--danger,#c0392b)', warning: 'var(--warn,#e67e22)', clear: 'var(--success,#27ae60)',
      closed: 'var(--muted)', 'active-no-limit': 'var(--text)' }[clock.status] || '';
    const rem = clock.remaining != null ? (clock.remaining >= 0 ? `${clock.remaining}d left` : `${-clock.remaining}d OVER`) : '';
    return `<span style="color:${col};font-weight:${clock.status === 'overdue' ? '700' : '400'}">${clock.elapsed ?? '?'}d elapsed${rem ? ' · ' + rem : ''}</span>`;
  };

  const overdue = rows.filter(r => r.overall === 'overdue').length;
  const atRisk = rows.filter(r => r.overall === 'warning').length;
  const closed = rows.filter(r => r.overall === 'closed').length;

  const rowsHtml = rows.map(r => `
    <tr onclick="openShipmentDetail('${r.shipmentDocId}')" style="cursor:pointer">
      <td><span class="mono">${escapeHtml(r.fpo)}</span></td>
      <td class="truncate" title="${escapeHtml(r.supplier)}">${escapeHtml(r.supplier)}</td>
      <td>${escapeHtml(r.portOfDischarge) || '<span class="text-muted">—</span>'}</td>
      <td>${escapeHtml(r.containerNumber) || '<span class="text-muted">—</span>'} ${r.containers > 1 ? `<span class="hint">(${r.containers})</span>` : ''}</td>
      <td>${r.portArrivalDate ? fmtDate(r.portArrivalDate) : '<span class="text-muted">—</span>'}</td>
      <td>${statusBadge(r.overall)}</td>
      <td>${clockCell(r.demurrage)}</td>
      <td>${clockCell(r.detention)}</td>
      <td class="num">${r.totalCost != null ? `<strong style="color:var(--danger,#c0392b)">${money(r.totalCost, r.cur)}</strong>` : '<span class="text-muted">—</span>'}</td>
    </tr>`).join('');

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title">
        <h1>Container Tracker</h1>
        <span class="desc">${escapeHtml(meta.code)} — demurrage &amp; detention clock for active sea shipments. ${rows.length} shipment${rows.length === 1 ? '' : 's'} tracked.</span>
      </div>
    </div>

    <div class="kpi-pill-row">
      <div class="kpi-pill"><div class="kpi-pill-label">Tracked containers</div><div class="kpi-pill-value">${rows.length}</div></div>
      ${overdue ? `<div class="kpi-pill" style="border-color:var(--danger,#c0392b)"><div class="kpi-pill-label">Overdue</div><div class="kpi-pill-value" style="color:var(--danger,#c0392b)">${overdue}</div><div class="kpi-pill-sub">charges accruing</div></div>` : ''}
      ${atRisk ? `<div class="kpi-pill" style="border-color:var(--warn,#e67e22)"><div class="kpi-pill-label">At risk</div><div class="kpi-pill-value" style="color:var(--warn,#e67e22)">${atRisk}</div><div class="kpi-pill-sub">≤3 free days left</div></div>` : ''}
      ${closed ? `<div class="kpi-pill"><div class="kpi-pill-label">Closed</div><div class="kpi-pill-value">${closed}</div></div>` : ''}
    </div>

    <div class="info-banner">
      <strong>Demurrage</strong> = time container sits at port (Port Arrival → Container Pickup). <strong>Detention</strong> = time importer holds the container (Pickup → Empty Return). Enter <em>Port Arrival Date</em> on a sea shipment to start tracking. Set free days to activate the warning clock. Click any row to open the shipment and update dates.
    </div>

    ${rows.length ? `<div class="table-wrap"><table class="data">
      <thead><tr>
        <th>FPO</th><th>Supplier</th><th>Port</th><th>Container</th><th>Port Arrival</th>
        <th>Status</th><th>Demurrage</th><th>Detention</th><th class="num">Exposure</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>`
    : `<p class="op-empty">No active sea shipments with Port Arrival Date set for ${escapeHtml(meta.code)}. Open a shipment, set mode to Sea, and enter the Port Arrival Date to begin tracking.</p>`}
  `;
};
