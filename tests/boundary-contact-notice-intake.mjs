import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {currentSiteFixtureHandlers,createFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
Error.stackTraceLimit=0;
// WH-004 B9/B10: one owner's contact notices must not keep other tenants' notices out of the outbox (B9: submissions a
// per-destination cap refuses) or out of the every-minute drain (B10: a backlog filling the dispatcher's scan window).
// Synthetic provider only; SQLite by default, local D1 with --d1.
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:process.argv.includes('--d1')}),db=store.db,N=m.contactNotifications;
const bundled=await build({stdin:{contents:"export * from './src/job-dispatcher';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const {dispatchJobs}=await import('data:text/javascript,'+encodeURIComponent(bundled.outputFiles[0].text));
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network call is permitted');};
const now=()=>new Date().toISOString(),run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
const settings={provider:'fixture-provider',review:'review-1',sendCeiling:1000},sent=[];
const send=async notice=>{sent.push(notice);return {accepted:true,providerRef:'ref-'+sent.length};};
async function owner(plan){
 const id=crypto.randomUUID(),scope=await (await workspaceFixture(db,m,id)).scope();await m.readChat(scope,id);if(plan)await paidPlan(db,id,plan);
 const chat=async content=>{const s=await m.readChat(scope,id);const input={id:crypto.randomUUID(),revision:s.state.revision,content};return {id:input.id,result:await m.sendChat(scope,id,input)};};
 /** A published project with an open contact form and a verified notice destination. */
 const project=async()=>{
  const project=crypto.randomUUID();
  await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden fixture','Testing','draft',?,?)",project,id,now(),now());
  const v=await createFixtureWebsite(scope,id,project,{name:'Garden',headline:'Garden',description:'Testing',theme:'ocean',aboutTitle:'About',aboutText:'Testing',sections:[],photos:[]});
  const pub=await chat('/confirm '+(await chat('/publish '+v)).id);assert.equal(pub.result.status,200,JSON.stringify(pub.result).slice(0,400));
  const on=await chat('/confirm-contact '+(await chat('/contact-on '+project)).id);assert.equal(on.result.status,200,JSON.stringify(on.result).slice(0,400));
  const revision=(await m.contacts.activeContact(db,project)).revision;
  await N.proposeContactDestination(db,id,project,`owner-${project.slice(0,8)}@example.com`);
  assert.equal((await N.requestContactVerification(db,settings,id,project)).status,'queued');
  await N.runContactDelivery(db,settings,send,{limit:25});
  const code=(await row('SELECT verification_code c FROM contact_notification_destinations WHERE project_id=?',project)).c;
  await N.confirmContactDestination(db,id,project,code);
  return {project,submit:()=>m.contacts.saveContact(db,project,revision,{id:crypto.randomUUID(),name:'Visitor',email:'visitor@example.com',message:'Hello'})};
 };
 return {id,project};
}
const queued=project=>row("SELECT count(*) n FROM contact_notification_outbox WHERE project_id=? AND kind='new_message'",project).then(r=>r.n);
const sentTo=project=>sent.filter(n=>n.projectId===project&&n.kind==='new_message').length;
/** The every-minute branch of scheduled() in src/index.ts, with the fixture provider. */
const minute=()=>dispatchJobs([{type:'contact_delivery',run:ctx=>N.runContactDelivery(db,settings,send,{scan:25,claim:ctx.claim,provider:ctx.provider})}]);
try{
 // Personal allows five live sites, so one owner can hold three verified destinations.
 const noisy=await owner('personal'),quiet=await owner();
 const noisyA=await noisy.project(),noisyB=await noisy.project(),noisyC=await noisy.project(),quietSite=await quiet.project();
 // B9. The noisy owner sends 20 messages to one form in one hour (the project's hourly cap; two connections at 10 each).
 for(let i=0;i<20;i++)await noisyA.submit();
 await N.runContactDelivery(db,settings,async()=>({accepted:false,retryable:true}),{scan:0});
 assert.equal(await queued(noisyA.project),10,'the destination hourly cap queues 10');
 // A bystander tenant's visitor writes once; the next intake must queue that notice although 10 refused rows are older.
 await quietSite.submit();
 await N.runContactDelivery(db,settings,send,{scan:0});
 assert.equal(await queued(quietSite.project),1,"another tenant's notice is queued although the noisy destination is at its cap");
 assert.equal(await queued(noisyA.project),10,'the noisy destination stays at its hourly cap');
 // B10. Twenty more noisy notices from two other projects, all due before the bystander's: 30 > the 25-row scan window.
 for(const p of [noisyB,noisyC])for(let i=0;i<10;i++)await p.submit();
 for(let i=0;i<3;i++)await N.runContactDelivery(db,settings,send,{scan:0});
 assert.equal(await queued(noisyB.project)+await queued(noisyC.project),20);
 await run("UPDATE contact_notification_outbox SET next_attempt_at=? WHERE project_id IN (?,?,?) AND state='queued'",new Date(Date.now()-60000).toISOString(),noisyA.project,noisyB.project,noisyC.project);
 await minute();
 assert.equal(sentTo(quietSite.project),1,"the bystander's notice is sent in the first minute despite the noisy backlog");
 assert.equal(sentTo(noisyA.project)+sentTo(noisyB.project)+sentTo(noisyC.project),2,'the noisy owner still gets its two claims');
 // Negative control: once the noisy hour has passed, its refused messages queue again.
 await N.runContactDelivery(db,settings,send,{now:new Date(Date.now()+3601000),scan:0});
 assert.equal(await queued(noisyA.project),20,'refused notices are queued when the window allows');
 console.log(`Contact notice fairness passed (${process.argv.includes('--d1')?'local D1':'SQLite'}).`);
}finally{globalThis.fetch=originalFetch;await store.close?.();}
