/* ============================================================
   DATA WAREHOUSE / STAGING ADAPTER
   ============================================================
   Target integration shape:

     Navision / Business Central
              ↓
       Data Warehouse / staging views
              ↓
       Controlled sync/API service
              ↓
       Phoenix Procurement

   The browser must not connect directly to Navision, Business Central, or the
   warehouse. This module defines the neutral contract and normalisation helpers
   the future sync service should satisfy. For the current prototype it returns
   a clear "not connected" status and keeps the Excel import working as the
   manual equivalent of a warehouse feed. */
(function () {
  const NOT_CONNECTED = {
    connected: false,
    layer: 'data_warehouse',
    message: 'Data Warehouse integration is not connected yet. Current ERP data comes from the controlled Excel import feed.'
  };

  const ORDER_CONTRACT_FIELDS = [
    'integrationLayer', 'entity', 'erpSource', 'erpCompany', 'erpEntityId',
    'erpDocumentId', 'erpDocumentNo', 'orderId',
    'erpVendorNo', 'erpVendorName', 'supplier',
    'orderType', 'function',
    'currency', 'amount', 'dateOfOrder', 'description',
    'paymentTerms', 'category', 'iprNumber', 'iprApprovedDate',
    'claimant', 'requestedReceiptDate', 'erpPoStatus',
    'erpAmount', 'erpCurrency', 'erpHodId', 'erpPurchasingMgrId',
    'erpCreatedFromIpr', 'erpCreatedBy', 'erpPurchaserCode',
    'erpShipmentMethod', 'lines',
    'warehouseSource', 'warehouseRecordId', 'warehouseBatchId',
    'warehouseExtractedAt', 'warehouseLoadedAt', 'warehouseHash'
  ];

  function pick(row, keys) {
    for (const key of keys) {
      if (row && row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
    }
    return null;
  }

  function stripEmpty(record) {
    const out = {};
    Object.entries(record || {}).forEach(([key, value]) => {
      if (value !== undefined) out[key] = value;
    });
    return out;
  }

  function describe() {
    return {
      ...NOT_CONNECTED,
      readOnly: true,
      inboundOnly: true,
      recommendedPath: 'ERP -> Data Warehouse/Staging -> Sync/API service -> Phoenix',
      purchaseOrderContract: ORDER_CONTRACT_FIELDS.slice(),
      owns: {
        refreshedByWarehouse: ['erp-locked fields', 'erp metadata', 'warehouse provenance'],
        neverTouchedByWarehouse: ['status', 'milestones', 'shipments', 'documents', 'followups', 'issues', 'payment request workflow']
      }
    };
  }

  function normalisePurchaseOrder(row = {}, opts = {}) {
    const erpSource = pick(row, ['erpSource', 'sourceSystem', 'source']) || opts.erpSource || 'Navision';
    const erpDocumentNo = pick(row, ['erpDocumentNo', 'documentNo', 'poNumber', 'orderId']);
    const now = new Date().toISOString();
    return stripEmpty({
      integrationLayer: opts.integrationLayer || row.integrationLayer || 'data-warehouse',
      warehouseSource: pick(row, ['warehouseSource', 'sourceView', 'sourceTable']) || opts.warehouseSource || null,
      warehouseRecordId: pick(row, ['warehouseRecordId', 'recordId', 'rowId']) || null,
      warehouseBatchId: pick(row, ['warehouseBatchId', 'batchId', 'loadBatchId']) || opts.warehouseBatchId || null,
      warehouseExtractedAt: pick(row, ['warehouseExtractedAt', 'extractedAt', 'sourceExtractedAt']) || null,
      warehouseLoadedAt: pick(row, ['warehouseLoadedAt', 'loadedAt']) || opts.warehouseLoadedAt || now,
      warehouseHash: pick(row, ['warehouseHash', 'rowHash', 'changeHash']) || null,
      erpSource,
      erpCompany: pick(row, ['erpCompany', 'company', 'companyName']) || opts.erpCompany || null,
      erpEntityId: pick(row, ['erpEntityId', 'companyId', 'entityId']) || null,
      erpDocumentId: pick(row, ['erpDocumentId', 'systemId', 'documentGuid']) || null,
      erpDocumentNo,
      orderId: pick(row, ['orderId', 'poNumber', 'documentNo']) || erpDocumentNo,
      supplier: pick(row, ['supplier', 'vendorName', 'erpVendorName']),
      erpVendorName: pick(row, ['erpVendorName', 'vendorName', 'supplier']),
      erpVendorNo: pick(row, ['erpVendorNo', 'vendorNo', 'vendorNumber']),
      orderType: pick(row, ['orderType', 'poType', 'purchaseOrderType']),
      function: pick(row, ['function', 'procurementFunction', 'categoryFunction']),
      currency: pick(row, ['currency', 'currencyCode']),
      amount: pick(row, ['amount', 'totalAmount', 'amountIncludingVat']),
      erpAmount: pick(row, ['erpAmount', 'amount', 'totalAmount', 'amountIncludingVat']),
      erpCurrency: pick(row, ['erpCurrency', 'currency', 'currencyCode']),
      dateOfOrder: pick(row, ['dateOfOrder', 'orderDate', 'documentDate']),
      description: pick(row, ['description', 'purpose', 'postingDescription']),
      paymentTerms: pick(row, ['paymentTerms', 'paymentTermsCode']),
      category: pick(row, ['category', 'procurementCategory']),
      iprNumber: pick(row, ['iprNumber', 'createdFromIpr']),
      iprApprovedDate: pick(row, ['iprApprovedDate', 'hodApprovedDate']),
      claimant: pick(row, ['claimant', 'requestedBy']),
      erpPoStatus: pick(row, ['erpPoStatus', 'poStatus', 'status']),
      requestedReceiptDate: pick(row, ['requestedReceiptDate', 'requestedReceipt', 'expectedReceiptDate']),
      erpHodId: pick(row, ['erpHodId', 'hodId', 'hodCode']),
      erpPurchasingMgrId: pick(row, ['erpPurchasingMgrId', 'purchasingMgrId', 'purchasingManagerId']),
      erpCreatedFromIpr: pick(row, ['erpCreatedFromIpr', 'createdFromIpr']),
      erpCreatedBy: pick(row, ['erpCreatedBy', 'createdBy']),
      erpPurchaserCode: pick(row, ['erpPurchaserCode', 'purchaserCode']),
      erpShipmentMethod: pick(row, ['erpShipmentMethod', 'shipmentMethodCode']),
      lines: Array.isArray(row.lines) ? row.lines : []
    });
  }

  function isWarehouseBacked(record) {
    return !!record && ['data-warehouse', 'warehouse-sync'].includes(record.integrationLayer);
  }

  function sourceLabel(record) {
    if (!record) return 'Manual';
    if (record.integrationLayer === 'excel-import') return 'Excel feed';
    if (isWarehouseBacked(record)) return record.warehouseSource || 'Data Warehouse';
    return record.erpSource || 'Manual';
  }

  async function notConnected() { return NOT_CONNECTED; }

  window.PXWarehouse = {
    NOT_CONNECTED,
    ORDER_CONTRACT_FIELDS,
    describe,
    normalisePurchaseOrder,
    isWarehouseBacked,
    sourceLabel,
    health: notConnected,
    fetchPurchaseOrders: notConnected,
    syncPurchaseOrders: notConnected,
    reconcile: notConnected
  };
})();
