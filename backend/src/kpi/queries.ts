import * as sql from "mssql";
import { SqlParams, SqlQueryExecutor, queryParams, typedParam } from "../sql/client";
import { mapOrderRow, OrderSqlRow } from "./shape";

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

export interface OrderListQueryInput {
  entity?: string | null;
  function?: string | null;
  orderType?: string | null;
  erpPoStatus?: string | null;
  closed?: string | boolean | null;
  supplier?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
  sort?: string | null;
}

export interface OrderListOptions {
  entity?: string;
  function?: string;
  orderType?: string;
  erpPoStatus?: string;
  closed?: boolean;
  supplier?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
  sortColumn: string;
  sortDirection: "ASC" | "DESC";
}

export interface OrderListResponse {
  data: Record<string, unknown>[];
  page: number;
  pageSize: number;
  total: number;
  generatedAt: string;
}

const sortableColumns = new Set(["date_of_order", "amount", "entity", "order_id", "erp_po_status"]);

const selectColumns = `
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
  is_closed
`;

function cleanText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function parsePositiveInt(value: unknown, fallback: number, label: string): number {
  const raw = cleanText(value);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) throw new BadRequestError(`${label} must be a positive integer.`);
  return parsed;
}

function parseBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const normalised = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalised)) return true;
  if (["false", "0", "no"].includes(normalised)) return false;
  throw new BadRequestError("closed must be true or false.");
}

function parseDate(value: unknown, label: string): string | undefined {
  const raw = cleanText(value);
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new BadRequestError(`${label} must use YYYY-MM-DD.`);
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestError(`${label} is not a valid date.`);
  return raw;
}

function parseSort(value: unknown): { sortColumn: string; sortDirection: "ASC" | "DESC" } {
  const raw = cleanText(value) || "date_of_order:desc";
  const [column, direction = "asc", extra] = raw.split(":");
  const sortColumn = column.trim();
  const sortDirection = direction.trim().toLowerCase();
  if (extra !== undefined || !sortableColumns.has(sortColumn) || !["asc", "desc"].includes(sortDirection)) {
    throw new BadRequestError("sort must be one of date_of_order, amount, entity, order_id, erp_po_status with asc or desc.");
  }
  return {
    sortColumn,
    sortDirection: sortDirection === "desc" ? "DESC" : "ASC"
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_\[]/g, item => `\\${item}`);
}

function dateParam(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function parseOrderListOptions(input: OrderListQueryInput = {}): OrderListOptions {
  const page = parsePositiveInt(input.page, 1, "page");
  const pageSize = Math.min(parsePositiveInt(input.pageSize, 50, "pageSize"), 200);
  return {
    entity: cleanText(input.entity),
    function: cleanText(input.function),
    orderType: cleanText(input.orderType),
    erpPoStatus: cleanText(input.erpPoStatus),
    closed: parseBool(input.closed),
    supplier: cleanText(input.supplier),
    dateFrom: parseDate(input.dateFrom, "dateFrom"),
    dateTo: parseDate(input.dateTo, "dateTo"),
    page,
    pageSize,
    ...parseSort(input.sort)
  };
}

function whereClause(options: OrderListOptions): { sqlText: string; params: SqlParams } {
  const clauses: string[] = [];
  const params: SqlParams = {};
  if (options.entity) {
    clauses.push("entity = @entity");
    params.entity = typedParam(sql.NVarChar(120), options.entity);
  }
  if (options.function) {
    clauses.push("procurement_function = @function");
    params.function = typedParam(sql.NVarChar(40), options.function);
  }
  if (options.orderType) {
    clauses.push("order_type = @order_type");
    params.order_type = typedParam(sql.NVarChar(40), options.orderType);
  }
  if (options.erpPoStatus) {
    clauses.push("erp_po_status = @erp_po_status");
    params.erp_po_status = typedParam(sql.NVarChar(80), options.erpPoStatus);
  }
  if (options.closed !== undefined) {
    clauses.push("is_closed = @closed");
    params.closed = typedParam(sql.Bit, options.closed);
  }
  if (options.supplier) {
    clauses.push("supplier LIKE @supplier ESCAPE '\\'");
    params.supplier = typedParam(sql.NVarChar(255), `%${escapeLike(options.supplier)}%`);
  }
  if (options.dateFrom) {
    clauses.push("date_of_order >= @date_from");
    params.date_from = typedParam(sql.Date, dateParam(options.dateFrom));
  }
  if (options.dateTo) {
    clauses.push("date_of_order <= @date_to");
    params.date_to = typedParam(sql.Date, dateParam(options.dateTo));
  }
  return {
    sqlText: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

export async function listOrders(
  input: OrderListQueryInput = {},
  query: SqlQueryExecutor = queryParams
): Promise<OrderListResponse> {
  const options = parseOrderListOptions(input);
  const where = whereClause(options);
  const offset = (options.page - 1) * options.pageSize;
  const totalResult = await query<{ total: number }>(`
    SELECT COUNT(*) AS total
      FROM dbo.orders
      ${where.sqlText};
  `, where.params);
  const dataResult = await query<OrderSqlRow>(`
    SELECT ${selectColumns}
      FROM dbo.orders
      ${where.sqlText}
     ORDER BY ${options.sortColumn} ${options.sortDirection}
     OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY;
  `, {
    ...where.params,
    off: typedParam(sql.Int, offset),
    lim: typedParam(sql.Int, options.pageSize)
  });

  return {
    data: dataResult.recordset.map(mapOrderRow),
    page: options.page,
    pageSize: options.pageSize,
    total: Number(totalResult.recordset[0]?.total || 0),
    generatedAt: new Date().toISOString()
  };
}
