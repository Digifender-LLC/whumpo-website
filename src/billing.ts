import { plans } from './plans';

export class BillingError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export type Operation = { id: string; user_id: string; period: string; request_hash: string; quoted_units: number; quota_reserved: number; credits_reserved: number; status: 'reserved' | 'dispatched' | 'uncertain' | 'settled' | 'released'; actual_units: number | null; quota_charged: number; credits_charged: number };
type Account = { plan_id: string; overage_enabled: number; credits_available: number; credits_reserved: number };

export async function ensureBilling(db: D1Database, userId: string, date = new Date()) {
  const period = date.toISOString().slice(0, 7);
  await db.prepare('INSERT OR IGNORE INTO billing_accounts (user_id) VALUES (?)').bind(userId).run();
  // Select receipts inside the INSERT so an overlapping grant cannot be missed by a stale JS read.
  await db.prepare("INSERT OR IGNORE INTO usage_periods(user_id,period,allowance) SELECT ?,?,COALESCE(MAX(CASE plan_id WHEN 'studio' THEN 800 ELSE 250 END),25) FROM plan_grants WHERE user_id=? AND period=?").bind(userId,period,userId,period).run();
  const entitlement=await db.prepare("SELECT COALESCE(MAX(CASE plan_id WHEN 'studio' THEN 2 ELSE 1 END),0) AS tier FROM plan_grants WHERE user_id=? AND period=?").bind(userId,period).first<{tier:number}>();
  const plan=plans[entitlement?.tier??0];
  // Only work never sent to a provider expires automatically. Uncertain calls retain their hold.
  await db.prepare("UPDATE usage_operations SET status = 'released', actual_units = 0, quota_charged = 0, credits_charged = 0, updated_at = ? WHERE user_id = ? AND status = 'reserved' AND expires_at <= ?").bind(date.toISOString(), userId, date.toISOString()).run();
  return { period, plan };
}
export async function getBilling(db: D1Database, userId: string, date = new Date()) {
  const { period, plan } = await ensureBilling(db, userId, date);
  const result = await db.batch([
    db.prepare('SELECT plan_id, overage_enabled, credits_available, credits_reserved FROM billing_accounts WHERE user_id = ?').bind(userId),
    db.prepare('SELECT allowance, spent, reserved, allowance - spent - reserved AS available FROM usage_periods WHERE user_id = ? AND period = ?').bind(userId, period),
    db.prepare('SELECT id, operation_id, period, event, quota_delta, credits_delta, created_at FROM billing_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50').bind(userId)
  ]);
  const account = result[0].results[0] as Account;
  return { plan, period, quota: result[1].results[0] as { allowance: number; spent: number; reserved: number; available: number }, credits: { available: account.credits_available, reserved: account.credits_reserved, overageEnabled: !!account.overage_enabled }, ledger: result[2].results, checkoutEnabled: false };
}
export async function setOverage(db: D1Database, userId: string, enabled: boolean) {
  await ensureBilling(db, userId);
  await db.batch([
    db.prepare('UPDATE billing_accounts SET overage_enabled = ? WHERE user_id = ?').bind(enabled ? 1 : 0, userId),
    db.prepare("INSERT INTO activity_events (id,user_id,action,summary,created_at) VALUES (?,?,'billing.preference',?,?)").bind(crypto.randomUUID(), userId, enabled ? 'Enabled existing credits for quota overage' : 'Disabled credits for new operations', new Date().toISOString())
  ]);
}
export async function getOperation(db: D1Database, userId: string, id: string) {
  return db.prepare('SELECT * FROM usage_operations WHERE id = ? AND user_id = ?').bind(id, userId).first<Operation>();
}
export function usageReservationStatement(db:D1Database,userId:string,id:string,requestHash:string,units:number,period:string,date:Date,revision?:number){
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f]{64}$/.test(requestHash) || !Number.isSafeInteger(units) || units < 1 || units > 10000) throw new BillingError(400, 'Invalid usage reservation');
  return db.prepare(`INSERT INTO usage_operations
    (id,user_id,period,request_hash,quoted_units,quota_reserved,credits_reserved,created_at,updated_at,expires_at)
    SELECT ?, a.user_id, p.period, ?, ?, MIN(?, p.allowance-p.spent-p.reserved), MAX(0, ?-(p.allowance-p.spent-p.reserved)), ?, ?, ?
    FROM billing_accounts a JOIN usage_periods p ON p.user_id = a.user_id
    WHERE a.user_id = ? AND p.period = ? AND p.allowance-p.spent-p.reserved + CASE WHEN a.overage_enabled = 1 THEN a.credits_available ELSE 0 END >= ?
    AND (? IS NULL OR (EXISTS(SELECT 1 FROM workspace_state w WHERE w.user_id=a.user_id AND w.revision=?) AND NOT EXISTS(SELECT 1 FROM chat_turns t WHERE t.user_id=a.user_id AND t.status='pending')))
    ON CONFLICT(id) DO NOTHING RETURNING id`).bind(id, requestHash, units, units, units, date.toISOString(), date.toISOString(), new Date(date.getTime() + 300000).toISOString(), userId, period, units, revision??null, revision??null);
}
export async function reserveUsage(db: D1Database, userId: string, id: string, requestHash: string, units: number, date = new Date()) {
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f]{64}$/.test(requestHash) || !Number.isSafeInteger(units) || units < 1 || units > 10000) throw new BillingError(400, 'Invalid usage reservation');
  const { period } = await ensureBilling(db, userId, date);
  const result=await usageReservationStatement(db,userId,id,requestHash,units,period,date).first<{id:string}>();
  const operation = await getOperation(db, userId, id);
  if (!operation) throw new BillingError(402, 'Not enough available build units. Wait for a reset or enable existing credits.');
  if (operation.request_hash !== requestHash || operation.quoted_units !== units) throw new BillingError(409, 'This operation ID was already used for a different request');
  return { operation, created: result !== null };
}
export async function dispatchUsage(db: D1Database, userId: string, id: string, date = new Date()) {
  const result = await db.prepare("UPDATE usage_operations SET status = 'dispatched', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'reserved' AND expires_at > ?").bind(date.toISOString(), id, userId, date.toISOString()).run();
  return result.meta.changes === 1;
}
export async function uncertainUsage(db: D1Database, userId: string, id: string) {
  await db.prepare("UPDATE usage_operations SET status = 'uncertain', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'dispatched'").bind(new Date().toISOString(), id, userId).run();
}
export async function finishUsage(db: D1Database, userId: string, id: string, actualUnits: number, date = new Date()) {
  if (!Number.isSafeInteger(actualUnits) || actualUnits < 0) throw new BillingError(400, 'Invalid settled usage');
  const status = actualUnits === 0 ? 'released' : 'settled';
  // Recheck newly available monthly units at settlement before consuming held credits.
  const quota = 'MIN(?, quota_reserved + (SELECT allowance-spent-reserved FROM usage_periods WHERE user_id = usage_operations.user_id AND period = usage_operations.period))';
  await db.prepare(`UPDATE usage_operations SET status = ?, actual_units = ?, quota_charged = ${quota}, credits_charged = ? - ${quota}, updated_at = ?
    WHERE id = ? AND user_id = ? AND quoted_units >= ? AND (status IN ('dispatched','uncertain') OR (status = 'reserved' AND ? = 0))`)
    .bind(status, actualUnits, actualUnits, actualUnits, actualUnits, date.toISOString(), id, userId, actualUnits, actualUnits).run();
  const operation = await getOperation(db, userId, id);
  if (!operation || operation.status !== status || operation.actual_units !== actualUnits) throw new BillingError(409, 'Usage cannot be settled with these values');
  return operation;
}
/** Operator/payment fulfillment only; never expose a caller-selected credit grant in the public API. */
export async function grantCredits(db: D1Database, userId: string, grantId: string, units: number, reason: string) {
  if (!/^[0-9a-z:_-]{1,120}$/i.test(grantId) || !Number.isSafeInteger(units) || units < 1 || units > 100000 || !reason || reason.length > 200) throw new BillingError(400, 'Invalid credit grant');
  await ensureBilling(db, userId);
  await db.prepare('INSERT INTO credit_grants (id,user_id,units,reason,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(grantId, userId, units, reason, new Date().toISOString()).run();
  const grant = await db.prepare('SELECT user_id, units, reason FROM credit_grants WHERE id = ?').bind(grantId).first<{ user_id: string; units: number; reason: string }>();
  if (grant?.user_id !== userId || grant.units !== units || grant.reason !== reason) throw new BillingError(409, 'Credit grant ID already used');
}

/** Fulfillment boundary only. A provider adapter must verify payment, owner and calendar period first.
 * Never expose this function with caller-selected plans or periods in an HTTP/model tool. */
export async function grantPlan(db:D1Database,userId:string,id:string,period:string,planId:string,reference:string){
 if(!/^[0-9a-z:_-]{1,120}$/i.test(id)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||!['launch','studio'].includes(planId)||!reference||reference.length>200||/[\x00-\x1f\x7f]/.test(reference))throw new BillingError(400,'Invalid plan entitlement');
 await db.prepare('INSERT OR IGNORE INTO billing_accounts(user_id) VALUES(?)').bind(userId).run();
 try{await db.prepare('INSERT INTO plan_grants(id,user_id,period,plan_id,reference,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,userId,period,planId,reference,new Date().toISOString()).run();}
 catch(cause){const saved=await db.prepare('SELECT id FROM plan_grants WHERE id=? AND user_id=? AND period=? AND plan_id=? AND reference=?').bind(id,userId,period,planId,reference).first();if(!saved){if(String(cause).includes('UNIQUE constraint'))throw new BillingError(409,'Payment reference already fulfilled');throw cause;}}
 const receipt=await db.prepare('SELECT user_id,period,plan_id,reference FROM plan_grants WHERE id=?').bind(id).first<{user_id:string;period:string;plan_id:string;reference:string}>();
 if(receipt?.user_id!==userId||receipt.period!==period||receipt.plan_id!==planId||receipt.reference!==reference)throw new BillingError(409,'Plan grant ID already used');
 return receipt;
}
