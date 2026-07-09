import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { BadRequestError } from "../kpi/queries";
import { getOtifRisk, OtifRiskInput } from "../analytics/otifRisk";

function queryInput(request: HttpRequest): OtifRiskInput {
  return {
    entity: request.query.get("entity"),
    dateFrom: request.query.get("dateFrom"),
    dateTo: request.query.get("dateTo"),
    horizonDays: request.query.get("horizonDays"),
    longOpenDays: request.query.get("longOpenDays"),
    staleSyncDays: request.query.get("staleSyncDays"),
    minRiskScore: request.query.get("minRiskScore")
  };
}

export async function otifRisk(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    return {
      status: 200,
      jsonBody: await getOtifRisk(queryInput(request))
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof BadRequestError) {
      return {
        status: 400,
        jsonBody: { error: message }
      };
    }
    context.error("OTIF risk analytics failed.", { message });
    return {
      status: 500,
      jsonBody: { error: message }
    };
  }
}

app.http("otifRisk", {
  methods: ["GET"],
  authLevel: "function",
  route: "analytics/otif-risk",
  handler: otifRisk
});
