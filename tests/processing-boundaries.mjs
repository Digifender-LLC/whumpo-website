import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {currentSiteFixtureHandlers,createFixtureProject,enableFixtureVisitorAccess} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {fixtureKeyring,initializeFixtureKeys,fixtureCiphertext} from './helpers/connection-keyring.mjs';
Error.stackTraceLimit=0;
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture;
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const markers={profile:'PRIVATE_PROFILE_BIO_CANARY',email:'private-email-canary@example.invalid',photo:Buffer.from('PRIVATE_PHOTO_BYTES_CANARY').toString('base64'),token:'ghu_PRIVATE_PROVIDER_CANARY',state:'PRIVATE_BACKEND_STATE_CANARY',visitor:'PRIVATE_VISITOR_DATA_CANARY',object:'PRIVATE_R2_KEY_CANARY',foreign:'OTHER_OWNER_CONTENT_CANARY',internal:'PRIVATE_INTERNAL_COLUMN_CANARY',config:'PRIVATE_MODEL_AUTH_CANARY',history:'PRIVATE_NON_INFERENCE_HISTORY_CANARY'};
const key=fixtureKeyring();const previousFetch=globalThis.fetch,previousError=console.error,previousWarn=console.warn,logs=[];
globalThis.fetch=async()=>assert.fail('No real provider or other network access');console.error=x=>logs.push(String(x));console.warn=x=>logs.push(String(x));
try{
 await initializeFixtureKeys(db,key);
 const ownerId=id();await db.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(ownerId,markers.email).run();
 const owner=await workspaceFixture(db,m,ownerId),other=await workspaceFixture(db,m),scope=await owner.scope(),foreignScope=await other.scope();
 await m.readChat(scope,owner.account);await m.readChat(foreignScope,other.account);
 const {project,version}=await createFixtureProject(scope,owner.account,'Neighborhood garden','Landscaping and garden care');
 const foreign=await createFixtureProject(foreignScope,other.account,markers.foreign,markers.foreign);
 await db.prepare("UPDATE workspace_state SET step='ready' WHERE user_id=?").bind(owner.account).run();
 await db.prepare('INSERT INTO user_profiles(user_id,name,about_me,share_context,photo) VALUES(?,?,?,0,?)').bind(owner.account,'Private profile name',markers.profile,markers.photo).run();
 const tokenId=id(),photoId=id();
 await db.prepare("INSERT INTO github_token_vault VALUES(?,?,?,'2099-01-01','revoking')").bind(tokenId,owner.account,await fixtureCiphertext(key,`whumpo:github:token:${owner.account}:${tokenId}`,markers.token)).run();
 await db.prepare("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,?,?,?,10,1,1,'ready',?)").bind(photoId,project,'Garden photo metadata',markers.object,'a'.repeat(64),now()).run();
 // Private visitor state exists in the actual tables. No model or public runtime
 // executes it; explicit activation below uses only a synthetic deterministic check.
 const backend=id(),check=id(),review=id();
 await m.backend.saveBackend(scope,owner.account,project,backend,'export default ({state})=>({state,result:null})');
 await m.backend.testBackend(scope,{fetch:async()=>Response.json({ok:true,value:{state:{},result:null}})},owner.account,project,backend,check,{state:{},input:{}});
 await enableFixtureVisitorAccess(scope,owner.account,project);
 await m.appActivation.prepareApplication(scope,owner.account,project,review,'enable',backend,check);await m.appActivation.confirmApplication(scope,owner.account,review);
 const stateReview=id();await m.backendState.prepareBackendState(scope,{fetch:async()=>Response.json({ok:true,value:{state:{private:markers.state},result:null}})},owner.account,project,backend,stateReview,{});await m.backendState.confirmBackendState(scope,owner.account,stateReview);
 const visitor=id();await db.prepare("INSERT INTO app_visitors(id,project_id,access_id) SELECT ?,?,id FROM module_instances WHERE project_id=? AND kind='access'").bind(visitor,project,project).run();const visitorToken=await m.appData.issueAppSession(db,visitor);await m.appData.transitionAppData(db,{fetch:async()=>Response.json({ok:true,value:{state:{private:markers.visitor},result:null}})},visitorToken,project,id(),0,{});await assert.rejects(m.appData.readAppData(db,owner.token,project),{status:401});
 const revision=(await m.readChat(scope,owner.account)).state.revision+1;
 await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at,ai_context_allowed) VALUES(?,?,?,?,'Private operator statement','guided','completed',?,0)").bind(id(),owner.account,revision,markers.history,now()).run();await db.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(revision,owner.account).run();
 const forbidden=Object.values(markers).filter(x=>x!==markers.profile);
 const checkPrivate=(text,shared=false)=>{for(const value of [...forbidden,...(shared?[]:[markers.profile, 'Private profile name']),owner.token,other.token])assert.ok(!text.includes(value),'Unexpected private data in selected output');};
 assert.equal(await m.agentProfile(scope,owner.account),null);
 // Unexpected selected columns and nested extensions never become model fields.
 const original=await m.siteContext(scope,owner.account),enriched=structuredClone(original);
 enriched.internal=markers.internal;enriched.profile={name:'Shared name',about_me:'Shared bio',email:markers.email,photo:markers.photo};
 for(const field of ['projectIndex','projects','photos','domains','backends'])for(const entry of enriched[field]??[])entry.internal=markers.internal;
 enriched.workspace.internal=markers.internal;enriched.workspace.layout.internal=markers.internal;
 enriched.workspace.layout.tabs=[{id:'tab-garden',label:'Garden',view:{version:1,projectId:project,widgets:['projects'],shortcuts:[],internal:markers.internal},internal:markers.internal}];enriched.latest.internal=markers.internal;
 for(const focus of ['all','website','cms'])checkPrivate(m.agentWorkspaceData(enriched,focus),true);
 const invalid=structuredClone(original);invalid.latest.config_json=JSON.stringify({...JSON.parse(invalid.latest.config_json),private:markers.internal});assert.throws(()=>m.agentWorkspaceData(invalid),/Invalid/);
 // Inspecting project metadata cannot read a visitor's document or backend state.
 checkPrivate(await m.inspectWorkspace(scope,owner.account,'project',project));
 assert.equal(await m.inspectWorkspace(scope,owner.account,'project',foreign.project),'Project not found.');
 assert.equal(await m.inspectWorkspace(foreignScope,other.account,'version',version),'Saved version not found.');
 for(const topic of m.knowledgeTopics)checkPrivate(m.readAgentKnowledge(topic));
 const config={baseURL:'https://provider.test/v1',apiKey:markers.config,model:'synthetic',protocol:'responses'};
 let modelCalls=0,ackCalls=0;
 for(const shared of [false,true,false]){
  const profile=await m.readProfile(scope,owner.account);await m.updateProfile(scope,owner.account,{revision:profile.revision,share_context:shared});
  let acknowledge;const ackSeen=new Promise(resolve=>{acknowledge=resolve}),background=[];let step=0;
  const transport=async(_url,init)=>{
   const payload=JSON.parse(init.body),serialized=JSON.stringify(payload),messages=payload.input;
   checkPrivate(serialized,shared);
   const ack=messages.some(message=>message.content.startsWith('Classify the latest user message.'));
   if(ack){ackCalls++;assert.ok(!serialized.includes('Garden photo metadata'));assert.ok(!serialized.includes(markers.profile));acknowledge();return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"intent":"question"}'}]}],usage:{input_tokens:20,output_tokens:10}});}
   modelCalls++;step++;
   if(shared)assert.ok(serialized.includes(markers.profile));
   if(step===1)await Promise.race([ackSeen,new Promise((_,reject)=>setTimeout(()=>reject(Error('Acknowledgment was not dispatched')),3000))]);
   return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'The project details are available.',action:step===1?{kind:'inspect',scope:'project',targetId:project}:null})}]}],usage:{input_tokens:100,output_tokens:100}});
  };
  const state=await m.readChat(scope,owner.account),result=await m.sendAIChat(scope,owner.account,id(),state.state.revision,'Help maintain my project.',config,transport,{background:promise=>background.push(promise)});
  await Promise.all(background);assert.equal(result.status,200);assert.equal(step,2);
 }
 assert.equal(modelCalls,6);assert.equal(ackCalls,3);
 // Existing source/transcript export selectors expose only their declared classes.
 const base='https://whumpo.com',env={DB:db,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
 const request=(path,actor=owner)=>m.worker.fetch(new Request(base+path,{headers:{cookie:'__Host-whumpo_session='+actor.token}}),env);
 const download=await request('/api/site-versions/'+version+'/export');assert.equal(download.status,200);assert.match(download.headers.get('cache-control'),/no-store/);
 const files=unzipSync(new Uint8Array(await download.arrayBuffer()));const exported=Object.values(files).map(bytes=>strFromU8(bytes)).join('\n');checkPrivate(exported);assert.ok(exported.includes('Neighborhood garden'));
 assert.equal((await request('/api/site-versions/'+version+'/export',other)).status,404);
 const transcript=await request('/api/chat/export');assert.equal(transcript.status,200);assert.match(transcript.headers.get('cache-control'),/no-store/);const transcriptText=await transcript.text();
 assert.ok(transcriptText.includes(markers.history),'An owner-requested transcript includes their own non-inference history');
 for(const value of Object.values(markers).filter(x=>x!==markers.history))assert.ok(!transcriptText.includes(value));
 const otherTranscript=await (await request('/api/chat/export',other)).text();assert.ok(!otherTranscript.includes(markers.history));
 let objectReads=0;await assert.rejects(m.readPhoto({DB:foreignScope,FILES:{get:async()=>{objectReads++;throw Error('Private object reached');}}},other.account,photoId),{status:404});assert.equal(objectReads,0);
 // Raw exception names/messages/stacks are never ordinary request diagnostics.
 const failure=Object.assign(Error(markers.internal),{name:markers.email});const broken={...env,DB:{prepare(){throw failure;}}};
 const response=await m.worker.fetch(new Request(base+'/api/profile',{headers:{cookie:'__Host-whumpo_session='+owner.token}}),broken);assert.equal(response.status,500);checkPrivate(await response.text());
 const contact=await m.worker.fetch(new Request(base+'/contact/'+project),broken);assert.equal(contact.status,503);checkPrivate(await contact.text());
 checkPrivate(JSON.stringify(logs));assert.ok(logs.some(x=>x.includes('request.failed')));assert.ok(logs.some(x=>x.includes('contact.failed')));
 // Strict current layout admission rejects hidden extensions instead of spreading them.
 await db.prepare('INSERT INTO workspace_preferences(user_id,layout_json,updated_at) VALUES(?,?,?)').bind(owner.account,JSON.stringify({version:1,dashboard:{version:1,projectId:null,widgets:['projects'],shortcuts:[]},tabs:[],private:markers.internal}),now()).run();await assert.rejects(m.readLayout(scope,owner.account),{status:400});
 console.log('Processing boundaries passed: actual two-step Chat plus acknowledgments, profile opt-in/withdrawal, field projection, owner/visitor/credential/object exclusion, source and transcript export, private-media ownership, strict layout and sanitized Worker/contact diagnostics. Synthetic current data only; no scanner, CMS, live inference or restore claim.');
}finally{globalThis.fetch=previousFetch;console.error=previousError;console.warn=previousWarn;await fixture.close();}
