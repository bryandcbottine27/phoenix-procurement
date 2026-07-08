export function sqlConnectionString(): string {
  return process.env.SQL_CONNECTION_STRING || "";
}

export function requireSqlConnectionString(): string {
  const value = sqlConnectionString();
  if (!value.trim()) {
    throw new Error("SQL_CONNECTION_STRING is not configured.");
  }
  return value;
}
