import { dwSource } from "../sources/dwSource";
import * as sql from "mssql";
import { queryParams, SqlQueryExecutor, typedParam, withTransaction } from "../sql/client";
import { OrderContractField, PurchaseOrderContract } from "../warehouse/contract";

type OrderRecord = Record<string, unknown>;

export interface FieldColumn {
  field: OrderContractField;
  column: string;
  param: string;
  value?: (order: PurchaseOrderContract) => unknown;
}

interface ExistingOrderRow {
  id: number;
  amount: number | null;
  currency: string | null;
  requested_receipt_date: Date | string | null;
}

export interface PurchaseOrderSyncOptions {
  orders?: PurchaseOrderContract[];
  fetchPurchaseOrders?: () => Promise<PurchaseOrderContract[]>;
  query?: SqlQueryExecutor;
  batchId?: string;
  now?: string | Date;
  trigger?: string;
  warehouseSource?: string;
}

export interface PurchaseOrderSyncResult {
  batchId: string;
  status: "completed" | "completed_with_exceptions";
  fetchedCount: number;
  normalizedCount: number;
  createdCount: number;
  updatedCount: number;
  exceptionCount: number;
}

const allowedEntities = new Set(["Phoenix", "Seychelles Breweries", "Edena"]);
const allowedFunctions = new Set(["technical", "indirect", "supplychain"]);
const allowedOrderTypes = new Set(["foreign", "local"]);

export const ERP_COLUMNS: FieldColumn[] = [
  { field: "erpSource", column: "erp_source", param: "erp_source" },
  { field: "erpCompany", column: "erp_company", param: "erp_company" },
  { field: "erpEntityId", column: "erp_entity_id", param: "erp_entity_id" },
  { field: "erpDocumentId", column: "erp_document_id", param: "erp_document_id" },
  { field: "erpDocumentNo", column: "erp_document_no", param: "erp_document_no" },
  { field: "erpVendorNo", column: "erp_vendor_no", param: "erp_vendor_no" },
  { field: "erpVendorName", column: "erp_vendor_name", param: "erp_vendor_name" },
  { field: "supplier", column: "supplier", param: "supplier" },
  { field: "orderType", column: "order_type", param: "order_type" },
  { field: "function", column: "procurement_function", param: "procurement_function" },
  { field: "currency", column: "currency", param: "currency" },
  { field: "amount", column: "amount", param: "amount", value: order => money(order.amount) },
  { field: "dateOfOrder", column: "date_of_order", param: "date_of_order" },
  { field: "description", column: "description", param: "description" },
  { field: "paymentTerms", column: "payment_terms", param: "payment_terms" },
  { field: "category", column: "category", param: "category" },
  { field: "iprNumber", column: "ipr_number", param: "ipr_number" },
  { field: "iprApprovedDate", column: "ipr_approved_date", param: "ipr_approved_date" },
  { field: "claimant", column: "claimant", param: "claimant" },
  { field: "requestedReceiptDate", column: "requested_receipt_date", param: "requested_receipt_date" },
  { field: "erpPoStatus", column: "erp_po_status", param: "erp_po_status" },
  { field: "erpAmount", column: "erp_amount", param: "erp_amount", value: order => money(order.erpAmount) },
  { field: "erpCurrency", column: "erp_currency", param: "erp_currency" },
  { field: "erpHodId", column: "erp_hod_id", param: "erp_hod_id" },
  { field: "erpPurchasingMgrId", column: "erp_purchasing_mgr_id", param: "erp_purchasing_mgr_id" },
  { field: "erpCreatedFromIpr", column: "erp_created_from_ipr", param: "erp_created_from_ipr" },
  { field: "erpCreatedBy", column: "erp_created_by", param: "erp_created_by" },
  { field: "erpPurchaserCode", column: "erp_purchaser_code", param: "erp_purchaser_code" },
  { field: "erpShipmentMethod", column: "erp_shipment_method", param: "erp_shipment_method" },
  {
    field: "lines",
    column: "lines_json",
    param: "lines_json",
    value: order => JSON.stringify(Array.isArray(order.lines) ? order.lines : [])
  },
  { field: "integrationLayer", column: "integration_layer", param: "integration_layer" },
  { field: "warehouseSource", column: "warehouse_source", param: "warehouse_source" },
  { field: "warehouseRecordId", column: "warehouse_record_id", param: "warehouse_record_id" },
  { field: "warehouseBatchId", column: "warehouse_batch_id", param: "warehouse_batch_id" },
  { field: "warehouseExtractedAt", column: "warehouse_extracted_at", param: "warehouse_extracted_at", value: order => dateTime(order.warehouseExtractedAt) },
  { field: "warehouseLoadedAt", column: "warehouse_loaded_at", param: "warehouse_loaded_at", value: order => dateTime(order.warehouseLoadedAt) },
  { field: "warehouseHash", column: "warehouse_hash", param: "warehouse_hash" }
];

