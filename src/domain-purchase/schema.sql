-- WH-194 domain purchase storage (current schema input; contract: docs/domain-purchases.md, source: src/domain-purchase/).
-- Quotes, exact reviews, orders, funding holds, attempts, registrar events, registrations and the owner's registrant contact.
-- The contract predicates that SQL can see are repeated here, so a caller that skips the module still cannot create two orders
-- for a name, register twice, move an order backwards, or settle a hold except through its order. Not enforced here: the server-resolved project
-- revision and funding source (bound by the consenting statement, re-checked by dispatch in code) and the authenticated evidence that ends an unknown outcome. Times are epoch
-- milliseconds. An owner column is a plain copy of projects.owner_user_id (a trigger checks it), so these tables reach a tenant
-- through project_id like module_records. Nothing here calls a registrar or a payment provider: a hold row is a ledger entry
-- for the reviewed amount, not a card authorization, and no auth code, registrar credential or card data has a column.
CREATE TABLE domain_quotes (
 quote_id TEXT PRIMARY KEY CHECK(quote_id GLOB '[A-Za-z0-9]*' AND length(quote_id) BETWEEN 1 AND 128 AND quote_id NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 owner_user_id TEXT NOT NULL CHECK(length(owner_user_id) BETWEEN 1 AND 128),
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 hostname TEXT NOT NULL CHECK(length(hostname) BETWEEN 3 AND 253 AND hostname=lower(hostname) AND hostname NOT GLOB '*[^a-z0-9.-]*' AND hostname GLOB '[a-z0-9]*' AND hostname GLOB '*.[a-z][a-z]*' AND hostname GLOB '*[a-z]' AND hostname NOT GLOB '*.*.*' AND hostname NOT GLOB '*-.*' AND hostname NOT GLOB '*.-*' AND hostname NOT GLOB '*..*' AND hostname NOT GLOB '*-'),
 quote_json TEXT NOT NULL CHECK(json_valid(quote_json) AND length(quote_json)<=6144),
 quote_digest TEXT NOT NULL CHECK(length(quote_digest)=64 AND quote_digest NOT GLOB '*[^0-9a-f]*'),
 quoted_at INTEGER NOT NULL CHECK(typeof(quoted_at)='integer' AND quoted_at>0),
 expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at>quoted_at AND expires_at<=quoted_at+900000)
) STRICT;
CREATE INDEX domain_quotes_project ON domain_quotes(project_id,quoted_at);
CREATE INDEX domain_quotes_expiry ON domain_quotes(expires_at);

-- The review is the exact thing the owner consents to; it repeats the quote's identity so the order can be checked against it.
CREATE TABLE domain_reviews (
 review_id TEXT PRIMARY KEY CHECK(review_id GLOB '[A-Za-z0-9]*' AND length(review_id) BETWEEN 1 AND 128 AND review_id NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 quote_id TEXT NOT NULL UNIQUE REFERENCES domain_quotes(quote_id) ON DELETE CASCADE,
 quote_digest TEXT NOT NULL CHECK(length(quote_digest)=64 AND quote_digest NOT GLOB '*[^0-9a-f]*'),
 owner_user_id TEXT NOT NULL CHECK(length(owner_user_id) BETWEEN 1 AND 128),
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 project_revision INTEGER NOT NULL CHECK(typeof(project_revision)='integer' AND project_revision>=0),
 hostname TEXT NOT NULL CHECK(length(hostname) BETWEEN 3 AND 253 AND hostname=lower(hostname) AND hostname NOT GLOB '*[^a-z0-9.-]*' AND hostname GLOB '[a-z0-9]*' AND hostname GLOB '*.[a-z][a-z]*' AND hostname GLOB '*[a-z]' AND hostname NOT GLOB '*.*.*' AND hostname NOT GLOB '*-.*' AND hostname NOT GLOB '*.-*' AND hostname NOT GLOB '*..*' AND hostname NOT GLOB '*-'),
 funding_source_id TEXT NOT NULL CHECK(length(funding_source_id) BETWEEN 1 AND 128),
 consent_text_digest TEXT NOT NULL CHECK(length(consent_text_digest)=64 AND consent_text_digest NOT GLOB '*[^0-9a-f]*'),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0),
 expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at>created_at AND expires_at<=created_at+600000)
) STRICT;
CREATE INDEX domain_reviews_project ON domain_reviews(project_id,created_at);
CREATE INDEX domain_reviews_expiry ON domain_reviews(expires_at);
CREATE TRIGGER domain_quotes_admit BEFORE INSERT ON domain_quotes BEGIN
 SELECT RAISE(ABORT,'domain_quote_scope') WHERE NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.owner_user_id)
  OR json_extract(NEW.quote_json,'$.quoteId') IS NOT NEW.quote_id OR json_extract(NEW.quote_json,'$.ownerId') IS NOT NEW.owner_user_id
  OR json_extract(NEW.quote_json,'$.projectId') IS NOT NEW.project_id OR json_extract(NEW.quote_json,'$.hostname') IS NOT NEW.hostname
  OR json_extract(NEW.quote_json,'$.quotedAt') IS NOT NEW.quoted_at OR json_extract(NEW.quote_json,'$.expiresAt') IS NOT NEW.expires_at
  OR json_extract(NEW.quote_json,'$.contractVersion') IS NOT 1 OR json_extract(NEW.quote_json,'$.operation') IS NOT 'register'
  OR json_extract(NEW.quote_json,'$.autoRenew') IS NOT 0 OR json_extract(NEW.quote_json,'$.premium') IS NOT 0
  OR json_extract(NEW.quote_json,'$.funding.sourceKind') IS NOT 'payment-method' OR json_extract(NEW.quote_json,'$.funding.benefitCents') IS NOT 0
  OR json_extract(NEW.quote_json,'$.funding.customerChargeCents') IS NOT json_extract(NEW.quote_json,'$.initial.totalCents')
  OR json_extract(NEW.quote_json,'$.funding.customerChargeCents') NOT BETWEEN 1 AND 100000;
