import * as sql from "mssql";
import { mapOrderRow, OrderSqlRow } from "../kpi/shape";
import { ERP_COLUMNS, mapErpPoStatus } from "../sync/purchaseOrderSync";
import { queryParams, SqlQueryExecutor, typedParam } from "../sql/client";

export type OrderRecord = Record<string, unknown>;

export interface OrderReconciliationIssue {
  type: "erp_only" | "app_only" | "value_mismatch";
  key: string;
  entity: string | null;
  orderId: string | null;
  field?: string;
  erpValue?: unknown;
  operationalValue?: unknown;
  expectedOperationalValue?: unknown;
  severity: "info" | "warn";
  message: string;
}

export interface OrderReconciliation {
  erpOnly: OrderReconciliationIssue[];
  appOnly: OrderReconciliationIssue[];
  valueMismatches: OrderReconciliationIssue[];
  issues: OrderReconciliationIssue[];
}

export interface MergedOrderListOptions {
  top?: number;
  skip?: number;
  changedSince?: Date | null;
}

interface OperationalOrderRow {
  recordId: string;
  dataJson: string;
  archived: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface OrderMergeSqlRow extends OrderSqlRow {
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

const DEFAULT_PHOENIX_ARRAY_FIELDS = ["milestones", "amendments", "claims", "receipts", "lineTracking"];
const SYNTHETIC_ORDER_PREFIX = "erp:";

export const ERP_OWNED_FIELDS = Object.freeze([
  "entity",
  "orderId",
  ...ERP_COLUMNS.map(column => column.field)
]);

const erpOrderSelect = `
  id,
  integration_layer,
  entity,
  erp_source,
  erp_company,
  erp_entity_id,
  erp_document_id,
  erp_document_no,
  order_id,
  erp_vendor_no,
  erp_vendor_name,
  supplier,
  order_type,
  procurement_function,
  currency,
  amount,
  date_of_order,
  description,
  payment_terms,
  category,
  ipr_number,
  ipr_approved_date,
  claimant,
  requested_receipt_date,
  erp_po_status,
  erp_amount,
  erp_currency,
  erp_hod_id,
  erp_purchasing_mgr_id,
  erp_created_from_ipr,
  erp_created_by,
  erp_purchaser_code,
  erp_shipment_method,
  lines_json,
  warehouse_source,
  warehouse_record_id,
  warehouse_batch_id,
  warehouse_extracted_at,
  warehouse_loaded_at,
  warehouse_hash,
  erp_sync_status,
  erp_last_synced_at,
  erp_sync_error,
  last_refresh_changes_json,
  last_refresh_at,
  status AS initial_operational_status,
  is_closed,
  created_at,
  updated_at
`;

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function orderKey(order: OrderRecord): string | null {
  const entity = text(order.entity);
  const orderId = text(order.orderId);
  return entity && orderId ? `${entity}|${orderId}` : null;
}

function syntheticErpId(order: OrderRecord): string {
  const key = orderKey(order);
  return key ? `${SYNTHETIC_ORDER_PREFIX}${key}` : `${SYNTHETIC_ORDER_PREFIX}${text(order.id) || "unknown"}`;
}

export function parseSyntheticOrderId(id: string): { entity: string; orderId: string } | null {
  if (!id.startsWith(SYNTHETIC_ORDER_PREFIX)) return null;
  const rest = id.slice(SYNTHETIC_ORDER_PREFIX.length);
  const separator = rest.indexOf("|");
  if (separator <= 0 || separator === rest.length - 1) return null;
  return {
    entity: rest.slice(0, separator),
    orderId: rest.slice(separator + 1)
  };
}

function phoenixArrayDefaults(): OrderRecord {
  return Object.fromEntries(DEFAULT_PHOENIX_ARRAY_FIELDS.map(field => [field, []]));
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function dateTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function parseOperationalRow(row: OperationalOrderRow): OrderRecord {
  const parsed = JSON.parse(row.dataJson || "{}") as OrderRecord;
  return {
    ...parsed,
    id: row.recordId,
    archived: typeof parsed.archived === "boolean" ? parsed.archived : !!row.archived,
    createdAt: row.createdAt || parsed.createdAt,
    updatedAt: row.updatedAt
  };
}

function valuesDiffer(field: string, a: unknown, b: unknown): boolean {
  if (!isPresent(a) || !isPresent(b)) return false;
  if (field === "amount") {
    const left = numberOrNull(a);
    const right = numberOrNull(b);
    return left !== null && right !== null && left !== right;
  }
  return String(a).trim().toLowerCase() !== String(b).trim().toLowerCase();
}

function seededStatus(order: OrderRecord): string {
  const initial = text(order.initialOperationalStatus);
  return initial || mapErpPoStatus(order.erpPoStatus);
}

function seededClosed(order: OrderRecord): boolean {
  return order.isClosed === true || order.isClosed === 1 || seededStatus(order) === "Order closed" || seededStatus(order) === "Order cancelled";
}

function issueBase(order: OrderRecord, type: OrderReconciliationIssue["type"]): Pick<OrderReconciliationIssue, "key" | "entity" | "orderId" | "type"> {
  return {
    type,
    key: orderKey(order) || "unknown",
    entity: text(order.entity),
    orderId: text(order.orderId)
  };
}

export function pickErpOwned(order: OrderRecord): OrderRecord {
  const picked: OrderRecord = {};
  for (const field of ERP_OWNED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(order, field)) picked[field] = order[field];
  }
  if (Object.prototype.hasOwnProperty.call(order, "initialOperationalStatus")) {
    picked.initialOperationalStatus = order.initialOperationalStatus;
  }
  return picked;
}

export function stripErpOwnedFieldsForOverlay(order: OrderRecord): OrderRecord {
  const stripped = { ...order };
  for (const field of ERP_OWNED_FIELDS) {
    if (field !== "entity" && field !== "orderId") delete stripped[field];
  }
  delete stripped.initialOperationalStatus;
  return stripped;
}

export async function readErpOrders(query: SqlQueryExecutor = queryParams): Promise<OrderRecord[]> {
  const result = await query<OrderMergeSqlRow>(`
    SELECT ${erpOrderSelect}
      FROM dbo.orders
     ORDER BY entity, order_id;
  `);
  return result.recordset.map(row => ({
    ...mapOrderRow(row),
    createdAt: dateTime(row.created_at),
    updatedAt: dateTime(row.updated_at)
  }));
}

export async function readRawOperationalOrders(query: SqlQueryExecutor = queryParams): Promise<OrderRecord[]> {
  const result = await query<OperationalOrderRow>(`
    SELECT
      record_id AS recordId,
      data_json AS dataJson,
      archived,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM dbo.operational_records
    WHERE collection_name = @orders_collection
      AND archived = 0
    ORDER BY updated_at DESC, record_id;
  `, {
    orders_collection: typedParam(sql.NVarChar(80), "orders")
  });
  return result.recordset.map(parseOperationalRow);
}

export function readOperationalOrders(query: SqlQueryExecutor = queryParams): Promise<OrderRecord[]> {
  return readRawOperationalOrders(query);
}

export async function listMergedOrders(
  query: SqlQueryExecutor = queryParams,
  _options: MergedOrderListOptions = {}
): Promise<OrderRecord[]> {
  const erpOrders = await readErpOrders(query);
  const operationalOrders = await readRawOperationalOrders(query);
  const rows = mergeOrders(erpOrders, operationalOrders);
  rows.sort((a, b) => {
    const updatedA = a.updatedAt ? new Date(String(a.updatedAt)).getTime() : 0;
    const updatedB = b.updatedAt ? new Date(String(b.updatedAt)).getTime() : 0;
    if (updatedA !== updatedB) return updatedB - updatedA;
    return String(a.orderId || "").localeCompare(String(b.orderId || ""));
  });
  return rows;
}

export function mergeOrders(erpOrders: OrderRecord[], operationalOrders: OrderRecord[]): OrderRecord[] {
  const operationalByKey = new Map<string, OrderRecord>();
  const unkeyedOperational: OrderRecord[] = [];

  for (const operational of operationalOrders) {
    const key = orderKey(operational);
    if (key) operationalByKey.set(key, operational);
    else unkeyedOperational.push(operational);
  }

  const merged: OrderRecord[] = [];
  for (const erp of erpOrders) {
    const key = orderKey(erp);
    const overlay = key ? operationalByKey.get(key) : undefined;
    if (key) operationalByKey.delete(key);

    if (overlay) {
      const combined: OrderRecord = { ...overlay, ...pickErpOwned(erp) };
      if (!isPresent(combined.status)) combined.status = seededStatus(erp);
      if (!Object.prototype.hasOwnProperty.call(combined, "isClosed")) combined.isClosed = seededClosed(erp);
      merged.push(combined);
    } else {
      merged.push({
        ...phoenixArrayDefaults(),
        ...pickErpOwned(erp),
        id: syntheticErpId(erp),
        status: seededStatus(erp),
        isClosed: seededClosed(erp)
      });
    }
  }

  return [
    ...merged,
    ...Array.from(operationalByKey.values()),
    ...unkeyedOperational
  ];
}

export function reconcileOrders(erpOrders: OrderRecord[], operationalOrders: OrderRecord[]): OrderReconciliation {
  const erpByKey = new Map<string, OrderRecord>();
  const operationalByKey = new Map<string, OrderRecord>();
  const erpOnly: OrderReconciliationIssue[] = [];
  const appOnly: OrderReconciliationIssue[] = [];
  const valueMismatches: OrderReconciliationIssue[] = [];

  for (const erp of erpOrders) {
    const key = orderKey(erp);
    if (key) erpByKey.set(key, erp);
  }
  for (const operational of operationalOrders) {
    const key = orderKey(operational);
    if (key) operationalByKey.set(key, operational);
  }

  for (const [key, erp] of erpByKey) {
    const operational = operationalByKey.get(key);
    if (!operational) {
      erpOnly.push({
        ...issueBase(erp, "erp_only"),
        severity: "info",
        message: "Order exists in ERP SQL store but has no Phoenix operational overlay yet."
      });
      continue;
    }

    for (const field of ["amount", "currency"]) {
      if (valuesDiffer(field, erp[field], operational[field])) {
        valueMismatches.push({
          ...issueBase(erp, "value_mismatch"),
          field,
          erpValue: erp[field],
          operationalValue: operational[field],
          severity: "warn",
          message: `Phoenix overlay ${field} differs from ERP ${field}.`
        });
      }
    }

    const expectedStatus = mapErpPoStatus(erp.erpPoStatus);
    if (isPresent(operational.status) && valuesDiffer("status", expectedStatus, operational.status)) {
      valueMismatches.push({
        ...issueBase(erp, "value_mismatch"),
        field: "erpPoStatus/status",
        erpValue: erp.erpPoStatus,
        operationalValue: operational.status,
        expectedOperationalValue: expectedStatus,
        severity: "info",
        message: "Phoenix operational status differs from the ERP lifecycle seed."
      });
    }
  }

  for (const [key, operational] of operationalByKey) {
    if (erpByKey.has(key)) continue;
    appOnly.push({
      ...issueBase(operational, "app_only"),
      severity: "warn",
      message: "Order exists in Phoenix operational overlay but not in ERP SQL store."
    });
  }

  return {
    erpOnly,
    appOnly,
    valueMismatches,
    issues: [...erpOnly, ...appOnly, ...valueMismatches]
  };
}
