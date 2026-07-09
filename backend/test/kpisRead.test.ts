import assert from "node:assert/strict";
import { HttpRequest, InvocationContext } from "@azure/functions";
import { test } from "node:test";
import { BadRequestError, getKpis, parseKpiOptions } from "../src/kpi/queries";
import { SqlParams, SqlQueryExecutor } from "../src/sql/client";
import { kpis } from "../src/functions/kpis";

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

function makeKpiQuery(): { query: SqlQueryExecutor; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const query = (async <T = unknown>(sqlText: string, params: SqlParams = {}) => {
    calls.push({ sqlText, params });
    if (/GROUP BY entity/i.test(sqlText)) {
      return queryResult([{ entity: "Phoenix", count: 4 }, { entity: "Edena", count: 1 }]);
    }
    if (/procurement_function AS \[function\]/i.test(sqlText)) {
      return queryResult([{ function: "technical", count: 3 }, { function: null, count: 1 }]);
    }
    if (/order_type AS orderType/i.test(sqlText)) {
      return queryResult([{ orderType: "foreign", count: 4 }, { orderType: null, count: 1 }]);
    }
    if (/erp_po_status AS erpPoStatus/i.test(sqlText)) {
      return queryResult([{ erpPoStatus: "Released", count: 3 }, { erpPoStatus: "Closed", count: 2 }]);
    }
    if (/SUM\(CASE WHEN is_closed = 1 THEN 0 ELSE 1 END\)/i.test(sqlText)) {
      return queryResult([{ open: 3, closed: 2 }]);
    }
    if (/SUM\(amount\) AS value/i.test(sqlText) && !/requested_receipt_date/i.test(sqlText)) {
      return queryResult([{ currency: "USD", value: 1250.25 }, { currency: "EUR", value: 380.5 }]);
    }
    if (/WITH mtto AS/i.test(sqlText)) {
      return queryResult([{ avgDays: 6.2, medianDays: 5, sampleSize: 3 }]);
    }
    if (/AS bucket/i.test(sqlText)) {
      return queryResult([
        { bucket: "0-30", count: 40 },
        { bucket: "31-60", count: 18 },
        { bucket: "61-90", count: 9 },
        { bucket: "90+", count: 6 }
      ]);
    }
    if (/requested_receipt_date < CAST/i.test(sqlText)) {
      return queryResult([{ currency: "USD", count: 12, value: 90000 }]);
    }
    if (/requested_receipt_date >= CAST/i.test(sqlText)) {
      return queryResult([{ currency: "USD", count: 8, value: 42000 }]);
    }
    if (/unclassifiedFunction/i.test(sqlText)) {
      return queryResult([{ unclassifiedFunction: 3, unclassifiedOrderType: 1, staleSyncCount: 4 }]);
    }
    if (/FROM dbo\.sync_exceptions/i.test(sqlText)) {
      return queryResult([{ count: 5 }]);
    }
    if (/FROM dbo\.import_audit/i.test(sqlText)) {
      return queryResult([{
        lastBatchId: "WD-123",
        lastLoadedAt: "2026-07-09T08:00:00.000Z",
        created: 10,
        updated: 110,
        exceptions: 5
      }]);
    }
    return queryResult<T>();
  }) as unknown as SqlQueryExecutor;
  return { query, calls };
}

test("parseKpiOptions validates scope dates", () => {
  assert.deepEqual(parseKpiOptions({ entity: "Phoenix", dateFrom: "2026-07-01" }), {
    entity: "Phoenix",
    dateFrom: "2026-07-01",
    dateTo: undefined
  });
  assert.throws(() => parseKpiOptions({ dateTo: "07/31/2026" }), BadRequestError);
});

test("getKpis returns honest order-only KPI payload without cross-currency sums", async () => {
  const { query, calls } = makeKpiQuery();
  const result = await getKpis({ entity: "Phoenix", dateFrom: "2026-07-01", dateTo: "2026-07-31" }, query);

  assert.deepEqual(result.scope, { entity: "Phoenix", dateFrom: "2026-07-01", dateTo: "2026-07-31" });
  assert.deepEqual(result.counts.openClosed, { open: 3, closed: 2 });
  assert.deepEqual(result.counts.byFunction[0], { function: "technical", count: 3 });
  assert.deepEqual(result.spendCommitment.byCurrency, { USD: 1250.25, EUR: 380.5 });
  assert.equal(Object.prototype.hasOwnProperty.call(result.spendCommitment, "total"), false);
  assert.deepEqual(result.mtto, { avgDays: 6.2, medianDays: 5, sampleSize: 3 });
  assert.deepEqual(result.ageing.openByBucket, { "0-30": 40, "31-60": 18, "61-90": 9, "90+": 6 });
  assert.equal(result.requestedReceipt.proxy, true);
  assert.deepEqual(result.requestedReceipt.overdue, { count: 12, valueByCurrency: { USD: 90000 } });
  assert.deepEqual(result.requestedReceipt.approaching, { count: 8, valueByCurrency: { USD: 42000 } });
  assert.deepEqual(result.dataQuality, {
    unclassifiedFunction: 3,
    unclassifiedOrderType: 1,
    openSyncExceptions: 5,
    staleSyncOverDays: 3,
    staleSyncCount: 4
  });
  assert.deepEqual(result.sync, {
    lastBatchId: "WD-123",
    lastLoadedAt: "2026-07-09T08:00:00.000Z",
    created: 10,
    updated: 110,
    exceptions: 5
  });
  assert.ok(result.coverage.excluded.includes("otif"));
  assert.ok(result.coverage.excluded.includes("cycleTimeThroughGrn"));
  assert.ok(result.coverage.excluded.includes("supplierScorecards"));
  assert.ok(result.coverage.excluded.includes("liveOperationalStatus"));
  assert.match(result.coverage.reason, /Shipment\/payment\/GRN/);

  const allSql = calls.map(call => call.sqlText).join("\n");
  assert.doesNotMatch(allSql, /\b(INSERT|UPDATE|DELETE|MERGE)\b/i);
  assert.doesNotMatch(allSql, /\bstatus\s+AS\s+initial_operational_status\b/i);
});

test("kpis HTTP function returns 400 for invalid scope dates", async () => {
  const response = await kpis({
    query: new URLSearchParams({ dateFrom: "bad-date" })
  } as HttpRequest, {
    error: () => undefined
  } as unknown as InvocationContext);

  assert.equal(response.status, 400);
  assert.match(String((response.jsonBody as { error: string }).error), /dateFrom must use YYYY-MM-DD/);
});