export const ERP_STATUS_MAP: Record<string, string> = {
  "Pending Approval": "Order amendment pending",
  Open: "Order sent to supplier",
  Released: "Order sent to supplier",
  Closed: "Order closed",
  Cancelled: "Order cancelled"
};

function asRecord(order: PurchaseOrderContract): OrderRecord {
  return order as OrderRecord;
}

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: unknown): ReturnType<typeof typedParam> {
  return typedParam(sql.Decimal(18, 4), numberOrNull(value));
}

function iso(value: string | Date | undefined): string {
  return value instanceof Date ? value.toISOString() : value || new Date().toISOString();
}

function dateTime(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function orderKey(order: PurchaseOrderContract): string | null {
  const entity = text(order.entity);
  const orderId = text(order.orderId);
  return entity && orderId ? `${entity}|${orderId}` : null;
}

function fieldValue(order: PurchaseOrderContract, field: FieldColumn): unknown {
  return field.value ? field.value(order) : asRecord(order)[field.field] ?? null;
}

function sqlParamsForOrder(order: PurchaseOrderContract): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const field of ERP_COLUMNS) params[field.param] = fieldValue(order, field);
  return params;
}

function refreshChanges(existing: ExistingOrderRow, order: PurchaseOrderContract): Record<string, unknown>[] {
  const checks = [
    { field: "amount", label: "PO Amount", old: existing.amount, next: order.amount },
    { field: "currency", label: "Currency", old: existing.currency, next: order.currency },
    {
      field: "requestedReceiptDate",
      label: "Requested Receipt Date",
      old: existing.requested_receipt_date,
      next: order.requestedReceiptDate
    }
  ];
  return checks
    .filter(item => item.next !== undefined)
    .filter(item => {
      if (item.field === "amount") {
        const oldAmount = numberOrNull(item.old);
        const nextAmount = numberOrNull(item.next);
        return oldAmount !== null && nextAmount !== null && oldAmount !== nextAmount;
      }
      const oldText = text(item.old instanceof Date ? item.old.toISOString().slice(0, 10) : item.old);
      const nextText = text(item.next);
      return !!oldText && oldText !== nextText;
    })
    .map(item => ({ field: item.field, label: item.label, old: item.old ?? null, new: item.next ?? null }));
}

export function mapErpPoStatus(erpPoStatus: unknown): string {
  const status = text(erpPoStatus);
  if (!status) return "Order sent to supplier";
  if (ERP_STATUS_MAP[status]) return ERP_STATUS_MAP[status];
  const key = Object.keys(ERP_STATUS_MAP).find(item => item.toLowerCase() === status.toLowerCase());
  return key ? ERP_STATUS_MAP[key] : "Order sent to supplier";
}

function isClosedErpPoStatus(erpPoStatus: unknown): boolean {
  const mapped = mapErpPoStatus(erpPoStatus);
  return mapped === "Order closed" || mapped === "Order cancelled";
}

export function validatePurchaseOrder(order: PurchaseOrderContract): string[] {
  const errors: string[] = [];
  if (!text(order.orderId)) errors.push("missing PO number");
  const entity = text(order.entity);
  if (!entity || !allowedEntities.has(entity)) errors.push("invalid entity");
  if (!allowedOrderTypes.has(String(order.orderType || ""))) errors.push("invalid order type");
  if (!allowedFunctions.has(String(order.function || ""))) errors.push("unclassified function");
  const amount = numberOrNull(order.amount);
  if (order.amount != null && (amount === null || amount < 0)) errors.push("amount not a valid non-negative number");
  if (!text(order.currency)) errors.push("missing currency");
  return errors;
}

