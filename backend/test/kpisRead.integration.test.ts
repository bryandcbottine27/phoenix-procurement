import assert from "node:assert/strict";
import * as sql from "mssql";
import { test } from "node:test";
import { getKpis } from "../src/kpi/queries";
import { closeSqlPool, queryParams, typedParam } from "../src/sql/client";

const runIntegration = process.env.RUN_SQL_INTEGRATION === "true" && !!process.env.SQL_CONNECTION_STRING;
const entity = "F1B Entity";
const prefix = "F1B-";

async function cleanup(): Promise<void> {
  await queryParams("DELETE FROM dbo.sync_exceptions WHERE batch_id LIKE @prefix OR entity = @entity;", {
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`),
    entity: typedParam(sql.NVarChar(120), entity)
  });
  await queryParams("DELETE FROM dbo.import_audit WHERE batch_id LIKE @prefix;", {
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`)
  });
  await queryParams("DELETE FROM dbo.orders WHERE entity = @entity OR order_id LIKE @prefix;", {
    entity: typedParam(sql.NVarChar(120), entity),
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`)
  });
}

async function countRows(): Promise<number> {
  const result = await queryParams<{ total: number }>("SELECT COUNT(*) AS total FROM dbo.orders WHERE entity = @entity;", {
    entity: typedParam(sql.NVarChar(120), entity)
  });
  return Number(result.recordset[0]?.total || 0);
}

async function seed(): Promise<void> {
  await queryParams(`
    INSERT INTO dbo.orders (
      entity, order_id, erp_source, supplier, order_type, procurement_function,
      currency, amount, erp_amount, erp_currency, date_of_order, ipr_approved_date,
      requested_receipt_date, erp_po_status, lines_json, status, is_closed,
      warehouse_loaded_at, erp_sync_status, erp_last_synced_at
    )
    VALUES
      (@entity, @age15, @erp_source, @supplier, @foreign, @technical,
       @usd, @amount100, @amount100, @usd, DATEADD(day, -15, CAST(SYSUTCDATETIME() AS date)), DATEADD(day, -20, CAST(SYSUTCDATETIME() AS date)),
       DATEADD(day, -1, CAST(SYSUTCDATETIME() AS date)), @released, @lines, @initial_status, 0,
       SYSUTCDATETIME(), @synced, DATEADD(day, -4, SYSUTCDATETIME())),
      (@entity, @age45, @erp_source, @supplier, @foreign, @technical,
       @eur, @amount200, @amount200, @eur, DATEADD(day, -45, CAST(SYSUTCDATETIME() AS date)), DATEADD(day, -51, CAST(SYSUTCDATETIME() AS date)),
       DATEADD(day, 30, CAST(SYSUTCDATETIME() AS date)), @released, @lines, @initial_status, 0,
       SYSUTCDATETIME(), @synced, SYSUTCDATETIME()),
      (@entity, @age75, @erp_source, @supplier, @local, NULL,
       @usd, @amount300, @amount300, @usd, DATEADD(day, -75, CAST(SYSUTCDATETIME() AS date)), DATEADD(day, -85, CAST(SYSUTCDATETIME() AS date)),
       DATEADD(day, 3, CAST(SYSUTCDATETIME() AS date)), @released, @lines, @initial_status, 0,
       SYSUTCDATETIME(), @synced, SYSUTCDATETIME()),
      (@entity, @age120, @erp_source, @supplier, NULL, @technical,
       @eur, @amount400, @amount400, @eur, DATEADD(day, -120, CAST(SYSUTCDATETIME() AS date)), NULL,
       DATEADD(day, 30, CAST(SYSUTCDATETIME() AS date)), @released, @lines, @initial_status, 0,
       SYSUTCDATETIME(), @synced, SYSUTCDATETIME()),
      (@entity, @closed, @erp_source, @supplier, @foreign, @technical,
       @usd, @amount500, @amount500, @usd, DATEADD(day, -5, CAST(SYSUTCDATETIME() AS date)), NULL,
       DATEADD(day, -1, CAST(SYSUTCDATETIME() AS date)), @closed_status, @lines, @closed_initial_status, 1,
       SYSUTCDATETIME(), @synced, SYSUTCDATETIME());
  `, {
    entity: typedParam(sql.NVarChar(120), entity),
    age15: typedParam(sql.NVarChar(120), `${prefix}AGE15`),
    age45: typedParam(sql.NVarChar(120), `${prefix}AGE45`),
    age75: typedParam(sql.NVarChar(120), `${prefix}AGE75`),
    age120: typedParam(sql.NVarChar(120), `${prefix}AGE120`),
    closed: typedParam(sql.NVarChar(120), `${prefix}CLOSED`),
    erp_source: typedParam(sql.NVarChar(80), "Navision"),
    supplier: typedParam(sql.NVarChar(255), "F1B Supplier"),
    foreign: typedParam(sql.NVarChar(40), "foreign"),
    local: typedParam(sql.NVarChar(40), "local"),
    technical: typedParam(sql.NVarChar(40), "technical"),
    usd: typedParam(sql.NVarChar(10), "USD"),
    eur: typedParam(sql.NVarChar(10), "EUR"),
    amount100: typedParam(sql.Decimal(18, 4), 100),
    amount200: typedParam(sql.Decimal(18, 4), 200),
    amount300: typedParam(sql.Decimal(18, 4), 300),
    amount400: typedParam(sql.Decimal(18, 4), 400),
    amount500: typedParam(sql.Decimal(18, 4), 500),
    released: typedParam(sql.NVarChar(80), "Released"),
    closed_status: typedParam(sql.NVarChar(80), "Closed"),
    lines: typedParam(sql.NVarChar(sql.MAX), JSON.stringify([{ lineNo: 10000, amount: 1 }])),
    initial_status: typedParam(sql.NVarChar(120), "Order sent to supplier"),
    closed_initial_status: typedParam(sql.NVarChar(120), "Order closed"),
    synced: typedParam(sql.NVarChar(40), "synced")
  });

  await queryParams(`
    INSERT INTO dbo.sync_exceptions (batch_id, entity, order_id, warehouse_record_id, error_code, error_message, status)
    VALUES (@batch_id, @entity, @order_id, @warehouse_record_id, @error_code, @error_message, @status);
  `, {
    batch_id: typedParam(sql.NVarChar(120), `${prefix}EXCEPTION-BATCH`),
    entity: typedParam(sql.NVarChar(120), entity),
    order_id: typedParam(sql.NVarChar(120), `${prefix}AGE75`),
    warehouse_record_id: typedParam(sql.NVarChar(255), `${prefix}ROW`),
    error_code: typedParam(sql.NVarChar(80), "UNCLASSIFIED"),
    error_message: typedParam(sql.NVarChar(sql.MAX), "unclassified function"),
    status: typedParam(sql.NVarChar(40), "open")
  });

  await queryParams(`
    INSERT INTO dbo.import_audit (
      batch_id, warehouse_source, started_at, finished_at, status,
      fetched_count, normalized_count, created_count, updated_count, exception_count
    )
    VALUES (
      @batch_id, @warehouse_source, @started_at, @finished_at, @status,
      5, 5, 3, 2, 1
    );
  `, {
    batch_id: typedParam(sql.NVarChar(120), `${prefix}AUDIT`),
    warehouse_source: typedParam(sql.NVarChar(255), "f1b.integration"),
    started_at: typedParam(sql.DateTime2, new Date("2099-01-01T00:00:00.000Z")),
    finished_at: typedParam(sql.DateTime2, new Date("2099-01-01T00:01:00.000Z")),
    status: typedParam(sql.NVarChar(40), "completed_with_exceptions")
  });
}

test("F1b KPI endpoint query aggregates SQL order-only metrics honestly", {
  skip: runIntegration ? false : "Set RUN_SQL_INTEGRATION=true and SQL_CONNECTION_STRING to run SQL integration."
}, async () => {
  try {
    await cleanup();
    await seed();
    const before = await countRows();
    const result = await getKpis({ entity });
    const after = await countRows();

    assert.equal(after, before);
    assert.deepEqual(result.counts.openClosed, { open: 4, closed: 1 });
    assert.deepEqual(result.spendCommitment.byCurrency, { EUR: 600, USD: 900 });
    assert.deepEqual(result.mtto, { avgDays: 7, medianDays: 6, sampleSize: 3 });
    assert.deepEqual(result.ageing.openByBucket, { "0-30": 1, "31-60": 1, "61-90": 1, "90+": 1 });
    assert.equal(result.requestedReceipt.proxy, true);
    assert.deepEqual(result.requestedReceipt.overdue, { count: 1, valueByCurrency: { USD: 100 } });
    assert.deepEqual(result.requestedReceipt.approaching, { count: 1, valueByCurrency: { USD: 300 } });
    assert.equal(result.dataQuality.unclassifiedFunction, 1);
    assert.equal(result.dataQuality.unclassifiedOrderType, 1);
    assert.equal(result.dataQuality.openSyncExceptions, 1);
    assert.equal(result.dataQuality.staleSyncCount, 1);
    assert.equal(result.sync.lastBatchId, `${prefix}AUDIT`);
    assert.equal(result.sync.created, 3);
    assert.equal(result.sync.updated, 2);
    assert.equal(result.sync.exceptions, 1);
    assert.ok(result.coverage.excluded.includes("otif"));
    assert.ok(result.coverage.excluded.includes("supplierScorecards"));
  } finally {
    await cleanup();
    await closeSqlPool();
  }
});
