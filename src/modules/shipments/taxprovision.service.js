const { currentEntity, recordEntity, entityMeta } = window.PXUtils;
const state = window.__state;
const REF = window.REF;

/* ============================================================
   TAX PROVISION FORECAST — "TEPS"  (service)
   ============================================================
   Reproduces the logistics team's monthly TEPS PROVISION worksheet: for each
   incoming shipment, the approximate Excise & Duties + VAT payable to Customs
   (MRA), so A/C can provision the cash. One row per shipment.

   Calculation (confirmed against the source workbooks):
     CFR Value      = Freight(MUR) + Invoice * Rate
     Insurance      = CFR * insuranceRate%   (default 0.2%, editable)
     VAT            = (CFR + Insurance) * vatRate%   (default 15%, editable)
     Excise & Duties= manual entry, ALCOHOL ONLY (blank/0 otherwise)
     Total Provision= VAT + Excise & Duties

   The shipment save handler already persists cfrValue / tepsInsurance / tepsVat /
   totalProvision. This service recomputes defensively from inputs too, so a row is
   correct even if a record predates the computed fields. Entity-aware. */

function tepsComputed(s) {
  const inv = Number(s.invoiceValue) || 0;
  const rate = Number(s.exchangeRate) || 0;
  const frt = Number(s.tepsFreight) || 0;
  const insRate = (s.insuranceRate == null || s.insuranceRate === '') ? 0.2 : Number(s.insuranceRate);
  const vatRate = (s.vatRate == null || s.vatRate === '') ? 15 : Number(s.vatRate);
  const excise = Number(s.exciseDuties) || 0;
  const cfr = frt + inv * rate;
  const insurance = cfr * (insRate / 100);
  const vat = (cfr + insurance) * (vatRate / 100);
  const total = vat + excise;
  return { cfr, insurance, vat, excise, total, insRate, vatRate };
}
// A shipment has a provision if any TEPS input was entered.
function hasTeps(s) {
  return (s.invoiceValue != null && s.invoiceValue !== '')
      || (s.tepsFreight != null && s.tepsFreight !== '')
      || (s.exciseDuties != null && s.exciseDuties !== '');
}
window.__teps_hasTeps = hasTeps;

/* Build the forecast rows for the current (or given) entity. */
function buildTaxProvision(opts) {
  const ent = (opts && opts.entity) || currentEntity();
  const orderEntity = oid => { const o = state.data.orders.find(x => x.orderId === oid); return o ? recordEntity(o) : null; };
  const shipEntity = s => s.entity || orderEntity(s.orderId) || 'Phoenix';

  const rows = state.data.shipments
    .filter(s => !s.archived && hasTeps(s) && shipEntity(s) === ent)
    .map(s => {
      const lo = s.orderId ? state.data.orders.find(o => o.orderId === s.orderId) : null;
      const c = tepsComputed(s);
      return {
        shipmentDocId: s.id,
        fpo: s.orderId || '—',
        supplier: s.supplier || (lo && lo.supplier) || '—',
        mode: s.mode || s.shipmentMode || '—',
        commodity: s.description || (lo && lo.description) || '',
        etd: s.etd ? new Date(s.etd) : null,
        eta: s.eta ? new Date(s.eta) : null,
        invoiceValue: Number(s.invoiceValue) || 0,
        invoiceCurrency: s.invoiceCurrency || '',
        rate: Number(s.exchangeRate) || 0,
        freight: Number(s.tepsFreight) || 0,
        cfr: c.cfr, insurance: c.insurance, excise: c.excise, vat: c.vat, total: c.total,
        isAlcohol: !!s.isAlcohol, entity: ent
      };
    });
  // sort by ETA (undated last)
  rows.sort((a, b) => { if (a.eta && b.eta) return a.eta - b.eta; if (a.eta) return -1; if (b.eta) return 1; return 0; });

  const totals = rows.reduce((acc, r) => {
    acc.cfr += r.cfr; acc.insurance += r.insurance; acc.excise += r.excise; acc.vat += r.vat; acc.total += r.total;
    return acc;
  }, { cfr: 0, insurance: 0, excise: 0, vat: 0, total: 0 });

  return { rows, totals };
}
window.__teps_buildTaxProvision = buildTaxProvision;

// Sidebar count = shipments with a provision for the current entity.
window.__taxProvisionCount = function () {
  try { return buildTaxProvision({ entity: currentEntity() }).rows.length; }
  catch (e) { return 0; }
};

