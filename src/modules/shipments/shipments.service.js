const { $, $$, fmtDate, fmtDateISO, fmtMoney, daysBetween, escapeHtml, statusBadgeClass,
  collection, addDoc, doc, getDoc, updateDoc, deleteDoc, serverTimestamp, toast,
  cmGetColumns, cmRenderTable, cmOpenManager, cmExportCSV, fmtQuantityLines,
  checkShipmentDuplicates, shipmentDataQuality, isErpOrder, renderErpBadge,
  currentEntity, recordEntity, entityMeta, stripUndefined, canEditShipments,
  makeShipmentSequenceId, canEditOrders } = window.PXUtils;
const state = window.__state;
const db = window.__db;
const REF = window.REF;


window.requestShipment = async function(orderDocId) {
  const ord = state.data.orders.find(o => o.id === orderDocId);
  if (!ord) { toast('Order not found', 'danger'); return; }
  if (ord.noShipment) { toast('This order is marked as no shipment required.', 'warn'); return; }
  if (!canEditOrders()) { toast('You can view this order, but you are not authorised to request shipments.', 'warn'); return; }

  // Each shipment is its own follow-up record, sequenced per order: FPO12345 (S1), FPO12345 (S2), ...
  // Local shipment exceptions use the same sequence pattern against their LPO number.
  const shipmentId = makeShipmentSequenceId(ord.orderId);

  const localNote = ord.orderType === 'local' ? '\n\nNote: this is a local-order shipment exception. It will follow the same logistics workflow as a foreign shipment.' : '';
  if (!confirm(`Create a shipment request for ${ord.orderId}?\n\nShipment ID: ${shipmentId}\nSupplier: ${ord.supplier || '—'}${localNote}\n\nLogistics will be notified to assign and process it.`)) return;

  try {
    await window.PXStore.createRecord('shipments', {
      shipmentId,
      orderId: ord.orderId,
      entity: recordEntity(ord),
      supplier: ord.supplier || null,
      description: ord.description || null,
      category: ord.category || null,
      stage: 'requested',
      status: 'Shipment request received',
      shipmentCoverage: 'Full order',
      expectedCompleteAfterShipment: 'yes',
      followupAction: null,
      completed: false,
      requestedBy: state.officer.code || state.user.email,
      requestedAt: serverTimestamp(),
      logisticOfficer: null
    }, {
      permissionResource: 'orders',
      permissionAction: 'edit',
      log: { recordType: 'shipment', action: 'requested', details: 'Shipment requested for ' + ord.orderId }
    });
    toast(`Shipment request ${shipmentId} created — logistics notified`, 'success');
    window.closeModal();
    // Navigate to shipments so the user sees it land
    if (window.navigate) window.navigate('shipments');
  } catch (err) {
    console.error(err);
    toast('Failed to create shipment request: ' + err.message, 'danger');
  }
};

/* ============================================================
   addPartialShipment — Logistics adds an additional shipment record
   for an order that arrives in multiple batches (S2, S3, S4...).
   Opens the FULL shipment form pre-linked to the order, so the
   logistic officer fills the details right away.
============================================================ */
window.addPartialShipment = function(orderDocId) {
  const ord = state.data.orders.find(o => o.id === orderDocId);
  if (!ord) { toast('Order not found', 'danger'); return; }
  if (!canEditShipments()) {
    toast('Only logistics can add partial shipments', 'danger'); return;
  }
  // Open the full form, pre-linked; the form computes the next shipment sequence.
  window.openShipmentForm(null, ord.orderId, ord.supplier || '', { partial: true });
};


/* ============================================================
   PXDemurrage — Increment 3: container demurrage / detention tracker
   ============================================================
   Two clocks per sea shipment:
     Demurrage = port dwell    (portArrivalDate → containerPickupDate)
     Detention = importer hold (containerPickupDate → containerReturnDate)
   Open clocks use "today" as the running end. Status:
     clear | warning(≤3 free days left) | overdue | closed | inactive
   ============================================================ */
