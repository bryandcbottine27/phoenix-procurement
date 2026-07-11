IF NOT EXISTS (
  SELECT 1
    FROM sys.indexes
   WHERE name = N'IX_orders_updated_at'
     AND object_id = OBJECT_ID(N'dbo.orders')
)
BEGIN
  CREATE INDEX IX_orders_updated_at
    ON dbo.orders (updated_at DESC)
    INCLUDE (entity, order_id, erp_po_status, status, is_closed);
END;
GO

IF NOT EXISTS (
  SELECT 1
    FROM sys.indexes
   WHERE name = N'IX_operational_records_orders_merge'
     AND object_id = OBJECT_ID(N'dbo.operational_records')
)
BEGIN
  CREATE INDEX IX_operational_records_orders_merge
    ON dbo.operational_records (collection_name, archived, entity, updated_at DESC)
    INCLUDE (record_id)
    WHERE collection_name = N'orders';
END;
GO
