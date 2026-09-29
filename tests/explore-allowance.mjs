import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import wrangler from 'wrangler';
const { getPlatformProxy } = wrangler;
import { build } from 'esbuild';
const bundle=await build({entryPoints:['src/billing.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {getBilling,reserveUsage,dispatchUsage,finishUsage,grantCredits,setOverage,uncertainUsage,getOperation}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const directory = await mkdtemp('/tmp/whumpo-billing-');
execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',directory], {stdio:'pipe'});
const proxy=await getPlatformProxy({persist:{path:directory+'/v3'},remoteBindings:false});
const db=proxy.env.DB;
const hash='a'.repeat(64), uid=crypto.randomUUID();
async function account(){const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,id+'@example.com','00',new Date().toISOString()).run();return id;}
try {
 const user=await account();const state=await getBilling(db,user);const period=state.period;
 await db.prepare('UPDATE usage_periods SET allowance=25 WHERE user_id=? AND period=?').bind(user,period).run();
 await grantCredits(db,user,'migration-credit',100,'synthetic');
 const op=(await reserveUsage(db,user,crypto.randomUUID(),hash,10)).operation;await dispatchUsage(db,user,op.id);await finishUsage(db,user,op.id,6);
 const held=(await reserveUsage(db,user,crypto.randomUUID(),hash,10)).operation;await dispatchUsage(db,user,held.id);
 await db.prepare("INSERT INTO usage_periods(user_id,period,allowance,spent) VALUES(?,'2020-01',25,5)").bind(user).run();
 const paid=await account();await getBilling(db,paid);await db.prepare('UPDATE usage_periods SET allowance=250 WHERE user_id=? AND period=?').bind(paid,period).run();
 const migrate=()=>execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','whumpo-control','--local','--persist-to',directory,'--file','migrations/0032_explore_allowance.sql'],{stdio:'pipe'});
 migrate();migrate();
 const after=await getBilling(db,user);assert.deepEqual(after.quota,{allowance:50,spent:6,reserved:10,available:34});assert.equal(after.credits.available,100);
 assert.equal(after.ledger.filter(x=>x.event==='allowance_increase').length,1);
 assert.equal((await db.prepare("SELECT allowance FROM usage_periods WHERE user_id=? AND period='2020-01'").bind(user).first()).allowance,25);
 assert.equal((await getBilling(db,paid)).quota.allowance,250);
 await finishUsage(db,user,held.id,8);assert.equal((await getBilling(db,user)).quota.spent,14);
 const late=await account();await getBilling(db,late);await db.prepare("INSERT INTO usage_periods(user_id,period,allowance) VALUES(?,'2099-01',25)").bind(late).run();
 assert.equal((await db.prepare("SELECT allowance FROM usage_periods WHERE user_id=? AND period='2099-01'").bind(late).first()).allowance,50);
 console.log('Explore allowance migration preserves spend, dispatched holds, credits, paid tiers and historical periods; replay is idempotent and old-Worker inserts receive the new ceiling.');
} finally {await proxy.dispose();await rm(directory,{recursive:true,force:true});}
