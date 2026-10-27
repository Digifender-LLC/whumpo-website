import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
// WH-212 / D-5: with no model binding, a Chat-prepared review is confirmed the way Saved work does it:
// a fresh read of `/api/chat/turns/:id`, then the existing `/api/chat/actions` confirm using that turn's own
// revision as the conversation fence. No Chat read, no model, no second approval path.
// Run `node tests/saved-review-confirm-outage.mjs` (SQLite) or add `--d1`.
const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db;
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}};
const origin='https://whumpo.com';
let checks=0;
const equal=(a,b,msg)=>{assert.equal(a,b,msg);checks++;};
async function http(account,path,method='GET',body){
 const response=await m.worker.fetch(new Request(origin+path,{method,headers:{origin,'content-type':'application/json',cookie:'__Host-whumpo_session='+account.token},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{waitUntil:()=>{}});
 return {status:response.status,json:await response.json().catch(()=>null)};
}
const count=async(sql,...values)=>(await db.prepare(sql).bind(...values).first()).n;
const published=project=>db.prepare('SELECT version_id,revision FROM publications WHERE project_id=?').bind(project).first().then(row=>row??null);
const served=project=>m.host.fetch(new Request('https://'+project+'.whumpo.site/'),{DB:db});
async function review(account,name){
 const scope=await account.scope(),{project,version}=await createFixtureProject(scope,account.account,name,'A synthetic website.');
 const id=crypto.randomUUID(),state=await m.readChat(scope,account.account);
 equal((await m.sendChat(scope,account.account,{id,revision:state.state.revision,content:'/publish '+version})).status,200,name+' review prepared without a model');
 return {project,version,id,scope};
}
// What Saved work does: read the turn fresh, keep only its own revision and review id.
const read=async(account,id)=>{const r=await http(account,'/api/chat/turns/'+id);return {status:r.status,turn:r.json?.turn};};
const control=reviewId=>({type:'confirm',kind:'site',reviewId});
try{
 const owner=await workspaceFixture(db,m),foreign=await workspaceFixture(db,m);
 const a=await review(owner,'Alpha'),modelCalls=await count('SELECT count(*) n FROM inference_calls');
 await createFixtureProject(await foreign.scope(),foreign.account,'Beta','A synthetic beta website.');

 // Cross-owner: the foreign account cannot read the turn or use the review.
 equal((await read(foreign,a.id)).status,404,'A foreign account cannot read the saved turn');
 const fs=(await http(foreign,'/api/chat')).json.state.revision;
 const wrong=await http(foreign,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision:fs,action:control(a.id)});
 assert.ok(wrong.status!==200||/No matching|not found|expired|unavailable/i.test(JSON.stringify(wrong.json)));checks++;
 equal((await served(a.project)).status,404,'Foreign attempt published nothing');

 // Not offered: no prepare control exists, and typed prepare needs the model.
 const fresh=await read(owner,a.id);equal(fresh.status,200,'Fresh read of the saved turn');
 assert.equal(fresh.turn.confirmation_id,a.id);checks++;
 for(const action of [{type:'firstDraft',projectId:a.project},{type:'prepare',kind:'site',projectId:a.project}])
  equal((await http(owner,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision:fresh.turn.revision,action})).status,400,'No model-free prepare control: '+action.type);
 equal((await http(owner,'/api/chat','POST',{id:crypto.randomUUID(),revision:fresh.turn.revision,content:'/first-draft '+a.project})).status,503,'Typed prepare needs the model');

 // Stale: the conversation moved on after the read, so the old revision is refused and nothing publishes.
 const shortcut=await http(owner,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision:(await http(owner,'/api/chat')).json.state.revision,action:{type:'shortcut',kind:'versions',projectId:a.project}});
 equal(shortcut.status,200,'Conversation advances');
 const stale=await http(owner,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision:fresh.turn.revision,action:control(a.id)});
 equal(stale.status,409,'A stale revision is refused');
 equal((await published(a.project))?.version_id??null,null,'Stale refusal published nothing');

 // A different review id at the latest revision approves nothing.
 await http(owner,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision:(await http(owner,'/api/chat')).json.state.revision,action:control(crypto.randomUUID())});
 equal((await served(a.project)).status,404,'An unknown review id publishes nothing');
 // A new review that is the latest message: confirm once from the fresh read; a different review id is refused.
 const b=await review(owner,'Gamma'),read2=await read(owner,b.id);
 equal((await served(b.project)).status,404,'Still private');
 const requestId=crypto.randomUUID(),body={id:requestId,revision:read2.turn.revision,action:control(b.id)};
 equal((await http(owner,'/api/chat/actions','POST',body)).status,200,'Confirm from the fresh read succeeds without the model');
 const live=await published(b.project);equal(live.version_id,b.version,'The exact reviewed version is live');equal((await served(b.project)).status,200,'Public');

 // Lost reply: the retry reuses the request ID and replays the receipt without a second effect.
 equal((await http(owner,'/api/chat/actions','POST',body)).status,200,'Same-ID retry reads the saved result');
 equal(await count('SELECT count(*) n FROM chat_turns WHERE id=?',requestId),1,'No duplicate turn');
 equal(JSON.stringify(await published(b.project)),JSON.stringify(live),'No duplicate effect');
 // A fresh request ID after the commit is refused (revision moved), so reload never re-approves.
 equal((await http(owner,'/api/chat/actions','POST',{...body,id:crypto.randomUUID()})).status,409,'A new request after the commit is refused');
 equal(await count('SELECT count(*) n FROM inference_calls'),modelCalls,'No model call was recorded');
 console.log(`Saved review confirm outage passed (${checks} checks, ${process.argv.includes('--d1')?'local D1':'SQLite'}).`);
}catch(error){console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{await store.close();}
