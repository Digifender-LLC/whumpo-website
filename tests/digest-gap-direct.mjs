import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
// Characterization for review kinds that store NO reply digest and have no chat_review_receipts / link row: directory,
// contact form, version removal (backend state, contact notification, CMS, backup, domain proof and photo removal share
// the shape; see the PR). What binds the approval is the saved review row (exact snapshot/ids/revision fences, expiry),
// and the effect is built from that row, never from the reply text. This test pins that: after the stored reply text is
// changed the confirm is still accepted, and what it applies is exactly the saved review, not anything from the text.
// If a reply digest is ever added for these kinds, this test must flip to expect a refusal. Run `node tests/digest-gap-direct.mjs` or add `--d1`.
const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db,id=()=>crypto.randomUUID();
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},origin='https://whumpo.com';
let checks=0;const equal=(a,b,msg)=>{assert.equal(a,b,msg);checks++;};
const row=(q,...p)=>db.prepare(q).bind(...p).first();
async function http(o,path,method='GET',body){
 const response=await m.worker.fetch(new Request(origin+path,{method,headers:{origin,'content-type':'application/json',cookie:'__Host-whumpo_session='+o.token},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{waitUntil:()=>{}});
 return {status:response.status,json:await response.json().catch(()=>null)};
}
const revision=async o=>(await http(o,'/api/chat')).json.state.revision;
async function prepare(o,scope,content){const turn=id();equal((await m.sendChat(scope,o.account,{id:turn,revision:await revision(o),content})).status,200,content.split(' ')[0]+' review prepared');return turn;}
const forge=(turn)=>db.prepare("UPDATE chat_turns SET assistant_text='Nothing here is what was reviewed. '||assistant_text WHERE id=?").bind(turn).run();
const confirm=async(o,kind,reviewId)=>http(o,'/api/chat/actions','POST',{id:id(),revision:await revision(o),action:{type:'confirm',kind,reviewId}});
try{
 const o=await workspaceFixture(db,m),scope=await o.scope(),{project,version}=await createFixtureProject(scope,o.account,'Direct desk','A synthetic website.');
 await m.sendChat(scope,o.account,{id:id(),revision:await revision(o),content:'/publish '+version});
 const published=await row('SELECT id FROM publication_actions WHERE project_id=?',project);
 equal((await confirm(o,'site',published.id)).status,200,'Site published (setup)');

 // Directory: the saved snapshot is applied, not the reply.
 const directory=await prepare(o,scope,`/directory-add ${project} | Garden club | Saturday mornings | https://example.com/`);
 const snapshot=(await row('SELECT snapshot_json s FROM directory_reviews WHERE id=?',directory)).s;await forge(directory);
 equal((await confirm(o,'directory',directory)).status,200,'Directory confirm after a changed reply');
 equal((await row('SELECT snapshot_json s FROM directory_reviews WHERE id=?',directory)).s,snapshot,'Directory review snapshot is immutable');
 equal((await m.directory.readDirectory(scope,o.account,project)).draft[0].title,'Garden club','The saved listing is the reviewed snapshot');

 // Contact form: enabled flag and revision fences come from the review row.
 const contact=await prepare(o,scope,'/contact-on '+project),reviewed=await row('SELECT enabled,expected_revision FROM contact_reviews WHERE id=?',contact);await forge(contact);
 equal((await confirm(o,'contact',contact)).status,200,'Contact confirm after a changed reply');
 equal((await row('SELECT enabled FROM contact_settings WHERE project_id=?',project)).enabled,reviewed.enabled,'Contact setting equals the reviewed row');

 // Version removal: the saved version id is removed, only after the same fences.
 const second=await changeFixtureWebsite(scope,o.account,project,[{type:'modules.put',instance:{id:'members',kind:'access',...(()=>{const e=m.moduleCatalog.find(x=>x.kind==='access');return {module:{...e.module},schema:{...e.schema}};})(),dependencies:[],config:{roles:[],enrollment:'invitation'}}}]);
 const republish=await prepare(o,scope,'/publish '+second);equal((await confirm(o,'site',republish)).status,200,'Second version published so the first is unused');
 const removal=await prepare(o,scope,'/delete-version '+version),target=(await row('SELECT version_id v FROM version_removals WHERE id=?',removal)).v;await forge(removal);
 equal((await confirm(o,'version',removal)).status,200,'Version removal confirm after a changed reply');
 equal(await row('SELECT id FROM site_versions WHERE id=?',target),null,'The reviewed version is gone');
 assert.ok(await row('SELECT id FROM site_versions WHERE id=?',second));checks++;
 console.log(`Digest gap direct (characterization) passed (${checks} checks, ${process.argv.includes('--d1')?'local D1':'SQLite'}).`);
}catch(error){console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{await store.close();}
