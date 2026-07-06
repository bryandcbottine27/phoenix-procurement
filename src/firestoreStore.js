/* ============================================================
   CENTRALISED FIRESTORE STORE — firestoreStore.js  (Stage 2a, extracted in cleanup)
   ============================================================
   The ONE place writes happen. Every create/update/archive routes through here so
   behaviour is consistent:
     • PXValidators runs first (errors block; warnings logged)
     • stripUndefined() applied automatically (no "undefined" Firestore errors)
     • createdAt/createdBy on create; updatedAt/updatedBy on every write
     • optional status/audit logging to status_log

   Modules call window.PXStore.* — never addDoc/updateDoc/deleteDoc directly.
   Uses window.__db, window.__fs (Firestore primitives), window.__state, and
   window.PXUtils.stripUndefined — all set up by core.js, which loads first. */
(function () {
  const db = window.__db;
  const { collection, doc, addDoc, updateDoc, serverTimestamp } = window.__fs;
  const stripUndefined = (window.PXUtils && window.PXUtils.stripUndefined) || (x => x);
  const state = window.__state;

  const who = () => (state.officer && state.officer.code) || (state.user && state.user.email) || 'unknown';
  const STATE_KEY_FOR_COLLECTION = {
    payment_requests: 'payments',
    updateRequests: 'updateRequests',
    contactLog: 'contactLog',
    kpiSnapshot: 'kpiSnapshot'
  };
  const RESOURCE_FOR_COLLECTION = {
    orders: 'orders',
    shipments: 'shipments',
    payment_requests: 'payments',
    suppliers: 'suppliers',
    documents: 'documents',
    followups: 'followups',
    issues: 'issues',
    updateRequests: 'updateRequests',
    officers: 'officers'
  };

  function permissionActionFor(action) {
    if (action === 'update') return 'edit';
    if (action === 'restore') return 'archive';
    return action;
  }

  function assertWriteAllowed(collectionName, action, opts = {}) {
    if (opts.skipPermission) return;
    const px = window.PXUtils || {};
    const resource = opts.permissionResource || RESOURCE_FOR_COLLECTION[collectionName];
    const permAction = opts.permissionAction || permissionActionFor(action);
    if (resource && px.can && px.can(resource, permAction)) return;

    // System/reference writes have no normal business collection resource. Keep
    // them privileged even in demo mode so view-only roles cannot mutate config.
    if (!resource && collectionName === 'system_config' && px.currentRole && px.currentRole() === 'admin') return;
    if (!resource && collectionName === 'kpiSnapshot' && px.isPrivileged && px.isPrivileged()) return;

    const label = collectionName === 'payment_requests' ? 'payment requests' : collectionName;
    throw new Error(`Not authorised to ${permAction} ${label}.`);
  }

  // Map Firestore collection → PXValidators record type.
  const VALIDATOR_TYPE = {
    orders: 'order', shipments: 'shipment', payment_requests: 'payment',
    suppliers: 'supplier', documents: 'document',
    updateRequests: 'updateRequest', contactLog: 'contactLog', kpiSnapshot: 'kpiSnapshot'
    // followups and issues are intentionally unvalidated (no validator defined);
    // they pass through the permissive default. Listing them here would be a dead mapping.
  };

  // Centralised validation gate. Errors THROW (blocking the write); warnings are
  // logged consistently. Forms may also validate up-front (to show a friendly
  // confirm dialog); this is the safety net so validation is inherited even if a
  // future form forgets to call it. Pass opts.skipValidation:true for internal
  // system writes (archive/restore/milestone-sync) that shouldn't be re-validated.
  function runValidation(collectionName, data, existing, opts) {
    if (opts && opts.skipValidation) return;
    if (!window.PXValidators) return;
    const kind = VALIDATOR_TYPE[collectionName];
    if (!kind) return; // collection has no validator (status_log, system_config, officers)
    const result = window.PXValidators.validate(kind, data, existing || null);
    if (result.warnings && result.warnings.length) {
      console.warn(`[PXStore] ${collectionName} validation warnings:`, result.warnings);
    }
    if (!result.ok) {
      throw new Error((result.errors && result.errors[0]) || 'Validation failed');
    }
  }

  async function createRecord(collectionName, data, opts = {}) {
    assertWriteAllowed(collectionName, 'create', opts);
    runValidation(collectionName, data, null, opts);
    const payload = stripUndefined({
      ...data,
      createdAt: serverTimestamp(), createdBy: who(),
      updatedAt: serverTimestamp(), updatedBy: who()
    });
    const ref = await addDoc(collection(db, collectionName), payload);
    if (opts.log) {
      await logStatusChange(opts.log.recordType || collectionName, opts.log.recordId || ref.id,
                            opts.log.action || 'created', opts.log.details || '');
    }
    return ref;
  }

  // Normalise any timestamp shape (Firestore Timestamp, ISO string, Date, millis)
  // to a comparable epoch-millis number, or null if absent/unparseable.
  function tsMillis(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? null : t; }
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
    if (v instanceof Date) return v.getTime();
    return null;
  }

  async function updateRecord(collectionName, id, data, opts = {}) {
    assertWriteAllowed(collectionName, 'update', opts);
    // For updates, merge with the existing record so validators see the full picture.
    let existing = null;
    if (state && state.data) {
      const coll = state.data[STATE_KEY_FOR_COLLECTION[collectionName] || collectionName];
      if (Array.isArray(coll)) existing = coll.find(r => r.id === id) || null;
    }
    // Optimistic concurrency: if the caller passed the updatedAt it loaded the record
    // with, reject the write when the live record has moved on (someone else saved
    // first). Opt-in — callers that don't pass expectedUpdatedAt are unaffected.
    if (opts.expectedUpdatedAt !== undefined && existing) {
      const live = tsMillis(existing.updatedAt);
      const expected = tsMillis(opts.expectedUpdatedAt);
      if (live != null && expected != null && live > expected) {
        const err = new Error('STALE_WRITE');
        err.code = 'STALE_WRITE';
        err.collection = collectionName; err.id = id;
        throw err;
      }
    }
    runValidation(collectionName, existing ? { ...existing, ...data } : data, existing, opts);
    const payload = stripUndefined({
      ...data,
      updatedAt: serverTimestamp(), updatedBy: who()
    });
    await updateDoc(doc(db, collectionName, id), payload);
    if (opts.log) {
      await logStatusChange(opts.log.recordType || collectionName, id,
                            opts.log.action || 'updated', opts.log.details || '');
    }
    return id;
  }

  // Soft-delete (audit-safe). Used across all business records.
  async function archiveRecord(collectionName, id, reason) {
    assertWriteAllowed(collectionName, 'archive');
    await updateDoc(doc(db, collectionName, id), stripUndefined({
      archived: true, archivedAt: serverTimestamp(), archivedBy: who(),
      archiveReason: reason || null,
      updatedAt: serverTimestamp(), updatedBy: who()
    }));
    return id;
  }

  async function restoreRecord(collectionName, id) {
    assertWriteAllowed(collectionName, 'restore');
    await updateDoc(doc(db, collectionName, id), stripUndefined({
      archived: false, archivedAt: null, archiveReason: null,
      updatedAt: serverTimestamp(), updatedBy: who()
    }));
    return id;
  }

  // Append-only audit/status entry. Never throws into the caller's flow.
  async function logStatusChange(recordType, recordId, action, details, extraFields = {}) {
    try {
      await addDoc(collection(db, 'status_log'), stripUndefined({
        ...extraFields,
        entryType: recordType, refId: recordId,
        action: action || 'changed', entryText: details || '',
        officerCode: who(), at: serverTimestamp()
      }));
    } catch (e) { console.warn('status_log write skipped:', e && e.message); }
  }

  window.PXStore = { createRecord, updateRecord, archiveRecord, restoreRecord, logStatusChange };
})();
