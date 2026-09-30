-- Existing welcome rows resume at the first question in their saved chapter.
-- NULL also allows the previous Worker to keep saving its three-stage flow during rollout.
ALTER TABLE welcome_onboarding ADD COLUMN prompt TEXT
 CHECK(prompt IS NULL OR prompt IN ('name','picture','bio','idea','project-name','audience','style','review'));
