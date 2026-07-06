/* ============================================================
   WORKFLOWS — allowed statuses & transitions  (Stage 2c)
   ============================================================
   One place that defines which statuses each record type can hold, and which
   transitions make operational sense. Keeps users from moving records into
   nonsensical states as more features are added.

   This is declarative and advisory: validators.js consults it. Because the
   prototype must never hard-block legitimate work, unknown statuses are treated
   permissively (allowed) — the rules tighten as the real status vocabulary is
   confirmed with the team.

   NOTE (Path B): exposed as window.PXWorkflows; convertible to ES export later. */
(function () {
  const REF = window.REF || {};

  // Allowed status sets. Orders and shipments now have distinct follow-up
  // vocabularies; REF.statuses is retained only for legacy records.
  const listValues = list => (list || []).map(s => (typeof s === 'string' ? s : s.label || s.key)).filter(Boolean);
  const orderStatuses = () => listValues(REF.orderFollowupStatuses || REF.statuses);
  const shipmentStatuses = () => listValues(REF.shipmentFollowupStatuses || REF.statuses);

  // Logical ordering of the core order lifecycle (used to flag "backwards" moves as
  // advisory warnings, not hard errors). Statuses not listed are treated as neutral.
  const orderLifecycle = [
    'Order sent to supplier',
    'Awaiting supplier acknowledgement',
    'Supplier acknowledged',
    'Technical / commercial clarification',
    'Awaiting revised confirmation',
    'Order amendment pending',
    'Quantity / price variance under review',
    'Advance payment required',
    'Advance payment requested',
    'Advance payment completed',
    'Under production / preparation',
    'Awaiting supplier ready date',
    'Ready date confirmed',
    'Supplier delay / revised ready date',
    'Partially ready for collection / dispatch',
    'Fully ready for collection / dispatch',
    'Pending payment before collection / shipment',
    'Pending supplier shipping documents',
    'Collection / shipment requested',
    'Logistics request acknowledged',
    'Partially handed over to logistics',
    'Fully handed over to logistics',
    'Partially collected / dispatched',
    'Fully collected / dispatched',
    'Partially received / GRN pending',
    'Fully received / GRN pending',
    'Fully received / GRN completed',
    'Closure pending payment / document / issue',
    'Order closed'
  ];

  const transitions = {
    shipment: {
      // stage machine
      requested:   ['assigned', 'cancelled'],
      assigned:    ['in_progress', 'requested', 'cancelled'],
      in_progress: ['completed', 'assigned'],
      completed:   [],            // terminal (can be reopened only by admin tooling)
      cancelled:   ['requested']
    },
    payment: {
      draft:     ['submitted', 'cancelled'],
      submitted: ['approved', 'rejected', 'draft'],
      approved:  ['paid', 'rejected'],
      paid:      [],              // terminal
      rejected:  ['draft'],
      cancelled: []
    },
    document: {
      missing:   ['requested', 'received'],
      requested: ['received', 'rejected'],
      received:  ['approved', 'rejected'],
      approved:  ['rejected'],    // can later be rejected (e.g. found invalid)
      rejected:  ['requested', 'received']
    },
    followup: {
      open:      ['done', 'cancelled'],
      done:      ['open'],
      cancelled: ['open']
    },
    issue: {
      open:      ['resolved'],
      resolved:  ['open']
    }
  };

  // Is moving recordType from `from` → `to` allowed?
  // Returns { ok:true } or { ok:false, reason }. Unknown machines/states → allowed.
  function canTransition(recordType, from, to) {
    if (!from || from === to) return { ok: true };
    const machine = transitions[recordType];
    if (!machine) return { ok: true };                 // no machine defined → permissive
    const allowed = machine[from];
    if (allowed === undefined) return { ok: true };    // unknown 'from' state → permissive
    if (allowed.includes(to)) return { ok: true };
    return { ok: false, reason: `Cannot move ${recordType} from "${from}" to "${to}".` };
  }

  // Advisory: is an order status moving backwards in the lifecycle?
  function isBackwardsOrderMove(from, to) {
    const fi = orderLifecycle.indexOf(from), ti = orderLifecycle.indexOf(to);
    return fi !== -1 && ti !== -1 && ti < fi;
  }

  function allowedNext(recordType, from) {
    const machine = transitions[recordType];
    if (!machine || machine[from] === undefined) return null; // null = no restriction
    return machine[from];
  }

  window.PXWorkflows = {
    transitions, orderLifecycle, orderStatuses, shipmentStatuses,
    canTransition, isBackwardsOrderMove, allowedNext
  };
})();