END;
CREATE TRIGGER domain_quotes_frozen BEFORE UPDATE ON domain_quotes BEGIN SELECT RAISE(ABORT,'domain_quote_frozen'); END;
CREATE TRIGGER domain_reviews_admit BEFORE INSERT ON domain_reviews BEGIN
 SELECT RAISE(ABORT,'domain_review_scope') WHERE NOT EXISTS(SELECT 1 FROM domain_quotes q WHERE q.quote_id=NEW.quote_id AND q.quote_digest=NEW.quote_digest
   AND q.owner_user_id=NEW.owner_user_id AND q.project_id=NEW.project_id AND q.hostname=NEW.hostname AND q.expires_at>NEW.created_at
   AND NEW.expires_at<=q.expires_at AND json_extract(q.quote_json,'$.funding.sourceId') IS NEW.funding_source_id);
END;
CREATE TRIGGER domain_reviews_frozen BEFORE UPDATE ON domain_reviews BEGIN SELECT RAISE(ABORT,'domain_review_frozen'); END;

-- The owner's registrant contact for one review (ICANN Registration Data Policy elements only, entered for this purchase, redacted in
-- public RDDS). Personal data: never in model context, logs or Chat history; the owner's own contact may appear in the owner's own export (docs/data-lifecycle.json) and nowhere else. Erased when the order fails, is cancelled or expires, and when the registration is transferred out or lapses; an unused draft is pruned.
CREATE TABLE domain_registrant_contacts (
 review_id TEXT PRIMARY KEY REFERENCES domain_reviews(review_id) ON DELETE CASCADE,
 owner_user_id TEXT NOT NULL CHECK(length(owner_user_id) BETWEEN 1 AND 128),
 contact_name TEXT NOT NULL CHECK(length(contact_name) BETWEEN 1 AND 128),
 organization TEXT CHECK(organization IS NULL OR length(organization) BETWEEN 1 AND 128),
 street TEXT NOT NULL CHECK(length(street) BETWEEN 1 AND 200),
 city TEXT NOT NULL CHECK(length(city) BETWEEN 1 AND 100),
 region TEXT CHECK(region IS NULL OR length(region) BETWEEN 1 AND 100),
 postal_code TEXT CHECK(postal_code IS NULL OR length(postal_code) BETWEEN 1 AND 32),
 country TEXT NOT NULL CHECK(length(country)=2 AND country=upper(country) AND country NOT GLOB '*[^A-Z]*'),
 phone TEXT NOT NULL CHECK(length(phone) BETWEEN 5 AND 32 AND phone NOT GLOB '*[^0-9+. ()-]*'),
 email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 254 AND email GLOB '*?@?*'),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0)
) STRICT;
CREATE TRIGGER domain_registrant_contacts_admit BEFORE INSERT ON domain_registrant_contacts BEGIN
 SELECT RAISE(ABORT,'domain_contact_scope') WHERE NOT EXISTS(SELECT 1 FROM domain_reviews WHERE review_id=NEW.review_id AND owner_user_id=NEW.owner_user_id AND expires_at>NEW.created_at)
  OR EXISTS(SELECT 1 FROM domain_orders WHERE review_id=NEW.review_id);
END;
CREATE TRIGGER domain_registrant_contacts_frozen BEFORE UPDATE ON domain_registrant_contacts BEGIN SELECT RAISE(ABORT,'domain_contact_frozen'); END;

-- One order per exact review (idempotency_key is SHA-256 over owner, project, hostname, review and quote digest). The partial unique
-- index allows one order per name that is not failed, cancelled or expired, so a second review, tab or tenant cannot run in parallel
-- and a registered name cannot be ordered again. version is the compare-and-set counter of every transition.
CREATE TABLE domain_orders (
 order_id TEXT PRIMARY KEY CHECK(order_id GLOB '[A-Za-z0-9]*' AND length(order_id) BETWEEN 1 AND 100 AND order_id NOT GLOB '*[^A-Za-z0-9_.-]*'),
 idempotency_key TEXT NOT NULL UNIQUE CHECK(length(idempotency_key)=64 AND idempotency_key NOT GLOB '*[^0-9a-f]*'),
 review_id TEXT NOT NULL UNIQUE REFERENCES domain_reviews(review_id) ON DELETE CASCADE,
 quote_id TEXT NOT NULL REFERENCES domain_quotes(quote_id) ON DELETE CASCADE,
 quote_digest TEXT NOT NULL CHECK(length(quote_digest)=64 AND quote_digest NOT GLOB '*[^0-9a-f]*'),
 owner_user_id TEXT NOT NULL CHECK(length(owner_user_id) BETWEEN 1 AND 128),
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 hostname TEXT NOT NULL CHECK(length(hostname) BETWEEN 3 AND 253 AND hostname=lower(hostname) AND hostname NOT GLOB '*[^a-z0-9.-]*' AND hostname GLOB '[a-z0-9]*' AND hostname GLOB '*.[a-z][a-z]*' AND hostname GLOB '*[a-z]' AND hostname NOT GLOB '*.*.*' AND hostname NOT GLOB '*-.*' AND hostname NOT GLOB '*.-*' AND hostname NOT GLOB '*..*' AND hostname NOT GLOB '*-'),
 state TEXT NOT NULL CHECK(state IN ('consented','reserved','dispatching','registered','failed','unknown-outcome','unresolved','cancelled','expired')),
 history_json TEXT NOT NULL CHECK(json_valid(history_json) AND length(history_json)<=2048),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(typeof(attempts)='integer' AND attempts BETWEEN 0 AND 1),
 attempt_id TEXT CHECK(attempt_id IS NULL OR length(attempt_id) BETWEEN 1 AND 128),
 attempt_started_at INTEGER CHECK(attempt_started_at IS NULL OR (typeof(attempt_started_at)='integer' AND attempt_started_at>0)),
 reconcile_reads INTEGER NOT NULL DEFAULT 0 CHECK(typeof(reconcile_reads)='integer' AND reconcile_reads BETWEEN 0 AND 3),
 uncertain_at INTEGER CHECK(uncertain_at IS NULL OR (typeof(uncertain_at)='integer' AND uncertain_at>0)),
 registration_expires_at INTEGER CHECK(registration_expires_at IS NULL OR (typeof(registration_expires_at)='integer' AND registration_expires_at>0)),
 charge_mismatch INTEGER CHECK(charge_mismatch IS NULL OR charge_mismatch IN (0,1)),
 consented_at INTEGER NOT NULL CHECK(typeof(consented_at)='integer' AND consented_at>0),
 updated_at INTEGER NOT NULL CHECK(typeof(updated_at)='integer' AND updated_at>=consented_at),
 version INTEGER NOT NULL DEFAULT 0 CHECK(typeof(version)='integer' AND version>=0),
 released INTEGER NOT NULL DEFAULT 0 CHECK(released IN (0,1)),
 CHECK(state!='dispatching' OR (attempt_id IS NOT NULL AND attempt_started_at IS NOT NULL)),
 CHECK(state NOT IN ('unknown-outcome','unresolved') OR (attempt_id IS NOT NULL AND uncertain_at IS NOT NULL)),
 CHECK(attempts=0 OR attempt_id IS NOT NULL),
 CHECK(state!='registered' OR attempt_id IS NOT NULL)
) STRICT;
-- A registered order stops holding the name once its registration is transferred out or lapses (released), so the name can be bought again.
CREATE UNIQUE INDEX domain_orders_active_name ON domain_orders(hostname) WHERE state NOT IN ('failed','cancelled','expired') AND released=0;
CREATE INDEX domain_orders_project ON domain_orders(project_id,consented_at);
CREATE INDEX domain_orders_owner ON domain_orders(owner_user_id,state);
CREATE INDEX domain_orders_open ON domain_orders(state,updated_at) WHERE state IN ('reserved','dispatching','unknown-outcome','unresolved');
CREATE INDEX domain_orders_quote ON domain_orders(quote_id);

