import assert from "node:assert/strict";
import { HttpRequest, InvocationContext } from "@azure/functions";
import { test } from "node:test";
import { BadRequestError, listOrders, parseOrderListOptions } from "../src/kpi/queries";
import { OrderSqlRow } from "../src/kpi/shape";
import { SqlParams, SqlQueryExecutor, TypedSqlParam } from "../src/sql/client";
import { orders } from "../src/functions/orders";

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

function typed(value: unknown): TypedSqlParam {
  assert.ok(value && typeof value === "object" && "type" in value && "value" in value, "expected typed SQL param");
  return value as TypedSqlParam;
}

function makeFakeQuery(rows: OrderSqlRow[], total = rows.length): { query: SqlQueryExecutor; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const query = (async <T = unknown>(sqlText: string, params: SqlParams = {}) => {
    calls.push({ sqlText, params });
    if (/COUNT\(\*\)/i.test(sqlText)) return queryResult([{ total }]);
    return queryResult(rows as T[]);
  }) as unknown as SqlQueryExecutor;
  return { query, calls };
}

function row(overrides: Partial<OrderSqlRow> = {}): OrderSqlRow {
  return {
    id: 101,
    integration_layer: "data-warehouse",
    entity: "Phoenix",
    erp_source: "Navision",
    erp_company: "PHOENIX-NAV",
    erp_entity_id: null,
    erp_document_id: "NAV-FPO-READ-1",
    erp_document_no: "FPO-READ-1",
    order_id: "FPO-READ-1",
    erp_vendor_no: "V-READ",
    erp_vendor_name: "READ ONLY SUPPLIER",
    supplier: "READ ONLY SUPPLIER",
    order_type: "foreign",
    procurement_function: "technical",
    currency: "USD",
    amount: 500,
    date_of_order: "2026-07-01",
    description: "Read endpoint fixture",
    payment_terms: "30D",
    category: "Engineering",
    ipr_number: "IPR-READ",
    ipr_approved_date: "2026-06-25",
    claimant: "J. Antoine",
    requested_receipt_date: "2026-08-15",
    erp_po_status: "Released",
    erp_amount: 500,
    erp_currency: "USD",
    erp_hod_id: "GMERLE",
    erp_purchasing_mgr_id: "BTHOMAS",
    erp_created_from_ipr: "IPR-READ",
    erp_created_by: null,
    erp_purchaser_code: null,
    erp_shipment_method: "SEA",
    lines_json: JSON.stringify([{ lineNo: 10000, amount: 500 }]),
    warehouse_source: "fixture.dw_purchase_orders",
    warehouse_record_id: "fixture-read-1",
    warehouse_batch_id: "BATCH-READ",
    warehouse_extracted_at: "2026-07-09T07:00:00.000Z",
    warehouse_loaded_at: "2026-07-09T08:00:00.000Z",
    warehouse_hash: "hash-read",
    erp_sync_status: "synced",
    erp_last_synced_at: "2026-07-09T08:01:00.000Z",
    erp_sync_error: null,
    last_refresh_changes_json: JSON.stringify([{ field: "amount", old: 400, new: 500 }]),
    last_refresh_at: "2026-07-09T08:01:00.000Z",
    initial_operational_status: "Order sent to supplier",
    is_closed: false,
    ...overrides
  };
}

test("parseOrderListOptions defaults and clamps page size", () => {
  const options = parseOrderListOptions({ pageSize: "500" });
  assert.equal(options.page, 1);
  assert.equal(options.pageSize, 200);
  assert.equal(options.sortColumn, "date_of_order");
  assert.equal(options.sortDirection, "DESC");
});

test("parseOrderListOptions rejects non-allowlisted sort columns", () => {
  assert.throws(
    () => parseOrderListOptions({ sort: "supplier:desc" }),
    BadRequestError
  );
  assert.throws(
    () => parseOrderListOptions({ sort: "date_of_order:desc;DROP TABLE dbo.orders" }),
    BadRequestError
  );
});

test("listOrders filters, sorts, paginates, maps rows, and emits only read SQL", async () => {
  const { query, calls } = makeFakeQuery([row()], 37);
  const result = await listOrders({
    entity: "Phoenix",
    function: "technical",
    orderType: "foreign",
    erpPoStatus: "Released",
    closed: "false",
    supplier: "READ",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
    page: "2",
    pageSize: "10",
    sort: "amount:asc"
  }, query);

  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 10);
  assert.equal(result.total, 37);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].orderId, "FPO-READ-1");
  assert.equal(result.data[0].function, "technical");
  assert.equal(result.data[0].initialOperationalStatus, "Order sent to supplier");
  assert.equal(result.data[0].phoenix_data, undefined);
  assert.deepEqual(result.data[0].lines, [{ lineNo: 10000, amount: 500 }]);

  const dataCall = calls.find(call => /OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY/i.test(call.sqlText));
  assert.ok(dataCall, "expected paged data query");
  assert.match(dataCall.sqlText, /WHERE entity = @entity AND procurement_function = @function/);
  assert.match(dataCall.sqlText, /ORDER BY amount ASC/);
  assert.equal(typed(dataCall.params.entity).value, "Phoenix");
  assert.equal(typed(dataCall.params.function).value, "technical");
  assert.equal(typed(dataCall.params.closed).value, false);
  assert.equal(typed(dataCall.params.supplier).value, "%READ%");
  assert.equal(typed(dataCall.params.off).value, 10);
  assert.equal(typed(dataCall.params.lim).value, 10);

  const allSql = calls.map(call => call.sqlText).join("\n");
  assert.doesNotMatch(allSql, /\b(INSERT|UPDATE|DELETE|MERGE)\b/i);
  assert.doesNotMatch(allSql, /\bphoenix_data\b/i);
});

test("orders HTTP function returns 400 for rejected sort", async () => {
  const response = await orders({
    query: new URLSearchParams({ sort: "supplier:desc" })
  } as HttpRequest, {
    error: () => undefined
  } as unknown as InvocationContext);

  assert.equal(response.status, 400);
  assert.match(String((response.jsonBody as { error: string }).error), /sort must be/);
});
