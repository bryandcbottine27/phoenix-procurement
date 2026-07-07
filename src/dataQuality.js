/* ============================================================
   DATA QUALITY & RECORD HEALTH
   ============================================================
   Non-blocking operational controls. Findings are calculated from the live
   record graph and can be assigned as linked Issues in the Data Quality
   Cockpit. They never change ERP or operational data automatically. */
(function () {
  const DQ = {
    acknowledgementWorkingDays: 3,
    noFollowupWorkingDays: 5,
    readyNoShipmentWorkingDays: 2,
    receiptLookAheadWorkingDays: 7,
    shipmentEtdWorkingDays: 5,
    etaClearanceLookAheadWorkingDays: 7,
    portArrivalClearanceWorkingDays: 3,
    clearanceDelayWorkingDays: 5,
    releaseToDeliveryWorkingDays: 7,
    deliveryToGrnWorkingDays: 2,
    paymentDraftWorkingDays: 2,
    paymentDueLookAheadWorkingDays: 7,
    erpSyncWorkingDays: 3,
    etaChangeLimit: 3,
    supplierPatternIssueCount: 3,
    supplierPatternDays: 90
  };

  function asDate(value) {
    if (!value) return null;
    const date = value.toDate ? value.toDate() : (value instanceof Date ? value : new Date(value));
    return isNaN(date) ? null : date;
  }
  function dayStart(value) {
    const date = asDate(value);
    if (!date) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  }
  function dateKey(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = asDate(value);
    if (!date) return '';
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  function holidaysFor(entity) {
    const calendars = window.__state?.data?.businessCalendars || [];
    const calendar = calendars.find(item => item && item.entity === entity) || null;
    return new Set((calendar?.holidays || calendar?.holidayDates || []).map(item => dateKey(typeof item === 'string' ? item : item?.date)).filter(Boolean));
  }
  function isBusinessDay(date, entity) {
    return date.getDay() !== 0 && date.getDay() !== 6 && !holidaysFor(entity).has(dateKey(date));
  }
  // Positive means the target is in the future; negative means it is in the past.
  function workingDaysBetween(from, to, entity) {
    const start = dayStart(from), end = dayStart(to || new Date());
    if (!start || !end) return null;
    if (+start === +end) return 0;
    const forward = start < end;
    const low = forward ? start : end;
    const high = forward ? end : start;
    const cursor = new Date(low);
    let days = 0;
    while (cursor < high) {
      cursor.setDate(cursor.getDate() + 1);
      if (isBusinessDay(cursor, entity || window.PXUtils?.currentEntity?.() || 'Phoenix')) days += 1;
    }
    return forward ? days : -days;
  }
  function workingDaysSince(value, entity) { return workingDaysBetween(value, new Date(), entity); }
  function workingDaysUntil(value, entity) { return workingDaysBetween(new Date(), value, entity); }
  function isPast(value, entity) { const days = workingDaysUntil(value, entity); return days !== null && days < 0; }
  function hasValue(value) { return value !== null && value !== undefined && value !== ''; }
  function documentPresent(doc) {
    if (window.PXDocuments) return window.PXDocuments.isPresent(doc);
    return !!doc && (['received', 'approved'].includes(doc.status) || doc.fileData || doc.documentUrl || doc.url || doc.link);
  }
  function isCompletedShipment(shipment) { return shipment && (shipment.completed || shipment.stage === 'completed'); }
  function activeIssueFor(ctx, relatedType, relatedId) {
    return (ctx.issues || []).some(issue => !issue.archived && issue.status === 'open' && issue.relatedType === relatedType && issue.relatedId === relatedId);
  }
  function docCoverage(context, record, ctx) {
    const px = window.PXUtils || {};
    const expected = px.expectedDocsFor ? px.expectedDocsFor(context, record) : [];
    const present = (ctx.documents || []).filter(doc => !doc.archived && doc.relatedType === context && doc.relatedId === record.id)
      .filter(documentPresent)
      .map(doc => doc.documentType);
    return expected.filter(type => !present.includes(type));
  }
  function latestDate(values) {
    return values.map(asDate).filter(Boolean).sort((a, b) => b - a)[0] || null;
  }
  function grnCountsAsReceipt(receipt) {
    const status = String(receipt?.status || '').toLowerCase();
    return status !== 'pending' && status !== 'cancelled' && !!(receipt?.grnDate || receipt?.actualReceiptDate || receipt?.grnRef || receipt?.grnNumber);
  }
  function orderFunction(order, ctx) {
    if (order.function) return String(order.function).toLowerCase();
    if (ctx.orderFunction) return String(ctx.orderFunction(order) || '').toLowerCase();
    return '';
  }
  function orderNeedsShipment(order, ctx) {
    return ctx.orderNeedsShipment ? ctx.orderNeedsShipment(order) : (order.orderType === 'foreign' && !order.noShipment);
  }
  function linkedOrder(ctx, orderId) { return (ctx.orders || []).find(order => order.orderId === orderId) || null; }
  function sameText(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
  function sameAmount(a, b) { return Math.abs(Number(a) - Number(b)) < 0.01; }
  function milestoneDate(milestone, order, ctx) {
    if (ctx.computeMilestoneDate) return ctx.computeMilestoneDate(milestone, order, ctx.shipments || []) || milestone.expectedDateOverride || null;
    return milestone.expectedDate || milestone.expectedDateOverride || null;
  }
  function matchingSupplier(supplier, order) {
    return order && (order.supplierId === supplier.id || sameText(order.supplier, supplier.name) || sameText(order.supplier, supplier.legalName));
  }
  function stateContext() {
    const data = window.__state?.data || {};
    const px = window.PXUtils || {};
    return {
      orders: data.orders || [], shipments: data.shipments || [], payments: data.payments || [],
      documents: data.documents || [], followups: data.followups || [], issues: data.issues || [],
      businessCalendars: data.businessCalendars || [], entity: px.currentEntity ? px.currentEntity() : 'Phoenix',
      orderFunction: px.orderFunction, orderNeedsShipment: px.orderNeedsShipment,
      computeMilestoneDate: px.computeMilestoneDate
    };
  }

  // ----- Order data quality -----
  function orderDataQuality(order, ctx = {}) {
    const issues = [];
    const shipments = (ctx.shipments || []).filter(shipment => shipment.orderId === order.orderId);
    const payments = (ctx.payments || []).filter(payment => payment.orderId === order.orderId);
    const activeShipments = shipments.filter(shipment => !shipment.archived && !isCompletedShipment(shipment));
    const hasReceipt = shipments.some(shipment => !shipment.archived && (shipment.grnDate || shipment.deliveryDate)) || (order.receipts || []).some(grnCountsAsReceipt);
    const isForeignGoods = orderNeedsShipment(order, ctx);
    const entity = order.entity || ctx.entity || 'Phoenix';

    if (!order.requestedReceiptDate) issues.push({ key: 'order-missing-requested-receipt-date', level: 'warn', msg: 'No requested receipt date (OTIF cannot be measured).' });
    if (order.orderType === 'foreign' && !order.paymentTerms) issues.push({ key: 'order-foreign-missing-payment-terms', level: 'warn', msg: 'Foreign order has no payment terms set.' });
    if (!order.iprApprovedDate) issues.push({ key: 'order-missing-ipr-approved-date', level: 'info', msg: 'No IPR HOD approved date (MTTO cannot be measured).' });
    if (!order.supplier) issues.push({ key: 'order-missing-supplier', level: 'warn', msg: 'No supplier recorded.' });
    if (!order.officerCode && !order.isClosed) issues.push({ key: 'order-missing-purchasing-officer', level: 'warn', msg: 'Open order has no purchasing officer assigned.' });

    const sentAge = workingDaysSince(order.orderSentToSupplierDate, entity);
    if (!order.isClosed && order.orderSentToSupplierDate && !order.orderAcknowledgedDate && sentAge !== null && sentAge > DQ.acknowledgementWorkingDays) {
      issues.push({ key: 'order-sent-not-acknowledged', level: 'warn', msg: `PO was sent more than ${DQ.acknowledgementWorkingDays} working days ago without supplier acknowledgement.` });
    }
    if (!order.isClosed && isForeignGoods && order.orderAcknowledgedDate && !order.orderReadyDate) {
      issues.push({ key: 'order-acknowledged-missing-ready-date', level: 'warn', msg: 'Supplier acknowledged the PO but no order-ready date is recorded.' });
    }
    const receiptDays = workingDaysUntil(order.requestedReceiptDate, entity);
    if (!order.isClosed && order.requestedReceiptDate && !hasReceipt) {
      if (receiptDays !== null && receiptDays < 0) issues.push({ key: 'order-requested-receipt-overdue', level: 'danger', msg: `Requested receipt is ${Math.abs(receiptDays)} working day(s) overdue with no receipt recorded.` });
      else if (receiptDays !== null && receiptDays <= DQ.receiptLookAheadWorkingDays) issues.push({ key: 'order-requested-receipt-approaching', level: 'warn', msg: `Requested receipt is within ${DQ.receiptLookAheadWorkingDays} working days with no receipt recorded.` });
    }
    const readyAge = workingDaysSince(order.orderReadyDate, entity);
    if (!order.isClosed && isForeignGoods && order.orderReadyDate && activeShipments.length === 0 && readyAge !== null && readyAge > DQ.readyNoShipmentWorkingDays) {
      issues.push({ key: 'order-ready-no-shipment', level: 'warn', msg: 'Goods are ready but no active shipment has been created.' });
    }

    if (!order.isClosed && order.orderSentToSupplierDate) {
      const followupDates = (ctx.followups || []).filter(followup => !followup.archived && followup.relatedType === 'order' && followup.relatedId === order.id)
        .flatMap(followup => [followup.createdAt, followup.updatedAt, followup.completedAt]);
      const issueDates = (ctx.issues || []).filter(issue => !issue.archived && issue.relatedType === 'order' && issue.relatedId === order.id)
        .flatMap(issue => [issue.openedDate, issue.resolvedDate, issue.updatedAt]);
      const lastActivity = latestDate([order.updatedAt, order.createdAt, order.orderSentToSupplierDate, ...followupDates, ...issueDates]);
      const activityAge = workingDaysSince(lastActivity, entity);
      if (activityAge !== null && activityAge > DQ.noFollowupWorkingDays) {
        issues.push({ key: 'order-no-recent-followup', level: 'warn', msg: `No recorded order follow-up or activity for more than ${DQ.noFollowupWorkingDays} working days.` });
      }
    }

    const supplierPromise = order.supplierRevisedPromisedDate || order.supplierPromisedDate;
    const supplierPromiseDays = workingDaysUntil(supplierPromise, entity);
    if (!order.isClosed && order.orderAcknowledgedDate && !supplierPromise && !order.orderReadyDate) {
      issues.push({ key: 'order-missing-supplier-promise', level: 'info', msg: 'Supplier acknowledged the PO but no promised / revised commitment date is recorded.' });
    }
    if (!order.isClosed && supplierPromiseDays !== null && supplierPromiseDays < 0 && !hasReceipt) {
      issues.push({ key: 'order-supplier-promise-overdue', level: 'danger', msg: `Supplier commitment date is ${Math.abs(supplierPromiseDays)} working day(s) overdue with no receipt recorded.` });
    }
    if (!order.isClosed && Number(order.supplierPromiseRevisionCount || 0) > DQ.etaChangeLimit) {
      issues.push({ key: 'order-supplier-promise-revised-repeatedly', level: 'warn', msg: `Supplier commitment has been revised ${Number(order.supplierPromiseRevisionCount)} times.` });
    }
    const nextChaseDays = workingDaysUntil(order.nextSupplierFollowupDate, entity);
    if (!order.isClosed && nextChaseDays !== null && nextChaseDays < 0) {
      issues.push({ key: 'order-supplier-followup-overdue', level: 'danger', msg: `Next supplier follow-up is ${Math.abs(nextChaseDays)} working day(s) overdue.` });
    } else if (!order.isClosed && nextChaseDays !== null && nextChaseDays <= 3) {
      issues.push({ key: 'order-supplier-followup-due-soon', level: 'warn', msg: `Next supplier follow-up is due within ${Math.max(0, nextChaseDays)} working day(s).` });
    }
    if (!order.isClosed && ['high', 'critical'].includes(String(order.orderCriticality || '').toLowerCase()) && !order.escalationOwner && !activeIssueFor(ctx, 'order', order.id)) {
      issues.push({ key: 'order-criticality-no-escalation-owner', level: 'warn', msg: 'High/critical order has no escalation owner or active linked issue.' });
    }

    if (!order.isClosed && orderFunction(order, ctx) === 'supplychain') {
      const itemRows = (Array.isArray(order.supplyChainItems) && order.supplyChainItems.length) ? order.supplyChainItems : (order.lines || []);
      if (!itemRows.length) issues.push({ key: 'order-supply-chain-missing-item-lines', level: 'warn', msg: 'Supply Chain order has no item lines.' });
      else {
        const incomplete = itemRows.filter(line => !hasValue(line.detailedDescription || line.description) || !hasValue(line.quantity ?? line.orderedQty) || Number(line.quantity ?? line.orderedQty) <= 0);
        if (incomplete.length) issues.push({ key: 'order-supply-chain-incomplete-items', level: 'warn', msg: `${incomplete.length} Supply Chain item line(s) are missing a description or valid quantity.` });
      }
    }
    if (!order.isClosed && isForeignGoods) {
      if (!order.incoterm && !order.erpShipmentMethod) issues.push({ key: 'order-foreign-missing-incoterm', level: 'warn', msg: 'Foreign order has no Incoterm / ERP shipment method.' });
      if ((order.orderAcknowledgedDate || order.orderReadyDate) && (!order.plannedShipmentMode || !order.plannedFreightForwarder)) {
        issues.push({ key: 'order-foreign-missing-shipment-plan', level: 'info', msg: 'Foreign order has no complete shipment plan (planned mode and freight forwarder).' });
      }
    }

    const milestones = Array.isArray(order.milestones) ? order.milestones : [];
    if (!order.isClosed && milestones.length) {
      const percentSum = milestones.reduce((sum, milestone) => sum + (Number(milestone.percent) || 0), 0);
      const amountSum = milestones.reduce((sum, milestone) => sum + (Number(milestone.amount) || 0), 0);
      if (Math.abs(percentSum - 100) > 0.01 || (Number(order.amount) > 0 && Math.abs(amountSum - Number(order.amount)) > Math.max(1, Number(order.amount) * 0.01))) {
        issues.push({ key: 'order-payment-schedule-mismatch', level: 'warn', msg: 'Payment milestones do not reconcile to 100% and the PO total.' });
      }
      const pendingAdvance = milestones.find(milestone => !milestone.paidDate && !milestone.rfpRef && /advance|down\s*payment/i.test(milestone.label || '') && (() => {
        const days = workingDaysUntil(milestoneDate(milestone, order, ctx), entity);
        return days !== null && days >= 0 && days <= DQ.paymentDueLookAheadWorkingDays;
      })());
      if (pendingAdvance) issues.push({ key: 'order-advance-payment-no-rfp', level: 'warn', msg: `Advance milestone "${pendingAdvance.label}" is due within ${DQ.paymentDueLookAheadWorkingDays} working days but has no payment request.` });
    }

    if (order.isClosed) {
      const openPayments = payments.filter(payment => !payment.archived && !['paid', 'rejected'].includes(payment.status));
      const openIssues = (ctx.issues || []).filter(issue => !issue.archived && issue.status === 'open' && (issue.relatedType === 'order' && issue.relatedId === order.id));
      const openDocs = (ctx.documents || []).filter(doc => !doc.archived && doc.relatedType === 'order' && doc.relatedId === order.id && ['requested', 'rejected'].includes(doc.status));
      const openClaims = (order.claims || []).filter(claim => ['open', 'under_review'].includes(claim.status));
      const unpaid = milestones.filter(milestone => !milestone.paidDate).length;
      if (unpaid) issues.push({ key: 'order-closed-unpaid-milestones', level: 'danger', msg: `Order is closed but has ${unpaid} unpaid milestone(s).` });
      const blockers = [activeShipments.length && `${activeShipments.length} active shipment(s)`, openPayments.length && `${openPayments.length} open payment(s)`, openIssues.length && `${openIssues.length} open issue(s)`, openDocs.length && `${openDocs.length} active document(s)`, openClaims.length && `${openClaims.length} open claim(s)`].filter(Boolean);
      if (blockers.length) issues.push({ key: 'order-closed-open-work', level: 'danger', msg: `Order is closed while ${blockers.join(', ')} remain.` });
    }

    if (order.erpSource && order.erpSource !== 'Manual') {
      const syncAge = workingDaysSince(order.erpLastSyncedAt, entity);
      if (!order.erpLastSyncedAt) issues.push({ key: 'order-erp-sync-missing', level: 'warn', msg: 'ERP-linked order has no recorded ERP sync timestamp.' });
      else if (syncAge !== null && syncAge > DQ.erpSyncWorkingDays) issues.push({ key: 'order-erp-sync-stale', level: 'warn', msg: `ERP data has not been refreshed for more than ${DQ.erpSyncWorkingDays} working days.` });
      if (order.erpVendorNo && (order.supplierMatchMethod === 'unmatched' || !order.supplierId)) issues.push({ key: 'order-erp-supplier-unmapped', level: 'warn', msg: 'ERP vendor is not linked to the Phoenix supplier master.' });
      const mismatches = [];
      if (hasValue(order.erpVendorName) && hasValue(order.supplier) && !sameText(order.erpVendorName, order.supplier)) mismatches.push('supplier');
      if (hasValue(order.erpAmount) && hasValue(order.amount) && !sameAmount(order.erpAmount, order.amount)) mismatches.push('amount');
      if (hasValue(order.erpCurrency) && hasValue(order.currency) && !sameText(order.erpCurrency, order.currency)) mismatches.push('currency');
      if (mismatches.length) issues.push({ key: 'order-erp-value-mismatch', level: 'warn', msg: `ERP and Phoenix values differ for ${mismatches.join(', ')}.` });
    }
    return issues;
  }

  // ----- Shipment data quality -----
  function shipmentDataQuality(shipment, ctx = {}) {
    const issues = [];
    const order = linkedOrder(ctx, shipment.orderId);
    const done = isCompletedShipment(shipment);
    const entity = shipment.entity || order?.entity || ctx.entity || 'Phoenix';
    const createdAge = workingDaysSince(shipment.createdAt || shipment.requestedAt || shipment.bookingDate, entity);
    const etaDays = workingDaysUntil(shipment.eta, entity);
    const portArrivalAge = workingDaysSince(shipment.portArrivalDate || shipment.actualArrivalDate, entity);
    const clearanceAge = workingDaysSince(shipment.clearanceStartDate, entity);
    const releaseAge = workingDaysSince(shipment.customsReleaseDate, entity);
    const deliveryAge = workingDaysSince(shipment.deliveryDate, entity);

    if (!shipment.orderId) issues.push({ key: 'shipment-missing-linked-order', level: 'danger', msg: 'Shipment is not linked to a purchase order.' });
    if (!done && !shipment.logisticOfficer) issues.push({ key: 'shipment-missing-logistics-officer', level: 'warn', msg: 'Active shipment has no logistics officer assigned.' });
    if (shipment.eta && !shipment.etd) issues.push({ key: 'shipment-eta-missing-etd', level: 'warn', msg: 'Has ETA but no ETD.' });
    if (shipment.clearanceDate && !shipment.docsToBrokerDate) issues.push({ key: 'shipment-clearance-missing-docs-to-broker', level: 'warn', msg: 'Has clearance date but no docs-to-broker date.' });
    const linkedGrns = order ? (order.receipts || []).filter(receipt => receipt.shipmentId && (String(receipt.shipmentId) === String(shipment.id || '') || String(receipt.shipmentId) === String(shipment.shipmentId || ''))) : [];
    const hasLinkedGrn = linkedGrns.some(grnCountsAsReceipt);
    if ((shipment.grnDate || hasLinkedGrn) && !shipment.grnNumber && !linkedGrns.some(receipt => receipt.grnRef || receipt.grnNumber)) issues.push({ key: 'shipment-grn-date-missing-number', level: 'info', msg: 'GRN date set but no GRN number.' });
    if ((shipment.stage === 'in_progress' || shipment.stage === 'assigned') && !shipment.eta) issues.push({ key: 'shipment-in-progress-missing-eta', level: 'info', msg: 'In progress but no ETA yet.' });
    if (!done && createdAge !== null && createdAge > DQ.shipmentEtdWorkingDays && !shipment.etd) {
      issues.push({ key: 'shipment-open-missing-etd', level: 'warn', msg: `Shipment has been open more than ${DQ.shipmentEtdWorkingDays} working days without an ETD.` });
    }
    if (!done && shipment.etd && isPast(shipment.etd, entity) && !shipment.actualDepartureDate) {
      issues.push({ key: 'shipment-etd-passed-no-actual-departure', level: 'warn', msg: 'ETD has passed but no actual departure date is recorded.' });
    }
    if (!done && etaDays !== null && etaDays >= 0 && etaDays <= DQ.etaClearanceLookAheadWorkingDays && (!shipment.docsToBrokerDate || !shipment.clearanceOwner)) {
      issues.push({ key: 'shipment-eta-approaching-clearance-unprepared', level: 'warn', msg: `ETA is within ${DQ.etaClearanceLookAheadWorkingDays} working days but broker documents or clearance owner are missing.` });
    }
    if (!done && etaDays !== null && etaDays < 0 && !shipment.actualArrivalDate && !shipment.portArrivalDate) {
      issues.push({ key: 'shipment-eta-passed-no-arrival', level: 'warn', msg: 'ETA has passed but no actual arrival / port-arrival date is recorded.' });
    }
    if (!done && shipment.portArrivalDate && portArrivalAge !== null && portArrivalAge > DQ.portArrivalClearanceWorkingDays && !shipment.clearanceStartDate) {
      issues.push({ key: 'shipment-port-arrival-no-clearance-start', level: 'warn', msg: `Cargo arrived more than ${DQ.portArrivalClearanceWorkingDays} working days ago but clearance has not started.` });
    }
    if (!done && shipment.clearanceStartDate && clearanceAge !== null && clearanceAge > DQ.clearanceDelayWorkingDays && !shipment.clearanceDate && !shipment.customsReleaseDate && !activeIssueFor(ctx, 'shipment', shipment.id)) {
      issues.push({ key: 'shipment-clearance-delayed', level: 'warn', msg: `Clearance has been in progress for more than ${DQ.clearanceDelayWorkingDays} working days with no active Issue logged.` });
    }
    if (!done && shipment.customsReleaseDate && releaseAge !== null && releaseAge > DQ.releaseToDeliveryWorkingDays && !shipment.deliveryDate && !shipment.grnDate && !hasLinkedGrn) {
      issues.push({ key: 'shipment-released-not-delivered', level: 'warn', msg: `Cargo was released more than ${DQ.releaseToDeliveryWorkingDays} working days ago but delivery / GRN is missing.` });
    }
    if (!done && shipment.deliveryDate && deliveryAge !== null && deliveryAge > DQ.deliveryToGrnWorkingDays && !shipment.grnDate && !hasLinkedGrn) {
      issues.push({ key: 'shipment-delivered-missing-grn', level: 'warn', msg: `Delivery was recorded more than ${DQ.deliveryToGrnWorkingDays} working days ago but no GRN is recorded.` });
    }
    const etaChanges = Array.isArray(shipment.etaChangeHistory) ? shipment.etaChangeHistory.length : 0;
    if (etaChanges > DQ.etaChangeLimit) issues.push({ key: 'shipment-eta-changed-repeatedly', level: 'warn', msg: `ETA has changed ${etaChanges} times (more than the ${DQ.etaChangeLimit}-change control limit).` });

    if (!done && (shipment.etd || shipment.actualDepartureDate || shipment.eta)) {
      const missingDocs = docCoverage('shipment', shipment, ctx);
      if (missingDocs.length) issues.push({ key: 'shipment-required-documents-incomplete', level: 'warn', msg: `${missingDocs.length} required shipping document(s) are not recorded: ${missingDocs.slice(0, 3).join(', ')}${missingDocs.length > 3 ? ', ...' : ''}.` });
    }
    return issues;
  }

  // ----- RFP / payment data quality -----
  function rfpDataQuality(payment, ctx = {}) {
    const issues = [];
    const order = linkedOrder(ctx, payment.orderId);
    const status = String(payment.status || '').toLowerCase();
    const paid = status === 'paid' || payment.isPaid;
    const entity = payment.entity || order?.entity || ctx.entity || 'Phoenix';
    const requestAge = workingDaysSince(payment.requestDate || payment.createdAt, entity);
    const dueDays = workingDaysUntil(payment.dueDate, entity);

    if (!payment.invoiceNumber) issues.push({ key: 'payment-missing-invoice-number', level: 'warn', msg: 'No invoice number recorded.' });
    if (paid && !payment.iblValueDate) issues.push({ key: 'payment-paid-missing-ibl-value-date', level: 'info', msg: 'Marked paid but no IBL value date.' });
    if (!payment.dueDate) issues.push({ key: 'payment-missing-due-date', level: 'warn', msg: 'No due date set.' });
    if (payment.invoiceNumber && !payment.invoiceDate) issues.push({ key: 'payment-invoice-missing-invoice-date', level: 'warn', msg: 'Invoice number is recorded but invoice date is missing.' });
    if (['draft', 'submitted'].includes(status) && requestAge !== null && requestAge > DQ.paymentDraftWorkingDays) {
      issues.push({ key: 'payment-awaiting-approval', level: 'warn', msg: `Payment request has remained ${status} for more than ${DQ.paymentDraftWorkingDays} working days.` });
    }
    if (!paid && status === 'approved' && dueDays !== null && dueDays >= 0 && dueDays <= DQ.paymentDueLookAheadWorkingDays) {
      issues.push({ key: 'payment-approved-due-soon', level: 'warn', msg: `Approved payment is due within ${DQ.paymentDueLookAheadWorkingDays} working days but is not paid.` });
    }
    if (!paid && dueDays !== null && dueDays < 0) issues.push({ key: 'payment-overdue-unpaid', level: 'danger', msg: `Payment is ${Math.abs(dueDays)} working day(s) overdue and remains unpaid.` });
    if (order?.isClosed && !paid && status !== 'rejected') issues.push({ key: 'payment-linked-to-closed-order', level: 'warn', msg: 'Unpaid payment request is linked to a closed order.' });
    if (paid && order?.orderType === 'foreign' && !payment.paymentReference) issues.push({ key: 'payment-paid-missing-reference', level: 'warn', msg: 'Paid foreign payment has no bank / payment reference.' });
    return issues;
  }

  // ----- Supplier pattern data quality -----
  function supplierDataQuality(supplier, ctx = {}) {
    const relatedOrders = (ctx.orders || []).filter(order => matchingSupplier(supplier, order));
    if (!relatedOrders.length) return [];
    const orderIds = new Set(relatedOrders.map(order => order.id));
    const shipmentIds = new Set((ctx.shipments || []).filter(shipment => relatedOrders.some(order => order.orderId === shipment.orderId)).map(shipment => shipment.id));
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - DQ.supplierPatternDays);
    const recentExceptions = (ctx.issues || []).filter(issue => {
      if (issue.archived) return false;
      if (!((issue.relatedType === 'order' && orderIds.has(issue.relatedId)) || (issue.relatedType === 'shipment' && shipmentIds.has(issue.relatedId)))) return false;
      const opened = asDate(issue.openedDate || issue.createdAt);
      return !opened || opened >= cutoff;
    });
    if (recentExceptions.length >= DQ.supplierPatternIssueCount) {
      return [{ key: 'supplier-repeated-exception-pattern', level: 'warn', msg: `${recentExceptions.length} operational exception(s) linked to this supplier in the last ${DQ.supplierPatternDays} days.` }];
    }
    return [];
  }

  // ----- Linked-record health summary for an order -----
  function orderHealth(order, allShipments, allPayments) {
    const shipments = allShipments.filter(shipment => shipment.orderId === order.orderId);
    const payments = allPayments.filter(payment => payment.orderId === order.orderId);
    const milestones = Array.isArray(order.milestones) ? order.milestones : [];
    const unpaidMs = milestones.filter(milestone => !milestone.paidDate).length;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const overduePays = payments.filter(payment => {
      if (['paid', 'rejected'].includes(payment.status)) return false;
      const due = asDate(payment.dueDate);
      return due && due < today;
    }).length;
    const issues = [];
    if (order.orderType === 'foreign' && (!window.PXUtils || window.PXUtils.orderNeedsShipment(order))) {
      if (shipments.length === 0) issues.push({ level: 'info', msg: 'No shipments requested yet.' });
      const noEta = shipments.filter(shipment => !shipment.eta && shipment.stage !== 'completed').length;
      if (noEta) issues.push({ level: 'warn', msg: `${noEta} shipment(s) missing ETA.` });
      const noGrn = shipments.filter(shipment => {
        const linked = (order.receipts || []).some(receipt => grnCountsAsReceipt(receipt) && receipt.shipmentId && (String(receipt.shipmentId) === String(shipment.id || '') || String(receipt.shipmentId) === String(shipment.shipmentId || '')));
        return (shipment.stage === 'completed' || shipment.completed) && !shipment.grnDate && !linked;
      }).length;
      if (noGrn) issues.push({ level: 'warn', msg: `${noGrn} completed shipment(s) missing GRN.` });
    }
    if (unpaidMs) issues.push({ level: 'info', msg: `${unpaidMs} unpaid milestone(s).` });
    if (overduePays) issues.push({ level: 'danger', msg: `${overduePays} overdue payment request(s).` });
    return { shipments: shipments.length, payments: payments.length, unpaidMilestones: unpaidMs, overduePayments: overduePays, issues };
  }

  if (window.PXUtils) {
    window.PXUtils.dataQualityThresholds = DQ;
    window.PXUtils.dateKey = dateKey;
    window.PXUtils.holidaysFor = holidaysFor;
    window.PXUtils.isBusinessDay = isBusinessDay;
    window.PXUtils.workingDaysBetween = workingDaysBetween;
    window.PXUtils.workingDaysSince = workingDaysSince;
    window.PXUtils.workingDaysUntil = workingDaysUntil;
    window.PXUtils.dataQualityContext = stateContext;
    window.PXUtils.orderDataQuality = orderDataQuality;
    window.PXUtils.shipmentDataQuality = shipmentDataQuality;
    window.PXUtils.rfpDataQuality = rfpDataQuality;
    window.PXUtils.supplierDataQuality = supplierDataQuality;
    window.PXUtils.orderHealth = orderHealth;
  }
})();
