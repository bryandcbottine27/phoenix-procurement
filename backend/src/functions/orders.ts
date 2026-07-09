import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { BadRequestError, listOrders, OrderListQueryInput } from "../kpi/queries";

function queryInput(request: HttpRequest): OrderListQueryInput {
  const query = request.query;
  return {
    entity: query.get("entity"),
    function: query.get("function"),
    orderType: query.get("orderType"),
    erpPoStatus: query.get("erpPoStatus"),
    closed: query.get("closed"),
    supplier: query.get("supplier"),
    dateFrom: query.get("dateFrom"),
    dateTo: query.get("dateTo"),
    page: query.get("page"),
    pageSize: query.get("pageSize"),
    sort: query.get("sort")
  };
}

export async function orders(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    return {
      status: 200,
      jsonBody: await listOrders(queryInput(request))
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof BadRequestError) {
      return {
        status: 400,
        jsonBody: { ok: false, error: message }
      };
    }
    context.error("Orders read failed", { message });
    return {
      status: 500,
      jsonBody: { ok: false, error: message }
    };
  }
}

app.http("orders", {
  methods: ["GET"],
  authLevel: "function",
  route: "orders",
  handler: orders
});
