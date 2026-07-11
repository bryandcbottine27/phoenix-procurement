import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { readErpOrders, readOperationalOrders, reconcileOrders } from "../operational/orderMerge";
import { assertOperationalReadAllowed, PermissionDeniedError } from "../security/permissions";
import { queryParams, SqlQueryExecutor } from "../sql/client";

function actorFrom(request: HttpRequest): string {
  return request.headers.get("x-phoenix-user") || "api";
}

function errorResponse(error: unknown, context: InvocationContext): HttpResponseInit {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof PermissionDeniedError) {
    return { status: 403, jsonBody: { ok: false, error: message } };
  }
  context.error("Order reconciliation API failed", { message });
  return { status: 500, jsonBody: { ok: false, error: message } };
}

export async function orderReconciliation(
  request: HttpRequest,
  context: InvocationContext,
  query: SqlQueryExecutor = queryParams
): Promise<HttpResponseInit> {
  try {
    await assertOperationalReadAllowed("orders", actorFrom(request), query);
    const erpOrders = await readErpOrders(query);
    const operationalOrders = await readOperationalOrders(query);
    return {
      status: 200,
      jsonBody: {
        ok: true,
        data: reconcileOrders(erpOrders, operationalOrders),
        generatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    return errorResponse(error, context);
  }
}

app.http("orderReconciliation", {
  methods: ["GET"],
  authLevel: "function",
  route: "reconciliation/orders",
  handler: orderReconciliation
});
