import assert from "node:assert/strict";
import * as sql from "mssql";
import { test } from "node:test";
import { closeSqlPool, queryParams, typedParam } from "../src/sql/client";
import { syncPurchaseOrders } from "../src/sync/purchaseOrderSync";
import { PurchaseOrderContract } from "../src/warehouse/contract";

const runIntegration = process.env.RUN_SQL_INTEGRATION === "true" && !!process.env.SQL_CONNECTION_STRING;
const prefix = "G4-";

type OrderDbRow = {
  id: number;
  order_id: string;
  amount_text: string | null;
  erp_amount_text: string | null;
  status: string | null;
  is_closed: boolean | number;
  phoenix_data: string;
  lines_json: string | null;
};

async function cleanup(): Promise<void> {
  await queryParams("DELETE FROM dbo.sync_exceptions WHERE batch_id LIKE @prefix OR order_id LIKE @prefix;", {
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`)
  });
  await queryParams("DELETE FROM dbo.import_audit WHERE batch_id LIKE @prefix;", {
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`)
  });
  await queryParams("DELETE FROM dbo.orders WHERE order_id LIKE @prefix;", {
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`)
  });
}

function order(orderId: string, overrides: Partial<PurchaseOrderContract> = {}): PurchaseOrderContract {
  return {
    entity: "Phoenix",
    erpSource: "Navision",
    erpCompany: "PHOENIX-NAV",
    erpDocumentNo: orderId,
    orderId,
    erpVendorNo: "V-G4",
    erpVendorName: "GATE 4 SUPPLIER",
    supplier: "GATE 4 SUPPLIER",
    orderType: "foreign",
    function: "technical",
    currency: "USD",
    amount: 100,
    requestedReceiptDate: "2026-08-15",
    erpPoStatus: "Released",
    erpAmount: 100,
    erpCurrency: "USD",
    lines: [{ lineNo: 10000, amount: 100 }],
    warehouseSource: "gate4.integration",
    warehouseRecordId: `gate4-${orderId}`,
    warehouseLoadedAt: "2026-07-09T08:00:00.000Z",
    ...overrides
  };
}

async function seedOwnedOrder(): Promise<void> {
  await queryParams(`
    INSERT INTO dbo.orders (
      entity, order_id, erp_source, erp_company, supplier, order_type,
      procurement_function, currency, amount, erp_amount, erp_currency,
      erp_po_status, lines_json, status, is_closed, phoenix_data,
      integration_layer, warehouse_source, warehouse_record_id, warehouse_batch_id,
      warehouse_loaded_at, erp_sync_status, erp_last_synced_at
    )
    VALUES (
      @entity, @order_id, @erp_source, @erp_company, @supplier, @order_type,
      @procurement_function, @currency, @amount, @erp_amount, @erp_currency,
      @erp_po_status, @lines_json, @status, @is_closed, @phoenix_data,
      @integration_layer, @warehouse_source, @warehouse_record_id, @warehouse_batch_id,
      @loaded_at, @erp_sync_status, @loaded_at
    );
  `, {
    entity: typedParam(sql.NVarChar(120), "Phoenix"),
    order_id: typedParam(sql.NVarChar(120), `${prefix}OWNED`),
    erp_source: typedParam(sql.NVarChar(80), "Navision"),
    erp_company: typedParam(sql.NVarChar(120), "PHOENIX-NAV"),
    supplier: typedParam(sql.NVarChar(255), "PRESEEDED SUPPLIER"),
    order_type: typedParam(sql.NVarChar(40), "foreign"),
    procurement_function: typedParam(sql.NVarChar(40), "technical"),
    currency: typedParam(sql.NVarChar(10), "USD"),
    amount: typedParam(sql.Decimal(18, 4), 90),
    erp_amount: typedParam(sql.Decimal(18, 4), 90),
    erp_currency: typedParam(sql.NVarChar(10), "USD"),
    erp_po_status: typedParam(sql.NVarChar(80), "Released"),
    lines_json: typedParam(sql.NVarChar(sql.MAX), JSON.stringify([{ lineNo: 10000, amount: 90 }])),
    status: typedParam(sql.NVarChar(120), "Phoenix manually advanced"),
    is_closed: typedParam(sql.Bit, false),
    phoenix_data: typedParam(sql.NVarChar(sql.MAX), JSON.stringify({ manualNote: "must survive" })),
    integration_layer: typedParam(sql.NVarChar(80), "integration-test"),
    warehouse_source: typedParam(sql.NVarChar(255), "integration-test"),
    warehouse_record_id: typedParam(sql.NVarChar(255), "gate4-owned-existing"),
    warehouse_batch_id: typedParam(sql.NVarChar(120), `${prefix}PRESEED`),
    loaded_at: typedParam(sql.DateTime2, new Date("2026-07-09T08:00:00.000Z")),
    erp_sync_status: typedParam(sql.NVarChar(40), "synced")
  });
}

async function orderRows(): Promise<OrderDbRow[]> {
  const result = await queryParams<OrderDbRow>(`
    SELECT id, order_id,
           CONVERT(varchar(50), amount) AS amount_text,
           CONVERT(varchar(50), erp_amount) AS erp_amount_text,
           status, is_closed, phoenix_data, lines_json
      FROM dbo.orders
     WHERE order_id LIKE @prefix
     ORDER BY order_id;
  `, {
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`)
  });
  return result.recordset;
}

