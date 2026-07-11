import assert from "node:assert/strict";
import * as sql from "mssql";
import { test } from "node:test";
import {
  archiveOperationalRecord,
  createOperationalRecord,
  listOperationalRecords,
  OperationalRecordData,
  OperationalStaleWriteError,
  restoreOperationalRecord,
  updateOperationalRecord
} from "../src/operational/records";
import { nextCounterValue } from "../src/operational/counters";
import { closeSqlPool, queryParams, typedParam } from "../src/sql/client";

const runIntegration = process.env.RUN_SQL_INTEGRATION === "true" && !!process.env.SQL_CONNECTION_STRING;
const prefix = "API-REC-";

async function cleanup(): Promise<void> {
  await queryParams("DELETE FROM dbo.operational_records WHERE record_id LIKE @prefix;", {
    prefix: typedParam(sql.NVarChar(120), `${prefix}%`)
  });
  await queryParams("DELETE FROM dbo.app_counters WHERE counter_key LIKE @prefix;", {
    prefix: typedParam(sql.NVarChar(160), `${prefix}%`)
  });
}

test("internal operational records CRUD supports list, stale-write guard, archive and restore", {
  skip: runIntegration ? false : "Set RUN_SQL_INTEGRATION=true and SQL_CONNECTION_STRING to run SQL integration."
}, async () => {
  try {
    await cleanup();
    const created = await createOperationalRecord("shipments", {
      id: `${prefix}SHIP-1`,
      entity: "Phoenix",
      orderId: "FPO-API-1",
      shipmentId: "FPO-API-1 (S1)",
      supplier: "Internal Supplier"
    }, "TEST");

    assert.equal(created.id, `${prefix}SHIP-1`);
    const grouped = await listOperationalRecords(undefined) as Record<string, OperationalRecordData[]>;
    const listed = grouped.shipments.find(row => row.id === `${prefix}SHIP-1`);
    assert.ok(listed);
    assert.equal(listed.supplier, "Internal Supplier");
    assert.ok(listed.updatedAt);

    await assert.rejects(
      () => updateOperationalRecord("shipments", `${prefix}SHIP-1`, { supplier: "Too late" }, "TEST", "2000-01-01T00:00:00.000Z"),
      OperationalStaleWriteError
    );

    const updated = await updateOperationalRecord("shipments", `${prefix}SHIP-1`, {
      supplier: "Updated Supplier",
      shipmentId: "FPO-API-1 (S1A)"
    }, "TEST");
    assert.equal(updated.supplier, "Updated Supplier");
    assert.equal(updated.shipmentId, "FPO-API-1 (S1A)");

    const archived = await archiveOperationalRecord("shipments", `${prefix}SHIP-1`, "test archive", "TEST");
    assert.equal(archived.archived, true);
    assert.equal(archived.archiveReason, "test archive");
    assert.equal(archived.archivedBy, "TEST");

    const restored = await restoreOperationalRecord("shipments", `${prefix}SHIP-1`, "TEST");
    assert.equal(restored.archived, false);
    assert.equal(restored.archiveReason, null);

    const first = await nextCounterValue(`${prefix}RFP:Phoenix:2026`, "TEST");
    const second = await nextCounterValue(`${prefix}RFP:Phoenix:2026`, "TEST");
    assert.equal(first, 1);
    assert.equal(second, 2);
  } finally {
    await cleanup();
    await closeSqlPool();
  }
});
