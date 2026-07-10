import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { CounterBadRequestError, nextCounterValue } from "../operational/counters";

function actorFrom(request: HttpRequest): string {
  return request.headers.get("x-phoenix-user") || "api";
}

function errorResponse(error: unknown, context: InvocationContext): HttpResponseInit {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof CounterBadRequestError) {
    return { status: 400, jsonBody: { ok: false, error: message } };
  }
  context.error("Counter API failed", { message });
  return { status: 500, jsonBody: { ok: false, error: message } };
}

export async function counterNext(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const counterKey = request.params.counterKey || "";
    const value = await nextCounterValue(counterKey, actorFrom(request));
    return {
      status: 200,
      jsonBody: {
        ok: true,
        counterKey,
        value,
        generatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    return errorResponse(error, context);
  }
}

app.http("counterNext", {
  methods: ["POST"],
  authLevel: "function",
  route: "counters/{counterKey}/next",
  handler: counterNext
});
