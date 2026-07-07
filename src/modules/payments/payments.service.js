const { $, $$, fmtDate, fmtDateISO, fmtMoney, escapeHtml, statusBadgeClass,
  collection, addDoc, doc, updateDoc, deleteDoc, setDoc, runTransaction, getDoc, getDocs,
  serverTimestamp, toast, computeMilestoneDate, query, where,
  checkRfpDuplicates, rfpDataQuality, can, currentEntity, recordEntity, entityMeta, stripUndefined,
  cmGetColumns, cmRenderTable, cmOpenManager, cmExportCSV } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;


async function nextRfpRef(entityCode) {
  if (!can('payments', 'create')) throw new Error('Not authorised to create an RFP reference.');
  const year = new Date().getFullYear();
  const meta = entityMeta(entityCode || currentEntity());
  const prefix = meta.rfpPrefix || 'PHX';
  // Per-entity counter so each company has its own sequence
  const counterRef = doc(db, 'system_config', `rfp_counter_${prefix}_${year}`);
  return await runTransaction(db, async tx => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? snap.data().value : 0;
    const next = current + 1;
    tx.set(counterRef, { value: next, year, entity: meta.code });
    return `${prefix}/${year}/IMP/${String(next).padStart(3, '0')}`;
  });
}


async function syncMilestoneFromRfp(orderId, milestoneId, change) {
  // Load order
  const ord = state.data.orders.find(o => o.orderId === orderId);
  if (!ord || !ord.milestones) { console.warn('syncMilestone: no order or milestones', orderId); return; }
  const milestones = ord.milestones.map(m => ({ ...m }));
  const idx = milestones.findIndex(m => m.id === milestoneId);
  if (idx === -1) { console.warn('syncMilestone: milestone not found', milestoneId); return; }

  if (change.unlink) {
    milestones[idx].rfpRef = null;
    milestones[idx].paidDate = null;
  } else {
    milestones[idx].rfpRef = change.rfpRef || milestones[idx].rfpRef;
    if (change.status === 'paid') {
      // Use IBL Value Date if available, otherwise request date, otherwise today
      let paidDate = change.iblValueDate || change.requestDate || new Date();
      if (paidDate && paidDate.toDate) paidDate = paidDate.toDate();
      else if (paidDate && !(paidDate instanceof Date)) paidDate = new Date(paidDate);
      milestones[idx].paidDate = paidDate;
    } else {
      // RFP is raised but not yet paid — clear any prior paidDate (in case it was reverted)
      milestones[idx].paidDate = null;
    }
  }

  await window.PXStore.updateRecord('orders', ord.id, { milestones },
    { skipValidation: true, log: { recordType: 'order', action: 'milestone-sync', details: 'Milestone payment status synced from RFP' } });
}


// --- bridges for form (separate scope) ---
window.__pay_nextRfpRef = nextRfpRef;
window.__pay_syncMilestoneFromRfp = syncMilestoneFromRfp;


/* ============================================================
   MILESTONE-DRIVEN FORTHCOMING-PAYMENTS FORECAST
   ============================================================
   Every UNPAID milestone is forecastable, even if its triggering event hasn't
   happened yet — because "we will have to pay anyway". For each unpaid milestone:
     • realDate     = computeMilestoneDate(...) when the anchor data exists
     • estimatedDate = fallback when it doesn't: requestedReceiptDate
                       → orderReadyDate → dateOfOrder + forecastDefaultLeadDays
     • forecastDate = realDate || estimatedDate ; isEstimate flags which
   Paid milestones (paidDate set) are excluded. Entity-aware. Grouped by currency.
   This replaces the old manual `forthcomingPaymentDate` as the forecast driver. */
