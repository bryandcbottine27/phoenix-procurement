/* ============================================================
   PERMISSIONS — consolidated access checks  (Stage 2c)
   ============================================================
   The base resource/action engine lives in core (window.PXUtils.can) and reads
   REF.permissions. This module adds a higher-level, record-aware API so callers
   can ask richer questions in one consistent place:

       PXPermissions.can(action, record, user?)

   It delegates the base resource/action check to PXUtils.can, then layers on
   record-aware rules (e.g. you cannot edit ERP-locked fields; you cannot edit a
   closed order; only certain roles verify documents or approve payments).

   Prototype stance: permissive by default — unknown combinations are allowed so
   the app never locks out legitimate work. This is UI-layer guidance; real
   server-side enforcement comes with real login (same matrix → Firestore rules).

   NOTE (Path B): exposed as window.PXPermissions; convertible to ES export later. */
(function () {
  const baseCan = (resource, action) => (window.PXUtils ? window.PXUtils.can(resource, action) : true);
  const role = () => (window.PXUtils ? window.PXUtils.currentRole() : 'admin');

  // Map high-level actions → the (resource, action) the base matrix understands.
  const ACTION_MAP = {
    create:           r => [r, 'create'],
    edit:             r => [r, 'edit'],
    archive:          r => [r, 'archive'],
    'delete':         r => [r, 'archive'],          // delete treated as archive-level authority
    export:           () => ['reports', 'view'],
    closeOrder:       () => ['orders', 'edit'],
    verifyDocument:   () => ['documents', 'edit'],
    rejectDocument:   () => ['documents', 'edit'],
    approvePayment:   () => ['payments', 'edit'],
    editSupplierRating: () => ['suppliers', 'edit'],
    editErpField:     () => ['orders', 'edit'],
    manageReference:  () => ['officers', 'edit']
  };

  // resourceFor: infer the matrix resource from a record kind
  const RESOURCE_FOR = {
    order: 'orders', shipment: 'shipments', payment: 'payments',
    supplier: 'suppliers', officer: 'officers',
    document: 'documents', followup: 'followups', issue: 'issues'
  };

  /* can(action, record?, user?)
     - action: one of ACTION_MAP keys, OR a plain "resource:action" string
     - record: optional { kind, ...fields } for record-aware checks
     Returns boolean. */
  function can(action, record, user) {
    // explicit "resource:action" form
    if (typeof action === 'string' && action.includes(':')) {
      const [res, act] = action.split(':');
      return baseCan(res, act);
    }
    const kind = record && record.kind;
    const resource = (kind && RESOURCE_FOR[kind]) || (record && record.resource) || 'orders';
    const mapped = ACTION_MAP[action] ? ACTION_MAP[action](resource) : [resource, action];
    let ok = baseCan(mapped[0], mapped[1]);
    if (!ok) return false;

    // ----- record-aware refinements -----
    if (record) {
      // cannot edit a closed order (admins may)
      if (action === 'edit' && kind === 'order' && record.isClosed && role() !== 'admin') {
        return false;
      }
      // editing an ERP-locked field requires the field be editable for that record
      if (action === 'editErpField' && window.PXOwnership && record.field) {
        if (!window.PXOwnership.isEditable(record, record.field)) return false;
      }
    }
    return true;
  }

  // Convenience helpers mirroring the spec's action list
  const canCreate        = kind => can('create', { kind });
  const canEdit          = (kind, record) => can('edit', { kind, ...(record || {}) });
  const canArchive       = kind => can('archive', { kind });
  const canExport        = () => can('export');
  const canCloseOrder    = order => can('closeOrder', { kind: 'order', ...(order || {}) });
  const canVerifyDocument= () => can('verifyDocument');
  const canApprovePayment= () => can('approvePayment');
  const canEditSupplierRating = () => can('editSupplierRating');
  const canManageReference= () => can('manageReference');

  window.PXPermissions = {
    can, canCreate, canEdit, canArchive, canExport, canCloseOrder,
    canVerifyDocument, canApprovePayment, canEditSupplierRating, canManageReference,
    ACTION_MAP, RESOURCE_FOR
  };
})();
