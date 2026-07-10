const { $, $$, fmtDate, fmtMoney, daysBetween, escapeHtml, toast, statusBadgeClass,
  orderFunction, cmGetColumns, cmRenderTable, cmOpenManager, cmExportCSV,
  erpSourceOf, renderErpBadge, isErpOrder,
  collection, getDocs, addDoc, serverTimestamp, recordEntity, entityMeta } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;

const backupTimestamp = window.__rep_backupTimestamp, downloadFile = window.__rep_downloadFile, serializeForBackup = window.__rep_serializeForBackup, rowsToCSV = window.__rep_rowsToCSV, fetchStatusLog = window.__rep_fetchStatusLog, fetchSystemConfig = window.__rep_fetchSystemConfig;

window.openBackupDialog = function() {
  const erpStatus = (window.PhoenixERP && window.PhoenixERP.getActiveAdapter) ? window.PhoenixERP.getActiveAdapter() : { name: 'Manual', connected: false };
  window.openModal(`
    <div class="modal-head">
      <div><h2>Backup / Export All Data</h2><div class="sub">Full application snapshot</div></div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <p class="text-sm" style="margin-bottom:12px">Exports a full snapshot of all app data (including operational records) for safekeeping before major changes.</p>
      <div class="card" style="background:var(--surface-warm);margin-bottom:14px">
        <dl class="kv-grid" style="grid-template-columns:1fr auto 1fr auto;font-size:13px">
          <dt>Orders</dt><dd class="mono">${state.data.orders.length}</dd>
          <dt>Shipments</dt><dd class="mono">${state.data.shipments.length}</dd>
          <dt>Payment Requests</dt><dd class="mono">${state.data.payments.length}</dd>
          <dt>Suppliers</dt><dd class="mono">${state.data.suppliers.length}</dd>
          <dt>Officers</dt><dd class="mono">${state.data.officers.length}</dd>
          <dt>ERP Import Rules</dt><dd class="mono">${state.data.importRules.length}</dd>
          <dt>Working Calendars</dt><dd class="mono">${state.data.businessCalendars.length}</dd>
          <dt>Documents</dt><dd class="mono">${state.data.documents.length}</dd>
          <dt>Follow-ups</dt><dd class="mono">${state.data.followups.length}</dd>
          <dt>Issues</dt><dd class="mono">${state.data.issues.length}</dd>
          <dt>Update Requests</dt><dd class="mono">${state.data.updateRequests.length}</dd>
          <dt>Contact Logs</dt><dd class="mono">${state.data.contactLog.length}</dd>
          <dt>KPI Snapshots</dt><dd class="mono">${state.data.kpiSnapshot.length}</dd>
          <dt>Exports / Outbound</dt><dd class="mono">${state.data.exports.length}</dd>
        </dl>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" id="bk-json">⬇ Download JSON (single file)</button>
        <button class="btn" id="bk-csv">⬇ Download CSV (one per collection)</button>
      </div>
      <p class="text-xs text-muted" style="margin-top:12px">JSON keeps full structure (recommended for re-import/backup). CSV is for spreadsheets/Power BI. Archived records are included in the backup.</p>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>
  `, false);

  function backupSets(statusLog, systemConfig) {
    return {
      orders: serializeForBackup(state.data.orders),
      shipments: serializeForBackup(state.data.shipments),
      payment_requests: serializeForBackup(state.data.payments),
      suppliers: serializeForBackup(state.data.suppliers),
      officers: serializeForBackup(state.data.officers),
      erp_import_rules: serializeForBackup(state.data.importRules),
      business_calendars: serializeForBackup(state.data.businessCalendars),
      documents: serializeForBackup(state.data.documents),
      followups: serializeForBackup(state.data.followups),
      issues: serializeForBackup(state.data.issues),
      update_requests: serializeForBackup(state.data.updateRequests),
      contact_log: serializeForBackup(state.data.contactLog),
      kpi_snapshot: serializeForBackup(state.data.kpiSnapshot),
      exports: serializeForBackup(state.data.exports),
      status_log: serializeForBackup(statusLog || []),
      system_config: serializeForBackup(systemConfig || [])
    };
  }

  function buildMeta(statusLogLen, systemConfigLen) {
    const apiMode = !!(window.__usesApiDataMode && window.__usesApiDataMode());
    return {
      app: 'Phoenix Procurement',
      dataMode: apiMode ? 'api' : 'firebase',
      project: apiMode ? 'internal-sql-api' : 'phoenix-procurement2',
      prototypeVersion: REF.prototypeVersion,
      exportedBy: state.officer?.code || state.user?.email || 'unknown',
      exportedAt: new Date().toISOString(),
      erpIntegrationStatus: `${erpStatus.name} — ${erpStatus.connected ? 'connected' : 'not connected (manual feed)'}`,
      collectionCounts: {
        orders: state.data.orders.length,
        shipments: state.data.shipments.length,
        payment_requests: state.data.payments.length,
        suppliers: state.data.suppliers.length,
        officers: state.data.officers.length,
        erp_import_rules: state.data.importRules.length,
        business_calendars: state.data.businessCalendars.length,
        documents: state.data.documents.length,
        followups: state.data.followups.length,
        issues: state.data.issues.length,
        update_requests: state.data.updateRequests.length,
        contact_log: state.data.contactLog.length,
        kpi_snapshot: state.data.kpiSnapshot.length,
        system_config: systemConfigLen,
        status_log: statusLogLen
      }
    };
  }

  $('#bk-json').addEventListener('click', async () => {
    $('#bk-json').disabled = true; $('#bk-json').textContent = 'Preparing…';
    const statusLog = await fetchStatusLog();
    const systemConfig = fetchSystemConfig ? await fetchSystemConfig() : [];
    const backup = {
      _meta: buildMeta(statusLog.length, systemConfig.length),
      ...backupSets(statusLog, systemConfig)
    };
    downloadFile(`phoenix_backup_${backupTimestamp()}.json`, JSON.stringify(backup, null, 2), 'application/json');
    window.__backupDoneAt = Date.now();   // unlocks the demo purge gate (Backup All required)
    toast('JSON backup downloaded', 'success');
    $('#bk-json').disabled = false; $('#bk-json').textContent = '⬇ Download JSON (single file)';
  });

  $('#bk-csv').addEventListener('click', async () => {
    $('#bk-csv').disabled = true; $('#bk-csv').textContent = 'Preparing…';
    const statusLog = await fetchStatusLog();
    const systemConfig = fetchSystemConfig ? await fetchSystemConfig() : [];
    const sets = backupSets(statusLog, systemConfig);
    const ts = backupTimestamp();
    // also drop a small manifest with the metadata
    downloadFile(`phoenix_backup_manifest_${ts}.json`, JSON.stringify(buildMeta(statusLog.length, systemConfig.length), null, 2), 'application/json');
    Object.entries(sets).forEach(([name, rows]) => {
      if (rows.length) downloadFile(`phoenix_${name}_${ts}.csv`, rowsToCSV(rows), 'text/csv;charset=utf-8;');
    });
    toast('CSV files downloaded (one per collection)', 'success');
    window.__backupDoneAt = Date.now();   // unlocks the demo purge gate (Backup All required)
    $('#bk-csv').disabled = false; $('#bk-csv').textContent = '⬇ Download CSV (one per collection)';
  });
};

/* ============================================================
   ERP RECONCILIATION VIEW (item 6)
   Shows mismatches & sync issues between Phoenix and the ERP.
   Until the plug-in feeds ERP data, this honestly shows manual orders
   as "not linked to ERP" plus a manual-feed notice.
============================================================ */
