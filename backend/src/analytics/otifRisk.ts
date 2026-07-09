import * as sql from "mssql";
import { BadRequestError, KpiQueryInput, KpiOptions, parseKpiOptions } from "../kpi/queries";
import { SqlParams, SqlQueryExecutor, queryParams, typedParam } from "../sql/client";

export interface OtifRiskInput extends KpiQueryInput {
  horizonDays?: string | number | null;
  longOpenDays?: string | number | null;
  staleSyncDays?: string | number | null;
  minRiskScore?: string | number | null;
}

interface OtifRiskOptions extends KpiOptions {
  horizonDays: number;
  longOpenDays: number;
  staleSyncDays: number;
  minRiskScore: number;
}

interface RiskRow {
  entity: string;
  orderId: string;
  supplier: string | null;
  procurementFunction: string | null;
  orderType: string | null;
  category: string | null;
  currency: string | null;
  amount: number | null;
  dateOfOrder: Date | string | null;
  requestedReceiptDate: Date | string | null;
  erpLastSyncedAt: Date | string | null;
  erpPurchaserCode: string | null;
  openAgeDays: number | null;
  daysUntilRequestedReceipt: number | null;
  staleSyncDays: number | null;
}

export interface OtifRiskOrder {
  entity: string;
  orderId: string;
  supplier: string | null;
  function: string | null;
  orderType: string | null;
  category: string | null;
  currency: string | null;
  amount: number | null;
  dateOfOrder: string | null;
  requestedReceiptDate: string | null;
  erpLastSyncedAt: string | null;
  erpPurchaserCode: string | null;
  openAgeDays: number | null;
  daysUntilRequestedReceipt: number | null;
  riskScore: number;
  riskBand: "low" | "medium" | "high" | "critical";
  drivers: string[];
}

export interface OtifRiskResponse {
  scope: {
    entity: string;
    dateFrom: string | null;
    dateTo: string | null;
    horizonDays: number;
    longOpenDays: number;
    staleSyncDays: number;
    minRiskScore: number;
  };
  generatedAt: string;
  data: OtifRiskOrder[];
  summary: {
    totalFlagged: number;
    byBand: { low: number; medium: number; high: number; critical: number };
  };
  coverage: {
    proxy: true;
    excluded: string[];
    reason: string;
  };
}

function parsePositiveInt(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new BadRequestError(`${label} must be a positive integer.`);
  return parsed;
}

function parseScore(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new BadRequestError("minRiskScore must be an integer from 0 to 100.");
  }
  return parsed;
}

export function parseOtifRiskOptions(input: OtifRiskInput = {}): OtifRiskOptions {
  return {
    ...parseKpiOptions(input),
    horizonDays: parsePositiveInt(input.horizonDays, 14, "horizonDays"),
    longOpenDays: parsePositiveInt(input.longOpenDays, 90, "longOpenDays"),
    staleSyncDays: parsePositiveInt(input.staleSyncDays, 3, "staleSyncDays"),
    minRiskScore: parseScore(input.minRiskScore, 20)
  };
}

