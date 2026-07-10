import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  archiveOperationalRecord,
  createOperationalRecord,
  listOperationalRecords,
  OperationalBadRequestError,
  OperationalNotFoundError,
  OperationalRecordData,
  OperationalStaleWriteError,
  restoreOperationalRecord,
  updateOperationalRecord
} from "../operational/records";

async function jsonBody(request: HttpRequest): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => ({}));
  return body && typeof body === "object" ? body as Record<string, unknown> : {};
}

function actorFrom(request: HttpRequest): string {
  return request.headers.get("x-phoenix-user") || "api";
}

function errorResponse(error: unknown, context: InvocationContext): HttpResponseInit {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof OperationalBadRequestError) {
    return { status: 400, jsonBody: { ok: false, error: message } };
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

export async function operationalRecordsRoot(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    return {
      status: 200,
      jsonBody: {
        ok: true,
        data: await listOperationalRecords(),
        generatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    return errorResponse(error, context);
  }
}

export async function operationalRecordsCollection(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const collectionName = request.params.collection || "";
  try {
    if (request.method === "GET") {
      return {
        status: 200,
        jsonBody: {
          ok: true,
          collection: collectionName,
          data: await listOperationalRecords(collectionName),
          generatedAt: new Date().toISOString()
        }
      };
    }
    const body = await jsonBody(request);
    const data = (body.data && typeof body.data === "object" ? body.data : body) as OperationalRecordData;
    const created = await createOperationalRecord(collectionName, data, actorFrom(request));
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

export async function operationalRecordsItem(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const collectionName = request.params.collection || "";
  const id = request.params.id || "";
  try {
    const body = await jsonBody(request);
    const data = (body.data && typeof body.data === "object" ? body.data : body) as OperationalRecordData;
    const updated = await updateOperationalRecord(
      collectionName,
      id,
      data,
      actorFrom(request),
      body.expectedUpdatedAt
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

export async function operationalRecordsArchive(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const collectionName = request.params.collection || "";
  const id = request.params.id || "";
  try {
    const body = await jsonBody(request);
    const archived = await archiveOperationalRecord(
      collectionName,
      id,
      typeof body.reason === "string" ? body.reason : undefined,
      actorFrom(request)
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

export async function operationalRecordsRestore(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const collectionName = request.params.collection || "";
  const id = request.params.id || "";
  try {
    const restored = await restoreOperationalRecord(collectionName, id, actorFrom(request));
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
