import * as sql from "mssql";
import { SqlParams, SqlQueryExecutor, queryParams, typedParam } from "../sql/client";
import { coverageBlock, mapOrderRow, OrderSqlRow } from "./shape";

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

export interface KpiQueryInput {
  entity?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export interface KpiOptions {
  entity?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface KpiResponse {
  scope: { entity: string; dateFrom: string | null; dateTo: string | null };
  generatedAt: string;
  counts: {
    byEntity: { entity: string; count: number }[];
    byFunction: { function: string | null; count: number }[];
    byOrderType: { orderType: string | null; count: number }[];
    byErpPoStatus: { erpPoStatus: string | null; count: number }[];
    openClosed: { open: number; closed: number };
  };
  spendCommitment: { byCurrency: Record<string, number> };
  mtto: { avgDays: number | null; medianDays: number | null; sampleSize: number };
  ageing: { openByBucket: Record<"0-30" | "31-60" | "61-90" | "90+", number> };
  requestedReceipt: {
    proxy: true;
    overdue: { count: number; valueByCurrency: Record<string, number> };
    approachingDays: number;
    approaching: { count: number; valueByCurrency: Record<string, number> };
  };
  dataQuality: {
    unclassifiedFunction: number;
    unclassifiedOrderType: number;
    openSyncExceptions: number;
    staleSyncOverDays: number;
    staleSyncCount: number;
  };
  sync: {
    lastBatchId: string | null;
    lastLoadedAt: string | null;
    created: number;
    updated: number;
    exceptions: number;
  };
  coverage: { excluded: string[]; reason: string };
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

export function parseKpiOptions(input: KpiQueryInput = {}): KpiOptions {
  return {
    entity: cleanText(input.entity),
    dateFrom: parseDate(input.dateFrom, "dateFrom"),
    dateTo: parseDate(input.dateTo, "dateTo")
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

function kpiOrderWhereClause(options: KpiOptions, alias = ""): { sqlText: string; params: SqlParams } {
  const prefix = alias ? `${alias}.` : "";
  const clauses: string[] = [];
  const params: SqlParams = {};
  if (options.entity) {
    clauses.push(`${prefix}entity = @kpi_entity`);
    params.kpi_entity = typedParam(sql.NVarChar(120), options.entity);
  }
  if (options.dateFrom) {
    clauses.push(`${prefix}date_of_order >= @kpi_date_from`);
    params.kpi_date_from = typedParam(sql.Date, dateParam(options.dateFrom));
  }
  if (options.dateTo) {
    clauses.push(`${prefix}date_of_order <= @kpi_date_to`);
    params.kpi_date_to = typedParam(sql.Date, dateParam(options.dateTo));
  }
  return {
    sqlText: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

function syncExceptionWhereClause(options: KpiOptions): { sqlText: string; params: SqlParams } {
  const clauses = ["status = @sync_exception_status"];
  const params: SqlParams = {
    sync_exception_status: typedParam(sql.NVarChar(40), "open")
  };
  if (options.entity) {
    clauses.push("entity = @sync_exception_entity");
    params.sync_exception_entity = typedParam(sql.NVarChar(120), options.entity);
  }
  if (options.dateFrom) {
    clauses.push("created_at >= @sync_exception_date_from");
    params.sync_exception_date_from = typedParam(sql.Date, dateParam(options.dateFrom));
  }
  if (options.dateTo) {
    clauses.push("created_at < DATEADD(day, 1, @sync_exception_date_to)");
    params.sync_exception_date_to = typedParam(sql.Date, dateParam(options.dateTo));
  }
  return {
    sqlText: `WHERE ${clauses.join(" AND ")}`,
    params
  };
}

function bucketCounts<T extends string>(rows: { bucket: T; count: number }[], buckets: T[]): Record<T, number> {
  const out = Object.fromEntries(buckets.map(bucket => [bucket, 0])) as Record<T, number>;
  for (const row of rows) out[row.bucket] = Number(row.count || 0);
  return out;
}

function valueByCurrency(rows: { currency: string | null; value: number | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.currency || "UNKNOWN"] = Number(row.value || 0);
  return out;
}

function dateTimeIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
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

export async function getKpis(
  input: KpiQueryInput = {},
  query: SqlQueryExecutor = queryParams
): Promise<KpiResponse> {
  const options = parseKpiOptions(input);
  const orderWhere = kpiOrderWhereClause(options);
  const staleDays = 3;
  const approachingDays = 7;

  const [
    byEntity,
    byFunction,
    byOrderType,
    byErpPoStatus,
    openClosed,
    spend,
    mtto,
    ageing,
    overdueReceipt,
    approachingReceipt,
    dataQuality,
    syncExceptions,
    sync
  ] = await Promise.all([
    query<{ entity: string; count: number }>(`
      SELECT entity, COUNT(*) AS count
        FROM dbo.orders
        ${orderWhere.sqlText}
       GROUP BY entity
       ORDER BY entity;
    `, orderWhere.params),
    query<{ function: string | null; count: number }>(`
      SELECT procurement_function AS [function], COUNT(*) AS count
        FROM dbo.orders
        ${orderWhere.sqlText}
       GROUP BY procurement_function
       ORDER BY procurement_function;
    `, orderWhere.params),
    query<{ orderType: string | null; count: number }>(`
      SELECT order_type AS orderType, COUNT(*) AS count
        FROM dbo.orders
        ${orderWhere.sqlText}
       GROUP BY order_type
       ORDER BY order_type;
    `, orderWhere.params),
    query<{ erpPoStatus: string | null; count: number }>(`
      SELECT erp_po_status AS erpPoStatus, COUNT(*) AS count
        FROM dbo.orders
        ${orderWhere.sqlText}
       GROUP BY erp_po_status
       ORDER BY erp_po_status;
    `, orderWhere.params),
    query<{ open: number; closed: number }>(`
      SELECT
        SUM(CASE WHEN is_closed = 1 THEN 0 ELSE 1 END) AS [open],
        SUM(CASE WHEN is_closed = 1 THEN 1 ELSE 0 END) AS closed
        FROM dbo.orders
        ${orderWhere.sqlText};
    `, orderWhere.params),
    query<{ currency: string | null; value: number | null }>(`
      SELECT COALESCE(currency, 'UNKNOWN') AS currency, SUM(amount) AS value
        FROM dbo.orders
        ${orderWhere.sqlText}
       GROUP BY COALESCE(currency, 'UNKNOWN')
       ORDER BY COALESCE(currency, 'UNKNOWN');
    `, orderWhere.params),
    query<{ avgDays: number | null; medianDays: number | null; sampleSize: number }>(`
      WITH mtto AS (
        SELECT DATEDIFF(day, ipr_approved_date, date_of_order) AS mtto_days
          FROM dbo.orders
          ${orderWhere.sqlText}
           ${orderWhere.sqlText ? "AND" : "WHERE"} ipr_approved_date IS NOT NULL
           AND date_of_order IS NOT NULL
           AND DATEDIFF(day, ipr_approved_date, date_of_order) >= 0
      )
      SELECT DISTINCT
             AVG(CAST(mtto_days AS float)) OVER () AS avgDays,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY mtto_days) OVER () AS medianDays,
             COUNT(*) OVER () AS sampleSize
        FROM mtto;
    `, orderWhere.params),
    query<{ bucket: "0-30" | "31-60" | "61-90" | "90+"; count: number }>(`
      SELECT
        CASE
          WHEN DATEDIFF(day, date_of_order, SYSUTCDATETIME()) <= 30 THEN '0-30'
          WHEN DATEDIFF(day, date_of_order, SYSUTCDATETIME()) <= 60 THEN '31-60'
          WHEN DATEDIFF(day, date_of_order, SYSUTCDATETIME()) <= 90 THEN '61-90'
          ELSE '90+'
        END AS bucket,
        COUNT(*) AS count
        FROM dbo.orders
        ${orderWhere.sqlText}
         ${orderWhere.sqlText ? "AND" : "WHERE"} is_closed = 0
         AND date_of_order IS NOT NULL
       GROUP BY CASE
          WHEN DATEDIFF(day, date_of_order, SYSUTCDATETIME()) <= 30 THEN '0-30'
          WHEN DATEDIFF(day, date_of_order, SYSUTCDATETIME()) <= 60 THEN '31-60'
          WHEN DATEDIFF(day, date_of_order, SYSUTCDATETIME()) <= 90 THEN '61-90'
          ELSE '90+'
        END;
    `, orderWhere.params),
    query<{ currency: string | null; count: number; value: number | null }>(`
      SELECT COALESCE(currency, 'UNKNOWN') AS currency, COUNT(*) AS count, SUM(amount) AS value
        FROM dbo.orders
        ${orderWhere.sqlText}
         ${orderWhere.sqlText ? "AND" : "WHERE"} is_closed = 0
         AND requested_receipt_date < CAST(SYSUTCDATETIME() AS date)
       GROUP BY COALESCE(currency, 'UNKNOWN');
    `, orderWhere.params),
    query<{ currency: string | null; count: number; value: number | null }>(`
      SELECT COALESCE(currency, 'UNKNOWN') AS currency, COUNT(*) AS count, SUM(amount) AS value
        FROM dbo.orders
        ${orderWhere.sqlText}
         ${orderWhere.sqlText ? "AND" : "WHERE"} is_closed = 0
         AND requested_receipt_date >= CAST(SYSUTCDATETIME() AS date)
         AND requested_receipt_date <= DATEADD(day, @approaching_days, CAST(SYSUTCDATETIME() AS date))
       GROUP BY COALESCE(currency, 'UNKNOWN');
    `, { ...orderWhere.params, approaching_days: typedParam(sql.Int, approachingDays) }),
    query<{ unclassifiedFunction: number; unclassifiedOrderType: number; staleSyncCount: number }>(`
      SELECT
        SUM(CASE WHEN procurement_function IS NULL THEN 1 ELSE 0 END) AS unclassifiedFunction,
        SUM(CASE WHEN order_type IS NULL THEN 1 ELSE 0 END) AS unclassifiedOrderType,
        SUM(CASE WHEN erp_last_synced_at IS NOT NULL AND erp_last_synced_at < DATEADD(day, -@stale_days, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS staleSyncCount
        FROM dbo.orders
        ${orderWhere.sqlText};
    `, { ...orderWhere.params, stale_days: typedParam(sql.Int, staleDays) }),
    query<{ count: number }>(`
      SELECT COUNT(*) AS count
        FROM dbo.sync_exceptions
        ${syncExceptionWhereClause(options).sqlText};
    `, syncExceptionWhereClause(options).params),
    query<{ lastBatchId: string | null; lastLoadedAt: Date | string | null; created: number; updated: number; exceptions: number }>(`
      SELECT TOP 1
             batch_id AS lastBatchId,
             finished_at AS lastLoadedAt,
             created_count AS created,
             updated_count AS updated,
             exception_count AS exceptions
        FROM dbo.import_audit
       ORDER BY started_at DESC;
    `)
  ]);

  const overdueRows = overdueReceipt.recordset;
  const approachingRows = approachingReceipt.recordset;
  const latestSync = sync.recordset[0];
  const openClosedRow = openClosed.recordset[0] || { open: 0, closed: 0 };
  const mttoRow = mtto.recordset[0] || { avgDays: null, medianDays: null, sampleSize: 0 };
  const dataQualityRow = dataQuality.recordset[0] || {
    unclassifiedFunction: 0,
    unclassifiedOrderType: 0,
    staleSyncCount: 0
  };

  return {
    scope: {
      entity: options.entity || "all",
      dateFrom: options.dateFrom || null,
      dateTo: options.dateTo || null
    },
    generatedAt: new Date().toISOString(),
    counts: {
      byEntity: byEntity.recordset.map(row => ({ entity: row.entity, count: Number(row.count || 0) })),
      byFunction: byFunction.recordset.map(row => ({ function: row.function, count: Number(row.count || 0) })),
      byOrderType: byOrderType.recordset.map(row => ({ orderType: row.orderType, count: Number(row.count || 0) })),
      byErpPoStatus: byErpPoStatus.recordset.map(row => ({ erpPoStatus: row.erpPoStatus, count: Number(row.count || 0) })),
      openClosed: { open: Number(openClosedRow.open || 0), closed: Number(openClosedRow.closed || 0) }
    },
    spendCommitment: { byCurrency: valueByCurrency(spend.recordset) },
    mtto: {
      avgDays: mttoRow.avgDays == null ? null : Number(Number(mttoRow.avgDays).toFixed(1)),
      medianDays: mttoRow.medianDays == null ? null : Number(mttoRow.medianDays),
      sampleSize: Number(mttoRow.sampleSize || 0)
    },
    ageing: {
      openByBucket: bucketCounts(ageing.recordset, ["0-30", "31-60", "61-90", "90+"])
    },
    requestedReceipt: {
      proxy: true,
      overdue: {
        count: overdueRows.reduce((sum, row) => sum + Number(row.count || 0), 0),
        valueByCurrency: valueByCurrency(overdueRows)
      },
      approachingDays,
      approaching: {
        count: approachingRows.reduce((sum, row) => sum + Number(row.count || 0), 0),
        valueByCurrency: valueByCurrency(approachingRows)
      }
    },
    dataQuality: {
      unclassifiedFunction: Number(dataQualityRow.unclassifiedFunction || 0),
      unclassifiedOrderType: Number(dataQualityRow.unclassifiedOrderType || 0),
      openSyncExceptions: Number(syncExceptions.recordset[0]?.count || 0),
      staleSyncOverDays: staleDays,
      staleSyncCount: Number(dataQualityRow.staleSyncCount || 0)
    },
    sync: {
      lastBatchId: latestSync?.lastBatchId || null,
      lastLoadedAt: dateTimeIso(latestSync?.lastLoadedAt),
      created: Number(latestSync?.created || 0),
      updated: Number(latestSync?.updated || 0),
      exceptions: Number(latestSync?.exceptions || 0)
    },
    coverage: coverageBlock()
  };
}
