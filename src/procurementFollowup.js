/* ============================================================
   PXProcFollowup — procurement follow-up control layer
   ============================================================
   Pure calculation helpers for supplier commitments, chase planning,
   order ageing, risk scoring, and ERP/Data Warehouse exceptions.
   The module does not write data; screens use it to display actions,
   reports, badges, and dashboards across all entities. */
(function () {
  const px = () => window.PXUtils || {};
  const stateData = () => window.__state?.data || {};

  const CONTROL_LABELS = [
    'Supplier acknowledgement SLA',
    'Supplier promised date',
    'Supplier revised promise',
    'Promise revision count',
    'Next supplier chase',
    'No recent order activity',
    'Requested receipt risk',
    'Ready goods without shipment',
    'Shipment ETA / ETD discipline',
    'Clearance readiness',
    'Released cargo delivery / GRN',
    'Payment milestone / RFP exposure',
    'ERP / Data Warehouse exceptions',
    'Supplier master mapping',
    'Closure blockers / overall risk'
  ];

  function context(extra = {}) {
    const data = stateData();
    return {
      orders: data.orders || [],
      shipments: data.shipments || [],
      payments: data.payments || [],
      documents: data.documents || [],
      followups: data.followups || [],
      issues: data.issues || [],
      suppliers: data.suppliers || [],
      now: new Date(),
      ...extra
    };
  }

  function asDate(value) {
    if (!value) return null;
    if (value.toDate) {
      try { return value.toDate(); } catch (_) { return null; }
    }
    if (value.seconds != null) return new Date(value.seconds * 1000);
    if (value instanceof Date) return isNaN(value) ? null : value;
    const d = new Date(value);
    return isNaN(d) ? null : d;
  }

  function dateStart(value) {
    const d = asDate(value);
    if (!d) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function entityOfOrder(order) {
    const u = px();
    return u.recordEntity ? u.recordEntity(order || {}) : (order?.entity || 'Phoenix');
  }

  // Single ageing definition across the app: always use the shared working-day
  // helpers (weekend/holiday aware, defined in dataQuality.js and exposed on PXUtils).
  // If they are somehow unavailable (module load failure) we return null ("unknown")
  // rather than a raw calendar-day count that would silently disagree with every other
  // ageing figure — all callers already treat null as "skip this check".
  function workingSince(value, entity) {
    const u = px();
    return u.workingDaysSince ? u.workingDaysSince(value, entity) : null;
  }

  function workingUntil(value, entity) {
    const u = px();
    return u.workingDaysUntil ? u.workingDaysUntil(value, entity) : null;
  }

  function isClosed(order) {
    return !!order?.isClosed || /closed|cancel/i.test(String(order?.status || ''));
  }

  function needsShipment(order) {
    const u = px();
    return u.orderNeedsShipment ? u.orderNeedsShipment(order) : (order?.orderType === 'foreign' && !order?.noShipment);
  }

  function linkedShipments(order, ctx = context()) {
    if (!order?.orderId) return [];
    return (ctx.shipments || []).filter(s => !s.archived &&
      (s.orderId === order.orderId || (s.orderId && String(s.orderId).startsWith(order.orderId))));
  }

  function linkedPayments(order, ctx = context()) {
    if (!order?.orderId) return [];
    return (ctx.payments || []).filter(p => !p.archived && p.orderId === order.orderId);
  }

  function linkedFollowups(order, ctx = context()) {
    if (!order?.id) return [];
    return (ctx.followups || []).filter(f => !f.archived && f.relatedType === 'order' && f.relatedId === order.id);
  }

  function linkedIssues(order, ctx = context()) {
    if (!order?.id) return [];
    const ships = new Set(linkedShipments(order, ctx).map(s => s.id));
    return (ctx.issues || []).filter(i => !i.archived &&
      ((i.relatedType === 'order' && i.relatedId === order.id) ||
       (i.relatedType === 'shipment' && ships.has(i.relatedId))));
  }

  // Single source of truth for "does this receipt count as a GRN?" is
  // window.PXReceiptControl.grnCountsAsReceipt (orders.service.js). This module
  // loads BEFORE orders.service.js, so we must delegate at CALL time (renders
  // happen long after all modules load), never at module-load time. The inline
  // branch is a load-order safety net only and must mirror the canonical rule.
  function grnCountsAsReceipt(receipt) {
    const rc = window.PXReceiptControl;
    if (rc && typeof rc.grnCountsAsReceipt === 'function') return rc.grnCountsAsReceipt(receipt);
    const status = String(receipt?.status || '').trim().toLowerCase();
    return status !== 'pending' && status !== 'cancelled' && !!(receipt?.grnDate || receipt?.actualReceiptDate || receipt?.grnRef || receipt?.grnNumber);
  }

  function latestDateEntry(entries) {
    return entries
      .map(item => ({ ...item, date: asDate(item.date) }))
      .filter(item => item.date)
      .sort((a, b) => b.date - a.date)[0] || null;
  }

  function lastActivity(order, ctx = context()) {
    const entries = [
      { label: 'Order updated', date: order?.updatedAt },
      { label: 'Order created', date: order?.createdAt },
      { label: 'PO sent', date: order?.orderSentToSupplierDate },
      { label: 'Acknowledged', date: order?.orderAcknowledgedDate },
      { label: 'Ready date', date: order?.orderReadyDate },
      { label: 'Last supplier follow-up', date: order?.lastSupplierFollowupDate }
    ];
    linkedShipments(order, ctx).forEach(s => entries.push(
      { label: 'Shipment updated', date: s.updatedAt },
      { label: 'ETA', date: s.eta },
      { label: 'Delivery', date: s.deliveryDate },
      { label: 'GRN', date: s.grnDate }
    ));
    (order.receipts || []).filter(grnCountsAsReceipt).forEach(r => entries.push(
      { label: 'GRN recorded', date: r.actualReceiptDate || r.grnDate || r.recordedAt }
    ));
    linkedPayments(order, ctx).forEach(p => entries.push(
      { label: 'Payment updated', date: p.updatedAt },
      { label: 'Payment requested', date: p.requestDate },
      { label: 'Payment due', date: p.dueDate },
      { label: 'Paid', date: p.paidDate || p.iblValueDate }
    ));
    linkedFollowups(order, ctx).forEach(f => entries.push(
      { label: 'Follow-up logged', date: f.updatedAt || f.completedAt || f.createdAt },
      { label: 'Follow-up due', date: f.nextActionDueDate }
    ));
    linkedIssues(order, ctx).forEach(i => entries.push(
      { label: 'Issue updated', date: i.updatedAt || i.openedDate || i.createdAt },
      { label: 'Issue resolved', date: i.resolvedDate }
    ));
    return latestDateEntry(entries);
  }

  function commitmentDate(order) {
    return asDate(order?.supplierRevisedPromisedDate) || asDate(order?.supplierPromisedDate) || asDate(order?.orderReadyDate) || null;
  }

  function commitment(order, ctx = context()) {
    const entity = entityOfOrder(order);
    const promised = asDate(order?.supplierPromisedDate);
    const revised = asDate(order?.supplierRevisedPromisedDate);
    const current = revised || promised;
    const days = current ? workingUntil(current, entity) : null;
    const revisions = Number(order?.supplierPromiseRevisionCount || 0);
    const overdue = days !== null && days < 0 && !isClosed(order);
    return {
      promised,
      revised,
      current,
      daysUntil: days,
      overdue,
      revisions,
      delayReason: order?.supplierDelayReason || '',
      reply: order?.supplierReplySummary || '',
      label: current ? (revised ? 'Revised promise' : 'Supplier promise') : 'No supplier promise'
    };
  }

  function nextChase(order) {
    const entity = entityOfOrder(order);
    const next = asDate(order?.nextSupplierFollowupDate);
    const last = asDate(order?.lastSupplierFollowupDate);
    const days = next ? workingUntil(next, entity) : null;
    return {
      next,
      last,
      daysUntil: days,
      overdue: days !== null && days < 0 && !isClosed(order),
      dueSoon: days !== null && days >= 0 && days <= 3 && !isClosed(order),
      method: order?.followupMethod || '',
      frequencyDays: Number(order?.followupFrequencyDays || 0) || null
    };
  }

  function paymentExposure(order, ctx = context()) {
    const today = dateStart(ctx.now || new Date());
    const payments = linkedPayments(order, ctx);
    const milestones = Array.isArray(order?.milestones) ? order.milestones : [];
    const pendingPayments = payments.filter(p => !['paid', 'rejected'].includes(String(p.status || '').toLowerCase()) && !p.isPaid);
    const overduePayments = pendingPayments.filter(p => {
      const d = dateStart(p.dueDate);
      return d && d < today;
    });
    const pendingMilestones = milestones.filter(m => !m.paidDate && !m.rfpRef);
    return { pendingPayments, overduePayments, pendingMilestones };
  }

  function ageingBucket(order, ctx = context()) {
    if (isClosed(order)) return { key: 'closed', label: 'Closed', cls: 'success', rank: 99 };
    const ships = linkedShipments(order, ctx);
    const activeShips = ships.filter(s => !(s.completed || s.stage === 'completed'));
    const anyReceipt = ships.some(s => s.grnDate || s.deliveryDate) || (order.receipts || []).some(grnCountsAsReceipt);
    const pay = paymentExposure(order, ctx);

    if (!order.orderSentToSupplierDate) return { key: 'not_sent', label: 'Not sent to supplier', cls: 'warn', rank: 1 };
    if (!order.orderAcknowledgedDate) return { key: 'sent_no_ack', label: 'Sent, awaiting acknowledgement', cls: 'warn', rank: 2 };
    if (needsShipment(order) && !order.orderReadyDate) return { key: 'ack_no_ready', label: 'Acknowledged, awaiting ready date', cls: 'accent', rank: 3 };
    if (needsShipment(order) && order.orderReadyDate && !ships.length) return { key: 'ready_no_shipment', label: 'Ready, shipment not requested', cls: 'warn', rank: 4 };
    if (needsShipment(order) && activeShips.length) {
      const underClearance = activeShips.some(s => /clearance/i.test(String(s.status || s.clearanceStatus || '')));
      if (underClearance) return { key: 'under_clearance', label: 'Under clearance', cls: 'info', rank: 5 };
      return { key: 'shipment_in_progress', label: 'Shipment in progress', cls: 'info', rank: 5 };
    }
    if (needsShipment(order) && ships.length && !anyReceipt) return { key: 'awaiting_receipt', label: 'Awaiting receipt / GRN', cls: 'accent', rank: 6 };
    if (pay.overduePayments.length) return { key: 'payment_overdue', label: 'Payment overdue', cls: 'danger', rank: 7 };
    if (pay.pendingPayments.length || pay.pendingMilestones.length) return { key: 'payment_pending', label: 'Payment follow-up', cls: 'accent', rank: 8 };
    return { key: 'open_followup', label: 'Open follow-up', cls: 'neutral', rank: 9 };
  }

  function erpExceptions(order) {
    const issues = [];
    const u = px();
    const isErp = u.isErpOrder ? u.isErpOrder(order) : !!(order?.erpSource && order.erpSource !== 'Manual');
    if (!order) return issues;
    if (isErp) {
      const entity = entityOfOrder(order);
      const syncAge = workingSince(order.erpLastSyncedAt || order.warehouseLoadedAt, entity);
      if (!order.erpLastSyncedAt && !order.warehouseLoadedAt) {
        issues.push({ key: 'sync-missing', level: 'warn', msg: 'ERP/DW order has no sync/load timestamp.' });
      } else if (syncAge !== null && syncAge > 3) {
        issues.push({ key: 'sync-stale', level: 'warn', msg: `ERP/DW data is ${syncAge} working day(s) old.` });
      }
      if (order.erpSyncStatus === 'error') issues.push({ key: 'sync-error', level: 'danger', msg: order.erpSyncError || 'ERP/DW sync error recorded.' });
      if (['Closed', 'Cancelled'].includes(order.erpPoStatus) && !order.isClosed) {
        issues.push({ key: 'erp-closed-phoenix-open', level: 'warn', msg: `ERP PO is ${order.erpPoStatus} but Phoenix order is open.` });
      }
      if (order.isClosed && order.erpPoStatus && !['Closed', 'Cancelled'].includes(order.erpPoStatus)) {
        issues.push({ key: 'phoenix-closed-erp-open', level: 'warn', msg: `Phoenix order is closed but ERP status is ${order.erpPoStatus}.` });
      }
      if (order.erpVendorNo && (!order.supplierId || order.supplierMatchMethod === 'unmatched')) {
        issues.push({ key: 'supplier-unmapped', level: 'warn', msg: 'ERP vendor is not mapped to the Phoenix supplier master.' });
      }
      if (order.erpVendorName && order.supplier && String(order.erpVendorName).trim().toLowerCase() !== String(order.supplier).trim().toLowerCase()) {
        issues.push({ key: 'supplier-mismatch', level: 'warn', msg: 'ERP vendor name differs from Phoenix supplier name.' });
      }
      if (order.erpAmount != null && order.amount != null && Math.abs(Number(order.erpAmount) - Number(order.amount)) > 0.01) {
        issues.push({ key: 'amount-mismatch', level: 'warn', msg: 'ERP amount differs from Phoenix amount.' });
      }
      if (order.erpCurrency && order.currency && String(order.erpCurrency).toUpperCase() !== String(order.currency).toUpperCase()) {
        issues.push({ key: 'currency-mismatch', level: 'warn', msg: 'ERP currency differs from Phoenix currency.' });
      }
    } else if (!order.erpSource || order.erpSource === 'Manual') {
      if (order.integrationLayer && !['manual', 'excel-import'].includes(order.integrationLayer)) {
        issues.push({ key: 'manual-with-integration', level: 'info', msg: 'Manual order carries integration metadata; verify source.' });
      }
    }
    return issues;
  }

  function orderChecks(order, ctx = context()) {
    const entity = entityOfOrder(order);
    const checks = [];
    const add = (key, level, msg, points) => checks.push({ key, level, msg, points: points || 0 });
    const dq = window.PXUtils?.dataQualityThresholds || {};
    const ships = linkedShipments(order, ctx);
    const activeShips = ships.filter(s => !(s.completed || s.stage === 'completed'));
    const issues = linkedIssues(order, ctx).filter(i => i.status === 'open');
    const c = commitment(order, ctx);
    const chase = nextChase(order);
    const pay = paymentExposure(order, ctx);

    const ackAge = workingSince(order.orderSentToSupplierDate, entity);
    if (!isClosed(order) && order.orderSentToSupplierDate && !order.orderAcknowledgedDate && ackAge !== null && ackAge > (dq.acknowledgementWorkingDays || 3)) {
      add('acknowledgement-overdue', 'warn', `Supplier acknowledgement is overdue by ${ackAge} working day(s).`, 10);
    }
    if (!isClosed(order) && order.orderAcknowledgedDate && !c.current) {
      add('supplier-promise-missing', 'info', 'No supplier promised / revised commitment date is recorded.', 5);
    }
    if (c.overdue) add('supplier-promise-overdue', 'danger', `Supplier commitment date is ${Math.abs(c.daysUntil)} working day(s) overdue.`, 20);
    if (c.revisions > 3) add('promise-revised-often', 'warn', `Supplier commitment has been revised ${c.revisions} times.`, 12);
    if (chase.overdue) add('supplier-followup-overdue', 'danger', `Supplier follow-up is ${Math.abs(chase.daysUntil)} working day(s) overdue.`, 18);
    else if (chase.dueSoon) add('supplier-followup-due-soon', 'warn', `Supplier follow-up is due in ${chase.daysUntil} working day(s).`, 8);

    const activity = lastActivity(order, ctx);
    const activityAge = activity ? workingSince(activity.date, entity) : null;
    if (!isClosed(order) && order.orderSentToSupplierDate && activityAge !== null && activityAge > (dq.noFollowupWorkingDays || 5)) {
      add('no-recent-activity', 'warn', `No recorded order activity for ${activityAge} working day(s).`, 10);
    }

    const receiptDays = workingUntil(order.requestedReceiptDate, entity);
    if (!isClosed(order) && order.requestedReceiptDate) {
      const hasReceipt = ships.some(s => s.grnDate || s.deliveryDate) || (order.receipts || []).some(grnCountsAsReceipt);
      if (!hasReceipt && receiptDays !== null && receiptDays < 0) {
        add('requested-receipt-overdue', 'danger', `Requested receipt is ${Math.abs(receiptDays)} working day(s) overdue.`, 22);
      } else if (!hasReceipt && receiptDays !== null && receiptDays <= 7) {
        add('requested-receipt-approaching', 'warn', `Requested receipt is within ${receiptDays} working day(s).`, 8);
      }
    }

    const readyAge = workingSince(order.orderReadyDate, entity);
    const readyNoShipmentLimit = Number.isFinite(Number(dq.readyNoShipmentWorkingDays)) ? Number(dq.readyNoShipmentWorkingDays) : 2;
    if (!isClosed(order) && needsShipment(order) && order.orderReadyDate && !ships.length && readyAge !== null && readyAge > readyNoShipmentLimit) {
      add('ready-no-shipment', 'warn', `Goods are ready but no shipment has been requested (${readyAge} working day(s)).`, 15);
    }

    activeShips.forEach(s => {
      const etaDays = workingUntil(s.eta, entity);
      const openAge = workingSince(s.createdAt || s.requestedAt || s.bookingDate, entity);
      if (openAge !== null && openAge > 5 && !s.etd) add('shipment-open-no-etd', 'warn', `Shipment ${s.shipmentId || s.orderId} is open without ETD.`, 10);
      if (etaDays !== null && etaDays >= 0 && etaDays <= 7 && (!s.docsToBrokerDate || !s.clearanceOwner)) {
        add('eta-clearance-unprepared', 'warn', `Shipment ${s.shipmentId || s.orderId} ETA is approaching without clearance preparation.`, 10);
      }
      const releaseAge = workingSince(s.customsReleaseDate, entity);
      if (releaseAge !== null && releaseAge > 7 && !s.deliveryDate && !s.grnDate) {
        add('released-not-delivered', 'warn', `Shipment ${s.shipmentId || s.orderId} is released but not delivered / GRN recorded.`, 12);
      }
      const etaChanges = Array.isArray(s.etaChangeHistory) ? s.etaChangeHistory.length : 0;
      if (etaChanges > 3) add('eta-changed-repeatedly', 'warn', `Shipment ${s.shipmentId || s.orderId} ETA changed ${etaChanges} times.`, 8);
    });

    if (pay.overduePayments.length) add('payment-overdue', 'danger', `${pay.overduePayments.length} payment request(s) overdue.`, 12);
    if (pay.pendingMilestones.length) add('milestone-no-rfp', 'warn', `${pay.pendingMilestones.length} unpaid milestone(s) without RFP.`, 8);

    issues.forEach(i => {
      const sev = String(i.severity || '').toLowerCase();
      const targetDays = workingUntil(i.targetResolutionDate, entity);
      if (sev === 'critical' || sev === 'high') add('open-high-issue', 'danger', `Open ${sev} issue: ${i.issueType || 'exception'}.`, 18);
      else add('open-issue', 'warn', `Open issue: ${i.issueType || 'exception'}.`, 6);
      if (targetDays !== null && targetDays < 0) add('issue-overdue', 'danger', `Issue resolution target is ${Math.abs(targetDays)} working day(s) overdue.`, 20);
    });

    erpExceptions(order).forEach(e => add('erp-' + e.key, e.level, e.msg, e.level === 'danger' ? 15 : 8));
    if (isClosed(order) && (activeShips.length || pay.pendingPayments.length || issues.length)) {
      add('closed-with-open-work', 'danger', 'Order is closed while operational work remains open.', 25);
    }
    return checks;
  }

  function riskScore(order, ctx = context()) {
    const criticality = String(order?.orderCriticality || 'normal').toLowerCase();
    const checks = orderChecks(order, ctx);
    let score = checks.reduce((sum, item) => sum + (Number(item.points) || 0), 0);
    if (criticality === 'critical') score += 20;
    else if (criticality === 'high') score += 12;
    else if (criticality === 'low') score -= 5;
    const amount = Number(order?.amount || 0);
    if (amount >= 1000000) score += 10;
    else if (amount >= 500000) score += 5;
    score = Math.max(0, Math.min(100, Math.round(score)));
    const level = score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
    const cls = level === 'critical' ? 'danger' : level === 'high' ? 'warn' : level === 'medium' ? 'accent' : 'success';
    const reasons = checks
      .sort((a, b) => (b.points || 0) - (a.points || 0))
      .slice(0, 5)
      .map(item => item.msg);
    return { score, level, cls, reasons, checks };
  }

  function riskBadge(order, ctx = context()) {
    const u = px();
    const esc = u.escapeHtml || (v => String(v || ''));
    const r = riskScore(order, ctx);
    const title = r.reasons.length ? r.reasons.join(' | ') : 'No major follow-up risk';
    return `<span class="badge ${r.cls}" title="${esc(title)}">Risk ${esc(r.level)} ${r.score}</span>`;
  }

  function ageingBadge(order, ctx = context()) {
    const u = px();
    const esc = u.escapeHtml || (v => String(v || ''));
    const b = ageingBucket(order, ctx);
    return `<span class="badge ${b.cls}" title="Procurement ageing bucket">${esc(b.label)}</span>`;
  }

  function dashboard(orders, ctx = context()) {
    const open = (orders || []).filter(o => !o.archived && !isClosed(o));
    const rows = open.map(o => ({ order: o, risk: riskScore(o, ctx), bucket: ageingBucket(o, ctx), commitment: commitment(o, ctx), chase: nextChase(o), erp: erpExceptions(o) }));
    const highRisk = rows.filter(r => ['high', 'critical'].includes(r.risk.level));
    const criticalRisk = rows.filter(r => r.risk.level === 'critical');
    const followupsDue = rows.filter(r => r.chase.overdue || r.chase.dueSoon);
    const promiseOverdue = rows.filter(r => r.commitment.overdue);
    const erpExceptionRows = rows.filter(r => r.erp.length);
    const bucketCounts = {};
    rows.forEach(r => { bucketCounts[r.bucket.key] = (bucketCounts[r.bucket.key] || { ...r.bucket, count: 0 }); bucketCounts[r.bucket.key].count++; });
    const buckets = Object.values(bucketCounts).sort((a, b) => a.rank - b.rank);
    const topRisk = [...rows].sort((a, b) => b.risk.score - a.risk.score).slice(0, 10);
    return { rows, highRisk, criticalRisk, followupsDue, promiseOverdue, erpExceptionRows, buckets, topRisk };
  }

  function exportRow(order, ctx = context()) {
    const r = riskScore(order, ctx);
    const b = ageingBucket(order, ctx);
    const c = commitment(order, ctx);
    const chase = nextChase(order);
    return {
      riskLevel: r.level,
      riskScore: r.score,
      riskReasons: r.reasons.join('; '),
      ageingBucket: b.label,
      supplierPromiseDate: c.current,
      supplierPromiseOverdue: c.overdue ? 'Yes' : 'No',
      nextSupplierFollowupDate: chase.next,
      nextSupplierFollowupOverdue: chase.overdue ? 'Yes' : 'No',
      erpExceptionCount: erpExceptions(order).length
    };
  }

  window.PXProcFollowup = {
    CONTROL_LABELS,
    context,
    asDate,
    linkedShipments,
    linkedPayments,
    linkedFollowups,
    linkedIssues,
    lastActivity,
    commitmentDate,
    commitment,
    nextChase,
    paymentExposure,
    ageingBucket,
    ageingBadge,
    erpExceptions,
    orderChecks,
    riskScore,
    riskBadge,
    dashboard,
    exportRow
  };
})();
