import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { BadRequestError } from "../kpi/queries";
import { listUnclassifiedWorklist, UnclassifiedWorklistInput } from "../worklists/unclassified";

function queryInput(request: HttpRequest): UnclassifiedWorklistInput {
  return {
    entity: request.query.get("entity"),
    status: request.query.get("status"),
    errorCode: request.query.get("errorCode"),
    page: request.query.get("page"),
    pageSize: request.query.get("pageSize"),
    sort: request.query.get("sort")
  };
}

export async function unclassifiedWorklist(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    return {
      status: 200,
      jsonBody: await listUnclassifiedWorklist(queryInput(request))
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof BadRequestError) {
      return {
        status: 400,
        jsonBody: { error: message }
      };
    }
    context.error("Unclassified worklist failed.", { message });
    return {
      status: 500,
      jsonBody: { error: message }
    };
  }
}

app.http("unclassifiedWorklist", {
  methods: ["GET"],
  authLevel: "function",
  route: "worklists/unclassified",
  handler: unclassifiedWorklist
});
