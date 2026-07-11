import * as sql from "mssql";
import { queryParams, SqlQueryExecutor, typedParam } from "../sql/client";

export class PermissionDeniedError extends Error {}

type ResourceActions = Record<string, readonly string[]>;
export type PermissionMatrix = Record<string, "*" | ResourceActions>;

export const PERMISSIONS: PermissionMatrix = {
  admin: "*",
  procurement_senior_manager: { orders: ["view"], shipments: ["view"], exports: ["view"], payments: ["view", "approve"], milestones: ["view", "create", "edit", "archive"], suppliers: ["view", "create", "edit", "archive"], documents: ["view"], followups: ["view", "create", "edit", "archive"], issues: ["view", "create", "edit", "archive"], updateRequests: ["view", "create", "edit", "archive"], officers: ["view"], reports: ["view"], erprecon: ["view", "create", "edit", "archive"], logisticsCost: [] },
  sc_manager: { orders: ["view", "create", "edit", "archive"], shipments: ["view", "create", "edit", "archive"], exports: ["view"], payments: ["view", "approve"], milestones: ["view", "create", "edit", "archive"], suppliers: ["view", "create", "edit", "archive"], documents: ["view"], followups: ["view", "create", "edit", "archive"], issues: ["view", "create", "edit", "archive"], updateRequests: ["view", "create", "edit", "archive"], officers: ["view"], reports: ["view"], erprecon: ["view", "create", "edit", "archive"], logisticsCost: [] },
  sc_officer: { orders: ["view", "create", "edit"], shipments: ["view"], exports: ["view"], payments: ["view", "create", "edit"], milestones: ["view", "create", "edit"], suppliers: ["view", "create", "edit"], documents: ["view", "create", "edit"], followups: ["view", "create", "edit"], issues: ["view", "create", "edit"], updateRequests: ["view", "create", "edit"], officers: [], reports: ["view"], erprecon: [], logisticsCost: [] },
  procurement_technical_manager: { orders: ["view", "create", "edit", "archive"], shipments: ["view", "create", "edit", "archive"], exports: ["view"], payments: ["view", "approve"], milestones: ["view", "create", "edit", "archive"], suppliers: ["view", "create", "edit", "archive"], documents: ["view"], followups: ["view", "create", "edit", "archive"], issues: ["view", "create", "edit", "archive"], updateRequests: ["view", "create", "edit", "archive"], officers: ["view"], reports: ["view"], erprecon: ["view", "create", "edit", "archive"], logisticsCost: [] },
  procurement_technical_officer: { orders: ["view", "create", "edit"], shipments: ["view"], exports: ["view"], payments: ["view", "create", "edit"], milestones: ["view", "create", "edit"], suppliers: ["view", "create", "edit"], documents: ["view", "create", "edit"], followups: ["view", "create", "edit"], issues: ["view", "create", "edit"], updateRequests: ["view", "create", "edit"], officers: [], reports: ["view"], erprecon: [], logisticsCost: [] },
  procurement_indirect_manager: { orders: ["view", "create", "edit", "archive"], shipments: ["view", "create", "edit", "archive"], exports: ["view"], payments: ["view", "approve"], milestones: ["view", "create", "edit", "archive"], suppliers: ["view", "create", "edit", "archive"], documents: ["view"], followups: ["view", "create", "edit", "archive"], issues: ["view", "create", "edit", "archive"], updateRequests: ["view", "create", "edit", "archive"], officers: ["view"], reports: ["view"], erprecon: ["view", "create", "edit", "archive"], logisticsCost: [] },
  procurement_indirect_officer: { orders: ["view", "create", "edit"], shipments: ["view"], exports: ["view"], payments: ["view", "create", "edit"], milestones: ["view", "create", "edit"], suppliers: ["view", "create", "edit"], documents: ["view", "create", "edit"], followups: ["view", "create", "edit"], issues: ["view", "create", "edit"], updateRequests: ["view", "create", "edit"], officers: [], reports: ["view"], erprecon: [], logisticsCost: [] },
  procurement_technical_supervisor: { orders: ["view", "create", "edit"], shipments: ["view"], exports: ["view"], payments: ["view", "create", "edit", "approve"], milestones: ["view", "create", "edit"], suppliers: ["view", "create", "edit"], documents: ["view", "create", "edit"], followups: ["view", "create", "edit"], issues: ["view", "create", "edit"], updateRequests: ["view", "create", "edit"], officers: [], reports: ["view"], erprecon: [], logisticsCost: [] },
  procurement_indirect_supervisor: { orders: ["view", "create", "edit"], shipments: ["view"], exports: ["view"], payments: ["view", "create", "edit", "approve"], milestones: ["view", "create", "edit"], suppliers: ["view", "create", "edit"], documents: ["view", "create", "edit"], followups: ["view", "create", "edit"], issues: ["view", "create", "edit"], updateRequests: ["view", "create", "edit"], officers: [], reports: ["view"], erprecon: [], logisticsCost: [] },
  sc_supervisor: { orders: ["view", "create", "edit"], shipments: ["view"], exports: ["view"], payments: ["view", "create", "edit", "approve"], milestones: ["view", "create", "edit"], suppliers: ["view", "create", "edit"], documents: ["view", "create", "edit"], followups: ["view", "create", "edit"], issues: ["view", "create", "edit"], updateRequests: ["view", "create", "edit"], officers: [], reports: ["view"], erprecon: [], logisticsCost: [] },
  logistics_manager: { orders: ["view"], shipments: ["view", "create", "edit", "archive"], exports: ["view", "create", "edit", "archive"], payments: ["view", "approve"], milestones: ["view", "create", "edit"], suppliers: ["view"], documents: ["view", "create", "edit", "archive"], followups: ["view", "create", "edit", "archive"], issues: ["view", "create", "edit", "archive"], updateRequests: ["view", "create", "edit", "archive"], officers: [], reports: ["view"], erprecon: ["view", "create", "edit"], logisticsCost: [] },
  logistics_officer: { orders: ["view"], shipments: ["view", "create", "edit", "archive"], exports: ["view", "create", "edit", "archive"], payments: ["view"], milestones: ["view"], suppliers: ["view"], documents: ["view", "create", "edit"], followups: ["view", "create", "edit"], issues: ["view", "create", "edit"], updateRequests: ["view", "create", "edit"], officers: [], reports: ["view"], erprecon: [], logisticsCost: [] },
  demand_supervisor: { orders: ["view"], shipments: ["view"], exports: ["view"], payments: [], milestones: ["view"], suppliers: ["view"], documents: ["view"], followups: ["view"], issues: ["view"], updateRequests: ["view", "create", "edit"], officers: [], reports: ["view"], erprecon: [], logisticsCost: [] },
  demand_officer: { orders: ["view"], shipments: ["view"], exports: ["view"], payments: [], milestones: ["view"], suppliers: ["view"], documents: ["view"], followups: ["view"], issues: ["view"], updateRequests: ["view", "create", "edit"], officers: [], reports: ["view"], erprecon: [], logisticsCost: [] },
  finance: { orders: ["view"], shipments: [], exports: [], payments: ["view", "approve"], milestones: ["view"], suppliers: ["view"], documents: ["view"], followups: [], issues: ["view"], updateRequests: ["view", "create", "edit"], officers: [], reports: ["view"], erprecon: [], logisticsCost: [] },
  stakeholder: { orders: ["view"], shipments: ["view"], exports: ["view"], payments: ["view"], milestones: [], suppliers: [], documents: ["view"], followups: [], issues: ["view"], updateRequests: ["view", "create", "edit"], officers: [], reports: [], erprecon: [], logisticsCost: [] }
};

