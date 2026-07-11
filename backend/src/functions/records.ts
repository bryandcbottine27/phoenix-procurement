import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  archiveOperationalRecord,
  createOperationalRecord,
  getOperationalRecord,
  listOperationalRecordHeads,
  listOperationalRecords,
  OperationalBadRequestError,
  OperationalNotFoundError,
  OperationalRecordData,
  OperationalStaleWriteError,
  assertOperationalCollection,
  restoreOperationalRecord,
  updateOperationalRecord
} from "../operational/records";
import { queryParams, SqlQueryExecutor } from "../sql/client";
import { assertOperationalWriteAllowed, PermissionDeniedError } from "../security/permissions";
import { BackendValidationError, validateOperationalWrite } from "../security/validate";

async function jsonBody(request: HttpRequest): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => ({}));
  return body && typeof body === "object" ? body as Record<string, unknown> : {};
}

function actorFrom(request: HttpRequest): string {
  return request.headers.get("x-phoenix-user") || "api";
}

function listOptionsFrom(request: HttpRequest): { top?: string | null; skip?: string | null; changedSince?: string | null } {
  return {
    top: request.query.get("top"),
    skip: request.query.get("skip"),
    changedSince: request.query.get("changedSince")
  };
}

function errorResponse(error: unknown, context: InvocationContext): HttpResponseInit {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof OperationalBadRequestError) {
    return { status: 400, jsonBody: { ok: false, error: message } };
  }
  if (error instanceof BackendValidationError) {
    return { status: 400, jsonBody: { ok: false, error: message, errors: error.errors } };
  }
  if (error instanceof PermissionDeniedError) {
    return { status: 403, jsonBody: { ok: false, error: message } };
  }
  if (error instanceof OperationalNotFoundError) {
    return { status: 404, jsonBody: { ok: false, error: message } };
  }
  if (error instanceof OperationalStaleWriteError) {
    return { status: 409, jsonBody: { ok: false, code: "STALE_WRITE", error: message } };
  }
  context.error("Operational records API failed", { message });
  return { status: 500, jsonBody: { ok: false, error: message } };
}

export async function operationalRecordsRoot(
  request: HttpRequest,
  context: InvocationContext,
  query: SqlQueryExecutor = queryParams
): Promise<HttpResponseInit> {
  try {
    return {
      status: 200,
      jsonBody: {
        ok: true,
        data: await listOperationalRecords(undefined, query),
        generatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    return errorResponse(error, context);
  }
}

export async function operationalRecordsCollection(
  request: HttpRequest,
  context: InvocationContext,
  query: SqlQueryExecutor = queryParams
): Promise<HttpResponseInit> {
  const collectionName = request.params.collection || "";
  try {
    assertOperationalCollection(collectionName);
    if (request.method === "GET") {
      return {
        status: 200,
        jsonBody: {
          ok: true,
          collection: collectionName,
          data: await listOperationalRecords(collectionName, query, listOptionsFrom(request)),
          generatedAt: new Date().toISOString()
        }
      };
    }
    const body = await jsonBody(request);
    const data = (body.data && typeof body.data === "object" ? body.data : body) as OperationalRecordData;
    const actor = actorFrom(request);
    await assertOperationalWriteAllowed(collectionName, "create", actor, data, query);
    await validateOperationalWrite(collectionName, data, null, query);
    const created = await createOperationalRecord(collectionName, data, actor, query);
    return {
      status: 201,
      jsonBody: {
        ok: true,
        id: created.id,
        data: created
      }
    };
  } catch (error) {
    return errorResponse(error, context);
  }
}

export async function operationalRecordsHeads(
  request: HttpRequest,
  context: InvocationContext,
  query: SqlQueryExecutor = queryParams
): Promise<HttpResponseInit> {
  try {
    return {
      status: 200,
      jsonBody: {
        ok: true,
        data: await listOperationalRecordHeads(query),
        generatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    return errorResponse(error, context);
  }
}

export async function operationalRecordsItem(
  request: HttpRequest,
  context: InvocationContext,
  query: SqlQueryExecutor = queryParams
): Promise<HttpResponseInit> {
  const collectionName = request.params.collection || "";
  const id = request.params.id || "";
  try {
    assertOperationalCollection(collectionName);
    const body = await jsonBody(request);
    const data = (body.data && typeof body.data === "object" ? body.data : body) as OperationalRecordData;
    const actor = actorFrom(request);
    await assertOperationalWriteAllowed(collectionName, "update", actor, data, query);
    const existing = await getOperationalRecord(collectionName, id, query);
    if (!existing) throw new OperationalNotFoundError(`Record not found: ${collectionName}/${id}`);
    await validateOperationalWrite(collectionName, { ...existing, ...data, id }, existing, query);
    const updated = await updateOperationalRecord(
      collectionName,
      id,
      data,
      actor,
      body.expectedUpdatedAt,
      query
    );
    return {
      status: 200,
      jsonBody: {
        ok: true,
        id: updated.id,
        data: updated
      }
    };
  } catch (error) {
    return errorResponse(error, context);
  }
}

export async function operationalRecordsArchive(
  request: HttpRequest,
  context: InvocationContext,
  query: SqlQueryExecutor = queryParams
): Promise<HttpResponseInit> {
  const collectionName = request.params.collection || "";
  const id = request.params.id || "";
  try {
    assertOperationalCollection(collectionName);
    const body = await jsonBody(request);
    const actor = actorFrom(request);
    await assertOperationalWriteAllowed(collectionName, "archive", actor, undefined, query);
    const archived = await archiveOperationalRecord(
      collectionName,
      id,
      typeof body.reason === "string" ? body.reason : undefined,
      actor,
      query
    );
    return {
      status: 200,
      jsonBody: {
        ok: true,
        id: archived.id,
        data: archived
      }
    };
  } catch (error) {
    return errorResponse(error, context);
  }
}

export async function operationalRecordsRestore(
  request: HttpRequest,
  context: InvocationContext,
  query: SqlQueryExecutor = queryParams
): Promise<HttpResponseInit> {
  const collectionName = request.params.collection || "";
  const id = request.params.id || "";
  try {
    assertOperationalCollection(collectionName);
    const actor = actorFrom(request);
    await assertOperationalWriteAllowed(collectionName, "restore", actor, undefined, query);
    const restored = await restoreOperationalRecord(collectionName, id, actor, query);
    return {
      status: 200,
      jsonBody: {
        ok: true,
        id: restored.id,
        data: restored
      }
    };
  } catch (error) {
    return errorResponse(error, context);
  }
}

app.http("operationalRecordsRoot", {
  methods: ["GET"],
  authLevel: "function",
  route: "records",
  handler: operationalRecordsRoot
});

app.http("operationalRecordsHeads", {
  methods: ["GET"],
  authLevel: "function",
  route: "records/heads",
  handler: operationalRecordsHeads
});

app.http("operationalRecordsCollection", {
  methods: ["GET", "POST"],
  authLevel: "function",
  route: "records/{collection}",
  handler: operationalRecordsCollection
});

app.http("operationalRecordsItem", {
  methods: ["PATCH"],
  authLevel: "function",
  route: "records/{collection}/{id}",
  handler: operationalRecordsItem
});

app.http("operationalRecordsArchive", {
  methods: ["POST"],
  authLevel: "function",
  route: "records/{collection}/{id}/archive",
  handler: operationalRecordsArchive
});

app.http("operationalRecordsRestore", {
  methods: ["POST"],
  authLevel: "function",
  route: "records/{collection}/{id}/restore",
  handler: operationalRecordsRestore
});
