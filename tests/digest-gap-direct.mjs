import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
// Review kinds that store NO reply digest (directory add/publish/unpublish, contact form, version removal, photo removal) rebuild
// the expected reply from the saved review row at confirm. A stored reply that differs is refused (409) and changes nothing;
// restoring the text confirms. Directory edit, remove and restore replies embed the draft at review time, which the row does not
// hold, so they cannot be rebuilt without a schema change: that gap is pinned at the end and must flip if the row ever stores it.
// Run `node tests/digest-gap-direct.mjs` or add `--d1`.
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
const original=async turn=>(await row('SELECT assistant_text t FROM chat_turns WHERE id=?',turn)).t;
// Forge the stored reply, expect a 409 and an untouched pending review, then restore it and expect the confirm to apply.
async function refused(o,kind,review,table,applied){
 const text=await original(review);await forge(review);
 equal((await confirm(o,kind,review)).status,409,kind+' confirm refused after a changed reply');
 equal((await row(`SELECT status s FROM ${table} WHERE id=?`,review)).s,'pending',kind+' review still pending');
 await applied(false);
 await db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=?').bind(text,review).run();
 equal((await confirm(o,kind,review)).status,200,kind+' confirm after the reply is restored');
 await applied(true);
}
try{
 const o=await workspaceFixture(db,m),scope=await o.scope(),{project,version}=await createFixtureProject(scope,o.account,'Direct desk','A synthetic website.');
 await m.sendChat(scope,o.account,{id:id(),revision:await revision(o),content:'/publish '+version});
 const published=await row('SELECT id FROM publication_actions WHERE project_id=?',project);
 equal((await confirm(o,'site',published.id)).status,200,'Site published (setup)');
 const listed=async()=>(await m.directory.readDirectory(scope,o.account,project));

 // Directory add, publish, unpublish.
 const add=await prepare(o,scope,`/directory-add ${project} | Garden club | Saturday mornings | https://example.com/`);
 await refused(o,'directory',add,'directory_reviews',async done=>equal((await listed()).draft.length,done?1:0,'Directory draft '+(done?'has':'lacks')+' the reviewed listing'));
 equal((await listed()).draft[0].title,'Garden club','The saved listing is the reviewed snapshot');
 const dpub=await prepare(o,scope,'/directory-publish '+project);
 await refused(o,'directory',dpub,'directory_reviews',async done=>equal(!!(await listed()).published,done,'Directory published '+done));
 const doff=await prepare(o,scope,'/directory-off '+project);
 await refused(o,'directory',doff,'directory_reviews',async done=>equal(!!(await listed()).published,!done,'Directory offline '+done));

 // Contact form.
 const contact=await prepare(o,scope,'/contact-on '+project),reviewed=await row('SELECT enabled FROM contact_reviews WHERE id=?',contact);
 await refused(o,'contact',contact,'contact_reviews',async done=>equal((await row('SELECT enabled FROM contact_settings WHERE project_id=?',project)).enabled,done?reviewed.enabled:0,'Contact setting '+(done?'equals the reviewed row':'unchanged')));

 // Version removal.
 const second=await changeFixtureWebsite(scope,o.account,project,[{type:'modules.put',instance:{id:'members',kind:'access',...(()=>{const e=m.moduleCatalog.find(x=>x.kind==='access');return {module:{...e.module},schema:{...e.schema}};})(),dependencies:[],config:{roles:[],enrollment:'invitation'}}}]);
 const republish=await prepare(o,scope,'/publish '+second);equal((await confirm(o,'site',republish)).status,200,'Second version published so the first is unused');
 const removal=await prepare(o,scope,'/delete-version '+version),target=(await row('SELECT version_id v FROM version_removals WHERE id=?',removal)).v;
 await refused(o,'version',removal,'version_removals',async done=>equal(!!await row('SELECT id FROM site_versions WHERE id=?',target),!done,'Reviewed version '+(done?'gone':'present')));
 assert.ok(await row('SELECT id FROM site_versions WHERE id=?',second));checks++;

 // Photo removal.
 const file=id();await db.prepare("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,created_at) VALUES(?,?,'Garden',?,'fixture',10,1,1,?)").bind(file,project,`photos/${project}/${file}.jpg`,new Date().toISOString()).run();
 const photo=await prepare(o,scope,'/delete-photo '+file);
 await refused(o,'photo',photo,'photo_removals',async done=>equal(!!await row('SELECT id FROM project_files WHERE id=?',file),!done,'Reviewed photo '+(done?'gone':'present')));

 // Domain proof removal.
 const claim=id();await db.prepare('INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(claim,project,'garden.example.com','proof-'+id(),new Date(Date.now()+86400000).toISOString(),new Date().toISOString()).run();
 const proof=await prepare(o,scope,'/remove-domain-proof '+claim);
 await refused(o,'domainProof',proof,'domain_proof_removals',async done=>equal(!!await row('SELECT id FROM domain_claims WHERE id=?',claim),!done,'Reviewed proof '+(done?'gone':'present')));

 // Stopped kind: a directory edit reply embeds the old listing, which the row does not hold. Still accepted; flip when rebuildable.
 const listing=(await listed()).draft[0].id,edit=await prepare(o,scope,`/directory-edit ${project} ${listing} | Garden club | Sunday mornings`);await forge(edit);
 equal((await confirm(o,'directory',edit)).status,200,'Directory edit confirm after a changed reply (known gap, not rebuildable from the row)');
 console.log(`Digest gap direct passed (${checks} checks, ${process.argv.includes('--d1')?'local D1':'SQLite'}).`);
}catch(error){console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{await store.close();}
