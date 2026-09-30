-- An operator account cascade can visit receipts before its projects. Retain
-- receipts while both parents exist; permit cleanup only after a parent is gone.
DROP TRIGGER project_spec_apply_retained;
CREATE TRIGGER project_spec_apply_retained BEFORE DELETE ON project_spec_applies
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
 AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'specification_receipt_retained'); END;
