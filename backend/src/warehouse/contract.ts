export const ORDER_CONTRACT_FIELDS = [
  "integrationLayer", "entity", "erpSource", "erpCompany", "erpEntityId",
  "erpDocumentId", "erpDocumentNo", "orderId",
  "erpVendorNo", "erpVendorName", "supplier",
  "orderType", "function",
  "currency", "amount", "dateOfOrder", "description",
  "paymentTerms", "category", "iprNumber", "iprApprovedDate",
  "claimant", "requestedReceiptDate", "erpPoStatus",
  "erpAmount", "erpCurrency", "erpHodId", "erpPurchasingMgrId",
  "erpCreatedFromIpr", "erpCreatedBy", "erpPurchaserCode",
  "erpShipmentMethod", "lines",
  "warehouseSource", "warehouseRecordId", "warehouseBatchId",
  "warehouseExtractedAt", "warehouseLoadedAt", "warehouseHash"
] as const;

export type OrderContractField = typeof ORDER_CONTRACT_FIELDS[number];

export type PurchaseOrderLine = Record<string, unknown>;

export type PurchaseOrderContract = Partial<Record<OrderContractField, unknown>> & {
  lines: PurchaseOrderLine[];
};

export const ORDER_CONTRACT_FIELD_SET = new Set<string>(ORDER_CONTRACT_FIELDS);

export function stripToOrderContract(record: Record<string, unknown>): PurchaseOrderContract {
  const out: Partial<Record<OrderContractField, unknown>> = {};
  for (const field of ORDER_CONTRACT_FIELDS) {
    if (record[field] !== undefined) out[field] = record[field];
  }
  return {
    ...out,
    lines: Array.isArray(out.lines) ? out.lines as PurchaseOrderLine[] : []
  };
}
