import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from "@azure/functions";
import { createGraphSenderFromEnv } from "../notifications/graphClient";
import { orderAlertSettingsFromEnv, runOrderAlertNotifications } from "../notifications/orderAlerts";

export async function orderAlertNotificationsTimer(timer: Timer, context: InvocationContext): Promise<void> {
  const settings = orderAlertSettingsFromEnv();
  if (!settings.enabled) {
    context.info("Order alert notifications are disabled.", {
      scheduleStatus: timer.scheduleStatus
    });
    return;
  }
  const sender = settings.dryRun ? undefined : createGraphSenderFromEnv();
  const result = await runOrderAlertNotifications(settings, sender);
  context.info("Order alert notification run completed.", result);
}

export async function orderAlertNotificationsPreview(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const settings = {
      ...orderAlertSettingsFromEnv(),
      enabled: true,
      dryRun: true
    };
    const result = await runOrderAlertNotifications(settings);
    return {
      status: 200,
      jsonBody: {
        ...result,
        preview: true
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.warn("Order alert notification preview failed.", { message });
    return {
      status: 500,
      jsonBody: {
        ok: false,
        error: message
      }
    };
  }
}

app.timer("orderAlertNotificationsTimer", {
  schedule: process.env.ORDER_ALERTS_CRON || "0 0 4 * * *",
  handler: orderAlertNotificationsTimer
});

app.http("orderAlertNotificationsPreview", {
  methods: ["GET"],
  authLevel: "function",
  route: "notifications/order-alerts/preview",
  handler: orderAlertNotificationsPreview
});
