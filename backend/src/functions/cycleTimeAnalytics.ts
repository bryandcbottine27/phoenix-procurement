import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { CycleTimeInput, getCycleTimeAnalytics } from "../analytics/cycleTime";
import { BadRequestError } from "../kpi/queries";

function queryInput(request: HttpRequest): CycleTimeInput {
  return {
    entity: request.query.get("entity"),
    dateFrom: request.query.get("dateFrom"),
    dateTo: request.query.get("dateTo"),
    longOpenDays: request.query.get("longOpenDays"),
    staleSyncDays: request.query.get("staleSyncDays")
  };
}

export async function cycleTimeAnalytics(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    return {
      status: 200,
      jsonBody: await getCycleTimeAnalytics(queryInput(request))
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof BadRequestError) {
      return {
        status: 400,
        jsonBody: { error: message }
      };
    }
    context.error("Cycle-time analytics failed.", { message });
    return {
      status: 500,
      jsonBody: { error: message }
    };
  }
}

app.http("cycleTimeAnalytics", {
  methods: ["GET"],
  authLevel: "function",
  route: "analytics/cycle-time",
  handler: cycleTimeAnalytics
});