function dateParam(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function riskWhere(options: OtifRiskOptions): { sqlText: string; params: SqlParams } {
  const clauses = [
    "is_closed = 0",
    "(requested_receipt_date IS NULL OR requested_receipt_date >= CAST(SYSUTCDATETIME() AS date))"
  ];
  const params: SqlParams = {
    horizon_days: typedParam(sql.Int, options.horizonDays),
    long_open_days: typedParam(sql.Int, options.longOpenDays),
    stale_sync_days: typedParam(sql.Int, options.staleSyncDays)
  };
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
    sqlText: `WHERE ${clauses.join(" AND ")}`,
    params
  };
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

function riskBand(score: number): OtifRiskOrder["riskBand"] {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

export function scoreOtifRisk(row: RiskRow, options: Pick<OtifRiskOptions, "horizonDays" | "longOpenDays" | "staleSyncDays">): Pick<OtifRiskOrder, "riskScore" | "riskBand" | "drivers"> {
  const drivers: string[] = [];
  let score = 0;

  if (row.requestedReceiptDate == null) {
    score += 25;
    drivers.push("missing requested receipt date");
  } else if (row.daysUntilRequestedReceipt != null) {
    if (row.daysUntilRequestedReceipt <= 3) {
      score += 35;
      drivers.push("requested receipt due within 3 days");
    } else if (row.daysUntilRequestedReceipt <= 7) {
      score += 25;
      drivers.push("requested receipt due within 7 days");
    } else if (row.daysUntilRequestedReceipt <= options.horizonDays) {
      score += 15;
      drivers.push(`requested receipt due within ${options.horizonDays} days`);
    }
  }

  if (row.staleSyncDays == null) {
    score += 15;
    drivers.push("missing ERP sync timestamp");
  } else if (row.staleSyncDays > options.staleSyncDays) {
    score += 20;
    drivers.push(`ERP sync older than ${options.staleSyncDays} days`);
  }

  if (row.openAgeDays != null) {
    if (row.openAgeDays > options.longOpenDays) {
      score += 25;
      drivers.push(`open longer than ${options.longOpenDays} days`);
    } else if (row.openAgeDays > Math.floor(options.longOpenDays * 0.75)) {
      score += 15;
      drivers.push("open age approaching long-open threshold");
    }
  }

  if (!row.supplier) {
    score += 10;
    drivers.push("missing supplier");
  }
  if (!row.procurementFunction) {
    score += 10;
    drivers.push("unclassified function");
  }
  if (!row.orderType) {
    score += 10;
    drivers.push("unclassified order type");
  }

  const riskScore = Math.max(0, Math.min(100, score));
  return { riskScore, riskBand: riskBand(riskScore), drivers };
}

function mapRiskOrder(row: RiskRow, options: OtifRiskOptions): OtifRiskOrder {
  const scored = scoreOtifRisk(row, options);
  return {
    entity: row.entity,
    orderId: row.orderId,
    supplier: row.supplier,
    function: row.procurementFunction,
    orderType: row.orderType,
    category: row.category,
    currency: row.currency,
    amount: row.amount == null ? null : Number(row.amount),
    dateOfOrder: dateOnly(row.dateOfOrder),
    requestedReceiptDate: dateOnly(row.requestedReceiptDate),
    erpLastSyncedAt: dateTime(row.erpLastSyncedAt),
    erpPurchaserCode: row.erpPurchaserCode,
    openAgeDays: row.openAgeDays == null ? null : Number(row.openAgeDays),
    daysUntilRequestedReceipt: row.daysUntilRequestedReceipt == null ? null : Number(row.daysUntilRequestedReceipt),
    ...scored
  };
}

export async function getOtifRisk(
  input: OtifRiskInput = {},
  query: SqlQueryExecutor = queryParams
): Promise<OtifRiskResponse> {
  const options = parseOtifRiskOptions(input);
  const where = riskWhere(options);
  const rows = await query<RiskRow>(`
    SELECT TOP 100
      entity,
      order_id AS orderId,
      supplier,
      procurement_function AS procurementFunction,
      order_type AS orderType,
      category,
      currency,
      amount,
      date_of_order AS dateOfOrder,
      requested_receipt_date AS requestedReceiptDate,
      erp_last_synced_at AS erpLastSyncedAt,
      erp_purchaser_code AS erpPurchaserCode,
      CASE WHEN date_of_order IS NULL THEN NULL ELSE DATEDIFF(day, date_of_order, SYSUTCDATETIME()) END AS openAgeDays,
      CASE WHEN requested_receipt_date IS NULL THEN NULL ELSE DATEDIFF(day, CAST(SYSUTCDATETIME() AS date), requested_receipt_date) END AS daysUntilRequestedReceipt,
      CASE WHEN erp_last_synced_at IS NULL THEN NULL ELSE DATEDIFF(day, erp_last_synced_at, SYSUTCDATETIME()) END AS staleSyncDays
    FROM dbo.orders
    ${where.sqlText}
      AND (
        requested_receipt_date IS NULL
        OR requested_receipt_date <= DATEADD(day, @horizon_days, CAST(SYSUTCDATETIME() AS date))
        OR erp_last_synced_at IS NULL
        OR erp_last_synced_at < DATEADD(day, -@stale_sync_days, SYSUTCDATETIME())
        OR (date_of_order IS NOT NULL AND DATEDIFF(day, date_of_order, SYSUTCDATETIME()) > FLOOR(@long_open_days * 0.75))
      )
    ORDER BY
      CASE WHEN requested_receipt_date IS NULL THEN 1 ELSE 0 END DESC,
      requested_receipt_date ASC,
      date_of_order ASC;
  `, where.params);

  const data = rows.recordset
    .map(row => mapRiskOrder(row, options))
    .filter(row => row.riskScore >= options.minRiskScore)
    .sort((a, b) => b.riskScore - a.riskScore || (a.daysUntilRequestedReceipt ?? 9999) - (b.daysUntilRequestedReceipt ?? 9999))
    .slice(0, 100);
  const byBand = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const item of data) byBand[item.riskBand] += 1;

  return {
    scope: {
      entity: options.entity || "all",
      dateFrom: options.dateFrom || null,
      dateTo: options.dateTo || null,
      horizonDays: options.horizonDays,
      longOpenDays: options.longOpenDays,
      staleSyncDays: options.staleSyncDays,
      minRiskScore: options.minRiskScore
    },
    generatedAt: new Date().toISOString(),
    data,
    summary: {
      totalFlagged: data.length,
      byBand
    },
    coverage: {
      proxy: true,
      excluded: ["supplierHistoricalDelay", "supplierPromiseRevisionCount", "shipmentStage", "grnOutcome", "trueOtif"],
      reason: "SQL currently stores ERP order headers only. Supplier delay history, promise revision counts, shipment stage, GRN outcomes, and true OTIF are not available yet, so this is an order-only early-warning proxy."
    }
  };
}
