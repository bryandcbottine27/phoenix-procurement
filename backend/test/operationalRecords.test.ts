import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertOperationalCollection,
  listOperationalRecordHeads,
  listOperationalRecords,
  OperationalBadRequestError,
  OPERATIONAL_COLLECTIONS
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

  await listOperationalRecords("orders", query, {
    top: 25,
    skip: 10,
    changedSince: "2026-07-01T00:00:00.000Z"
  });
  assert.match(seenSql, /updated_at > @changed_since/);
  assert.equal((seenParams.top as { value: number }).value, 25);
  assert.equal((seenParams.skip as { value: number }).value, 10);
  assert.ok(seenParams.changed_since);
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
