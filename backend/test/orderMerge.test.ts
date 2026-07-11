import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ERP_OWNED_FIELDS,
  mergeOrders,
  pickErpOwned,
  readErpOrders,
  reconcileOrders,
  stripErpOwnedFieldsForOverlay,
  OrderRecord
} from "../src/operational/orderMerge";
import { OrderSqlRow } from "../src/kpi/shape";
import { ERP_COLUMNS } from "../src/sync/purchaseOrderSync";
import { SqlParams, SqlQueryExecutor } from "../src/sql/client";

interface QueryCall {
  sqlText: string;
  params: SqlParams;
}

function queryResult<T>(recordset: T[] = []): unknown {
  return {
    recordset,
    recordsets: [recordset],
    rowsAffected: [1],
    output: {}
  };
}

function makeFakeQuery(rows: OrderSqlRow[]): { query: SqlQueryExecutor; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const query = (async <T = unknown>(sqlText: string, params: SqlParams = {}) => {
    calls.push({ sqlText, params });
    return queryResult(rows as T[]);
  }) as unknown as SqlQueryExecutor;
  return { query, calls };
}

function erpRow(overrides: Partial<OrderSqlRow> = {}): OrderSqlRow {
  return {
    id: 501,
    integration_layer: "data-warehouse",
    entity: "Phoenix",
    erp_source: "Navision",
    erp_company: "PHOENIX-NAV",
    erp_entity_id: "PHX",
    erp_document_id: "NAV-FPO-MERGE-1",
    erp_document_no: "FPO-MERGE-1",
    order_id: "FPO-MERGE-1",
    erp_vendor_no: "V-MERGE",
    erp_vendor_name: "ERP Supplier",
    supplier: "ERP Supplier",
    order_type: "foreign",
    procurement_function: "technical",
    currency: "USD",
    amount: 1250,
    date_of_order: "2026-07-01",
    description: "ERP-owned merge fixture",
    payment_terms: "30D",
    category: "Engineering",
    ipr_number: "IPR-MERGE",
    ipr_approved_date: "2026-06-28",
    claimant: "J. Antoine",
    requested_receipt_date: "2026-08-15",
    erp_po_status: "Released",
    erp_amount: 1250,
    erp_currency: "USD",
    erp_hod_id: "GMERLE",
    erp_purchasing_mgr_id: "BTHOMAS",
    erp_created_from_ipr: "IPR-MERGE",
    erp_created_by: null,
    erp_purchaser_code: null,
    erp_shipment_method: "SEA",
    lines_json: JSON.stringify([{ lineNo: 10000, amount: 1250 }]),
    warehouse_source: "fixture.dw_purchase_orders",
    warehouse_record_id: "fixture-merge-1",
    warehouse_batch_id: "BATCH-MERGE",
    warehouse_extracted_at: "2026-07-09T07:00:00.000Z",
    warehouse_loaded_at: "2026-07-09T08:00:00.000Z",
    warehouse_hash: "hash-merge",
    erp_sync_status: "synced",
    erp_last_synced_at: "2026-07-09T08:01:00.000Z",
    erp_sync_error: null,
    last_refresh_changes_json: null,
    last_refresh_at: null,
    initial_operational_status: null,
    is_closed: false,
    ...overrides
  };
}

function erpOrder(overrides: OrderRecord = {}): OrderRecord {
  return {
    id: 501,
    entity: "Phoenix",
    orderId: "FPO-MERGE-1",
    supplier: "ERP Supplier",
    orderType: "foreign",
    function: "technical",
    currency: "USD",
    amount: 1250,
    erpPoStatus: "Released",
    erpAmount: 1250,
    erpCurrency: "USD",
    lines: [{ lineNo: 10000, amount: 1250 }],
    integrationLayer: "data-warehouse",
    warehouseBatchId: "BATCH-MERGE",
    erpSyncStatus: "synced",
    initialOperationalStatus: null,
    isClosed: false,
    ...overrides
  };
}

test("order merge ownership field list is derived from the connector ERP columns", () => {
  for (const column of ERP_COLUMNS) {
    assert.ok(ERP_OWNED_FIELDS.includes(column.field), `${column.field} should be ERP-owned in the merge`);
  }
  assert.ok(ERP_OWNED_FIELDS.includes("entity"));
  assert.ok(ERP_OWNED_FIELDS.includes("orderId"));
});

test("readErpOrders maps dbo.orders rows to camelCase without writes or phoenix_data", async () => {
  const { query, calls } = makeFakeQuery([erpRow()]);
  const rows = await readErpOrders(query);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].orderId, "FPO-MERGE-1");
  assert.equal(rows[0].function, "technical");
  assert.deepEqual(rows[0].lines, [{ lineNo: 10000, amount: 1250 }]);
  assert.equal(rows[0].phoenix_data, undefined);
  assert.equal(rows[0].initialOperationalStatus, null);
  assert.doesNotMatch(calls.map(call => call.sqlText).join("\n"), /\b(INSERT|UPDATE|DELETE|MERGE)\b/i);
  assert.match(calls[0].sqlText, /FROM dbo\.orders/i);
});

