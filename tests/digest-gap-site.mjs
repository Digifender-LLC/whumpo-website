import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
// Site publish and unpublish reviews are gated by publication_actions and store no reply digest. A confirm must not
// apply after the reviewed reply text changed: it is rebuilt from the saved review and compared, and the effect UPDATE
// re-checks the exact text. Run `node tests/digest-gap-site.mjs` or add `--d1`.
const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db,id=()=>crypto.randomUUID();
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}},origin='https://whumpo.com';
let checks=0;const equal=(a,b,msg)=>{assert.equal(a,b,msg);checks++;};
async function http(o,path,method='GET',body){
 const response=await m.worker.fetch(new Request(origin+path,{method,headers:{origin,'content-type':'application/json',cookie:'__Host-whumpo_session='+o.token},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{waitUntil:()=>{}});
 return {status:response.status,json:await response.json().catch(()=>null)};
}
const revision=async o=>(await http(o,'/api/chat')).json.state.revision;
const live=project=>db.prepare('SELECT version_id FROM publications WHERE project_id=?').bind(project).first().then(r=>r?.version_id??null);
async function review(o,scope,content){const turn=id();equal((await m.sendChat(scope,o.account,{id:turn,revision:await revision(o),content})).status,200,content.split(' ')[0]+' review prepared');return turn;}
async function altered(o,turn,project,expect){
 const text=(await db.prepare('SELECT assistant_text t FROM chat_turns WHERE id=?').bind(turn).first()).t;
 await db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=?').bind(text+' (altered)',turn).run();
 const body={id:id(),action:{type:'confirm',kind:'site',reviewId:turn}};
 equal((await http(o,'/api/chat/actions','POST',{...body,revision:await revision(o)})).status,409,'Altered reply is not confirmed');
 equal(await live(project),expect,'Altered reply changed nothing');
 equal((await db.prepare('SELECT status FROM publication_actions WHERE id=?').bind(turn).first()).status,'pending','Review is still pending');
 await db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=?').bind(text,turn).run();
 equal((await http(o,'/api/chat/actions','POST',{...body,id:id(),revision:await revision(o)})).status,200,'Restored reply confirms');
}
try{
 const o=await workspaceFixture(db,m),scope=await o.scope(),{project,version}=await createFixtureProject(scope,o.account,'Digest site','A synthetic website.');
 await altered(o,await review(o,scope,'/publish '+version),project,null);
 equal(await live(project),version,'The reviewed version is live');
 await altered(o,await review(o,scope,'/unpublish '+project),project,version);
 equal(await live(project),null,'The reviewed unpublish applied');
 console.log(`Digest gap site passed (${checks} checks, ${process.argv.includes('--d1')?'local D1':'SQLite'}).`);
}catch(error){console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{await store.close();}
