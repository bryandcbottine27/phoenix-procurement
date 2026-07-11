import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { HttpRequest, InvocationContext } from "@azure/functions";
import { test } from "node:test";
import {
  can,
  canReadCollection,
  canWriteCollection,
  PERMISSIONS,
  PermissionDeniedError,
  redactOperationalRecordForRead,
  resolveOfficerRole
} from "../src/security/permissions";
import { BackendValidationError, isSafeLink, validateOperationalWrite } from "../src/security/validate";
import { operationalRecordsCollection, operationalRecordsHeads, operationalRecordsRoot } from "../src/functions/records";
import { SqlParams, SqlQueryExecutor } from "../src/sql/client";

function extractObjectLiteralAfter(source: string, label: string): string {
  const idx = source.indexOf(label);
  if (idx < 0) throw new Error(`Missing label ${label}`);
  const brace = source.indexOf("{", idx);
  let depth = 0;
  let quote = "";
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(brace, i + 1);
    }
  }
  throw new Error(`Unterminated object for ${label}`);
}

function parseBrowserPermissions(): unknown {
  const corePath = path.resolve(process.cwd(), "..", "src", "core.js");
  const source = fs.readFileSync(corePath, "utf8");
  const literal = extractObjectLiteralAfter(source, "permissions:");
  return Function(`return (${literal});`)();
}

function fakeRoleQuery(role: string | null, active = true): SqlQueryExecutor & { calls: string[] } {
  const calls: string[] = [];
  const query = (async (sqlText: string) => {
    calls.push(sqlText);
    if (sqlText.includes("@officers_collection")) {
      return { recordset: role ? [{ dataJson: JSON.stringify({ code: "USER", role, active }) }] : [] } as never;
    }
    if (sqlText.includes("FROM dbo.operational_records")) {
      return { recordset: [] } as never;
    }
    throw new Error(`Unexpected SQL in fake query: ${sqlText}`);
  }) as unknown as SqlQueryExecutor & { calls: string[] };
  query.calls = calls;
  return query;
}

function requestFor(
  collection: string,
  body: Record<string, unknown> = {},
  actor = "USER",
  method = "POST"
): HttpRequest {
  return {
    method,
    params: { collection },
    headers: { get: (name: string) => name.toLowerCase() === "x-phoenix-user" ? actor : null },
    query: new URLSearchParams(),
    json: async () => body
  } as unknown as HttpRequest;
}

function rootRequest(actor = "USER"): HttpRequest {
  return {
    method: "GET",
    params: {},
    headers: { get: (name: string) => name.toLowerCase() === "x-phoenix-user" ? actor : null },
    query: new URLSearchParams(),
    json: async () => ({})
  } as unknown as HttpRequest;
}

function operationalRow(collectionName: string, recordId: string, data: Record<string, unknown>) {
  return {
    collectionName,
    recordId,
    entity: typeof data.entity === "string" ? data.entity : null,
    dataJson: JSON.stringify(data),
    archived: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  };
}

function erpOrderRow() {
  return {
    id: 101,
    integration_layer: "data-warehouse",
    entity: "Phoenix",
    erp_source: "Navision",
    erp_company: "PHOENIX-NAV",
    erp_entity_id: null,
    erp_document_id: "ERP-PO-1",
    erp_document_no: "PO-1",
    order_id: "PO-1",
    erp_vendor_no: "V-1",
    erp_vendor_name: "ERP Supplier",
    supplier: "ERP Supplier",
    order_type: "foreign",
    procurement_function: "technical",
    currency: "USD",
    amount: 100,
    date_of_order: "2026-07-01",
    description: "ERP row",
    payment_terms: "30D",
    category: "Engineering",
    ipr_number: null,
    ipr_approved_date: null,
    claimant: null,
    requested_receipt_date: "2026-08-01",
    erp_po_status: "Released",
    erp_amount: 100,
    erp_currency: "USD",
    erp_hod_id: null,
    erp_purchasing_mgr_id: null,
    erp_created_from_ipr: null,
    erp_created_by: null,
    erp_purchaser_code: null,
    erp_shipment_method: null,
    lines_json: "[]",
    warehouse_source: "fixture",
    warehouse_record_id: "row-1",
    warehouse_batch_id: "batch-1",
    warehouse_extracted_at: null,
    warehouse_loaded_at: null,
    warehouse_hash: null,
    erp_sync_status: "synced",
    erp_last_synced_at: "2026-07-02T00:00:00.000Z",
    erp_sync_error: null,
    last_refresh_changes_json: null,
    last_refresh_at: null,
    initial_operational_status: "Order sent to supplier",
    is_closed: false,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-02T00:00:00.000Z"
  };
}

