IF OBJECT_ID(N'dbo.notification_state', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.notification_state (
    alert_key NVARCHAR(64) NOT NULL CONSTRAINT PK_notification_state PRIMARY KEY,
    alert_type NVARCHAR(80) NOT NULL,
    entity NVARCHAR(120) NOT NULL,
    order_id NVARCHAR(120) NOT NULL,
    recipient_email NVARCHAR(320) NOT NULL,
    first_seen_at DATETIME2(3) NOT NULL CONSTRAINT DF_notification_state_first_seen_at DEFAULT SYSUTCDATETIME(),
    last_seen_at DATETIME2(3) NOT NULL CONSTRAINT DF_notification_state_last_seen_at DEFAULT SYSUTCDATETIME(),
    last_sent_at DATETIME2(3) NULL,
    send_count INT NOT NULL CONSTRAINT DF_notification_state_send_count DEFAULT (0),
    last_status NVARCHAR(40) NOT NULL CONSTRAINT DF_notification_state_last_status DEFAULT (N'sent'),
    last_error NVARCHAR(MAX) NULL,
    CONSTRAINT CK_notification_state_alert_key CHECK (LEN(alert_key) = 64)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1
    FROM sys.indexes
   WHERE name = N'IX_notification_state_recipient_seen'
     AND object_id = OBJECT_ID(N'dbo.notification_state')
)
BEGIN
  CREATE INDEX IX_notification_state_recipient_seen
    ON dbo.notification_state (recipient_email, last_seen_at DESC)
    INCLUDE (alert_type, entity, order_id, last_sent_at, send_count, last_status);
END;
GO

IF NOT EXISTS (
  SELECT 1
    FROM sys.indexes
   WHERE name = N'IX_notification_state_status_sent'
     AND object_id = OBJECT_ID(N'dbo.notification_state')
)
BEGIN
  CREATE INDEX IX_notification_state_status_sent
    ON dbo.notification_state (last_status, last_sent_at DESC)
    INCLUDE (recipient_email, alert_type, entity, order_id);
END;
GO