async function syncExceptionRows(): Promise<{ error_code: string; error_message: string; order_id: string | null }[]> {
  const result = await queryParams<{ error_code: string; error_message: string; order_id: string | null }>(`
    SELECT error_code, error_message, order_id
      FROM dbo.sync_exceptions
     WHERE batch_id LIKE @prefix
     ORDER BY id;
  `, {
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`)
  });
  return result.recordset;
}

async function auditRows(): Promise<{ batch_id: string; status: string; created_count: number; updated_count: number; exception_count: number }[]> {
  const result = await queryParams<{ batch_id: string; status: string; created_count: number; updated_count: number; exception_count: number }>(`
    SELECT batch_id, status, created_count, updated_count, exception_count
      FROM dbo.import_audit
     WHERE batch_id LIKE @prefix
     ORDER BY batch_id;
  `, {
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`)
  });
  return result.recordset;
}

test("Gate 4 real syncPurchaseOrders integration preserves ownership, idempotency, decimals, statuses, exceptions, and line grouping", {
  skip: runIntegration ? false : "Set RUN_SQL_INTEGRATION=true and SQL_CONNECTION_STRING to run SQL integration."
}, async () => {
  try {
    await cleanup();
    await seedOwnedOrder();

    const syncRows: PurchaseOrderContract[] = [
      order(`${prefix}CREATE`, { amount: 12345.67, erpAmount: 12345.67 }),
      order(`${prefix}CREATE`, {
        amount: 10,
        erpAmount: 10,
        lines: [{ lineNo: 20000, amount: 10 }],
        warehouseRecordId: "gate4-create-line-2"
      }),
      order(`${prefix}OWNED`, { amount: 111, erpAmount: 111, supplier: "ERP REFRESHED SUPPLIER" }),
      order(`${prefix}CLOSED`, { erpPoStatus: "closed", amount: 1.25, erpAmount: 1.25 }),
      order("", { currency: null, warehouseRecordId: `${prefix}MALFORMED` }),
      order(`${prefix}UNCLASSIFIED`, { function: null })
    ];

    const first = await syncPurchaseOrders({
      orders: syncRows,
      batchId: `${prefix}BATCH1`,
      now: "2026-07-09T12:00:00.000Z",
      trigger: "integration"
    });
    assert.equal(first.createdCount, 2);
    assert.equal(first.updatedCount, 1);
    assert.equal(first.exceptionCount, 2);

    const second = await syncPurchaseOrders({
      orders: syncRows.slice(0, 4),
      batchId: `${prefix}BATCH2`,
      now: "2026-07-09T12:30:00.000Z",
      trigger: "integration"
    });
    assert.equal(second.createdCount, 0);
    assert.equal(second.updatedCount, 3);
    assert.equal(second.exceptionCount, 0);

    const rows = await orderRows();
    assert.equal(rows.length, 3);
    const created = rows.find(item => item.order_id === `${prefix}CREATE`);
    const owned = rows.find(item => item.order_id === `${prefix}OWNED`);
    const closed = rows.find(item => item.order_id === `${prefix}CLOSED`);
    assert.ok(created);
    assert.ok(owned);
    assert.ok(closed);

    assert.equal(created.amount_text, "12355.6700");
    assert.equal(created.erp_amount_text, "12355.6700");
    assert.equal(JSON.parse(created.lines_json || "[]").length, 2);
    assert.equal(owned.status, "Phoenix manually advanced");
    assert.deepEqual(JSON.parse(owned.phoenix_data), { manualNote: "must survive" });
    assert.equal(closed.status, "Order closed");
    assert.equal(closed.is_closed === true || closed.is_closed === 1, true);

    const exceptions = await syncExceptionRows();
    assert.equal(exceptions.some(item => item.error_code === "VALIDATION_FAILED"), true);
    assert.equal(exceptions.some(item => item.error_code === "UNCLASSIFIED"), true);

    const audits = await auditRows();
    assert.deepEqual(audits.map(item => item.batch_id), [`${prefix}BATCH1`, `${prefix}BATCH2`]);
    assert.equal(audits[0].status, "completed_with_exceptions");
    assert.equal(audits[1].status, "completed");
  } finally {
    await cleanup();
    await closeSqlPool();
  }
});