-- Consent: the order must repeat its review and quote exactly, the review must not have expired and a consent starts a clean order.
-- The funding source and project revision the server resolves are bound by the inserting statement (src/domain-purchase/store.ts).
CREATE TRIGGER domain_orders_admit BEFORE INSERT ON domain_orders BEGIN
 SELECT RAISE(ABORT,'domain_order_scope') WHERE NOT EXISTS(SELECT 1 FROM domain_reviews r JOIN domain_quotes q ON q.quote_id=r.quote_id
   WHERE r.review_id=NEW.review_id AND r.quote_id=NEW.quote_id AND r.quote_digest=NEW.quote_digest AND q.quote_digest=NEW.quote_digest
   AND r.owner_user_id=NEW.owner_user_id AND r.project_id=NEW.project_id AND r.hostname=NEW.hostname
   AND NEW.consented_at<r.expires_at AND NEW.consented_at<q.expires_at AND NEW.consented_at>=r.created_at)
  OR NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.owner_user_id);
 SELECT RAISE(ABORT,'domain_order_state') WHERE NEW.state!='consented' OR NEW.attempts!=0 OR NEW.attempt_id IS NOT NULL OR NEW.attempt_started_at IS NOT NULL
  OR NEW.reconcile_reads!=0 OR NEW.uncertain_at IS NOT NULL OR NEW.registration_expires_at IS NOT NULL OR NEW.charge_mismatch IS NOT NULL
  OR NEW.version!=0 OR NEW.released!=0 OR NEW.updated_at!=NEW.consented_at OR NEW.history_json IS NOT '["quoted","consented"]';
END;
-- Transitions: only the contract's edges, identity never changes, and every change moves the version by one. Nothing re-enters
-- dispatching, so the attempt table below holds at most one register claim per order.
CREATE TRIGGER domain_orders_transition BEFORE UPDATE ON domain_orders BEGIN
 SELECT RAISE(ABORT,'domain_order_identity') WHERE NEW.order_id IS NOT OLD.order_id OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.review_id IS NOT OLD.review_id
  OR NEW.quote_id IS NOT OLD.quote_id OR NEW.quote_digest IS NOT OLD.quote_digest OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.hostname IS NOT OLD.hostname OR NEW.consented_at IS NOT OLD.consented_at;
 SELECT RAISE(ABORT,'domain_order_version') WHERE NEW.version IS NOT OLD.version+1 OR NEW.updated_at<OLD.updated_at;
 SELECT RAISE(ABORT,'domain_order_transition') WHERE NEW.state IS NOT OLD.state AND NOT (
   (OLD.state='consented' AND NEW.state IN ('reserved','expired','cancelled'))
   OR (OLD.state='reserved' AND NEW.state IN ('dispatching','expired','cancelled'))
   OR (OLD.state='dispatching' AND NEW.state IN ('registered','failed','unknown-outcome'))
   OR (OLD.state='unknown-outcome' AND NEW.state IN ('registered','failed','unresolved'))
   OR (OLD.state='unresolved' AND NEW.state IN ('registered','failed')));
 SELECT RAISE(ABORT,'domain_order_dispatch') WHERE NEW.state='dispatching' AND OLD.state!='dispatching' AND (OLD.attempts!=0 OR NEW.attempts!=1 OR NEW.attempt_id IS NOT OLD.order_id||':a1' OR NEW.attempt_started_at IS NULL);
 SELECT RAISE(ABORT,'domain_order_attempt') WHERE NEW.attempts IS NOT OLD.attempts AND NOT (OLD.state='reserved' AND NEW.state='dispatching')
  OR (NEW.attempt_id IS NOT OLD.attempt_id AND NOT (OLD.state='reserved' AND NEW.state='dispatching'))
  OR (NEW.attempt_started_at IS NOT OLD.attempt_started_at AND NOT (OLD.state='reserved' AND NEW.state='dispatching'));
 SELECT RAISE(ABORT,'domain_order_reconcile') WHERE NEW.reconcile_reads<OLD.reconcile_reads OR NEW.reconcile_reads>OLD.reconcile_reads+1
  OR (NEW.reconcile_reads!=OLD.reconcile_reads AND OLD.state!='unknown-outcome')
  OR (NEW.uncertain_at IS NOT OLD.uncertain_at AND NOT (NEW.state='unknown-outcome' AND OLD.state='dispatching'));
 -- Release drops the name from the one-active-order index, so it is allowed only for a registered order whose registration left (never a pending order).
 SELECT RAISE(ABORT,'domain_order_release') WHERE NEW.released IS NOT OLD.released AND NOT (OLD.state='registered' AND NEW.state='registered' AND OLD.released=0 AND NEW.released=1
  AND EXISTS(SELECT 1 FROM domain_registrations g WHERE g.order_id=OLD.order_id AND g.state IN ('transferred-out','lapsed')));
 SELECT RAISE(ABORT,'domain_order_registration') WHERE (NEW.registration_expires_at IS NOT OLD.registration_expires_at AND NOT (NEW.state='registered' AND OLD.state!='registered'))
  OR (NEW.charge_mismatch IS NOT OLD.charge_mismatch AND NOT (NEW.state='registered' AND OLD.state!='registered'));