test("ERP-only orders surface with seeded status and empty Phoenix arrays", () => {
  const [merged] = mergeOrders([erpOrder({ erpPoStatus: "Closed", isClosed: true })], []);

  assert.equal(merged.id, "erp:Phoenix|FPO-MERGE-1");
  assert.equal(merged.status, "Order closed");
  assert.equal(merged.isClosed, true);
  assert.deepEqual(merged.milestones, []);
  assert.deepEqual(merged.amendments, []);
  assert.deepEqual(merged.claims, []);
  assert.deepEqual(merged.receipts, []);
  assert.deepEqual(merged.lineTracking, []);
});

test("app-only orders pass through unchanged", () => {
  const appOnly = {
    id: "op-only-1",
    entity: "Phoenix",
    orderId: "MANUAL-1",
    supplier: "Manual Supplier",
    status: "Supplier acknowledged",
    notes: "Created manually"
  };

  assert.deepEqual(mergeOrders([], [appOnly]), [appOnly]);
});

test("merged orders keep Phoenix overlay fields while ERP-owned values win", () => {
  const overlay = {
    id: "overlay-1",
    entity: "Phoenix",
    orderId: "FPO-MERGE-1",
    supplier: "Stale Supplier",
    currency: "EUR",
    amount: 999,
    status: "Supplier acknowledged",
    notes: "Keep the operational note",
    milestones: [{ label: "Deposit", amount: 100 }],
    claims: [{ type: "quality", amount: 25 }]
  };

  const [merged] = mergeOrders([erpOrder()], [overlay]);

  assert.equal(merged.id, "overlay-1");
  assert.equal(merged.supplier, "ERP Supplier");
  assert.equal(merged.currency, "USD");
  assert.equal(merged.amount, 1250);
  assert.equal(merged.status, "Supplier acknowledged");
  assert.equal(merged.notes, "Keep the operational note");
  assert.deepEqual(merged.milestones, [{ label: "Deposit", amount: 100 }]);
  assert.deepEqual(merged.claims, [{ type: "quality", amount: 25 }]);
});

test("overlay write helper strips ERP-owned fields but keeps merge keys", () => {
  const stripped = stripErpOwnedFieldsForOverlay({
    id: "overlay-1",
    entity: "Phoenix",
    orderId: "FPO-MERGE-1",
    supplier: "Do not store",
    currency: "EUR",
    amount: 999,
    initialOperationalStatus: "Do not store",
    status: "Supplier acknowledged",
    notes: "Keep"
  });

  assert.deepEqual(stripped, {
    id: "overlay-1",
    entity: "Phoenix",
    orderId: "FPO-MERGE-1",
    status: "Supplier acknowledged",
    notes: "Keep"
  });
  assert.deepEqual(pickErpOwned(erpOrder({ amount: 777 })).amount, 777);
});

test("reconciliation reports ERP-only, app-only, and value mismatch issues", () => {
  const erpShared = erpOrder({ orderId: "FPO-SHARED", amount: 100, currency: "USD", erpPoStatus: "Closed" });
  const erpOnly = erpOrder({ orderId: "FPO-ERP-ONLY" });
  const appShared = {
    id: "overlay-shared",
    entity: "Phoenix",
    orderId: "FPO-SHARED",
    amount: 90,
    currency: "EUR",
    status: "Order sent to supplier"
  };
  const appOnly = {
    id: "overlay-only",
    entity: "Phoenix",
    orderId: "FPO-APP-ONLY",
    status: "Supplier acknowledged"
  };

  const report = reconcileOrders([erpShared, erpOnly], [appShared, appOnly]);

  assert.equal(report.erpOnly.length, 1);
  assert.equal(report.erpOnly[0].orderId, "FPO-ERP-ONLY");
  assert.equal(report.appOnly.length, 1);
  assert.equal(report.appOnly[0].orderId, "FPO-APP-ONLY");
  assert.deepEqual(report.valueMismatches.map(issue => issue.field).sort(), [
    "amount",
    "currency",
    "erpPoStatus/status"
  ]);
  const statusIssue = report.valueMismatches.find(issue => issue.field === "erpPoStatus/status");
  assert.equal(statusIssue?.erpValue, "Closed");
  assert.equal(statusIssue?.expectedOperationalValue, "Order closed");
  assert.equal(statusIssue?.operationalValue, "Order sent to supplier");
  assert.equal(report.issues.length, 5);
});
