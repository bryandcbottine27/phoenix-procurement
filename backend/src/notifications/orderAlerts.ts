import { createHash } from "node:crypto";
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
  repeatSuppressionHours?: number;
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
  suppressed: number;
  eligible: number;
  sentEmails: number;
  postedTeamsMessages: number;
  digests: { to: string | null; label: string | null; count: number }[];
}

interface NotificationStateRow {
  alertKey: string | null;
}

interface TrackedAlert {
  alert: OrderAlertRow;
  recipient: RecipientTarget;
  alertKey: string;
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
    repeatSuppressionHours: envInt("ORDER_ALERTS_REPEAT_SUPPRESSION_HOURS", 24),
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

export function notificationAlertKey(alert: OrderAlertRow, recipientEmail: string): string {
  const parts = [
    recipientEmail.trim().toLowerCase(),
    alert.alertType,
    alert.entity.trim().toLowerCase(),
    alert.orderId.trim().toLowerCase()
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
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

function suppressionHours(settings: Pick<OrderAlertSettings, "repeatSuppressionHours">): number {
  if (typeof settings.repeatSuppressionHours === "number" && Number.isFinite(settings.repeatSuppressionHours)) {
    return Math.max(0, Math.floor(settings.repeatSuppressionHours));
  }
  return 24;
}

function trackedDigestAlerts(digests: AlertDigest[]): TrackedAlert[] {
  const tracked: TrackedAlert[] = [];
  for (const digest of digests) {
    if (!digest.recipient.email) continue;
    for (const alert of digest.alerts) {
      tracked.push({
        alert,
        recipient: digest.recipient,
        alertKey: notificationAlertKey(alert, digest.recipient.email)
      });
    }
  }
  return tracked;
}

async function recentlySentAlertKeys(
  keys: string[],
  hours: number,
  query: SqlQueryExecutor
): Promise<Set<string>> {
  const uniqueKeys = [...new Set(keys)].filter(Boolean);
  if (!uniqueKeys.length || hours <= 0) return new Set();

  const params: SqlParams = {
    suppression_hours: typedParam(sql.Int, hours)
  };
  const placeholders = uniqueKeys.map((key, index) => {
    const name = `alert_key_${index}`;
    params[name] = typedParam(sql.NVarChar(64), key);
    return `@${name}`;
  });

  const result = await query<NotificationStateRow>(`
    SELECT alert_key AS alertKey
      FROM dbo.notification_state
     WHERE alert_key IN (${placeholders.join(", ")})
       AND last_sent_at IS NOT NULL
       AND last_sent_at >= DATEADD(hour, -@suppression_hours, SYSUTCDATETIME());
  `, params);

  return new Set(
    result.recordset
      .map(row => row.alertKey)
      .filter((key): key is string => typeof key === "string" && !!key.trim())
  );
}

async function suppressRecentlySentDigests(
  digests: AlertDigest[],
  settings: Pick<OrderAlertSettings, "repeatSuppressionHours">,
  query: SqlQueryExecutor
): Promise<{ digests: AlertDigest[]; suppressed: number }> {
  const tracked = trackedDigestAlerts(digests);
  const suppressedKeys = await recentlySentAlertKeys(
    tracked.map(item => item.alertKey),
    suppressionHours(settings),
    query
  );
  if (!suppressedKeys.size) return { digests, suppressed: 0 };

  let suppressed = 0;
  const filtered = digests
    .map(digest => {
      if (!digest.recipient.email) return digest;
      const alerts = digest.alerts.filter(alert => {
        const isSuppressed = suppressedKeys.has(notificationAlertKey(alert, digest.recipient.email || ""));
        if (isSuppressed) suppressed += 1;
        return !isSuppressed;
      });
      return {
        ...digest,
        alerts,
        subject: `Phoenix Procurement order alerts (${alerts.length})`,
        bodyText: [
          "Phoenix Procurement order alerts",
          "",
          "These alerts are based on SQL order data only.",
          "",
          ...alerts.map(alertLine)
        ].join("\n")
      };
    })
    .filter(digest => digest.alerts.length > 0);

  return { digests: filtered, suppressed };
}

async function recordSentNotificationState(
  digest: AlertDigest,
  query: SqlQueryExecutor
): Promise<number> {
  const tracked = trackedDigestAlerts([digest]);
  for (const item of tracked) {
    await query(`
      MERGE dbo.notification_state WITH (HOLDLOCK) AS target
      USING (
        SELECT
          @alert_key AS alert_key,
          @alert_type AS alert_type,
          @entity AS entity,
          @order_id AS order_id,
          @recipient_email AS recipient_email
      ) AS source
      ON target.alert_key = source.alert_key
      WHEN MATCHED THEN
        UPDATE SET
          alert_type = source.alert_type,
          entity = source.entity,
          order_id = source.order_id,
          recipient_email = source.recipient_email,
          last_seen_at = SYSUTCDATETIME(),
          last_sent_at = SYSUTCDATETIME(),
          send_count = target.send_count + 1,
          last_status = N'sent',
          last_error = NULL
      WHEN NOT MATCHED THEN
        INSERT (
          alert_key, alert_type, entity, order_id, recipient_email,
          first_seen_at, last_seen_at, last_sent_at, send_count, last_status, last_error
        )
        VALUES (
          source.alert_key, source.alert_type, source.entity, source.order_id, source.recipient_email,
          SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME(), 1, N'sent', NULL
        );
    `, {
      alert_key: typedParam(sql.NVarChar(64), item.alertKey),
      alert_type: typedParam(sql.NVarChar(80), item.alert.alertType),
      entity: typedParam(sql.NVarChar(120), item.alert.entity),
      order_id: typedParam(sql.NVarChar(120), item.alert.orderId),
      recipient_email: typedParam(sql.NVarChar(320), item.recipient.email || "")
    });
  }
  return tracked.length;
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
      suppressed: 0,
      eligible: 0,
      sentEmails: 0,
      postedTeamsMessages: 0,
      digests: []
    };
  }

  const alerts = await fetchOrderAlerts(settings, query);
  const { digests, unmatched } = buildAlertDigests(alerts, settings);
  const suppressedResult = await suppressRecentlySentDigests(digests, settings, query);
  const sendableDigests = suppressedResult.digests;
  const sendableAlerts = sendableDigests.flatMap(digest => digest.alerts);
  let sentEmails = 0;
  let postedTeamsMessages = 0;

  if (!settings.dryRun && sendableDigests.length) {
    if (!sender) throw new Error("Notification sender is required when ORDER_ALERTS_DRY_RUN is false.");
    for (const digest of sendableDigests) {
      if (!digest.recipient.email) continue;
      await sender.sendMail({
        to: [digest.recipient.email],
        subject: digest.subject,
        bodyText: digest.bodyText
      });
      await recordSentNotificationState(digest, query);
      sentEmails += 1;
    }
    if (sender.postTeamsChannelMessage && settings.teamsTeamId && settings.teamsChannelId && sendableAlerts.length) {
      await sender.postTeamsChannelMessage({
        teamId: settings.teamsTeamId,
        channelId: settings.teamsChannelId,
        bodyText: [
          `Phoenix Procurement order alerts: ${sendableAlerts.length}`,
          "",
          ...sendableAlerts.slice(0, 25).map(alertLine)
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
    suppressed: suppressedResult.suppressed,
    eligible: sendableAlerts.length,
    sentEmails,
    postedTeamsMessages,
    digests: sendableDigests.map(digest => ({
      to: digest.recipient.email || null,
      label: digest.recipient.label || null,
      count: digest.alerts.length
    }))
  };
}
