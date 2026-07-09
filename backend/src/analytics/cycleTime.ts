import * as sql from "mssql";
import { BadRequestError, KpiQueryInput, KpiOptions, parseKpiOptions } from "../kpi/queries";
import { SqlParams, SqlQueryExecutor, queryParams, typedParam } from "../sql/client";

export interface CycleTimeInput extends KpiQueryInput {
  longOpenDays?: string | number | null;
  staleSyncDays?: string | number | null;
}

interface CycleTimeOptions extends KpiOptions {
  longOpenDays: number;
  staleSyncDays: number;
}

interface SummaryRow {
  avgOpenAgeDays: number | null;
  medianOpenAgeDays: number | null;
  openSampleSize: number;
  avgRequestedLeadDays: number | null;
  requestedLeadSampleSize: number;
  avgRequestedDelayDays: number | null;
  requestedDelaySampleSize: number;
}

interface DimensionRow {
  dimensionValue: string | null;
  openOrders: number;
  avgOpenAgeDays: number | null;
  requestedReceiptOverdue: number;
  staleSync: number;
  longOpen: number;
}

interface BreachRow {
  requestedReceiptOverdue: number;
  staleSync: number;
  longOpen: number;
}

export interface CycleTimeResponse {
  scope: {
    entity: string;
    dateFrom: string | null;
    dateTo: string | null;
    longOpenDays: number;
    staleSyncDays: number;
  };
  generatedAt: string;
  orderCycle: {
    openAge: { avgDays: number | null; medianDays: number | null; sampleSize: number };
    requestedReceiptLeadTime: { avgDays: number | null; sampleSize: number };
    requestedReceiptDelay: { avgDays: number | null; sampleSize: number };
  };
  bottlenecks: {
    byOfficer: DimensionMetric[];
    bySupplier: DimensionMetric[];
    byCategory: DimensionMetric[];
    byFunction: DimensionMetric[];
  };
  slaBreaches: {
    requestedReceiptOverdue: number;
    staleSync: number;
    longOpen: number;
  };
  coverage: {
    excluded: string[];
    reason: string;
  };
}

export interface DimensionMetric {
  value: string;
  openOrders: number;
  avgOpenAgeDays: number | null;
  requestedReceiptOverdue: number;
  staleSync: number;
  longOpen: number;
}

function parsePositiveInt(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new BadRequestError(`${label} must be a positive integer.`);
  return parsed;
}

export function parseCycleTimeOptions(input: CycleTimeInput = {}): CycleTimeOptions {
  return {
    ...parseKpiOptions(input),
    longOpenDays: parsePositiveInt(input.longOpenDays, 90, "longOpenDays"),
    staleSyncDays: parsePositiveInt(input.staleSyncDays, 3, "staleSyncDays")
  };
}

