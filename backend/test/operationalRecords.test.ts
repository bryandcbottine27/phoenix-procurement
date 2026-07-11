import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertOperationalCollection,
  createOperationalRecord,
  listOperationalRecordHeads,
  listOperationalRecords,
  OperationalBadRequestError,
  OPERATIONAL_COLLECTIONS,
  updateOperationalRecord
} from "../src/operational/records";
import { SqlParams, SqlQueryExecutor } from "../src/sql/client";
import { assertCounterKey, CounterBadRequestError } from "../src/operational/counters";

test("operational record API allows only known Phoenix collections", () => {
  assert.equal(assertOperationalCollection("orders"), "orders");
  assert.equal(assertOperationalCollection("payment_requests"), "payment_requests");
  assert.ok(OPERATIONAL_COLLECTIONS.includes("status_log"));
  assert.throws(() => assertOperationalCollection("users;DROP TABLE dbo.orders"), OperationalBadRequestError);
});

test("counter API accepts only safe counter keys", () => {
  assert.equal(assertCounterKey("rfp:Phoenix:PHX:2026"), "rfp:Phoenix:PHX:2026");
  assert.equal(assertCounterKey("rfp:Seychelles Breweries:SBL:2026"), "rfp:Seychelles Breweries:SBL:2026");
  assert.throws(() => assertCounterKey("rfp/../../orders"), CounterBadRequestError);
  assert.throws(() => assertCounterKey("rfp;DROP TABLE dbo.orders"), CounterBadRequestError);
});

test("operational record list caps status_log and supports changedSince paging", async () => {
  let seenSql = "";
  let seenParams: SqlParams = {};
  const query = (async (sqlText: string, params: SqlParams = {}) => {
    seenSql = sqlText;
    seenParams = params;
    return { recordset: [] } as never;
  }) as SqlQueryExecutor;

  await listOperationalRecords("status_log", query);
  assert.match(seenSql, /ORDER BY updated_at DESC, record_id\s+OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY/s);
  assert.equal((seenParams.top as { value: number }).value, 200);
  assert.equal((seenParams.skip as { value: number }).value, 0);

  await listOperationalRecords("shipments", query, {
    top: 25,
    skip: 10,
    changedSince: "2026-07-01T00:00:00.000Z"
  });
  assert.match(seenSql, /updated_at > @changed_since/);
  assert.equal((seenParams.top as { value: number }).value, 25);
  assert.equal((seenParams.skip as { value: number }).value, 10);
  assert.ok(seenParams.changed_since);
});

test("operational order reads merge full ERP and active Phoenix overlays without paging deltas", async () => {
  let call = 0;
  const query = (async (sqlText: string, params: SqlParams = {}) => {
    call += 1;
    if (sqlText.includes("FROM dbo.orders")) {
      return {
        recordset: [{
          id: 1,
          integration_layer: "data-warehouse",
          entity: "Phoenix",
          erp_source: "Navision",
          erp_company: "PHOENIX-NAV",
          erp_entity_id: null,
          erp_document_id: "ERP-1",
          erp_document_no: "FPO-MERGED-1",
          order_id: "FPO-MERGED-1",
          erp_vendor_no: "V1",
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
          warehouse_record_id: "row-1",
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
          updated_at: "2026-07-02T00:00:00.000Z"
        }]
      } as never;
    }
    assert.equal((params.orders_collection as { value?: string }).value, "orders");
    assert.match(sqlText, /archived = 0/i);
    assert.equal(params.top, undefined);
    assert.equal(params.skip, undefined);
    assert.equal(params.changed_since, undefined);
    return {
      recordset: [{
        recordId: "overlay-1",
        dataJson: JSON.stringify({
          entity: "Phoenix",
          orderId: "FPO-MERGED-1",
          supplier: "Stale Supplier",
          amount: 99,
          status: "Supplier acknowledged",
          notes: "Keep"
        }),
        archived: false,
        createdAt: "2026-07-01T01:00:00.000Z",
        updatedAt: "2026-07-03T00:00:00.000Z"
      }]
    } as never;
  }) as SqlQueryExecutor;

  const rows = await listOperationalRecords("orders", query, {
    top: "not-a-number",
    skip: "not-a-number",
    changedSince: "not-a-date"
  }) as Record<string, unknown>[];
  assert.equal(call, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "overlay-1");
  assert.equal(rows[0].supplier, "ERP Supplier");
  assert.equal(rows[0].amount, 100);
  assert.equal(rows[0].status, "Supplier acknowledged");
  assert.equal(rows[0].notes, "Keep");
});