function buildPaymentsForecast(opts) {
  opts = opts || {};
  const entityFilter = opts.entity || '';            // '' = all entities
  const orders = state.data.orders.filter(o => !o.archived);
  const ships = state.data.shipments.filter(s => !s.archived);
  const leadDays = (REF.forecastDefaultLeadDays != null) ? REF.forecastDefaultLeadDays : 60;
  const toDate = v => { if (!v) return null; const d = v.toDate ? v.toDate() : new Date(v); return isNaN(d) ? null : d; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const rows = [];
  orders.forEach(o => {
    if (!Array.isArray(o.milestones) || !o.milestones.length) return;
    const ent = recordEntity(o);
    if (entityFilter && ent !== entityFilter) return;

    const allocatedAmounts = window.PXUtils.milestoneAmountsLookPercentDerived && window.PXUtils.milestoneAmountsLookPercentDerived(o.amount, o.milestones)
      ? window.PXUtils.allocateMilestoneAmounts(o.amount, o.milestones)
      : null;

    o.milestones.forEach((m, idx) => {
      if (m.paidDate) return;                         // already paid → not forthcoming
      // Real expected date if the anchor data is available
      let realDate = null;
      try { realDate = computeMilestoneDate(m, o, ships); } catch (e) { realDate = null; }

      // Estimated fallback (anchor priority)
      let estimatedDate = null, estBasis = null;
      const rr = toDate(o.requestedReceiptDate), ord = toDate(o.dateOfOrder), rdy = toDate(o.orderReadyDate);
      if (rr)       { estimatedDate = rr;  estBasis = 'requested receipt date'; }
      else if (rdy) { estimatedDate = rdy; estBasis = 'order ready date'; }
      else if (ord) { estimatedDate = addDays(ord, leadDays); estBasis = `order date + ${leadDays}d`; }

      const forecastDate = realDate || estimatedDate;
      const isEstimate = !realDate && !!estimatedDate;
      const amount = allocatedAmounts ? allocatedAmounts[idx]
                     : (m.amount != null) ? Number(m.amount)
                     : (o.amount != null && m.percent != null) ? +(Number(o.amount) * m.percent / 100).toFixed(2)
                     : null;
      const dd = forecastDate ? (() => { const x = new Date(forecastDate); x.setHours(0,0,0,0); return x; })() : null;
      const daysUntil = dd ? Math.round((dd - today) / 86400000) : null;

      rows.push({
        entity: ent,
        orderId: o.orderId,
        orderDocId: o.id,
        description: o.description || '',
        supplier: o.supplier || '—',
        currency: o.currency || '—',
        milestoneLabel: m.label || `${m.percent || ''}%`,
        percent: m.percent || null,
        amount,
        forecastDate,                 // Date | null
        isEstimate,                   // true if no real anchor yet
        estimateBasis: isEstimate ? estBasis : null,
        rfpRaised: !!m.rfpRef,         // RFP already raised but not yet paid
        rfpRef: m.rfpRef || null,
        daysUntil,
        overdue: daysUntil != null && daysUntil < 0
      });
    });
  });

  // Sort: dated first (soonest first), undated last
  rows.sort((a, b) => {
    if (a.forecastDate && b.forecastDate) return a.forecastDate - b.forecastDate;
    if (a.forecastDate) return -1;
    if (b.forecastDate) return 1;
    return 0;
  });

  // Group totals by currency
  const byCurrency = {};
  rows.forEach(r => {
    if (r.amount == null) return;
    byCurrency[r.currency] = byCurrency[r.currency] || { total: 0, overdue: 0, count: 0 };
    byCurrency[r.currency].total += r.amount;
    byCurrency[r.currency].count += 1;
    if (r.overdue) byCurrency[r.currency].overdue += r.amount;
  });

  return { rows, byCurrency };
}
window.__pay_buildPaymentsForecast = buildPaymentsForecast;

/* Group the forecast rows by Purchase Order — this is how the A/C department reads
   it: each PO header, then its milestone payment lines beneath. Returns an array of
   { orderId, orderDocId, entity, supplier, currency, orderAmount, milestones:[rows],
     poTotal, poUnpaidTotal } sorted by the PO's earliest forthcoming milestone date. */
function buildPaymentsForecastByPO(opts) {
  const { rows } = buildPaymentsForecast(opts || {});
  const groups = {};
  rows.forEach(r => {
    const key = r.orderDocId || r.orderId;
    if (!groups[key]) {
      const ord = state.data.orders.find(o => o.id === r.orderDocId || o.orderId === r.orderId);
      groups[key] = {
        orderId: r.orderId, orderDocId: r.orderDocId, entity: r.entity,
        description: r.description || '',
        supplier: r.supplier, currency: r.currency,
        orderAmount: ord && ord.amount != null ? Number(ord.amount) : null,
        milestones: [], poUnpaidTotal: 0, earliest: null
      };
    }
    const g = groups[key];
    g.milestones.push(r);
    if (r.amount != null) g.poUnpaidTotal += r.amount;
    if (r.forecastDate && (!g.earliest || r.forecastDate < g.earliest)) g.earliest = r.forecastDate;
  });
  const list = Object.values(groups);
  // milestones within a PO ordered by forecast date (undated last)
  list.forEach(g => g.milestones.sort((a, b) => {
    if (a.forecastDate && b.forecastDate) return a.forecastDate - b.forecastDate;
    if (a.forecastDate) return -1; if (b.forecastDate) return 1; return 0;
  }));
  // POs ordered by earliest forthcoming milestone (undated last)
  list.sort((a, b) => {
    if (a.earliest && b.earliest) return a.earliest - b.earliest;
    if (a.earliest) return -1; if (b.earliest) return 1;
    return String(a.orderId).localeCompare(String(b.orderId));
  });
  return list;
}
window.__pay_buildPaymentsForecastByPO = buildPaymentsForecastByPO;

/* A/C export — one row per PO + milestone, grouped by Purchase Order. Lean column
   set: only the data Phoenix actually holds. This is the single source both the CSV
   and the Excel (.xlsx) export build from, so they always match. The A/C department
   uses it as the input to their own payment forecast. */
function buildForecastExportRows(opts) {
  const groups = buildPaymentsForecastByPO(opts || {});
  const fmtD = d => { if (!d) return ''; const x = new Date(d); return isNaN(x) ? '' : x.toISOString().slice(0, 10); };
  const headers = ['Entity', 'PO Number', 'Description', 'Supplier', 'Due Date', 'Currency', 'Amount'];
  const rows = [];
  groups.forEach(g => {
    g.milestones.forEach(m => {
      rows.push([
        g.entity, g.orderId, g.description, g.supplier,
        fmtD(m.forecastDate), g.currency, (m.amount != null ? m.amount : '')
      ]);
    });
  });
  return { headers, rows };
}
window.__pay_buildForecastExportRows = buildForecastExportRows;

function buildForecastCSV(opts) {
  const { headers, rows } = buildForecastExportRows(opts || {});
  const esc = v => { const s = (v == null ? '' : String(v)); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [headers.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
}
window.__pay_buildForecastCSV = buildForecastCSV;

/* Minimal, dependency-free XLSX writer (no external libraries — per project rule).
   An .xlsx is a ZIP of XML parts. We build the parts and zip them with a tiny
   STORED-method (no compression) ZIP writer, which Excel opens fine. Numbers are
   written as numeric cells; everything else as inline strings. */
function buildForecastXLSX(opts) {
  const { headers, rows } = buildForecastExportRows(opts || {});
  const allRows = [headers, ...rows];

  const colLetter = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  allRows.forEach((row, ri) => {
    sheet += `<row r="${ri + 1}">`;
    row.forEach((cell, ci) => {
      const ref = colLetter(ci) + (ri + 1);
      const isNum = ri > 0 && typeof cell === 'number' && isFinite(cell);
      if (isNum) sheet += `<c r="${ref}"><v>${cell}</v></c>`;
      else if (cell === '' || cell == null) sheet += `<c r="${ref}"/>`;
      else sheet += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cell)}</t></is></c>`;
    });
    sheet += '</row>';
  });
  sheet += '</sheetData></worksheet>';

  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>';
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Forthcoming Payments" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>';

  const files = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/worksheets/sheet1.xml', data: sheet }
  ];
  return zipStored(files); // returns a Blob
}
window.__pay_buildForecastXLSX = buildForecastXLSX;

/* Tiny ZIP writer using STORED (no compression). Returns a Blob. CRC32 + local
   headers + central directory — enough for Excel to open the .xlsx. */
function zipStored(files) {
  const enc = new TextEncoder();
  const crcTable = (function () {
    const tbl = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); tbl[n] = c >>> 0; } return tbl;
  })();
  const crc32 = bytes => { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

  const chunks = [], central = []; let offset = 0;
  const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

  files.forEach(f => {
    const nameBytes = enc.encode(f.name);
    const dataBytes = enc.encode(f.data);
    const crc = crc32(dataBytes);
    const local = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(dataBytes.length), u32(dataBytes.length), u16(nameBytes.length), u16(0));
    chunks.push(new Uint8Array(local), nameBytes, dataBytes);
    const cen = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(dataBytes.length), u32(dataBytes.length), u16(nameBytes.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset));
    central.push(new Uint8Array(cen), nameBytes);
    offset += local.length + nameBytes.length + dataBytes.length;
  });
  const cenStart = offset;
  let cenSize = 0; central.forEach(c => cenSize += c.length);
  const end = [].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(cenSize), u32(cenStart), u16(0));
  const parts = [...chunks, ...central, new Uint8Array(end)];
  return new Blob(parts, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
window.__pay_zipStored = zipStored;