function fakeReadQuery(role: string | null): SqlQueryExecutor {
  const rows = [
    operationalRow("orders", "ORDER-1", { orderId: "PO-1", supplier: "Supplier A" }),
    operationalRow("payment_requests", "PAY-1", { orderId: "PO-1", amount: 25 }),
    operationalRow("officers", "OFF-1", { code: "OFF1", fullName: "Officer One", email: "officer@example.com", authUid: "uid-1", role: "admin" }),
    operationalRow("system_config", "CFG-1", { configKey: "business_calendars" }),
    operationalRow("status_log", "LOG-1", { entryText: "Sensitive audit row" })
  ];
  return (async (sqlText: string, params: SqlParams = {}) => {
    if (sqlText.includes("@officers_collection")) {
      return { recordset: role ? [{ dataJson: JSON.stringify({ code: "USER", role, active: true }) }] : [] } as never;
    }
    if (sqlText.includes("GROUP BY collection_name")) {
      return {
        recordset: rows.map(row => ({
          collectionName: row.collectionName,
          maxUpdatedAt: row.updatedAt,
          count: 1
        }))
      } as never;
    }
    if (sqlText.includes("FROM dbo.orders")) {
      if (/MAX\(updated_at\)/i.test(sqlText) || /COUNT_BIG/i.test(sqlText)) {
        return { recordset: [{ maxUpdatedAt: "2026-07-02T00:00:00.000Z", count: 2 }] } as never;
      }
      return { recordset: [erpOrderRow()] } as never;
    }
    if (sqlText.includes("@orders_collection")) {
      return { recordset: rows.filter(row => row.collectionName === "orders") } as never;
    }
    if (sqlText.includes("WITH ranked")) {
      return { recordset: rows } as never;
    }
    if (sqlText.includes("collection_name = @collection_name")) {
      const collectionName = (params.collection_name as { value?: string } | undefined)?.value;
      return { recordset: rows.filter(row => row.collectionName === collectionName) } as never;
    }
    throw new Error(`Unexpected SQL in fake read query: ${sqlText}`);
  }) as SqlQueryExecutor;
}

const context = {
  error: () => undefined,
  warn: () => undefined
} as unknown as InvocationContext;

test("backend permission matrix stays in lockstep with browser REF.permissions", () => {
  assert.deepEqual(PERMISSIONS, parseBrowserPermissions());
});

test("server-side permission helper fails closed and keeps privileged collections privileged", async () => {
  assert.equal(can("admin", "payments", "create"), true);
  assert.equal(can("stakeholder", "exports", "view"), false);
  assert.equal(can("stakeholder", "payments", "create"), false);
  assert.equal(can("missing_role", "orders", "create"), false);
  assert.equal(canWriteCollection("stakeholder", "payment_requests", "create"), false);
  assert.equal(canWriteCollection("procurement_technical_manager", "kpiSnapshot", "create"), true);
  assert.equal(canWriteCollection("sc_officer", "system_config", "create"), false);
  assert.equal(await resolveOfficerRole("USER", fakeRoleQuery("stakeholder")), "stakeholder");
  await assert.rejects(
    () => resolveOfficerRole("USER", fakeRoleQuery(null)).then(role => {
      if (!role) throw new PermissionDeniedError("No stored role");
    }),
    PermissionDeniedError
  );
});

test("server-side read helper filters by role and redacts officer PII", () => {
  assert.equal(canReadCollection("demand_officer", "payment_requests"), false);
  assert.equal(canReadCollection("stakeholder", "exports"), false);
  assert.equal(canReadCollection("stakeholder", "orders"), true);
  assert.equal(canReadCollection("stakeholder", "officers"), true);
  assert.equal(canReadCollection("stakeholder", "system_config"), true);
  assert.equal(canReadCollection("stakeholder", "status_log"), false);
  assert.equal(canReadCollection("procurement_technical_manager", "status_log"), true);
  assert.equal(canReadCollection("finance", "shipments"), false);
  assert.equal(canReadCollection("finance", "payment_requests"), true);
  assert.equal(canReadCollection("missing_role", "orders"), false);

  const officer = {
    code: "OFF1",
    fullName: "Officer One",
    email: "officer@example.com",
    authUid: "uid-1"
  };
  assert.deepEqual(redactOperationalRecordForRead("officers", "stakeholder", officer), {
    code: "OFF1",
    fullName: "Officer One"
  });
  assert.equal(redactOperationalRecordForRead("officers", "admin", officer).email, "officer@example.com");
});

