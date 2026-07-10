import assert from "node:assert/strict";
import { test } from "node:test";
import type { IResult } from "mssql";
import type { SqlParams, SqlQueryExecutor } from "../src/sql/client";
import {
  buildAlertDigests,
  fetchOrderAlerts,
  notificationAlertKey,
  OrderAlertRow,
  OrderAlertSettings,
  parseRecipientMap,
  resolveRecipient,
  runOrderAlertNotifications
} from "../src/notifications/orderAlerts";

function result<T>(recordset: T[]): IResult<T> {
  return {
    recordsets: [recordset],
    recordset,
    rowsAffected: [recordset.length],
    output: {}
  } as unknown as IResult<T>;
}

function queryReturning(rows: OrderAlertRow[], capture?: (sqlText: string, params: SqlParams) => void): SqlQueryExecutor {
  return async <T = unknown>(sqlText: string, params: SqlParams = {}) => {
    capture?.(sqlText, params);
    return result(rows as unknown as T[]);
  };
}

const baseSettings: OrderAlertSettings = {
  enabled: true,
  dryRun: true,
  approachingDays: 7,
  staleSyncDays: 3,
  recipientMap: {
    et01: { email: "technical@example.com", label: "Technical" },
    phoenix: { email: "phoenix@example.com", label: "Phoenix fallback" }
  }
};

const sampleAlerts: OrderAlertRow[] = [
  {
    alertType: "requestedReceiptOverdue",
    entity: "Phoenix",
    orderId: "FPO100",
    supplier: "Supplier A",
    procurementFunction: "technical",
    currency: "USD",
    amount: 123.45,
    requestedReceiptDate: "2026-07-01",
    erpLastSyncedAt: "2026-07-08T00:00:00.000Z",
    erpPurchaserCode: "ET01",
    erpCreatedBy: null,
    claimant: null,
    dateDeltaDays: 8,
    staleDays: null
  },
  {
    alertType: "staleOrderSync",
    entity: "Phoenix",
    orderId: "FPO101",
    supplier: "Supplier B",
    procurementFunction: "supplychain",
    currency: "EUR",
    amount: 200,
    requestedReceiptDate: null,
    erpLastSyncedAt: "2026-07-01T00:00:00.000Z",
    erpPurchaserCode: null,
    erpCreatedBy: null,
    claimant: null,
    dateDeltaDays: null,
    staleDays: 8
  }
];

test("parseRecipientMap accepts compact email strings and labelled objects", () => {
  const parsed = parseRecipientMap(JSON.stringify({
    ET01: "technical@example.com",
    Phoenix: { email: "phoenix@example.com", label: "Phoenix officer" }
  }));
  assert.deepEqual(parsed, {
    et01: { email: "technical@example.com" },
    phoenix: { email: "phoenix@example.com", label: "Phoenix officer" }
  });
});

test("fetchOrderAlerts reads only alert-eligible order data with typed thresholds", async () => {
  let sqlText = "";
  let params: SqlParams = {};
  const alerts = await fetchOrderAlerts(baseSettings, queryReturning(sampleAlerts, (text, passedParams) => {
    sqlText = text;
    params = passedParams;
  }));

  assert.equal(alerts.length, 2);
  assert.match(sqlText, /requested_receipt_date < CAST\(SYSUTCDATETIME\(\) AS date\)/);
  assert.match(sqlText, /erp_last_synced_at < DATEADD\(day, -@stale_sync_days, SYSUTCDATETIME\(\)\)/);
  assert.doesNotMatch(sqlText, /\b(INSERT|UPDATE|DELETE|MERGE)\b/i);
  assert.deepEqual(params.approaching_days, { type: params.approaching_days && (params.approaching_days as { type: unknown }).type, value: 7 });
  assert.equal((params.stale_sync_days as { value: number }).value, 3);
});

test("resolveRecipient prefers purchaser code and falls back to entity", () => {
  assert.equal(resolveRecipient(sampleAlerts[0], baseSettings)?.email, "technical@example.com");
  assert.equal(resolveRecipient(sampleAlerts[1], baseSettings)?.email, "phoenix@example.com");
});

test("buildAlertDigests groups alerts by resolved officer email", () => {
  const { digests, unmatched } = buildAlertDigests(sampleAlerts, baseSettings);
  assert.equal(unmatched.length, 0);
  assert.equal(digests.length, 2);
  assert.ok(digests.some(digest => digest.recipient.email === "technical@example.com" && digest.bodyText.includes("OVERDUE")));
  assert.ok(digests.some(digest => digest.recipient.email === "phoenix@example.com" && digest.bodyText.includes("STALE ERP sync")));
});

