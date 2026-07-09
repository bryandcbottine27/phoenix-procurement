import assert from "node:assert/strict";
import { test } from "node:test";
import type { IResult } from "mssql";
import { getOtifRisk, parseOtifRiskOptions, scoreOtifRisk } from "../src/analytics/otifRisk";
import { otifRisk } from "../src/functions/otifRisk";
import type { SqlParams, SqlQueryExecutor } from "../src/sql/client";

function result<T>(recordset: T[]): IResult<T> {
  return {
    recordsets: [recordset],
    recordset,
    rowsAffected: [recordset.length],
    output: {}
  } as unknown as IResult<T>;
}

test("parseOtifRiskOptions validates horizons and score thresholds", () => {
  assert.deepEqual(parseOtifRiskOptions({ horizonDays: "10", minRiskScore: "40" }), {
    entity: undefined,
    dateFrom: undefined,
    dateTo: undefined,
    horizonDays: 10,
    longOpenDays: 90,
    staleSyncDays: 3,
    minRiskScore: 40
  });
  assert.throws(() => parseOtifRiskOptions({ horizonDays: "0" }), /horizonDays/);
  assert.throws(() => parseOtifRiskOptions({ minRiskScore: "101" }), /minRiskScore/);
});

test("scoreOtifRisk combines order-only drivers and clamps to 100", () => {
  const scored = scoreOtifRisk({
    entity: "Phoenix",
    orderId: "FPO100",
    supplier: null,
    procurementFunction: null,
    orderType: null,
    category: null,
    currency: "USD",
    amount: 10,
    dateOfOrder: "2026-01-01",
    requestedReceiptDate: null,
    erpLastSyncedAt: null,
    erpPurchaserCode: null,
    openAgeDays: 200,
    daysUntilRequestedReceipt: null,
    staleSyncDays: null
  }, { horizonDays: 14, longOpenDays: 90, staleSyncDays: 3 });

  assert.equal(scored.riskScore, 95);
  assert.equal(scored.riskBand, "critical");
  assert.ok(scored.drivers.includes("missing requested receipt date"));
  assert.ok(scored.drivers.includes("missing ERP sync timestamp"));
});

test("getOtifRisk returns sorted proxy risk with coverage caveats", async () => {
  const sqlTexts: string[] = [];
  const paramsSeen: SqlParams[] = [];
  const query: SqlQueryExecutor = async <T = unknown>(sqlText: string, params: SqlParams = {}) => {
    sqlTexts.push(sqlText);
    paramsSeen.push(params);
    return result([
      {
        entity: "Phoenix",
        orderId: "FPO100",
        supplier: "Supplier A",
        procurementFunction: "technical",
        orderType: "foreign",
        category: "Spares",
        currency: "USD",
        amount: 100,
        dateOfOrder: "2026-04-01",
        requestedReceiptDate: "2026-07-11",
        erpLastSyncedAt: "2026-07-01T00:00:00.000Z",
        erpPurchaserCode: "ET01",
        openAgeDays: 99,
        daysUntilRequestedReceipt: 2,
        staleSyncDays: 8
      },
      {
        entity: "Phoenix",
        orderId: "FPO101",
        supplier: "Supplier B",
        procurementFunction: "technical",
        orderType: "foreign",
        category: "Spares",
        currency: "USD",
        amount: 100,
        dateOfOrder: "2026-07-01",
        requestedReceiptDate: "2026-07-25",
        erpLastSyncedAt: "2026-07-08T00:00:00.000Z",
        erpPurchaserCode: "ET01",
        openAgeDays: 8,
        daysUntilRequestedReceipt: 16,
        staleSyncDays: 1
      }
    ] as unknown as T[]);
  };

  const risk = await getOtifRisk({ entity: "Phoenix", minRiskScore: "20" }, query);
  assert.equal(risk.data.length, 1);
  assert.equal(risk.data[0].orderId, "FPO100");
  assert.equal(risk.data[0].riskBand, "critical");
  assert.deepEqual(risk.summary.byBand, { low: 0, medium: 0, high: 0, critical: 1 });
  assert.equal(risk.coverage.proxy, true);
  assert.ok(risk.coverage.excluded.includes("trueOtif"));
  assert.ok(sqlTexts.every(text => !/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(text)));
  assert.ok(paramsSeen.some(params => (params.horizon_days as { value: number } | undefined)?.value === 14));
});

test("otifRisk HTTP function returns 400 for bad score threshold", async () => {
  const response = await otifRisk({
    query: new URLSearchParams("minRiskScore=high")
  } as never, {
    error() {},
    warn() {},
    info() {}
  } as never);
  assert.equal(response.status, 400);
});
