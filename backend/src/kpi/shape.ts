type JsonValue = Record<string, unknown> | unknown[];

export interface OrderSqlRow {
  id: number;
  integration_layer: string | null;
  entity: string | null;
  erp_source: string | null;
  erp_company: string | null;
  erp_entity_id: string | null;
  erp_document_id: string | null;
  erp_document_no: string | null;
  order_id: string | null;
  erp_vendor_no: string | null;
  erp_vendor_name: string | null;
  supplier: string | null;
  order_type: string | null;
  procurement_function: string | null;
  currency: string | null;
  amount: number | null;
  date_of_order: Date | string | null;
  description: string | null;
  payment_terms: string | null;
  category: string | null;
  ipr_number: string | null;
  ipr_approved_date: Date | string | null;
  claimant: string | null;
  requested_receipt_date: Date | string | null;
  erp_po_status: string | null;
  erp_amount: number | null;
  erp_currency: string | null;
  erp_hod_id: string | null;
  erp_purchasing_mgr_id: string | null;
  erp_created_from_ipr: string | null;
  erp_created_by: string | null;
  erp_purchaser_code: string | null;
  erp_shipment_method: string | null;
  lines_json: string | null;
  warehouse_source: string | null;
  warehouse_record_id: string | null;
  warehouse_batch_id: string | null;
  warehouse_extracted_at: Date | string | null;
  warehouse_loaded_at: Date | string | null;
  warehouse_hash: string | null;
  erp_sync_status: string | null;
  erp_last_synced_at: Date | string | null;
  erp_sync_error: string | null;
  last_refresh_changes_json: string | null;
  last_refresh_at: Date | string | null;
  initial_operational_status: string | null;
  is_closed: boolean | number | null;
}

function dateOnly(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function dateTime(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function jsonOr<T extends JsonValue>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

export function mapOrderRow(row: OrderSqlRow): Record<string, unknown> {
  return {
    id: row.id,
    integrationLayer: row.integration_layer,
    entity: row.entity,
    erpSource: row.erp_source,
    erpCompany: row.erp_company,
    erpEntityId: row.erp_entity_id,
    erpDocumentId: row.erp_document_id,
    erpDocumentNo: row.erp_document_no,
    orderId: row.order_id,
    erpVendorNo: row.erp_vendor_no,
    erpVendorName: row.erp_vendor_name,
    supplier: row.supplier,
    orderType: row.order_type,
    function: row.procurement_function,
    currency: row.currency,
    amount: row.amount,
    dateOfOrder: dateOnly(row.date_of_order),
    description: row.description,
    paymentTerms: row.payment_terms,
    category: row.category,
    iprNumber: row.ipr_number,
    iprApprovedDate: dateOnly(row.ipr_approved_date),
    claimant: row.claimant,
    requestedReceiptDate: dateOnly(row.requested_receipt_date),
    erpPoStatus: row.erp_po_status,
    erpAmount: row.erp_amount,
    erpCurrency: row.erp_currency,
    erpHodId: row.erp_hod_id,
    erpPurchasingMgrId: row.erp_purchasing_mgr_id,
    erpCreatedFromIpr: row.erp_created_from_ipr,
    erpCreatedBy: row.erp_created_by,
    erpPurchaserCode: row.erp_purchaser_code,
    erpShipmentMethod: row.erp_shipment_method,
    lines: jsonOr(row.lines_json, []),
    warehouseSource: row.warehouse_source,
    warehouseRecordId: row.warehouse_record_id,
    warehouseBatchId: row.warehouse_batch_id,
    warehouseExtractedAt: dateTime(row.warehouse_extracted_at),
    warehouseLoadedAt: dateTime(row.warehouse_loaded_at),
    warehouseHash: row.warehouse_hash,
    erpSyncStatus: row.erp_sync_status,
    erpLastSyncedAt: dateTime(row.erp_last_synced_at),
    erpSyncError: row.erp_sync_error,
    lastRefreshChanges: jsonOr(row.last_refresh_changes_json, []),
    lastRefreshAt: dateTime(row.last_refresh_at),
    initialOperationalStatus: row.initial_operational_status,
    isClosed: row.is_closed === true || row.is_closed === 1
  };
}

export function coverageBlock(): { excluded: string[]; reason: string } {
  return {
    excluded: ["otif", "cycleTimeThroughGrn", "supplierScorecards", "liveOperationalStatus"],
    reason: "Shipment/payment/GRN and live Phoenix operational data are not in SQL yet (WD connector syncs ERP order data only)."
  };
}
