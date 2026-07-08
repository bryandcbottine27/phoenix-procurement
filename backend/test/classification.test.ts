import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
  baselineRules,
  classifyOrderType,
  classifyPurchaseOrder,
  resolveFunctionForOrder
} from "../src/warehouse/classification";
import { PurchaseOrderContract } from "../src/warehouse/contract";

function repoRoot(): string {
  return path.resolve(__dirname, "../../..");
}

async function browserBaselineRules(): Promise<unknown[]> {
  const source = await readFile(path.join(repoRoot(), "src", "importRules.js"), "utf8");
  const browserWindow: {
    __state: { data: { importRules: unknown[] } };
    PXStore: Record<string, unknown>;
    PXImportRules?: { baselineRules: () => unknown[] };
  } = {
    __state: { data: { importRules: [] } },
    PXStore: {}
  };
  runInNewContext(source, { window: browserWindow, console }, { filename: "src/importRules.js" });
  assert.ok(browserWindow.PXImportRules, "browser import rules must expose PXImportRules");
  return JSON.parse(JSON.stringify(browserWindow.PXImportRules.baselineRules())) as unknown[];
}

test("backend classifier baseline rules stay in lockstep with browser importRules.js", async () => {
  assert.deepEqual(baselineRules(), await browserBaselineRules());
});

test("classifier resolves Business Central purchaser-code functions", () => {
  assert.equal(resolveFunctionForOrder({
    entity: "Edena",
    erpSource: "Business Central",
    erpPurchaserCode: "ET01",
    erpCreatedBy: "",
    lines: []
  } as PurchaseOrderContract), "indirect");

  assert.equal(resolveFunctionForOrder({
    entity: "Seychelles Breweries",
    erpSource: "Business Central",
    erpPurchaserCode: "SH01",
    erpCreatedBy: "",
    lines: []
  } as PurchaseOrderContract), "supplychain");
});

test("classifier applies Created By fallback only when Purchaser Code is blank", () => {
  assert.equal(resolveFunctionForOrder({
    entity: "Seychelles Breweries",
    erpSource: "Business Central",
    erpPurchaserCode: "",
    erpCreatedBy: "SUPPLYCHAIN",
    lines: []
  } as PurchaseOrderContract), "supplychain");

  assert.equal(resolveFunctionForOrder({
    entity: "Seychelles Breweries",
    erpSource: "Business Central",
    erpPurchaserCode: "ET01",
    erpCreatedBy: "SUPPLYCHAIN",
    lines: []
  } as PurchaseOrderContract), "indirect");
});

test("classifier applies Phoenix DNARAYANEN secondary HOD rules", () => {
  assert.equal(resolveFunctionForOrder({
    entity: "Phoenix",
    erpSource: "Navision",
    erpPurchasingMgrId: "DNARAYANEN",
    erpHodId: "GMERLE",
    lines: []
  } as PurchaseOrderContract), "technical");

  assert.equal(resolveFunctionForOrder({
    entity: "Phoenix",
    erpSource: "Navision",
    erpPurchasingMgrId: "DNARAYANEN",
    erpHodId: "DNARAYANEN",
    lines: []
  } as PurchaseOrderContract), "supplychain");
});

test("classifier derives order type from Phoenix FPO/LPO and BC currency rules", () => {
  assert.equal(classifyOrderType({
    entity: "Phoenix",
    erpSource: "Navision",
    orderId: "LPO12345",
    lines: []
  } as PurchaseOrderContract), "local");

  assert.equal(classifyOrderType({
    entity: "Phoenix",
    erpSource: "Navision",
    orderId: "FPO12345",
    lines: []
  } as PurchaseOrderContract), "foreign");

  assert.equal(classifyOrderType({
    entity: "Seychelles Breweries",
    erpSource: "Business Central",
    currency: null,
    lines: []
  } as PurchaseOrderContract), "local");

  assert.equal(classifyOrderType({
    entity: "Seychelles Breweries",
    erpSource: "Business Central",
    currency: "SCR",
    lines: []
  } as PurchaseOrderContract), "local");

  assert.equal(classifyOrderType({
    entity: "Seychelles Breweries",
    erpSource: "Business Central",
    currency: "USD",
    lines: []
  } as PurchaseOrderContract), "foreign");
});

test("classifyPurchaseOrder writes derived function and orderType only", () => {
  const order = classifyPurchaseOrder({
    entity: "Seychelles Breweries",
    erpSource: "Business Central",
    erpPurchaserCode: "ET01",
    erpCreatedBy: "SUPPLYCHAIN",
    currency: "USD",
    lines: []
  } as PurchaseOrderContract);

  assert.equal(order.function, "indirect");
  assert.equal(order.orderType, "foreign");
  assert.equal((order as Record<string, unknown>).status, undefined);
  assert.equal((order as Record<string, unknown>).phoenix_data, undefined);
});