test("backend validators block missing supplier, unsafe links, and overpayments", async () => {
  await assert.rejects(
    () => validateOperationalWrite("orders", { orderId: "PO-1", entity: "Phoenix", currency: "USD", amount: 10 }),
    BackendValidationError
  );
  assert.equal(isSafeLink("javascript:alert(1)"), false);
  await assert.rejects(
    () => validateOperationalWrite("documents", { documentUrl: "javascript:alert(1)" }),
    BackendValidationError
  );
  const query = (async (sqlText, params) => {
    const collectionName = (params?.collection_name as { value?: string } | undefined)?.value;
    if (sqlText.includes("collection_name = @collection_name")) {
      if (collectionName === "payment_requests") return { recordset: [] } as never;
      return { recordset: [{ recordId: "ORDER-1", dataJson: JSON.stringify({ orderId: "PO-1", amount: 100 }) }] } as never;
    }
    return { recordset: [] } as never;
  }) as SqlQueryExecutor;
  await assert.rejects(
    () => validateOperationalWrite("payment_requests", { orderId: "PO-1", amount: 150 }, null, query),
    BackendValidationError
  );
});

test("records endpoint denies stakeholder payment create and ignores client-sent role", async () => {
  const response = await operationalRecordsCollection(requestFor("payment_requests", {
    data: { orderId: "PO-1", amount: 1, role: "admin" }
  }), context, fakeRoleQuery("stakeholder"));
  assert.equal(response.status, 403);
});

test("records read endpoints require a stored active officer and filter readable collections", async () => {
  const root = await operationalRecordsRoot(rootRequest(), context, fakeReadQuery("demand_officer"));
  assert.equal(root.status, 200);
  const rootData = (root.jsonBody as { data: Record<string, Record<string, unknown>[]> }).data;
  assert.ok(rootData.orders);
  assert.ok(rootData.officers);
  assert.ok(rootData.system_config);
  assert.equal(rootData.payment_requests, undefined);
  assert.equal(rootData.status_log, undefined);
  assert.equal(rootData.officers[0].email, undefined);
  assert.equal(rootData.officers[0].authUid, undefined);

  const heads = await operationalRecordsHeads(rootRequest(), context, fakeReadQuery("demand_officer"));
  assert.equal(heads.status, 200);
  const headCollections = ((heads.jsonBody as { data: { collectionName: string }[] }).data).map(row => row.collectionName);
  assert.ok(headCollections.includes("orders"));
  assert.ok(headCollections.includes("officers"));
  assert.equal(headCollections.includes("payment_requests"), false);
  assert.equal(headCollections.includes("status_log"), false);

  const forbidden = await operationalRecordsCollection(requestFor("payment_requests", {}, "USER", "GET"), context, fakeReadQuery("demand_officer"));
  assert.equal(forbidden.status, 403);

  const missingOfficer = await operationalRecordsCollection(requestFor("orders", {}, "USER", "GET"), context, fakeReadQuery(null));
  assert.equal(missingOfficer.status, 403);

  const adminOfficers = await operationalRecordsCollection(requestFor("officers", {}, "USER", "GET"), context, fakeReadQuery("admin"));
  assert.equal(adminOfficers.status, 200);
  const adminRows = (adminOfficers.jsonBody as { data: Record<string, unknown>[] }).data;
  assert.equal(adminRows[0].email, "officer@example.com");
  assert.equal(adminRows[0].authUid, "uid-1");
});

test("records endpoint returns 400 for unknown collections and invalid payloads", async () => {
  const unknown = await operationalRecordsCollection(requestFor("users;DROP TABLE dbo.orders", {
    data: { id: "bad" }
  }), context, fakeRoleQuery("admin"));
  assert.equal(unknown.status, 400);

  const badOrder = await operationalRecordsCollection(requestFor("orders", {
    data: { orderId: "PO-1", entity: "Phoenix", currency: "USD", amount: 10 }
  }), context, fakeRoleQuery("admin"));
  assert.equal(badOrder.status, 400);

  const badDocument = await operationalRecordsCollection(requestFor("documents", {
    data: { documentUrl: "javascript:alert(1)" }
  }), context, fakeRoleQuery("admin"));
  assert.equal(badDocument.status, 400);
});
