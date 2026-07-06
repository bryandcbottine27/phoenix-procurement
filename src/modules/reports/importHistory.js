/* ============================================================
   ERP IMPORT HISTORY -- structured audit runs in status_log
   ============================================================
   One log entry is written after every committed Excel import, including
   cancelled or partially failed runs. This reuses the existing permitted,
   backed-up audit collection instead of creating a parallel Firestore store. */
const importHistoryState = window.__state;
const { $, $$, escapeHtml, toast } = window.PXUtils;

function importRunId() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `IMP-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function cloneImportStats(stats) {
  const out = {};
  Object.entries(stats || {}).forEach(([sheet, value]) => {
    out[sheet] = {
      classified: Number(value.classified || 0),
      skippedClosed: Number(value.skippedClosed || 0),
      skippedUnmatched: Number(value.skippedUnmatched || 0),
      byFn: { ...(value.byFn || {}) }
    };
  });
  return out;
}

function importRunStatus(result) {
  if (result.cancelled) return 'cancelled';
  if (result.failed) return 'completed_with_errors';
  return 'completed';
}

function buildImportRun(context, result) {
  const candidates = context.candidates || [];
  const entityCounts = {};
  const functionCounts = { technical: 0, indirect: 0, supplychain: 0 };
  candidates.forEach(candidate => {
    entityCounts[candidate.entity] = (entityCounts[candidate.entity] || 0) + 1;
    if (functionCounts[candidate.function] !== undefined) functionCounts[candidate.function]++;
  });
  const stats = cloneImportStats(context.stats);
  const skippedClosed = Object.values(stats).reduce((total, sheet) => total + Number(sheet.skippedClosed || 0), 0);
  const skippedUnmatched = Object.values(stats).reduce((total, sheet) => total + Number(sheet.skippedUnmatched || 0), 0);
  const warnings = context.warnings || {};
  const rules = window.PXImportRules;
  const status = importRunStatus(result);
  return {
    runId: context.runId || importRunId(),
    status,
    source: 'manual_excel',
    fileName: context.fileMeta?.name || 'Unknown workbook',
    fileSizeBytes: Number(context.fileMeta?.size || 0),
    fileLastModified: Number(context.fileMeta?.lastModified || 0) || null,
    sourceSheets: context.fileMeta?.sheetNames || [],
    candidateCount: candidates.length,
    previewCreateCount: Number(context.toCreate?.length || 0),
    previewUpdateCount: Number(context.toUpdate?.length || 0),
    entityCounts,
    functionCounts,
    sheetStats: stats,
    skippedClosed,
    skippedUnmatched,
    validationErrorCount: Number(context.errors?.length || 0),
    conflictCount: Number(context.conflicts?.length || 0),
    unmatchedSupplierCount: Number(warnings.supplierMatches?.unmatched || 0),
    groupedPOCount: Number(warnings.groupedPOs || 0),
    activeRuleCount: rules ? rules.effectiveRules().filter(rule => rule.active !== false).length : 0,
    storedRuleCount: rules ? rules.storedRules().length : 0,
    created: Number(result.created || 0),
    updated: Number(result.updated || 0),
    failed: Number(result.failed || 0),
    processed: Number(result.done || 0),
    cancelled: !!result.cancelled,
    rowErrors: (result.rowErrors || []).slice(0, 20).map(error => ({
      orderId: error.orderId || null,
      entity: error.entity || null,
      error: String(error.error || '')
    })),
    completedAtClient: new Date().toISOString()
  };
}

function runSummary(run) {
  const outcome = run.status === 'cancelled' ? 'Import cancelled' : run.status === 'completed_with_errors' ? 'Import completed with errors' : 'Import completed';
  return `${outcome}: ${run.created} created, ${run.updated} updated, ${run.failed} failed from ${run.fileName}.`;
}

async function recordImportRun(context, result) {
  const run = buildImportRun(context, result);
  await window.PXStore.logStatusChange('erp_import_run', run.runId, run.status, runSummary(run), { importRun: run });
  return run;
}

function runDate(run) {
  const raw = run.completedAtClient || run.at;
  const date = raw && raw.toDate ? raw.toDate() : new Date(raw);
  return isNaN(date) ? '-' : date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusClass(status) {
  return status === 'completed' ? 'success' : status === 'cancelled' ? 'neutral' : 'warn';
}

function displayStatus(status) {
  return status === 'completed_with_errors' ? 'completed with errors' : (status || 'unknown').replace(/_/g, ' ');
}

function importRuns() {
  return (importHistoryState.data.importRuns || []).map(entry => ({ ...entry.importRun, at: entry.at, officerCode: entry.officerCode, logId: entry.id }))
    .filter(run => run && run.runId)
    .sort((a, b) => String(b.completedAtClient || '').localeCompare(String(a.completedAtClient || '')));
}

function openImportRunDetails(runId) {
  const run = importRuns().find(item => item.runId === runId);
  if (!run) { toast('Import history record is no longer available.', 'warning'); return; }
  const entities = Object.entries(run.entityCounts || {}).map(([entity, count]) => `${escapeHtml(entity)}: ${count}`).join(' | ') || '-';
  const sheets = Object.entries(run.sheetStats || {}).map(([sheet, stat]) => `${escapeHtml(sheet)}: ${Number(stat.classified || 0)} imported, ${Number(stat.skippedClosed || 0)} closed, ${Number(stat.skippedUnmatched || 0)} unmatched`).join('<br>') || '-';
  const errors = (run.rowErrors || []).length
    ? run.rowErrors.map(error => `${escapeHtml(error.orderId || '?')} (${escapeHtml(error.entity || '?')}): ${escapeHtml(error.error || '')}`).join('<br>')
    : 'No row write errors recorded.';
  window.openModal(`
    <div class="modal-head">
      <div><h2>Import Run ${escapeHtml(run.runId)}</h2><div class="sub">${escapeHtml(run.fileName || '')}</div></div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()" title="Close">x</button>
    </div>
    <div class="modal-body">
      <div class="metric-grid" style="margin-bottom:16px">
        <div class="metric success"><div class="label">Created</div><div class="value">${Number(run.created || 0)}</div></div>
        <div class="metric accent"><div class="label">Updated</div><div class="value">${Number(run.updated || 0)}</div></div>
        <div class="metric ${run.failed ? 'warn' : ''}"><div class="label">Failed</div><div class="value">${Number(run.failed || 0)}</div></div>
      </div>
      <dl class="kv-grid" style="grid-template-columns:150px 1fr">
        <dt>Status</dt><dd><span class="badge ${statusClass(run.status)}">${escapeHtml(displayStatus(run.status))}</span></dd>
        <dt>Completed</dt><dd>${escapeHtml(runDate(run))}</dd>
        <dt>Imported by</dt><dd>${escapeHtml(run.officerCode || '-')}</dd>
        <dt>Source sheets</dt><dd>${escapeHtml((run.sourceSheets || []).join(', ') || '-')}</dd>
        <dt>Candidate POs</dt><dd>${Number(run.candidateCount || 0)} (${Number(run.previewCreateCount || 0)} new / ${Number(run.previewUpdateCount || 0)} existing)</dd>
        <dt>Entity totals</dt><dd>${entities}</dd>
        <dt>Warnings</dt><dd>${Number(run.unmatchedSupplierCount || 0)} supplier mapping(s), ${Number(run.conflictCount || 0)} update conflict(s), ${Number(run.validationErrorCount || 0)} validation error(s)</dd>
        <dt>Rule set</dt><dd>${Number(run.activeRuleCount || 0)} active (${Number(run.storedRuleCount || 0)} stored)</dd>
      </dl>
      <div class="section-divider">Sheet Results</div>
      <div class="text-sm">${sheets}</div>
      <div class="section-divider">Write Errors</div>
      <div class="text-sm">${errors}</div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>
  `);
}

function renderHistoryMarkup() {
  const runs = importRuns().slice(0, 8);
  return `
    <section class="card" style="margin:16px 0">
      <div class="card-head" style="margin-bottom:10px"><div><h2>Recent Import History</h2><div class="text-sm text-muted">Committed Excel imports only; previewing a file does not create a history entry.</div></div></div>
      ${runs.length ? `<div class="px-card-grid">${runs.map(run => `
        <article class="px-card" style="cursor:default">
          <div class="px-card-top"><div><div class="px-card-title">${escapeHtml(run.fileName || 'Unknown workbook')}</div><div class="px-card-sub">${escapeHtml(runDate(run))}</div></div><span class="badge ${statusClass(run.status)}">${escapeHtml(displayStatus(run.status))}</span></div>
          <div class="text-sm"><strong>${Number(run.created || 0)}</strong> created | <strong>${Number(run.updated || 0)}</strong> updated | <strong>${Number(run.failed || 0)}</strong> failed</div>
          <div class="text-xs text-muted">${Number(run.candidateCount || 0)} candidate PO(s) | ${Number(run.unmatchedSupplierCount || 0)} supplier mapping warning(s)</div>
          <div style="margin-top:auto"><button class="btn btn-sm" data-import-run="${escapeHtml(run.runId)}">Details</button></div>
        </article>`).join('')}</div>` : '<div class="empty-state"><h3>No committed imports yet</h3><p>After you commit an Excel import, its outcome will appear here.</p></div>'}
    </section>`;
}

function bindHistoryActions(root) {
  $$('[data-import-run]', root).forEach(button => button.addEventListener('click', () => openImportRunDetails(button.dataset.importRun)));
}

window.PXImportHistory = { recordImportRun, importRuns, renderHistoryMarkup, bindHistoryActions, buildImportRun, importRunId };
