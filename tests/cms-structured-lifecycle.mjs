import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const live=process.argv.includes('--live');if(live&&process.env.RUN_LIVE_MUSE!=='1')throw Error('Set RUN_LIVE_MUSE=1 for real provider acceptance');
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {deployCMS,connectCMS}=await module('src/cms-deploy.ts'),{prepareCMS,confirmCMS}=await module('src/cms-projects.ts'),{allocateCMSResources}=await module('src/cms-provision.ts'),{deriveCMSSecret,verifyCMSRequest}=await module('src/cms-bridge.ts');
const {cmsContentAction}=await module('src/cms-content.ts');
const dir=await mkdtemp('/tmp/whumpo-cms-deploy-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe'});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB,id=()=>crypto.randomUUID(),account='a'.repeat(32),master='local-master-fixture-'.repeat(4),digest='b'.repeat(64);
async function fixture(){const user=id(),project=id(),now=new Date().toISOString();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Deploy fixture','','draft',?,?)").bind(project,user,now,now).run();const review=await prepareCMS(db,user,id(),project,'My CMS','Our updates');await confirmCMS(db,user,review.id);const resources=new Map();await allocateCMSResources(db,project,{accountId:account,find:async(k,n)=>resources.get(k+n)??null,create:async(k,n)=>resources.set(k+n,k==='database'?id():k==='session'?id().replaceAll('-',''):n)});const origin='https://whumpo-cms-'+project.replaceAll('-','')+'.whumpo.site',config={projectId:project,ownerId:user,origin,secret:await deriveCMSSecret(master,project,user,origin)};return {user,project,review,config};}
function provider(a){let tag=null,version=null,initialized=false,setupId=null;const p={accountId:account,uploads:0,setups:0,owner:a.user,missingPages:false,unresolved:false,lostUpload:false,exists:async()=>version!==null,deploy:async(_name,t)=>{p.uploads++;if(p.unresolved)throw Error('unknown');tag=t;version=id();if(p.lostUpload)throw Error('lost upload acknowledgement');},activeVersion:async(_name,t)=>tag===t?version:null,replaceVersion:()=>{version=id();},service:{fetch:async request=>{const verified=await verifyCMSRequest(request,a.config);let data;
 if(verified.path==='/_emdash/api/setup/status')data={needsSetup:!initialized};
 else if(verified.path==='/_emdash/api/setup'){assert.deepEqual(JSON.parse(verified.body),{title:'My CMS',tagline:'Our updates',includeContent:false});if(setupId&&setupId!==verified.id)throw Error('unexpected setup ID');if(!initialized)p.setups++;initialized=true;setupId=verified.id;data={setupComplete:true,seedComplete:true};}
 else if(verified.path==='/_emdash/api/auth/me')data={email:p.owner+'@owners.whumpo.invalid',role:50};
 else if(verified.path==='/_emdash/api/schema/collections')data={items:p.missingPages?[{slug:'posts'}]:[{slug:'posts'},{slug:'pages'}]};
 else throw Error('unexpected path');return Response.json({success:true,data});}}};return p;}
const {cmsGateway}=await module('src/cms-gateway.ts');
try{
 const a=await fixture(),p=provider(a);await deployCMS(db,a.project,digest,a.config,p);await connectCMS(db,a.project,id());
 const nativeEnv={DB:db,WHUMPO_CMS_PROJECT_ID:a.project,WHUMPO_CMS_OWNER_ID:a.user,WHUMPO_CMS_ORIGIN:a.config.origin,WHUMPO_CMS_BRIDGE_KEY:a.config.secret};
 const itemId='01ARZ3NDEKTSV4RRFFQ69G5FAV';let item,revision='rev1',writes=0,drop=false,capable=true;
 const dispatch=async request=>{
  if(request.method==='GET')return Response.json({success:true,data:{item,_rev:revision}});
  const body=await request.json();
  if(request.method==='PUT'&&body._rev!==revision)return Response.json({error:'conflict'},{status:409});
  writes++;revision='rev'+(writes+1);item={id:itemId,status:'draft',data:body.data};return Response.json({success:true,data:{item,_rev:revision}});
 };
 const env={CMS_BRIDGE_MASTER_KEY:master,['CMS_'+a.project.replaceAll('-','')]:{fetch:async request=>{
  if(!capable&&new URL(request.url).pathname.endsWith('/capabilities'))return Response.json({error:'old gateway'},{status:403});
  const response=await cmsGateway(request,nativeEnv,dispatch);if(drop&&request.method!=='GET'){drop=false;throw Error('Lost acknowledgement after native receipt');}return response;
 }}};
 const content=[{_type:'block',_key:'heading',style:'h2',markDefs:[],children:[{_type:'span',_key:'bold',text:'A formatted story',marks:['strong']}]},{_type:'block',_key:'list',style:'normal',listItem:'bullet',level:1,markDefs:[{_type:'link',_key:'url',href:'https://example.com'}],children:[{_type:'span',_key:'link',text:'Details',marks:['url','em']}]}];
 const draftId=id(),draftAction={operation:'structuredDraft',projectId:a.project,collection:'posts',title:'Structured story',content};
 capable=false;await assert.rejects(cmsContentAction(db,a.user,draftAction,draftId,env),e=>e.status===409);assert.equal(await db.prepare('SELECT id FROM cms_draft_requests WHERE id=?').bind(draftId).first(),null);assert.equal(writes,0);
 capable=true;drop=true;await assert.rejects(cmsContentAction(db,a.user,draftAction,draftId,env),e=>e.status===503);assert.equal(writes,1);assert.deepEqual(item.data.content,content);
 await cmsContentAction(db,a.user,{operation:'retryDraft',projectId:a.project,requestId:draftId},id(),env);assert.equal(writes,1);assert.deepEqual(item.data.content,content);
 await assert.rejects(cmsContentAction(db,id(),draftAction,id(),env),e=>e.status===404);
 const edited=structuredClone(content);edited[1].children[0].text='Updated details';const editId=id(),editAction={operation:'editStructuredDraft',projectId:a.project,requestId:draftId,title:'Edited story',content:edited,revision};
 drop=true;await assert.rejects(cmsContentAction(db,a.user,editAction,editId,env),e=>e.status===503);assert.equal(writes,2);assert.deepEqual(item.data.content,edited);
 const result=await cmsContentAction(db,a.user,{operation:'retryEdit',projectId:a.project,requestId:editId},id(),env);assert.equal(result.publicationChanged,false);assert.equal(writes,2);
 capable=false;assert.deepEqual(await cmsContentAction(db,a.user,{operation:'retryEdit',projectId:a.project,requestId:editId},id(),env),result);assert.equal(writes,2);
 await assert.rejects(cmsContentAction(db,a.user,{...editAction,revision},id(),env),e=>e.status===409);assert.equal(writes,2);
 capable=true;await assert.rejects(cmsContentAction(db,a.user,{...editAction,revision:'stale'},id(),env),e=>e.status===409);
 await assert.rejects(cmsContentAction(db,a.user,{operation:'editDraft',projectId:a.project,requestId:draftId,title:'Flatten',text:'Lost formatting',revision},id(),env),e=>e.status===409);assert.equal(writes,2);
 await assert.rejects(cmsContentAction(db,a.user,{...editAction,content,revision:editAction.revision},editId,env),e=>e.status===409);
 // A structured replacement with a single plain paragraph must retain its mode on recovery.
 const plain=[{_type:'block',_key:'paragraph',style:'normal',markDefs:[],children:[{_type:'span',_key:'text',text:'Intentionally simplified',marks:[]}]}];
 const simplifyId=id();drop=true;await assert.rejects(cmsContentAction(db,a.user,{...editAction,content:plain,revision},simplifyId,env),e=>e.status===503);
 await cmsContentAction(db,a.user,{operation:'retryEdit',projectId:a.project,requestId:simplifyId},id(),env);assert.equal(writes,3);assert.deepEqual(item.data.content,plain);
 assert.equal((await db.prepare('SELECT content_format FROM cms_edit_requests WHERE id=?').bind(simplifyId).first()).content_format,'structured');
 await assert.rejects(db.prepare("UPDATE cms_edit_requests SET content_format='plain' WHERE id=?").bind(simplifyId).run());
 await assert.rejects(db.prepare("UPDATE cms_draft_requests SET content_format='plain' WHERE id=?").bind(draftId).run());
 // Unknown native content cannot be silently replaced even through the structured path.
 item.data.content[0].alignment='center';await assert.rejects(cmsContentAction(db,a.user,{...editAction,revision},id(),env),e=>e.status===409);assert.equal(writes,3);
 const worker=(await module('src/index.ts')).default,{hashToken}=await module('src/security.ts');
 const session='c'.repeat(64),stamp=new Date().toISOString();await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(session),a.user,new Date(Date.now()+3600000).toISOString(),stamp).run();
 const http=(suffix,method,body,token=session,origin='https://whumpo.com')=>worker.fetch(new Request('https://whumpo.com/api/cms/'+a.project+'/content'+suffix,{method,headers:{origin,cookie:'whumpo_session='+token,'content-type':'application/json'},body:JSON.stringify(body)}),{...env,DB:db,AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}},{waitUntil(){}});
 const httpId=id(),payload={id:httpId,collection:'posts',title:'HTTP formatted draft',content};
 assert.equal((await http('','POST',payload,'')).status,401);
 assert.equal((await http('','POST',payload,session,'https://evil.test')).status,403);
 assert.equal((await http('','POST',{...payload,text:'Mixed modes'})).status,400);
 assert.equal((await http('','POST',payload)).status,200);assert.deepEqual(item.data.content,content);assert.equal(writes,4);
 assert.equal((await http('/'+httpId,'PATCH',{id:id(),title:'HTTP edit',content:edited,revision})).status,200);assert.deepEqual(item.data.content,edited);assert.equal(writes,5);
 // Agent read-follow-up-edit uses the full structured body, never native metadata.
 const {sendAIChat}=await module('src/ai-chat.ts'),{readChat}=await module('src/chat.ts'),{getBilling}=await module('src/billing.ts');
 await readChat(db,a.user);await db.prepare("UPDATE workspace_state SET step='ready' WHERE user_id=?").bind(a.user).run();await getBilling(db,a.user);if(!process.argv.includes('--explore'))await db.prepare('UPDATE usage_periods SET allowance=1000 WHERE user_id=?').bind(a.user).run();
 item.privateCanary='native-private-metadata';item.data.privateCanary='native-data-metadata';
 const agentContent=structuredClone(item.data.content);agentContent[0].children[0].text='Agent revised heading';const originalTitle=item.data.title,baseRevision=revision;let modelCalls=0;
 const model=async(_url,init)=>{modelCalls++;const action=modelCalls===1?{kind:'cms',operation:'readDraft',projectId:a.project,requestId:httpId}:{kind:'cms',operation:'editStructuredDraft',projectId:a.project,requestId:httpId,revision:baseRevision,title:originalTitle,content:agentContent};if(modelCalls===2){const input=JSON.stringify(JSON.parse(init.body));assert.ok(input.includes('cms_content_lookup'));assert.ok(input.includes('structuredEditing'));assert.ok(input.includes('Updated details'));assert.ok(input.includes('https://example.com'));assert.ok(!input.includes('native-private-metadata'));assert.ok(!input.includes('native-data-metadata'));}if(live)return fetch(_url,init);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Reading before editing.',action})}]}],usage:{input_tokens:100,output_tokens:200}});};
 const state=(await readChat(db,a.user)).state,turn=id(),ai={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:live?(await readFile('opencode.key','utf8')).trim():'synthetic',protocol:'responses'},options={cmsContent:(action,request)=>cmsContentAction(db,a.user,action,request,env)};
 const message=`For project ${a.project}, CMS content request ${httpId}, change only the first heading text to exactly "Agent revised heading". Keep the article title, all other text, formatting, links and IDs. Read the current article first, then save a private edit. Do not publish it.`;
 const outcome=await sendAIChat(db,a.user,turn,state.revision,message,ai,model,options);if(live)console.log(JSON.stringify({outcome,modelCalls,nativeWrites:writes,turn:await db.prepare('SELECT status,assistant_text,input_tokens,output_tokens FROM chat_turns WHERE id=?').bind(turn).first()}));assert.equal(outcome.status,200);assert.equal(modelCalls,2);assert.equal(writes,6);assert.deepEqual(item.data.content,agentContent);assert.equal(item.data.title,originalTitle);
 const turnRow=await db.prepare('SELECT status,assistant_text FROM chat_turns WHERE id=?').bind(turn).first();assert.equal(turnRow.status,'completed');assert.match(turnRow.assistant_text,/saved privately/);
 const lookup=await db.prepare('SELECT result_text FROM agent_inspections WHERE turn_id=?').bind(turn).first();assert.equal(JSON.parse(lookup.result_text).revision,baseRevision);assert.ok(!lookup.result_text.includes('native-data-metadata'));
 const spent=(await getBilling(db,a.user)).quota.spent;await sendAIChat(db,a.user,turn,state.revision,message,ai,model,options);assert.equal((await getBilling(db,a.user)).quota.spent,spent);assert.equal(modelCalls,2);assert.equal(writes,6);
 assert.equal((await db.prepare('SELECT count(*) n FROM cms_publication_reviews WHERE project_id=?').bind(a.project).first()).n,0);
 if(live)console.log(JSON.stringify({liveCMSAccepted:true,spent,modelCalls,allowance:(await getBilling(db,a.user)).quota.allowance,note:'Disposable local test quota; real provider, synthetic article and native handler; no public changes'}));
 console.log('Structured CMS lifecycle passed: capability refusal before reservation, lossless create/edit recovery, completed receipts, mode immutability, plain guard, revision conflicts and unsupported native content.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
