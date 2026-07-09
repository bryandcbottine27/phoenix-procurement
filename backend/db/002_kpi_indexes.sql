IF NOT EXISTS (
  SELECT 1
    FROM sys.indexes
   WHERE name = N'IX_orders_entity_date'
     AND object_id = OBJECT_ID(N'dbo.orders')
)
BEGIN
  CREATE INDEX IX_orders_entity_date
    ON dbo.orders (entity, date_of_order)
    INCLUDE (amount, currency, erp_po_status, is_closed);
END;
GO

IF NOT EXISTS (
  SELECT 1
    FROM sys.indexes
   WHERE name = N'IX_orders_procurement_function'
     AND object_id = OBJECT_ID(N'dbo.orders')
)
BEGIN
  CREATE INDEX IX_orders_procurement_function
    ON dbo.orders (procurement_function)
    INCLUDE (entity, date_of_order, amount, currency);
END;
GO

IF NOT EXISTS (
  SELECT 1
    FROM sys.indexes
   WHERE name = N'IX_orders_order_type'
     AND object_id = OBJECT_ID(N'dbo.orders')
)
BEGIN
  CREATE INDEX IX_orders_order_type
    ON dbo.orders (order_type)
    INCLUDE (entity, date_of_order, amount, currency);
END;
GO

IF NOT EXISTS (
  SELECT 1
    FROM sys.indexes
   WHERE name = N'IX_orders_erp_po_status'
     AND object_id = OBJECT_ID(N'dbo.orders')
)
BEGIN
  CREATE INDEX IX_orders_erp_po_status
    ON dbo.orders (erp_po_status, is_closed)
    INCLUDE (entity, date_of_order, amount, currency);
END;
GO

IF NOT EXISTS (
  SELECT 1
    FROM sys.indexes
   WHERE name = N'IX_orders_requested_receipt'
     AND object_id = OBJECT_ID(N'dbo.orders')
)
BEGIN
  CREATE INDEX IX_orders_requested_receipt
    ON dbo.orders (is_closed, requested_receipt_date)
    INCLUDE (entity, amount, currency);
END;
GO

IF NOT EXISTS (
  SELECT 1
    FROM sys.indexes
   WHERE name = N'IX_sync_exceptions_status_entity'
     AND object_id = OBJECT_ID(N'dbo.sync_exceptions')
)
BEGIN
  CREATE INDEX IX_sync_exceptions_status_entity
    ON dbo.sync_exceptions (status, entity, created_at);
END;
GO

IF NOT EXISTS (
  SELECT 1
    FROM sys.indexes
   WHERE name = N'IX_import_audit_started_at'
     AND object_id = OBJECT_ID(N'dbo.import_audit')
)
BEGIN
  CREATE INDEX IX_import_audit_started_at
    ON dbo.import_audit (started_at DESC)
    INCLUDE (batch_id, finished_at, created_count, updated_count, exception_count);
END;
GO
