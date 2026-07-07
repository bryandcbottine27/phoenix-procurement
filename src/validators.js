/* ============================================================
   VALIDATORS — data quality guards  (Stage 2c)
   ============================================================
   One place that validates a record before it is saved. Called by the form
   save handlers (and, defensively, available to PXStore). Returns:

       { ok: true,  errors: [], warnings: [...] }
       { ok: false, errors: [...], warnings: [...] }

   ERRORS block the save. WARNINGS are advisory (surfaced to the user but allowed),
   because a prototype must not hard-block legitimate edge cases. As the team
   confirms rules, warnings can be promoted to errors.

   Reads field rules from window.PXSchema and transition rules from
   window.PXWorkflows so logic stays in one place.

   NOTE (Path B): exposed as window.PXValidators; convertible to ES export later. */
(function () {
  const num = v => (v === '' || v === null || v === undefined) ? null : Number(v);
  const isNum = v => v !== null && v !== '' && v !== undefined && !isNaN(Number(v));
  const toDate = v => { if (!v) return null; const d = v.toDate ? v.toDate() : new Date(v); return isNaN(d) ? null : d; };
  const norm = v => String(v || '').trim().toLowerCase();

  // Basic link safety: allow http(s), SharePoint/OneDrive, and plain file paths.
  // Block javascript:, data:, and obviously malformed values.
  function isSafeLink(url) {
    if (!url) return true; // optional
    const u = String(url).trim().toLowerCase();
    if (u.startsWith('javascript:') || u.startsWith('data:') || u.startsWith('vbscript:')) return false;
    return /^https?:\/\//.test(u) || /^file:/.test(u) || /^\\\\/.test(u) || /^[a-z]:\\/.test(u) || u.includes('sharepoint.com') || u.includes('onedrive') || u.startsWith('/');
  }

  const state = () => window.__state || { data: {} };

  // ---- ORDER ----
  function validateOrder(data, existing) {
    const errors = [], warnings = [];
    if (!data.orderId || !String(data.orderId).trim()) errors.push('Order number is required.');
    if (!data.entity) errors.push('Entity is required.');                                  // #1 promoted
    if (data.amount !== undefined && data.amount !== null && data.amount !== '' && !isNum(data.amount))
      errors.push('Order amount must be a number.');
    if (isNum(data.amount) && num(data.amount) < 0) errors.push('Order amount cannot be negative.');
    // #14 promoted: supplier is required
    if (!data.supplier || !String(data.supplier).trim() || String(data.supplier).trim() === '—')
      errors.push('Supplier is required.');
    // #2: supplier should exist in the supplier list — WARNING (confirmable), not a hard block.
    // ERP/manual orders often introduce a new supplier before it is added to the master list;
    // saving is allowed on confirmation. Add the supplier (or an alias) to clear the warning.
    if (data.supplier && String(data.supplier).trim() && String(data.supplier).trim() !== '—') {
      const known = (state().data.suppliers || []).some(s =>
        (s.name || '').trim().toLowerCase() === String(data.supplier).trim().toLowerCase() ||
        (s.aliases || []).some(a => (a || '').trim().toLowerCase() === String(data.supplier).trim().toLowerCase()));
      if (!known) warnings.push(`Supplier "${data.supplier}" is not in the supplier list yet — it will be saved as entered. Add it (or an alias) under Suppliers to link it to performance tracking.`);
    }
    // Supply Chain detailed descriptions and quantities are captured per item.
    if (data.function === 'supplychain' && Array.isArray(data.supplyChainItems)) {
      data.supplyChainItems.forEach((item, index) => {
        if (!item || !String(item.detailedDescription || '').trim()) errors.push(`Supply Chain item ${index + 1} needs a detailed description.`);
        const quantity = Number(item && item.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) errors.push(`Supply Chain item ${index + 1} needs a quantity greater than zero.`);
      });
    }
    // Migration leniency: a closed/historical order (e.g. bulk-imported PO closed earlier this
    // year) predates the live-workflow rules below. For such records the three completeness
    // rules become confirmable WARNINGS instead of hard errors, so editing/re-saving them is not
    // blocked. Genuine integrity rules (required ids, numeric/non-negative amount, date ordering,
    // closure controls) remain hard errors regardless. A live (open) order keeps full guardrails.
    const isHistorical = !!data.isClosed || !!(existing && existing.isClosed);
    const completeness = isHistorical ? warnings : errors;
    const histSuffix = isHistorical ? ' (historical/closed order — confirm to save as-is)' : '';
    // #12: requested receipt date — needed for OTIF on live orders
    if (!data.requestedReceiptDate) completeness.push('Requested receipt date is required (needed to measure OTIF).' + histSuffix);
    // #13: foreign order should have payment terms — always a WARNING (confirmable), never a hard
    // block. Navision/BC payment terms are often poorly defined (especially with mixed milestones),
    // and an officer may enter a custom term or none; saving is allowed on confirmation.
    if (data.orderType === 'foreign' && !data.paymentTerms) warnings.push('Foreign order has no payment terms set — milestones may need to be entered manually.');
    // #3: milestones must total 100%
    if (Array.isArray(data.milestones) && data.milestones.length) {
      const sum = data.milestones.reduce((s, m) => s + (Number(m.percent) || 0), 0);
      if (Math.round(sum) !== 100) completeness.push(`Milestone percentages total ${sum}% (must equal 100%).` + histSuffix);
      if (isNum(data.amount)) {
        const milestoneAmount = data.milestones.reduce((s, m) => s + (Number(m.amount) || 0), 0);
        if (Math.abs(milestoneAmount - Number(data.amount)) > 0.05) {
          warnings.push(`Milestone amounts total ${milestoneAmount.toFixed(2)}, which does not reconcile to the order amount ${Number(data.amount).toFixed(2)}.`);
        }
      }
    }
    if (Array.isArray(data.receipts) && data.receipts.length) {
      const shipments = state().data.shipments || [];
      data.receipts.forEach((receipt, index) => {
        const status = norm(receipt?.status || 'fully received');
        const activeReceipt = status !== 'pending' && status !== 'cancelled';
        if (activeReceipt && !(receipt?.grnDate || receipt?.actualReceiptDate)) {
          warnings.push(`GRN row ${index + 1} has no receipt date; OTIF and ageing reports may treat it as incomplete.`);
        }
        if (receipt?.shipmentId) {
          const linked = shipments.find(s => String(s.id || '') === String(receipt.shipmentId) || String(s.shipmentId || '') === String(receipt.shipmentId));
          if (!linked) warnings.push(`GRN row ${index + 1} links to a shipment that is not currently present.`);
          else if (String(linked.orderId || '') !== String(data.orderId || '')) {
            errors.push(`GRN row ${index + 1} links to shipment ${linked.shipmentId || linked.id}, which belongs to order ${linked.orderId || 'unknown'}.`);
          }
        }
      });
    }
    // Requested receipt date sanity
    const od = toDate(data.dateOfOrder), rr = toDate(data.requestedReceiptDate);
    if (od && rr && rr < od) errors.push('Requested receipt date cannot be before the order date.');
    // Order acknowledged / ready dates cannot precede the order date (impossible).
    const ack = toDate(data.orderAcknowledgedDate), rdy = toDate(data.orderReadyDate);
    if (od && ack && ack < od) errors.push('Order acknowledged date cannot be before the order date.');
    if (od && rdy && rdy < od) errors.push('Order ready date cannot be before the order date.');
    // Closing an order: block if open critical issues or missing required docs
    if (data.isClosed && !existing?.isClosed) {
      const oid = existing?.id;
      if (oid) {
        const openCritical = (state().data.issues || []).filter(i => !i.archived && i.status === 'open' &&
          (i.relatedId === oid || i.orderId === data.orderId));
        if (openCritical.length) errors.push(`Order has ${openCritical.length} open issue(s) — resolve before closing.`);   // #4 promoted
        const expected = (window.REF?.expectedDocuments?.order) || [];
        if (expected.length) {
          const present = (state().data.documents || []).filter(d => !d.archived && d.relatedType === 'order' && d.relatedId === oid).map(d => d.documentType);
          const missing = expected.filter(t => !present.includes(t));
          if (missing.length) errors.push(`Cannot close: ${missing.length} expected document(s) not recorded.`);            // #5 promoted
        }
        // #15 PO line-level closure control: cannot close while open lines remain, or with an unresolved over-receipt.
        if (window.PXLineFulfilment) {
          const merged = Object.assign({}, existing, data);
          const lf = window.PXLineFulfilment.forOrder(merged);
          if (lf.hasLines && lf.openLines > 0) errors.push(`Cannot close: ${lf.openLines} PO line(s) still open — receive, cancel or short-close them first.`);
          if (lf.errors.length) errors.push('Cannot close: an over-receipt on a PO line needs an approved exception first.');
        }
      }
    }
    // #6 KEPT AS WARNING: status moving backwards — allows emergency shipment-before-PO override via confirm.
    if (existing && existing.status && data.status && existing.status !== data.status && window.PXWorkflows) {
      if (window.PXWorkflows.isBackwardsOrderMove(existing.status, data.status))
        warnings.push(`Status moved backwards: "${existing.status}" → "${data.status}". (OK for emergency cases — confirm to proceed.)`);
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  // ---- SHIPMENT ----
  function validateShipment(data, existing) {
    const errors = [], warnings = [];
    if (!data.orderId) errors.push('Shipment must be linked to an order.');
    if (!data.shipmentId || !String(data.shipmentId).trim()) errors.push('Shipment ID is required.');
    if (!data.status || !String(data.status).trim()) errors.push('Shipment status is required.');
    const validStatuses = window.REF?.shipmentFollowupStatuses || [];
    if (data.status && validStatuses.length && !validStatuses.includes(data.status)) {
      warnings.push(`Shipment status "${data.status}" is not in the current logistics status list.`);
    }
    const currentId = existing?.id || data.id || null;
    const duplicate = (state().data.shipments || []).find(sh =>
      sh && sh.id !== currentId && norm(sh.shipmentId) === norm(data.shipmentId));
    if (duplicate) errors.push(`Shipment ID "${data.shipmentId}" is already in use on order ${duplicate.orderId || 'unknown'}.`);

    const validReceiptResults = window.REF?.shipmentReceiptResults || [];
    if (data.receiptResult && validReceiptResults.length && !validReceiptResults.includes(data.receiptResult)) {
      errors.push(`Receipt result "${data.receiptResult}" is not valid.`);
    }
    const receivedResults = ['fully received', 'partially received', 'short received', 'missing goods', 'damaged goods', 'over received'];
    const shipmentKeys = [existing?.id, data.id, existing?.shipmentId, data.shipmentId].filter(Boolean).map(String);
    const linkedOrder = (state().data.orders || []).find(o => String(o.orderId || '') === String(data.orderId || ''));
    const hasLinkedGrnDate = !!(linkedOrder && Array.isArray(linkedOrder.receipts) && linkedOrder.receipts.some(receipt => {
      const status = norm(receipt?.status || 'fully received');
      return status !== 'pending' && status !== 'cancelled'
        && shipmentKeys.includes(String(receipt.shipmentId || ''))
        && !!(receipt.grnDate || receipt.actualReceiptDate);
    }));
    if (receivedResults.includes(norm(data.receiptResult)) && !data.grnDate && !hasLinkedGrnDate) {
      errors.push('Receipt result shows goods were received, but no GRN date or linked GRN is recorded.');
    }
    if (data.grnNumber && !data.grnDate && !hasLinkedGrnDate) {
      errors.push('GRN number is set but no GRN date or linked GRN date is recorded.');
    }
    const eta = toDate(data.eta), grn = toDate(data.grnDate), etd = toDate(data.etd);
    if (etd && eta && eta < etd) errors.push('ETA cannot be before ETD.');
    if (eta && grn && grn < eta) errors.push('GRN (goods received) date cannot be before the ETA — goods cannot be received before they arrive.');

    // ---- TEPS tax-provision inputs (used by A/C for cash provisioning) ----
    // Impossible numbers block; judgment calls warn.
    const tepsNonNeg = [
      ['invoiceValue', 'Total Invoice'],
      ['tepsFreight', 'Freight'],
      ['insuranceRate', 'Insurance rate'],
      ['vatRate', 'VAT rate'],
      ['exciseDuties', 'Excise & Duties']
    ];
    tepsNonNeg.forEach(([k, label]) => {
      if (data[k] !== undefined && data[k] !== '' && data[k] !== null) {
        if (!isNum(data[k])) errors.push(`${label} must be a number.`);
        else if (num(data[k]) < 0) errors.push(`${label} cannot be negative.`);
      }
    });
    // Exchange rate, when provided, must be strictly positive (a zero/neg rate makes CFR meaningless)
    if (data.exchangeRate !== undefined && data.exchangeRate !== '' && data.exchangeRate !== null) {
      if (!isNum(data.exchangeRate)) errors.push('Exchange rate must be a number.');
      else if (num(data.exchangeRate) <= 0) errors.push('Exchange rate must be greater than zero.');
    }
    // ETA/ETD/clearance integrity (#15, #16 promoted)
    if (eta && !etd) errors.push('ETA is set but ETD is missing — record the ETD.');
    if (data.clearanceDate && !data.docsToBrokerDate) errors.push('Clearance date is set but docs-to-broker date is missing.');
    // Alcohol but no excise entered → ERROR (excise applies to alcoholic beverages) (#7 promoted)
    if (data.isAlcohol && (data.exciseDuties === '' || data.exciseDuties == null || num(data.exciseDuties) === 0)) {
      errors.push('Marked as alcoholic but Excise & Duties is blank or zero — enter the MRA figure.');
    }
    // If a provision will be computed, make sure the inputs make it meaningful.
    const tepsTouched = [data.invoiceValue, data.tepsFreight, data.exciseDuties]
      .some(v => v !== undefined && v !== '' && v !== null);
    if (tepsTouched) {
      const hasInvoice = isNum(data.invoiceValue) && num(data.invoiceValue) > 0;
      const hasRate = isNum(data.exchangeRate) && num(data.exchangeRate) > 0;
      const hasFreight = isNum(data.tepsFreight) && num(data.tepsFreight) > 0;
      const hasExcise = isNum(data.exciseDuties) && num(data.exciseDuties) > 0;
      // An invoice value with no exchange rate would understate CFR (freight-only). (#8 promoted)
      if (hasInvoice && !hasRate) {
        errors.push('Invoice value entered without an exchange rate — enter the rate so CFR is correct.');
      }
      // No CFR basis at all and no excise → the total provision would be zero/meaningless. (#9 promoted)
      if (!hasInvoice && !hasFreight && !hasExcise) {
        errors.push('Tax provision has no meaningful basis — enter an invoice value, freight, or excise.');
      }
    }
    // stage transition — KEPT AS WARNING (emergency override, consistent with order status)
    if (existing && existing.stage && data.stage && existing.stage !== data.stage && window.PXWorkflows) {
      const t = window.PXWorkflows.canTransition('shipment', existing.stage, data.stage);
      if (!t.ok) warnings.push(t.reason);
    }
    // Increment 2: GRN recorded but actual landed cost not yet entered
    if (data.grnDate && (data.actualLandedCostMUR == null || data.actualLandedCostMUR === '')) {
      warnings.push('GRN date is set — enter the Actual Landed Cost (MUR) once the final duty/VAT/freight invoices are received so the TEPS variance can be closed.');
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  // ---- PAYMENT REQUEST ----
  function validatePayment(data, existing) {
    const errors = [], warnings = [];
    if (!data.orderId) errors.push('Payment request must be linked to an order.');
    if (data.amount !== undefined && data.amount !== '' && !isNum(data.amount)) errors.push('Payment amount must be a number.');
    if (isNum(data.amount) && num(data.amount) < 0) errors.push('Payment amount cannot be negative.');
    if (!data.invoiceNumber || !String(data.invoiceNumber).trim()) errors.push('Invoice number is required.');   // #17 promoted
    if (!data.dueDate) errors.push('Due date is required.');                                                       // #18 promoted
    // #10 promoted: payments cannot exceed order value
    if (isNum(data.amount) && data.orderId) {
      const ord = (state().data.orders || []).find(o => o.orderId === data.orderId);
      if (ord && isNum(ord.amount)) {
        const others = (state().data.payments || [])
          .filter(p => p.orderId === data.orderId && p.id !== existing?.id && !['rejected','cancelled'].includes(p.status))
          .reduce((s, p) => s + (Number(p.amount) || 0), 0);
        if (others + num(data.amount) > Number(ord.amount) * 1.0001)
          errors.push(`Total payments (${others + num(data.amount)}) exceed the order value (${ord.amount}).`);
      }
    }
    // status transition — KEPT AS WARNING (emergency override consistency)
    if (existing && existing.status && data.status && existing.status !== data.status && window.PXWorkflows) {
      const t = window.PXWorkflows.canTransition('payment', existing.status, data.status);
      if (!t.ok) warnings.push(t.reason);
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  // ---- DOCUMENT ----
  function validateDocument(data, existing) {
    const errors = [], warnings = [];
    if (!data.documentType) errors.push('Document type is required.');
    if (!isSafeLink(data.documentUrl)) errors.push('Document link is not a valid or safe URL/path.');
    const folderKeys = ((window.REF && window.REF.documentFolders) || []).map(f => f.key);
    if (data.folder && folderKeys.length && !folderKeys.includes(data.folder)) errors.push('Document folder is not recognised.');
    if (data.status === 'rejected' && !data.rejectedReason) errors.push('A rejected document must have a reason.');  // #11 promoted
    const rec = toDate(data.receivedDate), exp = toDate(data.expiryDate);
    if (rec && exp && exp < rec) errors.push('Expiry date cannot be before the received date.');
    if (existing && existing.status && data.status && existing.status !== data.status && window.PXWorkflows) {
      const t = window.PXWorkflows.canTransition('document', existing.status, data.status);
      if (!t.ok) warnings.push(t.reason);
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  // ---- SUPPLIER ----
  function validateSupplier(data, existing) {
    const errors = [], warnings = [];
    const norm = value => String(value || '').trim().toLowerCase();
    const name = norm(data.name);
    if (!name) errors.push('Supplier name is required.');
    const suppliers = (state().data.suppliers || []).filter(s => !s.archived && s.id !== existing?.id);
    if (name && suppliers.some(s => norm(s.name) === name)) errors.push('A supplier with this name already exists. Use the existing supplier or record an alias.');

    const seen = new Set();
    (data.erpMappings || []).forEach(mapping => {
      const entity = norm(mapping.entity), source = norm(mapping.erpSource), vendorNo = norm(mapping.vendorNo);
      if (!entity || !source || !vendorNo) {
        errors.push('Each ERP vendor mapping needs an entity, ERP source and vendor code.');
        return;
      }
      const key = `${entity}|${source}|${vendorNo}`;
      if (seen.has(key)) errors.push(`Vendor code "${mapping.vendorNo}" is duplicated in this supplier's ERP mappings.`);
      seen.add(key);
      const effectiveFrom = toDate(mapping.effectiveFrom), effectiveTo = toDate(mapping.effectiveTo);
      if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) errors.push(`Vendor code "${mapping.vendorNo}" has an effective-to date before its effective-from date.`);
      if (mapping.active === false) return;
      const conflict = suppliers.find(s => (s.erpMappings || []).some(other => other && other.active !== false &&
        norm(other.entity) === entity && norm(other.erpSource) === source && norm(other.vendorNo) === vendorNo));
      if (conflict) errors.push(`Vendor code "${mapping.vendorNo}" is already mapped to supplier "${conflict.name}" for the same entity and ERP source.`);
    });

    (data.contacts || []).forEach(contact => {
      if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) warnings.push(`Contact "${contact.name || 'unnamed'}" has an invalid email address.`);
    });
    if (['watchlist', 'blocked'].includes(data.supplierRating) && !String(data.supplierRatingReason || '').trim()) {
      errors.push(`A rating review reason is required when a supplier is ${data.supplierRating}.`);
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  // ---- UPDATE REQUEST ----
  function validateUpdateRequest(data, existing) {
    const errors = [], warnings = [];
    const type = data.targetType === 'shipment' ? 'shipment' : 'order';
    if (!['order', 'shipment'].includes(type)) errors.push('Update request target type must be order or shipment.');
    if (!String(data.message || '').trim()) errors.push('Update request message is required.');
    if (!String(data.orderId || '').trim()) errors.push('Update request must be linked to an order number.');
    if (type === 'order' && !data.orderDocId) warnings.push('Order update request has no order document id.');
    if (type === 'shipment' && !data.shipmentDocId) warnings.push('Shipment update request has no shipment document id.');
    if (data.status && !['open', 'attended'].includes(data.status)) errors.push('Update request status must be open or attended.');
    if (data.status === 'attended' && !data.attendedAt) warnings.push('Attended update request should carry an attended date.');
    if (data.createdAt && data.dueDate) {
      const created = toDate(data.createdAt), due = toDate(data.dueDate);
      if (created && due && due < created) warnings.push('Update request due date is before the request date.');
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  // ---- CONTACT LOG ----
  function validateContactLog(data, existing) {
    const errors = [], warnings = [];
    if (!['order', 'shipment'].includes(data.relatedType || 'order')) errors.push('Contact log must relate to an order or shipment.');
    if (!String(data.orderId || '').trim()) errors.push('Contact log must be linked to an order number.');
    if (!data.contactDate) errors.push('Contact date is required.');
    if (!['outbound', 'inbound'].includes(data.direction || 'outbound')) errors.push('Contact direction must be inbound or outbound.');
    if (!String(data.summary || '').trim()) errors.push('Contact summary is required.');
    const contactDate = toDate(data.contactDate), responseDate = toDate(data.responseExpectedBy);
    if (contactDate && responseDate && responseDate < contactDate) warnings.push('Response expected date is before the contact date.');
    return { ok: errors.length === 0, errors, warnings };
  }

  // ---- KPI SNAPSHOT ----
  function validateKpiSnapshot(data, existing) {
    const errors = [], warnings = [];
    if (!String(data.entity || '').trim()) errors.push('KPI snapshot entity is required.');
    if (!/^\d{4}-\d{2}$/.test(String(data.period || ''))) errors.push('KPI snapshot period must be YYYY-MM.');
    if (!data.values || typeof data.values !== 'object' || Array.isArray(data.values)) errors.push('KPI snapshot values must be an object.');
    return { ok: errors.length === 0, errors, warnings };
  }

  // ---- generic dispatch ----
  function validate(kind, data, existing) {
    switch (kind) {
      case 'order':    return validateOrder(data, existing);
      case 'shipment': return validateShipment(data, existing);
      case 'payment':  return validatePayment(data, existing);
      case 'document': return validateDocument(data, existing);
      case 'supplier': return validateSupplier(data, existing);
      case 'updateRequest': return validateUpdateRequest(data, existing);
      case 'contactLog': return validateContactLog(data, existing);
      case 'kpiSnapshot': return validateKpiSnapshot(data, existing);
      default:         return { ok: true, errors: [], warnings: [] };
    }
  }

  window.PXValidators = {
    validate, validateOrder, validateShipment, validatePayment, validateDocument, validateSupplier,
    validateUpdateRequest, validateContactLog, validateKpiSnapshot,
    isSafeLink
  };
})();
