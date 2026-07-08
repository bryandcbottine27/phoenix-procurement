import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { closeSqlPool, getSqlPool } from "../sql/client";

function splitBatches(sqlText: string): string[] {
  return sqlText
    .split(/^\s*GO\s*;?\s*$/gim)
    .map(batch => batch.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const dbDir = path.resolve(__dirname, "../../../db");
  const files = (await readdir(dbDir))
    .filter(file => /^\d+_.+\.sql$/i.test(file))
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) {
    throw new Error(`No migration files found in ${dbDir}`);
  }

  const pool = await getSqlPool();
  for (const file of files) {
    const fullPath = path.join(dbDir, file);
    const sqlText = await readFile(fullPath, "utf8");
    for (const batch of splitBatches(sqlText)) {
      await pool.request().batch(batch);
    }
    console.log(`Applied ${file}`);
  }
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeSqlPool();
  });
