const { $, $$, fmtDate, fmtMoney, daysBetween, escapeHtml, toast, statusBadgeClass,
  orderFunction, cmGetColumns, cmRenderTable, cmOpenManager, cmExportCSV,
  erpSourceOf, renderErpBadge, isErpOrder,
  collection, getDocs, addDoc, serverTimestamp, recordEntity, entityMeta } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;


function backupTimestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function serializeForBackup(rows) {
  // Convert Firestore Timestamps to ISO strings, keep structure
  return rows.map(r => {
    const out = {};
    Object.entries(r).forEach(([k, v]) => {
      if (v && v.toDate) out[k] = v.toDate().toISOString();
      else out[k] = v;
    });
    return out;
  });
}
function rowsToCSV(rows) {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const esc = v => {
    if (v === null || v === undefined) v = '';
    if (typeof v === 'object') v = JSON.stringify(v);
    v = String(v).replace(/"/g, '""');
    return /[,"\n]/.test(v) ? `"${v}"` : v;
  };
  return cols.join(',') + '\n' + rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n');
}

async function fetchStatusLog() {
  try {
    const snap = await getDocs(collection(db, 'status_log'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.warn('status_log fetch failed', e); return []; }
}

async function fetchSystemConfig() {
  try {
    const snap = await getDocs(collection(db, 'system_config'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.warn('system_config fetch failed', e); return []; }
}


window.exportAllCSV = function(collName) {
  const map = {
    orders: state.data.orders,
    shipments: state.data.shipments,
    payment_requests: state.data.payments,
    suppliers: state.data.suppliers,
    officers: state.data.officers,
    documents: state.data.documents,
    followups: state.data.followups,
    issues: state.data.issues,
    update_requests: state.data.updateRequests,
    contact_log: state.data.contactLog,
    kpi_snapshot: state.data.kpiSnapshot,
    erp_import_rules: state.data.importRules,
    business_calendars: state.data.businessCalendars
  };
  const rows = map[collName] || [];
  if (!rows.length) { toast('Nothing to export', 'warn'); return; }
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => k !== 'id');
  const header = cols.join(',');
  const body = rows.map(r => cols.map(c => {
    let v = r[c];
    if (v?.toDate) v = fmtDate(v);
    if (Array.isArray(v)) v = v.join('; ');
    if (v === null || v === undefined) v = '';
    v = String(v).replace(/"/g, '""');
    return /[,"\n]/.test(v) ? `"${v}"` : v;
  }).join(',')).join('\n');
  const csv = header + '\n' + body;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `phoenix_${collName}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
};


// --- bridges for form (separate scope) ---
window.__rep_backupTimestamp = backupTimestamp;
window.__rep_downloadFile = downloadFile;
window.__rep_serializeForBackup = serializeForBackup;
window.__rep_rowsToCSV = rowsToCSV;
window.__rep_fetchStatusLog = fetchStatusLog;
window.__rep_fetchSystemConfig = fetchSystemConfig;