END;
CREATE TRIGGER domain_orders_final BEFORE UPDATE ON domain_orders WHEN OLD.state IN ('registered','failed','cancelled','expired') AND NOT (OLD.state='registered' AND OLD.released=0 AND NEW.released=1
 AND EXISTS(SELECT 1 FROM domain_registrations g WHERE g.order_id=OLD.order_id AND g.state IN ('transferred-out','lapsed'))
 AND NEW.state=OLD.state AND NEW.history_json=OLD.history_json AND NEW.attempts=OLD.attempts AND NEW.attempt_id IS OLD.attempt_id AND NEW.uncertain_at IS OLD.uncertain_at
 AND NEW.reconcile_reads=OLD.reconcile_reads AND NEW.registration_expires_at IS OLD.registration_expires_at AND NEW.charge_mismatch IS OLD.charge_mismatch) BEGIN SELECT RAISE(ABORT,'domain_order_final'); END;
-- A dispatch needs a live quote: the claim cannot be written after the quote expired, whoever writes it.
CREATE TRIGGER domain_orders_dispatch_live BEFORE UPDATE OF state ON domain_orders WHEN NEW.state='dispatching' AND OLD.state='reserved' BEGIN
 SELECT RAISE(ABORT,'domain_order_expired') WHERE NOT EXISTS(SELECT 1 FROM domain_quotes q WHERE q.quote_id=OLD.quote_id AND NEW.attempt_started_at<q.expires_at);
END;
-- Contact erasure: a failed, cancelled or expired order no longer needs the owner's registrant contact.
CREATE TRIGGER domain_orders_erase_contact AFTER UPDATE OF state ON domain_orders WHEN NEW.state IN ('failed','cancelled','expired') BEGIN
 DELETE FROM domain_registrant_contacts WHERE review_id=NEW.review_id;
END;
-- An order that holds funds or may have bought the name cannot be purged: not by a project or account cascade, not by hand.
CREATE TRIGGER domain_orders_keep BEFORE DELETE ON domain_orders WHEN OLD.state IN ('reserved','dispatching','unknown-outcome','unresolved') BEGIN SELECT RAISE(ABORT,'domain_order_unresolved'); END;

-- Funding hold: a ledger entry for exactly the reviewed charge, placed with the reservation and settled by the order's own
-- transition, so it can never be captured except on registered or released except on failed, cancelled or expired. No money moves here.
CREATE TABLE domain_funding_holds (
 order_id TEXT PRIMARY KEY REFERENCES domain_orders(order_id) ON DELETE CASCADE,
 source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 128),
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents BETWEEN 1 AND 100000),
 state TEXT NOT NULL CHECK(state IN ('held','captured','released')),
 placed_at INTEGER NOT NULL CHECK(typeof(placed_at)='integer' AND placed_at>0),
 settled_at INTEGER CHECK(settled_at IS NULL OR settled_at>=placed_at),
 CHECK((state='held')=(settled_at IS NULL))
) STRICT;
CREATE TRIGGER domain_orders_hold AFTER UPDATE OF state ON domain_orders WHEN OLD.state='consented' AND NEW.state='reserved' BEGIN
 INSERT INTO domain_funding_holds(order_id,source_id,amount_cents,state,placed_at)
  SELECT NEW.order_id,json_extract(q.quote_json,'$.funding.sourceId'),json_extract(q.quote_json,'$.funding.customerChargeCents'),'held',NEW.updated_at
  FROM domain_quotes q WHERE q.quote_id=NEW.quote_id;
END;
CREATE TRIGGER domain_orders_capture AFTER UPDATE OF state ON domain_orders WHEN NEW.state='registered' AND OLD.state!='registered' BEGIN
 UPDATE domain_funding_holds SET state='captured',settled_at=NEW.updated_at WHERE order_id=NEW.order_id AND state='held';
END;
CREATE TRIGGER domain_orders_release AFTER UPDATE OF state ON domain_orders WHEN NEW.state IN ('failed','cancelled','expired') AND OLD.state NOT IN ('failed','cancelled','expired') BEGIN
 UPDATE domain_funding_holds SET state='released',settled_at=NEW.updated_at WHERE order_id=NEW.order_id AND state='held';
END;
CREATE TRIGGER domain_funding_holds_admit BEFORE INSERT ON domain_funding_holds BEGIN
 SELECT RAISE(ABORT,'domain_hold_admit') WHERE NEW.state!='held' OR NEW.settled_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM domain_orders o JOIN domain_quotes q ON q.quote_id=o.quote_id
  WHERE o.order_id=NEW.order_id AND o.state='reserved' AND json_extract(q.quote_json,'$.funding.sourceId') IS NEW.source_id AND json_extract(q.quote_json,'$.funding.customerChargeCents') IS NEW.amount_cents);
END;
-- A held hold is never deleted: it ends by settlement through its order, or the order cannot be purged.
CREATE TRIGGER domain_funding_holds_keep BEFORE DELETE ON domain_funding_holds WHEN OLD.state='held' BEGIN SELECT RAISE(ABORT,'domain_hold_open'); END;
CREATE TRIGGER domain_funding_holds_settle BEFORE UPDATE ON domain_funding_holds BEGIN
 SELECT RAISE(ABORT,'domain_hold_settle') WHERE OLD.state!='held' OR NEW.state='held' OR NEW.order_id IS NOT OLD.order_id OR NEW.source_id IS NOT OLD.source_id
  OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.placed_at IS NOT OLD.placed_at
  OR NOT EXISTS(SELECT 1 FROM domain_orders o WHERE o.order_id=NEW.order_id AND ((NEW.state='captured' AND o.state='registered') OR (NEW.state='released' AND o.state IN ('failed','cancelled','expired'))));
