import assert from "node:assert/strict";
import { test } from "node:test";
import type { IResult } from "mssql";
import { getCycleTimeAnalytics, parseCycleTimeOptions } from "../src/analytics/cycleTime";
import { cycleTimeAnalytics } from "../src/functions/cycleTimeAnalytics";
import type { SqlParams, SqlQueryExecutor } from "../src/sql/client";

function result<T>(recordset: T[]): IResult<T> {
  return {
    recordsets: [recordset],
    recordset,
    rowsAffected: [recordset.length],
    output: {}
  } as unknown as IResult<T>;
}

test("parseCycleTimeOptions validates threshold inputs", () => {
  assert.deepEqual(parseCycleTimeOptions({ entity: "Phoenix", longOpenDays: "120", staleSyncDays: "5" }), {
    entity: "Phoenix",
    dateFrom: undefined,
    dateTo: undefined,
    longOpenDays: 120,
    staleSyncDays: 5
  });
  assert.throws(() => parseCycleTimeOptions({ longOpenDays: "0" }), /longOpenDays/);
  assert.throws(() => parseCycleTimeOptions({ staleSyncDays: "soon" }), /staleSyncDays/);
});

test("getCycleTimeAnalytics returns honest order-only bottleneck analytics", async () => {
  const sqlTexts: string[] = [];
  const paramsSeen: SqlParams[] = [];
  const query: SqlQueryExecutor = async <T = unknown>(sqlText: string, params: SqlParams = {}) => {
    sqlTexts.push(sqlText);
    paramsSeen.push(params);
    if (sqlText.includes("open_age")) {
      return result([{
        avgOpenAgeDays: 45,
        medianOpenAgeDays: 40,
        openSampleSize: 3,
        avgRequestedLeadDays: 20,
        requestedLeadSampleSize: 2,
        avgRequestedDelayDays: 6.5,
        requestedDelaySampleSize: 2
      } as unknown as T]);
    }
    if (sqlText.includes("AS requestedReceiptOverdue") && !sqlText.includes("GROUP BY")) {
      return result([{ requestedReceiptOverdue: 2, staleSync: 1, longOpen: 1 } as unknown as T]);
    }
    return result([{
      dimensionValue: "F3OFFICER",
      openOrders: 3,
      avgOpenAgeDays: 45,
      requestedReceiptOverdue: 2,
      staleSync: 1,
      longOpen: 1
    } as unknown as T]);
  };

  const analytics = await getCycleTimeAnalytics({
    entity: "Phoenix",
    dateFrom: "2026-07-01",
    longOpenDays: "90",
    staleSyncDays: "3"
  }, query);

  assert.equal(analytics.scope.entity, "Phoenix");
  assert.equal(analytics.orderCycle.openAge.avgDays, 45);
  assert.equal(analytics.orderCycle.requestedReceiptDelay.avgDays, 6.5);
  assert.equal(analytics.bottlenecks.byOfficer[0].value, "F3OFFICER");
  assert.equal(analytics.slaBreaches.requestedReceiptOverdue, 2);
  assert.ok(analytics.coverage.excluded.includes("workflowTimeInStage"));
  assert.ok(sqlTexts.every(text => !/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(text)));
  assert.ok(paramsSeen.some(params => (params.long_open_days as { value: number } | undefined)?.value === 90));
});

test("cycleTimeAnalytics HTTP function returns 400 for bad threshold input", async () => {
  const response = await cycleTimeAnalytics({
    query: new URLSearchParams("longOpenDays=never")
  } as never, {
    error() {},
    warn() {},
    info() {}
  } as never);
  assert.equal(response.status, 400);
});
