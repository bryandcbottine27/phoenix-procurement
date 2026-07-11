import assert from "node:assert/strict";
import { HttpRequest, InvocationContext } from "@azure/functions";
import * as sql from "mssql";
import { test } from "node:test";
import { operationalRecordsItem, operationalRecordsRoot } from "../src/functions/records";
import { reconcileOrders, readErpOrders, readRawOperationalOrders } from "../src/operational/orderMerge";
import { closeSqlPool, queryParams, typedParam } from "../src/sql/client";
import { syncPurchaseOrders } from "../src/sync/purchaseOrderSync";
import { PurchaseOrderContract } from "../src/warehouse/contract";

const runIntegration = process.env.RUN_SQL_INTEGRATION === "true" && !!process.env.SQL_CONNECTION_STRING;
const prefix = "E2E-";
const actor = `${prefix}ADMIN`;
const orderId = `${prefix}ORDER`;

const context = {
  error: () => undefined,
  warn: () => undefined
} as unknown as InvocationContext;

function rootRequest(): HttpRequest {
  return {
    method: "GET",
    params: {},
    headers: { get: (name: string) => name.toLowerCase() === "x-phoenix-user" ? actor : null },
    query: new URLSearchParams(),
    json: async () => ({})
  } as unknown as HttpRequest;
}

function patchOrderRequest(id: string, data: Record<string, unknown>): HttpRequest {
  return {
    method: "PATCH",
    params: { collection: "orders", id },
    headers: { get: (name: string) => name.toLowerCase() === "x-phoenix-user" ? actor : null },
    query: new URLSearchParams(),
    json: async () => ({ data })
  } as unknown as HttpRequest;
}

function contract(): PurchaseOrderContract {
  return {
    entity: "Phoenix",
    erpSource: "Navision",
    erpCompany: "PHOENIX-NAV",
    erpDocumentNo: orderId,
    orderId,
    erpVendorNo: "V-E2E",
    erpVendorName: "E2E ERP SUPPLIER",
    supplier: "E2E ERP SUPPLIER",
    orderType: "foreign",
    function: "technical",
    currency: "USD",
    amount: 777.25,
    dateOfOrder: "2026-07-01",
    requestedReceiptDate: "2026-08-15",
    erpPoStatus: "Released",
    erpAmount: 777.25,
    erpCurrency: "USD",
    lines: [{ lineNo: 10000, amount: 777.25 }],
    warehouseSource: "e2e.integration",
    warehouseRecordId: `${prefix}warehouse-row`,
    warehouseLoadedAt: "2026-07-11T08:00:00.000Z"
  };
}

async function cleanup(): Promise<void> {
  await queryParams("DELETE FROM dbo.sync_exceptions WHERE batch_id LIKE @prefix OR order_id LIKE @prefix;", {
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`)
  });
  await queryParams("DELETE FROM dbo.import_audit WHERE batch_id LIKE @prefix;", {
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`)
  });
  await queryParams("DELETE FROM dbo.operational_records WHERE record_id LIKE @prefix OR data_json LIKE @json_prefix;", {
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`),
    json_prefix: typedParam(sql.NVarChar(sql.MAX), `%${prefix}%`)
  });
  await queryParams("DELETE FROM dbo.orders WHERE order_id LIKE @prefix;", {
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`)
  });
}

async function seedOfficer(): Promise<void> {
  await queryParams(`
    INSERT INTO dbo.operational_records (
      collection_name, record_id, entity, data_json, archived, created_at, updated_at
    )
    VALUES (
      @collection_name, @record_id, NULL, @data_json, 0, SYSUTCDATETIME(), SYSUTCDATETIME()
    );
  `, {
    collection_name: typedParam(sql.NVarChar(80), "officers"),
    record_id: typedParam(sql.NVarChar(120), actor),
    data_json: typedParam(sql.NVarChar(sql.MAX), JSON.stringify({
      id: actor,
      code: actor,
      fullName: "E2E Admin",
      role: "admin",
      active: true
    }))
  });
}

test("closed-env E2E sync-to-records flow preserves ERP truth and Phoenix overlay", {
  skip: runIntegration ? false : "Set RUN_SQL_INTEGRATION=true and SQL_CONNECTION_STRING to run SQL integration."
}, async () => {
  try {
    await cleanup();
    await seedOfficer();

    const syncResult = await syncPurchaseOrders({
      orders: [contract()],
      batchId: `${prefix}BATCH`,
      now: "2026-07-11T08:00:00.000Z",
      trigger: "e2e"
    });
    assert.equal(syncResult.createdCount, 1);
    assert.equal(syncResult.updatedCount, 0);

    const firstRead = await operationalRecordsRoot(rootRequest(), context);
    assert.equal(firstRead.status, 200);
    const firstOrders = ((firstRead.jsonBody as { data: { orders: Record<string, unknown>[] } }).data.orders || []);
    const erpOnly = firstOrders.find(order => order.orderId === orderId);
    assert.ok(erpOnly, "ERP order should be visible through /records");
    assert.equal(erpOnly.supplier, "E2E ERP SUPPLIER");
    assert.equal(erpOnly.amount, 777.25);
    assert.equal(erpOnly.id, `erp:Phoenix|${orderId}`);

    const patch = await operationalRecordsItem(patchOrderRequest(String(erpOnly.id), {
      supplier: "Do not store this client value",
      amount: 1,
      notes: "Phoenix operational note",
      status: "Order sent to supplier"
    }), context);
    assert.equal(patch.status, 200);

    const secondRead = await operationalRecordsRoot(rootRequest(), context);
    assert.equal(secondRead.status, 200);
    const secondOrders = ((secondRead.jsonBody as { data: { orders: Record<string, unknown>[] } }).data.orders || []);
    const merged = secondOrders.find(order => order.orderId === orderId);
    assert.ok(merged, "Merged order should remain visible through /records");
    assert.equal(merged.supplier, "E2E ERP SUPPLIER");
    assert.equal(merged.amount, 777.25);
    assert.equal(merged.notes, "Phoenix operational note");
    assert.equal(merged.status, "Order sent to supplier");

    const reconciliation = reconcileOrders(await readErpOrders(), await readRawOperationalOrders());
    const ownIssues = reconciliation.issues.filter(issue => issue.key === `Phoenix|${orderId}`);
    assert.deepEqual(ownIssues, []);
  } finally {
    await cleanup();
    await closeSqlPool();
  }
});
