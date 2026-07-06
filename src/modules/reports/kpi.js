/* kpi.js — PXKpi engine: single source of truth for KPI values.
   The live Dashboard and the KPI-trend snapshots both call this, so they can never
   disagree. Two key design rules driven by go-live with 2024→today history:

   1. NULL-TOLERANT: a record missing a field needed for a KPI simply does not count
      toward that KPI — it is never an error. Every average/ratio returns null (shown
      as "—") when nothing is eligible, never NaN. Old/incomplete orders never block.

   2. DATE-WINDOW-AWARE: KPIs that are naturally bucketable by date (OTIF by receipt
      month, MTTO by order month) accept an optional {from,to} window, so past months
      can be back-computed from real GRN/order dates even before snapshots began. Count
      KPIs that only describe "now" (open orders, overdue payments) are computed live
      and are not back-computable — they trend forward from first snapshot only. */
(function () {
  const toDate = v => {
    if (!v) return null;
    if (v.toDate) { try { return v.toDate(); } catch (_) { return null; } }
    const d = new Date(v); return isNaN(d) ? null : d;
  };
  const daysBetween = (a, b) => {
    const da = toDate(a), db = toDate(b);
    if (!da || !db) return null;
    return Math.round((db - da) / 86400000);
  };
  const inWindow = (v, win) => {
    if (!win) return true;
    const d = toDate(v); if (!d) return false;
    if (win.from && d < toDate(win.from)) return false;
    if (win.to && d > toDate(win.to)) return false;
    return true;
  };
  const recE = o => (window.PXUtils ? window.PXUtils.recordEntity(o) : (o.entity || 'Phoenix'));

  // Average of a list, or null if empty (never NaN).
  const avg = (sum, count) => count ? +(sum / count).toFixed(1) : null;

  /* Compute the full KPI object for an entity.
     opts.window = {from,to} restricts the date-bucketable KPIs (OTIF, MTTO, lateness,
     clearance) to records whose key date falls in the window. Count KPIs ignore the
     window (they are point-in-time) unless opts.pointInTime is false for a pure
     historical computation, in which case they are omitted. */
  function compute(entity, opts) {
    opts = opts || {};
    const win = opts.window || null;
    const st = window.__state;
    if (!st) return {};
    const orders = (st.data.orders || []).filter(o => !o.archived && recE(o) === entity);
    const ships = (st.data.shipments || []).filter(s => !s.archived && recE(s) === entity);
    const pays = (st.data.payments || []).filter(p => !p.archived && recE(p) === entity);
    const now = new Date();

    // --- OTIF (order level): closed orders received on/before requested date ---
    // Receipt path is driven by the evidence on the order, not by tangible/intangible.
    // Foreign tangible orders normally receive through shipments. Local tangible orders
    // normally receive through order-level GRNs, but can also have an exceptional
    // shipment. Shipment receipt date = deliveryDate, with GRN date as fallback.
    const grnCounts = r => {
      const st = String(r?.status || '').toLowerCase();
      return st !== 'pending' && st !== 'cancelled' && !!(r?.grnDate || r?.actualReceiptDate || r?.grnRef || r?.grnNumber);
    };
    const shipmentMatchesReceipt = (s, r) => r?.shipmentId && (String(r.shipmentId) === String(s.id || '') || String(r.shipmentId) === String(s.shipmentId || ''));
    const shipmentReceiptDate = (o, s) => {
      const linkedGrns = (Array.isArray(o.receipts) ? o.receipts : []).filter(r => shipmentMatchesReceipt(s, r) && grnCounts(r));
      const linkedDates = linkedGrns.map(r => toDate(r.actualReceiptDate) || toDate(r.grnDate)).filter(Boolean);
      return toDate(s.deliveryDate)
        || (linkedDates.length ? new Date(Math.max(...linkedDates.map(d => d.getTime()))) : null)
        || toDate(s.grnDate)
        || null;
    };
    const trueReceiptDatesForOrder = (o, linkedShips) => {
      const dates = [];
      // Order-level controlled receipts (GRNs): normal path for local orders and
      // service/works orders; also valid as a fallback if a receipt was not linked.
      (Array.isArray(o.receipts) ? o.receipts : []).forEach(r => {
        if (!grnCounts(r) || r.shipmentId) return;
        const d = toDate(r.actualReceiptDate) || toDate(r.grnDate);
        if (d) dates.push(d);
      });
      linkedShips.forEach(s => {
        const d = shipmentReceiptDate(o, s);
        if (d) dates.push(d);
      });
      return dates;
    };
    const orderIsFullyReceived = (o, linkedShips) => {
      const hasOrderGrn = (Array.isArray(o.receipts) ? o.receipts : [])
        .some(r => !r.shipmentId && grnCounts(r) && (r.actualReceiptDate || r.grnDate));
      if (linkedShips.length) {
        return linkedShips.every(s => shipmentReceiptDate(o, s)) || hasOrderGrn;
      }
      return hasOrderGrn;
    };

    let otifEligible = 0, otifOnTime = 0;
    orders.filter(o => o.isClosed && o.requestedReceiptDate).forEach(o => {
      const linked = ships.filter(s => s.orderId === o.orderId || (s.orderId && o.orderId && s.orderId.startsWith(o.orderId)));
      if (!orderIsFullyReceived(o, linked)) {
        if (!win) otifEligible++;   // known-but-incomplete counts against OTIF (no window only)
        return;
      }
      const dates = trueReceiptDatesForOrder(o, linked).map(d => d.getTime());
      if (!dates.length) return;
      const latestReceipt = new Date(Math.max(...dates));   // "in full" = last piece in
      if (win && !inWindow(latestReceipt, win)) return;
      const req = toDate(o.requestedReceiptDate);
      if (!req) return;
      otifEligible++;
      if (latestReceipt <= req) otifOnTime++;
    });
    const otifPct = otifEligible > 0 ? Math.round((otifOnTime / otifEligible) * 100) : null;

    // --- MTTO: IPR approved → order date (bucketed by order date) ---
    let mttoSum = 0, mttoN = 0;
    orders.forEach(o => {
      if (!o.iprApprovedDate || !o.dateOfOrder) return;
      if (win && !inWindow(o.dateOfOrder, win)) return;
      const d = daysBetween(o.iprApprovedDate, o.dateOfOrder);
      if (d !== null && d >= 0) { mttoSum += d; mttoN++; }
    });
    const mtto = avg(mttoSum, mttoN);

    // --- Shipment lateness (ETA → delivery/GRN) ---
    // Delivery date is preferred. GRN date remains the fallback when delivery date has
    // not been captured yet.
    let lateSum = 0, lateN = 0;
    ships.forEach(s => {
      const order = orders.find(o => o.orderId === s.orderId);
      const received = order ? shipmentReceiptDate(order, s) : (s.deliveryDate || s.grnDate);
      if (!s.eta || !received) return;
      if (win && !inWindow(received, win)) return;
      const d = daysBetween(s.eta, received);
      if (d !== null) { lateSum += d; lateN++; }
    });
    const avgLateness = avg(lateSum, lateN);

    // --- Clearance time (docs to broker → clearance) bucketed by clearance date ---
    let clrSum = 0, clrN = 0;
    ships.forEach(s => {
      const clearance = s.clearanceDate || s.customsReleaseDate;
      if (!s.docsToBrokerDate || !clearance) return;
      if (win && !inWindow(clearance, win)) return;
      const d = daysBetween(s.docsToBrokerDate, clearance);
      if (d !== null) { clrSum += d; clrN++; }
    });
    const avgClearance = avg(clrSum, clrN);

    const out = {
      otifPct, otifSample: otifEligible, otifOnTime,
      mtto, mttoSample: mttoN,
      avgLateness, latenessSample: lateN,
      avgClearance, clearanceSample: clrN
    };

    // --- Point-in-time counts (only meaningful "as of now"; omitted for windowed/historical) ---
    if (!win) {
      out.openForeign = orders.filter(o => o.orderType === 'foreign' && !o.isClosed).length;
      out.openLocal = orders.filter(o => o.orderType === 'local' && !o.isClosed).length;
      out.openOrders = out.openForeign + out.openLocal;
      out.overduePayments = pays.filter(p => {
        if (['paid', 'rejected'].includes(p.status)) return false;
        const d = toDate(p.dueDate); return d && d < now;
      }).length;
      const pf = window.PXProcFollowup;
      if (pf) {
        const dash = pf.dashboard(orders, pf.context());
        out.highRisk = dash.highRisk.length;
        out.criticalRisk = dash.criticalRisk.length;
        out.promiseOverdue = dash.promiseOverdue.length;
      }
    }
    return out;
  }

  // Build a YYYY-MM period key from a date.
  function periodKey(d) {
    const dt = toDate(d) || new Date();
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
  }
  // {from,to} ISO window covering a YYYY-MM period.
  function periodWindow(period) {
    const [y, m] = period.split('-').map(Number);
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 0, 23, 59, 59, 999);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  // KPI metadata: label, whether "up is good", and whether it can be back-computed.
  const META = {
    otifPct:        { label: 'OTIF %',                upGood: true,  unit: '%',    backfill: true },
    avgLateness:    { label: 'Shipment lateness',     upGood: false, unit: 'days', backfill: true },
    avgClearance:   { label: 'Avg clearance',         upGood: false, unit: 'days', backfill: true },
    mtto:           { label: 'MTTO',                  upGood: false, unit: 'days', backfill: true },
    overduePayments:{ label: 'Overdue payments',      upGood: false, unit: '',     backfill: false },
    openOrders:     { label: 'Open orders',           upGood: null,  unit: '',     backfill: false },
    highRisk:       { label: 'High-risk orders',      upGood: false, unit: '',     backfill: false }
  };

  window.PXKpi = { compute, periodKey, periodWindow, META };
})();
