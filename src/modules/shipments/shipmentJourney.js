/* shipmentJourney.js — shipment journey tracker + document-readiness checklist.
   The journey lays the existing shipment date fields into one expected-vs-actual
   lifecycle with proactive alerts ("ETA was N days ago, no arrival"). The document
   checklist tracks which clearance papers are in hand vs awaited, so an incomplete
   set is flagged BEFORE the container lands (the usual cause of demurrage). Both are
   presentation/light-logic over fields the shipment record already carries; the doc
   checklist persists in s.requiredDocs. */
const { fmtDate, escapeHtml, can } = window.PXUtils;
const state = window.__state;

/* ============================================================
   PXJourney — engine
   ============================================================ */
(function () {
  const daysBetween = (a, b) => (a && b) ? Math.round((new Date(b) - new Date(a)) / 86400000) : null;
  const daysFromToday = d => d ? Math.round((new Date(d) - new Date(new Date().toDateString())) / 86400000) : null;

  // The ordered lifecycle. Each step: planned date field, actual date field, label.
  const STEPS = [
    { key: 'ready',     label: 'Ready',        planned: 'readyDate',          actual: 'readyDate' },
    { key: 'booked',    label: 'Booked',       planned: 'bookingDate',        actual: 'bookingDate' },
    { key: 'departed',  label: 'Departed',     planned: 'etd',                actual: 'actualDepartureDate' },
    { key: 'arrived',   label: 'Arrived',      planned: 'eta',                actual: 'actualArrivalDate' },
    { key: 'clearance', label: 'Clearance',    planned: 'clearanceStartDate', actual: 'customsReleaseDate' },
    { key: 'delivered', label: 'Delivered',    planned: null,                 actual: 'deliveryDate' },
    { key: 'grn',       label: 'GRN',          planned: null,                 actual: 'grnDate' }
  ];

  // Build the journey: each step is done / current / pending, with planned vs actual.
  function build(shipment) {
    const steps = STEPS.map(def => {
      const actual = def.actual ? shipment[def.actual] : null;
      const planned = def.planned ? shipment[def.planned] : null;
      return { key: def.key, label: def.label, planned: planned || null, actual: actual || null, done: !!actual };
    });
    // Current step = first not-done. Everything before the last done step is "done".
    let lastDone = -1;
    steps.forEach((s, i) => { if (s.done) lastDone = i; });
    steps.forEach((s, i) => {
      s.state = s.done ? 'done' : (i === lastDone + 1 ? 'current' : 'pending');
    });
    return steps;
  }

  // Proactive alerts derived from the journey (does not duplicate orderChecks).
  function alerts(shipment) {
    const out = [];
    const order = (state.data.orders || []).find(o => o.orderId === shipment.orderId) || null;
    const hasLinkedGrn = order && window.PXReceiptControl
      ? window.PXReceiptControl.shipmentGrns(order, shipment).some(window.PXReceiptControl.grnCountsAsReceipt)
      : false;
    if (shipment.completed || shipment.stage === 'completed' || shipment.grnDate || hasLinkedGrn) return out;
    const etaDays = daysFromToday(shipment.eta);
    if (shipment.eta && !shipment.actualArrivalDate && etaDays !== null && etaDays < 0) {
      out.push({ level: 'danger', msg: `ETA was ${Math.abs(etaDays)} day(s) ago, no arrival recorded.` });
    } else if (shipment.eta && !shipment.actualArrivalDate && etaDays !== null && etaDays <= 5) {
      out.push({ level: 'warn', msg: `ETA in ${etaDays} day(s) — confirm clearance readiness.` });
    }
    const etdDays = daysFromToday(shipment.etd);
    if (shipment.etd && !shipment.actualDepartureDate && etdDays !== null && etdDays < 0) {
      out.push({ level: 'warn', msg: `ETD was ${Math.abs(etdDays)} day(s) ago, no departure recorded.` });
    }
    if (shipment.actualArrivalDate && !shipment.customsReleaseDate) {
      const arrAge = daysFromToday(shipment.actualArrivalDate);
      if (arrAge !== null && arrAge < -3) out.push({ level: 'warn', msg: `Arrived ${Math.abs(arrAge)} day(s) ago, still in clearance.` });
    }
    if (shipment.customsReleaseDate && !shipment.deliveryDate && !shipment.grnDate && !hasLinkedGrn) {
      const relAge = daysFromToday(shipment.customsReleaseDate);
      if (relAge !== null && relAge < -3) out.push({ level: 'warn', msg: `Released ${Math.abs(relAge)} day(s) ago, not yet delivered.` });
    }
    return out;
  }

  window.PXJourney = { build, alerts, STEPS };
})();

/* ============================================================
   PXShipmentDocs — document-readiness checklist
   ============================================================ */