/* ---- A/C export rows (the TEPS sheet layout) ---- */
function buildTaxProvisionExportRows(opts) {
  const { rows } = buildTaxProvision(opts || {});
  const fmtD = d => { if (!d) return ''; const x = new Date(d); return isNaN(x) ? '' : x.toISOString().slice(0, 10); };
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const r2null = n => (n == null || n === '') ? '' : Math.round(Number(n) * 100) / 100;
  const headers = ['Entity', 'FPO', 'Supplier', 'Mode', 'Commodity', 'ETD', 'ETA',
    'Total Invoice', 'Currency', 'Rate', 'Freight (MUR)', 'CFR Value', 'Insurance',
    'Excise & Duties', 'VAT', 'Total Provision (estimate)',
    'Actual Landed Cost (MUR)', 'Variance (MUR)', 'Variance %', 'Outstanding', 'Actual Confirmed Date', 'Note'];
  // shipment lookup for the Inc.2 actual-landed-cost fields (stripped from buildTaxProvision rows)
  const shipsMap = {};
  state.data.shipments.forEach(s => { shipsMap[s.id] = s; });
  const data = rows.map(r => {
    const s = shipsMap[r.shipmentDocId] || {};
    const lc = window.PXLandedCost ? window.PXLandedCost.forShipment(s) : { actual: null, variance: null, variancePct: null, outstanding: false };
    return [
      r.entity, r.fpo, r.supplier, r.mode, r.commodity, fmtD(r.etd), fmtD(r.eta),
      r2(r.invoiceValue), r.invoiceCurrency, r.rate, r2(r.freight), r2(r.cfr), r2(r.insurance),
      r2(r.excise), r2(r.vat), r2(r.total),
      r2null(lc.actual),
      lc.variance != null ? Math.round(lc.variance * 100) / 100 : '',
      lc.variancePct != null ? Math.round(lc.variancePct * 10) / 10 : '',
      lc.outstanding ? 'YES' : (lc.actual != null ? 'NO' : ''),
      fmtD(s.actualLandedCostDate), s.actualLandedCostNote || ''
    ];
  });
  return { headers, rows: data };
}
window.__teps_buildExportRows = buildTaxProvisionExportRows;

function buildTaxProvisionCSV(opts) {
  const { headers, rows } = buildTaxProvisionExportRows(opts || {});
  const esc = v => { const s = (v == null ? '' : String(v)); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [headers.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
}
window.__teps_buildCSV = buildTaxProvisionCSV;

/* Real .xlsx via the shared dependency-free zip writer from payments.service.js
   (window.__pay_zipStored). Numbers written as numeric cells. */
function buildTaxProvisionXLSX(opts) {
  const { headers, rows } = buildTaxProvisionExportRows(opts || {});
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
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>';
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Tax Provision" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
  const files = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/worksheets/sheet1.xml', data: sheet }
  ];
  // Reuses the dependency-free zip writer from payments.service.js. Build load order
  // guarantees it is present; this guard degrades gracefully (the caller catches and
  // toasts) instead of throwing a raw TypeError if that ever changes.
  const zip = window.__pay_zipStored;
  if (typeof zip !== 'function') throw new Error('Excel writer is unavailable — reload the page and try the export again.');
  return zip(files);
}
window.__teps_buildXLSX = buildTaxProvisionXLSX;

/* ============================================================
   PXLandedCost — Increment 2: estimate vs actual landed cost
   ============================================================
   Compares TEPS total provision (estimate, MUR) against the actual
   landed cost entered post-clearance (actualLandedCostMUR).
   Variance = actual − estimate (positive = overspend vs provision).
   "outstanding" = GRN recorded AND hasTeps() AND no actual yet. */
function lcForShipment(s) {
  const has = window.__teps_hasTeps ? window.__teps_hasTeps(s) : false;
  const estimate = (s.totalProvision != null && s.totalProvision !== '') ? Number(s.totalProvision) : null;
  const actual = (s.actualLandedCostMUR != null && s.actualLandedCostMUR !== '') ? Number(s.actualLandedCostMUR) : null;
  const variance = (estimate != null && actual != null) ? actual - estimate : null;
  const variancePct = (estimate != null && estimate !== 0 && variance != null) ? (variance / estimate * 100) : null;
  const outstanding = !!s.grnDate && has && actual == null;
  return { estimate, actual, variance, variancePct, outstanding, hasTeps: has };
}

function buildActualSummary(opts) {
  const ent = (opts && opts.entity) || currentEntity();
  const orderEntity = oid => { const o = state.data.orders.find(x => x.orderId === oid); return o ? recordEntity(o) : null; };
  const shipEntity = s => s.entity || orderEntity(s.orderId) || 'Phoenix';

  const rows = state.data.shipments
    .filter(s => !s.archived && window.__teps_hasTeps && window.__teps_hasTeps(s) && shipEntity(s) === ent)
    .map(s => {
      const lc = lcForShipment(s);
      const lo = s.orderId ? state.data.orders.find(o => o.orderId === s.orderId) : null;
      return {
        shipmentDocId: s.id, shipmentId: s.shipmentId, fpo: s.orderId || '—',
        supplier: s.supplier || (lo && lo.supplier) || '—',
        grnDate: s.grnDate || null, actualLandedCostDate: s.actualLandedCostDate || null,
        actualLandedCostNote: s.actualLandedCostNote || '',
        estimate: lc.estimate, actual: lc.actual, variance: lc.variance,
        variancePct: lc.variancePct, outstanding: lc.outstanding
      };
    });
  rows.sort((a, b) => (a.outstanding === b.outstanding) ? 0 : a.outstanding ? -1 : 1);
  const totals = rows.reduce((acc, r) => {
    acc.estimate += r.estimate || 0; acc.actual += r.actual || 0;
    acc.variance = acc.actual - acc.estimate; acc.outstanding += r.outstanding ? 1 : 0;
    return acc;
  }, { estimate: 0, actual: 0, variance: 0, outstanding: 0 });
  return { rows, totals };
}

window.PXLandedCost = { forShipment: lcForShipment, buildActualSummary };
