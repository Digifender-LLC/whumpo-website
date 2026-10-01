import {paidPlan} from './helpers/paid-plan.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {getBilling}=await module('src/billing.ts'),{sendChat,readChat}=await module('src/chat.ts');
const dir=await mkdtemp('/tmp/tellumo-plans-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
async function account(){const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,id+'@example.com','00',new Date().toISOString()).run();return id;}
const stamp=new Date('2030-02-15T00:00:00Z'),period='2030-02',next=new Date('2030-03-01T00:00:00Z');
async function chat(user,content){const id=crypto.randomUUID(),state=await readChat(db,user);const result=await sendChat(db,user,{id,content,revision:state.state.revision});return {id,result};}
async function project(user,name){await chat(user,'/new');await chat(user,'A useful website');const p=await chat(user,name);const v=await chat(user,'/build clay');return {project:p.id,version:v.id};}
async function publish(user,version){const review=await chat(user,'/publish '+version);return chat(user,'/confirm '+review.id);}
try{
 // Paid receipts authorize current publication slots; a stale cache cannot bypass expiry.
 const sites=await account(),current=new Date().toISOString().slice(0,7),a=await project(sites,'Alpha'),c=await project(sites,'Beta');
 await paidPlan(db,sites,'personal');assert.equal((await publish(sites,a.version)).result.status,200);assert.equal((await publish(sites,c.version)).result.status,200);
 const noReceipt=await account(),one=await project(noReceipt,'One'),two=await project(noReceipt,'Two');assert.equal((await getBilling(db,noReceipt)).plan.id,'explore');assert.equal((await publish(noReceipt,one.version)).result.status,200);assert.equal((await publish(noReceipt,two.version)).result.status,409);
 // Existing sites remain editable above a downgraded cap; no new slot can be added.
 await db.prepare("INSERT INTO publications(project_id,version_id,revision) VALUES(?,?,1) ON CONFLICT(project_id) DO UPDATE SET version_id=excluded.version_id").bind(two.project,two.version).run();assert.equal((await publish(noReceipt,two.version)).result.status,200);const three=await project(noReceipt,'Three');assert.equal((await publish(noReceipt,three.version)).result.status,409);
 // Paid coverage uses exact intervals and highest current tier. A preference grants nothing.
 const modern=await account();const {saveCapacity,readCapacity}=await module('src/workspace-dashboard.ts');
 await saveCapacity(db,modern,{revision:0,preferred_plan:'personal',billing_interval:'year',draft_overage_cents:0});
 assert.equal((await readCapacity(db,modern)).preferences.preferred_plan,'personal');
 assert.equal((await getBilling(db,modern,stamp)).plan.id,'explore');
 for (const [tier,slots] of [['starter',1],['personal',5],['business',10],['business-pro',25]]) {
  await paidPlan(db,modern,tier,{start:Date.parse('2030-02-01')/1000,end:Date.parse('2030-03-01')/1000});
  const bill=await getBilling(db,modern,stamp);assert.equal(bill.plan.id,tier);assert.equal(bill.plan.publishedSites,slots);
 }
 assert.equal((await getBilling(db,modern,next)).plan.id,'explore');
 const {plans,publicPlans,quoteDomainBenefit}=await module('src/plans.ts');
 for(const plan of plans){const row=await db.prepare('SELECT published_sites FROM plan_catalog WHERE id=?').bind(plan.id).first();assert.equal(row.published_sites,plan.publishedSites);}
 assert.deepEqual(plans.slice(1).map(p=>[p.monthlyCents,p.annualCents]),[[1700,17000],[3000,30000],[7900,79000],[13900,139000]]);
 assert.ok(publicPlans.every(p=>!('monthlyUnits' in p)));
 assert.equal(quoteDomainBenefit('starter','year',1999,false).coveredCents,1999);
 assert.equal(quoteDomainBenefit('business-pro','year',3100,false).remainingWholesaleCents,1100);
 assert.equal(quoteDomainBenefit('business-pro','year',3100,false).annualDomainCount,2);
 assert.equal(quoteDomainBenefit('starter','month',1500,false).coveredCents,0);
 assert.equal(quoteDomainBenefit('starter','year',1500,true).coveredCents,0);
 assert.equal(quoteDomainBenefit('starter','year',1500,false).redemptionEnabled,false);
 assert.throws(()=>quoteDomainBenefit('unknown','year',1500,false));
 const pricing=await chat(modern,'/plans');assert.equal(pricing.result.status,200);assert.match((await readChat(db,modern)).turns.at(-1).assistant_text,/Starter: \$17/);
 console.log('Plan coverage passed: invoice intervals, highest current tier, expiry, preferences without authority, current publication limits and domain quote policy.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