(function () {
  const MS = 86400000;
  const WARN_BUFFER = 3;
  const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
  const toD = v => { if (!v) return null; const d = new Date(v); d.setHours(0,0,0,0); return isNaN(d) ? null : d; };
  const between = (a, b) => a && b ? Math.round((b - a) / MS) : null;

  function clockStatus(startDate, endDate, freeDays) {
    const start = toD(startDate);
    if (!start) return { status: 'inactive', elapsed: null, remaining: null, overdueDays: null };
    const end = toD(endDate) || today();
    const elapsed = between(start, end);
    const fd = freeDays != null && freeDays !== '' ? Number(freeDays) : null;
    if (fd == null) return { status: toD(endDate) ? 'closed' : 'active-no-limit', elapsed, remaining: null, overdueDays: null };
    const remaining = fd - elapsed;
    if (toD(endDate)) return { status: 'closed', elapsed, remaining, overdueDays: remaining < 0 ? -remaining : 0 };
    if (remaining < 0) return { status: 'overdue', elapsed, remaining, overdueDays: -remaining };
    if (remaining <= WARN_BUFFER) return { status: 'warning', elapsed, remaining, overdueDays: 0 };
    return { status: 'clear', elapsed, remaining, overdueDays: 0 };
  }

  function demForShipment(s) {
    const containers = Number(s.containerCount) || 1;
    const dem = clockStatus(s.portArrivalDate, s.containerPickupDate, s.demurrageFreeDays);
    const det = clockStatus(s.containerPickupDate, s.containerReturnDate, s.detentionFreeDays);
    const dRate = Number(s.demurrageRatePerDay) || null;
    const tRate = Number(s.detentionRatePerDay) || null;
    const cur = s.trackerCurrency || 'USD';
    const demCost = (dRate && dem.overdueDays) ? dem.overdueDays * dRate * containers : null;
    const detCost = (tRate && det.overdueDays) ? det.overdueDays * tRate * containers : null;
    const totalCost = (demCost != null || detCost != null) ? (demCost || 0) + (detCost || 0) : null;
    const worst = ['overdue','warning','clear','closed','inactive','active-no-limit'];
    const statuses = [dem.status, det.status].filter(x => x !== 'inactive');
    const overall = statuses.length ? worst.find(w => statuses.includes(w)) : 'inactive';
    return { demurrage: dem, detention: det, overall, containers, demCost, detCost, totalCost, cur };
  }

  function buildTrackerList(opts) {
    const ent = (opts && opts.entity) || currentEntity();
    const orderEntity = oid => { const o = state.data.orders.find(x => x.orderId === oid); return o ? (o.entity || 'Phoenix') : null; };
    const shipEntity = s => s.entity || orderEntity(s.orderId) || 'Phoenix';
    return state.data.shipments
      .filter(s => !s.archived && !s.completed && shipEntity(s) === ent
                && (s.mode||'').toLowerCase() === 'sea' && s.portArrivalDate)
      .map(s => {
        const lo = s.orderId ? state.data.orders.find(o => o.orderId === s.orderId) : null;
        const t = demForShipment(s);
        return { shipmentDocId: s.id, shipmentId: s.shipmentId, fpo: s.orderId || '—',
          supplier: s.supplier || (lo && lo.supplier) || '—', portArrivalDate: s.portArrivalDate,
          portOfDischarge: s.portOfDischarge || '', containerNumber: s.containerNumber || '',
          containerPickupDate: s.containerPickupDate || null, containers: t.containers, ...t };
      })
      .sort((a, b) => {
        const order = { overdue:0, warning:1, clear:2, 'active-no-limit':3, closed:4, inactive:5 };
        return (order[a.overall] ?? 9) - (order[b.overall] ?? 9);
      });
  }

  window.PXDemurrage = { forShipment: demForShipment, buildTrackerList, clockStatus };
  window.__demurrageAtRiskCount = function () {
    try { return buildTrackerList({ entity: currentEntity() }).filter(r => r.overall === 'overdue' || r.overall === 'warning').length; }
    catch (e) { return 0; }
  };
})();
