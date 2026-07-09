import assert from "node:assert/strict";
import * as sql from "mssql";
import { test } from "node:test";
import { getOtifRisk } from "../src/analytics/otifRisk";
import { closeSqlPool, queryParams, typedParam } from "../src/sql/client";

const runIntegration = process.env.RUN_SQL_INTEGRATION === "true" && !!process.env.SQL_CONNECTION_STRING;
const entity = "F4 Entity";
const prefix = "F4-";

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
      (@entity, @critical, @erp_source, @supplier, @foreign, @technical,
       @usd, @amount100, DATEADD(day, -100, CAST(SYSUTCDATETIME() AS date)), DATEADD(day, 2, CAST(SYSUTCDATETIME() AS date)), @released,
       @officer, @category, @lines, @initial_status, 0,
       SYSUTCDATETIME(), @synced, DATEADD(day, -8, SYSUTCDATETIME())),
      (@entity, @low, @erp_source, @supplier, @foreign, @technical,
       @usd, @amount200, DATEADD(day, -5, CAST(SYSUTCDATETIME() AS date)), DATEADD(day, 30, CAST(SYSUTCDATETIME() AS date)), @released,
       @officer, @category, @lines, @initial_status, 0,
       SYSUTCDATETIME(), @synced, SYSUTCDATETIME()),
      (@entity, @overdue, @erp_source, @supplier, @foreign, @technical,
       @usd, @amount300, DATEADD(day, -30, CAST(SYSUTCDATETIME() AS date)), DATEADD(day, -1, CAST(SYSUTCDATETIME() AS date)), @released,
       @officer, @category, @lines, @initial_status, 0,
       SYSUTCDATETIME(), @synced, DATEADD(day, -8, SYSUTCDATETIME()));
  `, {
    entity: typedParam(sql.NVarChar(120), entity),
    critical: typedParam(sql.NVarChar(120), `${prefix}CRITICAL`),
    low: typedParam(sql.NVarChar(120), `${prefix}LOW`),
    overdue: typedParam(sql.NVarChar(120), `${prefix}OVERDUE`),
    erp_source: typedParam(sql.NVarChar(80), "Navision"),
    supplier: typedParam(sql.NVarChar(255), "F4 Supplier"),
    foreign: typedParam(sql.NVarChar(40), "foreign"),
    technical: typedParam(sql.NVarChar(40), "technical"),
    usd: typedParam(sql.NVarChar(10), "USD"),
    amount100: typedParam(sql.Decimal(18, 4), 100),
    amount200: typedParam(sql.Decimal(18, 4), 200),
    amount300: typedParam(sql.Decimal(18, 4), 300),
    released: typedParam(sql.NVarChar(80), "Released"),
    officer: typedParam(sql.NVarChar(120), "F4OFFICER"),
    category: typedParam(sql.NVarChar(120), "F4 Category"),
    lines: typedParam(sql.NVarChar(sql.MAX), JSON.stringify([{ lineNo: 10000, amount: 1 }])),
    initial_status: typedParam(sql.NVarChar(120), "Order sent to supplier"),
    synced: typedParam(sql.NVarChar(40), "synced")
  });
}

test("F4 OTIF risk proxy flags at-risk orders before overdue", {
  skip: runIntegration ? false : "Set RUN_SQL_INTEGRATION=true and SQL_CONNECTION_STRING to run SQL integration."
}, async () => {
  try {
    await cleanup();
    await seed();
    const risk = await getOtifRisk({ entity, horizonDays: "14", longOpenDays: "90", staleSyncDays: "3", minRiskScore: "20" });
    assert.equal(risk.summary.totalFlagged, 1);
    assert.equal(risk.data[0].orderId, `${prefix}CRITICAL`);
    assert.equal(risk.data[0].riskBand, "critical");
    assert.ok(risk.data[0].drivers.includes("requested receipt due within 3 days"));
    assert.ok(risk.data[0].drivers.includes("ERP sync older than 3 days"));
    assert.ok(risk.data.every(item => item.orderId !== `${prefix}OVERDUE`));
    assert.equal(risk.coverage.proxy, true);
  } finally {
    await cleanup();
    await closeSqlPool();
  }
});