test("order overlay writes strip ERP-owned fields and synthetic ERP-only updates create overlays", async () => {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const query = (async (sqlText: string, params: SqlParams = {}) => {
    if (/INSERT INTO dbo\.operational_records/i.test(sqlText)) {
      inserts.push(params);
      return { recordset: [] } as never;
    }
    if (/UPDATE dbo\.operational_records/i.test(sqlText)) {
      updates.push(params);
      return { recordset: [] } as never;
    }
    if (sqlText.includes("record_id = @record_id")) {
      const id = (params.record_id as { value?: string } | undefined)?.value;
      if (id === "overlay-1") {
        return {
          recordset: [{
            collectionName: "orders",
            recordId: "overlay-1",
            entity: "Phoenix",
            dataJson: JSON.stringify({ id: "overlay-1", entity: "Phoenix", orderId: "FPO-1", status: "Supplier acknowledged" }),
            archived: false,
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z"
          }]
        } as never;
      }
      return { recordset: [] } as never;
    }
    throw new Error(`Unexpected SQL: ${sqlText}`);
  }) as SqlQueryExecutor;

  const created = await createOperationalRecord("orders", {
    id: "overlay-new",
    entity: "Phoenix",
    orderId: "FPO-NEW",
    supplier: "ERP-owned supplier",
    currency: "USD",
    amount: 500,
    status: "Supplier acknowledged",
    notes: "Store me"
  }, "TEST", query);
  assert.equal(created.supplier, undefined);
  assert.equal(created.currency, undefined);
  assert.equal(created.amount, undefined);
  assert.equal(created.orderId, "FPO-NEW");
  assert.equal(created.status, "Supplier acknowledged");
  assert.equal(JSON.parse((inserts[0].data_json as { value: string }).value).supplier, undefined);

  const updated = await updateOperationalRecord("orders", "overlay-1", {
    supplier: "Do not store",
    amount: 999,
    claims: [{ type: "quality", amount: 10 }]
  }, "TEST", undefined, query);
  assert.equal(updated.supplier, undefined);
  assert.equal(updated.amount, undefined);
  assert.deepEqual(updated.claims, [{ type: "quality", amount: 10 }]);
  assert.equal(JSON.parse((updates[0].data_json as { value: string }).value).supplier, undefined);

  const synthetic = await updateOperationalRecord("orders", "erp:Phoenix|FPO-SYNTH", {
    supplier: "Do not store",
    amount: 250,
    notes: "Create overlay"
  }, "TEST", undefined, query);
  assert.equal(synthetic.id, "erp:Phoenix|FPO-SYNTH");
  assert.equal(synthetic.entity, "Phoenix");
  assert.equal(synthetic.orderId, "FPO-SYNTH");
  assert.equal(synthetic.supplier, undefined);
  assert.equal(synthetic.notes, "Create overlay");
});

test("operational record heads return per-collection max and include ERP order head", async () => {
  let call = 0;
  const query = (async () => {
    call += 1;
    if (call === 1) {
      return {
        recordset: [
          { collectionName: "orders", maxUpdatedAt: "2026-07-01T08:00:00.000Z", count: 1 },
          { collectionName: "documents", maxUpdatedAt: "2026-07-01T07:00:00.000Z", count: 2 }
        ]
      } as never;
    }
    return {
      recordset: [
        { maxUpdatedAt: "2026-07-02T08:00:00.000Z", count: 3 }
      ]
    } as never;
  }) as SqlQueryExecutor;

  const heads = await listOperationalRecordHeads(query);
  const orders = heads.find(head => head.collectionName === "orders");
  const documents = heads.find(head => head.collectionName === "documents");
  const statusLog = heads.find(head => head.collectionName === "status_log");
  assert.equal(orders?.maxUpdatedAt, "2026-07-02T08:00:00.000Z");
  assert.equal(orders?.count, 3);
  assert.equal(documents?.count, 2);
  assert.equal(statusLog?.count, 0);
});
