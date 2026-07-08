import { PurchaseOrderContract } from "./contract";

export const blank = "__BLANK__";

export type ProcurementFunction = "technical" | "indirect" | "supplychain";
export type OrderType = "foreign" | "local";
export type ImportRuleType = "function" | "localCurrency";

export interface ImportRule {
  ruleKey: string;
  ruleType: ImportRuleType;
  entity: string;
  erpSource: string;
  sourceField: string;
  matchValue: string;
  resultValue: string;
  priority: number;
  active: boolean;
  requiresBlankField?: string;
  secondaryField?: string;
  secondaryMatchValue?: string;
  notes?: string;
}

export interface ClassificationContext {
  entity?: unknown;
  erpSource?: unknown;
  values?: Record<string, unknown>;
}

function U(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normaliseFunction(value: unknown): ProcurementFunction | null {
  const normalised = String(value ?? "").trim().toLowerCase();
  return ["technical", "indirect", "supplychain"].includes(normalised)
    ? normalised as ProcurementFunction
    : null;
}

function normaliseOrderType(value: unknown): OrderType | null {
  const normalised = String(value ?? "").trim().toLowerCase();
  return normalised === "foreign" || normalised === "local" ? normalised : null;
}

function functionRule(
  ruleKey: string,
  entity: string,
  sourceField: string,
  matchValue: string,
  resultValue: ProcurementFunction,
  priority: number,
  extra: Partial<ImportRule> = {}
): ImportRule {
  return {
    ruleKey,
    ruleType: "function",
    entity,
    erpSource: entity === "Phoenix" ? "Navision" : "Business Central",
    sourceField,
    matchValue,
    resultValue,
    priority,
    active: true,
    ...extra
  };
}

function localCurrencyRule(ruleKey: string, entity: string, resultValue: string): ImportRule {
  return {
    ruleKey,
    ruleType: "localCurrency",
    entity,
    erpSource: "Business Central",
    sourceField: "Currency Code",
    matchValue: blank,
    resultValue,
    priority: 10,
    active: true
  };
}

export const BASELINE_RULES: ImportRule[] = [
  functionRule("phx-mgr-bthomas", "Phoenix", "Purchasing Mgr ID", "BTHOMAS", "technical", 10),
  functionRule("phx-mgr-bbottine", "Phoenix", "Purchasing Mgr ID", "BBOTTINE", "technical", 10),
  functionRule("phx-mgr-dchristine", "Phoenix", "Purchasing Mgr ID", "DCHRISTINE", "technical", 10),
  functionRule("phx-mgr-radaken", "Phoenix", "Purchasing Mgr ID", "RADAKEN", "indirect", 10),
  functionRule("phx-mgr-aa", "Phoenix", "Purchasing Mgr ID", "AA", "supplychain", 10),
  functionRule("phx-mgr-mcombes", "Phoenix", "Purchasing Mgr ID", "MCOMBES", "supplychain", 10),
  functionRule("phx-dnarayanen-hod-self", "Phoenix", "Purchasing Mgr ID", "DNARAYANEN", "supplychain", 10, {
    secondaryField: "HOD ID",
    secondaryMatchValue: "DNARAYANEN"
  }),
  functionRule("phx-dnarayanen-hod-gmerle", "Phoenix", "Purchasing Mgr ID", "DNARAYANEN", "technical", 20, {
    secondaryField: "HOD ID",
    secondaryMatchValue: "GMERLE"
  }),
  functionRule("phx-dnarayanen-fallback", "Phoenix", "Purchasing Mgr ID", "DNARAYANEN", "technical", 100),

  ...([
    ["BB01", "technical"], ["BR01", "supplychain"], ["DC01", "technical"], ["EJ01", "technical"],
    ["EL01", "technical"], ["ET01", "indirect"], ["HB01", "technical"], ["MK01", "supplychain"],
    ["RA01", "indirect"], ["SH01", "supplychain"], ["SL01", "supplychain"], ["SN01", "supplychain"],
    ["TV01", "indirect"], ["VS01", "technical"], ["YA01", "technical"]
  ] as const).map(([code, fn]) => functionRule(`bc-purchaser-${code.toLowerCase()}`, "*", "Purchaser Code", code, fn, 10, {
    erpSource: "Business Central",
    notes: "Shared Seychelles Breweries and Edena purchaser-code rule."
  })),

  ...([
    ["PROCUREMENT TECHNICAL", "technical"], ["PROCUREMENT INDIRECTS", "indirect"],
    ["ROBERT ADAKEN", "indirect"], ["SUPPLYCHAIN", "supplychain"],
    ["ANOUSHA A BANSROPUN", "supplychain"], ["DHARMARAJEN GOINDEN GOUNDAN", "supplychain"],
    ["SYLVIA ARISSOL", "supplychain"]
  ] as const).map(([name, fn]) => functionRule(`bc-createdby-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, "*", "Created By", name, fn, 100, {
    erpSource: "Business Central",
    requiresBlankField: "Purchaser Code",
    notes: "Fallback only when Purchaser Code is blank."
  })),

  localCurrencyRule("bc-local-sey-scr", "Seychelles Breweries", "SCR"),
  localCurrencyRule("bc-local-edena-eur", "Edena", "EUR")
];

function cloneRules(): ImportRule[] {
  return JSON.parse(JSON.stringify(BASELINE_RULES)) as ImportRule[];
}

function isActive(rule: ImportRule): boolean {
  return rule.active !== false;
}

export function baselineRules(): ImportRule[] {
  return cloneRules();
}

export function sortRules(a: ImportRule, b: ImportRule, entity: string): number {
  const priority = Number(a.priority || 100) - Number(b.priority || 100);
  if (priority) return priority;
  const aScope = a.entity === entity ? 0 : 1;
  const bScope = b.entity === entity ? 0 : 1;
  if (aScope !== bScope) return aScope - bScope;
  const aSpecific = a.secondaryField ? 0 : 1;
  const bSpecific = b.secondaryField ? 0 : 1;
  if (aSpecific !== bSpecific) return aSpecific - bSpecific;
  return String(a.ruleKey || "").localeCompare(String(b.ruleKey || ""));
}

export function matchesValue(expected: unknown, actual: unknown): boolean {
  return U(expected) === blank ? !U(actual) : U(expected) === U(actual);
}

export function matchingRule(ruleType: ImportRuleType, context: ClassificationContext): ImportRule | null {
  const entity = text(context.entity) || "";
  const erpSource = text(context.erpSource) || "";
  const values = context.values || {};
  return baselineRules()
    .filter(rule => isActive(rule) && rule.ruleType === ruleType)
    .filter(rule => (rule.entity === "*" || rule.entity === entity) && rule.erpSource === erpSource)
    .filter(rule => !rule.requiresBlankField || !U(values[rule.requiresBlankField]))
    .filter(rule => matchesValue(rule.matchValue, values[rule.sourceField]))
    .filter(rule => !rule.secondaryField || matchesValue(rule.secondaryMatchValue, values[rule.secondaryField]))
    .sort((a, b) => sortRules(a, b, entity))[0] || null;
}

export function resolveFunction(context: ClassificationContext): ProcurementFunction | null {
  const rule = matchingRule("function", context);
  return normaliseFunction(rule?.resultValue);
}

export function resolveLocalCurrency(context: ClassificationContext): string | null {
  const rule = matchingRule("localCurrency", context);
  return text(rule?.resultValue)?.toUpperCase() || null;
}

function localCurrencyForBusinessCentral(order: PurchaseOrderContract): string | null {
  return resolveLocalCurrency({
    entity: order.entity,
    erpSource: order.erpSource,
    values: { "Currency Code": "" }
  });
}

export function classificationValues(order: PurchaseOrderContract): Record<string, unknown> {
  return {
    "Purchaser Code": order.erpPurchaserCode,
    "Created By": order.erpCreatedBy,
    "Purchasing Mgr ID": order.erpPurchasingMgrId,
    "HOD ID": order.erpHodId,
    "Currency Code": order.currency
  };
}

export function resolveFunctionForOrder(order: PurchaseOrderContract): ProcurementFunction | null {
  return resolveFunction({
    entity: order.entity,
    erpSource: order.erpSource,
    values: classificationValues(order)
  });
}

function isBusinessCentralOrder(order: PurchaseOrderContract): boolean {
  return text(order.erpSource) === "Business Central";
}

function isPhoenixNavisionOrder(order: PurchaseOrderContract): boolean {
  return text(order.entity) === "Phoenix" && text(order.erpSource) === "Navision";
}

export function classifyOrderType(order: PurchaseOrderContract): OrderType | null {
  if (isPhoenixNavisionOrder(order)) {
    const code = U(order.orderId || order.erpDocumentNo || order.warehouseRecordId);
    if (code.startsWith("FPO")) return "foreign";
    if (code.startsWith("LPO")) return "local";
    return normaliseOrderType(order.orderType);
  }

  if (isBusinessCentralOrder(order)) {
    const localCurrency = localCurrencyForBusinessCentral(order);
    const currency = U(order.currency);
    return (!currency || (localCurrency && currency === localCurrency)) ? "local" : "foreign";
  }

  return normaliseOrderType(order.orderType);
}

export function classifyPurchaseOrder(order: PurchaseOrderContract): PurchaseOrderContract {
  const derivedFunction = resolveFunctionForOrder(order);
  const derivedOrderType = classifyOrderType(order);
  return {
    ...order,
    function: derivedFunction || normaliseFunction(order.function) || order.function,
    orderType: derivedOrderType || normaliseOrderType(order.orderType) || order.orderType
  };
}
