import * as sql from "mssql";
import { BadRequestError } from "../kpi/queries";
import { SqlParams, SqlQueryExecutor, queryParams, typedParam } from "../sql/client";

export interface UnclassifiedWorklistInput {
  entity?: string | null;
  status?: string | null;
  errorCode?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
  sort?: string | null;
}

interface WorklistOptions {
  entity?: string;
  status: string;
  errorCode?: WorklistErrorCode;
  page: number;
  pageSize: number;
  sortColumn: string;
  sortDirection: "ASC" | "DESC";
}

type WorklistErrorCode = "UNCLASSIFIED" | "UNMAPPED_SUPPLIER" | "CURRENCY_AMBIGUOUS";

interface WorklistRow {
  id: number;
  batch_id: string | null;
  entity: string | null;
  order_id: string | null;
  warehouse_record_id: string | null;
  error_code: string;
  error_message: string;
  payload_json: string | null;
  status: string;
  created_at: Date | string;
  resolved_at: Date | string | null;
}

interface SummaryRow {
  errorCode: string;
  entity: string | null;
  count: number;
}

export interface UnclassifiedWorklistResponse {
  data: Record<string, unknown>[];
  page: number;
  pageSize: number;
  total: number;
  summary: { byErrorCode: Record<string, number>; byEntity: Record<string, number> };
  generatedAt: string;
  coverage: {
    deferred: string[];
    reason: string;
  };
}

const allowedErrorCodes = new Set<WorklistErrorCode>(["UNCLASSIFIED", "UNMAPPED_SUPPLIER", "CURRENCY_AMBIGUOUS"]);
const allowedSortColumns = new Set(["created_at", "error_code", "entity", "order_id"]);

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

function parseErrorCode(value: unknown): WorklistErrorCode | undefined {
  const raw = cleanText(value)?.toUpperCase();
  if (!raw) return undefined;
  if (!allowedErrorCodes.has(raw as WorklistErrorCode)) {
    throw new BadRequestError("errorCode must be one of UNCLASSIFIED, UNMAPPED_SUPPLIER, CURRENCY_AMBIGUOUS.");
  }
  return raw as WorklistErrorCode;
}

function parseSort(value: unknown): { sortColumn: string; sortDirection: "ASC" | "DESC" } {
  const raw = cleanText(value) || "created_at:desc";
  const [column, direction = "desc", extra] = raw.split(":");
  const sortColumn = column.trim();
  const sortDirection = direction.trim().toLowerCase();
  if (extra !== undefined || !allowedSortColumns.has(sortColumn) || !["asc", "desc"].includes(sortDirection)) {
    throw new BadRequestError("sort must be one of created_at, error_code, entity, order_id with asc or desc.");
  }
  return {
    sortColumn,
    sortDirection: sortDirection === "asc" ? "ASC" : "DESC"
  };
}

export function parseUnclassifiedWorklistOptions(input: UnclassifiedWorklistInput = {}): WorklistOptions {
  const page = parsePositiveInt(input.page, 1, "page");
  const pageSize = Math.min(parsePositiveInt(input.pageSize, 50, "pageSize"), 200);
  return {
    entity: cleanText(input.entity),
    status: cleanText(input.status) || "open",
    errorCode: parseErrorCode(input.errorCode),
    page,
    pageSize,
    ...parseSort(input.sort)
  };
}

function whereClause(options: WorklistOptions): { sqlText: string; params: SqlParams } {
  const clauses = ["error_code IN (N'UNCLASSIFIED', N'UNMAPPED_SUPPLIER', N'CURRENCY_AMBIGUOUS')"];
  const params: SqlParams = {
    status: typedParam(sql.NVarChar(40), options.status)
  };
  clauses.push("status = @status");
  if (options.entity) {
    clauses.push("entity = @entity");
    params.entity = typedParam(sql.NVarChar(120), options.entity);
  }
  if (options.errorCode) {
    clauses.push("error_code = @error_code");
    params.error_code = typedParam(sql.NVarChar(80), options.errorCode);
  }
  return {
    sqlText: `WHERE ${clauses.join(" AND ")}`,
    params
  };
}

function jsonOrNull(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function dateTime(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function suggestedAction(errorCode: string): string {
  if (errorCode === "UNCLASSIFIED") return "addImportRule";
  if (errorCode === "UNMAPPED_SUPPLIER") return "mapSupplier";
  if (errorCode === "CURRENCY_AMBIGUOUS") return "resolveCurrencyRule";
  return "review";
}

function mapRow(row: WorklistRow): Record<string, unknown> {
  return {
    id: row.id,
    batchId: row.batch_id,
    entity: row.entity,
    orderId: row.order_id,
    warehouseRecordId: row.warehouse_record_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    payload: jsonOrNull(row.payload_json),
    status: row.status,
    createdAt: dateTime(row.created_at),
    resolvedAt: dateTime(row.resolved_at),
    suggestedAction: suggestedAction(row.error_code)
  };
}

function summary(rows: SummaryRow[]): { byErrorCode: Record<string, number>; byEntity: Record<string, number> } {
  const byErrorCode: Record<string, number> = {};
  const byEntity: Record<string, number> = {};
  for (const row of rows) {
    byErrorCode[row.errorCode] = (byErrorCode[row.errorCode] || 0) + Number(row.count || 0);
    const entity = row.entity || "unknown";
    byEntity[entity] = (byEntity[entity] || 0) + Number(row.count || 0);
  }
  return { byErrorCode, byEntity };
}

export async function listUnclassifiedWorklist(
  input: UnclassifiedWorklistInput = {},
  query: SqlQueryExecutor = queryParams
): Promise<UnclassifiedWorklistResponse> {
  const options = parseUnclassifiedWorklistOptions(input);
  const where = whereClause(options);
  const offset = (options.page - 1) * options.pageSize;

  const [total, rows, summaryRows] = await Promise.all([
    query<{ total: number }>(`
      SELECT COUNT(*) AS total
      FROM dbo.sync_exceptions
      ${where.sqlText};
    `, where.params),
    query<WorklistRow>(`
      SELECT id, batch_id, entity, order_id, warehouse_record_id, error_code,
             error_message, payload_json, status, created_at, resolved_at
      FROM dbo.sync_exceptions
      ${where.sqlText}
      ORDER BY ${options.sortColumn} ${options.sortDirection}
      OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY;
    `, {
      ...where.params,
      off: typedParam(sql.Int, offset),
      lim: typedParam(sql.Int, options.pageSize)
    }),
    query<SummaryRow>(`
      SELECT error_code AS errorCode, entity, COUNT(*) AS count
      FROM dbo.sync_exceptions
      ${where.sqlText}
      GROUP BY error_code, entity;
    `, where.params)
  ]);

  return {
    data: rows.recordset.map(mapRow),
    page: options.page,
    pageSize: options.pageSize,
    total: Number(total.recordset[0]?.total || 0),
    summary: summary(summaryRows.recordset),
    generatedAt: new Date().toISOString(),
    coverage: {
      deferred: ["browserAdminScreen", "oneClickAddRule", "oneClickMapSupplier", "oneClickResolveCurrency"],
      reason: "This backend endpoint exposes the worklist data only. The admin UI and write actions require approved browser-side work and final rule/supplier mapping write design."
    }
  };
}
