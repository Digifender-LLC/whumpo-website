-- Preserve the atomic late-result guard for both accounting paths.
DROP TRIGGER chat_result_open;
CREATE TRIGGER chat_result_open BEFORE UPDATE OF input_tokens,output_tokens ON chat_turns
WHEN OLD.mode='ai' AND (OLD.status!='pending' OR NOT (
 EXISTS(SELECT 1 FROM usage_operations o WHERE o.id=OLD.id AND o.user_id=OLD.user_id AND o.status IN ('dispatched','uncertain'))
 OR EXISTS(SELECT 1 FROM standard_ai_requests s WHERE s.id=OLD.id AND s.user_id=OLD.user_id AND s.state IN ('dispatched','uncertain'))))
BEGIN SELECT RAISE(ABORT,'chat_result_closed'); END;
