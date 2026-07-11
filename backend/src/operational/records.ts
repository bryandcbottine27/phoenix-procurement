import { randomUUID } from "node:crypto";
import * as sql from "mssql";
import { queryParams, SqlQueryExecutor, typedParam } from "../sql/client";

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
  query: SqlQueryExecutor = queryParams
): Promise<Record<string, OperationalRecordData[]> | OperationalRecordData[]> {
  const params: Record<string, unknown> = {};
  let where = "";
  if (collectionName) {
    const collection = assertOperationalCollection(collectionName);
    where = "WHERE collection_name = @collection_name";
    params.collection_name = collectionParam(collection);
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
    ${where}
    ORDER BY collection_name, updated_at DESC, record_id;
  `, params);
  if (collectionName) return result.recordset.map(parseData);

  const grouped = Object.fromEntries(OPERATIONAL_COLLECTIONS.map(name => [name, []])) as Record<string, OperationalRecordData[]>;
  for (const row of result.recordset) {
    const bucket = grouped[row.collectionName] || (grouped[row.collectionName] = []);
    bucket.push(parseData(row));
  }
  return grouped;
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
  const payload = dataForWrite({
    ...data,
    id,
    createdAt: data.createdAt || timestamp,
    createdBy: data.createdBy || actor,
    updatedAt: data.updatedAt || timestamp,
    updatedBy: data.updatedBy || actor
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
  if (!row) throw new OperationalNotFoundError(`Record not found: ${collection}/${id}`);
  if (expectedUpdatedAt) {
    const live = new Date(row.updatedAt).getTime();
    const expected = new Date(String(expectedUpdatedAt)).getTime();
    if (Number.isFinite(live) && Number.isFinite(expected) && live > expected) {
      throw new OperationalStaleWriteError("STALE_WRITE");
    }
  }
  const existing = parseData(row);
  const timestamp = nowIso();
  const merged = dataForWrite({
    ...existing,
    ...patch,
    id,
    updatedAt: patch.updatedAt || timestamp,
    updatedBy: patch.updatedBy || actor
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