END;

-- The single claim of the register call: one attempt row per order, written by the dispatching transition itself. A second claim,
-- a retry or a redispatch cannot insert a second row, and the module calls register only after this claim commits.
CREATE TABLE domain_order_attempts (
 attempt_id TEXT PRIMARY KEY CHECK(length(attempt_id) BETWEEN 1 AND 128),
 order_id TEXT NOT NULL UNIQUE REFERENCES domain_orders(order_id) ON DELETE CASCADE,
 started_at INTEGER NOT NULL CHECK(typeof(started_at)='integer' AND started_at>0),
 outcome TEXT CHECK(outcome IS NULL OR outcome IN ('registered','failed','unknown-outcome','unresolved'))
) STRICT;
CREATE TRIGGER domain_orders_attempt AFTER UPDATE OF state ON domain_orders WHEN OLD.state='reserved' AND NEW.state='dispatching' BEGIN
 INSERT INTO domain_order_attempts(attempt_id,order_id,started_at) VALUES(NEW.attempt_id,NEW.order_id,NEW.attempt_started_at);
END;
CREATE TRIGGER domain_orders_attempt_outcome AFTER UPDATE OF state ON domain_orders WHEN OLD.state IN ('dispatching','unknown-outcome','unresolved') AND NEW.state IN ('registered','failed','unknown-outcome','unresolved') BEGIN
 UPDATE domain_order_attempts SET outcome=NEW.state WHERE order_id=NEW.order_id;
END;
CREATE TRIGGER domain_order_attempts_keep BEFORE UPDATE ON domain_order_attempts WHEN NEW.attempt_id IS NOT OLD.attempt_id OR NEW.order_id IS NOT OLD.order_id OR NEW.started_at IS NOT OLD.started_at BEGIN SELECT RAISE(ABORT,'domain_attempt_frozen'); END;

-- Authenticated registrar results, idempotent by event id. A duplicate event is a primary key conflict, so it applies at most once.
CREATE TABLE domain_registrar_events (
 event_id TEXT PRIMARY KEY CHECK(length(event_id) BETWEEN 1 AND 200),
 order_id TEXT NOT NULL REFERENCES domain_orders(order_id) ON DELETE CASCADE,
 attempt_id TEXT NOT NULL CHECK(length(attempt_id) BETWEEN 1 AND 128),
 event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 64),
 applied INTEGER NOT NULL CHECK(applied IN (0,1)),
 received_at INTEGER NOT NULL CHECK(typeof(received_at)='integer' AND received_at>0)
) STRICT;
CREATE INDEX domain_registrar_events_order ON domain_registrar_events(order_id,received_at);
CREATE TRIGGER domain_registrar_events_frozen BEFORE UPDATE ON domain_registrar_events BEGIN SELECT RAISE(ABORT,'domain_event_frozen'); END;

-- The registration an order produced: one row per order and per name. New registrations never auto-renew. The row is written by
-- the registered transition itself. It records the name Whumpo bought for the owner; closing the account or deleting the project
-- never cancels it, so an active registration cannot be purged (the owner transfers it out first).
CREATE TABLE domain_registrations (
 hostname TEXT PRIMARY KEY CHECK(length(hostname) BETWEEN 3 AND 253 AND hostname=lower(hostname) AND hostname NOT GLOB '*[^a-z0-9.-]*' AND hostname GLOB '[a-z0-9]*' AND hostname GLOB '*.[a-z][a-z]*' AND hostname GLOB '*[a-z]' AND hostname NOT GLOB '*.*.*' AND hostname NOT GLOB '*-.*' AND hostname NOT GLOB '*.-*' AND hostname NOT GLOB '*..*' AND hostname NOT GLOB '*-'),
 order_id TEXT NOT NULL UNIQUE REFERENCES domain_orders(order_id) ON DELETE CASCADE,
 owner_user_id TEXT NOT NULL CHECK(length(owner_user_id) BETWEEN 1 AND 128),
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','transfer-out','transferred-out','lapsed')),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0),
 expires_at INTEGER CHECK(expires_at IS NULL OR (typeof(expires_at)='integer' AND expires_at>0)),
 auto_renew INTEGER NOT NULL DEFAULT 0 CHECK(auto_renew IN (0,1)),
 renewal_review_id TEXT CHECK(renewal_review_id IS NULL OR length(renewal_review_id) BETWEEN 1 AND 128),
 renewal_total_cents INTEGER CHECK(renewal_total_cents IS NULL OR (typeof(renewal_total_cents)='integer' AND renewal_total_cents BETWEEN 0 AND 100000)),
 charge_mismatch INTEGER CHECK(charge_mismatch IS NULL OR charge_mismatch IN (0,1)),
 CHECK(auto_renew=0 OR (renewal_review_id IS NOT NULL AND renewal_total_cents IS NOT NULL)),
 CHECK(auto_renew=1 OR (renewal_review_id IS NULL AND renewal_total_cents IS NULL)),
 CHECK(auto_renew=0 OR state='active')
) STRICT;
CREATE INDEX domain_registrations_project ON domain_registrations(project_id);
CREATE INDEX domain_registrations_owner ON domain_registrations(owner_user_id,state);
CREATE INDEX domain_registrations_expiry ON domain_registrations(state,expires_at);
-- A name that was transferred out or lapsed can be bought and registered again: the old terminal row is replaced.
CREATE TRIGGER domain_orders_registration AFTER UPDATE OF state ON domain_orders WHEN NEW.state='registered' AND OLD.state!='registered' BEGIN
 DELETE FROM domain_registrations WHERE hostname=NEW.hostname AND state IN ('transferred-out','lapsed');
 INSERT INTO domain_registrations(hostname,order_id,owner_user_id,project_id,created_at,expires_at,charge_mismatch)
  VALUES(NEW.hostname,NEW.order_id,NEW.owner_user_id,NEW.project_id,NEW.updated_at,NEW.registration_expires_at,NEW.charge_mismatch);
