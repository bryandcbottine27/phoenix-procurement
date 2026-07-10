import * as sql from "mssql";
import { queryParams, SqlQueryExecutor, typedParam } from "../sql/client";

export class CounterBadRequestError extends Error {}

const COUNTER_KEY_PATTERN = /^[A-Za-z0-9_.: -]{1,160}$/;

export function assertCounterKey(counterKey: string): string {
  const key = String(counterKey || "").trim();
  if (COUNTER_KEY_PATTERN.test(key)) return key;
  throw new CounterBadRequestError("Unsupported counter key.");
}

export async function nextCounterValue(
  counterKey: string,
  actor = "api",
  query: SqlQueryExecutor = queryParams
): Promise<number> {
  const key = assertCounterKey(counterKey);
  const result = await query<{ value: number }>(`
    MERGE dbo.app_counters WITH (HOLDLOCK) AS target
    USING (SELECT @counter_key AS counter_key) AS source
       ON target.counter_key = source.counter_key
    WHEN MATCHED THEN
      UPDATE SET
        value = target.value + 1,
        updated_at = SYSUTCDATETIME(),
        updated_by = @actor
    WHEN NOT MATCHED THEN
      INSERT (counter_key, value, updated_at, updated_by)
      VALUES (@counter_key, 1, SYSUTCDATETIME(), @actor)
    OUTPUT inserted.value AS value;
  `, {
    counter_key: typedParam(sql.NVarChar(160), key),
    actor: typedParam(sql.NVarChar(120), actor || "api")
  });
  return Number(result.recordset[0]?.value || 0);
}
