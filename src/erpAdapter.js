const REF = window.REF;

const NOT_CONNECTED = {
  connected: false,
  message: 'Live ERP integration is not connected yet. Target path is ERP -> Data Warehouse/Staging -> Sync/API service -> Phoenix.'
};

/* ---- Compatibility facade: PhoenixERP remains the public API ----
   Older screens call window.PhoenixERP.*. Keep that API stable, but make the
   intended architecture explicit: Phoenix does not call Navision or Business
   Central directly. The future connector should populate the Data Warehouse /
   staging layer, then a controlled sync service writes the normalised Phoenix
   fields through PXStore. */
class ERPAdapter {
  constructor(name) { this.name = name; this.connected = false; }
  describe() {
    return {
      name: this.name,
      connected: this.connected,
      directBrowserAccess: false,
      integrationPath: REF.warehouseIntegration?.recommendedPath || 'ERP -> Data Warehouse/Staging -> Phoenix'
    };
  }
  async fetchVendors()        { return NOT_CONNECTED; }
  async fetchPurchaseOrders() { return window.PXWarehouse?.fetchPurchaseOrders() || NOT_CONNECTED; }
  async fetchReceipts()       { return NOT_CONNECTED; }
  async fetchInvoices()       { return NOT_CONNECTED; }
  async fetchPayments()       { return NOT_CONNECTED; }

  mapPurchaseOrderToPhoenix(erpPO) {
    if (window.PXWarehouse?.normalisePurchaseOrder) {
      return window.PXWarehouse.normalisePurchaseOrder(erpPO, { erpSource: this.name });
    }
    return {
      integrationLayer: 'data-warehouse',
      erpSource: this.name,
      erpCompany: erpPO?.company || null,
      erpVendorNo: erpPO?.vendorNo || null,
      erpDocumentNo: erpPO?.orderNo || null,
      erpDocumentId: erpPO?.systemId || null,
      erpLastSyncedAt: new Date().toISOString(),
      erpSyncStatus: 'synced',
      orderId: erpPO?.orderNo || null,
      supplier: erpPO?.vendorName || null,
      currency: erpPO?.currency || null,
      amount: erpPO?.amount || null,
      dateOfOrder: erpPO?.orderDate || null,
      description: erpPO?.description || null,
      lines: Array.isArray(erpPO?.lines) ? erpPO.lines : []
    };
  }
}

class NavisionAdapter extends ERPAdapter {
  constructor() { super('Navision'); }
}
class BusinessCentralAdapter extends ERPAdapter {
  constructor() { super('Business Central'); }
}
class ManualAdapter extends ERPAdapter {
  constructor() { super('Manual'); this.connected = true; }
  async fetchPurchaseOrders() { return { connected: true, data: [] }; }
}

const adapters = {
  Manual: new ManualAdapter(),
  Navision: new NavisionAdapter(),
  'Business Central': new BusinessCentralAdapter()
};
let activeAdapter = adapters.Navision;

function integrationNotice(label) {
  const warehouse = window.PXWarehouse?.describe ? window.PXWarehouse.describe() : NOT_CONNECTED;
  const message = `${label}: Data Warehouse sync is not connected yet. Use Excel import as the controlled manual feed until the approved sync is live.`;
  if (window.PXUtils?.toast) window.PXUtils.toast(message, 'info');
  return { ...warehouse, message };
}

async function runWarehouseAction(label, actionName) {
  const action = window.PXWarehouse && window.PXWarehouse[actionName];
  const result = action ? await action() : NOT_CONNECTED;
  if (!result || result.connected === false) return integrationNotice(label);
  return result;
}

window.PhoenixERP = {
  adapters,
  warehouse: () => window.PXWarehouse?.describe ? window.PXWarehouse.describe() : NOT_CONNECTED,
  getActiveAdapter: () => activeAdapter.describe(),
  setActiveAdapter: (name) => { if (adapters[name]) activeAdapter = adapters[name]; return activeAdapter.describe(); },
  statusMap: REF.erpStatusMap,
  mapStatus: (kind, erpStatus) => (REF.erpStatusMap[kind] && REF.erpStatusMap[kind][erpStatus]) || null,

  syncVendorsFromERP:        async () => integrationNotice('Sync vendors'),
  syncPurchaseOrdersFromERP: async () => runWarehouseAction('Sync purchase orders', 'syncPurchaseOrders'),
  syncReceiptsFromERP:       async () => integrationNotice('Sync receipts'),
  syncInvoicesFromERP:       async () => integrationNotice('Sync invoices'),
  syncPaymentsFromERP:       async () => integrationNotice('Sync payments'),
  reconcileERPData:          async () => runWarehouseAction('Reconcile ERP/Data Warehouse feed', 'reconcile')
};