function dateParam(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function scopedWhere(options: CycleTimeOptions): { sqlText: string; params: SqlParams } {
  const clauses: string[] = [];
  const params: SqlParams = {};
  if (options.entity) {
    clauses.push("entity = @entity");
    params.entity = typedParam(sql.NVarChar(120), options.entity);
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

function metricParams(options: CycleTimeOptions): SqlParams {
  return {
    long_open_days: typedParam(sql.Int, options.longOpenDays),
    stale_sync_days: typedParam(sql.Int, options.staleSyncDays)
  };
}

function numberOrNull(value: unknown, digits = 1): number | null {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(digits));
}

function mapDimension(rows: DimensionRow[]): DimensionMetric[] {
  return rows.map(row => ({
    value: row.dimensionValue || "unassigned",
    openOrders: Number(row.openOrders || 0),
    avgOpenAgeDays: numberOrNull(row.avgOpenAgeDays),
    requestedReceiptOverdue: Number(row.requestedReceiptOverdue || 0),
    staleSync: Number(row.staleSync || 0),
    longOpen: Number(row.longOpen || 0)
  }));
}

function groupQuery(columnExpression: string, where: { sqlText: string; params: SqlParams }): string {
  return `
    WITH scoped AS (
      SELECT
        ${columnExpression} AS dimensionValue,
        date_of_order,
        requested_receipt_date,
        erp_last_synced_at,
        is_closed
      FROM dbo.orders
      ${where.sqlText}
    )
    SELECT TOP 25
      COALESCE(NULLIF(LTRIM(RTRIM(dimensionValue)), N''), N'unassigned') AS dimensionValue,
      SUM(CASE WHEN is_closed = 0 THEN 1 ELSE 0 END) AS openOrders,
      AVG(CASE WHEN is_closed = 0 AND date_of_order IS NOT NULL THEN CAST(DATEDIFF(day, date_of_order, SYSUTCDATETIME()) AS float) END) AS avgOpenAgeDays,
      SUM(CASE WHEN is_closed = 0 AND requested_receipt_date < CAST(SYSUTCDATETIME() AS date) THEN 1 ELSE 0 END) AS requestedReceiptOverdue,
      SUM(CASE WHEN is_closed = 0 AND (erp_last_synced_at IS NULL OR erp_last_synced_at < DATEADD(day, -@stale_sync_days, SYSUTCDATETIME())) THEN 1 ELSE 0 END) AS staleSync,
      SUM(CASE WHEN is_closed = 0 AND date_of_order IS NOT NULL AND DATEDIFF(day, date_of_order, SYSUTCDATETIME()) > @long_open_days THEN 1 ELSE 0 END) AS longOpen
    FROM scoped
    GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(dimensionValue)), N''), N'unassigned')
    ORDER BY
      SUM(CASE WHEN is_closed = 0 AND requested_receipt_date < CAST(SYSUTCDATETIME() AS date) THEN 1 ELSE 0 END) DESC,
      SUM(CASE WHEN is_closed = 0 AND (erp_last_synced_at IS NULL OR erp_last_synced_at < DATEADD(day, -@stale_sync_days, SYSUTCDATETIME())) THEN 1 ELSE 0 END) DESC,
      SUM(CASE WHEN is_closed = 0 THEN 1 ELSE 0 END) DESC,
      dimensionValue;
  `;
}

export async function getCycleTimeAnalytics(
  input: CycleTimeInput = {},
  query: SqlQueryExecutor = queryParams
): Promise<CycleTimeResponse> {
  const options = parseCycleTimeOptions(input);
  const where = scopedWhere(options);
  const params = { ...where.params, ...metricParams(options) };

  const [
    summary,
    byOfficer,
    bySupplier,
    byCategory,
    byFunction,
    breaches
  ] = await Promise.all([
    query<SummaryRow>(`
      WITH scoped AS (
        SELECT date_of_order, requested_receipt_date, is_closed
        FROM dbo.orders
        ${where.sqlText}
      ),
      open_age AS (
        SELECT DATEDIFF(day, date_of_order, SYSUTCDATETIME()) AS age_days
        FROM scoped
        WHERE is_closed = 0
          AND date_of_order IS NOT NULL
      ),
      requested_lead AS (
        SELECT DATEDIFF(day, date_of_order, requested_receipt_date) AS lead_days
        FROM scoped
        WHERE date_of_order IS NOT NULL
          AND requested_receipt_date IS NOT NULL
          AND DATEDIFF(day, date_of_order, requested_receipt_date) >= 0
      ),
      requested_delay AS (
        SELECT DATEDIFF(day, requested_receipt_date, CAST(SYSUTCDATETIME() AS date)) AS delay_days
        FROM scoped
        WHERE is_closed = 0
          AND requested_receipt_date < CAST(SYSUTCDATETIME() AS date)
      )
      SELECT
        (SELECT AVG(CAST(age_days AS float)) FROM open_age) AS avgOpenAgeDays,
        (SELECT DISTINCT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY age_days) OVER () FROM open_age) AS medianOpenAgeDays,
        (SELECT COUNT(*) FROM open_age) AS openSampleSize,
        (SELECT AVG(CAST(lead_days AS float)) FROM requested_lead) AS avgRequestedLeadDays,
        (SELECT COUNT(*) FROM requested_lead) AS requestedLeadSampleSize,
        (SELECT AVG(CAST(delay_days AS float)) FROM requested_delay) AS avgRequestedDelayDays,
        (SELECT COUNT(*) FROM requested_delay) AS requestedDelaySampleSize;
    `, where.params),
    query<DimensionRow>(groupQuery("COALESCE(NULLIF(erp_purchaser_code, N''), NULLIF(erp_created_by, N''), NULLIF(claimant, N''))", where), params),
    query<DimensionRow>(groupQuery("supplier", where), params),
    query<DimensionRow>(groupQuery("category", where), params),
    query<DimensionRow>(groupQuery("procurement_function", where), params),
    query<BreachRow>(`
      SELECT
        SUM(CASE WHEN is_closed = 0 AND requested_receipt_date < CAST(SYSUTCDATETIME() AS date) THEN 1 ELSE 0 END) AS requestedReceiptOverdue,
        SUM(CASE WHEN is_closed = 0 AND (erp_last_synced_at IS NULL OR erp_last_synced_at < DATEADD(day, -@stale_sync_days, SYSUTCDATETIME())) THEN 1 ELSE 0 END) AS staleSync,
        SUM(CASE WHEN is_closed = 0 AND date_of_order IS NOT NULL AND DATEDIFF(day, date_of_order, SYSUTCDATETIME()) > @long_open_days THEN 1 ELSE 0 END) AS longOpen
      FROM dbo.orders
      ${where.sqlText};
    `, params)
  ]);

  const summaryRow = summary.recordset[0] || {
    avgOpenAgeDays: null,
    medianOpenAgeDays: null,
    openSampleSize: 0,
    avgRequestedLeadDays: null,
    requestedLeadSampleSize: 0,
    avgRequestedDelayDays: null,
    requestedDelaySampleSize: 0
  };
  const breachRow = breaches.recordset[0] || { requestedReceiptOverdue: 0, staleSync: 0, longOpen: 0 };

  return {
    scope: {
      entity: options.entity || "all",
      dateFrom: options.dateFrom || null,
      dateTo: options.dateTo || null,
      longOpenDays: options.longOpenDays,
      staleSyncDays: options.staleSyncDays
    },
    generatedAt: new Date().toISOString(),
    orderCycle: {
      openAge: {
        avgDays: numberOrNull(summaryRow.avgOpenAgeDays),
        medianDays: numberOrNull(summaryRow.medianOpenAgeDays),
        sampleSize: Number(summaryRow.openSampleSize || 0)
      },
      requestedReceiptLeadTime: {
        avgDays: numberOrNull(summaryRow.avgRequestedLeadDays),
        sampleSize: Number(summaryRow.requestedLeadSampleSize || 0)
      },
      requestedReceiptDelay: {
        avgDays: numberOrNull(summaryRow.avgRequestedDelayDays),
        sampleSize: Number(summaryRow.requestedDelaySampleSize || 0)
      }
    },
    bottlenecks: {
      byOfficer: mapDimension(byOfficer.recordset),
      bySupplier: mapDimension(bySupplier.recordset),
      byCategory: mapDimension(byCategory.recordset),
      byFunction: mapDimension(byFunction.recordset)
    },
    slaBreaches: {
      requestedReceiptOverdue: Number(breachRow.requestedReceiptOverdue || 0),
      staleSync: Number(breachRow.staleSync || 0),
      longOpen: Number(breachRow.longOpen || 0)
    },
    coverage: {
      excluded: ["workflowTimeInStage", "stageTransitionBottlenecks", "officerStageSlaBreaches"],
      reason: "SQL currently stores ERP order headers only. Workflow/status transition history from the browser status_log/workflows lifecycle has not been migrated, so true time-in-stage analytics are not computed yet."
    }
  };
}
