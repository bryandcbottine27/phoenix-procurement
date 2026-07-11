import assert from "node:assert/strict";
import { HttpRequest, InvocationContext } from "@azure/functions";
import { test } from "node:test";
import { orderReconciliation } from "../src/functions/orderReconciliation";
import { SqlParams, SqlQueryExecutor } from "../src/sql/client";

function requestFor(actor = "USER"): HttpRequest {
  return {
    method: "GET",
    params: {},
    headers: { get: (name: string) => name.toLowerCase() === "x-phoenix-user" ? actor : null },
    query: new URLSearchParams(),
    json: async () => ({})
  } as unknown as HttpRequest;
}

function erpRow(orderId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    integration_layer: "data-warehouse",
    entity: "Phoenix",
    erp_source: "Navision",
    erp_company: "PHOENIX-NAV",
    erp_entity_id: null,
    erp_document_id: `ERP-${orderId}`,
    erp_document_no: orderId,
    order_id: orderId,
    erp_vendor_no: "V-1",
    erp_vendor_name: "ERP Supplier",
    supplier: "ERP Supplier",
    order_type: "foreign",
    procurement_function: "technical",
    currency: "USD",
    amount: 100,
    date_of_order: "2026-07-01",
    description: "ERP row",
    payment_terms: "30D",
    category: "Engineering",
    ipr_number: null,
    ipr_approved_date: null,
    claimant: null,
    requested_receipt_date: "2026-08-01",
    erp_po_status: "Released",
    erp_amount: 100,
    erp_currency: "USD",
    erp_hod_id: null,
    erp_purchasing_mgr_id: null,
    erp_created_from_ipr: null,
    erp_created_by: null,
    erp_purchaser_code: null,
    erp_shipment_method: null,
    lines_json: "[]",
    warehouse_source: "fixture",
    warehouse_record_id: `row-${orderId}`,
    warehouse_batch_id: "batch-1",
    warehouse_extracted_at: null,
    warehouse_loaded_at: null,
    warehouse_hash: null,
    erp_sync_status: "synced",
    erp_last_synced_at: "2026-07-02T00:00:00.000Z",
    erp_sync_error: null,
    last_refresh_changes_json: null,
    last_refresh_at: null,
    initial_operational_status: "Order sent to supplier",
    is_closed: false,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-02T00:00:00.000Z",
    ...overrides
  };
}

function operationalRow(recordId: string, data: Record<string, unknown>) {
  return {
    recordId,
    dataJson: JSON.stringify(data),
    archived: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z"
  };
}

function fakeQuery(role: string | null): SqlQueryExecutor {
  return (async (sqlText: string, params: SqlParams = {}) => {
    if (sqlText.includes("@officers_collection")) {
      return { recordset: role ? [{ dataJson: JSON.stringify({ code: "USER", role, active: true }) }] : [] } as never;
    }
    if (sqlText.includes("FROM dbo.orders")) {
      return { recordset: [
        erpRow("FPO-SHARED", { amount: 100, currency: "USD", erp_po_status: "Closed" }),
        erpRow("FPO-ERP-ONLY")
      ] } as never;
    }
    if (sqlText.includes("@orders_collection")) {
      assert.equal((params.orders_collection as { value?: string }).value, "orders");
      return { recordset: [
        operationalRow("overlay-shared", {
          entity: "Phoenix",
          orderId: "FPO-SHARED",
          amount: 90,
          currency: "EUR",
          status: "Order sent to supplier"
        }),
        operationalRow("overlay-only", {
          entity: "Phoenix",
          orderId: "FPO-APP-ONLY",
          status: "Supplier acknowledged"
        })
      ] } as never;
    }
    throw new Error(`Unexpected SQL: ${sqlText}`);
  }) as SqlQueryExecutor;
}

const context = {
  error: () => undefined,
  warn: () => undefined
} as unknown as InvocationContext;

test("order reconciliation endpoint returns ERP-only, app-only, and mismatch buckets", async () => {
  const response = await orderReconciliation(requestFor(), context, fakeQuery("admin"));
  assert.equal(response.status, 200);
  const body = response.jsonBody as {
    data: {
      erpOnly: { orderId: string }[];
      appOnly: { orderId: string }[];
      valueMismatches: { field: string }[];
      issues: unknown[];
    };
  };
  assert.equal(body.data.erpOnly[0].orderId, "FPO-ERP-ONLY");
  assert.equal(body.data.appOnly[0].orderId, "FPO-APP-ONLY");
  assert.deepEqual(body.data.valueMismatches.map(issue => issue.field).sort(), [
    "amount",
    "currency",
    "erpPoStatus/status"
  ]);
  assert.equal(body.data.issues.length, 5);
});

test("order reconciliation endpoint requires a stored active officer", async () => {
  const response = await orderReconciliation(requestFor(), context, fakeQuery(null));
  assert.equal(response.status, 403);
});
