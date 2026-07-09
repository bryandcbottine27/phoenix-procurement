import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { syncPurchaseOrders } from "../sync/purchaseOrderSync";

export async function syncPurchaseOrdersHttp(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const payload = await request.json().catch(() => ({}));
    const body = payload && typeof payload === "object" ? payload as { batchId?: string } : {};
    const result = await syncPurchaseOrders({
      batchId: body.batchId,
      trigger: "http"
    });
    return {
      status: 200,
      jsonBody: {
        ok: true,
        result
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.error("Purchase-order sync failed", { message });
    return {
      status: 500,
      jsonBody: {
        ok: false,
        error: message
      }
    };
  }
}

app.http("syncPurchaseOrders", {
  methods: ["POST"],
  authLevel: "function",
  route: "sync/purchase-orders",
  handler: syncPurchaseOrdersHttp
});