export const RESOURCE_FOR_COLLECTION: Record<string, string | undefined> = {
  orders: "orders",
  shipments: "shipments",
  payment_requests: "payments",
  suppliers: "suppliers",
  documents: "documents",
  followups: "followups",
  issues: "issues",
  exports: "exports",
  updateRequests: "updateRequests",
  officers: "officers"
};

const PRIVILEGED_COLLECTIONS = new Set(["status_log", "system_config", "kpiSnapshot"]);

interface OfficerRow {
  dataJson: string;
}

function normaliseRole(role: unknown): string {
  const raw = String(role || "").trim();
  const aliases: Record<string, string> = {
    accounts: "finance"
  };
  return aliases[raw] || raw;
}

export function permissionActionFor(action: string): string {
  if (action === "update") return "edit";
  if (action === "restore") return "archive";
  return action;
}

export function can(roleInput: unknown, resource: string, action: string): boolean {
  const role = normaliseRole(roleInput);
  const perms = PERMISSIONS[role];
  if (perms === "*" || role === "admin") return true;
  if (!perms) return false;
  const allowed = perms[resource];
  return Array.isArray(allowed) && allowed.includes(action);
}

export function isPrivilegedRole(roleInput: unknown): boolean {
  const role = normaliseRole(roleInput);
  return role === "admin" || /(^|_)(manager|supervisor)$/.test(role);
}

function resourceForCollection(collectionName: string, data?: Record<string, unknown>): string | undefined {
  if (collectionName === "contactLog") {
    return data?.relatedType === "shipment" ? "shipments" : "orders";
  }
  return RESOURCE_FOR_COLLECTION[collectionName];
}

export function canWriteCollection(
  role: unknown,
  collectionName: string,
  action: string,
  data?: Record<string, unknown>
): boolean {
  if (PRIVILEGED_COLLECTIONS.has(collectionName)) return isPrivilegedRole(role);
  const resource = resourceForCollection(collectionName, data);
  if (!resource) return false;
  return can(role, resource, permissionActionFor(action));
}

export async function resolveOfficerRole(
  actorInput: string,
  query: SqlQueryExecutor = queryParams
): Promise<string | null> {
  const actor = String(actorInput || "").trim();
  if (!actor) return null;
  const result = await query<OfficerRow>(`
    SELECT TOP (1)
      data_json AS dataJson
    FROM dbo.operational_records
    WHERE collection_name = @officers_collection
      AND archived = 0
      AND (
        record_id = @actor
        OR JSON_VALUE(data_json, '$.code') = @actor
        OR JSON_VALUE(data_json, '$.email') = @actor
        OR JSON_VALUE(data_json, '$.authUid') = @actor
      )
    ORDER BY updated_at DESC;
  `, {
    officers_collection: typedParam(sql.NVarChar(80), "officers"),
    actor: typedParam(sql.NVarChar(160), actor)
  });
  const row = result.recordset[0];
  if (!row) return null;
  const officer = JSON.parse(row.dataJson || "{}") as Record<string, unknown>;
  if (officer.active === false) return null;
  return normaliseRole(officer.role);
}

export async function assertOperationalWriteAllowed(
  collectionName: string,
  action: string,
  actor: string,
  data?: Record<string, unknown>,
  query: SqlQueryExecutor = queryParams
): Promise<string> {
  const role = await resolveOfficerRole(actor, query);
  if (role && canWriteCollection(role, collectionName, action, data)) return role;
  throw new PermissionDeniedError(`Not authorised to ${permissionActionFor(action)} ${collectionName}.`);
}
