import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertOperationalCollection,
  OperationalBadRequestError,
  OPERATIONAL_COLLECTIONS
} from "../src/operational/records";
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
