import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { dwSource } from "../src/sources/dwSource";
import { ORDER_CONTRACT_FIELDS, ORDER_CONTRACT_FIELD_SET } from "../src/warehouse/contract";
import { normalisePurchaseOrder } from "../src/warehouse/normalisePurchaseOrder";

function repoRoot(): string {
  return path.resolve(__dirname, "../../..");
}

async function browserOrderContractFields(): Promise<string[]> {
  const source = await readFile(path.join(repoRoot(), "src", "warehouseAdapter.js"), "utf8");
  const match = /const\s+ORDER_CONTRACT_FIELDS\s*=\s*\[([\s\S]*?)\];/.exec(source);
  assert.ok(match, "src/warehouseAdapter.js must expose ORDER_CONTRACT_FIELDS");
  return Array.from(match[1].matchAll(/'([^']+)'/g), item => item[1]);
}

function assertContractOnly(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    assert.ok(ORDER_CONTRACT_FIELD_SET.has(key), `Unexpected non-contract field: ${key}`);
  }
}

test("backend order contract stays in lockstep with browser PXWarehouse contract", async () => {
  assert.deepEqual(ORDER_CONTRACT_FIELDS, await browserOrderContractFields());
});

test("dwSource.fetchPurchaseOrders returns fixture rows normalized to the order contract", async () => {
  const orders = await dwSource.fetchPurchaseOrders({
    warehouseLoadedAt: "2026-07-08T12:00:00.000Z"
  });

  assert.equal(orders.length, 3);
  for (const order of orders) assertContractOnly(order);

  assert.deepEqual(orders.map(order => order.orderId), [
    "FPO12345",
    "PO-SBL-22001",
    "PO-EDN-33001"
  ]);

  assert.deepEqual(orders[0], {
    integrationLayer: "data-warehouse",
    entity: "Phoenix",
    erpSource: "Navision",
    erpCompany: "PHOENIX-NAV",
    erpEntityId: null,
    erpDocumentId: "NAV-FPO12345",
    erpDocumentNo: "FPO12345",
    orderId: "FPO12345",
    erpVendorNo: "V-PHX-100",
    erpVendorName: "ITHEMBA FOR LIFE",
    supplier: "ITHEMBA FOR LIFE",
    orderType: "foreign",
    function: "technical",
    currency: "USD",
    amount: 1200.5,
    dateOfOrder: "2026-06-28",
    description: "Cooling system spare parts",
    paymentTerms: "30D",
    category: "Engineering",
    iprNumber: "IPR-9001",
    iprApprovedDate: "2026-06-25",
    claimant: "J. Antoine",
    requestedReceiptDate: "2026-08-15",
    erpPoStatus: "Open",
    erpAmount: 1200.5,
    erpCurrency: "USD",
    erpHodId: "GMERLE",
    erpPurchasingMgrId: "BTHOMAS",
    erpCreatedFromIpr: "IPR-9001",
    erpCreatedBy: null,
    erpPurchaserCode: null,
    erpShipmentMethod: null,
    lines: [
      {
        lineNo: 10000,
        itemNo: "SPARE-001",
        description: "Compressor kit",
        quantity: 2,
        amount: 1200.5
      }
    ],
    warehouseSource: "fixture.dw_purchase_orders",
    warehouseRecordId: "fixture-navision-FPO12345",
    warehouseBatchId: "FIXTURE-GATE2",
    warehouseExtractedAt: "2026-07-08T10:00:00.000Z",
    warehouseLoadedAt: "2026-07-08T12:00:00.000Z",
    warehouseHash: "fixture-hash-phoenix-fpo12345"
  });

  assert.equal(orders[1].erpSource, "Business Central");
  assert.equal(orders[1].erpVendorNo, "V-SBL-220");
  assert.equal(orders[1].supplier, "GAZ CARBONIQUE LTEE");
  assert.equal(orders[1].function, "supplychain");
  assert.equal(orders[1].erpPurchaserCode, "SH01");
  assert.equal(orders[1].erpShipmentMethod, "SEA");

  assert.equal(orders[2].erpCompany, "EDENA-BC");
  assert.equal(orders[2].warehouseLoadedAt, "2026-07-08T12:00:00.000Z");
});

test("normalisePurchaseOrder strips non-contract fields and preserves an empty lines array", () => {
  const order = normalisePurchaseOrder({
    orderId: "PO-EXTRA-1",
    entity: "Phoenix",
    amount: "1,234.56",
    currencyCode: "mur",
    status: "Open",
    unexpected: "must not leak"
  }, {
    warehouseSource: "unit-test",
    warehouseBatchId: "UNIT",
    warehouseLoadedAt: "2026-07-08T12:30:00.000Z"
  });

  assertContractOnly(order);
  assert.equal(order.orderId, "PO-EXTRA-1");
  assert.equal(order.amount, 1234.56);
  assert.equal(order.currency, "MUR");
  assert.equal(order.erpPoStatus, "Open");
  assert.deepEqual(order.lines, []);
  assert.equal((order as Record<string, unknown>).unexpected, undefined);
});
