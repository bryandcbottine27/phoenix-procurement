import assert from "node:assert/strict";
import { test } from "node:test";
import type { IResult } from "mssql";
import { unclassifiedWorklist } from "../src/functions/unclassifiedWorklist";
import { listUnclassifiedWorklist, parseUnclassifiedWorklistOptions } from "../src/worklists/unclassified";
import type { SqlParams, SqlQueryExecutor } from "../src/sql/client";

function result<T>(recordset: T[]): IResult<T> {
  return {
    recordsets: [recordset],
    recordset,
    rowsAffected: [recordset.length],
    output: {}
  } as unknown as IResult<T>;
}

test("parseUnclassifiedWorklistOptions validates paging, sort, and error code allowlists", () => {
  assert.deepEqual(parseUnclassifiedWorklistOptions({
    entity: "Phoenix",
    page: "2",
    pageSize: "500",
    sort: "entity:asc",
    errorCode: "unclassified"
  }), {
    entity: "Phoenix",
    status: "open",
    errorCode: "UNCLASSIFIED",
    page: 2,
    pageSize: 200,
    sortColumn: "entity",
    sortDirection: "ASC"
  });
  assert.throws(() => parseUnclassifiedWorklistOptions({ sort: "payload_json:desc" }), /sort/);
  assert.throws(() => parseUnclassifiedWorklistOptions({ errorCode: "OTHER" }), /errorCode/);
});

test("listUnclassifiedWorklist returns mapped admin worklist data without write SQL", async () => {
  const sqlTexts: string[] = [];
  const paramsSeen: SqlParams[] = [];
  const query: SqlQueryExecutor = async <T = unknown>(sqlText: string, params: SqlParams = {}) => {
    sqlTexts.push(sqlText);
    paramsSeen.push(params);
    if (sqlText.includes("COUNT(*) AS total")) return result([{ total: 2 } as unknown as T]);
    if (sqlText.includes("GROUP BY error_code")) {
      return result([
        { errorCode: "UNCLASSIFIED", entity: "Phoenix", count: 1 },
        { errorCode: "UNMAPPED_SUPPLIER", entity: "Phoenix", count: 1 }
      ] as unknown as T[]);
    }
    return result([
      {
        id: 10,
        batch_id: "batch-1",
        entity: "Phoenix",
        order_id: "FPO100",
        warehouse_record_id: "row-1",
        error_code: "UNCLASSIFIED",
        error_message: "No rule matched",
        payload_json: "{\"erpPurchaserCode\":\"ZZ99\"}",
        status: "open",
        created_at: "2026-07-09T00:00:00.000Z",
        resolved_at: null
      },
      {
        id: 11,
        batch_id: "batch-1",
        entity: "Phoenix",
        order_id: "FPO101",
        warehouse_record_id: "row-2",
        error_code: "UNMAPPED_SUPPLIER",
        error_message: "No supplier mapping",
        payload_json: null,
        status: "open",
        created_at: "2026-07-09T01:00:00.000Z",
        resolved_at: null
      }
    ] as unknown as T[]);
  };

  const response = await listUnclassifiedWorklist({ entity: "Phoenix", pageSize: "10" }, query);

  assert.equal(response.total, 2);
  assert.equal(response.data[0].suggestedAction, "addImportRule");
  assert.equal(response.data[1].suggestedAction, "mapSupplier");
  assert.deepEqual(response.summary.byErrorCode, { UNCLASSIFIED: 1, UNMAPPED_SUPPLIER: 1 });
  assert.deepEqual(response.summary.byEntity, { Phoenix: 2 });
  assert.ok(response.coverage.deferred.includes("browserAdminScreen"));
  assert.ok(sqlTexts.every(text => !/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(text)));
  assert.ok(paramsSeen.some(params => (params.status as { value: string } | undefined)?.value === "open"));
});

test("unclassifiedWorklist HTTP function rejects non-allowlisted sort", async () => {
  const response = await unclassifiedWorklist({
    query: new URLSearchParams("sort=payload_json:desc")
  } as never, {
    error() {},
    warn() {},
    info() {}
  } as never);
  assert.equal(response.status, 400);
});
