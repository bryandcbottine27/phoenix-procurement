import * as sql from "mssql";
import { queryParams, SqlQueryExecutor, typedParam } from "../sql/client";

export class BackendValidationError extends Error {
  errors: string[];

  constructor(errors: string[]) {
    super(errors[0] || "Validation failed.");
    this.errors = errors;
  }
}

interface DataRow {
  recordId: string;
  dataJson: string;
}

type RecordData = Record<string, unknown>;

function isNum(value: unknown): boolean {
  return value !== null && value !== "" && value !== undefined && !Number.isNaN(Number(value));
}

function num(value: unknown): number {
  return Number(value);
}

export function isSafeLink(url: unknown): boolean {
  if (!url) return true;
  const u = String(url).trim().toLowerCase();
  if (u.startsWith("javascript:") || u.startsWith("data:") || u.startsWith("vbscript:")) return false;
  return /^https?:\/\//.test(u)
    || /^file:/.test(u)
    || /^\\\\/.test(u)
    || /^[a-z]:\\/.test(u)
    || u.includes("sharepoint.com")
    || u.includes("onedrive")
    || u.startsWith("/");
}

async function loadCollection(
  collectionName: string,
  query: SqlQueryExecutor
): Promise<RecordData[]> {
  const result = await query<DataRow>(`
    SELECT
      record_id AS recordId,
      data_json AS dataJson
    FROM dbo.operational_records
    WHERE collection_name = @collection_name
      AND archived = 0;
  `, {
    collection_name: typedParam(sql.NVarChar(80), collectionName)
  });
  return result.recordset.map(row => ({
    ...JSON.parse(row.dataJson || "{}") as RecordData,
    id: row.recordId
  }));
}

function validateOrder(data: RecordData, existing: RecordData | null): string[] {
  const errors: string[] = [];
  if (!String(data.orderId || "").trim()) errors.push("Order number is required.");
  if (!String(data.entity || "").trim()) errors.push("Entity is required.");
  if (!existing && (!String(data.supplier || "").trim() || String(data.supplier || "").trim() === "-")) errors.push("Supplier is required.");
  if (!existing && !String(data.currency || "").trim()) errors.push("Currency is required.");
  if (existing && Object.prototype.hasOwnProperty.call(data, "supplier") && (!String(data.supplier || "").trim() || String(data.supplier || "").trim() === "-")) errors.push("Supplier is required.");
  if (existing && Object.prototype.hasOwnProperty.call(data, "currency") && !String(data.currency || "").trim()) errors.push("Currency is required.");
  if (data.amount !== undefined && data.amount !== null && data.amount !== "" && !isNum(data.amount)) {
    errors.push("Order amount must be a number.");
  }
  if (isNum(data.amount) && num(data.amount) < 0) errors.push("Order amount cannot be negative.");
  return errors;
}

async function validatePayment(data: RecordData, existing: RecordData | null, query: SqlQueryExecutor): Promise<string[]> {
  const errors: string[] = [];
  if (data.amount !== undefined && data.amount !== "" && data.amount !== null && !isNum(data.amount)) {
    errors.push("Payment amount must be a number.");
  }
  if (isNum(data.amount) && num(data.amount) < 0) errors.push("Payment amount cannot be negative.");
  if (isNum(data.amount) && data.orderId) {
    const [orders, payments] = await Promise.all([
      loadCollection("orders", query),
      loadCollection("payment_requests", query)
    ]);
    const order = orders.find(row => String(row.orderId || "") === String(data.orderId || ""));
    if (order && isNum(order.amount)) {
      const existingId = String(existing?.id || data.id || "");
      const others = payments
        .filter(row => String(row.orderId || "") === String(data.orderId || ""))
        .filter(row => String(row.id || "") !== existingId)
        .filter(row => !["rejected", "cancelled"].includes(String(row.status || "")))
        .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
      if (others + num(data.amount) > Number(order.amount) * 1.0001) {
        errors.push(`Total payments (${others + num(data.amount)}) exceed the order value (${order.amount}).`);
      }
    }
  }
  return errors;
}

function validateDocument(data: RecordData): string[] {
  const errors: string[] = [];
  if (!isSafeLink(data.documentUrl)) errors.push("Document link is not a valid or safe URL/path.");
  return errors;
}

export async function validateOperationalWrite(
  collectionName: string,
  data: RecordData,
  existing: RecordData | null = null,
  query: SqlQueryExecutor = queryParams
): Promise<void> {
  let errors: string[] = [];
  if (collectionName === "orders") errors = validateOrder(data, existing);
  else if (collectionName === "payment_requests") errors = await validatePayment(data, existing, query);
  else if (collectionName === "documents") errors = validateDocument(data);
  if (errors.length) throw new BackendValidationError(errors);
}
