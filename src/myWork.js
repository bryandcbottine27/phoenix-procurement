const { $, $$, fmtDate, fmtMoney, daysBetween, escapeHtml, statusBadgeClass, generateMilestonesFromTerm, computeMilestoneDate, milestoneStatus, orderFunction, orderNeedsShipment, currentEntity, recordEntity, entityMeta, currentRole, canEditOrders, canEditShipments, canManageShipments, shipmentFollowupActionOpen } = window.PXUtils;
const state = window.__state;
const REF = window.REF;

/* ============================================================
   MY WORK — records relevant to the current officer
============================================================ */
window.__setMyworkEntity = function(code) {
  const f = window.__state.filters.myworkEntity || (window.__state.filters.myworkEntity = { entity: '' });
  f.entity = code;
  window.__renderers['mywork']();
};
// Single-select tier filter for the Action Required queue (crit / soon / up / wait).
// Persisted per browser so My Work reopens on the last group viewed.
window.__setMyworkTier = function(tier) {
  const f = window.__state.filters.myworkTier || (window.__state.filters.myworkTier = { tier: 'crit' });
  f.tier = tier;
  try { localStorage.setItem('phoenix_mywork_tier', tier); } catch (e) {}
  window.__renderers['mywork']();
};

// Snooze a My Work action for a chosen number of days (prompted), then re-render.
window.__snoozeAction = function(actionKey) {
  if (!window.PXSnooze) return;
  const raw = prompt('Snooze this item for how many days?', '3');
  if (raw === null) return;
  const days = parseInt(raw, 10);
  if (isNaN(days) || days < 1) { if (window.PXUtils) window.PXUtils.toast('Enter a number of days (1 or more).', 'warn'); return; }
  window.PXSnooze.snooze(actionKey, days);
  if (window.PXUtils) window.PXUtils.toast(`Snoozed for ${days} day(s).`, 'success');
  window.__renderers['mywork']();
  if (window.updateCounts) window.updateCounts();
};
window.__unsnoozeAction = function(actionKey) {
  if (!window.PXSnooze) return;
  window.PXSnooze.clearSnooze(actionKey);
  window.__renderers['mywork']();
  if (window.updateCounts) window.updateCounts();
};
// My Day toggle: focus on overdue + due-soon only. Persisted per browser.
window.__toggleMyDay = function() {
  let on = false;
  try { on = localStorage.getItem('phoenix_myday') === '1'; localStorage.setItem('phoenix_myday', on ? '0' : '1'); } catch (e) {}
  window.__renderers['mywork']();
};
window.__renderers['mywork'] = function() {
  return myWorkCompute({ renderDom: true });
};

