import { PurchaseOrderContract, stripToOrderContract } from "./contract";

export interface PurchaseOrderNormaliseOptions {
  erpSource?: string;
  erpCompany?: string;
  integrationLayer?: string;
  warehouseSource?: string;
  warehouseBatchId?: string;
  warehouseLoadedAt?: string;
}

type SourceRow = Record<string, unknown>;

function pick(row: SourceRow, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function linesOrEmpty(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === "object") as Record<string, unknown>[] : [];
}

function upperCurrency(value: unknown): string | null {
  const currency = text(value);
  return currency ? currency.toUpperCase() : null;
}

export function normalisePurchaseOrder(row: SourceRow = {}, opts: PurchaseOrderNormaliseOptions = {}): PurchaseOrderContract {
  const erpSource = text(pick(row, ["erpSource", "sourceSystem", "source"])) || opts.erpSource || "Navision";
  const erpDocumentNo = text(pick(row, ["erpDocumentNo", "documentNo", "poNumber", "orderId"]));
  const now = new Date().toISOString();
  const amount = numberOrNull(pick(row, ["amount", "totalAmount", "amountIncludingVat"]));
  const erpAmount = numberOrNull(pick(row, ["erpAmount", "amount", "totalAmount", "amountIncludingVat"]));

  return stripToOrderContract({
    integrationLayer: text(pick(row, ["integrationLayer"])) || opts.integrationLayer || "data-warehouse",
    warehouseSource: text(pick(row, ["warehouseSource", "sourceView", "sourceTable"])) || opts.warehouseSource || null,
    warehouseRecordId: text(pick(row, ["warehouseRecordId", "recordId", "rowId"])) || null,
    warehouseBatchId: text(pick(row, ["warehouseBatchId", "batchId", "loadBatchId"])) || opts.warehouseBatchId || null,
    warehouseExtractedAt: text(pick(row, ["warehouseExtractedAt", "extractedAt", "sourceExtractedAt"])) || null,
    warehouseLoadedAt: text(pick(row, ["warehouseLoadedAt", "loadedAt"])) || opts.warehouseLoadedAt || now,
    warehouseHash: text(pick(row, ["warehouseHash", "rowHash", "changeHash"])) || null,
    entity: text(pick(row, ["entity", "companyEntity", "legalEntity"])),
    erpSource,
    erpCompany: text(pick(row, ["erpCompany", "company", "companyName"])) || opts.erpCompany || null,
    erpEntityId: text(pick(row, ["erpEntityId", "companyId", "entityId"])) || null,
    erpDocumentId: text(pick(row, ["erpDocumentId", "systemId", "documentGuid"])) || null,
    erpDocumentNo,
    orderId: text(pick(row, ["orderId", "poNumber", "documentNo"])) || erpDocumentNo,
    supplier: text(pick(row, ["supplier", "vendorName", "erpVendorName"])),
    erpVendorName: text(pick(row, ["erpVendorName", "vendorName", "supplier"])),
    erpVendorNo: text(pick(row, ["erpVendorNo", "vendorNo", "vendorNumber"])),
    orderType: text(pick(row, ["orderType", "poType", "purchaseOrderType"])),
    function: text(pick(row, ["function", "procurementFunction", "categoryFunction"])),
    currency: upperCurrency(pick(row, ["currency", "currencyCode"])),
    amount,
    erpAmount,
    erpCurrency: upperCurrency(pick(row, ["erpCurrency", "currency", "currencyCode"])),
    dateOfOrder: text(pick(row, ["dateOfOrder", "orderDate", "documentDate"])),
    description: text(pick(row, ["description", "purpose", "postingDescription"])),
    paymentTerms: text(pick(row, ["paymentTerms", "paymentTermsCode"])),
    category: text(pick(row, ["category", "procurementCategory"])),
    iprNumber: text(pick(row, ["iprNumber", "createdFromIpr"])),
    iprApprovedDate: text(pick(row, ["iprApprovedDate", "hodApprovedDate"])),
    claimant: text(pick(row, ["claimant", "requestedBy"])),
    erpPoStatus: text(pick(row, ["erpPoStatus", "poStatus", "status"])),
    requestedReceiptDate: text(pick(row, ["requestedReceiptDate", "requestedReceipt", "expectedReceiptDate"])),
    erpHodId: text(pick(row, ["erpHodId", "hodId", "hodCode"])),
    erpPurchasingMgrId: text(pick(row, ["erpPurchasingMgrId", "purchasingMgrId", "purchasingManagerId"])),
    erpCreatedFromIpr: text(pick(row, ["erpCreatedFromIpr", "createdFromIpr"])),
    erpCreatedBy: text(pick(row, ["erpCreatedBy", "createdBy"])),
    erpPurchaserCode: text(pick(row, ["erpPurchaserCode", "purchaserCode"])),
    erpShipmentMethod: text(pick(row, ["erpShipmentMethod", "shipmentMethodCode"])),
    lines: linesOrEmpty(row.lines)
  });
}
