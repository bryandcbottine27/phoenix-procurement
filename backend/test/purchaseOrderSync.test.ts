import assert from "node:assert/strict";
import { test } from "node:test";
import { SqlQueryExecutor, SqlParams } from "../src/sql/client";
import {
  groupPurchaseOrders,
  mapErpPoStatus,
  syncPurchaseOrders
} from "../src/sync/purchaseOrderSync";
import { PurchaseOrderContract } from "../src/warehouse/contract";

interface QueryCall {
  sqlText: string;
  params: SqlParams;
}

interface ExistingRow {
  id: number;
  amount: number | null;
  currency: string | null;
  requested_receipt_date: string | null;
}

function queryResult<T>(recordset: T[] = []): unknown {
  return {
    recordset,
    recordsets: [recordset],
    rowsAffected: [1],
    output: {}
  };
}

function makeFakeQuery(existingRows: Record<string, ExistingRow> = {}): { query: SqlQueryExecutor; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const query = (async <T = unknown>(sqlText: string, params: SqlParams = {}) => {
    calls.push({ sqlText, params });
    if (/FROM dbo\.orders/i.test(sqlText)) {
      const key = `${params.entity}|${params.order_id}`;
      const row = existingRows[key];
      return queryResult(row ? [row] : []);
    }
    return queryResult<T>();
  }) as unknown as SqlQueryExecutor;
  return { query, calls };
}

function order(overrides: Partial<PurchaseOrderContract> = {}): PurchaseOrderContract {
  return {
    entity: "Phoenix",
    erpSource: "Navision",
    erpCompany: "PHOENIX-NAV",
    erpDocumentNo: "FPO-SYNC-1",
    orderId: "FPO-SYNC-1",
    erpVendorNo: "V-001",
    erpVendorName: "SAFE SUPPLIER",
    supplier: "SAFE SUPPLIER",
    orderType: "foreign",
    function: "technical",
    currency: "USD",
    amount: 100,
    requestedReceiptDate: "2026-08-15",
    erpPoStatus: "Released",
    erpAmount: 100,
    erpCurrency: "USD",
    lines: [{ lineNo: 10000, amount: 100 }],
    warehouseSource: "fixture.dw_purchase_orders",
    warehouseRecordId: "fixture-FPO-SYNC-1",
    warehouseBatchId: "SOURCE-BATCH",
    warehouseLoadedAt: "2026-07-09T08:00:00.000Z",
    ...overrides
  };
}

function findCall(calls: QueryCall[], pattern: RegExp): QueryCall {
  const call = calls.find(item => pattern.test(item.sqlText));
  assert.ok(call, `Expected SQL call matching ${pattern}`);
  return call;
}

test("groupPurchaseOrders groups duplicate entity/order rows and sums amounts", () => {
  const grouped = groupPurchaseOrders([
    order({ amount: 25, erpAmount: 25, lines: [{ lineNo: 10000, amount: 25 }] }),
    order({ amount: 75, erpAmount: 75, lines: [{ lineNo: 20000, amount: 75 }] })
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].amount, 100);
  assert.equal(grouped[0].erpAmount, 100);
  assert.equal(grouped[0].lines.length, 2);
});

test("mapErpPoStatus mirrors browser ERP status seed mapping", () => {
  assert.equal(mapErpPoStatus("Pending Approval"), "Order amendment pending");
  assert.equal(mapErpPoStatus("Open"), "Order sent to supplier");
  assert.equal(mapErpPoStatus("Released"), "Order sent to supplier");
  assert.equal(mapErpPoStatus("Closed"), "Order closed");
  assert.equal(mapErpPoStatus("Cancelled"), "Order cancelled");
  assert.equal(mapErpPoStatus("Unexpected"), "Order sent to supplier");
});

