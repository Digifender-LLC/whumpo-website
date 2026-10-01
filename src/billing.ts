import { plans } from './plans';

export class BillingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Current paid invoice coverage only. No coverage means Explore; invalid coverage is an error. */
export async function ensureBilling(db: Pick<D1Database, 'prepare'>, userId: string, date = new Date()) {
  if (!Number.isFinite(date.getTime())) throw new BillingError(400, 'Invalid billing date');
  const at = Math.floor(date.getTime() / 1000);
  const {results} = await db.prepare('SELECT DISTINCT plan_id FROM plan_entitlements WHERE user_id=? AND starts_at<=? AND ends_at>?').bind(userId, at, at).all<{plan_id:string}>();
  let plan: typeof plans[number] = plans[0];
  for (const receipt of results) {
    const index = plans.findIndex(p => p.id === receipt.plan_id);
    if (index < 1) throw new BillingError(409, 'Unknown subscription plan. Billing needs review.');
    if (index > plans.indexOf(plan)) plan = plans[index];
  }
  return { period: date.toISOString().slice(0, 7), plan };
}
export async function getBilling(db: D1Database, userId: string, date = new Date()) {
  const {period, plan} = await ensureBilling(db, userId, date);
  const {results: requests} = await db.prepare('SELECT id,state,created_at FROM standard_ai_requests WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 20').bind(userId).all();
  return {plan, period, standardAI: {creditCharge: 0, requests}};
}
