import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {fixtureKeyring} from './helpers/connection-keyring.mjs';
import {enableFixtureVisitorAccess} from './current-site-fixture.mjs';
Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/index.ts','src/saved-work.ts','src/saved-work-shape.ts','src/project-specification/store.ts','src/project-specification/service-clients/store.ts','src/project-specification/service-clients/activation.ts','src/chat-interactions/store.ts','src/chat-interactions/protocol.ts','src/project-specification/v2/json.ts','src/chat.ts','src/project-specification/catalog.ts','src/github-connection.ts','src/github-grant-revocation.ts','src/connection-rotation.ts']);
const worker=(await modules.module('src/index.ts')).default,saved=await modules.module('src/saved-work.ts'),shape=await modules.module('src/saved-work-shape.ts');
const site=await modules.module('src/project-specification/store.ts'),services=await modules.module('src/project-specification/service-clients/store.ts'),activation=await modules.module('src/project-specification/service-clients/activation.ts');
const chat=await modules.module('src/chat.ts'),catalog=await modules.module('src/project-specification/catalog.ts');
const forms=await modules.module('src/chat-interactions/store.ts'),protocol=await modules.module('src/chat-interactions/protocol.ts'),codec=await modules.module('src/project-specification/v2/json.ts');
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID(),h='a'.repeat(64);let cases=0,network=0;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error('Unexpected provider or inference request');};
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){throw Error('No background work expected');}};
const now="strftime('%Y-%m-%dT%H:%M:%fZ','now')",soon="strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')",past="strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minutes')";
async function test(name,fn){try{await fn();cases++;}catch(error){console.error(name,error);throw error;}}
async function http(o,path,status=200,method='GET'){
 const response=await worker.fetch(new Request('https://whumpo.com/api/workspace/saved-work'+path,{method,headers:{origin:'https://whumpo.com',...(o?{cookie:'__Host-whumpo_session='+o.authority.token}:{})}}),env,ctx);
 const text=await response.text();assert.equal(response.status,status,text);assert.match(response.headers.get('cache-control'),/no-store/);return JSON.parse(text);
}
const list=(o,query='',status)=>http(o,query?'?'+query:'',status),detail=(o,kind,item,status)=>http(o,`/${kind}/${item}`,status);
async function all(o,query){const items=[];let after=null;for(let n=0;n<50;n++){const page=await list(o,[query,after&&'after='+encodeURIComponent(after)].filter(Boolean).join('&'));items.push(...page.items);if(!page.next)return items;after=page.next;}throw Error('Unbounded pages');}
const find=(items,kind,item)=>items.find(i=>i.kind===kind&&i.id===item);
async function command(o,prepare,text='Synthetic saved work',action=null){
 const turn=id(),revision=(await row('SELECT revision FROM workspace_state WHERE user_id=?',o.user)).revision+1,prepared=await prepare(turn);
 await o.scope.batch([o.scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status,action_json) VALUES(?,?,?,?,?,datetime('now'),?,?,?)").bind(turn,o.user,revision,text,prepared.reply,action?'guided':'ai',action?'completed':'pending',action?JSON.stringify(action):null),...prepared.statements,o.scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),o.scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(revision,o.user)]);
 return {id:turn,reply:prepared.reply};
}
async function turn(o,{status='completed',mode='guided',privateContext=false}={}){
 const t=id();await run(`INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status,ai_context_allowed) SELECT ?,user_id,revision+1,'PRIVATE_CHAT_CANARY','Reply',${now},?,?,? FROM workspace_state WHERE user_id=?`,t,mode,status,privateContext?0:1,o.user);
 await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);return t;
}
async function owner(){
 const authority=await workspaceFixture(db,modules.identity),user=authority.account,scope=await authority.scope(),project=id(),o={authority,user,scope,project};
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','PRIVATE_PURPOSE_CANARY','draft',datetime('now'),datetime('now'))",project,user);
 for(const [p,op] of [[project,'read'],[project,'prepare'],[null,'prepare']])await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing',?,'private-test-acceptance','synthetic saved work fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,p,op);
 o.website=await command(o,turn=>site.createWebsite(scope,user,turn,project,{name:'Garden',headline:'Neighborhood gardens',description:'Local gardening',theme:'ocean',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[],photos:[]}));
 o.version=(await row('SELECT id FROM site_versions WHERE project_id=? ORDER BY created_at LIMIT 1',project)).id;return o;
}
/** Sealed current form definitions with chosen historical times; answers stay in their own store. */
async function aged(o,definition,{project=null,createdDays=0,editedDays=0,submitted=false,unknown=false}={}){
 const originTurnId=await turn(o),conversationId=(await row('SELECT id FROM chat_conversations WHERE user_id=?',o.user))?.id??id(),taskId=id();
 await run('INSERT OR IGNORE INTO chat_conversations(id,user_id) VALUES(?,?)',conversationId,o.user);
 await run('INSERT INTO chat_interaction_tasks(id,user_id,conversation_id,project_id,origin_turn_id) VALUES(?,?,?,?,?)',taskId,o.user,conversationId,project,originTurnId);
 const clock=await row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now',?) createdAt,strftime('%Y-%m-%dT%H:%M:%fZ','now',?) expiresAt,strftime('%Y-%m-%dT%H:%M:%fZ','now',?) savedAt",'-'+createdDays+' days',(7-createdDays)+' days','-'+editedDays+' days');
 const envelope=await protocol.sealDefinition({version:1,id:id(),scope:{accountId:o.user,actorId:o.user,conversationId,taskId,projectId:project,originTurnId},definition,createdAt:clock.createdAt,expiresAt:clock.expiresAt});
 await run('INSERT INTO chat_interactions(id,user_id,conversation_id,task_id,project_id,origin_turn_id,envelope_json,definition_digest,issue_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',envelope.id,o.user,conversationId,taskId,project,originTurnId,JSON.stringify(envelope),envelope.definitionDigest,h,envelope.createdAt,envelope.expiresAt);
 const request={version:1,requestId:id(),interactionId:envelope.id,definitionDigest:envelope.definitionDigest,expectedAnswerRevision:0,operation:submitted?'submit':'save-draft',answers:{name:'PRIVATE_ANSWER_CANARY',purpose:'PRIVATE_ANSWER_CANARY purpose'}},{requestHash}=await protocol.validateMutation(request,envelope);
 await run('UPDATE chat_interactions SET state=?,answer_revision=1,draft_json=?,draft_saved_at=? WHERE id=?',submitted?'submitted':'open',submitted?'{}':JSON.stringify(request.answers),submitted?null:clock.savedAt,envelope.id);
 await run('INSERT INTO chat_interaction_requests(user_id,request_id,interaction_id,request_hash,operation,answer_revision,created_at) VALUES(?,?,?,?,?,1,?)',o.user,request.requestId,envelope.id,requestHash,request.operation,clock.savedAt);
 if(submitted){
  await run('INSERT INTO chat_interaction_submissions(id,user_id,interaction_id,answers_json,answers_digest,answer_revision,created_at) VALUES(?,?,?,?,?,1,?)',request.requestId,o.user,envelope.id,JSON.stringify(request.answers),await codec.jsonDigest(request.answers),clock.savedAt);
  await run('INSERT INTO chat_interaction_continuations(id) VALUES(?)',request.requestId);
  if(unknown){await run("UPDATE chat_interaction_continuations SET state='pending',started_at=? WHERE id=?",clock.savedAt,request.requestId);await run("UPDATE chat_interaction_continuations SET state='unknown' WHERE id=?",request.requestId);}
 }
 return envelope.id;
}
async function snapshot(){
 const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY name").all()).results.map(r=>r.name),counts={};
 for(const t of tables)counts[t]=(await row(`SELECT count(*) n FROM "${t}"`)).n;
 const states=await row(`SELECT (SELECT json_group_array(json_array(user_id,revision,step)) FROM workspace_state) workspace,(SELECT json_group_array(json_array(id,state)) FROM standard_ai_requests) ai,
  (SELECT json_group_array(json_array(id,status)) FROM publication_actions) publications,(SELECT json_group_array(json_array(id,state)) FROM chat_interaction_continuations) continuations,(SELECT json_group_array(json_array(id,state)) FROM github_backups) backups`);
 return {counts,states};
}
try{
 const a=await owner(),b=await owner(),seeded={};
 // WH-126: the seeded visitor application consumes the project's access module (real owner save and activation path).
 await enableFixtureVisitorAccess(a.scope,a.user,a.project,{handlers:{readChat:chat.readChat,sendChatControl:chat.sendChatControl,createWebsite:site.createWebsite,prepareSpecification:site.prepareSpecification,readSpecificationProposal:site.readSpecificationProposal,jsonDigest:codec.jsonDigest,moduleCatalog:catalog.moduleCatalog}});
 const intake=(await forms.issueProjectIntake(a.scope,a.user,{originTurnId:await turn(a),template:'project-brief@1'})),definition=intake.envelope.definition;
 // Account-wide and project Chat forms, including expired admission after a saved submission.
 seeded.liveForm=intake.envelope.id;
 seeded.expiredForm=await aged(a,definition,{createdDays:8,editedDays:2});
 seeded.retainedDue=await aged(a,definition,{createdDays:9,editedDays:8});
 seeded.submittedPast=await aged(a,definition,{createdDays:9,editedDays:9,submitted:true});
 seeded.unknownPast=await aged(a,definition,{createdDays:9,editedDays:9,submitted:true,unknown:true});
 // Inference receipts.
 seeded.aiUncertain=id();await run(`INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,${now},${now})`,seeded.aiUncertain,a.user,h);
 await run("UPDATE standard_ai_requests SET state='dispatched' WHERE id=?",seeded.aiUncertain);await run("UPDATE standard_ai_requests SET state='uncertain' WHERE id=?",seeded.aiUncertain);
 seeded.aiReleased=id();await run(`INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,${now},${now})`,seeded.aiReleased,a.user,h);await run("UPDATE standard_ai_requests SET state='released' WHERE id=?",seeded.aiReleased);
 seeded.chatUncertain=await turn(a,{status:'uncertain',mode:'ai'});
 // Website publication reviews: current, expired and a withdrawal.
 seeded.publish=id();await run(`INSERT INTO publication_actions(id,user_id,project_id,kind,version_id,expected_revision,expires_at) VALUES(?,?,?,'publish',?,0,${soon})`,seeded.publish,a.user,a.project,a.version);
 seeded.publishExpired=id();await run(`INSERT INTO publication_actions(id,user_id,project_id,kind,version_id,expected_revision,expires_at) VALUES(?,?,?,'publish',?,0,${past})`,seeded.publishExpired,a.user,a.project,a.version);
 seeded.unpublish=id();await run(`INSERT INTO publication_actions(id,user_id,project_id,kind,version_id,expected_revision,expires_at) VALUES(?,?,?,'unpublish',NULL,1,${soon})`,seeded.unpublish,a.user,a.project);
 // Website change proposal and saved result, then service review/result/activation through current domain code.
 const headRevision=(await row('SELECT revision FROM project_spec_heads WHERE project_id=?',a.project)).revision;
 seeded.change=(await command(a,t=>site.prepareSpecification(a.scope,a.user,t,{kind:'specification',operation:'change',projectId:a.project,expectedRevision:headRevision,operations:[{type:'content.replace',contentId:'headline',text:'Seasonal garden care'}]}),'Planting review')).id;
 const proposal=await site.readSpecificationProposal(a.scope,a.user,seeded.change);
 seeded.save=(await command(a,t=>site.applySpecificationCommand(a.scope,a.user,t,`/confirm-specification ${proposal.id} ${proposal.proposal_digest} ${proposal.expected_revision}`),'Apply saved review',{type:'specificationApply',reviewId:proposal.id,proposalDigest:proposal.proposal_digest,expectedRevision:proposal.expected_revision})).id;
 seeded.serviceChange=(await command(a,t=>services.prepareServiceClients(a.scope,a.user,t,{kind:'serviceClients',operation:'prepare',projectId:a.project,websiteVersionId:a.website.id,expectedRevision:0,configuration:{schemaVersion:1,contact:null,statelessForm:null}}))).id;
 const sq=await services.readServiceClientProposal(a.scope,a.user,seeded.serviceChange);
 seeded.serviceSave=(await command(a,t=>services.applyServiceClientsCommand(a.scope,a.user,t,`/confirm-service-clients ${sq.id} ${sq.proposal_digest} ${sq.expected_revision}`),'Apply saved services',{type:'serviceClientApply',reviewId:sq.id,proposalDigest:sq.proposal_digest,expectedRevision:sq.expected_revision})).id;
 seeded.activation=(await command(a,t=>activation.prepareServiceClientActivation(a.scope,a.user,t,{kind:'serviceClients',operation:'reviewActivation',projectId:a.project,versionId:seeded.serviceSave,service:'contact'}))).id;
 // Backend, app and maintenance records.
 const backend=id(),run2=id(),runOk=id(),next=id(),transform=id();
 for(const v of [backend,next,transform])await run(`INSERT INTO backend_versions(id,project_id,source,digest,created_at) VALUES(?,?,'export default {/* PRIVATE_CODE_CANARY */}',?,${now})`,v,a.project,h);
 seeded.backendRun=run2;await run('INSERT INTO backend_runs(id,user_id,project_id,version_id,request_hash) VALUES(?,?,?,?,?)',run2,a.user,a.project,backend,h);
 await run('INSERT INTO backend_runs(id,user_id,project_id,version_id,request_hash) VALUES(?,?,?,?,?)',runOk,a.user,a.project,next,h);
 await run(`UPDATE backend_runs SET state='complete',result_json='{"ok":1,"check":{"status":"passed"},"value":{"state":{},"result":"PRIVATE_RESULT_CANARY"}}' WHERE id=?`,runOk);
 await run('INSERT INTO backend_state(project_id) VALUES(?)',a.project);
 seeded.backendData=id();await run("INSERT INTO backend_state_reviews(id,user_id,project_id,version_id,base_revision,before_json,input_json) VALUES(?,?,?,?,0,'{}','{\"secret\":\"PRIVATE_INPUT_CANARY\"}')",seeded.backendData,a.user,a.project,backend);
 await run('INSERT INTO backend_publications(project_id,revision,review_id,version_id) VALUES(?,0,?,?)',a.project,id(),backend);
 seeded.backendWithdraw=id();await run("INSERT INTO backend_publication_reviews(id,user_id,project_id,operation,version_id,base_revision) VALUES(?,?,?,'unpublish',?,0)",seeded.backendWithdraw,a.user,a.project,backend);
 await run('INSERT INTO backend_form_settings(project_id) VALUES(?)',a.project);
 seeded.websiteTool=id();await run('INSERT INTO backend_form_reviews(id,user_id,project_id,enabled,site_revision,base_revision) VALUES(?,?,?,0,1,0)',seeded.websiteTool,a.user,a.project);
 await run("INSERT INTO app_spaces(project_id,owner_user_id,version_id,access_id,resource_id) SELECT ?,?,?,id,? FROM module_instances WHERE project_id=? AND kind='access'",a.project,a.user,backend,id(),a.project);
 seeded.appAuthority=id();await run('INSERT INTO app_activation_reviews(id,project_id,user_id,version_id,enabled,base_revision) VALUES(?,?,?,?,0,0)',seeded.appAuthority,a.project,a.user,backend);
 await run('INSERT INTO app_page_settings(project_id) VALUES(?)',a.project);
 seeded.appWithdraw=id();await run('INSERT INTO app_page_reviews(id,user_id,project_id,program_revision,base_revision,config_json) VALUES(?,?,?,0,0,NULL)',seeded.appWithdraw,a.user,a.project);
 const point=id(),checkPoint=id();await run('INSERT INTO app_recovery_points(id,user_id,project_id,version_id) VALUES(?,?,?,?)',point,a.user,a.project,backend);
 seeded.appRestore=id();await run("INSERT INTO app_restore_reviews(id,user_id,project_id,point_id,base_revision,roster_json) VALUES(?,?,?,?,0,'[]')",seeded.appRestore,a.user,a.project,point);
 await run('INSERT INTO app_recovery_points(id,user_id,project_id,version_id) VALUES(?,?,?,?)',checkPoint,a.user,a.project,backend);
 seeded.appUpgrade=checkPoint;await run("INSERT INTO app_migration_checks(id,user_id,project_id,from_version,to_version,transform_version,test_id,base_revision,roster_json) VALUES(?,?,?,?,?,?,?,0,'[]')",checkPoint,a.user,a.project,backend,next,transform,runOk);
 // Provider and hosting operations: review, uncertain and in-flight states past their review expiry.
 seeded.backup=id();await run(`INSERT INTO github_backups(id,user_id,project_id,version_id,request_hash,github_user_id,repo_id,repo_owner,repo_name,repo_private,branch,path,sha256,tree_sha,base_head,files_json,byte_length,created_at,expires_at) VALUES(?,?,?,?,?,'1',1,'PRIVATE_REPO_CANARY','PRIVATE_REPO_CANARY',1,'main','p',?,?,?,'[]',1,${now},${past})`,seeded.backup,a.user,a.project,a.version,h,h,'b'.repeat(40),'b'.repeat(40));
 await run("UPDATE github_backups SET state='uncertain' WHERE id=?",seeded.backup);
 const claim=id();await run(`INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) VALUES(?,?,'example.com','PRIVATE_TOKEN_CANARY',${soon},${now})`,claim,a.project);
 seeded.dns=id();await run(`INSERT INTO cloudflare_dns_actions(id,user_id,claim_id,project_id,token_id,zone_id,zone_name,record_name,content,inventory_hash,created_at,expires_at) VALUES(?,?,?,?,'t',?,'example.com','_w.example.com','PRIVATE_TOKEN_CANARY',?,${now},${past})`,seeded.dns,a.user,claim,a.project,'c'.repeat(32),h);
 seeded.dnsUncertain=id();await run(`INSERT INTO cloudflare_dns_actions(id,user_id,claim_id,project_id,token_id,zone_id,zone_name,record_name,content,inventory_hash,created_at,expires_at) VALUES(?,?,?,?,'t',?,'example.com','_x.example.com','x',?,${now},${past})`,seeded.dnsUncertain,a.user,claim,a.project,'c'.repeat(32),h);
 await run("UPDATE cloudflare_dns_actions SET state='uncertain' WHERE id=?",seeded.dnsUncertain);
 seeded.hosting=id();await run(`INSERT INTO domain_connections(id,user_id,claim_id,project_id,hostname,zone_id,target,proof_hash,state,created_at,expires_at) VALUES(?,?,?,?,'example.com',?,'t',?,'review',${now},${past})`,seeded.hosting,a.user,claim,a.project,'c'.repeat(32),h);
 await run("UPDATE domain_connections SET state='creating' WHERE id=?",seeded.hosting);
 seeded.sourceImport=id();await run("INSERT INTO backend_imports(id,user_id,project_id,source,digest,policy_version) VALUES(?,?,?,'PRIVATE_CODE_CANARY',?,'2026-09-30')",seeded.sourceImport,a.user,a.project,h);
 // GitHub access review: sealed synthetic custody through the real connect flow, no provider dispatch.
 {const gh=await modules.module('src/github-connection.ts'),grant=await modules.module('src/github-grant-revocation.ts'),keys=await modules.module('src/connection-rotation.ts'),key=fixtureKeyring(),config={clientId:'saved-work-'+id(),clientSecret:'synthetic-secret',appId:123,slug:'fixture',key};
  await keys.initializeConnectionKeys(db,key,'saved-work-fixture');await paidPlan(db,a.user,'business');
  const start=await gh.startGitHub(a.scope,a.user,config);
  await gh.finishGitHub(a.scope,a.user,new URL(start.url).searchParams.get('state'),'synthetic-code',config,async url=>url.endsWith('/access_token')?Response.json({access_token:'ghu_SYNTHETIC_'+id().replaceAll('-',''),expires_in:3600,refresh_token:'ghr_SYNTHETIC_'+id().replaceAll('-',''),refresh_token_expires_in:15897600}):url.endsWith('/user')?Response.json({id:123,login:'fixture'}):assert.fail('No provider dispatch permitted'));
  seeded.githubAccess=id();await grant.reviewGitHubGrant(a.scope,a.user,seeded.githubAccess,config);}
 // Photos: unconfirmed upload, unscanned ready file, stale approval and a current approval.
 const photo=async(status)=>{const f=id();await run(`INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,'PRIVATE_PHOTO_NAME.jpg',?,?,1,1,1,?,${now})`,f,a.project,'photos/'+a.project+'/'+f+'.jpg',h,status);return f;};
 seeded.photoUpload=await photo('pending');seeded.photoPending=await photo('ready');seeded.photoStale=await photo('ready');seeded.photoApproved=await photo('ready');seeded.photoBlocked=await photo('ready');
 for(const [f,expiry] of [[seeded.photoStale,past],[seeded.photoApproved,soon]])await run(`UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='PRIVATE_SCANNER_CANARY',expires_at=${expiry} WHERE file_id=?`,f);
 await run("UPDATE project_photo_safety SET state='blocked',sexual_check='matched',scanner_reference='PRIVATE_SCANNER_CANARY' WHERE file_id=?",seeded.photoBlocked);
 // Account records and Chat-confirmed removals/reviews.
 seeded.checkout=id();await run("INSERT INTO stripe_subscription_orders(id,user_id,plan_id,interval,price_id,amount_cents,created_at) VALUES(?,?,(SELECT id FROM plan_catalog ORDER BY id LIMIT 1),'month','price_PRIVATE',100,unixepoch())",seeded.checkout,a.user);
 seeded.usage=await turn(a,{privateContext:true});await run("INSERT INTO usage_review_requests(id,user_id,statement) VALUES(?,?,'PRIVATE_STATEMENT_CANARY')",seeded.usage,a.user);
 seeded.photoRemoval=await turn(a);await run(`INSERT INTO photo_removals(id,user_id,project_id,file_id,name,expires_at) VALUES(?,?,?,?,'PRIVATE_PHOTO_NAME.jpg',${soon})`,seeded.photoRemoval,a.user,a.project,seeded.photoPending);
 seeded.versionRemoval=await turn(a);await run(`INSERT INTO version_removals(id,user_id,project_id,version_id,digest,component_id,version_created_at,expires_at) VALUES(?,?,?,?,?,'c',${now},${soon})`,seeded.versionRemoval,a.user,a.project,a.version,h);
 seeded.domainProof=await turn(a);await run(`INSERT INTO domain_proof_removals(id,user_id,project_id,claim_id,hostname,proof_token,proof_expires_at,expires_at) VALUES(?,?,?,?,'example.com','PRIVATE_TOKEN_CANARY',${soon},${soon})`,seeded.domainProof,a.user,a.project,claim);
 seeded.contact=id();await run(`INSERT INTO contact_reviews(id,user_id,project_id,enabled,expected_revision,publication_revision,expires_at) VALUES(?,?,?,1,0,1,${soon})`,seeded.contact,a.user,a.project);
 seeded.directory=id();await run(`INSERT INTO directory_reviews(id,user_id,project_id,kind,snapshot_json,digest,expected_revision,publication_revision,expires_at) VALUES(?,?,?,'edit','[]',?,0,1,${soon})`,seeded.directory,a.user,a.project,h);

 await test('every saved-work source compiles and runs on the populated current schema',async()=>{
  for(const kind of Object.keys(shape.savedWorkKinds)){const page=await list(a,`kind=${kind}&view=all`);assert.equal(page.version,1);assert(page.items.every(i=>i.kind===kind));}
  const items=await all(a,'view=all'),kinds=new Set(items.map(i=>i.kind)),missing=Object.keys(shape.savedWorkKinds).filter(k=>!kinds.has(k));
  assert.deepEqual(missing,[]);
  for(const i of items)assert.deepEqual(Object.keys(i).sort(),['expiresAt','id','interactionId','key','kind','phase','projectId','projectName','safety','state','turnId']);
 });
 await test('truthful phases: expiry only ends unapproved reviews and open forms',async()=>{
  const items=await all(a,'view=all'),at=(kind,item)=>{const found=find(items,kind,item);assert(found,kind+' missing');return found;};
  assert.deepEqual([at('form',seeded.liveForm).phase,at('form',seeded.liveForm).projectId,at('form',seeded.liveForm).projectName],['form',null,null]);
  assert.equal(at('form',seeded.expiredForm).phase,'expired');assert.equal(find(items,'form',seeded.retainedDue),undefined);
  assert.deepEqual([at('form',seeded.submittedPast).state,at('form',seeded.submittedPast).phase,at('form',seeded.submittedPast).expiresAt],['not-started','attention',null]);
  assert.deepEqual([at('form',seeded.unknownPast).state,at('form',seeded.unknownPast).phase],['unknown','uncertain']);
  assert.deepEqual([at('inference',seeded.aiUncertain).phase,at('inference',seeded.aiReleased).phase,at('chat',seeded.chatUncertain).phase],['uncertain','finished','uncertain']);
  assert.deepEqual([at('website',seeded.publish).phase,at('website',seeded.publishExpired).phase,at('website',seeded.unpublish).safety],['review','expired','website']);
  assert.equal(at('website',seeded.publishExpired).expiresAt!==null,true);
  assert.deepEqual([at('website-change',seeded.change).state,at('website-change',seeded.change).phase,at('website-change',seeded.change).expiresAt],['applied','finished',null]);
  assert.deepEqual([at('website-save',seeded.save).phase,at('website-save',seeded.save).turnId],['finished',seeded.save]);
  assert.equal(at('service-change',seeded.serviceChange).state,'applied');assert.equal(at('service-save',seeded.serviceSave).phase,'finished');
  assert.deepEqual([at('service-activation',seeded.activation).phase,at('service-activation',seeded.activation).turnId],['review',seeded.activation]);
  // The activation's own contact review is the same work: listed once.
  assert.equal(find(items,'contact',seeded.activation),undefined);assert.equal(at('contact',seeded.contact).phase,'review');
  assert.deepEqual([at('backend-test',seeded.backendRun).phase,at('backend-data',seeded.backendData).phase],['working','working']);
  assert.deepEqual([at('backend',seeded.backendWithdraw).safety,at('application',seeded.appWithdraw).safety,at('app-authority',seeded.appAuthority).phase],['backend','application','review']);
  assert.equal(at('website-tool',seeded.websiteTool).phase,'review');assert.equal(at('app-restore',seeded.appRestore).phase,'review');
  // A recorded upgrade check with a passing test is only awaiting approval.
  assert.deepEqual([at('app-upgrade',seeded.appUpgrade).state,at('app-upgrade',seeded.appUpgrade).phase],['check-recorded','review']);
  // Unknown provider effects and in-flight operations never become expired reviews.
  assert.deepEqual([at('backup',seeded.backup).phase,at('backup',seeded.backup).expiresAt],['uncertain',null]);
  assert.deepEqual([at('dns',seeded.dns).phase,at('dns',seeded.dnsUncertain).phase,at('hosting',seeded.hosting).phase],['expired','uncertain','working']);
  assert.equal(at('source-import',seeded.sourceImport).phase,'attention');
  assert.deepEqual([at('checkout',seeded.checkout).phase,at('usage-review',seeded.usage).phase],['attention','working']);
  for(const [kind,item] of [['photo-removal',seeded.photoRemoval],['version-removal',seeded.versionRemoval],['domain-proof',seeded.domainProof],['directory',seeded.directory]])assert.deepEqual([at(kind,item).phase,at(kind,item).turnId],['review',kind==='directory'?null:item]);
 });
 await test('photo upload and safety states never imply clearance',async()=>{
  const items=await all(a,'kind=photo&view=all'),state=f=>{const i=find(items,'photo',f);return [i.state,i.phase];};
  assert.deepEqual(state(seeded.photoUpload),['upload-unconfirmed','uncertain']);
  assert.deepEqual(state(seeded.photoPending),['safety-pending','attention']);
  assert.deepEqual(state(seeded.photoStale),['safety-pending','attention']);
  assert.deepEqual(state(seeded.photoBlocked),['safety-blocked','attention']);
  assert.deepEqual(state(seeded.photoApproved),['safety-approved','finished']);
  const open=(await all(a,'kind=photo')).map(i=>i.id).sort();assert.deepEqual(open,[seeded.photoUpload,seeded.photoPending,seeded.photoStale,seeded.photoBlocked].sort());
 });
 await test('responses carry only index metadata, never private content or evidence',async()=>{
  const text=JSON.stringify(await all(a,'view=all'))+JSON.stringify(await detail(a,'form',seeded.submittedPast))+JSON.stringify(await detail(a,'photo',seeded.photoBlocked));
  for(const canary of ['CANARY','PRIVATE_','matched','clear','price_','example.com','export default'])assert(!text.includes(canary),canary);
 });
 await test('open view and kind filters; detail matches the list projection',async()=>{
  const open=await all(a,''),everything=await all(a,'view=all');
  assert(open.every(i=>!['finished','expired'].includes(i.phase)));assert(open.length<everything.length);
  assert(find(open,'form',seeded.submittedPast));assert(!find(open,'website',seeded.publishExpired));
  for(const [kind,item] of [['form',seeded.submittedPast],['photo',seeded.photoUpload],['website',seeded.publishExpired],['app-upgrade',seeded.appUpgrade]])assert.deepEqual((await detail(a,kind,item)).item,find(everything,kind,item));
  assert.deepEqual(await detail(a,'website',seeded.publish),{version:1,item:find(everything,'website',seeded.publish)});
  // An ID from another kind is not a link to this kind.
  await detail(a,'contact',seeded.publish,404);
 });
 await test('stable bounded pagination beyond thirty items',async()=>{
  const p=await owner(),ids=[];
  for(let n=0;n<35;n++){const r=id();ids.push(r);await run(`INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,${now},${now})`,r,p.user,h);}
  // A non-canonical stored ID could not be a cursor or link, so it is not listed.
  await run(`INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,${now},${now})`,id().toUpperCase(),p.user,h);
  const first=await list(p,'kind=inference');assert.equal(first.items.length,30);assert.equal(first.next,first.items[29].key);
  const second=await list(p,'kind=inference&after='+encodeURIComponent(first.next));assert.equal(second.items.length,5);assert.equal(second.next,null);
  const keys=[...first.items,...second.items].map(i=>i.key);assert.deepEqual(keys,[...keys].sort());assert.equal(new Set(keys).size,35);
  assert.deepEqual(keys.map(k=>k.slice('inference:'.length)).sort(),ids.sort());assert(first.items.every(i=>i.state==='reserved'&&i.phase==='working'));
  assert.deepEqual(await list(p,'kind=inference'),first);
  const combined=await all(p,'view=all');assert.deepEqual(combined.map(i=>i.key),[...combined.map(i=>i.key)].sort());assert.equal(combined.filter(i=>i.kind==='inference').length,35);
  // A cursor names a position, not a record: a removed cursor item still pages forward.
  assert.equal((await list(p,'kind=inference&after='+encodeURIComponent('inference:'+'0'.repeat(8)+'-0000-0000-0000-'+'0'.repeat(12)))).items.length,30);
 });
 await test('strict filters, cursors, links and methods',async()=>{
  for(const query of ['unknown=1','kind=chat&kind=chat','view=all&view=open','kind=nothing','kind=','view=done','after=garbage','after=chat:not-an-id','after=nothing:'+id(),'after=chat:'+id().toUpperCase(),'kind=__proto__','kind=toString'])await list(a,query,400);
  for(const [kind,item] of [['chat','not-an-id'],['nothing',id()],['chat',id().toUpperCase()],['toString',id()]])await detail(a,kind,item,400);
  await http(a,'/website/'+seeded.publish+'?view=all',400);await http(a,'/website/'+seeded.publish+'/extra',404);await http(a,'/',404);
  await http(a,'',404,'POST');await http(a,'/website/'+seeded.publish,404,'DELETE');
 });
 await test('owner isolation, signed-out and unstarted access',async()=>{
  const other=await all(b,'view=all');assert(!other.some(i=>Object.values(seeded).includes(i.id)));
  for(const [kind,item] of [['website',seeded.publish],['form',seeded.liveForm],['photo',seeded.photoUpload],['usage-review',seeded.usage],['inference',seeded.aiUncertain]])await detail(b,kind,item,404);
  await list(null,'',401);await detail(null,'website',seeded.publish,401);
  await list({authority:await workspaceFixture(db,modules.identity)},'',409);
  // A project that no longer belongs to the record owner hides its project records from both accounts.
  const c=await owner(),r=id();await run(`INSERT INTO publication_actions(id,user_id,project_id,kind,version_id,expected_revision,expires_at) VALUES(?,?,?,'publish',?,0,${soon})`,r,c.user,c.project,c.version);
  const form=(await forms.issueContentBrief(c.scope,c.user,{originTurnId:await turn(c),projectId:c.project,contentIds:['headline']})).envelope.id;
  assert(find(await all(c,'view=all'),'form',form)?.projectId===c.project);await detail(c,'website',r);
  await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Second','Other','draft',datetime('now'),datetime('now'))",id(),c.user);
  await run('UPDATE projects SET owner_user_id=? WHERE id=?',b.user,c.project);
  await detail(c,'website',r,404);await detail(b,'website',r,404);await detail(c,'form',form,404);await detail(b,'form',form,404);
 });
 await test('identity loss before or during the read fences the result',async()=>{
  const o=await owner();await run(`INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,${now},${now})`,id(),o.user,h);
  let intercepted=false;const database=interceptDatabase(db,/phase NOT IN/,async()=>{if(!intercepted){intercepted=true;await o.authority.revoke();}});
  const scope=await o.authority.scope(database);
  await assert.rejects(()=>saved.listSavedWork(scope,o.user,new URLSearchParams()),e=>e.status===409&&e.code==='identity_changed');assert(intercepted);
  await list(o,'',401);
  const foreign=await owner();await assert.rejects(()=>saved.listSavedWork(foreign.scope,o.user,new URLSearchParams()),e=>e.status===401);
 });
 await test('removed and retained records',async()=>{
  await run('DELETE FROM project_spec_proposals WHERE id=?',seeded.change);
  await detail(a,'website-change',seeded.change,404);assert.equal((await detail(a,'website-save',seeded.save)).item.phase,'finished');
  const discard=await forms.issueProjectIntake(a.scope,a.user,{originTurnId:await turn(a),template:'project-brief@1'});
  await forms.mutateInteraction(a.scope,a.user,{version:1,requestId:id(),interactionId:discard.envelope.id,definitionDigest:discard.envelope.definitionDigest,expectedAnswerRevision:discard.answerRevision,operation:'cancel'});
  await detail(a,'form',discard.envelope.id,404);await detail(a,'form',seeded.retainedDue,404);
  const missing=await http(a,'/inference/'+id(),404);assert.match(missing.error,/does not confirm whether an interrupted request finished/);
 });
 await test('reads are side-effect free: no provider call, inference or row change',async()=>{
  const before=await snapshot();
  for(const o of [a,b]){await all(o,'');await all(o,'view=all');for(const kind of Object.keys(shape.savedWorkKinds))await list(o,`kind=${kind}&view=all`);}
  for(const [kind,item] of [['backup',seeded.backup],['dns',seeded.dnsUncertain],['form',seeded.unknownPast],['inference',seeded.aiUncertain],['checkout',seeded.checkout]])await detail(a,kind,item);
  assert.deepEqual(await snapshot(),before);
 });
 assert.equal(network,0);assert.equal((await row('SELECT count(*) n FROM inference_calls')).n,0);
 console.log(`Saved work: ${cases} scenarios passed (${process.argv.includes('--d1')?'local D1':'SQLite'}): ${Object.keys(shape.savedWorkKinds).length} sources on populated current schema, truthful phases, no clearance or private content, bounded pagination, strict inputs, owner/identity isolation and read-only behavior.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