END;
-- A registration exists only for a registered order of the same name, owner and project, new and not auto-renewing; no direct insert forges proof or consent.
CREATE TRIGGER domain_registrations_admit BEFORE INSERT ON domain_registrations BEGIN
 SELECT RAISE(ABORT,'domain_registration_admit') WHERE NEW.state!='active' OR NEW.auto_renew!=0 OR NEW.renewal_review_id IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM domain_orders o WHERE o.order_id=NEW.order_id AND o.state='registered' AND o.hostname=NEW.hostname AND o.owner_user_id=NEW.owner_user_id AND o.project_id=NEW.project_id AND o.released=0
   AND NEW.expires_at IS o.registration_expires_at AND NEW.created_at=o.updated_at AND NEW.charge_mismatch IS o.charge_mismatch);
END;
-- INSERT OR REPLACE deletes the colliding row without running delete triggers (and cascades through foreign keys), so every guarded table refuses an
-- insert whose key already exists, whatever the conflict clause. Plain inserts that collide would fail anyway; this closes only the REPLACE path.
CREATE TRIGGER domain_quotes_once BEFORE INSERT ON domain_quotes BEGIN SELECT RAISE(ABORT,'domain_row_exists') WHERE EXISTS(SELECT 1 FROM domain_quotes WHERE quote_id=NEW.quote_id); END;
CREATE TRIGGER domain_reviews_once BEFORE INSERT ON domain_reviews BEGIN SELECT RAISE(ABORT,'domain_row_exists') WHERE EXISTS(SELECT 1 FROM domain_reviews WHERE review_id=NEW.review_id OR quote_id=NEW.quote_id); END;
CREATE TRIGGER domain_registrant_contacts_once BEFORE INSERT ON domain_registrant_contacts BEGIN SELECT RAISE(ABORT,'domain_row_exists') WHERE EXISTS(SELECT 1 FROM domain_registrant_contacts WHERE review_id=NEW.review_id); END;
CREATE TRIGGER domain_orders_once BEFORE INSERT ON domain_orders BEGIN
 SELECT RAISE(ABORT,'domain_row_exists') WHERE EXISTS(SELECT 1 FROM domain_orders WHERE order_id=NEW.order_id OR idempotency_key=NEW.idempotency_key OR review_id=NEW.review_id
  OR (hostname=NEW.hostname AND state NOT IN ('failed','cancelled','expired') AND released=0));
END;
CREATE TRIGGER domain_funding_holds_once BEFORE INSERT ON domain_funding_holds BEGIN SELECT RAISE(ABORT,'domain_row_exists') WHERE EXISTS(SELECT 1 FROM domain_funding_holds WHERE order_id=NEW.order_id); END;
CREATE TRIGGER domain_order_attempts_once BEFORE INSERT ON domain_order_attempts BEGIN SELECT RAISE(ABORT,'domain_row_exists') WHERE EXISTS(SELECT 1 FROM domain_order_attempts WHERE attempt_id=NEW.attempt_id OR order_id=NEW.order_id); END;
CREATE TRIGGER domain_registrar_events_once BEFORE INSERT ON domain_registrar_events BEGIN SELECT RAISE(ABORT,'domain_row_exists') WHERE EXISTS(SELECT 1 FROM domain_registrar_events WHERE event_id=NEW.event_id); END;
CREATE TRIGGER domain_registrations_once BEFORE INSERT ON domain_registrations BEGIN SELECT RAISE(ABORT,'domain_row_exists') WHERE EXISTS(SELECT 1 FROM domain_registrations WHERE hostname=NEW.hostname OR order_id=NEW.order_id); END;
-- Registrant contact leaves when the registration does.
CREATE TRIGGER domain_registrations_release AFTER UPDATE OF state ON domain_registrations WHEN NEW.state IN ('transferred-out','lapsed') AND OLD.state NOT IN ('transferred-out','lapsed') BEGIN
 DELETE FROM domain_registrant_contacts WHERE review_id=(SELECT review_id FROM domain_orders WHERE order_id=NEW.order_id);
 UPDATE domain_orders SET released=1,version=version+1 WHERE order_id=NEW.order_id AND released=0;
END;
-- A registration moves active -> transfer-out (the owner asked to leave) -> transferred-out, or lapses; the last two are final. Auto-renew turns
-- on only through a confirmed renewal review for the same name, owner and price (the review's own confirmation writes it), and off at any time.
CREATE TRIGGER domain_registrations_change BEFORE UPDATE ON domain_registrations BEGIN
 SELECT RAISE(ABORT,'domain_registration_identity') WHERE NEW.hostname IS NOT OLD.hostname OR NEW.order_id IS NOT OLD.order_id OR NEW.owner_user_id IS NOT OLD.owner_user_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.created_at IS NOT OLD.created_at OR NEW.charge_mismatch IS NOT OLD.charge_mismatch;
 SELECT RAISE(ABORT,'domain_registration_expiry') WHERE NEW.expires_at IS NOT OLD.expires_at AND OLD.expires_at IS NOT NULL AND (NEW.expires_at IS NULL OR NEW.expires_at<OLD.expires_at);
 SELECT RAISE(ABORT,'domain_registration_final') WHERE OLD.state IN ('transferred-out','lapsed');
 SELECT RAISE(ABORT,'domain_registration_state') WHERE NEW.state IS NOT OLD.state AND NOT (
   (OLD.state='active' AND NEW.state IN ('transfer-out','transferred-out','lapsed')) OR (OLD.state='transfer-out' AND NEW.state IN ('active','transferred-out','lapsed')));
 SELECT RAISE(ABORT,'domain_registration_renewal') WHERE NEW.auto_renew=1 AND (OLD.auto_renew=0 OR NEW.renewal_review_id IS NOT OLD.renewal_review_id OR NEW.renewal_total_cents IS NOT OLD.renewal_total_cents)
  AND NOT EXISTS(SELECT 1 FROM domain_renewal_reviews r WHERE r.review_id=NEW.renewal_review_id AND r.hostname=NEW.hostname AND r.owner_user_id=NEW.owner_user_id
   AND r.confirmed_at IS NOT NULL AND r.renewal_total_cents=NEW.renewal_total_cents);
END;
CREATE TRIGGER domain_registrations_keep BEFORE DELETE ON domain_registrations WHEN OLD.state IN ('active','transfer-out') BEGIN SELECT RAISE(ABORT,'domain_registration_active'); END;

-- The exact opt-in review: bound to the renewal price the server showed. Confirming it (once, before it expires, while the name is active) turns auto-renew on
-- at that price; a later price rise is a new review (the renewal approval below refuses a price above the opted-in one).
CREATE TABLE domain_renewal_reviews (
 review_id TEXT PRIMARY KEY CHECK(review_id GLOB '[A-Za-z0-9]*' AND length(review_id) BETWEEN 1 AND 128 AND review_id NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 hostname TEXT NOT NULL REFERENCES domain_registrations(hostname) ON DELETE CASCADE,
 owner_user_id TEXT NOT NULL CHECK(length(owner_user_id) BETWEEN 1 AND 128),
 renewal_total_cents INTEGER NOT NULL CHECK(typeof(renewal_total_cents)='integer' AND renewal_total_cents BETWEEN 1 AND 100000),
 consent_text_digest TEXT NOT NULL CHECK(length(consent_text_digest)=64 AND consent_text_digest NOT GLOB '*[^0-9a-f]*'),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0),
 expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at>created_at AND expires_at<=created_at+600000),
 confirmed_at INTEGER CHECK(confirmed_at IS NULL OR (typeof(confirmed_at)='integer' AND confirmed_at>=created_at AND confirmed_at<expires_at))
) STRICT;
CREATE INDEX domain_renewal_reviews_name ON domain_renewal_reviews(hostname,created_at);
CREATE TRIGGER domain_renewal_reviews_admit BEFORE INSERT ON domain_renewal_reviews BEGIN
 SELECT RAISE(ABORT,'domain_renewal_scope') WHERE NEW.confirmed_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM domain_registrations WHERE hostname=NEW.hostname AND owner_user_id=NEW.owner_user_id AND state='active');
