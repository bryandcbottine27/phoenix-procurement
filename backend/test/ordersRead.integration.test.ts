import assert from "node:assert/strict";
import * as sql from "mssql";
import { test } from "node:test";
import { listOrders } from "../src/kpi/queries";
import { closeSqlPool, queryParams, typedParam } from "../src/sql/client";

const runIntegration = process.env.RUN_SQL_INTEGRATION === "true" && !!process.env.SQL_CONNECTION_STRING;

async function countOrders(): Promise<number> {
  const result = await queryParams<{ total: number }>("SELECT COUNT(*) AS total FROM dbo.orders;");
  return Number(result.recordset[0]?.total || 0);
}

async function seedOrders(): Promise<void> {
  await queryParams("DELETE FROM dbo.orders WHERE order_id LIKE @prefix;", {
    prefix: typedParam(sql.NVarChar(120), "F1A-%")
  });
  await queryParams(`
    INSERT INTO dbo.orders (
      entity, order_id, erp_source, erp_company, supplier, order_type,
      procurement_function, currency, amount, date_of_order, requested_receipt_date,
      erp_po_status, erp_amount, erp_currency, lines_json, status, is_closed,
      integration_layer, warehouse_source, warehouse_record_id, warehouse_batch_id,
      warehouse_loaded_at, erp_sync_status, erp_last_synced_at
    )
    VALUES
      (
        @entity, @order_id_1, @erp_source, @erp_company, @supplier_1, @order_type,
        @procurement_function, @currency_usd, @amount_1, @date_1, @receipt_1,
        @erp_po_status, @amount_1, @currency_usd, @lines_1, @status, @is_closed,
        @integration_layer, @warehouse_source, @warehouse_record_id_1, @warehouse_batch_id,
        @loaded_at, @erp_sync_status, @loaded_at
      ),
      (
        @entity, @order_id_2, @erp_source, @erp_company, @supplier_2, @order_type,
        @procurement_function, @currency_eur, @amount_2, @date_2, @receipt_2,
        @erp_po_status, @amount_2, @currency_eur, @lines_2, @status, @is_closed,
        @integration_layer, @warehouse_source, @warehouse_record_id_2, @warehouse_batch_id,
        @loaded_at, @erp_sync_status, @loaded_at
      );
  `, {
    entity: typedParam(sql.NVarChar(120), "Phoenix"),
    erp_source: typedParam(sql.NVarChar(80), "Navision"),
    erp_company: typedParam(sql.NVarChar(120), "PHOENIX-NAV"),
    order_id_1: typedParam(sql.NVarChar(120), "F1A-ORDER-1"),
    order_id_2: typedParam(sql.NVarChar(120), "F1A-ORDER-2"),
    supplier_1: typedParam(sql.NVarChar(255), "F1A Supplier USD"),
    supplier_2: typedParam(sql.NVarChar(255), "F1A Supplier EUR"),
    order_type: typedParam(sql.NVarChar(40), "foreign"),
    procurement_function: typedParam(sql.NVarChar(40), "technical"),
    currency_usd: typedParam(sql.NVarChar(10), "USD"),
    currency_eur: typedParam(sql.NVarChar(10), "EUR"),
    amount_1: typedParam(sql.Decimal(18, 4), 100),
    amount_2: typedParam(sql.Decimal(18, 4), 200),
    date_1: typedParam(sql.Date, new Date("2026-07-01T00:00:00.000Z")),
    date_2: typedParam(sql.Date, new Date("2026-07-02T00:00:00.000Z")),
    receipt_1: typedParam(sql.Date, new Date("2026-08-01T00:00:00.000Z")),
    receipt_2: typedParam(sql.Date, new Date("2026-08-02T00:00:00.000Z")),
    erp_po_status: typedParam(sql.NVarChar(80), "Released"),
    lines_1: typedParam(sql.NVarChar(sql.MAX), JSON.stringify([{ lineNo: 10000, amount: 100 }])),
    lines_2: typedParam(sql.NVarChar(sql.MAX), JSON.stringify([{ lineNo: 10000, amount: 200 }])),
    status: typedParam(sql.NVarChar(120), "Order sent to supplier"),
    is_closed: typedParam(sql.Bit, false),
    integration_layer: typedParam(sql.NVarChar(80), "integration-test"),
    warehouse_source: typedParam(sql.NVarChar(255), "integration-test"),
    warehouse_record_id_1: typedParam(sql.NVarChar(255), "F1A-ROW-1"),
    warehouse_record_id_2: typedParam(sql.NVarChar(255), "F1A-ROW-2"),
    warehouse_batch_id: typedParam(sql.NVarChar(120), "F1A-BATCH"),
    loaded_at: typedParam(sql.DateTime2, new Date("2026-07-09T08:00:00.000Z")),
    erp_sync_status: typedParam(sql.NVarChar(40), "synced")
  });
}

test("F1a orders endpoint query reads seeded SQL rows without writes", {
  skip: runIntegration ? false : "Set RUN_SQL_INTEGRATION=true and SQL_CONNECTION_STRING to run SQL integration."
}, async () => {
  try {
    await seedOrders();
    const before = await countOrders();
    const firstPage = await listOrders({
      entity: "Phoenix",
      function: "technical",
      supplier: "F1A Supplier",
      page: "1",
      pageSize: "1",
      sort: "date_of_order:desc"
    });
    const secondPage = await listOrders({
      entity: "Phoenix",
      function: "technical",
      supplier: "F1A Supplier",
      page: "2",
      pageSize: "1",
      sort: "date_of_order:desc"
    });
    const after = await countOrders();

    assert.equal(firstPage.total, 2);
    assert.equal(firstPage.data.length, 1);
    assert.equal(firstPage.data[0].orderId, "F1A-ORDER-2");
    assert.equal(secondPage.data[0].orderId, "F1A-ORDER-1");
    assert.equal(after, before);
  } finally {
    await queryParams("DELETE FROM dbo.orders WHERE order_id LIKE @prefix;", {
      prefix: typedParam(sql.NVarChar(120), "F1A-%")
    });
    await closeSqlPool();
  }
});
