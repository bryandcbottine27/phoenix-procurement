/* ============================================================
   ERP OWNERSHIP — single source of truth  (Stage 2b)
   ============================================================
   Phoenix is an OPERATIONAL CONTROL LAYER on top of the ERP, not a 2nd ERP.
   This module is the ONE place that answers:
     • Who owns a field — ERP or Phoenix?
     • Is a field read-only (ERP-locked), seed-once (ERP fills, Phoenix may edit),
       or fully Phoenix-owned?
     • How do ERP (Navision / Business Central) fields map onto Phoenix fields?

   It consolidates rules that previously lived only in REF.erpOwnership and the
   field helpers, and exposes them as window.PXOwnership so future features and
   validators can ask ownership questions in one consistent way.

   NOTE (Path B): wired through window.* like the rest of the app for now; a later
   pass can convert to real import/export without changing call sites. */
(function () {
  const REF = window.REF;

  // The authoritative ownership lists (sourced from REF so there is still ONE copy).
  const lists = () => REF.erpOwnership || { erpLocked: [], erpFillOnce: [], appOwned: [] };

  // Classify a single field for the ORDERS collection (the only ERP-backed collection today).
  //   'erp-locked'  → ERP is the boss; read-only in Phoenix for ERP-sourced records
  //   'erp-seed'    → ERP provides a starting value; Phoenix may override
  //   'phoenix'     → Phoenix-owned operational field
  function ownershipOf(fieldKey) {
    const L = lists();
    if (L.erpLocked.includes(fieldKey))  return 'erp-locked';
    if (L.erpFillOnce.includes(fieldKey)) return 'erp-seed';
    return 'phoenix';
  }

  // Is the field editable in Phoenix for THIS record?
  //   • Manual records: everything editable.
  //   • ERP records: erp-locked fields are read-only; everything else editable.
  function isEditable(record, fieldKey) {
    const isErp = window.PXUtils ? window.PXUtils.isErpOrder(record) : false;
    if (!isErp) return true;
    return ownershipOf(fieldKey) !== 'erp-locked';
  }

  // Shipments, payment_requests, suppliers, documents, followups, issues, officers
  // have no ERP counterpart in this design → everything is Phoenix-owned.
  const PHOENIX_OWNED_COLLECTIONS = ['shipments', 'payment_requests', 'suppliers',
                                     'documents', 'followups', 'issues', 'officers', 'status_log'];
  function collectionIsPhoenixOwned(coll) {
    return PHOENIX_OWNED_COLLECTIONS.includes(coll);
  }

  /* ----------------------------------------------------------
     ERP → Phoenix field mapping placeholders.
     These describe how an incoming ERP purchase order maps onto Phoenix order
     fields. The real Data Warehouse sync service will use these; nothing here
     makes a live call. Navision and Business Central
     use different field names for the same concept, so each has its own map.
     ---------------------------------------------------------- */
  const navisionMap = {
    // phoenixField : navisionField
    orderId:        'Document_No',
    supplier:       'Buy_from_Vendor_Name',
    erpVendorNo:    'Buy_from_Vendor_No',
    currency:       'Currency_Code',
    amount:         'Amount_Including_VAT',
    dateOfOrder:    'Order_Date',
    description:    'Posting_Description',
    paymentTerms:   'Payment_Terms_Code',
    erpOrderNo:     'No',
    erpOrderLineNo: 'Line_No',
    erpItemNo:      'No_2',
    status:         'Status'
  };

  const businessCentralMap = {
    // phoenixField : businessCentralField (BC uses different casing / API names)
    orderId:        'number',
    supplier:       'vendorName',
    erpVendorNo:    'vendorNumber',
    currency:       'currencyCode',
    amount:         'totalAmountIncludingTax',
    dateOfOrder:    'orderDate',
    description:    'note',
    paymentTerms:   'paymentTermsId',
    erpOrderNo:     'number',
    erpOrderLineNo: 'sequence',
    erpItemNo:      'itemId',
    status:         'status'
  };

  function mapFor(erpSource) {
    if (erpSource === 'Business Central') return businessCentralMap;
    if (erpSource === 'Navision') return navisionMap;
    return {};
  }

  // Given a raw ERP record + source, produce a Phoenix-shaped partial order.
  // Placeholder transform — the live plug-in will refine types/dates.
  function mapErpToPhoenix(erpRecord, erpSource) {
    const map = mapFor(erpSource);
    const out = { erpSource };
    Object.keys(map).forEach(phoenixField => {
      const erpField = map[phoenixField];
      if (erpRecord && erpRecord[erpField] !== undefined) out[phoenixField] = erpRecord[erpField];
    });
    return out;
  }

  window.PXOwnership = {
    ownershipOf,
    isEditable,
    collectionIsPhoenixOwned,
    PHOENIX_OWNED_COLLECTIONS,
    navisionMap,
    businessCentralMap,
    mapFor,
    mapErpToPhoenix,
    // expose the raw lists for tooling/inspection
    get lists() { return lists(); }
  };
})();
