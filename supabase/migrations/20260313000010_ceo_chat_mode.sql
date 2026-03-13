-- Add 'ceo' to ai_threads and ai_prompts mode CHECK constraints
-- so CEO Dashboard chat can store threads/messages in the same tables as Intelligence.

ALTER TABLE ai_threads DROP CONSTRAINT IF EXISTS ai_threads_mode_check;
ALTER TABLE ai_threads ADD CONSTRAINT ai_threads_mode_check
  CHECK (mode IN ('review', 'chat', 'ceo'));

ALTER TABLE ai_prompts DROP CONSTRAINT IF EXISTS ai_prompts_mode_check;
ALTER TABLE ai_prompts ADD CONSTRAINT ai_prompts_mode_check
  CHECK (mode IN ('review', 'chat', 'ceo'));
