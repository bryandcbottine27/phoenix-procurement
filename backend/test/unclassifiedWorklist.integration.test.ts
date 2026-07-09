import assert from "node:assert/strict";
import * as sql from "mssql";
import { test } from "node:test";
import { listUnclassifiedWorklist } from "../src/worklists/unclassified";
import { closeSqlPool, queryParams, typedParam } from "../src/sql/client";

const runIntegration = process.env.RUN_SQL_INTEGRATION === "true" && !!process.env.SQL_CONNECTION_STRING;
const entity = "F5 Entity";
const prefix = "F5-";

async function cleanup(): Promise<void> {
  await queryParams("DELETE FROM dbo.sync_exceptions WHERE batch_id LIKE @prefix OR entity = @entity;", {
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`),
    entity: typedParam(sql.NVarChar(120), entity)
  });
}

async function countRows(): Promise<number> {
  const result = await queryParams<{ total: number }>("SELECT COUNT(*) AS total FROM dbo.sync_exceptions WHERE entity = @entity;", {
    entity: typedParam(sql.NVarChar(120), entity)
  });
  return Number(result.recordset[0]?.total || 0);
}

async function seed(): Promise<void> {
  await queryParams(`
    INSERT INTO dbo.sync_exceptions (
      batch_id, entity, order_id, warehouse_record_id, error_code,
      error_message, payload_json, status
    )
    VALUES
      (@batch1, @entity, @order1, @row1, @unclassified, @message1, @payload1, @open),
      (@batch1, @entity, @order2, @row2, @supplier, @message2, NULL, @open),
      (@batch1, @entity, @order3, @row3, @currency, @message3, NULL, @resolved),
      (@batch1, @entity, @order4, @row4, @validation, @message4, NULL, @open);
  `, {
    batch1: typedParam(sql.NVarChar(120), `${prefix}BATCH`),
    entity: typedParam(sql.NVarChar(120), entity),
    order1: typedParam(sql.NVarChar(120), `${prefix}ORDER1`),
    order2: typedParam(sql.NVarChar(120), `${prefix}ORDER2`),
    order3: typedParam(sql.NVarChar(120), `${prefix}ORDER3`),
    order4: typedParam(sql.NVarChar(120), `${prefix}ORDER4`),
    row1: typedParam(sql.NVarChar(255), `${prefix}ROW1`),
    row2: typedParam(sql.NVarChar(255), `${prefix}ROW2`),
    row3: typedParam(sql.NVarChar(255), `${prefix}ROW3`),
    row4: typedParam(sql.NVarChar(255), `${prefix}ROW4`),
    unclassified: typedParam(sql.NVarChar(80), "UNCLASSIFIED"),
    supplier: typedParam(sql.NVarChar(80), "UNMAPPED_SUPPLIER"),
    currency: typedParam(sql.NVarChar(80), "CURRENCY_AMBIGUOUS"),
    validation: typedParam(sql.NVarChar(80), "VALIDATION_FAILED"),
    message1: typedParam(sql.NVarChar(sql.MAX), "No function rule matched"),
    message2: typedParam(sql.NVarChar(sql.MAX), "No supplier mapping"),
    message3: typedParam(sql.NVarChar(sql.MAX), "Currency needs review"),
    message4: typedParam(sql.NVarChar(sql.MAX), "Malformed row"),
    payload1: typedParam(sql.NVarChar(sql.MAX), JSON.stringify({ erpPurchaserCode: "ZZ99" })),
    open: typedParam(sql.NVarChar(40), "open"),
    resolved: typedParam(sql.NVarChar(40), "resolved")
  });
}

test("F5 unclassified worklist lists open actionable sync exceptions read-only", {
  skip: runIntegration ? false : "Set RUN_SQL_INTEGRATION=true and SQL_CONNECTION_STRING to run SQL integration."
}, async () => {
  try {
    await cleanup();
    await seed();
    const before = await countRows();
    const response = await listUnclassifiedWorklist({ entity, pageSize: "10", sort: "error_code:asc" });
    const after = await countRows();

    assert.equal(after, before);
    assert.equal(response.total, 2);
    assert.deepEqual(response.summary.byErrorCode, { UNCLASSIFIED: 1, UNMAPPED_SUPPLIER: 1 });
    assert.deepEqual(response.summary.byEntity, { [entity]: 2 });
    assert.deepEqual(response.data.map(row => row.suggestedAction).sort(), ["addImportRule", "mapSupplier"]);
    assert.ok(response.data.every(row => row.errorCode !== "VALIDATION_FAILED"));
    assert.ok(response.coverage.deferred.includes("oneClickAddRule"));
  } finally {
    await cleanup();
    await closeSqlPool();
  }
});
