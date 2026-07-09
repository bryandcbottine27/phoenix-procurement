import { ConnectionPool, IResult, Transaction } from "mssql";
import { requireSqlConnectionString } from "../config";

let poolPromise: Promise<ConnectionPool> | null = null;

export type SqlParams = Record<string, unknown>;

export function getSqlPool(): Promise<ConnectionPool> {
  if (!poolPromise) {
    const connectionString = requireSqlConnectionString();
    const pool = new ConnectionPool(connectionString);
    poolPromise = pool.connect().catch(error => {
      poolPromise = null;
      throw error;
    });
  }
  return poolPromise;
}

export async function querySql<T = unknown>(sqlText: string): Promise<IResult<T>> {
  const pool = await getSqlPool();
  return pool.request().query<T>(sqlText);
}

export type SqlQueryExecutor = <T = unknown>(sqlText: string, params?: SqlParams) => Promise<IResult<T>>;

export async function queryParams<T = unknown>(
  sqlText: string,
  params: SqlParams = {},
  executor?: ConnectionPool | Transaction
): Promise<IResult<T>> {
  const pool = executor || await getSqlPool();
  const request = pool.request();
  for (const [name, value] of Object.entries(params)) {
    request.input(name, value);
  }
  return request.query<T>(sqlText);
}

export async function withTransaction<T>(work: (query: SqlQueryExecutor) => Promise<T>): Promise<T> {
  const pool = await getSqlPool();
  const transaction = new Transaction(pool);
  await transaction.begin();
  const query: SqlQueryExecutor = (sqlText, params = {}) => queryParams(sqlText, params, transaction);
  try {
    const result = await work(query);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function pingSql(): Promise<boolean> {
  const result = await querySql<{ ok: number }>("SELECT 1 AS ok");
  return result.recordset[0]?.ok === 1;
}

export async function closeSqlPool(): Promise<void> {
  if (!poolPromise) return;
  const pool = await poolPromise;
  poolPromise = null;
  await pool.close();
}