// Single source of truth for My Work actions + counts (spec item 6).
// Both the page (renderDom:true) and the sidebar badge (renderDom:false) call this,
// so the badge can NEVER disagree with the page. entityOverride lets the badge
// compute for the active sidebar entity; when omitted it uses the page's chip filter.
function myWorkCompute(opts) {
  opts = opts || {};
  const renderDom = opts.renderDom !== false;
  const viewEl = $('#view-mywork');
  if (renderDom && !viewEl) return null;
  const me = state.officer || {};
  const myCode = me.code || '';
  const myName = me.fullName || '';
  const role = currentRole ? currentRole() : (me.role || 'admin');
  const isLogistics = role === 'admin' || role === 'logistics' || String(role).startsWith('logistics_');
  const orders = state.data.orders;
  const ships = state.data.shipments;
  const pays = state.data.payments;
  const today = new Date(); today.setHours(0,0,0,0);
  const in30 = new Date(today); in30.setDate(today.getDate() + 30);

  // My Work is CROSS-ENTITY (personal action queue). Each item is badged with
  // its entity; an optional chip filter narrows the view (default: All).
  // For the page, the filter is the chip (state.filters.myworkEntity).
  // For the sidebar badge (count-only), we honour an entityOverride = the active
  // sidebar entity, so the badge is PER-ENTITY and always matches what the page
  // would show for that entity.
  const chipFilter = state.filters.myworkEntity || (state.filters.myworkEntity = { entity: '' }); // '' = All
  const mwFilter = (opts.entityOverride !== undefined)
    ? { entity: opts.entityOverride }
    : chipFilter;
  const orderByOrderId = oid => orders.find(o => o.orderId === oid);
  const entityOfOrderId = oid => { const o = orderByOrderId(oid); return o ? recordEntity(o) : 'Phoenix'; };
  const entityOfShip = s => s.entity || entityOfOrderId(s.orderId);
  const entityOfPay = p => p.entity || entityOfOrderId(p.orderId);
  const entBadge = code => { const m = entityMeta(code); return `<span class="entity-badge" style="background:${m.accent};color:#fff">${m.short}</span>`; };

  // My open orders (by officer code)
  const myOrders = orders.filter(o => !o.isClosed && o.officerCode === myCode);

  // Shipment requests I created
  const myShipRequests = ships.filter(s => s.requestedBy === myCode || s.requestedBy === myName);

  // Shipments assigned to me (logistics)
  const myShipments = isLogistics ? ships.filter(s => s.logisticOfficer === myName || s.logisticOfficer === myCode) : [];

  // My exports/outbound (logistics): mine by logistic officer, still open (not closed/cancelled).
  const allExports = state.data.exports || [];
  const myExports = isLogistics ? allExports.filter(x => !x.archived
    && (x.logisticOfficer === myCode || x.logisticOfficer === myName)
    && !['Closed', 'Cancelled'].includes(x.status)) : [];

  // Pending/overdue RFPs linked to my orders
  const myOrderIds = new Set(orders.filter(o => o.officerCode === myCode).map(o => o.orderId));
  const myPays = pays.filter(p => myOrderIds.has(p.orderId) && !['paid','rejected'].includes(p.status));
  const overduePays = myPays.filter(p => {
    const d = p.dueDate?.toDate ? p.dueDate.toDate() : (p.dueDate ? new Date(p.dueDate) : null);
    return d && d < today;
  });

  // Upcoming milestones on my orders (next 30 days, unpaid)
  const upcomingMs = [];
  orders.filter(o => o.officerCode === myCode && !o.isClosed && o.milestones).forEach(o => {
    o.milestones.forEach(m => {
      if (m.paidDate) return;
      const exp = computeMilestoneDate(m, o, ships) || (m.expectedDateOverride ? (m.expectedDateOverride.toDate ? m.expectedDateOverride.toDate() : new Date(m.expectedDateOverride)) : null);
      if (exp && exp >= today && exp <= in30) upcomingMs.push({ order: o, milestone: m, date: exp });
    });
  });
  upcomingMs.sort((a,b) => a.date - b.date);

  // ---- Apply the entity chip filter to the section tables (consistent with the
  //      action queue above). '' = All entities. Selecting a chip (e.g. SEY)
  //      narrows the WHOLE page — queue + every section table — to that entity. ----
  const mwEnt = mwFilter.entity;
  const mwOrders      = mwEnt ? myOrders.filter(o => recordEntity(o) === mwEnt) : myOrders;
  const mwShipReqs    = mwEnt ? myShipRequests.filter(s => entityOfShip(s) === mwEnt) : myShipRequests;
  const mwShipments   = mwEnt ? myShipments.filter(s => entityOfShip(s) === mwEnt) : myShipments;
  const mwExports     = mwEnt ? myExports.filter(x => (x.entity || 'Phoenix') === mwEnt) : myExports;
  const mwPays        = mwEnt ? myPays.filter(p => entityOfPay(p) === mwEnt) : myPays;
  const mwUpcomingMs  = mwEnt ? upcomingMs.filter(x => recordEntity(x.order) === mwEnt) : upcomingMs;

  // ============================================================
  // ACTION REQUIRED QUEUE — role-aware, rule-based, tiered
  // ============================================================
  const T = REF.actionThresholds;
  const daysFromToday = d => {
    if (!d) return null;
    const dt = d.toDate ? d.toDate() : new Date(d);
    if (isNaN(dt)) return null;
    dt.setHours(0,0,0,0);
    return Math.round((dt - today) / 86400000); // negative = past
  };
  const canDoOrders = canEditOrders();
  const canDoShip = canEditShipments();
  const canCreatePayments = !!(window.PXUtils && window.PXUtils.can && window.PXUtils.can('payments', 'create'));
  const canEditPayments = !!(window.PXUtils && window.PXUtils.can && window.PXUtils.can('payments', 'edit'));
  const isManager = canManageShipments(); // assignment authority

  // Resolve an operational record's parent into a label + click-through
  const opRecordLabel = (rt, rid) => {
    if (rt === 'order') { const o = orders.find(x => x.id === rid); return o ? 'Order ' + o.orderId : 'Order'; }
    if (rt === 'shipment') { const s = ships.find(x => x.id === rid); return s ? 'Shipment ' + s.shipmentId : 'Shipment'; }
    if (rt === 'payment') { const p = pays.find(x => x.id === rid); return p ? 'RFP ' + p.rfpRef : 'Payment'; }
    if (rt === 'supplier') { const s = state.data.suppliers.find(x => x.id === rid); return s ? (s.name||'Supplier') : 'Supplier'; }
    return rt || 'Record';
  };
  const opRecordGo = (rt, rid) => {
    const fn = { order:'openOrderDetail', shipment:'openShipmentDetail', payment:'openPaymentDetail', supplier:'openSupplierDetail' }[rt];
    return fn && rid ? `${fn}('${rid}')` : `void(0)`;
  };

  // tier from a day-count to a deadline: <0 overdue(crit), <=dueSoon soon, <=upcoming up
  const tierForDeadline = n => {
    if (n === null) return null;
    if (n < 0) return 'crit';
    if (n <= T.dueSoonDays) return 'soon';
    if (n <= T.upcomingDays) return 'up';
    return null;
  };

  const actions = [];   // { tier, what, why, ref, go }
  const waiting = [];    // informational, waiting on others

  // ---- Payment actions (procurement owns RFP lifecycle) ----
  myPays.forEach(p => {
    const n = daysFromToday(p.dueDate);
    const tier = tierForDeadline(n);
    if (!tier) return;
    const when = n < 0 ? `${Math.abs(n)} day(s) overdue` : (n === 0 ? 'due today' : `due in ${n} day(s)`);
    const item = {
      tier,
      what: canEditPayments ? `Progress payment ${p.rfpRef || '(RFP)'} (${p.currency||''} ${p.amount||''})` : `Payment ${p.rfpRef||'(RFP)'} pending`,
      why: `${when} · ${p.orderId || ''} · status: ${p.status || '—'}`,
      ref: p.rfpRef || p.orderId,
      go: `openPaymentDetail('${p.id}')`
    };
    (canEditPayments ? actions : waiting).push(item);
  });

  // ---- Milestone actions (procurement: raise RFP when milestone is near/overdue and no RFP yet) ----
  orders.filter(o => o.officerCode === myCode && !o.isClosed && Array.isArray(o.milestones)).forEach(o => {
    o.milestones.forEach(m => {
      if (m.paidDate || m.rfpRef) return; // already handled / RFP exists
      const exp = computeMilestoneDate(m, o, ships) || (m.expectedDateOverride ? m.expectedDateOverride : null);
      const n = daysFromToday(exp);
      const tier = tierForDeadline(n);
      if (!tier) return;
      const when = n < 0 ? `${Math.abs(n)} day(s) overdue` : (n === 0 ? 'due today' : `due in ${n} day(s)`);
      const item = {
        tier,
        what: canCreatePayments ? `Raise RFP for "${m.label}" (${m.percent}%)` : `Milestone "${m.label}" pending`,
        why: `${when} · ${o.orderId} · ${o.currency||''} ${m.amount||''}`,
        ref: o.orderId,
        go: `openOrderDetail('${o.id}')`
      };
      (canCreatePayments ? actions : waiting).push(item);
    });
  });

  // ---- Shipment requests awaiting assignment (logistics manager) ----
  ships.filter(s => (s.stage||'') === 'requested').forEach(s => {
    const mine = (s.requestedBy === myCode || s.requestedBy === myName);
    const n = s.requestedAt ? daysFromToday(s.requestedAt) : 0;
    const overdueAssign = (n !== null && Math.abs(n) >= T.requestedNotAssignedDays);
    if (isManager && overdueAssign) {
      actions.push({
        tier: (n !== null && Math.abs(n) > T.dueSoonDays) ? 'crit' : 'soon',
        what: `Assign shipment ${s.shipmentId} to a logistic officer`,
        why: `Requested${n!==null?` ${Math.abs(n)} day(s) ago`:''} · ${s.orderId || ''} · awaiting assignment`,
        ref: s.shipmentId,
        go: `openShipmentDetail('${s.id}')`
      });
    } else if (mine && !isManager) {
      waiting.push({
        tier: 'wait',
        what: `Shipment ${s.shipmentId} awaiting logistics assignment`,
        why: `You requested it${n!==null?` ${Math.abs(n)} day(s) ago`:''}`,
        ref: s.shipmentId,
        go: `openShipmentDetail('${s.id}')`
      });
    }
  });

  // ---- Shipments assigned to me missing key data (logistics) ----
  if (canDoShip) {
    myShipments.forEach(s => {
      const done = (s.stage === 'completed' || s.completed);
      // assigned/in-progress but no ETA
      if (!done && (s.stage === 'assigned' || s.stage === 'in_progress') && !s.eta) {
        actions.push({ tier: 'soon', what: `Add ETA for shipment ${s.shipmentId}`, why: `${s.orderId||''} · ${REF.shipmentStages[s.stage]?.label||s.stage}, no ETA entered`, ref: s.shipmentId, go: `openShipmentDetail('${s.id}')` });
      }
      // ETA passed but no GRN
      if (!done && s.eta) {
        const n = daysFromToday(s.eta);
        if (n !== null && n < -T.arrivedNoGrnGraceDays && !s.grnDate) {
          actions.push({ tier: 'crit', what: `Record GRN for shipment ${s.shipmentId}`, why: `ETA was ${fmtDate(s.eta)} (${Math.abs(n)} day(s) ago), no GRN`, ref: s.shipmentId, go: `openShipmentDetail('${s.id}')` });
        }
      }
      // completed but no GRN
      if (done && !s.grnDate) {
        actions.push({ tier: 'soon', what: `Record GRN for ${s.shipmentId}`, why: `Marked completed but no GRN recorded`, ref: s.shipmentId, go: `openShipmentDetail('${s.id}')` });
      }
      // ETA but no ETD (data gap)
      if (!done && s.eta && !s.etd) {
        actions.push({ tier: 'up', what: `Add ETD for ${s.shipmentId}`, why: `Has ETA but no ETD recorded`, ref: s.shipmentId, go: `openShipmentDetail('${s.id}')` });
      }
      // Document readiness: arriving soon but clearance docs incomplete (prevents demurrage)
      if (!done && s.eta && window.PXShipmentDocs) {
        const n = daysFromToday(s.eta);
        if (n !== null && n <= 7 && !s.grnDate) {
          const sum = window.PXShipmentDocs.summary(s);
          if (sum.total > 0 && !sum.complete) {
            actions.push({ tier: n < 0 ? 'crit' : 'soon', what: `Complete clearance docs — ${s.shipmentId}`, why: `${sum.received} of ${sum.total} docs ready, ETA ${n < 0 ? Math.abs(n)+' day(s) ago' : 'in '+n+' day(s)'}`, ref: s.shipmentId, go: `openShipmentDetail('${s.id}')` });
          }
        }
      }
      // Shipment scope / exception control: keep explicit follow-up decisions visible.
      if (shipmentFollowupActionOpen(s)) {
        const urgent = ['Create next shipment', 'Raise issue'].includes(s.followupAction) ||
          ['Partially received', 'Short received', 'Missing goods', 'Damaged goods'].includes(s.receiptResult || '');
        actions.push({
          tier: urgent ? 'crit' : 'soon',
          what: `${s.followupAction} — ${s.shipmentId}`,
          why: `${s.orderId || ''}${s.shipmentCoverage ? ' · ' + s.shipmentCoverage : ''}${s.partialShipmentReason ? ' · ' + s.partialShipmentReason : ''}${s.receiptResult ? ' · ' + s.receiptResult : ''}`,
          ref: s.shipmentId,
          go: `openShipmentDetail('${s.id}')`
        });
      }
      // Increment 2: GRN received but actual landed cost not entered
      if (s.grnDate && window.__teps_hasTeps && window.__teps_hasTeps(s) &&
          (s.actualLandedCostMUR == null || s.actualLandedCostMUR === '')) {
        const grnN = daysFromToday(s.grnDate);
        actions.push({ tier: grnN !== null && Math.abs(grnN) > 14 ? 'soon' : 'up',
          what: `Enter actual landed cost — ${s.shipmentId}`,
          why: `GRN ${grnN !== null ? Math.abs(grnN) + ' day(s) ago' : 'recorded'} · TEPS estimate outstanding · ${s.orderId || ''}`,
          ref: s.shipmentId, go: `openShipmentDetail('${s.id}')` });
      }
      // Increment 3: container demurrage/detention at risk or overdue
      if (window.PXDemurrage && s.portArrivalDate && (s.mode||s.shipmentMode||'').toLowerCase() === 'sea') {
        const t = window.PXDemurrage.forShipment(s);
        if (t.overall === 'overdue') {
          const dem = t.demurrage.status === 'overdue' ? ` Dem: ${t.demurrage.overdueDays}d over.` : '';
          const det = t.detention.status === 'overdue' ? ` Det: ${t.detention.overdueDays}d over.` : '';
          actions.push({ tier: 'crit', what: `Container charges accruing — ${s.shipmentId}`,
            why: `${s.orderId||''}${dem}${det}${t.totalCost!=null?' Est. '+t.cur+' '+t.totalCost.toFixed(0):''}`,
            ref: s.shipmentId, go: `openShipmentDetail('${s.id}')` });
        } else if (t.overall === 'warning') {
          const rem = Math.min(
            t.demurrage.status === 'warning' ? (t.demurrage.remaining ?? 99) : 99,
            t.detention.status === 'warning' ? (t.detention.remaining ?? 99) : 99
          );
          actions.push({ tier: 'soon', what: `Container free days expiring — ${s.shipmentId}`,
            why: `${s.orderId||''} · ${rem} day(s) remaining before charges start`,
            ref: s.shipmentId, go: `openShipmentDetail('${s.id}')` });
        }
      }
    });
  }

  // ---- My exports/outbound needing attention (logistics) ----
  if (isLogistics && window.PXExports) {
    myExports.forEach(x => {
      const isRT = window.PXExports.isRoundTrip(x);
      // Round-trip item overdue to return
      if (window.PXExports.isOverdue(x)) {
        const exp = x.expectedReturnDate?.toDate ? x.expectedReturnDate.toDate() : (x.expectedReturnDate ? new Date(x.expectedReturnDate) : null);
        const n = exp ? Math.abs(daysFromToday(exp)) : null;
        actions.push({ tier: 'crit', what: `Chase overdue return — ${x.exportRef}`, why: `${window.PXExports.reasonLabel(x.reason)} at ${x.destination||'vendor'}${n!=null?' · '+n+' day(s) overdue':''}`, ref: x.exportRef, go: `window.__openExportDetail('${x.id}')` });
      } else if (isRT && window.PXExports.isOut(x) && x.expectedReturnDate) {
        // Approaching return (within 7 days) — heads-up
        const n = daysFromToday(x.expectedReturnDate);
        if (n !== null && n >= 0 && n <= 7) {
          actions.push({ tier: 'soon', what: `Return due soon — ${x.exportRef}`, why: `Expected back in ${n} day(s) from ${x.destination||'vendor'} (${window.PXExports.reasonLabel(x.reason)})`, ref: x.exportRef, go: `window.__openExportDetail('${x.id}')` });
        }
      }
      // Dispatched status set but no dispatch date (data gap)
      if (x.status && x.status !== 'Draft' && !x.dispatchDate) {
        actions.push({ tier: 'up', what: `Add dispatch date — ${x.exportRef}`, why: `Status is “${x.status}” but no dispatch date recorded`, ref: x.exportRef, go: `window.__openExportDetail('${x.id}')` });
      }
    });
  }
  if (canDoOrders) {
    myOrders.forEach(o => {
      // not acknowledged after N days
      if (!o.orderAcknowledgedDate) {
        const anchor = o.orderSentToSupplierDate || o.dateOfOrder;
        const threshold = window.PXUtils.dataQualityThresholds?.acknowledgementWorkingDays || T.noAckDays;
        const elapsed = window.PXUtils.workingDaysSince ? window.PXUtils.workingDaysSince(anchor, recordEntity(o)) : Math.abs(daysFromToday(anchor));
        if (elapsed !== null && elapsed > threshold) {
          actions.push({ tier: 'soon', what: `Chase supplier acknowledgement — ${o.orderId}`, why: `PO sent ${elapsed} working day(s) ago, not acknowledged`, ref: o.orderId, go: `openOrderDetail('${o.id}')` });
        }
      }
      // foreign order ready but no shipment requested
      if (orderNeedsShipment(o) && o.orderReadyDate) {
        const linked = ships.filter(s => s.orderId === o.orderId);
        const limit = window.PXUtils.dataQualityThresholds?.readyNoShipmentWorkingDays ?? T.readyNoShipmentDays;
        const readyAge = window.PXUtils.workingDaysSince ? window.PXUtils.workingDaysSince(o.orderReadyDate, recordEntity(o)) : Math.abs(daysFromToday(o.orderReadyDate));
        if (linked.length === 0 && readyAge !== null && readyAge > limit) {
          actions.push({ tier: 'soon', what: `Request shipment for ${o.orderId}`, why: `Marked ready ${readyAge} working day(s) ago, no shipment requested`, ref: o.orderId, go: `openOrderDetail('${o.id}')` });
        }
      }
      // requested receipt date approaching with no completed shipment
      if (orderNeedsShipment(o) && o.requestedReceiptDate) {
        const n = daysFromToday(o.requestedReceiptDate);
        const tier = tierForDeadline(n);
        const linked = ships.filter(s => s.orderId === o.orderId);
        const anyReceived = linked.some(s => s.grnDate);
        if (tier && !anyReceived && tier !== 'up') {
          actions.push({ tier, what: `Follow up delivery — ${o.orderId}`, why: `Requested receipt ${n<0?Math.abs(n)+' day(s) overdue':'in '+n+' day(s)'}, nothing received yet`, ref: o.orderId, go: `openOrderDetail('${o.id}')` });
        }
      }
      // open PO line(s) past expected delivery date, or an over-receipt awaiting an exception
      if (window.PXLineFulfilment && !o.isClosed) {
        const lf = window.PXLineFulfilment.forOrder(o);
        if (lf.hasLines) {
          const overdueLines = lf.lines.filter(l => l.open && l.expectedDeliveryDate && daysFromToday(l.expectedDeliveryDate) < 0);
          if (overdueLines.length) {
            const worst = Math.max(...overdueLines.map(l => Math.abs(daysFromToday(l.expectedDeliveryDate))));
            actions.push({ tier: tierForDeadline(-worst) || 'soon', what: `Receive/close PO line(s) — ${o.orderId}`, why: `${overdueLines.length} line(s) open past expected delivery (worst ${worst} day(s))`, ref: o.orderId, go: `openOrderDetail('${o.id}')` });
          }
          if (lf.errors.length) {
            actions.push({ tier: 'crit', what: `Resolve over-receipt — ${o.orderId}`, why: `A PO line received more than ordered without an approved exception`, ref: o.orderId, go: `openOrderDetail('${o.id}')` });
          }
        }
      }
      // ---- Contact-log driven chase prompts ----
      if (window.PXContactLog && !o.isClosed) {
        // (a) we asked, a reply was due, and it has passed
        const overdueR = window.PXContactLog.overdueReplies(o);
        if (overdueR.length) {
          const worst = overdueR[0];
          actions.push({ tier: 'soon', what: `Chase reply — ${o.orderId}`, why: `Reply was expected by ${fmtDate(worst.responseExpectedBy)} (${worst.channel||'contact'}), none received`, ref: o.orderId, go: `openOrderDetail('${o.id}')` });
        } else {
          // (b) active order with no contact logged in a while, still awaiting delivery
          const sinceContact = window.PXContactLog.daysSinceContact(o);
          const awaitingDelivery = !orderNeedsShipment(o) || !ships.some(s => s.orderId === o.orderId && s.grnDate);
          if (awaitingDelivery && sinceContact !== null && sinceContact >= 14) {
            actions.push({ tier: 'up', what: `No recent contact — ${o.orderId}`, why: `${sinceContact} day(s) since the last logged contact on an open order`, ref: o.orderId, go: `openOrderDetail('${o.id}')` });
          }
        }
      }
    });

    // ---- Procurement follow-up controls: supplier commitments, chase plan, risk, ERP/DW exceptions ----
    if (window.PXProcFollowup) {
      const pfCtx = window.PXProcFollowup.context();
      myOrders.forEach(o => {
        const chase = window.PXProcFollowup.nextChase(o);
        if (chase.overdue || chase.dueSoon) {
          const when = chase.overdue
            ? `${Math.abs(chase.daysUntil)} working day(s) overdue`
            : (chase.daysUntil === 0 ? 'due today' : `due in ${chase.daysUntil} working day(s)`);
          actions.push({
            tier: chase.overdue ? 'crit' : 'soon',
            what: `Chase supplier — ${o.orderId}`,
            why: `${when}${chase.method ? ' · ' + chase.method : ''}${o.supplier ? ' · ' + o.supplier : ''}`,
            ref: o.orderId,
            go: `openOrderDetail('${o.id}')`
          });
        }

        const commitment = window.PXProcFollowup.commitment(o, pfCtx);
        if (commitment.overdue) {
          actions.push({
            tier: 'crit',
            what: `Supplier promise overdue — ${o.orderId}`,
            why: `${Math.abs(commitment.daysUntil)} working day(s) overdue${commitment.delayReason ? ' · ' + commitment.delayReason : ''}`,
            ref: o.orderId,
            go: `openOrderDetail('${o.id}')`
          });
        }

        const risk = window.PXProcFollowup.riskScore(o, pfCtx);
        if (['high', 'critical'].includes(risk.level)) {
          actions.push({
            tier: risk.level === 'critical' ? 'crit' : 'soon',
            what: `Review procurement risk — ${o.orderId}`,
            why: `Risk ${risk.level} ${risk.score}${risk.reasons[0] ? ' · ' + risk.reasons[0] : ''}`,
            ref: o.orderId,
            go: `openOrderDetail('${o.id}')`
          });
        }

        const erp = window.PXProcFollowup.erpExceptions(o);
        if (erp.length) {
          const danger = erp.some(e => e.level === 'danger');
          actions.push({
            tier: danger ? 'crit' : 'soon',
            what: `Check ERP/DW exception — ${o.orderId}`,
            why: erp[0].msg,
            ref: o.orderId,
            go: `openOrderDetail('${o.id}')`
          });
        }
      });
    }
  }

  // ---- RFPs missing invoice number (procurement) ----
  if (canEditPayments) {
    myPays.filter(p => !p.invoiceNumber && !['paid','rejected'].includes(p.status)).forEach(p => {
      actions.push({ tier: 'up', what: `Add invoice number to ${p.rfpRef || '(RFP)'}`, why: `${p.orderId||''} · invoice number missing`, ref: p.rfpRef, go: `openPaymentDetail('${p.id}')` });
    });
  }

  // ---- Stakeholder "Request For Update" routed to me (purchasing or logistics officer) ----
  if (window.PXUpdateRequests && myCode) {
    window.PXUpdateRequests.openForOfficer(myCode)
      .filter(r => !mwEnt || r.entity === mwEnt)
      .forEach(r => {
        const sla = window.PXUpdateRequests.slaState(r);
        const tier = sla === 'overdue' ? 'crit' : sla === 'due-soon' ? 'soon' : 'soon';
        const overdueTxt = sla === 'overdue' ? ' · OVERDUE' : r.dueDate ? ` · due ${fmtDate(r.dueDate)}` : '';
        const label = window.PXUpdateRequests.requestTargetLabel ? window.PXUpdateRequests.requestTargetLabel(r) : (r.orderId || '(order)');
        const typeLabel = (r.targetType === 'shipment') ? 'Shipment update requested' : 'Order update requested';
        actions.push({
          tier,
          what: `${typeLabel} — ${label}`,
          why: `From ${r.requestorName || 'stakeholder'}: ${String(r.message||'').slice(0,80)}${(r.message||'').length>80?'…':''}${overdueTxt}`,
          ref: label,
          go: `openAttendRequestModal('${r.id}')`
        });
      });
  }

  // ---- Increment 5c: open claims on my orders ----
  if (canDoOrders) {
    myOrders.forEach(o => {
      const openClaims = Array.isArray(o.claims) ? o.claims.filter(c => c.status === 'open' || c.status === 'under_review') : [];
      openClaims.forEach(c => {
        const tl = window.PXClaims && window.PXClaims.TYPE_LABELS ? window.PXClaims.TYPE_LABELS[c.type] : c.type;
        const sl = window.PXClaims && window.PXClaims.STATUS_LABELS ? window.PXClaims.STATUS_LABELS[c.status] : c.status;
        actions.push({ tier: 'soon', what: `Resolve claim — ${o.orderId}`,
          why: `${tl} · ${sl}${c.amount ? ' · ' + c.currency + ' ' + c.amount : ''}`,
          ref: o.orderId, go: `openOrderDetail('${o.id}')` });
      });
    });
  }

  // ---- Increment 5d: delegation surfacing ----
  if (window.PXDelegation) {
    window.PXDelegation.delegatedTo(myCode).forEach(d => {
      actions.push({ tier: 'up', what: `Delegated items from ${d.fromName||d.fromCode}`,
        why: `Until ${d.until}${d.reason ? ' · ' + d.reason : ''} — covering their queue`,
        ref: d.fromCode, go: `''` });
    });
    const mine = window.PXDelegation.activeFor(myCode);
    if (mine) {
      const to = (state.data.officers||[]).find(x => x.code === mine.delegateTo);
      actions.push({ tier: 'up', what: `⟳ My Work delegated to ${to ? to.fullName : mine.delegateTo}`,
        why: `${mine.reason || 'Delegation active'} — update in Officers & Roles if returning early`,
        ref: myCode, go: `''` });
    }
  }

  // ============================================================
  // OPERATIONAL ACTIONS (Stage 5): follow-ups, issues, documents
  // Personal queue — only items assigned to / owned by me, or linked
  // to my records. Completed/resolved/archived never counted.
  // ============================================================
  // Build the set of record ids that are "mine" (my orders + their shipments/payments)
  const myShipDocIds = new Set();
  const myRecordIds = new Set();
  myOrders.forEach(o => myRecordIds.add(o.id));
  state.data.shipments.forEach(s => {
    if (myOrderIds.has(s.orderId) || s.requestedBy === myCode || s.requestedBy === myName ||
        (isLogistics && (s.logisticOfficer === myName || s.logisticOfficer === myCode))) {
      myShipDocIds.add(s.id); myRecordIds.add(s.id);
    }
  });
  pays.forEach(p => { if (myOrderIds.has(p.orderId)) myRecordIds.add(p.id); });

  // ---- Open follow-ups assigned to me (overdue / due-soon / open) ----
  state.data.followups.filter(f => !f.archived && f.status === 'open' &&
      (f.assignedTo === myCode || (!f.assignedTo && f.officer === myCode))).forEach(f => {
    const n = daysFromToday(f.nextActionDueDate);
    let tier = tierForDeadline(n);
    if (!tier) tier = 'up'; // open follow-up with no due date still surfaces as upcoming
    const when = n === null ? 'no due date' : (n < 0 ? `${Math.abs(n)} day(s) overdue` : (n === 0 ? 'due today' : `due in ${n} day(s)`));
    actions.push({
      tier,
      what: `Follow-up: ${f.nextAction || f.comment || 'open item'}`,
      why: `${when}${f.relatedId ? ' · ' + opRecordLabel(f.relatedType, f.relatedId) : ''}`,
      ref: f.relatedId || f.id,
      go: opRecordGo(f.relatedType, f.relatedId)
    });
  });

  // ---- Issues I own or that are escalated to me (ageing / overdue / critical / escalation) ----
  state.data.issues.filter(i => !i.archived && i.status === 'open' &&
      (i.owner === myCode || i.escalatedTo === myCode)).forEach(i => {
    const age = daysFromToday(i.openedDate);                 // negative = days since opened
    const ageDays = age === null ? null : Math.abs(age);
    const tgt = daysFromToday(i.targetResolutionDate);       // negative = overdue
    const sev = (i.severity || '').toLowerCase();
    const overdue = tgt !== null && tgt < 0;
    const issueEntity = (() => {
      if (i.relatedType === 'order') return recordEntity(orders.find(order => order.id === i.relatedId) || {});
      if (i.relatedType === 'shipment') return entityOfShip(ships.find(shipment => shipment.id === i.relatedId) || {});
      if (i.relatedType === 'payment') return entityOfPay(pays.find(payment => payment.id === i.relatedId) || {});
      return currentEntity();
    })();
    const overdueWorkingDays = overdue && window.PXUtils.workingDaysSince
      ? window.PXUtils.workingDaysSince(i.targetResolutionDate, issueEntity)
      : (overdue ? Math.abs(tgt) : 0);
    const longOpen = ageDays !== null && ageDays >= 14;
    const escalatedToMe = i.escalatedTo === myCode && i.owner !== myCode;
    const tier = (overdue || sev === 'critical' || sev === 'high' || longOpen) ? 'crit' : 'soon';
    const bits = [];
    if (sev) bits.push(sev);
    if (ageDays !== null) bits.push(`open ${ageDays}d`);
    if (overdue) bits.push(`resolution overdue ${Math.abs(tgt)}d${overdueWorkingDays !== null ? ` / ${overdueWorkingDays} working day(s)` : ''}`);
    else if (tgt !== null) bits.push(`due in ${tgt}d`);
    if (escalatedToMe) bits.push(`escalated to you (L${i.escalationLevel || 1})`);
    if (i.relatedId) bits.push(opRecordLabel(i.relatedType, i.relatedId));
    else if (i.shipmentId) bits.push('Shipment ' + i.shipmentId);
    actions.push({
      tier,
      what: `${escalatedToMe ? 'Handle escalated' : 'Resolve'} issue: ${i.issueType || 'exception'}`,
      why: bits.join(' · '),
      ref: i.relatedId || i.shipmentDocId || i.id,
      go: opRecordGo(i.relatedType || 'shipment', i.relatedId || i.shipmentDocId)
    });
    // An overdue Issue is prominent from day one. At 3 working days overdue it must
    // be escalated, unless it is already escalated; critical Issues remain immediate.
    const maxOverdueReached = overdue && overdueWorkingDays !== null && overdueWorkingDays >= 3;
    if ((maxOverdueReached || sev === 'critical') && i.owner === myCode && !(Number(i.escalationLevel) > 0)) {
      actions.push({
        tier: 'crit',
        what: `Escalate issue: ${i.issueType || 'exception'}`,
        why: `${sev === 'critical' ? 'Critical' : `Resolution overdue ${overdueWorkingDays} working day(s) (3-day maximum)`} and not yet escalated${i.relatedId ? ' · ' + opRecordLabel(i.relatedType, i.relatedId) : ''}`,
        ref: i.relatedId || i.shipmentDocId || i.id,
        go: opRecordGo(i.relatedType || 'shipment', i.relatedId || i.shipmentDocId)
      });
    }
  });

  // ---- Documents on my records: requests due, expiring soon, expired, rejected ----
  state.data.documents.filter(d => !d.archived && myRecordIds.has(d.relatedId)).forEach(d => {
    // requested but not received
    if (d.status === 'requested') {
      actions.push({ tier: 'soon', what: `Chase document: ${d.documentType}`, why: `Requested, not received · ${opRecordLabel(d.relatedType, d.relatedId)}`, ref: d.relatedId, go: opRecordGo(d.relatedType, d.relatedId) });
    }
    // rejected — needs action
    if (d.status === 'rejected') {
      actions.push({ tier: 'crit', what: `Rejected document: ${d.documentType}`, why: `${d.rejectedReason ? escapeHtml(d.rejectedReason) : 'Needs re-submission'} · ${opRecordLabel(d.relatedType, d.relatedId)}`, ref: d.relatedId, go: opRecordGo(d.relatedType, d.relatedId) });
    }
    // expiring / expired
    const exp = window.__docExpiryInfo ? window.__docExpiryInfo(d) : null;
    if (exp && exp.state === 'expired') {
      actions.push({ tier: 'crit', what: `Expired document: ${d.documentType}`, why: `${exp.label} · ${opRecordLabel(d.relatedType, d.relatedId)}`, ref: d.relatedId, go: opRecordGo(d.relatedType, d.relatedId) });
    } else if (exp && exp.state === 'soon') {
      actions.push({ tier: 'soon', what: `Document expiring: ${d.documentType}`, why: `${exp.label} · ${opRecordLabel(d.relatedType, d.relatedId)}`, ref: d.relatedId, go: opRecordGo(d.relatedType, d.relatedId) });
    }
  });

  // De-dupe by what+ref, then sort by tier
  const tierRank = { crit: 0, soon: 1, up: 2, wait: 3 };
  const seenA = new Set();
  let dedupActions = actions.filter(a => { const k = a.what+'|'+a.ref; if (seenA.has(k)) return false; seenA.add(k); return true; });
  dedupActions.sort((a,b) => tierRank[a.tier] - tierRank[b.tier]);

  // Stable per-action key (matches the dedup key) used for snooze.
  dedupActions.forEach(a => { a.key = a.what + '|' + a.ref; });
  waiting.forEach(a => { a.key = a.what + '|' + a.ref; });

  // Snooze: pull snoozed actions out of the active queues into a separate list, so
  // the same items don't stare back every morning. They resurface when the snooze
  // date passes. (Computed actions have no record, so snoozes live per-officer in
  // localStorage keyed by a.key — see PXSnooze.)
  const SN = window.PXSnooze;
  let snoozedActions = [];
  if (SN) {
    snoozedActions = dedupActions.filter(a => SN.isSnoozed(a.key));
    dedupActions = dedupActions.filter(a => !SN.isSnoozed(a.key));
  }

  // Resolve each action's entity from its ref (orderId / shipmentId / rfpRef / record doc id)
  const entityOfRef = ref => {
    if (!ref) return 'Phoenix';
    const o = orders.find(x => x.orderId === ref); if (o) return recordEntity(o);
    const s = ships.find(x => x.shipmentId === ref); if (s) return entityOfShip(s);
    const p = pays.find(x => x.rfpRef === ref); if (p) return entityOfPay(p);
    // operational refs use a record's doc id
    const od = orders.find(x => x.id === ref); if (od) return recordEntity(od);
    const sd = ships.find(x => x.id === ref); if (sd) return entityOfShip(sd);
    const pd = pays.find(x => x.id === ref); if (pd) return entityOfPay(pd);
    return 'Phoenix';
  };
  dedupActions.forEach(a => { a.entity = entityOfRef(a.ref); });
  let waitingF = waiting.map(a => { a.entity = entityOfRef(a.ref); return a; });

  // Apply the optional entity chip filter (default All)
  if (mwFilter.entity) {
    dedupActions = dedupActions.filter(a => a.entity === mwFilter.entity);
    waitingF = waitingF.filter(a => a.entity === mwFilter.entity);
  }

  const counts = {
    crit: dedupActions.filter(a => a.tier === 'crit').length,
    soon: dedupActions.filter(a => a.tier === 'soon').length,
    up: dedupActions.filter(a => a.tier === 'up').length,
    wait: waitingF.length
  };

  // The badge = number of items that NEED ACTION (crit + soon + up), matching the
  // ACTION REQUIRED queue. NOTE: the sidebar badge is owned by updateCounts() which
  // is PER-ENTITY (sidebar switcher); we don't set it from the page here so the two
  // never fight. The page may be filtered by its own chip independently.
  const actionCount = counts.crit + counts.soon + counts.up;

  // Count-only mode (sidebar badge): stop here, no DOM render of the page body.
  if (!renderDom) return { counts, actionCount };

  // Keep the sidebar badge in sync (it is per-entity, owned by updateCounts).
  if (window.updateCounts) window.updateCounts();

  const totalItems = myOrders.length + myShipRequests.length + myShipments.length + myPays.length + upcomingMs.length + myExports.length;

  const sectionTable = (title, rows, headers, rowFn, emptyMsg) => `
    <h2 style="margin: 22px 0 10px; font-size: 16px">${title} <span class="text-muted" style="font-size:13px;font-weight:400">(${rows.length})</span></h2>
    ${rows.length ? `<div class="table-wrap"><table class="data">
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(rowFn).join('')}</tbody>
    </table></div>` : `<p class="text-muted text-sm">${emptyMsg}</p>`}
  `;

  // My Day mode: narrow to what needs me TODAY (overdue + due-soon), hiding upcoming
  // and waiting. Persisted per browser. A focused daily queue vs the full backlog.
  const dayMode = (function(){ try { return localStorage.getItem('phoenix_myday') === '1'; } catch(e){ return false; } })();

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title">
        <h1>My Work</h1>
        <span class="desc">${myName || myCode || 'You'} — your orders, shipments, payments and alerts</span>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm ${dayMode?'btn-primary':''}" onclick="window.__toggleMyDay()" title="Show only what needs you today (overdue + due soon)">${dayMode?'★ My Day: ON':'☆ My Day'}</button>
      </div>
    </div>

    ${(() => {
      const renderItem = a => `
        <div class="action-item ${a.tier}">
          <div class="ai-bar"></div>
          <div class="ai-body" onclick="${a.go}" style="cursor:pointer">
            <div class="ai-what">${entBadge(a.entity)} ${escapeHtml(a.what)}</div>
            <div class="ai-why">${escapeHtml(a.why)}</div>
          </div>
          <button class="mw-snooze" title="Snooze this item" onclick="event.stopPropagation(); window.__snoozeAction(${JSON.stringify(a.key).replace(/"/g,'&quot;')})">💤</button>
          <div class="ai-go" onclick="${a.go}" style="cursor:pointer">›</div>
        </div>`;
      const renderSnoozed = a => {
        const until = window.PXSnooze ? window.PXSnooze.snoozedUntil(a.key) : null;
        return `
        <div class="action-item snoozed">
          <div class="ai-bar"></div>
          <div class="ai-body" onclick="${a.go}" style="cursor:pointer">
            <div class="ai-what">${entBadge(a.entity)} ${escapeHtml(a.what)}</div>
            <div class="ai-why">Snoozed until ${until ? fmtDate(until) : '—'} · ${escapeHtml(a.why)}</div>
          </div>
          <button class="mw-snooze" title="Un-snooze (bring back now)" onclick="event.stopPropagation(); window.__unsnoozeAction(${JSON.stringify(a.key).replace(/"/g,'&quot;')})">↩</button>
          <div class="ai-go">›</div>
        </div>`;
      };
      const chipRow = `<div class="mw-entity-chips">
        <span class="mw-ec ${!mwFilter.entity?'on':''}" onclick="window.__setMyworkEntity('')">All</span>
        ${REF.entities.map(e => `<span class="mw-ec ${mwFilter.entity===e.code?'on':''}" onclick="window.__setMyworkEntity('${e.code}')"><span class="e-dot" style="background:${e.accent}"></span>${e.short}</span>`).join('')}
      </div>`;
      const hasAny = dedupActions.length || waitingF.length || snoozedActions.length;
      if (!hasAny) {
        return chipRow + `<div class="card" style="margin-bottom:18px;text-align:center;padding:24px">
          <div style="font-size:28px;margin-bottom:6px">✅</div>
          <div style="font-weight:600">You're all caught up</div>
          <div class="text-sm text-muted">No actions need your attention right now${mwFilter.entity?' for '+escapeHtml(mwFilter.entity):''}.</div>
        </div>`;
      }
      // Active tier (single-select). Persisted in localStorage; default 'crit'.
      const tierFilter = state.filters.myworkTier || (state.filters.myworkTier = { tier: (function(){ try { return localStorage.getItem('phoenix_mywork_tier') || 'crit'; } catch(e){ return 'crit'; } })() });
      // In My Day mode, only overdue + due-soon are relevant.
      const allowedTiers = dayMode ? ['crit','soon'] : ['crit','soon','up','wait','snoozed'];
      const tierAvail = { crit: counts.crit, soon: counts.soon, up: counts.up, wait: counts.wait, snoozed: snoozedActions.length };
      let activeTier = tierFilter.tier;
      if (!allowedTiers.includes(activeTier) || !tierAvail[activeTier]) {
        activeTier = allowedTiers.find(t => tierAvail[t]) || 'crit';
      }
      const pill = (tier, cls, icon, label, n) => (n && allowedTiers.includes(tier))
        ? `<span class="action-pill ${cls} ${activeTier===tier?'on':''}" onclick="window.__setMyworkTier('${tier}')" style="cursor:pointer">${icon} <span class="n">${n}</span> ${label}</span>`
        : '';
      const groupLabels = { crit: '🔴 Overdue / Critical', soon: '🟠 Due Soon', up: '🟡 Upcoming', wait: '⏳ Waiting on Others', snoozed: '💤 Snoozed' };
      const itemsForActive = activeTier === 'wait' ? waitingF
        : activeTier === 'snoozed' ? snoozedActions
        : dedupActions.filter(a => a.tier === activeTier);
      const renderFn = activeTier === 'snoozed' ? renderSnoozed : renderItem;
      return chipRow + `
        <div class="card" style="margin-bottom:18px">
          <div class="card-head" style="margin-bottom:10px"><h3>${dayMode ? 'Today' : 'Action Required'}</h3>${dayMode?'<span class="text-xs text-muted">Overdue and due-soon only</span>':''}</div>
          <div class="action-summary">
            ${pill('crit','crit','🔴','overdue',counts.crit)}
            ${pill('soon','soon','🟠','due soon',counts.soon)}
            ${pill('up','up','🟡','upcoming',counts.up)}
            ${pill('wait','wait','⏳','waiting on others',counts.wait)}
            ${pill('snoozed','snoozed','💤','snoozed',snoozedActions.length)}
          </div>
          <div class="action-group ${activeTier}">
            <div class="action-group-head">${groupLabels[activeTier]} (${itemsForActive.length})</div>
            ${itemsForActive.map(renderFn).join('')}
          </div>
        </div>
      `;
    })()}

    ${sectionTable('My Open Orders', mwOrders,
      ['Order','Supplier','Description','Amount','Status'],
      o => `<tr onclick="openOrderDetail('${o.id}')">
        <td>${entBadge(recordEntity(o))} <span class="mono">${escapeHtml(o.orderId)}</span></td>
        <td class="truncate">${escapeHtml(o.supplier||'—')}</td>
        <td class="text-sm truncate" style="max-width:240px">${escapeHtml(o.description||'—')}</td>
        <td>${fmtMoney(o.amount, o.currency)}</td>
        <td><span class="badge ${statusBadgeClass(o.status)}">${escapeHtml(o.status||'—')}</span></td>
      </tr>`,
      'No open orders assigned to your officer code.')}

    ${sectionTable('Shipment Requests I Created', mwShipReqs,
      ['Shipment','Order','Stage','Supplier'],
      s => { const m = REF.shipmentStages[s.stage||'']||{short:s.stage||'—',badge:'neutral'}; return `<tr onclick="openShipmentDetail('${s.id}')">
        <td>${entBadge(entityOfShip(s))} <span class="mono">${escapeHtml(s.shipmentId||'—')}</span></td>
        <td><span class="mono">${escapeHtml(s.orderId||'—')}</span></td>
        <td><span class="badge ${m.badge}" style="font-size:10.5px">${escapeHtml(m.short)}</span></td>
        <td class="truncate">${escapeHtml(s.supplier||'—')}</td>
      </tr>`; },
      'You have not requested any shipments.')}

    ${isLogistics ? sectionTable('Shipments Assigned to Me', mwShipments,
      ['Shipment','Order','Stage','ETA','GRN'],
      s => { const m = REF.shipmentStages[s.stage||'']||{short:s.stage||'—',badge:'neutral'}; return `<tr onclick="openShipmentDetail('${s.id}')">
        <td>${entBadge(entityOfShip(s))} <span class="mono">${escapeHtml(s.shipmentId||'—')}</span></td>
        <td><span class="mono">${escapeHtml(s.orderId||'—')}</span></td>
        <td><span class="badge ${m.badge}" style="font-size:10.5px">${escapeHtml(m.short)}</span></td>
        <td>${fmtDate(s.eta)||'—'}</td>
        <td>${fmtDate(s.grnDate)||'—'}</td>
      </tr>`; },
      'No shipments assigned to you.') : ''}

    ${isLogistics ? sectionTable('My Exports — Open & Overdue', mwExports,
      ['Ref','Item','Trip','Status','Exp. return',''],
      x => { const isRT = window.PXExports && window.PXExports.isRoundTrip(x);
        const over = window.PXExports && window.PXExports.isOverdue(x);
        return `<tr onclick="window.__openExportDetail('${x.id}')">
        <td>${entBadge(x.entity||'Phoenix')} <span class="mono">${escapeHtml(x.exportRef||'—')}</span></td>
        <td>${escapeHtml((x.itemDescription||'—').slice(0,40))}</td>
        <td><span class="badge neutral" style="font-size:10.5px">${isRT?'Round-trip':'One-way'}</span></td>
        <td><span class="badge ${statusBadgeClass(x.status)}">${escapeHtml(x.status||'—')}</span></td>
        <td style="${over?'color:var(--danger);font-weight:600':''}">${isRT?(fmtDate(x.expectedReturnDate)||'—'):'—'}${over?' (overdue)':''}</td>
        <td>${over?'<span class="badge danger" style="font-size:10px">OVERDUE</span>':''}</td>
      </tr>`; },
      'No open exports assigned to you.') : ''}

    ${sectionTable('Pending Payments on My Orders', mwPays,
      ['RFP','Order','Amount','Due','Status'],
      p => { const d = p.dueDate?.toDate ? p.dueDate.toDate() : (p.dueDate ? new Date(p.dueDate) : null); const od = d && d < today;
        return `<tr onclick="openPaymentDetail('${p.id}')">
        <td>${entBadge(entityOfPay(p))} <span class="mono">${escapeHtml(p.rfpRef||'—')}</span></td>
        <td><span class="mono">${escapeHtml(p.orderId||'—')}</span></td>
        <td>${fmtMoney(p.amount, p.currency)}</td>
        <td style="${od?'color:var(--danger);font-weight:600':''}">${fmtDate(p.dueDate)||'—'}${od?' (overdue)':''}</td>
        <td><span class="badge ${statusBadgeClass(p.status)}">${escapeHtml(p.status||'—')}</span></td>
      </tr>`; },
      'No pending payments on your orders.')}

    ${sectionTable('Upcoming Milestones (next 30 days)', mwUpcomingMs,
      ['Due','Order','Milestone','Amount'],
      um => `<tr onclick="openOrderDetail('${um.order.id}')">
        <td><span class="mono">${fmtDate(um.date)}</span></td>
        <td>${entBadge(recordEntity(um.order))} <span class="mono">${escapeHtml(um.order.orderId)}</span></td>
        <td>${escapeHtml(um.milestone.label)} (${um.milestone.percent}%)</td>
        <td>${fmtMoney(um.milestone.amount, um.order.currency)}</td>
      </tr>`,
      'No milestones due in the next 30 days.')}
  `;
}

// Exposed so the sidebar badge (updateCounts) can compute the SAME count the page
// shows, but scoped to the active sidebar entity (per-entity badge).
window.__myWorkCompute = myWorkCompute;
window.__myWorkCount = function() {
  const ent = window.PXUtils && window.PXUtils.currentEntity ? window.PXUtils.currentEntity() : '';
  const r = myWorkCompute({ renderDom: false, entityOverride: ent });
  return r ? r.actionCount : 0;
};
