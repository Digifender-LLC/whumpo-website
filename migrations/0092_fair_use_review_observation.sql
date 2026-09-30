-- Existing review scope remains intact; old cases explicitly lack a snapshot.
ALTER TABLE fair_use_reviews ADD COLUMN observation_json TEXT
 CHECK(observation_json IS NULL OR (length(observation_json)<=8192 AND json_valid(observation_json) AND json_type(observation_json)='object'));
CREATE TRIGGER fair_use_review_observation_insert BEFORE INSERT ON fair_use_reviews BEGIN
 SELECT RAISE(ABORT,'review_observation_required') WHERE NEW.observation_json IS NULL
  OR json_extract(NEW.observation_json,'$.version') IS NOT 1
  OR json_extract(NEW.observation_json,'$.entitlement.planId') IS NOT NEW.plan_id
  OR json_type(NEW.observation_json,'$.metrics') IS NOT 'object'
  OR json_type(NEW.observation_json,'$.asOf') IS NOT 'text';
END;
CREATE TRIGGER fair_use_review_observation_update BEFORE UPDATE ON fair_use_reviews BEGIN
 SELECT RAISE(ABORT,'immutable_review_observation') WHERE NEW.observation_json IS NOT OLD.observation_json;
END;
