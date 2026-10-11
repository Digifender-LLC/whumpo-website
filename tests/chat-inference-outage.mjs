import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
// WH-111 acceptance 4: with no inference binding, the actual Worker still serves saved Chat state,
// Dashboard shortcut controls and the exact review control. Typed text, including a typed
// `/confirm`, is refused rather than approving anything. Zero model calls are recorded.
// Run `node tests/chat-inference-outage.mjs` (SQLite) or add `--d1` for local D1.
const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db;
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}};
const origin='https://whumpo.com';
let checks=0;
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const equal=(actual,expected,message)=>{assert.equal(actual,expected,message);checks++;};
async function http(account,path,method='GET',body){
 const response=await m.worker.fetch(new Request(origin+path,{method,headers:{origin,'content-type':'application/json',cookie:'__Host-whumpo_session='+account.token},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{waitUntil:()=>{}});
 return {status:response.status,json:await response.json().catch(()=>null)};
}
const count=async(sql,...values)=>(await db.prepare(sql).bind(...values).first()).n;
const publication=project=>db.prepare('SELECT version_id,revision FROM publications WHERE project_id=?').bind(project).first().then(row=>row??null);
const served=project=>m.host.fetch(new Request('https://'+project+'.whumpo.site/'),{DB:db});
try{
 const owner=await workspaceFixture(db,m),foreign=await workspaceFixture(db,m);
 const scope=await owner.scope(),user=owner.account;
 const {project,version}=await createFixtureProject(scope,user,'Alpha','A synthetic alpha website.');
 await createFixtureProject(await foreign.scope(),foreign.account,'Beta','A synthetic beta website.');
 // The review is prepared by the domain handler without a model; the browser can only confirm it.
 const state=await m.readChat(scope,user),reviewId=crypto.randomUUID();
 equal((await m.sendChat(scope,user,{id:reviewId,revision:state.state.revision,content:'/publish '+version})).status,200,'Domain handler prepares the review without inference');
 equal((await served(project)).status,404,'Nothing is public before the exact confirmation');
 const modelCalls=await count('SELECT count(*) n FROM inference_calls');
 const read=async()=>(await http(owner,'/api/chat')).json;

 // Saved state is readable and says the assistant is unavailable.
 let chat=await http(owner,'/api/chat');
 equal(chat.status,200,'Chat read');ok(chat.json.mode!=='ai','Chat reports that no model is configured');
 const revision=chat.json.state.revision,turns=chat.json.turns.length;

 // Negative controls: typed text cannot reach a model and a typed confirm cannot approve.
 const typed=await http(owner,'/api/chat','POST',{id:crypto.randomUUID(),revision,content:'Help me change my site'});
 equal(typed.status,503,'Typed text is refused without inference');
 equal(typed.json.support,'/workspace/support?ref=status%3Achat_unavailable','The refusal carries the content-free support link');
 const typedConfirm=await http(owner,'/api/chat','POST',{id:crypto.randomUUID(),revision,content:'/confirm '+reviewId});
 equal(typedConfirm.status,503,'A typed /confirm is not an approval path');
 equal((await served(project)).status,404,'Refused typed requests publish nothing');
 equal((await read()).state.revision,revision,'Refused typed requests do not advance the conversation');

 // Dashboard shortcut: a typed control that reads saved state, no model.
 const shortcut=await http(owner,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision,action:{type:'shortcut',kind:'versions',projectId:project}});
 equal(shortcut.status,200,'Shortcut control works without inference');
 const afterShortcut=shortcut.json.state.revision;
 ok(afterShortcut>revision&&shortcut.json.turns.length===turns+1,'The shortcut result is saved in Chat');

 // Stale and foreign confirmations are refused and publish nothing.
 const control={type:'confirm',kind:'site',reviewId};
 const stale=await http(owner,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision,action:control});
 equal(stale.status,409,'A confirmation prepared against an older conversation revision is refused');
 const foreignState=(await http(foreign,'/api/chat')).json;
 const wrongOwner=await http(foreign,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision:foreignState.state.revision,action:control});
 ok(wrongOwner.status!==200||/No matching|not found|expired|unavailable/i.test(JSON.stringify(wrongOwner.json)),'A foreign account cannot use the review');
 equal((await publication(project))?.version_id??null,null,'Refused confirmations leave nothing published');
 equal((await served(project)).status,404,'Still private');

 // The exact control approves with zero model calls; replay is idempotent.
 const confirmId=crypto.randomUUID();
 const confirmed=await http(owner,'/api/chat/actions','POST',{id:confirmId,revision:afterShortcut,action:control});
 equal(confirmed.status,200,'The exact reviewed control confirms without inference');
 const live=await served(project);equal(live.status,200,'The reviewed version is now public');ok((await live.text()).includes('Alpha'),'The public page is the reviewed version');
 const published=await publication(project);equal(published.version_id,version,'The exact reviewed version is the published version');equal(published.revision,1,'Publication revision 1');
 const replay=await http(owner,'/api/chat/actions','POST',{id:confirmId,revision:afterShortcut,action:control});
 equal(replay.status,200,'Replaying the same request ID reads the saved result');
 equal(await count('SELECT count(*) n FROM chat_turns WHERE id=?',confirmId),1,'No second turn');
 equal(JSON.stringify(await publication(project)),JSON.stringify(published),'Replay changed nothing');
 equal(await count('SELECT count(*) n FROM inference_calls'),modelCalls,'No model call was recorded');
 console.log(`Chat inference outage passed (${checks} checks, ${process.argv.includes('--d1')?'local D1':'SQLite'}): saved state, shortcut and exact review confirmation work with no model; typed text and typed /confirm are refused; stale and foreign confirmations publish nothing; replay is idempotent; zero inference calls.`);
}catch(error){console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{await store.close();}
