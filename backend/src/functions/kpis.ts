import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { BadRequestError, getKpis, KpiQueryInput } from "../kpi/queries";

function queryInput(request: HttpRequest): KpiQueryInput {
  const query = request.query;
  return {
    entity: query.get("entity"),
    dateFrom: query.get("dateFrom"),
    dateTo: query.get("dateTo")
  };
}

export async function kpis(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    return {
      status: 200,
      jsonBody: await getKpis(queryInput(request))
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof BadRequestError) {
      return {
        status: 400,
        jsonBody: { ok: false, error: message }
      };
    }
    context.error("KPI read failed", { message });
    return {
      status: 500,
      jsonBody: { ok: false, error: message }
    };
  }
}

app.http("kpis", {
  methods: ["GET"],
  authLevel: "function",
  route: "kpis",
  handler: kpis
});
