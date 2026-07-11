import { randomUUID } from "node:crypto";
import * as sql from "mssql";
import { queryParams, SqlQueryExecutor, typedParam } from "../sql/client";
import {
  listMergedOrders,
  mergeOrders,
  parseSyntheticOrderId,
  readErpOrders,
  readRawOperationalOrders,
  stripErpOwnedFieldsForOverlay
} from "./orderMerge";

export class OperationalBadRequestError extends Error {}
export class OperationalNotFoundError extends Error {}
export class OperationalStaleWriteError extends Error {
  code = "STALE_WRITE";
}

export const OPERATIONAL_COLLECTIONS = [
  "orders",
  "shipments",
  "payment_requests",
  "exports",
  "suppliers",
  "officers",
  "documents",
  "followups",
  "issues",
  "updateRequests",
  "contactLog",
  "kpiSnapshot",
  "status_log",
  "system_config"
] as const;

export type OperationalCollection = typeof OPERATIONAL_COLLECTIONS[number];
const STATUS_LOG_CAP = 200;
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 1000;

interface OperationalRecordRow {
  collectionName: string;
  recordId: string;
  entity: string | null;
  dataJson: string;
  archived: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export type OperationalRecordData = Record<string, unknown>;
export interface OperationalRecordListOptions {
  top?: unknown;
  skip?: unknown;
  changedSince?: unknown;
}
export interface OperationalRecordHead {
  collectionName: string;
  maxUpdatedAt: Date | string | null;
  count: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function assertOperationalCollection(collectionName: string): OperationalCollection {
  if ((OPERATIONAL_COLLECTIONS as readonly string[]).includes(collectionName)) {
    return collectionName as OperationalCollection;
  }
  throw new OperationalBadRequestError(`Unsupported collection: ${collectionName}`);
}

function entityOf(data: OperationalRecordData): string | null {
  const entity = data.entity;
  return typeof entity === "string" && entity.trim() ? entity.trim() : null;
}

function parseData(row: OperationalRecordRow): OperationalRecordData {
  const parsed = JSON.parse(row.dataJson || "{}") as OperationalRecordData;
  return {
    ...parsed,
    id: row.recordId,
    archived: typeof parsed.archived === "boolean" ? parsed.archived : !!row.archived,
    createdAt: row.createdAt || parsed.createdAt,
    updatedAt: row.updatedAt
  };
}

function dataForWrite(data: OperationalRecordData, id: string): OperationalRecordData {
  const copy = { ...data };
  delete copy.id;
  return { ...copy, id };
}

function jsonParam(data: OperationalRecordData): ReturnType<typeof typedParam> {
  return typedParam(sql.NVarChar(sql.MAX), JSON.stringify(data));
}

function collectionParam(collectionName: string): ReturnType<typeof typedParam> {
  return typedParam(sql.NVarChar(80), collectionName);
}

function recordIdParam(id: string): ReturnType<typeof typedParam> {
  return typedParam(sql.NVarChar(120), id);
}

function parseNonNegativeInt(value: unknown, label: string, fallback?: number): number | undefined {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new OperationalBadRequestError(`${label} must be a non-negative integer.`);
  return parsed;
}

function parseTop(value: unknown, fallback?: number): number | undefined {
  const parsed = parseNonNegativeInt(value, "top", fallback);
  if (parsed === undefined) return undefined;
  if (parsed < 1) throw new OperationalBadRequestError("top must be greater than zero.");
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function changedSinceParam(value: unknown): ReturnType<typeof typedParam> | null {
  const date = changedSinceDate(value);
  return date ? typedParam(sql.DateTime2(3), date) : null;
}

function changedSinceDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new OperationalBadRequestError("changedSince must be a valid date/time.");
  return date;
}

async function findRow(
  collectionName: OperationalCollection,
  id: string,
  query: SqlQueryExecutor
): Promise<OperationalRecordRow | null> {
  const result = await query<OperationalRecordRow>(`
    SELECT
      collection_name AS collectionName,
      record_id AS recordId,
      entity,
      data_json AS dataJson,
      archived,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM dbo.operational_records
    WHERE collection_name = @collection_name
      AND record_id = @record_id;
  `, {
    collection_name: collectionParam(collectionName),
    record_id: recordIdParam(id)
  });
  return result.recordset[0] || null;
}

export async function getOperationalRecord(
  collectionName: string,
  id: string,
  query: SqlQueryExecutor = queryParams
): Promise<OperationalRecordData | null> {
  const collection = assertOperationalCollection(collectionName);
  const row = await findRow(collection, id, query);
  return row ? parseData(row) : null;
}

export async function listOperationalRecords(
  collectionName?: string,
  query: SqlQueryExecutor = queryParams,
  options: OperationalRecordListOptions = {}
): Promise<Record<string, OperationalRecordData[]> | OperationalRecordData[]> {
  const params: Record<string, unknown> = {};
  if (collectionName) {
    const collection = assertOperationalCollection(collectionName);
    if (collection === "orders") {
      return listMergedOrders(query) as Promise<OperationalRecordData[]>;
    }
    const skip = parseNonNegativeInt(options.skip, "skip", 0) || 0;
    const top = parseTop(options.top, collection === "status_log" ? STATUS_LOG_CAP : undefined);
    const clauses = ["collection_name = @collection_name"];
    params.collection_name = collectionParam(collection);
    const changedSince = changedSinceParam(options.changedSince);
    if (changedSince) {
      clauses.push("updated_at > @changed_since");
      params.changed_since = changedSince;
    }
    let pagination = "";
    if (top !== undefined || skip > 0) {
      params.skip = typedParam(sql.Int, skip);
      params.top = typedParam(sql.Int, top || DEFAULT_PAGE_SIZE);
      pagination = "OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY";
    }
    const result = await query<OperationalRecordRow>(`
      SELECT
        collection_name AS collectionName,
        record_id AS recordId,
        entity,
        data_json AS dataJson,
        archived,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM dbo.operational_records
      WHERE ${clauses.join(" AND ")}
      ORDER BY updated_at DESC, record_id
      ${pagination};
    `, params);
    return result.recordset.map(parseData);
  }
  const result = await query<OperationalRecordRow>(`
    WITH ranked AS (
      SELECT
        collection_name AS collectionName,
        record_id AS recordId,
        entity,
        data_json AS dataJson,
        archived,
        created_at AS createdAt,
        updated_at AS updatedAt,
        ROW_NUMBER() OVER (
          PARTITION BY collection_name
          ORDER BY updated_at DESC, record_id
        ) AS rowNumber
      FROM dbo.operational_records
    )
    SELECT
      collectionName,
      recordId,
      entity,
      dataJson,
      archived,
      createdAt,
      updatedAt
    FROM ranked
    WHERE collectionName <> @status_log_collection
       OR rowNumber <= @status_log_cap
    ORDER BY collectionName, updatedAt DESC, recordId;
  `, {
    status_log_collection: collectionParam("status_log"),
    status_log_cap: typedParam(sql.Int, STATUS_LOG_CAP)
  });

  const grouped = Object.fromEntries(OPERATIONAL_COLLECTIONS.map(name => [name, []])) as Record<string, OperationalRecordData[]>;
  for (const row of result.recordset) {
    const bucket = grouped[row.collectionName] || (grouped[row.collectionName] = []);
    bucket.push(parseData(row));
  }
  grouped.orders = mergeOrders(await readErpOrders(query), await readRawOperationalOrders(query));
  return grouped;
}

export async function listOperationalRecordHeads(
  query: SqlQueryExecutor = queryParams
): Promise<OperationalRecordHead[]> {
  const heads = Object.fromEntries(OPERATIONAL_COLLECTIONS.map(name => [name, {
    collectionName: name,
    maxUpdatedAt: null,
    count: 0
  }])) as Record<string, OperationalRecordHead>;

  const operational = await query<{ collectionName: string; maxUpdatedAt: Date | string | null; count: number }>(`
    SELECT
      collection_name AS collectionName,
      MAX(updated_at) AS maxUpdatedAt,
      COUNT_BIG(*) AS count
    FROM dbo.operational_records
    GROUP BY collection_name;
  `);
  for (const row of operational.recordset) {
    if (!heads[row.collectionName]) continue;
    heads[row.collectionName] = {
      collectionName: row.collectionName,
      maxUpdatedAt: row.maxUpdatedAt,
      count: Number(row.count || 0)
    };
  }

  const mergedOrders = await query<{ maxUpdatedAt: Date | string | null; count: number }>(`
    WITH order_keys AS (
      SELECT
        CONCAT(entity, N'|', order_id) AS mergeKey,
        updated_at AS updatedAt
      FROM dbo.orders
      WHERE entity IS NOT NULL AND order_id IS NOT NULL
      UNION ALL
      SELECT
        CONCAT(COALESCE(entity, JSON_VALUE(data_json, '$.entity')), N'|', JSON_VALUE(data_json, '$.orderId')) AS mergeKey,
        updated_at AS updatedAt
      FROM dbo.operational_records
      WHERE collection_name = @orders_collection
        AND COALESCE(entity, JSON_VALUE(data_json, '$.entity')) IS NOT NULL
        AND JSON_VALUE(data_json, '$.orderId') IS NOT NULL
    ),
    merged AS (
      SELECT mergeKey, MAX(updatedAt) AS maxUpdatedAt
      FROM order_keys
      GROUP BY mergeKey
    )
    SELECT MAX(maxUpdatedAt) AS maxUpdatedAt, COUNT_BIG(*) AS count
    FROM merged;
  `, {
    orders_collection: collectionParam("orders")
  });
  const mergedOrderHead = mergedOrders.recordset[0];
  if (mergedOrderHead) {
    heads.orders = {
      collectionName: "orders",
      maxUpdatedAt: mergedOrderHead.maxUpdatedAt,
      count: Number(mergedOrderHead.count || 0)
    };
  }

  return OPERATIONAL_COLLECTIONS.map(name => heads[name]);
}

export async function createOperationalRecord(
  collectionName: string,
  data: OperationalRecordData,
  actor = "api",
  query: SqlQueryExecutor = queryParams
): Promise<OperationalRecordData> {
  const collection = assertOperationalCollection(collectionName);
  const id = typeof data.id === "string" && data.id.trim() ? data.id.trim() : randomUUID();
  const timestamp = nowIso();
  const cleanData = collection === "orders" ? stripErpOwnedFieldsForOverlay(data) : data;
  const payload = dataForWrite({
    ...cleanData,
    id,
    createdAt: cleanData.createdAt || timestamp,
    createdBy: cleanData.createdBy || actor,
    updatedAt: cleanData.updatedAt || timestamp,
    updatedBy: cleanData.updatedBy || actor
  }, id);
  await query(`
    INSERT INTO dbo.operational_records (
      collection_name, record_id, entity, data_json, archived, created_at, updated_at
    )
    VALUES (
      @collection_name, @record_id, @entity, @data_json, @archived, SYSUTCDATETIME(), SYSUTCDATETIME()
    );
  `, {
    collection_name: collectionParam(collection),
    record_id: recordIdParam(id),
    entity: typedParam(sql.NVarChar(120), entityOf(payload)),
    data_json: jsonParam(payload),
    archived: typedParam(sql.Bit, payload.archived === true)
  });
  return { ...payload, id };
}

export async function updateOperationalRecord(
  collectionName: string,
  id: string,
  patch: OperationalRecordData,
  actor = "api",
  expectedUpdatedAt?: unknown,
  query: SqlQueryExecutor = queryParams
): Promise<OperationalRecordData> {
  const collection = assertOperationalCollection(collectionName);
  const row = await findRow(collection, id, query);
  if (!row) {
    const synthetic = collection === "orders" ? parseSyntheticOrderId(id) : null;
    if (synthetic) {
      return createOperationalRecord(collection, { ...patch, ...synthetic, id }, actor, query);
    }
    throw new OperationalNotFoundError(`Record not found: ${collection}/${id}`);
  }
  if (expectedUpdatedAt) {
    const live = new Date(row.updatedAt).getTime();
    const expected = new Date(String(expectedUpdatedAt)).getTime();
    if (Number.isFinite(live) && Number.isFinite(expected) && live > expected) {
      throw new OperationalStaleWriteError("STALE_WRITE");
    }
  }
  const existing = parseData(row);
  const timestamp = nowIso();
  const cleanPatch = collection === "orders" ? stripErpOwnedFieldsForOverlay(patch) : patch;
  const merged = dataForWrite({
    ...existing,
    ...cleanPatch,
    id,
    updatedAt: cleanPatch.updatedAt || timestamp,
    updatedBy: cleanPatch.updatedBy || actor
  }, id);
  await query(`
    UPDATE dbo.operational_records
       SET entity = @entity,
           data_json = @data_json,
           archived = @archived
     WHERE collection_name = @collection_name
       AND record_id = @record_id;
  `, {
    collection_name: collectionParam(collection),
    record_id: recordIdParam(id),
    entity: typedParam(sql.NVarChar(120), entityOf(merged)),
    data_json: jsonParam(merged),
    archived: typedParam(sql.Bit, merged.archived === true)
  });
  return { ...merged, id };
}

export async function archiveOperationalRecord(
  collectionName: string,
  id: string,
  reason?: string,
  actor = "api",
  query: SqlQueryExecutor = queryParams
): Promise<OperationalRecordData> {
  return updateOperationalRecord(collectionName, id, {
    archived: true,
    archivedAt: nowIso(),
    archivedBy: actor,
    archiveReason: reason || null
  }, actor, undefined, query);
}

export async function restoreOperationalRecord(
  collectionName: string,
  id: string,
  actor = "api",
  query: SqlQueryExecutor = queryParams
): Promise<OperationalRecordData> {
  return updateOperationalRecord(collectionName, id, {
    archived: false,
    archivedAt: null,
    archiveReason: null
  }, actor, undefined, query);
}
