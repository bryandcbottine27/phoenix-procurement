import { app, InvocationContext, Timer } from "@azure/functions";
import { syncPurchaseOrders } from "../sync/purchaseOrderSync";

export async function syncPurchaseOrdersTimer(timer: Timer, context: InvocationContext): Promise<void> {
  if (process.env.DW_SYNC_TIMER_ENABLED !== "true") {
    context.info("Purchase-order timer sync is disabled.", {
      scheduleStatus: timer.scheduleStatus
    });
    return;
  }

  const result = await syncPurchaseOrders({
    trigger: "timer"
  });
  context.info("Purchase-order timer sync completed.", result);
}

app.timer("syncPurchaseOrdersTimer", {
  schedule: process.env.DW_SYNC_CRON || "0 */30 * * * *",
  handler: syncPurchaseOrdersTimer
});
