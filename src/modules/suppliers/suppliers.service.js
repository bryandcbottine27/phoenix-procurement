/* suppliers.service.js
   Supplier writes are handled in suppliers.form.js via PXStore.
   This module owns the COMPUTED supplier-performance metrics (Phoenix-owned,
   nothing stored — always reflects current data). Moved here from core.js in the
   cleanup pass so supplier logic lives with the supplier module.

   Exposed as window.PXUtils.computeSupplierPerformance so the render/form files
   (separate module scopes) keep working unchanged. */
(function () {
  const norm = value => (value == null ? '' : String(value)).trim().toLowerCase();

  function resolveSupplier(supplierRef) {
    if (supplierRef && typeof supplierRef === 'object') return supplierRef;
    const key = norm(supplierRef);
    return (window.__state.data.suppliers || []).find(s => !s.archived &&
      (norm(s.id) === key || norm(s.name) === key || norm(s.legalName) === key)) || { name: supplierRef || '' };
  }

  // Uses supplierId when present, with a name/legal-name/alias fallback for legacy
  // orders that were created before stable supplier links were introduced.
  function computeSupplierPerformance(supplierRef, opts = {}) {
    const st = window.__state;
    const supplier = resolveSupplier(supplierRef);
    const supplierId = supplier.id || null;
    const names = new Set([supplier.name, supplier.legalName, ...(supplier.aliases || [])].map(norm).filter(Boolean));
    const entity = opts.entity || '';
    const from = opts.from ? new Date(opts.from) : null;
    const to = opts.to ? new Date(opts.to) : null;
    if (from) from.setHours(0, 0, 0, 0);
    if (to) to.setHours(23, 59, 59, 999);
    const entityOf = record => record && (record.entity || 'Phoenix');
    const inEntity = record => !entity || entityOf(record) === entity;
    const matchName = value => names.has(norm(value));
    const matchesOrder = order => inEntity(order) &&
      ((supplierId && order.supplierId === supplierId) || (!order.supplierId && matchName(order.supplier)));
    const inPeriod = value => { const date = value?.toDate ? value.toDate() : (value ? new Date(value) : null); return (!from || (date && date >= from)) && (!to || (date && date <= to)); };
    const orders = st.data.orders.filter(order => matchesOrder(order) && inPeriod(order.dateOfOrder));
    const orderKeys = new Set(orders.map(o => entityOf(o) + '|' + o.orderId));
    const belongsToOrder = record => orderKeys.has(entityOf(record) + '|' + record.orderId);
    const ships = st.data.shipments.filter(s => inEntity(s) && (belongsToOrder(s) || matchName(s.supplier)));
    const payments = st.data.payments.filter(p => inEntity(p) && (belongsToOrder(p) || matchName(p.supplier)));

    const daysBetweenLocal = (a, b) => {
      const da = a?.toDate ? a.toDate() : (a ? new Date(a) : null);
      const dbb = b?.toDate ? b.toDate() : (b ? new Date(b) : null);
      if (!da || !dbb || isNaN(da) || isNaN(dbb)) return null;
      return Math.round((dbb - da) / 86400000);
    };

    const totalOrders = orders.length;
    const openOrders = orders.filter(o => !o.isClosed).length;
    const closedOrders = orders.filter(o => o.isClosed).length;

    let lateOrders = 0, delaySum = 0, delayCount = 0, leadSum = 0, leadCount = 0, onTimeDeliveries = 0;
    ships.forEach(s => {
      if (s.eta && s.grnDate) {
        const d = daysBetweenLocal(s.eta, s.grnDate);
        if (d !== null) { if (d > 0) { lateOrders++; delaySum += d; } else onTimeDeliveries++; delayCount++; }
      }
      const ord = orders.find(o => entityOf(o) === entityOf(s) && o.orderId === s.orderId);
      if (ord && ord.dateOfOrder && s.grnDate) {
        const lt = daysBetweenLocal(ord.dateOfOrder, s.grnDate);
        if (lt !== null && lt >= 0) { leadSum += lt; leadCount++; }
      }
    });
    const avgDeliveryDelay = delayCount ? Math.round(delaySum / delayCount) : null;
    const avgLeadTime = leadCount ? Math.round(leadSum / leadCount) : null;

    const shipDocIds = new Set(ships.map(s => s.id));
    const openShipmentIssues = st.data.issues.filter(i => !i.archived && i.status === 'open' &&
      (shipDocIds.has(i.shipmentDocId) || shipDocIds.has(i.relatedId))).length;
    const orderDocIds = new Set(orders.map(o => o.id));
    const payDocIds = new Set(payments.map(p => p.id));
    const docIssues = st.data.documents.filter(d => !d.archived && (d.status === 'rejected') &&
      ((d.relatedType === 'shipment' && shipDocIds.has(d.relatedId)) ||
       (d.relatedType === 'order' && orderDocIds.has(d.relatedId)) ||
       (d.relatedType === 'payment' && payDocIds.has(d.relatedId)))).length;
    const today = new Date(); today.setHours(0,0,0,0);
    const overdueRfps = payments.filter(p => {
      if (['paid','rejected','cancelled'].includes(p.status)) return false;
      const dd = p.dueDate?.toDate ? p.dueDate.toDate() : (p.dueDate ? new Date(p.dueDate) : null);
      return dd && !isNaN(dd) && dd < today;
    }).length;
    const paymentIssues = overdueRfps;
    const deliveryScore = delayCount ? Math.round((onTimeDeliveries / delayCount) * 100) : null;
    const issueScore = totalOrders ? Math.max(0, 100 - Math.round((openShipmentIssues / totalOrders) * 100)) : null;
    const paymentScore = totalOrders ? Math.max(0, 100 - Math.round((paymentIssues / totalOrders) * 100)) : null;
    const scoreInputs = [deliveryScore, issueScore, paymentScore].filter(value => value != null);
    const overallScore = scoreInputs.length ? Math.round(scoreInputs.reduce((sum, value) => sum + value, 0) / scoreInputs.length) : null;

    const termsCount = {};
    orders.forEach(o => { if (o.paymentTerms) termsCount[o.paymentTerms] = (termsCount[o.paymentTerms]||0)+1; });
    const usualTerms = Object.entries(termsCount).sort((a,b)=>b[1]-a[1])[0]?.[0] || '—';

    const openValueByCurrency = {};
    orders.filter(o => !o.isClosed && o.amount && o.currency).forEach(o => {
      openValueByCurrency[o.currency] = (openValueByCurrency[o.currency]||0) + Number(o.amount);
    });

    return {
      totalOrders, openOrders, closedOrders, lateOrders,
      avgDeliveryDelay, avgLeadTime,
      openShipmentIssues, docIssues, paymentIssues, overdueRfps,
      usualTerms, openValueByCurrency,
      completedDeliveries: delayCount, onTimeDeliveries, deliveryScore, issueScore, paymentScore, overallScore
    };
  }

  // Keep existing call sites working: they read it from PXUtils.
  if (window.PXUtils) window.PXUtils.computeSupplierPerformance = computeSupplierPerformance;
  window.__sup_computeSupplierPerformance = computeSupplierPerformance;

  /* ============================================================
     SUPPLIER ↔ ERP VENDOR MAPPING resolver (Feature 2)
     ============================================================
     Resolves a supplier from an ERP vendor number per entity/source, with a
     name/alias/legal-name fallback so manual matching always remains possible.
     Read-only over state.data.suppliers; never writes. */
  const _norm = v => (v == null ? '' : String(v)).trim().toLowerCase();
  const asDate = value => {
    if (!value) return null;
    if (value.toDate) return value.toDate();
    if (typeof value === 'object' && value.seconds != null) return new Date(value.seconds * 1000);
    const date = new Date(value);
    return isNaN(date) ? null : date;
  };

  function mappingIsEffective(mapping, asOf) {
    const date = asDate(asOf) || new Date();
    date.setHours(0, 0, 0, 0);
    const from = asDate(mapping && mapping.effectiveFrom);
    const to = asDate(mapping && mapping.effectiveTo);
    if (from) { from.setHours(0, 0, 0, 0); if (date < from) return false; }
    if (to) { to.setHours(0, 0, 0, 0); if (date > to) return false; }
    return true;
  }

  // Active vendor number for a supplier within an entity (optionally a source).
  function vendorNoFor(supplier, entity, erpSource, asOf) {
    if (!supplier || !Array.isArray(supplier.erpMappings)) return null;
    const m = supplier.erpMappings.find(x => x && x.active !== false &&
      _norm(x.entity) === _norm(entity) &&
      (!erpSource || _norm(x.erpSource) === _norm(erpSource)) && mappingIsEffective(x, asOf) && x.vendorNo);
    return m ? m.vendorNo : null;
  }

  // Supplier whose mapping matches this vendor number within an entity.
  function findByVendor(vendorNo, entity, erpSource, asOf) {
    const vn = _norm(vendorNo); if (!vn) return null;
    return (window.__state.data.suppliers || []).find(s => !s.archived && Array.isArray(s.erpMappings) &&
      s.erpMappings.some(x => x && x.active !== false && _norm(x.vendorNo) === vn &&
        (!entity || _norm(x.entity) === _norm(entity)) &&
        (!erpSource || _norm(x.erpSource) === _norm(erpSource)) && mappingIsEffective(x, asOf))) || null;
  }

  // Best-effort match: vendor number (strongest) → exact name/legal name → alias.
  // Returns { supplier, method } or null. Used by import & reconciliation; callers
  // may still override manually for exceptions.
  function matchSupplier({ name, vendorNo, entity, erpSource, source, asOf } = {}) {
    const resolvedSource = erpSource || source; // source retained as a friendly alias for integrations.
    if (vendorNo) { const byV = findByVendor(vendorNo, entity, resolvedSource, asOf); if (byV) return { supplier: byV, method: 'vendorNo' }; }
    const n = _norm(name);
    if (n) {
      const list = (window.__state.data.suppliers || []).filter(s => !s.archived);
      const exact = list.find(s => _norm(s.name) === n || _norm(s.legalName) === n);
      if (exact) return { supplier: exact, method: 'name' };
      const byAlias = list.find(s => Array.isArray(s.aliases) && s.aliases.some(a => _norm(a) === n));
      if (byAlias) return { supplier: byAlias, method: 'alias' };
    }
    return null;
  }

  // Live master-data worklist for imported ERP vendors that still lack a
  // supplierId. It groups by the stable vendor code per entity/source rather
  // than by display name, so a spelling variation does not create a second task.
  function unmappedImportVendors() {
    const groups = new Map();
    (window.__state.data.orders || []).forEach(order => {
      if (order.archived || order.supplierId || !order.erpVendorNo || !order.erpSource || order.erpSource === 'Manual') return;
      const entity = order.entity || 'Phoenix';
      const erpSource = order.erpSource;
      const vendorNo = String(order.erpVendorNo).trim();
      if (!vendorNo) return;
      const key = [_norm(entity), _norm(erpSource), _norm(vendorNo)].join('|');
      let group = groups.get(key);
      if (!group) {
        group = {
          key, entity, erpSource, vendorNo,
          vendorName: order.erpVendorName || order.supplier || '—',
          orderDocIds: [], orderIds: []
        };
        groups.set(key, group);
      }
      if (group.vendorName === '—' && (order.erpVendorName || order.supplier)) group.vendorName = order.erpVendorName || order.supplier;
      group.orderDocIds.push(order.id);
      group.orderIds.push(order.orderId || '—');
    });
    return [...groups.values()]
      .map(group => ({ ...group, mappedSupplier: findByVendor(group.vendorNo, group.entity, group.erpSource) }))
      .sort((a, b) => b.orderDocIds.length - a.orderDocIds.length || a.vendorName.localeCompare(b.vendorName));
  }

  window.PXSupplierMap = { vendorNoFor, findByVendor, matchSupplier, unmappedImportVendors, mappingIsEffective };
})();
