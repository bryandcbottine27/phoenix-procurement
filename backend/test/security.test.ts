import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { HttpRequest, InvocationContext } from "@azure/functions";
import { test } from "node:test";
import {
  can,
  canWriteCollection,
  PERMISSIONS,
  PermissionDeniedError,
  resolveOfficerRole
} from "../src/security/permissions";
import { BackendValidationError, isSafeLink, validateOperationalWrite } from "../src/security/validate";
import { operationalRecordsCollection } from "../src/functions/records";
import { SqlQueryExecutor } from "../src/sql/client";

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

function fakeRoleQuery(role: string | null): SqlQueryExecutor & { calls: string[] } {
  const calls: string[] = [];
  const query = (async (sqlText: string) => {
    calls.push(sqlText);
    if (sqlText.includes("@officers_collection")) {
      return {
        recordset: role ? [{ dataJson: JSON.stringify({ code: "USER", role, active: true }) }] : []
      } as never;
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
  body: Record<string, unknown>,
  actor = "USER"
): HttpRequest {
  return {
    method: "POST",
    params: { collection },
    headers: { get: (name: string) => name.toLowerCase() === "x-phoenix-user" ? actor : null },
    json: async () => body
  } as unknown as HttpRequest;
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