END;
CREATE TRIGGER domain_renewal_reviews_once BEFORE INSERT ON domain_renewal_reviews BEGIN SELECT RAISE(ABORT,'domain_row_exists') WHERE EXISTS(SELECT 1 FROM domain_renewal_reviews WHERE review_id=NEW.review_id); END;
CREATE TRIGGER domain_renewal_reviews_confirm BEFORE UPDATE ON domain_renewal_reviews BEGIN
 SELECT RAISE(ABORT,'domain_renewal_frozen') WHERE OLD.confirmed_at IS NOT NULL OR NEW.confirmed_at IS NULL OR NEW.review_id IS NOT OLD.review_id OR NEW.hostname IS NOT OLD.hostname
  OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.renewal_total_cents IS NOT OLD.renewal_total_cents OR NEW.consent_text_digest IS NOT OLD.consent_text_digest
  OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at;
 SELECT RAISE(ABORT,'domain_renewal_scope') WHERE NOT EXISTS(SELECT 1 FROM domain_registrations WHERE hostname=NEW.hostname AND owner_user_id=NEW.owner_user_id AND state='active');
END;
CREATE TRIGGER domain_renewal_reviews_apply AFTER UPDATE OF confirmed_at ON domain_renewal_reviews BEGIN
 UPDATE domain_registrations SET auto_renew=1,renewal_review_id=NEW.review_id,renewal_total_cents=NEW.renewal_total_cents WHERE hostname=NEW.hostname AND state='active';
END;

-- The only record that lets a renewal be charged: one per name and expiry, written while the name is active with auto-renew on, for the opted-in
-- review, at a price no higher than the opted-in price. Nothing here charges or renews; the charger (WH-042 extension) must require this row.
CREATE TABLE domain_renewal_approvals (
 hostname TEXT NOT NULL REFERENCES domain_registrations(hostname) ON DELETE CASCADE,
 for_expiry INTEGER NOT NULL CHECK(typeof(for_expiry)='integer' AND for_expiry>0),
 review_id TEXT NOT NULL CHECK(length(review_id) BETWEEN 1 AND 128),
 price_cents INTEGER NOT NULL CHECK(typeof(price_cents)='integer' AND price_cents BETWEEN 1 AND 100000),
 approved_at INTEGER NOT NULL CHECK(typeof(approved_at)='integer' AND approved_at>0),
 PRIMARY KEY(hostname,for_expiry)
) STRICT;
-- Live opt-in, price at or below it, and a window of 30 days before the expiry; the same rule for a first approval and for the row following a new price.
CREATE TRIGGER domain_renewal_approvals_admit BEFORE INSERT ON domain_renewal_approvals BEGIN
 SELECT RAISE(ABORT,'domain_renewal_not_opted_in') WHERE NOT EXISTS(SELECT 1 FROM domain_registrations g WHERE g.hostname=NEW.hostname AND g.state='active' AND g.auto_renew=1
  AND g.renewal_review_id=NEW.review_id AND NEW.price_cents<=g.renewal_total_cents AND g.expires_at=NEW.for_expiry AND NEW.approved_at<g.expires_at AND NEW.approved_at>=g.expires_at-2592000000);
END;
CREATE TRIGGER domain_renewal_approvals_follow BEFORE UPDATE ON domain_renewal_approvals BEGIN
 SELECT RAISE(ABORT,'domain_renewal_frozen') WHERE NEW.hostname IS NOT OLD.hostname OR NEW.for_expiry IS NOT OLD.for_expiry;
 SELECT RAISE(ABORT,'domain_renewal_not_opted_in') WHERE NOT EXISTS(SELECT 1 FROM domain_registrations g WHERE g.hostname=NEW.hostname AND g.state='active' AND g.auto_renew=1
  AND g.renewal_review_id=NEW.review_id AND NEW.price_cents<=g.renewal_total_cents AND g.expires_at=NEW.for_expiry AND NEW.approved_at<g.expires_at AND NEW.approved_at>=g.expires_at-2592000000);
END;
-- An approval ends with the opt-in it rests on: turning auto-renew off, a new review, leaving active (transfer-out, lapse) all delete it in the same statement.
CREATE TRIGGER domain_registrations_revoke AFTER UPDATE ON domain_registrations
WHEN (OLD.auto_renew=1 AND NEW.auto_renew=0) OR NEW.state!='active' OR NEW.renewal_total_cents IS NOT OLD.renewal_total_cents OR NEW.renewal_review_id IS NOT OLD.renewal_review_id BEGIN
 DELETE FROM domain_renewal_approvals WHERE hostname=NEW.hostname;
