import * as sql from "mssql";
import { SqlParams, SqlQueryExecutor, queryParams, typedParam } from "../sql/client";
import { NotificationSender } from "./graphClient";

export type OrderAlertType = "requestedReceiptOverdue" | "requestedReceiptApproaching" | "staleOrderSync";

export interface OrderAlertRow {
  alertType: OrderAlertType;
  entity: string;
  orderId: string;
  supplier: string | null;
  procurementFunction: string | null;
  currency: string | null;
  amount: number | null;
  requestedReceiptDate: Date | string | null;
  erpLastSyncedAt: Date | string | null;
  erpPurchaserCode: string | null;
  erpCreatedBy: string | null;
  claimant: string | null;
  dateDeltaDays: number | null;
  staleDays: number | null;
}

export interface RecipientTarget {
  email?: string;
  label?: string;
}

export type RecipientMap = Record<string, RecipientTarget>;

export interface OrderAlertSettings {
  enabled: boolean;
  dryRun: boolean;
  approachingDays: number;
  staleSyncDays: number;
  recipientMap: RecipientMap;
  fallbackRecipient?: RecipientTarget;
  teamsTeamId?: string;
  teamsChannelId?: string;
}

export interface AlertDigest {
  recipient: RecipientTarget;
  alerts: OrderAlertRow[];
  subject: string;
  bodyText: string;
}

export interface NotificationRunResult {
  enabled: boolean;
  dryRun: boolean;
  fetched: number;
  matched: number;
  unmatched: number;
  sentEmails: number;
  postedTeamsMessages: number;
  digests: { to: string | null; label: string | null; count: number }[];
}

function envFlag(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["true", "1", "yes"].includes(value);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normaliseKey(value: string): string {
  return value.trim().toLowerCase();
}

function parseRecipientTarget(value: unknown): RecipientTarget | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value.trim() ? { email: value.trim() } : undefined;
  if (typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const email = typeof raw.email === "string" ? raw.email.trim() : "";
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!email && !label) return undefined;
  return { ...(email ? { email } : {}), ...(label ? { label } : {}) };
}

export function parseRecipientMap(raw = process.env.ORDER_ALERT_RECIPIENT_MAP_JSON || ""): RecipientMap {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const out: RecipientMap = {};
  for (const [key, value] of Object.entries(parsed || {})) {
    const target = parseRecipientTarget(value);
    if (target) out[normaliseKey(key)] = target;
  }
  return out;
}

export function orderAlertSettingsFromEnv(): OrderAlertSettings {
  return {
    enabled: envFlag("ORDER_ALERTS_ENABLED", false),
    dryRun: envFlag("ORDER_ALERTS_DRY_RUN", true),
    approachingDays: envInt("ORDER_ALERTS_APPROACHING_DAYS", 7),
    staleSyncDays: envInt("ORDER_ALERTS_STALE_SYNC_DAYS", 3),
    recipientMap: parseRecipientMap(),
    fallbackRecipient: parseRecipientTarget(process.env.ORDER_ALERT_FALLBACK_EMAIL || ""),
    teamsTeamId: process.env.GRAPH_TEAMS_TEAM_ID?.trim() || undefined,
    teamsChannelId: process.env.GRAPH_TEAMS_CHANNEL_ID?.trim() || undefined
  };
}

function alertWhere(): string {
  return "is_closed = 0";
}

function alertParams(settings: Pick<OrderAlertSettings, "approachingDays" | "staleSyncDays">): SqlParams {
  return {
    approaching_days: typedParam(sql.Int, settings.approachingDays),
    stale_sync_days: typedParam(sql.Int, settings.staleSyncDays)
  };
}

