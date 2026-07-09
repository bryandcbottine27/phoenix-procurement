import assert from "node:assert/strict";
import * as sql from "mssql";
import { test } from "node:test";
import { getCycleTimeAnalytics } from "../src/analytics/cycleTime";
import { closeSqlPool, queryParams, typedParam } from "../src/sql/client";

const runIntegration = process.env.RUN_SQL_INTEGRATION === "true" && !!process.env.SQL_CONNECTION_STRING;
const entity = "F3 Entity";
const prefix = "F3-";

async function cleanup(): Promise<void> {
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
      erp_purchaser_code, category, lines_json, status, is_closed,
      warehouse_loaded_at, erp_sync_status, erp_last_synced_at
    )
    VALUES
      (@entity, @age15, @erp_source, @supplier, @foreign, @technical,
       @usd, @amount100, DATEADD(day, -15, CAST(SYSUTCDATETIME() AS date)), DATEADD(day, -2, CAST(SYSUTCDATETIME() AS date)), @released,
       @officer, @category, @lines, @initial_status, 0,
       SYSUTCDATETIME(), @synced, SYSUTCDATETIME()),
      (@entity, @age45, @erp_source, @supplier, @foreign, @technical,
       @usd, @amount200, DATEADD(day, -45, CAST(SYSUTCDATETIME() AS date)), DATEADD(day, -10, CAST(SYSUTCDATETIME() AS date)), @released,
       @officer, @category, @lines, @initial_status, 0,
       SYSUTCDATETIME(), @synced, DATEADD(day, -8, SYSUTCDATETIME())),
      (@entity, @age120, @erp_source, @supplier, @foreign, @technical,
       @usd, @amount300, DATEADD(day, -120, CAST(SYSUTCDATETIME() AS date)), DATEADD(day, 10, CAST(SYSUTCDATETIME() AS date)), @released,
       @officer, @category, @lines, @initial_status, 0,
       SYSUTCDATETIME(), @synced, SYSUTCDATETIME()),
      (@entity, @closed, @erp_source, @supplier, @foreign, @technical,
       @usd, @amount400, DATEADD(day, -5, CAST(SYSUTCDATETIME() AS date)), NULL, @released,
       @officer, @category, @lines, @initial_status, 1,
       SYSUTCDATETIME(), @synced, DATEADD(day, -8, SYSUTCDATETIME()));
  `, {
    entity: typedParam(sql.NVarChar(120), entity),
    age15: typedParam(sql.NVarChar(120), `${prefix}AGE15`),
    age45: typedParam(sql.NVarChar(120), `${prefix}AGE45`),
    age120: typedParam(sql.NVarChar(120), `${prefix}AGE120`),
    closed: typedParam(sql.NVarChar(120), `${prefix}CLOSED`),
    erp_source: typedParam(sql.NVarChar(80), "Navision"),
    supplier: typedParam(sql.NVarChar(255), "F3 Supplier"),
    foreign: typedParam(sql.NVarChar(40), "foreign"),
    technical: typedParam(sql.NVarChar(40), "technical"),
    usd: typedParam(sql.NVarChar(10), "USD"),
    amount100: typedParam(sql.Decimal(18, 4), 100),
    amount200: typedParam(sql.Decimal(18, 4), 200),
    amount300: typedParam(sql.Decimal(18, 4), 300),
    amount400: typedParam(sql.Decimal(18, 4), 400),
    released: typedParam(sql.NVarChar(80), "Released"),
    officer: typedParam(sql.NVarChar(120), "F3OFFICER"),
    category: typedParam(sql.NVarChar(120), "F3 Category"),
    lines: typedParam(sql.NVarChar(sql.MAX), JSON.stringify([{ lineNo: 10000, amount: 1 }])),
    initial_status: typedParam(sql.NVarChar(120), "Order sent to supplier"),
    synced: typedParam(sql.NVarChar(40), "synced")
  });
}

test("F3 cycle-time analytics query returns SQL order bottleneck metrics", {
  skip: runIntegration ? false : "Set RUN_SQL_INTEGRATION=true and SQL_CONNECTION_STRING to run SQL integration."
}, async () => {
  try {
    await cleanup();
    await seed();
    const analytics = await getCycleTimeAnalytics({ entity, longOpenDays: "90", staleSyncDays: "3" });

    assert.equal(analytics.orderCycle.openAge.sampleSize, 3);
    assert.equal(analytics.orderCycle.openAge.avgDays, 60);
    assert.equal(analytics.orderCycle.openAge.medianDays, 45);
    assert.equal(analytics.orderCycle.requestedReceiptLeadTime.sampleSize, 3);
    assert.equal(analytics.orderCycle.requestedReceiptLeadTime.avgDays, 59.3);
    assert.equal(analytics.orderCycle.requestedReceiptDelay.sampleSize, 2);
    assert.equal(analytics.orderCycle.requestedReceiptDelay.avgDays, 6);
    assert.equal(analytics.slaBreaches.requestedReceiptOverdue, 2);
    assert.equal(analytics.slaBreaches.staleSync, 1);
    assert.equal(analytics.slaBreaches.longOpen, 1);
    assert.deepEqual(analytics.bottlenecks.byOfficer[0], {
      value: "F3OFFICER",
      openOrders: 3,
      avgOpenAgeDays: 60,
      requestedReceiptOverdue: 2,
      staleSync: 1,
      longOpen: 1
    });
    assert.ok(analytics.coverage.reason.includes("Workflow/status transition history"));
  } finally {
    await cleanup();
    await closeSqlPool();
  }
});
