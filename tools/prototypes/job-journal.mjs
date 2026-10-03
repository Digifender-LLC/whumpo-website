// WH-052 local design prototype only. No Worker import, deployed schema,
// provider client, credentials, user payloads or public entry point.
// DatabaseSync transactions model atomic transitions; production D1 must use
// conditional statements + transactional batch, not BEGIN/callback transactions.
const identity = /^[a-zA-Z0-9_.:-]{1,128}$/;
const integer = n => Number.isSafeInteger(n) && n >= 0;
const check = ok => { if (!ok) throw Error('Invalid prototype operation'); };
import {validateJobEnvelope,jobEnvelopeDigest,validateJobWake,matchJobWake} from './job-envelope.mjs';
export class JobJournalPrototype {
  constructor(db) { this.db = db; }
  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prototype_jobs (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL,
        envelope_json TEXT NOT NULL, context_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL, max_attempts INTEGER NOT NULL,
        due INTEGER NOT NULL, initial_due INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN
          ('ready','leased','awaiting','uncertain','complete','cancelled','operator','expired')),
        fence INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
        attempt INTEGER NOT NULL DEFAULT 0, attempt_id TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        cursor INTEGER NOT NULL DEFAULT 0, result_ref TEXT
      );
      CREATE INDEX IF NOT EXISTS prototype_due ON prototype_jobs(state,due,id);
      CREATE TABLE IF NOT EXISTS prototype_events (
        sequence INTEGER PRIMARY KEY, job TEXT NOT NULL, event TEXT NOT NULL,
        fence INTEGER NOT NULL, attempt INTEGER NOT NULL, at INTEGER NOT NULL,
        reference TEXT
      );
      CREATE TABLE IF NOT EXISTS prototype_outbox (
        delivery_id TEXT PRIMARY KEY, job TEXT NOT NULL UNIQUE,
        envelope_digest TEXT NOT NULL, acknowledged_at INTEGER
      );
      CREATE TRIGGER IF NOT EXISTS prototype_identity BEFORE UPDATE ON prototype_jobs
        WHEN NEW.id!=OLD.id OR NEW.owner!=OLD.owner OR NEW.kind!=OLD.kind OR
          NEW.context_hash!=OLD.context_hash OR NEW.initial_due!=OLD.initial_due OR
          NEW.envelope_json!=OLD.envelope_json OR NEW.expires_at!=OLD.expires_at OR NEW.max_attempts!=OLD.max_attempts
        BEGIN SELECT RAISE(ABORT,'immutable job identity'); END;
      CREATE TRIGGER IF NOT EXISTS prototype_outbox_identity BEFORE UPDATE ON prototype_outbox
        WHEN NEW.delivery_id!=OLD.delivery_id OR NEW.job!=OLD.job OR NEW.envelope_digest!=OLD.envelope_digest
          OR (OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS NOT OLD.acknowledged_at)
        BEGIN SELECT RAISE(ABORT,'immutable delivery identity'); END;
      CREATE TRIGGER IF NOT EXISTS prototype_event_update BEFORE UPDATE ON prototype_events
        BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
      CREATE TRIGGER IF NOT EXISTS prototype_event_delete BEFORE DELETE ON prototype_events
        BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
    `);
  }
  atomic(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  read(owner, id) {
    return this.db.prepare('SELECT * FROM prototype_jobs WHERE owner=? AND id=?').get(owner,id) ?? null;
  }
  event(row, event, now, reference=null) {
    this.db.prepare('INSERT INTO prototype_events(job,event,fence,attempt,at,reference) VALUES(?,?,?,?,?,?)')
      .run(row.id,event,row.fence,row.attempt,now,reference);
  }
  enqueue(input) {
    const e=validateJobEnvelope(input),id=e.jobId,owner=e.ownerAccountId,kind=e.purpose,contextHash=jobEnvelopeDigest(e),due=e.schedule.notBefore;
    return this.atomic(() => {
      const saved = this.db.prepare('SELECT * FROM prototype_jobs WHERE id=?').get(id);
      if (saved) {
        check(saved.owner===owner && saved.kind===kind && saved.context_hash===contextHash && saved.initial_due===due);
        return saved;
      }
      this.db.prepare('INSERT INTO prototype_jobs(id,owner,kind,envelope_json,context_hash,expires_at,max_attempts,due,initial_due) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(id,owner,kind,JSON.stringify(e),contextHash,e.schedule.expiresAt,e.limits.maxAttempts,due,due);
      this.db.prepare('INSERT INTO prototype_outbox(delivery_id,job,envelope_digest) VALUES(?,?,?)').run(crypto.randomUUID(),id,contextHash);
      const row=this.read(owner,id); this.event(row,'enqueued',e.schedule.createdAt); return row;
    });
  }
  delivery(owner,id){
    const row=this.db.prepare('SELECT o.* FROM prototype_outbox o JOIN prototype_jobs j ON j.id=o.job WHERE j.owner=? AND j.id=?').get(owner,id);
    return row?{contractVersion:1,deliveryId:row.delivery_id,jobId:row.job,envelopeDigest:row.envelope_digest}:null;
  }
  checkDelivery(owner,wake){
    wake=validateJobWake(wake);
    const row=this.read(owner,wake.jobId);check(row);
    matchJobWake(wake,JSON.parse(row.envelope_json));
    check(this.delivery(owner,row.id)?.deliveryId===wake.deliveryId);return row;
  }
  acknowledgeDelivery(owner,wake,now){
    check(integer(now));this.checkDelivery(owner,wake);
    this.db.prepare('UPDATE prototype_outbox SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE delivery_id=?').run(now,wake.deliveryId);
  }
  claimDelivery(owner,wake,now,leaseMs=60000){this.checkDelivery(owner,wake);return this.claim(owner,wake.jobId,now,leaseMs);}
  claim(owner,id,now,leaseMs=60000) {
    check(integer(now) && integer(leaseMs) && leaseMs>0 && leaseMs<=60000);
    return this.atomic(() => {
      const row=this.db.prepare(`UPDATE prototype_jobs SET state='leased',fence=fence+1,lease_until=?
        WHERE owner=? AND id=? AND cancel_requested=0 AND expires_at>? AND
        ((state='ready' AND due<=?) OR (state='leased' AND lease_until<=?)) RETURNING *`)
        .get(now+leaseMs,owner,id,now,now,now);
      if (!row) return null;
      this.event(row,'claimed',now); return row;
    });
  }
  leased(claim,now) {
    check(integer(now));
    const row=this.read(claim.owner,claim.id);
    check(row && row.state==='leased' && row.fence===claim.fence && row.lease_until>now && row.expires_at>now && !row.cancel_requested);
    return row;
  }
  beginExternal(claim,now) {
    return this.atomic(() => {
      const row=this.leased(claim,now), operation=`${row.id}.${row.attempt+1}`;
      this.db.prepare("UPDATE prototype_jobs SET state='awaiting',attempt=attempt+1,attempt_id=? WHERE id=?")
        .run(operation,row.id);
      const next=this.read(row.owner,row.id); this.event(next,'intent',now,operation); return next;
    });
  }
  recoverExpired(now) {
    check(integer(now));
    return this.atomic(() => {
      const rows=this.db.prepare("UPDATE prototype_jobs SET state='uncertain' WHERE state='awaiting' AND lease_until<=? RETURNING *").all(now);
      for (const row of rows) this.event(row,'uncertain',now);
      const expired=this.db.prepare("UPDATE prototype_jobs SET state='expired',fence=fence+1 WHERE state IN ('ready','leased') AND expires_at<=? RETURNING *").all(now);
      for(const row of expired)this.event(row,'expired',now);
      return rows.length;
    });
  }
  recordExternal(owner,id,operation,reference,now) {
    check(identity.test(reference) && integer(now));
    return this.atomic(() => {
      const row=this.read(owner,id); check(row && row.attempt_id===operation);
      if (row.result_ref) { check(row.result_ref===reference); return row; }
      check(['awaiting','uncertain'].includes(row.state));
      this.db.prepare("UPDATE prototype_jobs SET state=?,result_ref=?,lease_until=0 WHERE id=?")
        .run(row.cancel_requested?'cancelled':'complete',reference,id);
      const next=this.read(owner,id); this.event(next,'external_result',now,reference); return next;
    });
  }
  // Fixture-only evidence input. Real adapters must prove no effect is possible
  // (including late senders), or query/replay a provider's guaranteed idempotent
  // operation. Timeout, lease expiry, 404 and missing references are not proof.
  confirmNotSent(owner,id,operation,reference,now) {
    check(identity.test(reference) && integer(now));
    return this.atomic(() => {
      const row=this.read(owner,id); check(row && row.attempt_id===operation && ['awaiting','uncertain'].includes(row.state));
      const state=row.cancel_requested?'cancelled':row.expires_at<=now?'expired':row.attempt>=row.max_attempts?'operator':'ready';
      const due=now+Math.min(3600000,60000*2**(row.attempt-1));
      this.event(row,'confirmed_not_sent',now,reference);
      this.db.prepare('UPDATE prototype_jobs SET state=?,due=?,fence=fence+1,lease_until=0,attempt_id=NULL WHERE id=?')
        .run(state,due,id);
      return this.read(owner,id);
    });
  }
  cancel(owner,id,now) {
    check(integer(now));
    return this.atomic(() => {
      const row=this.read(owner,id); check(row);
      if (row.cancel_requested || ['complete','cancelled','expired'].includes(row.state)) return row;
      // Already-dispatched effects must still reconcile. This is a request to
      // stop future work, never evidence that a remote effect was undone.
      const state=['awaiting','uncertain'].includes(row.state)?row.state:'cancelled';
      this.db.prepare('UPDATE prototype_jobs SET cancel_requested=1,state=?,fence=fence+1 WHERE id=?').run(state,id);
      const next=this.read(owner,id); this.event(next,'cancel_requested',now); return next;
    });
  }
  commitChunk(claim,through,done,now,apply) {
    check(integer(through) && typeof done==='boolean');
    return this.atomic(() => {
      const row=this.leased(claim,now); check(row.kind==='account-cleanup' && through>row.cursor);
      apply(this.db); // Synthetic database-local effect in the SAME transaction.
      this.db.prepare('UPDATE prototype_jobs SET cursor=?,state=?,due=?,fence=fence+1,lease_until=0 WHERE id=?')
        .run(through,done?'complete':'ready',now,row.id);
      const next=this.read(row.owner,row.id); this.event(next,'chunk_committed',now); return next;
    });
  }
}