export async function fetchOrderAlerts(
  settings: Pick<OrderAlertSettings, "approachingDays" | "staleSyncDays">,
  query: SqlQueryExecutor = queryParams
): Promise<OrderAlertRow[]> {
  const result = await query<OrderAlertRow>(`
    SELECT
      CAST(N'requestedReceiptOverdue' AS nvarchar(40)) AS alertType,
      entity,
      order_id AS orderId,
      supplier,
      procurement_function AS procurementFunction,
      currency,
      amount,
      requested_receipt_date AS requestedReceiptDate,
      erp_last_synced_at AS erpLastSyncedAt,
      erp_purchaser_code AS erpPurchaserCode,
      erp_created_by AS erpCreatedBy,
      claimant,
      DATEDIFF(day, requested_receipt_date, CAST(SYSUTCDATETIME() AS date)) AS dateDeltaDays,
      NULL AS staleDays
    FROM dbo.orders
    WHERE ${alertWhere()}
      AND requested_receipt_date < CAST(SYSUTCDATETIME() AS date)

    UNION ALL

    SELECT
      CAST(N'requestedReceiptApproaching' AS nvarchar(40)) AS alertType,
      entity,
      order_id AS orderId,
      supplier,
      procurement_function AS procurementFunction,
      currency,
      amount,
      requested_receipt_date AS requestedReceiptDate,
      erp_last_synced_at AS erpLastSyncedAt,
      erp_purchaser_code AS erpPurchaserCode,
      erp_created_by AS erpCreatedBy,
      claimant,
      DATEDIFF(day, CAST(SYSUTCDATETIME() AS date), requested_receipt_date) AS dateDeltaDays,
      NULL AS staleDays
    FROM dbo.orders
    WHERE ${alertWhere()}
      AND requested_receipt_date >= CAST(SYSUTCDATETIME() AS date)
      AND requested_receipt_date <= DATEADD(day, @approaching_days, CAST(SYSUTCDATETIME() AS date))

    UNION ALL

    SELECT
      CAST(N'staleOrderSync' AS nvarchar(40)) AS alertType,
      entity,
      order_id AS orderId,
      supplier,
      procurement_function AS procurementFunction,
      currency,
      amount,
      requested_receipt_date AS requestedReceiptDate,
      erp_last_synced_at AS erpLastSyncedAt,
      erp_purchaser_code AS erpPurchaserCode,
      erp_created_by AS erpCreatedBy,
      claimant,
      NULL AS dateDeltaDays,
      CASE
        WHEN erp_last_synced_at IS NULL THEN NULL
        ELSE DATEDIFF(day, erp_last_synced_at, SYSUTCDATETIME())
      END AS staleDays
    FROM dbo.orders
    WHERE ${alertWhere()}
      AND (
        erp_last_synced_at IS NULL
        OR erp_last_synced_at < DATEADD(day, -@stale_sync_days, SYSUTCDATETIME())
      )
    ORDER BY entity, orderId, alertType;
  `, alertParams(settings));
  return result.recordset;
}

function recipientKeys(alert: OrderAlertRow): string[] {
  return [
    alert.erpPurchaserCode,
    alert.erpCreatedBy,
    alert.claimant,
    alert.procurementFunction,
    alert.entity,
    "default"
  ]
    .filter((value): value is string => !!value && !!value.trim())
    .map(normaliseKey);
}

export function resolveRecipient(alert: OrderAlertRow, settings: Pick<OrderAlertSettings, "recipientMap" | "fallbackRecipient">): RecipientTarget | undefined {
  for (const key of recipientKeys(alert)) {
    const target = settings.recipientMap[key];
    if (target) return target;
  }
  return settings.fallbackRecipient;
}

