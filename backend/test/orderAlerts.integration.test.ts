import assert from "node:assert/strict";
import * as sql from "mssql";
import { test } from "node:test";
import { fetchOrderAlerts, runOrderAlertNotifications } from "../src/notifications/orderAlerts";
import { closeSqlPool, queryParams, typedParam } from "../src/sql/client";

const runIntegration = process.env.RUN_SQL_INTEGRATION === "true" && !!process.env.SQL_CONNECTION_STRING;
const entity = "F2 Entity";
const prefix = "F2-";

async function cleanup(): Promise<void> {
  await queryParams("DELETE FROM dbo.notification_state WHERE entity = @entity OR order_id LIKE @prefix;", {
    entity: typedParam(sql.NVarChar(120), entity),
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`)
  });
  await queryParams("DELETE FROM dbo.orders WHERE entity = @entity OR order_id LIKE @prefix;", {
    entity: typedParam(sql.NVarChar(120), entity),
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`)
  });
}

async function seed(): Promise<void> {
  await queryParams(`
    INSERT INTO dbo.orders (
      entity, order_id, erp_source, supplier, order_type, procurement_function,
      currency, amount, date_of_order, requested_receipt_date, erp_po_status,
      erp_purchaser_code, lines_json, status, is_closed, warehouse_loaded_at,
      erp_sync_status, erp_last_synced_at
    )
    VALUES
      (@entity, @overdue, @erp_source, @supplier, @foreign, @technical,
       @usd, @amount100, CAST(SYSUTCDATETIME() AS date), DATEADD(day, -2, CAST(SYSUTCDATETIME() AS date)), @released,
       @purchaser, @lines, @initial_status, 0, SYSUTCDATETIME(),
       @synced, SYSUTCDATETIME()),
      (@entity, @approaching, @erp_source, @supplier, @foreign, @technical,
       @usd, @amount200, CAST(SYSUTCDATETIME() AS date), DATEADD(day, 3, CAST(SYSUTCDATETIME() AS date)), @released,
       @purchaser, @lines, @initial_status, 0, SYSUTCDATETIME(),
       @synced, SYSUTCDATETIME()),
      (@entity, @stale, @erp_source, @supplier, @foreign, @technical,
       @usd, @amount300, CAST(SYSUTCDATETIME() AS date), DATEADD(day, 30, CAST(SYSUTCDATETIME() AS date)), @released,
       @purchaser, @lines, @initial_status, 0, SYSUTCDATETIME(),
       @synced, DATEADD(day, -8, SYSUTCDATETIME())),
      (@entity, @closed, @erp_source, @supplier, @foreign, @technical,
       @usd, @amount400, CAST(SYSUTCDATETIME() AS date), DATEADD(day, -2, CAST(SYSUTCDATETIME() AS date)), @released,
       @purchaser, @lines, @initial_status, 1, SYSUTCDATETIME(),
       @synced, DATEADD(day, -8, SYSUTCDATETIME()));
  `, {
    entity: typedParam(sql.NVarChar(120), entity),
    overdue: typedParam(sql.NVarChar(120), `${prefix}OVERDUE`),
    approaching: typedParam(sql.NVarChar(120), `${prefix}APPROACHING`),
    stale: typedParam(sql.NVarChar(120), `${prefix}STALE`),
    closed: typedParam(sql.NVarChar(120), `${prefix}CLOSED`),
    erp_source: typedParam(sql.NVarChar(80), "Navision"),
    supplier: typedParam(sql.NVarChar(255), "F2 Supplier"),
    foreign: typedParam(sql.NVarChar(40), "foreign"),
    technical: typedParam(sql.NVarChar(40), "technical"),
    usd: typedParam(sql.NVarChar(10), "USD"),
    amount100: typedParam(sql.Decimal(18, 4), 100),
    amount200: typedParam(sql.Decimal(18, 4), 200),
    amount300: typedParam(sql.Decimal(18, 4), 300),
    amount400: typedParam(sql.Decimal(18, 4), 400),
    released: typedParam(sql.NVarChar(80), "Released"),
    purchaser: typedParam(sql.NVarChar(120), "F2OFFICER"),
    lines: typedParam(sql.NVarChar(sql.MAX), JSON.stringify([{ lineNo: 10000, amount: 1 }])),
    initial_status: typedParam(sql.NVarChar(120), "Order sent to supplier"),
    synced: typedParam(sql.NVarChar(40), "synced")
  });
}

test("F2 order alerts query finds overdue, approaching, and stale open orders", {
  skip: runIntegration ? false : "Set RUN_SQL_INTEGRATION=true and SQL_CONNECTION_STRING to run SQL integration."
}, async () => {
  try {
    await cleanup();
    await seed();
    const alerts = await fetchOrderAlerts({ approachingDays: 7, staleSyncDays: 3 });
    const scoped = alerts.filter(alert => alert.entity === entity);
    assert.equal(scoped.filter(alert => alert.alertType === "requestedReceiptOverdue").length, 1);
    assert.equal(scoped.filter(alert => alert.alertType === "requestedReceiptApproaching").length, 1);
    assert.equal(scoped.filter(alert => alert.alertType === "staleOrderSync").length, 1);
    assert.ok(scoped.every(alert => alert.orderId !== `${prefix}CLOSED`));

    const result = await runOrderAlertNotifications({
      enabled: true,
      dryRun: true,
      approachingDays: 7,
      staleSyncDays: 3,
      recipientMap: {
        f2officer: { email: "f2@example.com", label: "F2 officer" }
      }
    });
    assert.ok(result.fetched >= 3);
    assert.ok(result.digests.some(digest => digest.to === "f2@example.com" && digest.count >= 3));

    let sentEmails = 0;
    const firstSend = await runOrderAlertNotifications({
      enabled: true,
      dryRun: false,
      approachingDays: 7,
      staleSyncDays: 3,
      recipientMap: {
        f2officer: { email: "f2@example.com", label: "F2 officer" }
      }
    }, {
      async sendMail() {
        sentEmails += 1;
      }
    });
    assert.equal(firstSend.sentEmails, 1);
    assert.ok(firstSend.eligible >= 3);
    assert.equal(sentEmails, 1);

    const secondSend = await runOrderAlertNotifications({
      enabled: true,
      dryRun: false,
      approachingDays: 7,
      staleSyncDays: 3,
      recipientMap: {
        f2officer: { email: "f2@example.com", label: "F2 officer" }
      }
    }, {
      async sendMail() {
        sentEmails += 1;
      }
    });
    assert.equal(secondSend.sentEmails, 0);
    assert.equal(secondSend.eligible, 0);
    assert.ok(secondSend.suppressed >= 3);
    assert.equal(sentEmails, 1);
  } finally {
    await cleanup();
    await closeSqlPool();
  }
});
