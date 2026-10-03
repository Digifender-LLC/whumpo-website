import {createFixtureProject,currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),{getBilling,sendChat,readChat,saveCapacity,readCapacity,plans,publicPlans,quoteDomainBenefit}=m;
const fixture=await databaseFixture({d1:true}),rawDB=fixture.db,identities=new Map();
async function account(){const a=await workspaceFixture(rawDB,m);identities.set(a.account,await a.scope());return a.account;}
const scope=user=>identities.get(user);
const stamp=new Date('2030-02-15T00:00:00Z'),period='2030-02',next=new Date('2030-03-01T00:00:00Z');
async function chat(user,content){const db=scope(user),id=crypto.randomUUID(),state=await readChat(db,user);const result=await sendChat(db,user,{id,content,revision:state.state.revision});return {id,result};}
async function project(user,name){return createFixtureProject(scope(user),user,name,'A useful website','clay');}
async function publish(user,version){const review=await chat(user,'/publish '+version);return chat(user,'/confirm '+review.id);}
try{
 // Paid receipts authorize current publication slots; a stale cache cannot bypass expiry.
 const sites=await account(),current=new Date().toISOString().slice(0,7),a=await project(sites,'Alpha'),c=await project(sites,'Beta');
 await paidPlan(rawDB,sites,'personal');assert.equal((await publish(sites,a.version)).result.status,200);assert.equal((await publish(sites,c.version)).result.status,200);
 const noReceipt=await account(),one=await project(noReceipt,'One'),two=await project(noReceipt,'Two');assert.equal((await getBilling(scope(noReceipt),noReceipt)).plan.id,'explore');assert.equal((await publish(noReceipt,one.version)).result.status,200);assert.equal((await publish(noReceipt,two.version)).result.status,409);
 // Existing sites remain editable above a downgraded cap; no new slot can be added.
 await rawDB.prepare("INSERT INTO publications(project_id,version_id,revision) VALUES(?,?,1) ON CONFLICT(project_id) DO UPDATE SET version_id=excluded.version_id").bind(two.project,two.version).run();assert.equal((await publish(noReceipt,two.version)).result.status,200);const three=await project(noReceipt,'Three');assert.equal((await publish(noReceipt,three.version)).result.status,409);
 // Paid coverage uses exact intervals and highest current tier. A preference grants nothing.
 const modern=await account();
 await saveCapacity(scope(modern),modern,{revision:0,preferred_plan:'personal',billing_interval:'year',draft_overage_cents:0});
 assert.equal((await readCapacity(scope(modern),modern)).preferences.preferred_plan,'personal');
 assert.equal((await getBilling(scope(modern),modern,stamp)).plan.id,'explore');
 for (const [tier,slots] of [['starter',1],['personal',5],['business',10],['business-pro',25]]) {
  await paidPlan(rawDB,modern,tier,{start:Date.parse('2030-02-01')/1000,end:Date.parse('2030-03-01')/1000});
  const bill=await getBilling(scope(modern),modern,stamp);assert.equal(bill.plan.id,tier);assert.equal(bill.plan.publishedSites,slots);
 }
 assert.equal((await getBilling(scope(modern),modern,next)).plan.id,'explore');
 for(const plan of plans){const row=await rawDB.prepare('SELECT published_sites FROM plan_catalog WHERE id=?').bind(plan.id).first();assert.equal(row.published_sites,plan.publishedSites);}
 assert.deepEqual(plans.slice(1).map(p=>[p.monthlyCents,p.annualCents]),[[1700,17000],[3000,30000],[7900,79000],[13900,139000]]);
 assert.ok(publicPlans.every(p=>!('monthlyUnits' in p)));
 assert.equal(quoteDomainBenefit('starter','year',1999,false).coveredCents,1999);
 assert.equal(quoteDomainBenefit('business-pro','year',3100,false).remainingWholesaleCents,1100);
 assert.equal(quoteDomainBenefit('business-pro','year',3100,false).annualDomainCount,2);
 assert.equal(quoteDomainBenefit('starter','month',1500,false).coveredCents,0);
 assert.equal(quoteDomainBenefit('starter','year',1500,true).coveredCents,0);
 assert.equal(quoteDomainBenefit('starter','year',1500,false).redemptionEnabled,false);
 assert.throws(()=>quoteDomainBenefit('unknown','year',1500,false));
 const pricing=await chat(modern,'/plans');assert.equal(pricing.result.status,200);assert.match((await readChat(scope(modern),modern)).turns.at(-1).assistant_text,/Starter: \$17/);
 console.log('Plan coverage passed: invoice intervals, highest current tier, expiry, preferences without authority, current publication limits and domain quote policy.');
}finally{await fixture.close();}
