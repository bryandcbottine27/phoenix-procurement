IF OBJECT_ID(N'dbo.orders', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.orders (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_orders PRIMARY KEY,
    entity NVARCHAR(120) NOT NULL,
    order_id NVARCHAR(120) NOT NULL,
    erp_source NVARCHAR(80) NULL,
    erp_company NVARCHAR(120) NULL,
    erp_entity_id NVARCHAR(120) NULL,
    erp_document_id NVARCHAR(160) NULL,
    erp_document_no NVARCHAR(120) NULL,
    erp_vendor_no NVARCHAR(120) NULL,
    erp_vendor_name NVARCHAR(255) NULL,
    supplier NVARCHAR(255) NULL,
    order_type NVARCHAR(40) NULL,
    procurement_function NVARCHAR(40) NULL,
    currency NVARCHAR(10) NULL,
    amount DECIMAL(18,4) NULL,
    date_of_order DATE NULL,
    description NVARCHAR(MAX) NULL,
    payment_terms NVARCHAR(120) NULL,
    category NVARCHAR(120) NULL,
    ipr_number NVARCHAR(120) NULL,
    ipr_approved_date DATE NULL,
    claimant NVARCHAR(255) NULL,
    requested_receipt_date DATE NULL,
    erp_po_status NVARCHAR(80) NULL,
    erp_amount DECIMAL(18,4) NULL,
    erp_currency NVARCHAR(10) NULL,
    erp_hod_id NVARCHAR(120) NULL,
    erp_purchasing_mgr_id NVARCHAR(120) NULL,
    erp_created_from_ipr NVARCHAR(120) NULL,
    erp_created_by NVARCHAR(255) NULL,
    erp_purchaser_code NVARCHAR(120) NULL,
    erp_shipment_method NVARCHAR(120) NULL,
    lines_json NVARCHAR(MAX) NULL,
    integration_layer NVARCHAR(80) NULL,
    warehouse_source NVARCHAR(255) NULL,
    warehouse_record_id NVARCHAR(255) NULL,
    warehouse_batch_id NVARCHAR(120) NULL,
    warehouse_extracted_at DATETIME2(3) NULL,
    warehouse_loaded_at DATETIME2(3) NULL,
    warehouse_hash NVARCHAR(255) NULL,
    erp_sync_status NVARCHAR(40) NULL,
    erp_last_synced_at DATETIME2(3) NULL,
    erp_sync_error NVARCHAR(MAX) NULL,
    last_refresh_changes_json NVARCHAR(MAX) NULL,
    last_refresh_at DATETIME2(3) NULL,

    -- Phoenix-owned operational columns. Warehouse sync must not overwrite these on update.
    status NVARCHAR(120) NULL,
    is_closed BIT NOT NULL CONSTRAINT DF_orders_is_closed DEFAULT (0),
    phoenix_data NVARCHAR(MAX) NOT NULL CONSTRAINT DF_orders_phoenix_data DEFAULT (N'{}'),

    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_orders_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_orders_updated_at DEFAULT SYSUTCDATETIME(),
    row_version ROWVERSION NOT NULL,
    CONSTRAINT CK_orders_lines_json CHECK (lines_json IS NULL OR ISJSON(lines_json) = 1),
    CONSTRAINT CK_orders_last_refresh_changes_json CHECK (last_refresh_changes_json IS NULL OR ISJSON(last_refresh_changes_json) = 1),
    CONSTRAINT CK_orders_phoenix_data_json CHECK (ISJSON(phoenix_data) = 1)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.orders') AND name = N'UX_orders_entity_order_id'
)
BEGIN
  CREATE UNIQUE INDEX UX_orders_entity_order_id ON dbo.orders(entity, order_id);
END;
GO

IF OBJECT_ID(N'dbo.TR_orders_set_updated_at', N'TR') IS NULL
EXEC(N'
CREATE TRIGGER dbo.TR_orders_set_updated_at
ON dbo.orders
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE o
     SET updated_at = SYSUTCDATETIME()
    FROM dbo.orders o
    INNER JOIN inserted i ON i.id = o.id;
END;
');
GO

IF OBJECT_ID(N'dbo.sync_exceptions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.sync_exceptions (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sync_exceptions PRIMARY KEY,
    batch_id NVARCHAR(120) NULL,
    entity NVARCHAR(120) NULL,
    order_id NVARCHAR(120) NULL,
    warehouse_record_id NVARCHAR(255) NULL,
    error_code NVARCHAR(80) NOT NULL,
    error_message NVARCHAR(MAX) NOT NULL,
    payload_json NVARCHAR(MAX) NULL,
    status NVARCHAR(40) NOT NULL CONSTRAINT DF_sync_exceptions_status DEFAULT (N'open'),
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_sync_exceptions_created_at DEFAULT SYSUTCDATETIME(),
    resolved_at DATETIME2(3) NULL,
    CONSTRAINT CK_sync_exceptions_payload_json CHECK (payload_json IS NULL OR ISJSON(payload_json) = 1)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.sync_exceptions') AND name = N'IX_sync_exceptions_batch'
)
BEGIN
  CREATE INDEX IX_sync_exceptions_batch ON dbo.sync_exceptions(batch_id, status);
END;
GO

IF OBJECT_ID(N'dbo.import_audit', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.import_audit (
    batch_id NVARCHAR(120) NOT NULL CONSTRAINT PK_import_audit PRIMARY KEY,
    warehouse_source NVARCHAR(255) NULL,
    started_at DATETIME2(3) NOT NULL CONSTRAINT DF_import_audit_started_at DEFAULT SYSUTCDATETIME(),
    finished_at DATETIME2(3) NULL,
    status NVARCHAR(40) NOT NULL CONSTRAINT DF_import_audit_status DEFAULT (N'running'),
    fetched_count INT NOT NULL CONSTRAINT DF_import_audit_fetched_count DEFAULT (0),
    normalized_count INT NOT NULL CONSTRAINT DF_import_audit_normalized_count DEFAULT (0),
    created_count INT NOT NULL CONSTRAINT DF_import_audit_created_count DEFAULT (0),
    updated_count INT NOT NULL CONSTRAINT DF_import_audit_updated_count DEFAULT (0),
    exception_count INT NOT NULL CONSTRAINT DF_import_audit_exception_count DEFAULT (0),
    details_json NVARCHAR(MAX) NULL,
    CONSTRAINT CK_import_audit_details_json CHECK (details_json IS NULL OR ISJSON(details_json) = 1)
  );
END;
GO
