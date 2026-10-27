import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject,proposeFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
// Specification and service-client reviews store a reply_digest in project_spec_chat_links / service_client_chat_links.
// specificationApply and serviceClientApply must refuse after the reviewed reply text changed, before any version is saved,
// and the version INSERT re-checks the exact text. Run `node tests/digest-gap-specification.mjs` or add `--d1`.
const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db,id=()=>crypto.randomUUID();
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},origin='https://whumpo.com';
let checks=0;const equal=(a,b,msg)=>{assert.equal(a,b,msg);checks++;};
const row=(q,...p)=>db.prepare(q).bind(...p).first();
async function http(o,path,method='GET',body){
 const response=await m.worker.fetch(new Request(origin+path,{method,headers:{origin,'content-type':'application/json',cookie:'__Host-whumpo_session='+o.token},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{waitUntil:()=>{}});
 return {status:response.status,json:await response.json().catch(()=>null)};
}
const control=async(o,action)=>{const turn=id(),r=await http(o,'/api/chat/actions','POST',{id:turn,revision:(await http(o,'/api/chat')).json.state.revision,action});return {turn,...r};};
const text=turn=>row('SELECT assistant_text t FROM chat_turns WHERE id=?',turn).then(r=>r.t);
const setText=(turn,t)=>db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=?').bind(t,turn).run();
// Both kinds: altered text refuses, nothing is saved, the restored text confirms.
async function gap(o,label,action,saved){
 const original=await text(action.reviewId);await setText(action.reviewId,original+' (altered)');
 equal((await control(o,action)).status,409,label+': altered reply is not confirmed');
 equal(await saved(),0,label+': altered reply saved nothing');
 await setText(action.reviewId,original);
 equal((await control(o,action)).status,200,label+': restored reply confirms');
 equal(await saved(),1,label+': saved once');
}
try{
 const o=await workspaceFixture(db,m),scope=await o.scope(),site=await createFixtureProject(scope,o.account,'Digest garden','A synthetic website.');
 // Specification.
 const q=await proposeFixtureWebsite(scope,o.account,site.project,[{type:'modules.put',instance:{id:'members',kind:'access',...(()=>{const e=m.moduleCatalog.find(x=>x.kind==='access');return {module:{...e.module},schema:{...e.schema}};})(),dependencies:[],config:{roles:[],enrollment:'invitation'}}}]);
 await gap(o,'Specification',{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision},()=>row('SELECT count(*) n FROM project_spec_applies WHERE proposal_id=?',q.id).then(r=>r.n));
 // Service client settings (contact link only; no backend needed).
 const head=await row('SELECT revision,version_id FROM service_client_heads WHERE project_id=?',site.project).catch(()=>null),turn=id(),chat=(await m.readChat(scope,o.account)).state.revision;
 const website=(await row('SELECT version_id FROM project_spec_heads WHERE project_id=?',site.project)).version_id;
 const prepared=await m.serviceClientStore.prepareServiceClients(scope,o.account,turn,{kind:'serviceClients',operation:'prepare',projectId:site.project,expectedRevision:head?.revision??0,websiteVersionId:website,configuration:{schemaVersion:1,contact:{component:'contact-link@1'},statelessForm:null}});
 await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at) VALUES(?,?,?,'Synthetic review fixture','','ai','pending',?)").bind(turn,o.account,chat+1,new Date().toISOString()),...prepared.statements,scope.prepare("UPDATE chat_turns SET assistant_text=?,status='completed' WHERE id=?").bind(prepared.reply,turn),scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(chat+1,o.account)]);
 const p=await m.serviceClientStore.readServiceClientProposal(scope,o.account,turn);
 await gap(o,'Service client',{type:'serviceClientApply',reviewId:p.id,proposalDigest:p.proposal_digest,expectedRevision:p.expected_revision},()=>row('SELECT count(*) n FROM service_client_applies WHERE proposal_id=?',p.id).then(r=>r.n));
 console.log(`Digest gap specification passed (${checks} checks, ${process.argv.includes('--d1')?'local D1':'SQLite'}).`);
}catch(error){console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{await store.close();}
