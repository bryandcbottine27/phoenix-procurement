import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { pingSql } from "../sql/client";

export async function health(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const startedAt = new Date().toISOString();
  try {
    const sqlOk = await pingSql();
    return {
      status: 200,
      jsonBody: {
        ok: true,
        service: "phoenix-procurement-backend",
        sql: { ok: sqlOk },
        checkedAt: startedAt
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.warn("Health check failed", { message });
    return {
      status: 503,
      jsonBody: {
        ok: false,
        service: "phoenix-procurement-backend",
        sql: { ok: false, error: message },
        checkedAt: startedAt
      }
    };
  }
}

app.http("health", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "health",
  handler: health
});
