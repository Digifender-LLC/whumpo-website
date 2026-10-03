import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {featurePreviewInput,runFeaturePreviewOperator} from '../tools/feature-preview-input.mjs';
const bundled=await build({stdin:{contents:"export * from './src/feature-inclusion';export * from './src/feature-preview-grants';export * from './src/billing';export * from './src/plan-features';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const service=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const {resolveFeatureInclusion:resolve,issueFeaturePreviewGrant:issue,revokeFeaturePreviewGrant:revoke,readFeaturePreviewGrant:read,ensureBilling}=service;

const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID(),at=Date.parse('2030-02-15T12:00:00Z')/1000,date=n=>new Date(n*1000);
async function owner(){const user=id();await db.prepare("INSERT INTO users VALUES(?,?,?)").bind(user,user+'@example.invalid',date(at).toISOString()).run();return user;}
async function project(user){const p=id();await db.prepare("INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,'Fixture',?,?)").bind(p,user,date(at).toISOString(),date(at).toISOString()).run();return p;}
const request=(userId,projectId=null,featureId='connections.github',operation='read')=>({userId,projectId,featureId,operation});
const grant=(r,extra={})=>({id:id(),...r,purpose:'private-test-acceptance',reviewReference:'https://github.com/zemdregon/whumpo/issues/63',startsAt:at,endsAt:at+3600,...extra});
let checks=0;
async function included(r,expected,time=at){const result=await resolve(db,r,date(time));assert.equal(result.included,expected);assert.equal(result.purpose,'inclusion-only');assert.equal(Object.hasOwn(result,'allowed'),false);checks++;return result;}
try{
 // Expected sets are independent product requirements, not read from the tier mapping under test.
 const ids=service.launchFeatureCatalogue.features.map(f=>f.id),common=ids.filter(f=>f.startsWith('core.')||f==='ai.standard'),creator=ids.filter(f=>f.startsWith('creator.')),business=ids.filter(f=>f.startsWith('connections.')||f.startsWith('business.'));
 for(const [tier,wanted] of [['explore',[]],['starter',common],['personal',[...common,...creator]],['business',[...common,...creator,...business]],['business-pro',ids]]){
  const user=await owner(),p=await project(user);if(tier!=='explore')await paidPlan(db,user,tier,{start:at-100,end:at+100});
  for(const feature of ids)for(const operation of service.featureOperations){const result=await included(request(user,p,feature,operation),wanted.includes(feature));assert.equal(result.planId,tier);if(result.included)assert.equal(result.source.kind,'invoice');}
  await included(request(user,p,'pro.members'),false,at+100);
 }
 const user=await owner(),other=await owner(),p=await project(user),p2=await project(user),foreign=await project(other);
 await db.prepare("INSERT INTO capacity_preferences(user_id,preferred_plan,billing_interval,draft_overage_cents,revision,updated_at) VALUES(?,'business-pro','year',0,0,?)").bind(user,date(at).toISOString()).run();
 await included(request(user),false); // Preference and Explore grant nothing.
 for(const invalid of [{...request(user),featureId:'connections.unknown'},{...request(user),featureId:'constructor'},{...request(user),operation:'*'},{...request(user),role:'owner'},{userId:user,featureId:'connections.github',operation:'read'},{...request(user),projectId:'*'}])await assert.rejects(resolve(db,invalid,date(at)),e=>e.status===400);
 await assert.rejects(resolve(db,request(user,foreign),date(at)),e=>e.status===404);
 await assert.rejects(resolve(db,request(id()),date(at)),e=>e.status===404);
 await assert.rejects(resolve(db,request(user),new Date(NaN)),e=>e.status===400);
 const g=grant(request(user,p));const issued=await issue(db,g,'local',date(at));assert.equal(issued.state,'active');assert.deepEqual(await issue(db,g,'local',date(at+1)),issued);
 const result=await included(request(user,p),true);assert.equal(result.source.grantId,g.id);assert.equal(result.planId,'explore');assert.equal((await ensureBilling(db,user,date(at))).plan.id,'explore');
 for(const r of [request(user),request(user,p2),request(user,p,'connections.cloudflare'),request(user,p,'connections.github','dispatch'),request(other)])await included(r,false);
 const accountGrant=grant(request(user));await issue(db,accountGrant,'local',date(at));await included(request(user),true);await included(request(user,p2),false);
 await included(request(user,p),false,at-1);await included(request(user,p),true,at+3599);await included(request(user,p),false,at+3600);
 const closed=await revoke(db,{userId:user,projectId:p},g.id,'local',date(at+10));assert.equal(closed.state,'revoked');await included(request(user,p),false,at+11);
 assert.deepEqual(await revoke(db,{userId:user,projectId:p},g.id,'local',date(at+11)),closed);
 assert.equal((await issue(db,g,'local',date(at+11))).state,'revoked'); // Replay cannot renew or reactivate.
 await assert.rejects(issue(db,{...g,endsAt:at+4000},'local',date(at+12)),e=>e.status===409);
 await assert.rejects(read(db,{userId:other,projectId:null},g.id,date(at)),e=>e.status===404);
 await assert.rejects(revoke(db,{userId:user,projectId:foreign},g.id,'local',date(at)),e=>e.status===404);
 for(const bad of [{endsAt:at+604801},{purpose:'customer-request'},{operation:'all'},{projectId:foreign},{reviewReference:'x\nsecret'},{id:'old-id'}])await assert.rejects(issue(db,{...grant(request(user,p)),...bad},'local',date(at)));
 await assert.rejects(issue(db,grant(request(user,p)),'production',date(at)),e=>e.status===403);
 await assert.rejects(issue(db,grant(request(user,p),{startsAt:at+604801,endsAt:at+604802}),'local',date(at)),e=>e.status===400);
 await assert.rejects(issue(db,grant(request(user,p),{startsAt:at-10,endsAt:at}),'local',date(at)),e=>e.status===400);
 const scheduled=grant(request(user,p),{startsAt:at+100,endsAt:at+200});await issue(db,scheduled,'local',date(at));await included(request(user,p),false,at+99);await included(request(user,p),true,at+100);await included(request(user,p),false,at+200);
 // Immutable DB authority, not only checks in the issuing helper.
 for(const change of ["revoked_at=NULL","project_id=NULL","ends_at=ends_at+1","purpose='customer-request'","feature_id='pro.members'"])await assert.rejects(db.prepare('UPDATE feature_preview_grants SET '+change+' WHERE id=?').bind(g.id).run());
 await assert.rejects(db.prepare('DELETE FROM feature_preview_grants WHERE id=?').bind(g.id).run(),/retained/);
 await assert.rejects(db.prepare("INSERT INTO feature_preview_grants SELECT ?,contract_version,user_id,?,feature_id,operation,purpose,review_reference,starts_at,ends_at,created_at,revoked_at FROM feature_preview_grants WHERE id=?").bind(id(),foreign,accountGrant.id).run(),/feature_preview_owner/);
 const concurrent=grant(request(user,p2,'connections.cloudflare'));
 const twins=await Promise.all([issue(db,concurrent,'local',date(at)),issue(db,concurrent,'local',date(at))]);assert.deepEqual(twins[0],twins[1]);assert.equal((await db.prepare('SELECT count(*) n FROM feature_preview_grants WHERE id=?').bind(concurrent.id).first()).n,1);
 const swap=grant(request(user,p));await issue(db,swap,'local',date(at));await db.prepare('UPDATE projects SET owner_user_id=? WHERE id=?').bind(other,p).run();await assert.rejects(resolve(db,request(user,p),date(at)),e=>e.status===404);await included(request(other,p),false);await db.prepare('UPDATE projects SET owner_user_id=? WHERE id=?').bind(user,p).run();
 // Exact annual invoice coverage survives calendar boundaries; overlapping higher coverage expires precisely.
 const annual=await owner();await paidPlan(db,annual,'personal',{start:at-86400,end:at+365*86400});await paidPlan(db,annual,'business',{start:at-10,end:at+50});
 assert.equal((await included(request(annual),true)).source.endsAt,at+50);
 const after=await included(request(annual),false,at+50);assert.equal(after.planId,'personal');await included(request(annual,null,'creator.brand-kits'),true,at+200*86400);await included(request(annual,null,'creator.brand-kits'),false,at+365*86400);
 await paidPlan(db,annual,'business',{start:at+100,end:at+200});await included(request(annual),false,at+99);await included(request(annual),true,at+100);
 // Invalid coverage cannot silently use an explicit preview grant or a lower tier.
 const malformed={prepare:q=>q.includes('plan_entitlements')?{bind:()=>({all:async()=>({results:[{plan_id:'unknown',starts_at:at-1,ends_at:at+1}]})})}:db.prepare(q)};
 await assert.rejects(resolve(malformed,request(user),date(at)),e=>e.status===409);
 // Readback after lost commit acknowledgement returns the single retained grant/revocation.
 let lost='insert';const uncertain={prepare(q){const stmt=db.prepare(q),wrap=s=>({bind:(...args)=>wrap(s.bind(...args)),first:(...args)=>s.first(...args),all:(...args)=>s.all(...args),run:async()=>{const result=await s.run();if(lost==='insert'&&q.startsWith('INSERT INTO feature_preview_grants')||lost==='revoke'&&q.startsWith('UPDATE feature_preview_grants')){lost=null;throw Error('lost acknowledgement');}return result;}});return wrap(stmt);}};
 const lostGrant=grant(request(user,p2));await issue(uncertain,lostGrant,'local',date(at));assert.equal((await db.prepare('SELECT count(*) n FROM feature_preview_grants WHERE id=?').bind(lostGrant.id).first()).n,1);lost='revoke';assert.equal((await revoke(uncertain,{userId:user,projectId:p2},lostGrant.id,'local',date(at+5))).state,'revoked');
 // Operator preview and its destination-bound digest do not mutate. No caller/model flags grant authority.
 const input={version:1,command:'issue',grant:grant(request(user,p2,'connections.cloudflare','connect'))},realm={environment:'local',accountId:'a'.repeat(32),databaseId:id()};
 const parsed=featurePreviewInput(JSON.stringify(input),service),before=(await db.prepare('SELECT count(*) n FROM feature_preview_grants').first()).n;
 const preview=await runFeaturePreviewOperator(service,db,parsed,realm,undefined,date(at));assert.equal(preview.mutated,false);assert.equal((await db.prepare('SELECT count(*) n FROM feature_preview_grants').first()).n,before);
 await assert.rejects(runFeaturePreviewOperator(service,db,parsed,{...realm,databaseId:id()},preview.digest,date(at)),/exact/);
 await assert.rejects(runFeaturePreviewOperator(service,db,{...parsed,grant:{...parsed.grant,operation:'dispatch'}},realm,preview.digest,date(at)),/exact/);
 const applied=await runFeaturePreviewOperator(service,db,parsed,realm,preview.digest,date(at));assert.equal(applied.grant.id,input.grant.id);
 for(const bad of [{...input,version:0},{...input,automatic:true},{...input,grant:{...input.grant,modelApproved:true}},{version:1,command:'revoke',scope:{userId:user},id:g.id}])assert.throws(()=>featurePreviewInput(JSON.stringify(bad),service));
 // Parent cleanup is permitted; terminal IDs remain while their own scope exists.
 await db.prepare('DELETE FROM projects WHERE id=?').bind(p2).run();assert.equal((await db.prepare('SELECT count(*) n FROM feature_preview_grants WHERE project_id=?').bind(p2).first()).n,0);
 await db.prepare('DELETE FROM users WHERE id=?').bind(user).run();assert.equal((await db.prepare('SELECT count(*) n FROM feature_preview_grants WHERE user_id=?').bind(user).first()).n,0);
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 console.log(`Feature inclusion passed: ${checks} tier/feature/operation/scope decisions plus actual-schema expiry, revocation, immutable receipts, annual coverage, lost acknowledgement, operator review and parent cleanup checks. Inclusion only; no provider or customer operation is dispatched.`);
}catch(error){console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled service>'));process.exitCode=1;}finally{await fixture.close();}