END;
-- The charger's gate (WH-042 extension): a charge is allowed only for a row of this view, whose join is the live opt-in and whose approval is recent; the charger
-- also compares the price it is about to charge, read fresh from the registrar, with price_cents. Nothing else authorizes a renewal charge.
CREATE VIEW domain_renewal_chargeable AS
 SELECT a.hostname,a.for_expiry,a.price_cents,a.approved_at,g.owner_user_id,g.project_id,g.renewal_total_cents
 FROM domain_renewal_approvals a JOIN domain_registrations g ON g.hostname=a.hostname
 WHERE g.state='active' AND g.auto_renew=1 AND g.renewal_review_id=a.review_id AND g.expires_at=a.for_expiry AND a.price_cents<=g.renewal_total_cents
  AND a.approved_at>unixepoch()*1000-604800000 AND unixepoch()*1000<g.expires_at;

-- Transfer-out: one open request per name, claimed before the registrar is asked to unlock it, so a lost response is reconciled by reading, never by
-- asking again. The ICANN 60-day lock is checked here too. The auth code has no column: it is read from the registrar for the owner at the moment it is shown.
CREATE TABLE domain_transfer_requests (
 request_id TEXT PRIMARY KEY CHECK(request_id GLOB '[A-Za-z0-9]*' AND length(request_id) BETWEEN 1 AND 100 AND request_id NOT GLOB '*[^A-Za-z0-9_.-]*'),
 hostname TEXT NOT NULL REFERENCES domain_registrations(hostname) ON DELETE CASCADE,
 owner_user_id TEXT NOT NULL CHECK(length(owner_user_id) BETWEEN 1 AND 128),
 state TEXT NOT NULL CHECK(state IN ('requested','unlocked','unknown-outcome','failed','completed')),
 requested_at INTEGER NOT NULL CHECK(typeof(requested_at)='integer' AND requested_at>0),
 updated_at INTEGER NOT NULL CHECK(typeof(updated_at)='integer' AND updated_at>=requested_at),
 version INTEGER NOT NULL DEFAULT 0 CHECK(typeof(version)='integer' AND version>=0),
 completion_evidence TEXT CHECK(completion_evidence IS NULL OR completion_evidence IN ('registered-elsewhere','registrar-reported'))
) STRICT;
CREATE UNIQUE INDEX domain_transfer_requests_open ON domain_transfer_requests(hostname) WHERE state IN ('requested','unlocked','unknown-outcome');
CREATE INDEX domain_transfer_requests_owner ON domain_transfer_requests(owner_user_id,state);
CREATE TRIGGER domain_transfer_requests_admit BEFORE INSERT ON domain_transfer_requests BEGIN
 SELECT RAISE(ABORT,'domain_transfer_scope') WHERE NEW.state!='requested' OR NEW.version!=0 OR NEW.updated_at!=NEW.requested_at OR NOT EXISTS(SELECT 1 FROM domain_registrations g
  WHERE g.hostname=NEW.hostname AND g.owner_user_id=NEW.owner_user_id AND g.state='active' AND NEW.requested_at-g.created_at>=5184000000);
END;
CREATE TRIGGER domain_transfer_requests_start AFTER INSERT ON domain_transfer_requests BEGIN
 UPDATE domain_registrations SET state='transfer-out',auto_renew=0,renewal_review_id=NULL,renewal_total_cents=NULL WHERE hostname=NEW.hostname AND state='active';
END;
CREATE TRIGGER domain_transfer_requests_transition BEFORE UPDATE ON domain_transfer_requests BEGIN
 SELECT RAISE(ABORT,'domain_transfer_identity') WHERE NEW.request_id IS NOT OLD.request_id OR NEW.hostname IS NOT OLD.hostname OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.requested_at IS NOT OLD.requested_at;
 SELECT RAISE(ABORT,'domain_transfer_version') WHERE NEW.version IS NOT OLD.version+1 OR NEW.updated_at<OLD.updated_at;
 SELECT RAISE(ABORT,'domain_transfer_transition') WHERE OLD.state IN ('failed','completed') OR (NEW.state IS NOT OLD.state AND NOT (
   (OLD.state='requested' AND NEW.state IN ('unlocked','unknown-outcome','failed'))
   OR (OLD.state='unknown-outcome' AND NEW.state IN ('unlocked','failed','completed'))
   OR (OLD.state='unlocked' AND NEW.state IN ('completed','failed'))));
 -- Absence is never evidence (registrar.ts: "not found" proves nothing, and an outage looks the same): a transfer completes only on positive evidence, a registration
 -- naming another order or the registrar's own transfer-complete report. Nothing else, however often it is read, can reach `completed`.
 SELECT RAISE(ABORT,'domain_transfer_evidence') WHERE (NEW.state='completed' AND OLD.state!='completed' AND NEW.completion_evidence IS NULL)
  OR (NEW.completion_evidence IS NOT OLD.completion_evidence AND NOT (NEW.state='completed' AND OLD.state!='completed'));
END;
CREATE TRIGGER domain_transfer_requests_settle AFTER UPDATE OF state ON domain_transfer_requests WHEN NEW.state IN ('failed','completed') BEGIN
 UPDATE domain_registrations SET state=CASE NEW.state WHEN 'completed' THEN 'transferred-out' ELSE 'active' END WHERE hostname=NEW.hostname AND state='transfer-out';
END;
CREATE TRIGGER domain_transfer_requests_keep BEFORE DELETE ON domain_transfer_requests WHEN OLD.state IN ('requested','unknown-outcome') BEGIN SELECT RAISE(ABORT,'domain_transfer_unresolved'); END;
CREATE TRIGGER domain_transfer_requests_once BEFORE INSERT ON domain_transfer_requests BEGIN SELECT RAISE(ABORT,'domain_row_exists') WHERE EXISTS(SELECT 1 FROM domain_transfer_requests WHERE request_id=NEW.request_id); END;
