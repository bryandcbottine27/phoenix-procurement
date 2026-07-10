import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertOperationalCollection,
  OperationalBadRequestError,
  OPERATIONAL_COLLECTIONS
} from "../src/operational/records";

test("operational record API allows only known Phoenix collections", () => {
  assert.equal(assertOperationalCollection("orders"), "orders");
  assert.equal(assertOperationalCollection("payment_requests"), "payment_requests");
  assert.ok(OPERATIONAL_COLLECTIONS.includes("status_log"));
  assert.throws(() => assertOperationalCollection("users;DROP TABLE dbo.orders"), OperationalBadRequestError);
});