export function groupPurchaseOrders(orders: PurchaseOrderContract[]): PurchaseOrderContract[] {
  const grouped = new Map<string, PurchaseOrderContract>();
  const invalid: PurchaseOrderContract[] = [];

  orders.forEach((order, index) => {
    const key = orderKey(order);
    if (!key) {
      invalid.push({ ...order, warehouseRecordId: text(order.warehouseRecordId) || `invalid-${index}`, lines: order.lines || [] });
      return;
    }

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...order, lines: Array.isArray(order.lines) ? [...order.lines] : [] });
      return;
    }

    const existingAmount = numberOrNull(existing.amount);
    const nextAmount = numberOrNull(order.amount);
    const existingErpAmount = numberOrNull(existing.erpAmount);
    const nextErpAmount = numberOrNull(order.erpAmount);

    grouped.set(key, {
      ...existing,
      ...Object.fromEntries(
        Object.entries(asRecord(order)).filter(([field, value]) => value !== undefined && value !== null && asRecord(existing)[field] == null)
      ),
      amount: existingAmount === null && nextAmount === null ? existing.amount : (existingAmount || 0) + (nextAmount || 0),
      erpAmount: existingErpAmount === null && nextErpAmount === null ? existing.erpAmount : (existingErpAmount || 0) + (nextErpAmount || 0),
      lines: [
        ...(Array.isArray(existing.lines) ? existing.lines : []),
        ...(Array.isArray(order.lines) ? order.lines : [])
      ]
    });
  });

  return [...grouped.values(), ...invalid];
}

async function insertImportAudit(query: SqlQueryExecutor, result: PurchaseOrderSyncResult, source: string | null, trigger: string): Promise<void> {
  await query(`
    INSERT INTO dbo.import_audit (
      batch_id, warehouse_source, status, fetched_count, normalized_count,
      created_count, updated_count, exception_count, details_json
    )
    VALUES (
      @batch_id, @warehouse_source, @status, @fetched_count, @normalized_count,
      @created_count, @updated_count, @exception_count, @details_json
    );
  `, {
    batch_id: result.batchId,
    warehouse_source: source,
    status: "running",
    fetched_count: result.fetchedCount,
    normalized_count: 0,
    created_count: 0,
    updated_count: 0,
    exception_count: 0,
    details_json: JSON.stringify({ trigger })
  });
}

async function finishImportAudit(query: SqlQueryExecutor, result: PurchaseOrderSyncResult): Promise<void> {
  await query(`
    UPDATE dbo.import_audit
       SET finished_at = SYSUTCDATETIME(),
           status = @status,
           normalized_count = @normalized_count,
           created_count = @created_count,
           updated_count = @updated_count,
           exception_count = @exception_count,
           details_json = @details_json
     WHERE batch_id = @batch_id;
  `, {
    batch_id: result.batchId,
    status: result.status,
    normalized_count: result.normalizedCount,
    created_count: result.createdCount,
    updated_count: result.updatedCount,
    exception_count: result.exceptionCount,
    details_json: JSON.stringify(result)
  });
}

async function writeSyncException(query: SqlQueryExecutor, batchId: string, order: PurchaseOrderContract, errors: string[]): Promise<void> {
  const errorCode = errors.some(error => /unclassified/i.test(error)) ? "UNCLASSIFIED" : "VALIDATION_FAILED";
  await query(`
    INSERT INTO dbo.sync_exceptions (
      batch_id, entity, order_id, warehouse_record_id, error_code, error_message, payload_json
    )
    VALUES (
      @batch_id, @entity, @order_id, @warehouse_record_id, @error_code, @error_message, @payload_json
    );
  `, {
    batch_id: batchId,
    entity: text(order.entity),
    order_id: text(order.orderId),
    warehouse_record_id: text(order.warehouseRecordId),
    error_code: errorCode,
    error_message: errors.join("; "),
    payload_json: JSON.stringify(order)
  });
}

async function selectExistingOrder(query: SqlQueryExecutor, order: PurchaseOrderContract): Promise<ExistingOrderRow | null> {
  const result = await query<ExistingOrderRow>(`
    SELECT id, amount, currency, requested_receipt_date
      FROM dbo.orders WITH (UPDLOCK, HOLDLOCK)
     WHERE entity = @entity AND order_id = @order_id;
  `, {
    entity: text(order.entity),
    order_id: text(order.orderId)
  });
  return result.recordset[0] || null;
}

async function updateExistingOrder(query: SqlQueryExecutor, existing: ExistingOrderRow, order: PurchaseOrderContract, now: string): Promise<void> {
  const changes = refreshChanges(existing, order);
  const assignments = ERP_COLUMNS.map(field => `${field.column} = @${field.param}`).join(",\n           ");
  await query(`
    UPDATE dbo.orders
       SET ${assignments},
           erp_sync_status = @erp_sync_status,
           erp_last_synced_at = @erp_last_synced_at,
           erp_sync_error = NULL,
           last_refresh_changes_json = @last_refresh_changes_json,
           last_refresh_at = @last_refresh_at
     WHERE id = @id;
  `, {
    id: existing.id,
    ...sqlParamsForOrder(order),
    erp_sync_status: "synced",
    erp_last_synced_at: dateTime(now),
    last_refresh_changes_json: JSON.stringify(changes),
    last_refresh_at: dateTime(now)
  });
}

