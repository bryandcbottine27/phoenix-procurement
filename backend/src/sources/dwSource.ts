import { readFile } from "node:fs/promises";
import path from "node:path";
import { PurchaseOrderContract } from "../warehouse/contract";
import { classifyPurchaseOrder } from "../warehouse/classification";
import { normalisePurchaseOrder, PurchaseOrderNormaliseOptions } from "../warehouse/normalisePurchaseOrder";

export interface FetchPurchaseOrdersOptions extends PurchaseOrderNormaliseOptions {
  fixturePath?: string;
}

type FixturePayload = {
  purchaseOrders?: Record<string, unknown>[];
};

function defaultFixturePath(): string {
  return path.resolve(__dirname, "../../../fixtures/purchase-orders.json");
}

function rowsFromFixture(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const purchaseOrders = (payload as FixturePayload).purchaseOrders;
    if (Array.isArray(purchaseOrders)) return purchaseOrders;
  }
  throw new Error("Purchase-order fixture must be an array or an object with purchaseOrders[].");
}

export async function fetchPurchaseOrders(options: FetchPurchaseOrdersOptions = {}): Promise<PurchaseOrderContract[]> {
  const fixturePath = options.fixturePath ? path.resolve(options.fixturePath) : defaultFixturePath();
  const raw = await readFile(fixturePath, "utf8");
  const rows = rowsFromFixture(JSON.parse(raw));
  return rows.map(row => classifyPurchaseOrder(normalisePurchaseOrder(row, options)));
}

export const dwSource = {
  fetchPurchaseOrders
};
