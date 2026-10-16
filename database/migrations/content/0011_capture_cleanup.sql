-- One durable cursor bounds each storage reconciliation; CAS prevents overlapping scans from rewinding progress.
CREATE TABLE publish_capture_cleanup (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0), cursor TEXT CHECK(cursor IS NULL OR length(cursor) BETWEEN 1 AND 4096), updated_at TEXT, deleted_count INTEGER NOT NULL DEFAULT 0 CHECK(deleted_count BETWEEN 0 AND 20));
INSERT INTO publish_capture_cleanup(id) VALUES(1);
CREATE TRIGGER publish_capture_cleanup_audit AFTER UPDATE ON publish_capture_cleanup WHEN NEW.deleted_count > 0 BEGIN INSERT INTO audit_log(actor,action,entity,created_at) VALUES('system:publish-retention','publish.capture.reconciled','publishing',NEW.updated_at); END;