async function insertNewOrder(query: SqlQueryExecutor, order: PurchaseOrderContract, now: string): Promise<void> {
  const status = mapErpPoStatus(order.erpPoStatus);
  const isClosed = isClosedErpPoStatus(order.erpPoStatus);
  const columns = ["entity", "order_id", ...ERP_COLUMNS.map(field => field.column), "erp_sync_status", "erp_last_synced_at", "status", "is_closed"];
  const params = ["@entity", "@order_id", ...ERP_COLUMNS.map(field => `@${field.param}`), "@erp_sync_status", "@erp_last_synced_at", "@status", "@is_closed"];

  await query(`
    INSERT INTO dbo.orders (${columns.join(", ")})
    VALUES (${params.join(", ")});
  `, {
    entity: text(order.entity),
    order_id: text(order.orderId),
    ...sqlParamsForOrder(order),
    erp_sync_status: "synced",
    erp_last_synced_at: dateTime(now),
    status,
    is_closed: isClosed
  });
}

async function writeFailedImportAudit(batchId: string, fetchedCount: number, trigger: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await queryParams(`
    INSERT INTO dbo.import_audit (
      batch_id, warehouse_source, finished_at, status, fetched_count, normalized_count,
      created_count, updated_count, exception_count, details_json
    )
    VALUES (
      @batch_id, @warehouse_source, SYSUTCDATETIME(), @status, @fetched_count, 0,
      0, 0, 1, @details_json
    );
  `, {
    batch_id: batchId,
    warehouse_source: null,
    status: "failed",
    fetched_count: fetchedCount,
    details_json: JSON.stringify({ trigger, error: message })
  });
}

async function syncWithQuery(
  query: SqlQueryExecutor,
  orders: PurchaseOrderContract[],
  opts: Required<Pick<PurchaseOrderSyncOptions, "batchId" | "trigger">> & { now: string; warehouseSource: string | null }
): Promise<PurchaseOrderSyncResult> {
  const grouped = groupPurchaseOrders(orders);
  const result: PurchaseOrderSyncResult = {
    batchId: opts.batchId,
    status: "completed",
    fetchedCount: orders.length,
    normalizedCount: 0,
    createdCount: 0,
    updatedCount: 0,
    exceptionCount: 0
  };

  await insertImportAudit(query, result, opts.warehouseSource, opts.trigger);

  for (const order of grouped) {
    const errors = validatePurchaseOrder(order);
    if (errors.length) {
      result.exceptionCount += 1;
      await writeSyncException(query, opts.batchId, order, errors);
      continue;
    }

    result.normalizedCount += 1;
    const existing = await selectExistingOrder(query, order);
    if (existing) {
      await updateExistingOrder(query, existing, { ...order, warehouseBatchId: opts.batchId, warehouseLoadedAt: opts.now }, opts.now);
      result.updatedCount += 1;
    } else {
      await insertNewOrder(query, { ...order, warehouseBatchId: opts.batchId, warehouseLoadedAt: opts.now }, opts.now);
      result.createdCount += 1;
    }
  }

  result.status = result.exceptionCount ? "completed_with_exceptions" : "completed";
  await finishImportAudit(query, result);
  return result;
}

export async function syncPurchaseOrders(options: PurchaseOrderSyncOptions = {}): Promise<PurchaseOrderSyncResult> {
  const now = iso(options.now);
  const batchId = text(options.batchId) || `WD-${Date.now()}`;
  const trigger = text(options.trigger) || "manual";
  let orders: PurchaseOrderContract[] = [];
  try {
    orders = options.orders || await (options.fetchPurchaseOrders || dwSource.fetchPurchaseOrders)();
    const warehouseSource = text(options.warehouseSource) || text(orders[0]?.warehouseSource);
    const run = (query: SqlQueryExecutor) => syncWithQuery(query, orders, { batchId, now, trigger, warehouseSource });
    return options.query ? run(options.query) : withTransaction(run);
  } catch (error) {
    if (!options.query) {
      try {
        await writeFailedImportAudit(batchId, orders.length, trigger, error);
      } catch {
        // Preserve the original sync failure; failed-audit logging is best effort.
      }
    }
    throw error;
  }
}
