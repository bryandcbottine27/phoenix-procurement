import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const dbDir = path.resolve(__dirname, "../../db");

test("SQL migration set includes all closed-environment backend tables and merge indexes", async () => {
  const files = (await readdir(dbDir))
    .filter(file => /^\d+_.+\.sql$/i.test(file))
    .sort((a, b) => a.localeCompare(b));

  assert.deepEqual(files, [
    "001_init.sql",
    "002_kpi_indexes.sql",
    "003_notification_state.sql",
    "004_operational_records.sql",
    "005_app_counters.sql",
    "006_order_merge_indexes.sql"
  ]);

  const combined = await Promise.all(files.map(file => readFile(path.join(dbDir, file), "utf8")));
  const sqlText = combined.join("\n");
  for (const objectName of [
    "dbo.orders",
    "dbo.sync_exceptions",
    "dbo.import_audit",
    "dbo.notification_state",
    "dbo.operational_records",
    "dbo.app_counters"
  ]) {
    assert.match(sqlText, new RegExp(objectName.replace(".", "\\."), "i"));
  }
  for (const indexName of [
    "UX_orders_entity_order_id",
    "IX_orders_updated_at",
    "IX_operational_records_orders_merge"
  ]) {
    assert.match(sqlText, new RegExp(indexName, "i"));
  }
});

test("SQL migrations keep DDL idempotency guards", async () => {
  const files = (await readdir(dbDir)).filter(file => /^\d+_.+\.sql$/i.test(file));
  for (const file of files) {
    const sqlText = await readFile(path.join(dbDir, file), "utf8");
    assert.match(sqlText, /\bIF\s+(?:OBJECT_ID\s*\(|NOT\s+EXISTS\b)/i, `${file} should guard DDL`);
    assert.match(sqlText, /^\s*GO\s*$/im, `${file} should use GO batch separators`);
  }
});