test("runOrderAlertNotifications supports disabled and dry-run preview modes without sending", async () => {
  let queried = false;
  const disabled = await runOrderAlertNotifications({ ...baseSettings, enabled: false }, undefined, async <T = unknown>() => {
    queried = true;
    return result(sampleAlerts as unknown as T[]);
  });
  assert.equal(disabled.enabled, false);
  assert.equal(queried, false);

  const dryRun = await runOrderAlertNotifications(baseSettings, {
    async sendMail() {
      throw new Error("dry-run must not send mail");
    }
  }, queryReturning(sampleAlerts, (text) => {
    assert.doesNotMatch(text, /\bMERGE\s+dbo\.notification_state\b/i);
  }));
  assert.equal(dryRun.enabled, true);
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.sentEmails, 0);
  assert.equal(dryRun.matched, 2);
  assert.equal(dryRun.unmatched, 0);
  assert.equal(dryRun.suppressed, 0);
  assert.equal(dryRun.eligible, 2);
});

test("runOrderAlertNotifications sends email and optional Teams summary when enabled", async () => {
  const sentTo: string[] = [];
  let teamsPosted = 0;
  const resultValue = await runOrderAlertNotifications(
    { ...baseSettings, dryRun: false, teamsTeamId: "team", teamsChannelId: "channel" },
    {
      async sendMail(message) {
        sentTo.push(...message.to);
      },
      async postTeamsChannelMessage(message) {
        assert.equal(message.teamId, "team");
        assert.equal(message.channelId, "channel");
        teamsPosted += 1;
      }
    },
    queryReturning(sampleAlerts)
  );

  assert.deepEqual(sentTo.sort(), ["phoenix@example.com", "technical@example.com"]);
  assert.equal(teamsPosted, 1);
  assert.equal(resultValue.sentEmails, 2);
  assert.equal(resultValue.postedTeamsMessages, 1);
});

test("runOrderAlertNotifications suppresses recently sent alerts and records newly sent state", async () => {
  const suppressedKey = notificationAlertKey(sampleAlerts[0], "technical@example.com");
  const sentBodies: string[] = [];
  const calls: { sqlText: string; params: SqlParams }[] = [];
  const query: SqlQueryExecutor = async <T = unknown>(sqlText: string, params: SqlParams = {}) => {
    calls.push({ sqlText, params });
    if (/FROM dbo\.orders/i.test(sqlText)) return result(sampleAlerts as unknown as T[]);
    if (/FROM dbo\.notification_state/i.test(sqlText)) return result([{ alertKey: suppressedKey }] as unknown as T[]);
    return result([] as unknown as T[]);
  };

  const resultValue = await runOrderAlertNotifications(
    { ...baseSettings, dryRun: false },
    {
      async sendMail(message) {
        sentBodies.push(message.bodyText);
      }
    },
    query
  );

  assert.equal(resultValue.fetched, 2);
  assert.equal(resultValue.matched, 2);
  assert.equal(resultValue.suppressed, 1);
  assert.equal(resultValue.eligible, 1);
  assert.equal(resultValue.sentEmails, 1);
  assert.equal(resultValue.digests.length, 1);
  assert.equal(resultValue.digests[0].to, "phoenix@example.com");
  assert.equal(resultValue.digests[0].count, 1);
  assert.equal(sentBodies.length, 1);
  assert.doesNotMatch(sentBodies[0], /FPO100/);
  assert.match(sentBodies[0], /FPO101/);

  const stateSelect = calls.find(call => /FROM dbo\.notification_state/i.test(call.sqlText));
  assert.ok(stateSelect);
  assert.deepEqual((stateSelect.params.suppression_hours as { value: number }).value, 24);
  assert.equal((stateSelect.params.alert_key_0 as { value: string }).value.length, 64);
  assert.equal((stateSelect.params.alert_key_1 as { value: string }).value.length, 64);

  const mergeCalls = calls.filter(call => /MERGE dbo\.notification_state/i.test(call.sqlText));
  assert.equal(mergeCalls.length, 1);
  assert.doesNotMatch(mergeCalls[0].sqlText, /FPO101|Supplier B|phoenix@example\.com/);
  assert.equal((mergeCalls[0].params.alert_key as { value: string }).value.length, 64);
  assert.equal((mergeCalls[0].params.order_id as { value: string }).value, "FPO101");
  assert.equal((mergeCalls[0].params.recipient_email as { value: string }).value, "phoenix@example.com");
});