(function () {
  // Default required docs. Editable per shipment; "na" marks one not applicable.
  const DEFAULTS = [
    { key: 'invoice',   label: 'Commercial Invoice' },
    { key: 'packing',   label: 'Packing List' },
    { key: 'bl_awb',    label: 'Bill of Lading / AWB' },
    { key: 'coo',       label: 'Certificate of Origin' },
    { key: 'coa',       label: 'COA / Quality Cert' },
    { key: 'insurance', label: 'Insurance Certificate' },
    { key: 'health',    label: 'Health / Phyto Cert' }
  ];

  // Read the checklist for a shipment, seeding from defaults + legacy date fields.
  function list(shipment) {
    const saved = Array.isArray(shipment.requiredDocs) ? shipment.requiredDocs : null;
    if (saved && saved.length) return saved;
    // Seed from any legacy *Date fields so existing shipments aren't blank.
    const legacy = {
      invoice: shipment.invoiceReceivedDate, packing: shipment.packingListDate,
      bl_awb: shipment.blDate, coa: shipment.coaDate, health: shipment.healthCertDate
    };
    return DEFAULTS.map(d => ({
      key: d.key, label: d.label,
      status: legacy[d.key] ? 'received' : 'awaited',
      receivedDate: legacy[d.key] || null, from: '', note: ''
    }));
  }

  function summary(shipment) {
    const docs = list(shipment);
    const applicable = docs.filter(d => d.status !== 'na');
    const received = applicable.filter(d => d.status === 'received');
    return { total: applicable.length, received: received.length, complete: applicable.length > 0 && received.length === applicable.length, docs };
  }

  async function setStatus(shipmentId, key, status) {
    const s = state.data.shipments.find(x => x.id === shipmentId);
    if (!s) return;
    const docs = list(s).map(d => d.key === key
      ? { ...d, status, receivedDate: status === 'received' ? (d.receivedDate || new Date().toISOString().slice(0, 10)) : (status === 'awaited' ? null : d.receivedDate) }
      : d);
    await window.PXStore.updateRecord('shipments', shipmentId, { requiredDocs: docs }, { skipValidation: true,
      log: { recordType: 'shipment', recordId: shipmentId, action: 'doc-status', details: `${key} -> ${status}` } });
  }

  window.PXShipmentDocs = { list, summary, setStatus, DEFAULTS };
})();

/* ============================================================
   Renderers (used by the shipment detail)
   ============================================================ */
window.renderShipmentJourney = function (shipment) {
  const steps = window.PXJourney.build(shipment);
  const al = window.PXJourney.alerts(shipment);
  const node = s => {
    const cls = s.state === 'done' ? 'done' : s.state === 'current' ? 'current' : 'pending';
    const date = s.actual || s.planned;
    const tag = s.actual ? '' : (s.planned ? ' <span class="jl-plan">(plan)</span>' : '');
    return `<div class="jstep ${cls}">
      <div class="jdot"></div>
      <div class="jlabel">${escapeHtml(s.label)}</div>
      <div class="jdate">${date ? fmtDate(date) + tag : '—'}</div>
    </div>`;
  };
  const alertHtml = al.length
    ? `<div class="journey-alerts">${al.map(a => `<div class="jalert ${a.level}">${a.level === 'danger' ? '🔴' : '🟠'} ${escapeHtml(a.msg)}</div>`).join('')}</div>`
    : '';
  return `<div class="card mb-16"><h4 style="margin:0 0 10px">Shipment journey</h4>
    <div class="journey-strip">${steps.map(node).join('<div class="jconn"></div>')}</div>
    ${alertHtml}</div>`;
};

window.renderShipmentDocs = function (shipment) {
  const sum = window.PXShipmentDocs.summary(shipment);
  const canChangeDocs = !!(can && can('shipments', 'edit'));
  const pill = sum.complete
    ? '<span class="badge success">All docs ready</span>'
    : `<span class="badge ${sum.received === 0 ? 'danger' : 'warn'}">${sum.received} of ${sum.total} ready</span>`;
  const row = d => {
    const statusBadge = d.status === 'received' ? '<span class="badge success" style="font-size:10px">received</span>'
      : d.status === 'na' ? '<span class="badge neutral" style="font-size:10px">N/A</span>'
      : '<span class="badge warn" style="font-size:10px">awaited</span>';
    const cycle = `window.__cycleDocStatus('${shipment.id}','${d.key}','${d.status}')`;
    return `<tr>
      <td>${escapeHtml(d.label)}</td>
      <td>${statusBadge}</td>
      <td class="text-xs">${d.receivedDate ? fmtDate(d.receivedDate) : '—'}</td>
      <td>${canChangeDocs ? `<button class="btn btn-sm" onclick="${cycle}">Change</button>` : '<span class="text-xs text-muted">View only</span>'}</td>
    </tr>`;
  };
  return `<div class="card mb-16">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h4 style="margin:0">Document readiness ${pill}</h4>
    </div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Document</th><th>Status</th><th>Received</th><th></th></tr></thead>
      <tbody>${sum.docs.map(row).join('')}</tbody>
    </table></div>
    <div class="text-xs text-muted" style="margin-top:6px">Cycle status: awaited → received → N/A. An incomplete set on an arriving shipment is flagged in the journey alerts.</div>
  </div>`;
};

// Cycle a doc's status awaited -> received -> na -> awaited, then refresh the detail.
window.__cycleDocStatus = async function (shipmentId, key, current) {
  if (!(can && can('shipments', 'edit'))) {
    if (window.PXUtils) window.PXUtils.toast('You can view shipment document readiness, but you are not authorised to change it.', 'warn');
    return;
  }
  const next = current === 'awaited' ? 'received' : current === 'received' ? 'na' : 'awaited';
  try {
    await window.PXShipmentDocs.setStatus(shipmentId, key, next);
    if (window.__refreshDetailSections) window.__refreshDetailSections();
    // re-open the detail to reflect the change immediately
    if (window.openShipmentDetail) { window.closeModal && window.closeModal(); setTimeout(() => window.openShipmentDetail(shipmentId), 60); }
  } catch (e) {
    if (window.PXUtils) window.PXUtils.toast('Could not update document status.', 'danger');
  }
};
