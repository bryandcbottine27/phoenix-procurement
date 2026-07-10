IF OBJECT_ID(N'dbo.operational_records', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.operational_records (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_operational_records PRIMARY KEY,
    collection_name NVARCHAR(80) NOT NULL,
    record_id NVARCHAR(120) NOT NULL,
    entity NVARCHAR(120) NULL,
    data_json NVARCHAR(MAX) NOT NULL,
    archived BIT NOT NULL CONSTRAINT DF_operational_records_archived DEFAULT (0),
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_operational_records_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_operational_records_updated_at DEFAULT SYSUTCDATETIME(),
    row_version ROWVERSION NOT NULL,
    CONSTRAINT UX_operational_records_collection_record UNIQUE (collection_name, record_id),
    CONSTRAINT CK_operational_records_data_json CHECK (ISJSON(data_json) = 1)
  );
END;
GO

IF OBJECT_ID(N'dbo.TR_operational_records_set_updated_at', N'TR') IS NULL
EXEC(N'
CREATE TRIGGER dbo.TR_operational_records_set_updated_at
ON dbo.operational_records
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE target
     SET updated_at = SYSUTCDATETIME()
    FROM dbo.operational_records target
    INNER JOIN inserted i ON i.id = target.id;
END;
');
GO

IF NOT EXISTS (
  SELECT 1
    FROM sys.indexes
   WHERE name = N'IX_operational_records_collection_archived'
     AND object_id = OBJECT_ID(N'dbo.operational_records')
)
BEGIN
  CREATE INDEX IX_operational_records_collection_archived
    ON dbo.operational_records (collection_name, archived, updated_at DESC)
    INCLUDE (record_id, entity);
END;
GO

IF NOT EXISTS (
  SELECT 1
    FROM sys.indexes
   WHERE name = N'IX_operational_records_entity'
     AND object_id = OBJECT_ID(N'dbo.operational_records')
)
BEGIN
  CREATE INDEX IX_operational_records_entity
    ON dbo.operational_records (entity, collection_name)
    INCLUDE (record_id, archived, updated_at);
END;
GO