function formatDate(value: Date | string | null): string {
  if (!value) return "n/a";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function formatAmount(alert: OrderAlertRow): string {
  if (alert.amount == null) return "";
  const value = Number(alert.amount).toFixed(2);
  return ` ${alert.currency || ""} ${value}`.trim();
}

function alertLine(alert: OrderAlertRow): string {
  const base = `${alert.entity} ${alert.orderId} ${alert.supplier || "Unknown supplier"}${formatAmount(alert) ? ` (${formatAmount(alert)})` : ""}`;
  if (alert.alertType === "requestedReceiptOverdue") {
    return `- OVERDUE requested receipt: ${base}; requested ${formatDate(alert.requestedReceiptDate)}; ${alert.dateDeltaDays ?? "n/a"} day(s) overdue.`;
  }
  if (alert.alertType === "requestedReceiptApproaching") {
    return `- APPROACHING requested receipt: ${base}; requested ${formatDate(alert.requestedReceiptDate)}; due in ${alert.dateDeltaDays ?? "n/a"} day(s).`;
  }
  return `- STALE ERP sync: ${base}; last synced ${formatDate(alert.erpLastSyncedAt)}; stale for ${alert.staleDays ?? "unknown"} day(s).`;
}

export function buildAlertDigests(
  alerts: OrderAlertRow[],
  settings: Pick<OrderAlertSettings, "recipientMap" | "fallbackRecipient">
): { digests: AlertDigest[]; unmatched: OrderAlertRow[] } {
  const groups = new Map<string, { recipient: RecipientTarget; alerts: OrderAlertRow[] }>();
  const unmatched: OrderAlertRow[] = [];
  for (const alert of alerts) {
    const recipient = resolveRecipient(alert, settings);
    if (!recipient?.email) {
      unmatched.push(alert);
      continue;
    }
    const key = recipient.email.toLowerCase();
    const group = groups.get(key) || { recipient, alerts: [] };
    group.alerts.push(alert);
    groups.set(key, group);
  }
  const digests: AlertDigest[] = Array.from(groups.values()).map(group => ({
    recipient: group.recipient,
    alerts: group.alerts,
    subject: `Phoenix Procurement order alerts (${group.alerts.length})`,
    bodyText: [
      "Phoenix Procurement order alerts",
      "",
      "These alerts are based on SQL order data only.",
      "",
      ...group.alerts.map(alertLine)
    ].join("\n")
  }));
  return { digests, unmatched };
}

export async function runOrderAlertNotifications(
  settings: OrderAlertSettings = orderAlertSettingsFromEnv(),
  sender?: NotificationSender,
  query: SqlQueryExecutor = queryParams
): Promise<NotificationRunResult> {
  if (!settings.enabled) {
    return {
      enabled: false,
      dryRun: settings.dryRun,
      fetched: 0,
      matched: 0,
      unmatched: 0,
      sentEmails: 0,
      postedTeamsMessages: 0,
      digests: []
    };
  }

  const alerts = await fetchOrderAlerts(settings, query);
  const { digests, unmatched } = buildAlertDigests(alerts, settings);
  let sentEmails = 0;
  let postedTeamsMessages = 0;

  if (!settings.dryRun) {
    if (!sender) throw new Error("Notification sender is required when ORDER_ALERTS_DRY_RUN is false.");
    for (const digest of digests) {
      if (!digest.recipient.email) continue;
      await sender.sendMail({
        to: [digest.recipient.email],
        subject: digest.subject,
        bodyText: digest.bodyText
      });
      sentEmails += 1;
    }
    if (sender.postTeamsChannelMessage && settings.teamsTeamId && settings.teamsChannelId && alerts.length) {
      await sender.postTeamsChannelMessage({
        teamId: settings.teamsTeamId,
        channelId: settings.teamsChannelId,
        bodyText: [
          `Phoenix Procurement order alerts: ${alerts.length}`,
          "",
          ...alerts.slice(0, 25).map(alertLine)
        ].join("\n")
      });
      postedTeamsMessages += 1;
    }
  }

  return {
    enabled: true,
    dryRun: settings.dryRun,
    fetched: alerts.length,
    matched: alerts.length - unmatched.length,
    unmatched: unmatched.length,
    sentEmails,
    postedTeamsMessages,
    digests: digests.map(digest => ({
      to: digest.recipient.email || null,
      label: digest.recipient.label || null,
      count: digest.alerts.length
    }))
  };
}
