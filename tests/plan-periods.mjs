import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {getBilling,grantPlan,grantCredits,reserveUsage,dispatchUsage,finishUsage,ensureBilling}=await module('src/billing.ts'),{sendChat,readChat}=await module('src/chat.ts');
const dir=await mkdtemp('/tmp/tellumo-plans-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe'});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
async function account(){const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,id+'@example.com','00',new Date().toISOString()).run();return id;}
const stamp=new Date('2030-02-15T00:00:00Z'),period='2030-02',next=new Date('2030-03-01T00:00:00Z');
async function chat(user,content){const id=crypto.randomUUID(),state=await readChat(db,user);const result=await sendChat(db,user,{id,content,revision:state.state.revision});return {id,result};}
async function project(user,name){await chat(user,'/new');await chat(user,'A useful website');const p=await chat(user,name);const v=await chat(user,'/build clay');return {project:p.id,version:v.id};}
async function publish(user,version){const review=await chat(user,'/publish '+version);return chat(user,'/confirm '+review.id);}
try{
 const user=await account(),other=await account();await ensureBilling(db,user,stamp);await grantCredits(db,user,'credits-fixture',100,'Test credits');
 const op=crypto.randomUUID();await reserveUsage(db,user,op,'a'.repeat(64),20,stamp);await dispatchUsage(db,user,op,stamp);
 await Promise.all([grantPlan(db,user,'launch-paid',period,'launch','invoice-launch'),grantPlan(db,user,'launch-paid',period,'launch','invoice-launch')]);
 let b=await getBilling(db,user,stamp);assert.equal(b.plan.id,'launch');assert.equal(b.quota.allowance,250);assert.equal(b.quota.reserved,20);assert.equal(b.credits.available,100);
 await finishUsage(db,user,op,12,stamp);await grantPlan(db,user,'studio-paid',period,'studio','invoice-upgrade');b=await getBilling(db,user,stamp);assert.equal(b.quota.allowance,800);assert.equal(b.quota.spent,12);assert.equal(b.quota.available,788);
 await grantPlan(db,user,'late-launch',period,'launch','invoice-late-launch');b=await getBilling(db,user,stamp);assert.equal(b.plan.id,'studio');assert.equal(b.quota.allowance,800);
 const ledger=await db.prepare("SELECT SUM(quota_delta) delta FROM billing_ledger WHERE user_id=? AND period=? AND event IN ('monthly_allowance','plan_entitlement')").bind(user,period).first();assert.equal(ledger.delta,800);
 await assert.rejects(()=>grantPlan(db,other,'launch-paid',period,'launch','invoice-launch'));await assert.rejects(()=>grantPlan(db,user,'another-id',period,'launch','invoice-launch'));await assert.rejects(()=>grantPlan(db,user,'launch-paid','2030-03','launch','invoice-launch'));await assert.rejects(()=>grantPlan(db,user,'bad','2030-13','launch','invoice-bad'));
 // Late settlement stays with its original month; credits and current-month quota are independent.
 const held=crypto.randomUUID();await reserveUsage(db,user,held,'b'.repeat(64),15,stamp);await dispatchUsage(db,user,held,stamp);
 b=await getBilling(db,user,next);assert.equal(b.plan.id,'explore');assert.equal(b.quota.allowance,25);assert.equal(b.credits.available,100);await finishUsage(db,user,held,10,next);assert.equal((await getBilling(db,user,next)).quota.spent,0);assert.equal((await getBilling(db,user,stamp)).quota.spent,22);
 await grantPlan(db,user,'renew-launch','2030-03','launch','invoice-renewal');b=await getBilling(db,user,next);assert.equal(b.plan.id,'launch');assert.equal(b.quota.allowance,250);assert.equal(b.quota.spent,0);assert.equal(b.credits.available,100);
 // An entitlement before first use creates exactly one period allowance at that tier.
 const future=await account();await grantPlan(db,future,'future-paid','2031-01','studio','future-invoice');await Promise.all([ensureBilling(db,future,new Date('2031-01-01')),ensureBilling(db,future,new Date('2031-01-01'))]);assert.equal((await db.prepare("SELECT SUM(quota_delta) delta FROM billing_ledger WHERE user_id=? AND period='2031-01'").bind(future).first()).delta,800);
 await assert.rejects(()=>db.prepare("UPDATE plan_grants SET plan_id='studio' WHERE id='launch-paid'").run());await assert.rejects(()=>db.prepare("DELETE FROM plan_grants WHERE id='launch-paid'").run());
 // Lost grant acknowledgement is recovered from the exact immutable receipt.
 let lost=false;const lossy=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.startsWith('INSERT INTO plan_grants'))return statement;return {bind(...values){const bound=statement.bind(...values);return {async run(){await bound.run();lost=true;throw Error('Lost acknowledgement');}};}};};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 await grantPlan(lossy,user,'recovered','2030-04','launch','invoice-recovered');assert.ok(lost);assert.equal((await getBilling(db,user,new Date('2030-04-01'))).quota.allowance,250);
 // Paid receipts authorize current publication slots; a stale cache cannot bypass expiry.
 const sites=await account(),current=new Date().toISOString().slice(0,7),a=await project(sites,'Alpha'),c=await project(sites,'Beta');
 await grantPlan(db,sites,'current-plan',current,'launch','invoice-current');assert.equal((await publish(sites,a.version)).result.status,200);assert.equal((await publish(sites,c.version)).result.status,200);
 const noReceipt=await account(),one=await project(noReceipt,'One'),two=await project(noReceipt,'Two');await db.prepare("UPDATE billing_accounts SET plan_id='studio' WHERE user_id=?").bind(noReceipt).run();assert.equal((await getBilling(db,noReceipt)).plan.id,'explore');assert.equal((await publish(noReceipt,one.version)).result.status,200);assert.equal((await publish(noReceipt,two.version)).result.status,409);
 // Existing sites remain editable above a downgraded cap; no new slot can be added.
 await db.prepare("INSERT INTO publications(project_id,version_id,revision) VALUES(?,?,1) ON CONFLICT(project_id) DO UPDATE SET version_id=excluded.version_id").bind(two.project,two.version).run();assert.equal((await publish(noReceipt,two.version)).result.status,200);const three=await project(noReceipt,'Three');assert.equal((await publish(noReceipt,three.version)).result.status,409);
 console.log('Plan periods passed: atomic upgrades preserve usage/holds, receipt replay/ownership/reference protection, ledger totals, no paid rollover without renewal, downgrade renewal, persistent credits, late settlement, lost acknowledgement and current-period publication limits.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
