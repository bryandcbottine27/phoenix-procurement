const { recordEntity, entityMeta, toast } = window.PXUtils;
const state = window.__state;

/* ============================================================
   ERP EXCEL IMPORT  (manual staging feed until Data Warehouse sync is ready)
   ============================================================
   Reads a Navision/Business Central PO export workbook (sheets FPO, LPO, Seybrew)
   entirely in the browser — NO external libraries — maps each OPEN PO to a
   Control Tower order, classifies its procurement function from managed ERP
   import rules, and upserts by PO number via PXStore. Wired to the ERP
   Reconciliation view (Import POs from Excel → preview → commit, batched).

   Exposes:
     window.PXXlsxReader.readWorkbook(arrayBuffer) -> { sheetNames, sheet(name)->rows[][] }
     window.PXPoImport.buildCandidates(wb)         -> { candidates, stats }
     window.PXPoImport.splitNewExisting(cands)     -> { toCreate, toUpdate }
     window.PXPoImport.commitImport(cands, opts)   -> { created, updated, failed, cancelled }
*/

// ---------- no-library XLSX reader ----------
function unxml(s){ return String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&'); }
function colIndex(ref){ let n=0; for(let i=0;i<ref.length;i++) n=n*26+(ref.charCodeAt(i)-64); return n-1; }

async function readWorkbook(arrayBuffer){
  const bytes = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  const u16 = o => dv.getUint16(o,true), u32 = o => dv.getUint32(o,true);
  let eocd = -1;
  for (let i = bytes.length-22; i>=0; i--){ if (u32(i)===0x06054b50){ eocd=i; break; } }
  if (eocd<0) throw new Error('Not a valid .xlsx file (ZIP end record not found).');
  const cdCount = u16(eocd+10); const cdOffset = u32(eocd+16);
  const entries = {}; let p = cdOffset;
  for (let n=0;n<cdCount;n++){
    if (u32(p)!==0x02014b50) break;
    const method=u16(p+10), compSize=u32(p+20), nameLen=u16(p+28), extraLen=u16(p+30), commentLen=u16(p+32), localOffset=u32(p+42);
    const name = new TextDecoder().decode(bytes.subarray(p+46,p+46+nameLen));
    entries[name] = { method, compSize, localOffset };
    p += 46+nameLen+extraLen+commentLen;
  }
  async function inflate(name){
    const e = entries[name]; if (!e) return null;
    const lh = e.localOffset;
    const nameLen = u16(lh+26), extraLen = u16(lh+28);
    const dataStart = lh+30+nameLen+extraLen;
    const comp = bytes.subarray(dataStart, dataStart+e.compSize);
    if (e.method===0) return new TextDecoder().decode(comp);
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([comp]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new TextDecoder().decode(new Uint8Array(buf));
  }
  // shared strings
  const sstXml = await inflate('xl/sharedStrings.xml');
  const shared = [];
  if (sstXml){
    const siRe = /<si>([\s\S]*?)<\/si>/g; let m;
    while((m=siRe.exec(sstXml))!==null){
      const tRe=/<t[^>]*>([\s\S]*?)<\/t>/g; let tm,s='';
      while((tm=tRe.exec(m[1]))!==null) s+=tm[1];
      shared.push(unxml(s));
    }
  }
  // workbook sheet name -> path
  const wbXml = await inflate('xl/workbook.xml');
  const relsXml = await inflate('xl/_rels/workbook.xml.rels');
  const relMap = {};
  if (relsXml){ const rRe=/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g; let rm; while((rm=rRe.exec(relsXml))!==null) relMap[rm[1]]=rm[2]; }
  const sheetPaths = {};
  if (wbXml){
    const sRe=/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/?>/g; let sm;
    while((sm=sRe.exec(wbXml))!==null){
      let target = relMap[sm[2]]||'';
      if (target && !target.startsWith('xl/')) target='xl/'+target.replace(/^\//,'');
      sheetPaths[unxml(sm[1])] = target;
    }
  }
  async function parseSheet(path){
    const xml = await inflate(path); if(!xml) return [];
    const rows=[]; const rowRe=/<row[^>]*>([\s\S]*?)<\/row>/g; let rm;
    while((rm=rowRe.exec(xml))!==null){
      const cells=[];
      const cRe=/<c\s+r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>|<c\s+r="([A-Z]+)\d+"[^>]*\/>/g;
      let cm;
      while((cm=cRe.exec(rm[1]))!==null){
        const ref = cm[1]||cm[4];
        if (cm[1]===undefined){ continue; } // self-closing empty cell
        const attrs = cm[2]||''; const inner = cm[3]||'';
        const tMatch = /\st="([^"]+)"/.exec(attrs);
        const t = tMatch ? tMatch[1] : null;
        let val='';
        const vM = /<v>([\s\S]*?)<\/v>/.exec(inner);
        const isM = /<is>([\s\S]*?)<\/is>/.exec(inner);
        if (vM){ val = (t==='s') ? (shared[parseInt(vM[1],10)]||'') : unxml(vM[1]); }
        else if (isM){ const tRe=/<t[^>]*>([\s\S]*?)<\/t>/g; let tm2; while((tm2=tRe.exec(isM[1]))!==null) val+=tm2[1]; val=unxml(val); }
        cells[colIndex(ref)] = val;
      }
      rows.push(cells);
    }
    return rows;
  }
  // pre-parse all sheets into memory
  const parsed = {};
  for (const name of Object.keys(sheetPaths)){ parsed[name] = await parseSheet(sheetPaths[name]); }
  return {
    sheetNames: Object.keys(sheetPaths),
    sheet: name => parsed[name] || []
  };
}
window.PXXlsxReader = { readWorkbook };

// ---------- helpers ----------
function excelDateToISO(v){
  if (v==null||v==='') return null;
  // already a date string?
  if (typeof v==='string' && /\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0,10);
  const n = Number(v);
  if (!isFinite(n)||n<=0) return null;
  const ms = Math.round((n-25569)*86400000);
  const d = new Date(ms);
  return isNaN(d)?null:d.toISOString().slice(0,10);
}
function toNum(v){ if(v==null||v==='') return null; const n=Number(String(v).replace(/,/g,'')); return isFinite(n)?n:null; }
const U = v => (''+(v==null?'':v)).trim().toUpperCase();

function classifyPhoenix(mgrId, hodId){
  return window.PXImportRules?.resolveFunction({
    entity: 'Phoenix', erpSource: 'Navision',
    values: { 'Purchasing Mgr ID': mgrId, 'HOD ID': hodId }
  }) || null;
}
function classifyBusinessCentralForEntity(entity, purchaserCode, createdBy){
  return window.PXImportRules?.resolveFunction({
    entity, erpSource: 'Business Central',
    values: { 'Purchaser Code': purchaserCode, 'Created By': createdBy }
  }) || null;
}
function localCurrencyForBusinessCentral(entity, fallbackCurrency){
  return window.PXImportRules?.resolveLocalCurrency({
    entity, erpSource: 'Business Central', values: { 'Currency Code': '' }
  }) || fallbackCurrency;
}
function normaliseCurrency(v){ return (v == null ? '' : String(v)).trim().toUpperCase(); }
function currencyForBusinessCentral(entity, rawCurrency, fallbackCurrency){
  return normaliseCurrency(rawCurrency) || localCurrencyForBusinessCentral(entity, fallbackCurrency);
}
function orderTypeForBusinessCentral(entity, rawCurrency, fallbackCurrency){
  const raw = normaliseCurrency(rawCurrency);
  const localCurrency = normaliseCurrency(localCurrencyForBusinessCentral(entity, fallbackCurrency));
  // BC exports may show the local currency as blank or as the actual local code
  // (SCR for Seychelles Breweries, EUR for Edena). Both are local orders.
  return (!raw || raw === localCurrency) ? 'local' : 'foreign';
}
function headerIndex(rows){ const h=rows[0]||[]; const idx={}; h.forEach((n,i)=>{ if(n!=null&&n!=='') idx[String(n).trim()]=i; }); return idx; }
function sheetRows(wb, canonicalName, aliases = []) {
  const directNames = [canonicalName, ...aliases].filter(Boolean);
  for (const name of directNames) {
    const rows = wb.sheet(name);
    if (rows && rows.length) return { rows, actualName: name };
  }
  const clean = value => U(value).replace(/[^A-Z0-9]/g, '');
  const wanted = new Set(directNames.map(clean));
  const match = (wb.sheetNames || []).find(name => wanted.has(clean(name)));
  if (match) {
    const rows = wb.sheet(match);
    if (rows && rows.length) return { rows, actualName: match };
  }
  return { rows: [], actualName: canonicalName };
}

// ---------- build candidates ----------
// Groups line-based exports into ONE PO per (entity|orderId), summing the master
// amount. De-duplicates within the workbook. Maps ERP lifecycle to erpPoStatus —
// NEVER into Phoenix status. Returns grouped valid candidates + stats + warnings +
// an import error report (candidates failing import-specific validation).
function buildCandidates(wb){
  const byKey = new Map();   // entity|orderId -> grouped candidate
  const stats = {};
  const warnings = {
    groupedPOs: 0,
    totalLineRows: 0,
    supplierMatches: { vendorNo: 0, name: 0, alias: 0, unmatched: 0 },
    unmatchedSuppliers: []
  };
  const errors = [];
  const blankFn = () => ({ technical:0, indirect:0, supplychain:0 });
  const requireHeaders = (headers, required, sheet, entity) => {
    const missing = required.filter(name => headers[name] == null);
    if (missing.length) {
      errors.push({ sheet, entity, orderId: null, errors: [`Missing expected column(s): ${missing.join(', ')}`] });
      return false;
    }
    return true;
  };

  function addRow(base, rowAmount){
    const key = base.entity + '|' + base.orderId;
    let g = byKey.get(key);
    if (!g){ g = Object.assign({}, base, { amount: 0, erpAmount: 0, _lines: 0 }); byKey.set(key, g); }
    const amt = (rowAmount == null ? 0 : rowAmount);
    g.amount = (g.amount || 0) + amt;          // master amount = Σ line amounts
    g.erpAmount = (g.erpAmount || 0) + amt;
    g._lines += 1;
    warnings.totalLineRows += 1;
  }

  function doPhoenix(sheet, orderType){
    const rows = wb.sheet(sheet); if(!rows.length){ return; }
    const H = headerIndex(rows);
    if (!requireHeaders(H, ['No.','PO Closed','Purchasing Mgr ID','HOD ID','Buy-from Vendor No.','Buy-from Vendor Name','Currency Code','Document Date','Purpose','LineAmount'], sheet, 'Phoenix')) return;
    const get=(r,name)=> H[name]!=null ? r[H[name]] : undefined;
    const s = stats[sheet] = { classified:0, skippedClosed:0, skippedUnmatched:0, byFn:blankFn() };
    const seenPO = new Set();
    for (let i=1;i<rows.length;i++){
      const r=rows[i]; if(!r) continue;
      const no=get(r,'No.'); if(!no||String(no).trim()==='') continue;
      if (U(get(r,'PO Closed'))==='YES'){ s.skippedClosed++; continue; }
      const fn = classifyPhoenix(get(r,'Purchasing Mgr ID'), get(r,'HOD ID'));
      if(!fn){ s.skippedUnmatched++; continue; }
      const orderId = String(no).trim();
      const rawCurrency = (get(r,'Currency Code')||'').toString().trim();
      // Some Navision exports omit the blank currency cell entirely. In that
      // case the local-currency LineAmount is read under Currency Code; recover
      // it safely instead of importing a numeric currency value.
      const recoveredLocalAmount = /^[+-]?\d+(\.\d+)?$/.test(rawCurrency) ? toNum(rawCurrency) : null;
      const lineAmount = toNum(get(r,'LineAmount')) ?? recoveredLocalAmount;
      const orderCurrency = /^[A-Za-z]{3}$/.test(rawCurrency) ? rawCurrency.toUpperCase() : 'MUR';
      if (!seenPO.has(orderId)){ seenPO.add(orderId); s.classified++; s.byFn[fn]++; }
      addRow({
        orderId, entity:'Phoenix', orderType, function:fn,
        integrationLayer:'excel-import',
        warehouseSource:`manual-excel:${sheet}`,
        warehouseRecordId:`${sheet}:${orderId}`,
        supplier:(get(r,'Buy-from Vendor Name')||'').toString().trim()||'—',
        currency:orderCurrency,
        dateOfOrder:excelDateToISO(get(r,'Document Date')),
        description:(get(r,'Purpose')||'').toString().trim(),
        requestedReceiptDate:excelDateToISO(get(r,'Requested Receipt Date')),
        iprNumber:(get(r,'Created From IPR No.')||'').toString().trim(),
        iprApprovedDate:excelDateToISO(get(r,'HOD Approval Date')),
        claimant:(get(r,'Requested By')||'').toString().trim(),
        erpSource:'Navision',
        erpCompany:'PHOENIX-NAV',
        erpDocumentNo:orderId,        // ERP doc number (GUID erpDocumentId arrives via middleware)
        // ERP provenance (read-only); lifecycle → erpPoStatus, NOT Phoenix status
        erpVendorNo:(get(r,'Buy-from Vendor No.')||'').toString().trim()||null,
        erpVendorName:(get(r,'Buy-from Vendor Name')||'').toString().trim()||null,
        erpCurrency:orderCurrency,
        erpPoStatus: U(get(r,'PO Closed'))==='YES' ? 'Closed' : 'Open',
        erpHodId:(get(r,'HOD ID')||'').toString().trim()||null,
        erpPurchasingMgrId:(get(r,'Purchasing Mgr ID')||'').toString().trim()||null,
        erpCreatedFromIpr:(get(r,'Created From IPR No.')||'').toString().trim()||null
      }, lineAmount);
    }
  }
  doPhoenix('FPO','foreign');
  doPhoenix('LPO','local');

  function doBusinessCentral(sheet, entity, erpCompany, localCurrency, aliases = []){
    const sourceSheet = sheetRows(wb, sheet, aliases);
    const rows = sourceSheet.rows; if (!rows.length) return;
    const H=headerIndex(rows); const get=(r,name)=> H[name]!=null ? r[H[name]] : undefined;
    if (requireHeaders(H, ['No.','Status','Created By','Purchaser Code','Buy-from Vendor No.','Buy-from Vendor Name','Currency Code','Document Date','Purpose Of Order','Amount'], sheet, entity)) {
    const s = stats[sheet] = { classified:0, skippedClosed:0, skippedUnmatched:0, byFn:blankFn() };
    const seenPO = new Set();
    for(let i=1;i<rows.length;i++){
      const r=rows[i]; if(!r) continue;
      const no=get(r,'No.'); if(!no||String(no).trim()==='') continue;
      const rawStatus=(get(r,'Status')||'').toString().trim();
      if (['CLOSED','CANCELLED'].includes(U(rawStatus))){ s.skippedClosed++; continue; }
      const fn = classifyBusinessCentralForEntity(entity, get(r,'Purchaser Code'), get(r,'Created By'));
      if(!fn){ s.skippedUnmatched++; continue; }
      const orderId = String(no).trim();
      const rawCurrency = get(r,'Currency Code');
      const orderCurrency = currencyForBusinessCentral(entity, rawCurrency, localCurrency);
      const orderType = orderTypeForBusinessCentral(entity, rawCurrency, localCurrency);
      if (!seenPO.has(orderId)){ seenPO.add(orderId); s.classified++; s.byFn[fn]++; }
      addRow({
        orderId, entity, orderType, function:fn,
        integrationLayer:'excel-import',
        warehouseSource:`manual-excel:${sourceSheet.actualName}`,
        warehouseRecordId:`${sourceSheet.actualName}:${orderId}`,
        supplier:(get(r,'Buy-from Vendor Name')||'').toString().trim()||'—',
        currency:orderCurrency,
        // Seychelles/Edena BC mapping: Date of Order comes from Posting Date.
        dateOfOrder:excelDateToISO(get(r,'Posting Date')),
        description:(get(r,'Purpose Of Order')||'').toString().trim(),
        requestedReceiptDate:excelDateToISO(get(r,'Requested Receipt Date')),
        paymentTerms:(get(r,'Payment Terms Code')||'').toString().trim(),
        // PQ Number (shown as "PQ No." for Seychelles) is the BC Quote No.
        iprNumber:(get(r,'Quote No.')||'').toString().trim(),
        // Purchasing Officer is the BC Purchaser Code (BB01, SH01, ...), which carries the
        // officer code. (Assigned User ID is almost always blank in the BC export.)
        officerCode:(get(r,'Purchaser Code')||'').toString().trim()||null,
        erpSource:'Business Central',
        erpCompany,
        erpDocumentNo:orderId,
        erpVendorNo:(get(r,'Buy-from Vendor No.')||'').toString().trim()||null,
        erpVendorName:(get(r,'Buy-from Vendor Name')||'').toString().trim()||null,
        erpCurrency:orderCurrency,
        erpPoStatus: rawStatus || null,   // ERP lifecycle, not Phoenix status
        erpCreatedBy:(get(r,'Created By')||'').toString().trim()||null,
        erpPurchaserCode:(get(r,'Purchaser Code')||'').toString().trim()||null,
        erpShipmentMethod:(get(r,'Shipment Method Code')||'').toString().trim()||null,
        // Additional Business Central (Seychelles/Edena) header fields.
        amountInclVat:toNum(get(r,'Amount Including VAT')),
        paymentDueDate:excelDateToISO(get(r,'Due Date')),
        locationCode:(get(r,'Location Code')||'').toString().trim()||null,
        departmentCode:(get(r,'Department Code')||'').toString().trim()||null,
        logisticStatus:(get(r,'Logistic Status')||'').toString().trim()||null,
        amountReceivedNotInvoiced:toNum(get(r,'Amount Received Not Invoiced (LCY)'))
      }, toNum(get(r,'Amount')));
    }
    }
  }
  doBusinessCentral('Seybrew', 'Seychelles Breweries', 'SEYBREW-BC', 'SCR',
    ['Seybrew Export', 'Seychelles Breweries', 'Seychelles', 'SBL', 'Seybrew BC', 'SEYBREW-BC']);
  doBusinessCentral('Edena', 'Edena', 'EDENA-BC', 'EUR',
    ['Edena Export', 'Edena BC', 'EDENA-BC']);

  const all = [];
  for (const g of byKey.values()){ g._grouped = g._lines > 1; delete g._lines; all.push(g); }
  warnings.groupedPOs = all.filter(c => c._grouped).length;

  // Vendor code is the primary match. Vendor name and configured aliases are a
  // deliberate fallback only, so imports never depend on a fragile display name.
  all.forEach(candidate => {
    const match = window.PXSupplierMap && window.PXSupplierMap.matchSupplier({
      name: candidate.erpVendorName || candidate.supplier,
      vendorNo: candidate.erpVendorNo,
      entity: candidate.entity,
      erpSource: candidate.erpSource,
      asOf: candidate.dateOfOrder
    });
    if (match) {
      candidate.supplierId = match.supplier.id;
      candidate.supplierMatchMethod = match.method;
      warnings.supplierMatches[match.method] = (warnings.supplierMatches[match.method] || 0) + 1;
    } else {
      candidate.supplierMatchMethod = 'unmatched';
      warnings.supplierMatches.unmatched++;
      warnings.unmatchedSuppliers.push({
        entity: candidate.entity,
        orderId: candidate.orderId,
        vendorNo: candidate.erpVendorNo || '—',
        vendorName: candidate.erpVendorName || candidate.supplier || '—'
      });
    }
  });

  // Import-specific validation (we keep PXStore.skipValidation for the ERP-shaped
  // write, but never commit a candidate that fails these checks).
  const valid = [];
  all.forEach(c => {
    const errs = validateCandidate(c);
    if (errs.length) errors.push({ orderId:c.orderId, entity:c.entity, errors:errs });
    else valid.push(c);
  });
  return { candidates: valid, allCandidates: all, stats, warnings, errors };
}

function validateCandidate(c){
  const e = [];
  if (!c.orderId) e.push('missing PO number');
  if (!['Phoenix','Seychelles Breweries','Edena'].includes(c.entity)) e.push('invalid entity');
  if (!['foreign','local'].includes(c.orderType)) e.push('invalid order type');
  if (!['technical','indirect','supplychain'].includes(c.function)) e.push('unclassified function');
  if (c.amount != null && (isNaN(Number(c.amount)) || Number(c.amount) < 0)) e.push('amount not a valid non-negative number');
  if (!c.currency) e.push('missing currency');
  return e;
}

function splitNewExisting(candidates){
  // Key by entity + orderId so a Phoenix LPO and a Seybrew PO sharing a number never collide.
  const existing = {};
  state.data.orders.forEach(o=>{ if(o.orderId) existing[(o.entity||'Phoenix') + '|' + String(o.orderId).trim()] = o; });
  const toCreate=[], toUpdate=[], conflicts=[];
  candidates.forEach(c => {
    const ex = existing[c.entity + '|' + c.orderId];
    if (ex){
      toUpdate.push(c);
      // Surface meaningful divergences for review before commit.
      const diffs = [];
      if (c.amount != null && ex.amount != null && Number(c.amount) !== Number(ex.amount)) diffs.push(`amount ${ex.amount}→${c.amount}`);
      if (c.supplier && ex.supplier && c.supplier !== ex.supplier) diffs.push('supplier differs');
      if (c.currency && ex.currency && c.currency !== ex.currency) diffs.push(`currency ${ex.currency}→${c.currency}`);
      if (c.orderType && ex.orderType && c.orderType !== ex.orderType) diffs.push(`order type ${ex.orderType}→${c.orderType}`);
      if (c.function && ex.function && c.function !== ex.function) diffs.push(`function ${ex.function}→${c.function}`);
      if (diffs.length) conflicts.push({ orderId:c.orderId, entity:c.entity, diffs });
    } else toCreate.push(c);
  });
  return { toCreate, toUpdate, conflicts };
}

// ERP-owned fields refreshed on an existing order. Phoenix-owned operational data
// (status, milestones, noShipment, stagedPayment, notes, follow-ups, etc.) is NEVER
// touched. Phoenix orderType/function are fill-once so re-import cannot overwrite
// a Phoenix re-classification. Seychelles and Edena Business Central classifications are a
// controlled exception: currency determines local/foreign, and Purchaser Code is
// the ERP functional classifier.
const ERP_OWNED_UPDATE_FIELDS = ['supplier','currency','amount','dateOfOrder','description',
  'requestedReceiptDate','paymentTerms','iprNumber','iprApprovedDate','claimant',
  'erpSource','erpCompany','erpEntityId','erpDocumentId','erpDocumentNo',
  'integrationLayer','warehouseSource','warehouseRecordId','warehouseBatchId',
  'warehouseExtractedAt','warehouseLoadedAt','warehouseHash',
  'erpVendorNo','erpVendorName','erpAmount','erpCurrency','erpPoStatus',
  'erpHodId','erpPurchasingMgrId','erpCreatedFromIpr','erpCreatedBy','erpPurchaserCode','erpShipmentMethod'];
// Phoenix-owned relation fields derived from the ERP vendor values above. They
// are intentionally kept outside the ERP-owned list: a future mapping gap must
// never erase an existing, manually maintained supplier link during re-import.
const SUPPLIER_LINK_UPDATE_FIELDS = ['supplierId', 'supplierMatchMethod'];

async function commitImport(candidates, opts={}){
  const { cancelRef, onProgress, runContext } = opts;
  const batchId = runContext?.runId || `IMP-${Date.now()}`;
  const loadedAt = new Date().toISOString();
  const extractedAt = runContext?.fileMeta?.lastModified ? new Date(runContext.fileMeta.lastModified).toISOString() : null;
  const existing = {};
  state.data.orders.forEach(o=>{ if(o.orderId) existing[(o.entity||'Phoenix') + '|' + String(o.orderId).trim()] = o; });
  let created=0, updated=0, failed=0, done=0;
  const rowErrors = [];
  const total = candidates.length;
  for (const c of candidates){
    if (cancelRef && cancelRef.cancelled) break;
    const ex = existing[c.entity + '|' + c.orderId];
    try {
      if (ex){
        const patch = {};
        ERP_OWNED_UPDATE_FIELDS.forEach(f => { if (c[f] !== undefined) patch[f] = c[f]; });
        if (c.supplierId) SUPPLIER_LINK_UPDATE_FIELDS.forEach(f => { if (c[f] !== undefined) patch[f] = c[f]; });
        // Purchasing officer: fill from ERP only when the existing order has no officer yet.
        // This corrects previously-blank officers on re-import, while a deliberate Phoenix
        // reassignment (a non-empty officerCode) is preserved and never overwritten.
        if (c.officerCode && !(ex.officerCode && String(ex.officerCode).trim())) {
          patch.officerCode = c.officerCode;
        }
        // Business Central detail fields are ERP-owned; refresh them on re-import.
        ['amountInclVat','paymentDueDate','locationCode','departmentCode','logisticStatus',
         'amountReceivedNotInvoiced'].forEach(f => { if (c[f] !== undefined) patch[f] = c[f]; });

        // Flag changes to KEY fields (Amount, Currency, Requested Receipt Date) so officers
        // can review what the warehouse moved. Warehouse still wins (value is applied); the
        // flag is purely for visibility. Only the most recent refresh's changes are kept —
        // each import overwrites lastRefreshChanges.
        const KEY_CHANGE_FIELDS = [
          { f: 'amount',               label: 'PO Amount' },
          { f: 'currency',             label: 'Currency' },
          { f: 'requestedReceiptDate', label: 'Requested Receipt Date' }
        ];
        const changes = [];
        KEY_CHANGE_FIELDS.forEach(({ f, label }) => {
          if (c[f] === undefined) return;
          const oldV = ex[f], newV = c[f];
          const norm = v => (v == null ? '' : String(v).trim());
          const differs = (f === 'amount')
            ? (oldV != null && newV != null && Number(oldV) !== Number(newV))
            : (norm(oldV) !== norm(newV) && norm(oldV) !== '');
          if (differs) changes.push({ field: f, label, old: oldV ?? null, new: newV ?? null });
        });
        // Always set lastRefreshChanges (empty array clears any prior refresh's flags).
        patch.lastRefreshChanges = changes;
        patch.lastRefreshAt = loadedAt;

        const isPurchaserCodeBcEntity = ['Seychelles Breweries', 'Edena'].includes(c.entity) && c.erpSource === 'Business Central';
        if (c.orderType && (!ex.orderType || isPurchaserCodeBcEntity)) patch.orderType = c.orderType;
        if (c.function && (!ex.function || (isPurchaserCodeBcEntity && c.erpPurchaserCode))) patch.function = c.function;
        patch.integrationLayer = c.integrationLayer || 'excel-import';
        patch.warehouseSource = c.warehouseSource || 'manual-excel';
        patch.warehouseRecordId = c.warehouseRecordId || null;
        patch.warehouseBatchId = batchId;
        patch.warehouseExtractedAt = c.warehouseExtractedAt || extractedAt;
        patch.warehouseLoadedAt = loadedAt;
        patch.erpSyncStatus = 'synced';
        patch.erpLastSyncedAt = loadedAt;
        // Deliberately NO status here — ERP lifecycle is in erpPoStatus.
        await window.PXStore.updateRecord('orders', ex.id, patch, {
          skipValidation:true, permissionResource: 'erprecon', permissionAction: 'edit'
        });
        // Audit-log each key-field change (who = import, when = now, old → new).
        if (changes.length && window.PXStore.logStatusChange) {
          for (const ch of changes) {
            await window.PXStore.logStatusChange('orders', ex.id, 'erp-refresh-change',
              `${ch.label}: ${ch.old ?? '—'} → ${ch.new ?? '—'}`, { batchId });
          }
        }
        updated++;
      } else {
        const rec = {};
        ERP_OWNED_UPDATE_FIELDS.forEach(f => { if (c[f] !== undefined) rec[f] = c[f]; });
        SUPPLIER_LINK_UPDATE_FIELDS.forEach(f => { if (c[f] !== undefined) rec[f] = c[f]; });
        // Officer + Business Central detail fields aren't in the refresh whitelists (which
        // govern what a re-import may overwrite), but new orders must still receive them.
        ['officerCode','amountInclVat','paymentDueDate','locationCode','departmentCode',
         'logisticStatus','amountReceivedNotInvoiced'].forEach(f => { if (c[f] !== undefined) rec[f] = c[f]; });
        rec.orderId = c.orderId; rec.entity = c.entity;
        rec.orderType = c.orderType; rec.function = c.function;
        rec.integrationLayer = c.integrationLayer || 'excel-import';
        rec.warehouseSource = c.warehouseSource || 'manual-excel';
        rec.warehouseRecordId = c.warehouseRecordId || null;
        rec.warehouseBatchId = batchId;
        rec.warehouseExtractedAt = c.warehouseExtractedAt || extractedAt;
        rec.warehouseLoadedAt = loadedAt;
        rec.erpSyncStatus = 'synced'; rec.erpLastSyncedAt = loadedAt;
        // Phoenix operational status, seeded from the ERP lifecycle at the earliest
        // honest point (an import proves the PO was issued, not that the supplier has
        // progressed it). Officers advance it from here. erpPoStatus stays as the
        // read-only ERP provenance. Closed/cancelled POs are already skipped upstream,
        // so new imports normally land at "Order sent to supplier".
        const mapErp = (window.PXUtils && window.PXUtils.mapErpPoStatus) || window.mapErpPoStatus;
        rec.status = mapErp ? mapErp(c.erpPoStatus) : 'Order sent to supplier';
        rec.isClosed = (c.erpPoStatus === 'Closed' || rec.status === 'Order closed' || rec.status === 'Order cancelled');
        rec.milestones = [];
        await window.PXStore.createRecord('orders', rec, {
          skipValidation:true, permissionResource: 'erprecon', permissionAction: 'create'
        });
        created++;
      }
    } catch(e){ failed++; rowErrors.push({ orderId:c.orderId, entity:c.entity, error:(e&&e.message)||String(e) }); console.warn('Import row failed', c.orderId, e&&e.message); }
    done++;
    if (onProgress && (done%10===0 || done===total)) onProgress({ done, total, created, updated, failed });
  }
  const result = { created, updated, failed, done, rowErrors, cancelled: !!(cancelRef && cancelRef.cancelled), total };
  if (runContext && window.PXImportHistory) {
    try { await window.PXImportHistory.recordImportRun({ ...runContext, candidates }, result); }
    catch (error) { console.warn('Import history record failed', error && error.message); }
  }
  return result;
}

window.PXPoImport = { buildCandidates, splitNewExisting, commitImport, validateCandidate };

/* ---------- Legacy STATUS-log migration ----------
   Reads the old workbook's free-text STATUS column (dated narrative history per PO)
   and creates a follow-up note on the matching order. Safe to re-run: skips a PO if an
   identical migrated note already exists. Sheets: 'OPEN FOREIGN ORDER' (STATUS, FPO No),
   'OPEN LOCAL ORDER' (STATUS, LPO NO.). */
function buildStatusMigration(wb){
  const state = window.__state;
  const out = [];   // { orderId, text, matched, orderDocId }
  const sheets = [
    { name: 'OPEN FOREIGN ORDER', poKeys: ['FPO No', 'FPO No ', 'FPO NO.', 'FPO NO. '], statusKeys: ['STATUS', 'STATUS '] },
    { name: 'OPEN LOCAL ORDER',   poKeys: ['LPO NO.', 'LPO NO. ', 'LPO No', 'LPO No '], statusKeys: ['STATUS', 'STATUS '] }
  ];
  const norm = s => U(s);
  const ordersByCode = {};
  (state.data.orders || []).forEach(o => { if (o.orderId) ordersByCode[norm(o.orderId)] = o; });
  sheets.forEach(cfg => {
    const rows = wb.sheet(cfg.name); if (!rows || !rows.length) return;
    const H = headerIndex(rows);
    const colFor = keys => { for (const k of keys) if (H[k] != null) return H[k]; return null; };
    const poCol = colFor(cfg.poKeys), stCol = colFor(cfg.statusKeys);
    if (poCol == null || stCol == null) return;
    for (let i = 1; i < rows.length; i++){
      const r = rows[i]; if (!r) continue;
      const po = r[poCol], txt = r[stCol];
      if (!po || !txt) continue;
      const text = String(txt).trim();
      if (text.length < 3) continue;
      const ord = ordersByCode[norm(po)];
      out.push({ orderId: String(po).trim(), text, matched: !!ord, orderDocId: ord ? ord.id : null });
    }
  });
  return out;
}

async function commitStatusMigration(entries, { onProgress, cancelRef } = {}){
  const state = window.__state;
  let created = 0, skipped = 0, unmatched = 0, failed = 0;
  const total = entries.length;
  for (let i = 0; i < entries.length; i++){
    if (cancelRef && cancelRef.cancelled) break;
    const e = entries[i];
    if (onProgress) onProgress({ done: i + 1, total, created, skipped });
    if (!e.matched){ unmatched++; continue; }
    // De-dupe: skip if an identical migrated follow-up already exists for this order
    const tag = '[Migrated from legacy tracker] ';
    const dup = (state.data.followups || []).some(f =>
      !f.archived && f.relatedType === 'order' && f.relatedId === e.orderDocId &&
      (f.comment || '') === (tag + e.text));
    if (dup){ skipped++; continue; }
    try {
      await window.PXStore.createRecord('followups', {
        relatedType: 'order', relatedId: e.orderDocId,
        comment: tag + e.text, officer: 'ERP', status: 'done'
      }, { skipValidation: true, permissionResource: 'erprecon', permissionAction: 'create' });
      created++;
    } catch (err){ failed++; console.warn('Status migration row failed', e.orderId, err && err.message); }
  }
  return { created, skipped, unmatched, failed, cancelled: !!(cancelRef && cancelRef.cancelled) };
}
window.PXStatusMigration = { buildStatusMigration, commitStatusMigration };

/* ============================================================
   DANGER ZONE — purge all business data (demo reset)
   ============================================================
   Hard-deletes every business record across ALL entities so the import can be
   demonstrated from a clean slate. KEEPS officers/roles and system_config so
   logins/teams survive. This is the ONLY sanctioned hard-delete in the app and is
   deliberately isolated here, behind a typed "DELETE ALL" confirmation, rather
   than added to PXStore (which stays delete-free by design). */
const PURGE_TARGETS = [
  { coll: 'orders', stateKey: 'orders' },
  { coll: 'shipments', stateKey: 'shipments' },
  { coll: 'payment_requests', stateKey: 'payments' },
  { coll: 'suppliers', stateKey: 'suppliers' },
  { coll: 'documents', stateKey: 'documents' },
  { coll: 'followups', stateKey: 'followups' },
  { coll: 'issues', stateKey: 'issues' },
  { coll: 'updateRequests', stateKey: 'updateRequests' },
  { coll: 'contactLog', stateKey: 'contactLog' },
  { coll: 'kpiSnapshot', stateKey: 'kpiSnapshot' },
  { coll: 'exports', stateKey: 'exports' },
  { coll: 'status_log', stateKey: 'importRuns' }
];

function purgeCounts() {
  const counts = {};
  PURGE_TARGETS.forEach(t => { counts[t.coll] = (state.data[t.stateKey] || []).length; });
  counts._total = Object.values(counts).reduce((a, b) => a + b, 0);
  return counts;
}
window.__purgeCounts = purgeCounts;

let _purgeCancel = false;
window.__purgeCancel = () => { _purgeCancel = true; };

async function purgeAllData(opts = {}) {
  // Hard guard on the most destructive action (defense in depth — the button is also
  // hidden outside demo mode): never runs in production, and only for an admin.
  const demo = !!(window.__isDemoMode && window.__isDemoMode());
  const enabled = !!(window.REF && window.REF.demoResetEnabled);
  const role = (window.PXUtils && window.PXUtils.currentRole) ? window.PXUtils.currentRole() : 'admin';
  if (!demo || !enabled || role !== 'admin') {
    if (window.PXUtils && window.PXUtils.toast) window.PXUtils.toast('Clearing all data is disabled in this environment.', 'danger');
    throw new Error('purgeAllData is not permitted here.');
  }
  _purgeCancel = false;
  const { onProgress } = opts;
  const fs = window.__fs, db = window.__db;
  if (!fs || !db) throw new Error('Firestore not available.');
  let done = 0, failed = 0;
  const batches = [];
  for (const target of PURGE_TARGETS) {
    if (_purgeCancel) break;
    const snap = await fs.getDocs(fs.collection(db, target.coll));
    batches.push({ coll: target.coll, ids: snap.docs.map(doc => doc.id) });
  }
  const total = batches.reduce((sum, batch) => sum + batch.ids.length, 0);
  for (const batch of batches) {
    if (_purgeCancel) break;
    for (const id of batch.ids) {
      if (_purgeCancel) break;
      try { await fs.deleteDoc(fs.doc(db, batch.coll, id)); }
      catch (e) { failed++; console.warn('purge failed', batch.coll, id, e && e.message); }
      done++;
      if (onProgress && (done % 15 === 0 || done === total)) onProgress({ done, total, failed, coll: batch.coll });
    }
  }
  return { done, failed, total, cancelled: _purgeCancel };
}
window.__purgeAllData = purgeAllData;
