IF OBJECT_ID(N'dbo.app_counters', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_counters (
    counter_key NVARCHAR(160) NOT NULL CONSTRAINT PK_app_counters PRIMARY KEY,
    value INT NOT NULL CONSTRAINT DF_app_counters_value DEFAULT (0),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_app_counters_updated_at DEFAULT SYSUTCDATETIME(),
    updated_by NVARCHAR(120) NULL
  );
END;
GO
