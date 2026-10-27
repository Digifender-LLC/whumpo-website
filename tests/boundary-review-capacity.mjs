// WH-004 finding B1 regression (fixed by WH-181): one owner at a review cap must not block other owners. Review capacity
// counts only pending, unexpired, non-withdrawal rows, per project (25), per owner (100) and per platform with fair share;
// withdrawals are exempt. Offline: disposable SQLite (or `--d1` local D1) fixture, synthetic owners and projects, no
// network or credentials. See docs/boundary-audit.md#b1 and docs/review-retention.md.
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';

const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),raw=store.db,id=()=>crypto.randomUUID();
const {prepareBackendForm:prepare,confirmBackendForm:confirm}=m.backendForms,{sendChat,readChat}=m,{saveBackend,testBackend}=m.backend,{prepareBackendPublication,confirmBackendPublication}=m.backendPublication;
const service={fetch:async(_url,init)=>Response.json({ok:true,value:JSON.parse(init.body).input})};
const config={title:'Estimate your order',description:'Try a quantity.',buttonLabel:'Calculate',fields:[{key:'quantity',label:'Quantity',type:'number'}]};
async function owner(){const user=id(),authority=await workspaceFixture(raw,m,user);return {user,scope:await authority.scope()};}
async function chat(o,content){const state=await readChat(o.scope,o.user),turn=id(),result=await sendChat(o.scope,o.user,{id:turn,revision:state.state.revision,content},undefined,{backendRuntime:service});assert.equal(result.status,200,JSON.stringify(result));return turn;}
/** A project with a published website and a published tested backend: the target a form review needs. */
async function project(o){
 const {project,version}=await createFixtureProject(o.scope,o.user,'Synthetic','Synthetic capacity fixture');
 await chat(o,'/confirm '+await chat(o,'/publish '+version));
 const backend=id(),run=id(),publication=id();
 await saveBackend(o.scope,o.user,project,backend,'export default x=>x');await testBackend(o.scope,service,o.user,project,backend,run,{});
 await prepareBackendPublication(o.scope,o.user,project,publication,'publish',backend,run);await confirmBackendPublication(o.scope,o.user,publication);
 return project;
}
const form=(o,p,value=config)=>prepare(o.scope,o.user,p,id(),value);
const refused=async(promise)=>{try{await promise;return false;}catch(error){return error.status===409&&/review storage is full/.test(error.message);}};
const active=async(user)=>(await raw.prepare("SELECT count(*) n FROM backend_form_reviews WHERE user_id=? AND enabled=1 AND status='pending' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(user).first()).n;
try{
 const attacker=await owner();await paidPlan(raw,attacker.user,'business-pro');
 const victim=await owner(),victimProject=await project(victim),own=[];
 for(let n=0;n<5;n++)own.push(await project(attacker));
 // The attacker never confirms anything. The per-project cap (25) stops the first project...
 for(let n=0;n<25;n++)await form(attacker,own[0]);
 assert.ok(await refused(form(attacker,own[0])),'the 26th active review for one project is refused');
 // ...and the per-owner cap (100) stops the rest across their other projects.
 for(const p of own.slice(1,4))for(let n=0;n<25;n++)await form(attacker,p);
 assert.equal(await active(attacker.user),100);
 assert.ok(await refused(form(attacker,own[4])),'the 101st active review for one owner is refused');
 // B1: the victim is unaffected, and so is a withdrawal ("form off") by the attacker at their own cap.
 assert.equal((await form(victim,victimProject)).status,'pending');
 assert.equal((await form(attacker,own[4],null)).enabled,0);
 // Applied reviews stop counting: confirming one frees a slot for the same owner.
 const first=await raw.prepare("SELECT id FROM backend_form_reviews WHERE project_id=? AND enabled=1 ORDER BY rowid LIMIT 1").bind(own[0]).first();
 await confirm(attacker.scope,attacker.user,first.id);
 assert.equal(await active(attacker.user),99);
 assert.equal((await form(attacker,own[4])).status,'pending');
 assert.equal(await active(attacker.user),100);
 console.log('B1 not reproduced: review capacity is isolated per tenant (25 per project, 100 per owner, withdrawals exempt, applied rows free capacity).');
}catch(error){console.error(error.stack??error.message);process.exitCode=1;}
finally{await store.close?.();}