test("syncPurchaseOrders updates ERP-owned fields without Phoenix-owned ownership fields", async () => {
  const { query, calls } = makeFakeQuery({
    "Phoenix|FPO-SYNC-1": {
      id: 42,
      amount: 90,
      currency: "EUR",
      requested_receipt_date: "2026-08-01"
    }
  });

  const result = await syncPurchaseOrders({
    orders: [order()],
    query,
    batchId: "BATCH-OWNERSHIP",
    now: "2026-07-09T09:00:00.000Z",
    trigger: "unit"
  });

  assert.equal(result.updatedCount, 1);
  assert.equal(result.createdCount, 0);
  const update = findCall(calls, /UPDATE dbo\.orders/i);
  assert.match(update.sqlText, /order_type = @order_type/);
  assert.match(update.sqlText, /procurement_function = @procurement_function/);
  assert.doesNotMatch(update.sqlText, /\bstatus\s*=/i);
  assert.doesNotMatch(update.sqlText, /\bis_closed\s*=/i);
  assert.doesNotMatch(update.sqlText, /\bphoenix_data\s*=/i);
  assert.equal(update.params.status, undefined);
  assert.equal(update.params.is_closed, undefined);
  assert.equal(update.params.phoenix_data, undefined);
  assert.equal(update.params.warehouse_batch_id, "BATCH-OWNERSHIP");
  assert.equal(update.params.erp_sync_status, "synced");
  assert.equal((update.params.last_refresh_at as Date).toISOString(), "2026-07-09T09:00:00.000Z");
  assert.match(String(update.params.last_refresh_changes_json), /PO Amount/);
});

test("syncPurchaseOrders inserts new rows with seeded Phoenix status only on create", async () => {
  const { query, calls } = makeFakeQuery();

  const result = await syncPurchaseOrders({
    orders: [order({ erpPoStatus: "Released" })],
    query,
    batchId: "BATCH-CREATE",
    now: "2026-07-09T09:30:00.000Z",
    trigger: "unit"
  });

  assert.equal(result.createdCount, 1);
  assert.equal(result.updatedCount, 0);
  const insert = findCall(calls, /INSERT INTO dbo\.orders/i);
  assert.match(insert.sqlText, /\bstatus\b/);
  assert.match(insert.sqlText, /\bis_closed\b/);
  assert.doesNotMatch(insert.sqlText, /\bphoenix_data\b/i);
  assert.equal(insert.params.status, "Order sent to supplier");
  assert.equal(insert.params.is_closed, false);
});

test("syncPurchaseOrders writes malformed rows to sync_exceptions", async () => {
  const { query, calls } = makeFakeQuery();

  const result = await syncPurchaseOrders({
    orders: [order({ orderId: "", currency: null })],
    query,
    batchId: "BATCH-BAD",
    now: "2026-07-09T10:00:00.000Z",
    trigger: "unit"
  });

  assert.equal(result.exceptionCount, 1);
  assert.equal(result.createdCount, 0);
  assert.equal(result.updatedCount, 0);
  const exception = findCall(calls, /INSERT INTO dbo\.sync_exceptions/i);
  assert.equal(exception.params.error_code, "VALIDATION_FAILED");
  assert.match(String(exception.params.error_message), /missing PO number/);
  assert.match(String(exception.params.error_message), /missing currency/);
  assert.equal(calls.some(call => /INSERT INTO dbo\.orders/i.test(call.sqlText)), false);
});

test("syncPurchaseOrders keeps warehouse values in parameters, not SQL text", async () => {
  const { query, calls } = makeFakeQuery();
  const supplier = "PARAMETER ONLY SUPPLIER";
  const warehouseRecordId = "WAREHOUSE-ROW-SECRET-123";

  await syncPurchaseOrders({
    orders: [order({ supplier, erpVendorName: supplier, warehouseRecordId })],
    query,
    batchId: "BATCH-PARAMS",
    now: "2026-07-09T11:00:00.000Z",
    trigger: "unit"
  });

  const sqlText = calls.map(call => call.sqlText).join("\n");
  assert.equal(sqlText.includes(supplier), false);
  assert.equal(sqlText.includes(warehouseRecordId), false);
  const insert = findCall(calls, /INSERT INTO dbo\.orders/i);
  assert.equal(insert.params.supplier, supplier);
  assert.equal(insert.params.warehouse_record_id, warehouseRecordId);
});
