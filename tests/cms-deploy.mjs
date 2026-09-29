import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {deployCMS,connectCMS}=await module('src/cms-deploy.ts'),{prepareCMS,confirmCMS}=await module('src/cms-projects.ts'),{allocateCMSResources}=await module('src/cms-provision.ts'),{deriveCMSSecret,verifyCMSRequest}=await module('src/cms-bridge.ts'),{readCMSStatus}=await module('src/cms-status.ts');
const {createCMSDraft,readCMSDraft,listCMSDrafts,cmsContentAction,cmsContentCommand}=await module('src/cms-content.ts'),{cmsRequestAllowed}=await module('src/cms-bridge.ts');
const {sendChat,readChat}=await module('src/chat.ts'),{prepareSiteAction}=await module('src/site-agent.ts');
const dir=await mkdtemp('/tmp/whumpo-cms-deploy-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe'});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB,id=()=>crypto.randomUUID(),account='a'.repeat(32),master='local-master-fixture-'.repeat(4),digest='b'.repeat(64);
async function fixture(){const user=id(),project=id(),now=new Date().toISOString();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Deploy fixture','','draft',?,?)").bind(project,user,now,now).run();const review=await prepareCMS(db,user,id(),project,'My CMS','Our updates');await confirmCMS(db,user,review.id);const resources=new Map();await allocateCMSResources(db,project,{accountId:account,find:async(k,n)=>resources.get(k+n)??null,create:async(k,n)=>resources.set(k+n,k==='database'?id():k==='session'?id().replaceAll('-',''):n)});const origin='https://whumpo-cms-'+project.replaceAll('-','')+'.digifender.com',config={projectId:project,ownerId:user,origin,secret:await deriveCMSSecret(master,project,user,origin)};return {user,project,review,config};}
function provider(a){let tag=null,version=null,initialized=false,setupId=null;const p={accountId:account,uploads:0,setups:0,owner:a.user,missingPages:false,unresolved:false,lostUpload:false,exists:async()=>version!==null,deploy:async(_name,t)=>{p.uploads++;if(p.unresolved)throw Error('unknown');tag=t;version=id();if(p.lostUpload)throw Error('lost upload acknowledgement');},activeVersion:async(_name,t)=>tag===t?version:null,replaceVersion:()=>{version=id();},service:{fetch:async request=>{const verified=await verifyCMSRequest(request,a.config);let data;
 if(verified.path==='/_emdash/api/setup/status')data={needsSetup:!initialized};
 else if(verified.path==='/_emdash/api/setup'){assert.deepEqual(JSON.parse(verified.body),{title:'My CMS',tagline:'Our updates',includeContent:false});if(setupId&&setupId!==verified.id)throw Error('unexpected setup ID');if(!initialized)p.setups++;initialized=true;setupId=verified.id;data={setupComplete:true,seedComplete:true};}
 else if(verified.path==='/_emdash/api/auth/me')data={email:p.owner+'@owners.whumpo.invalid',role:50};
 else if(verified.path==='/_emdash/api/schema/collections')data={items:p.missingPages?[{slug:'posts'}]:[{slug:'posts'},{slug:'pages'}]};
 else throw Error('unexpected path');return Response.json({success:true,data});}}};return p;}
try{
 const a=await fixture(),p=provider(a);p.lostUpload=true;const deployed=await deployCMS(db,a.project,digest,a.config,p);assert.equal(deployed.state,'verified');assert.equal(p.uploads,1);assert.equal(p.setups,1);assert.equal((await db.prepare('SELECT state FROM cms_instances WHERE project_id=?').bind(a.project).first()).state,'provisioning');
 await deployCMS(db,a.project,digest,a.config,p);assert.equal(p.uploads,1);assert.equal(p.setups,1);
 await assert.rejects(deployCMS(db,a.project,'c'.repeat(64),a.config,p),/inputs changed/);
 await assert.rejects(deployCMS(db,a.project,digest,{...a.config,secret:'wrong'.repeat(12)},p),/inputs changed/);
 await assert.rejects(db.prepare("UPDATE cms_instances SET state='ready',deployed_version_id=? WHERE project_id=?").bind(id(),a.project).run(),/readiness_not_verified/);
 const platform=id();await connectCMS(db,a.project,platform);await connectCMS(db,a.project,platform);assert.equal((await db.prepare('SELECT state FROM cms_instances WHERE project_id=?').bind(a.project).first()).state,'ready');
 const env={CMS_BRIDGE_MASTER_KEY:master,['CMS_'+a.project.replaceAll('-','')]:p.service};assert.deepEqual((await readCMSStatus(db,a.user,a.project,env)).collections,['posts','pages']);await assert.rejects(readCMSStatus(db,id(),a.project,env),e=>e.status===404);
 const originalFetch=p.service.fetch,receipts=new Map();let creates=0,lose=true;const nativeId='01ARZ3NDEKTSV4RRFFQ69G5FAV';
 p.service.fetch=async request=>{const v=await verifyCMSRequest(request,a.config);assert.ok(cmsRequestAllowed(request.method,v.path,v.body));
  if(v.path==='/_emdash/api/content/posts'){
   let data=receipts.get(v.id);if(!data){creates++;data={item:{id:nativeId,status:'draft',data:JSON.parse(v.body).data}};receipts.set(v.id,data);}
   if(lose){lose=false;throw Error('lost response');}return Response.json({success:true,data});
  }
  if(v.path==='/_emdash/api/content/posts/'+nativeId)return Response.json({success:true,data:[...receipts.values()][0]});return originalFetch(request);
 };
 const draftId=id();await assert.rejects(createCMSDraft(db,a.user,a.project,draftId,'posts','Draft title','Private text',env),e=>e.status===503);
 const draft=await cmsContentAction(db,a.user,{operation:'retryDraft',projectId:a.project,requestId:draftId},id(),env);assert.equal(draft.itemId,nativeId);assert.equal(creates,1);
 await assert.rejects(createCMSDraft(db,a.user,a.project,draftId,'posts','Changed','Private text',env),e=>e.status===409);
 await assert.rejects(createCMSDraft(db,id(),a.project,id(),'posts','Foreign','Private text',env),e=>e.status===404);
 assert.equal((await readCMSDraft(db,a.user,a.project,draftId,env)).item.data.title,'Draft title');assert.equal((await listCMSDrafts(db,a.user,a.project,env)).length,1);
 await assert.rejects(readCMSDraft(db,id(),a.project,draftId,env),e=>e.status===404);
 await assert.rejects(cmsContentAction(db,a.user,{operation:'draft',projectId:a.project,collection:'posts',title:'Bad',text:'Body',status:'published'},id(),env),e=>e.status===400);
 const execute=(action,rid)=>cmsContentAction(db,a.user,action,rid,env);assert.match(await cmsContentCommand('/cms-read '+a.project+' '+draftId,id(),execute)(),/Draft title/);
 assert.match(await cmsContentCommand('/cms-retry '+a.project+' '+draftId,id(),execute)(),/not published/);assert.equal(creates,1);
 const chat=await readChat(db,a.user);assert.equal((await sendChat(db,a.user,{id:id(),revision:chat.state.revision,content:'/cms-read '+a.project+' '+draftId},undefined,{cmsContent:execute})).status,200);assert.match((await readChat(db,a.user)).turns.at(-1).assistant_text,/Draft title/);
 const proposal=await prepareSiteAction(db,a.user,id(),JSON.stringify({reply:'FAKE PUBLISHED CLAIM',action:{kind:'cms',operation:'retryDraft',projectId:a.project,requestId:draftId}}),{},{cmsContent:execute});assert.match(proposal.reply,/not published/);assert.ok(!proposal.reply.includes('FAKE'));assert.equal(creates,1);
 await assert.rejects(db.prepare('UPDATE cms_draft_requests SET body=? WHERE id=?').bind('{}',draftId).run(),/immutable/);
 const contentFetch=p.service.fetch,editReceipts=new Map();let updates=0,loseEdit=true,current={...(await readCMSDraft(db,a.user,a.project,draftId,env)),_rev:'cmV2LTE='};
 p.service.fetch=async request=>{const v=await verifyCMSRequest(request,a.config);assert.ok(cmsRequestAllowed(request.method,v.path,v.body));
  if(v.path==='/_emdash/api/content/posts/'+nativeId){
   if(request.method==='GET')return Response.json({success:true,data:{item:current.item,_rev:current._rev}});
   if(!editReceipts.has(v.id)){const body=JSON.parse(v.body);if(body._rev!==current._rev)return Response.json({success:false},{status:409});updates++;current={item:{...current.item,data:body.data},_rev:'cmV2LTI='};editReceipts.set(v.id,structuredClone(current));}
   if(loseEdit){loseEdit=false;throw Error('lost edit response');}return Response.json({success:true,data:editReceipts.get(v.id)});
  }return contentFetch(request);
 };
 const editId=id(),editAction={operation:'editDraft',projectId:a.project,requestId:draftId,title:'Edited',text:'Changed',revision:'cmV2LTE='};
 await assert.rejects(cmsContentAction(db,a.user,editAction,editId,env),e=>e.status===503);
 const edited=await cmsContentAction(db,a.user,{operation:'retryEdit',projectId:a.project,requestId:editId},id(),env);assert.equal(edited.revision,'cmV2LTI=');assert.equal(updates,1);
 await cmsContentAction(db,a.user,{operation:'retryEdit',projectId:a.project,requestId:editId},id(),env);assert.equal(updates,1);
 await assert.rejects(cmsContentAction(db,a.user,editAction,id(),env),e=>e.status===409);
 await assert.rejects(cmsContentAction(db,a.user,{...editAction,title:'Forged'},editId,env),e=>e.status===409);
 await assert.rejects(cmsContentAction(db,id(),{operation:'retryEdit',projectId:a.project,requestId:editId},id(),env),e=>e.status===404);
 await assert.rejects(cmsContentAction(db,a.user,{...editAction,status:'published'},id(),env),e=>e.status===400);
 assert.equal((await cmsContentAction(db,a.user,{operation:'listEdits',projectId:a.project,requestId:draftId},id(),env)).length,1);
 assert.match(await cmsContentCommand('/cms-retry-edit '+a.project+' '+editId,id(),execute)(),/cmV2LTI=/);
 await assert.rejects(db.prepare('UPDATE cms_edit_requests SET body=? WHERE id=?').bind('{}',editId).run(),/immutable/);
 const editProposal=await prepareSiteAction(db,a.user,id(),JSON.stringify({reply:'FAKE',action:{kind:'cms',operation:'retryEdit',projectId:a.project,requestId:editId}}),{},{cmsContent:execute});assert.match(editProposal.reply,/not published/);assert.ok(!editProposal.reply.includes('FAKE'));
 await db.batch(Array.from({length:88},()=>db.prepare('INSERT INTO cms_edit_requests(id,draft_request_id,body) VALUES(?,?,?)').bind(id(),draftId,'{}')));
 await assert.rejects(createCMSDraft(db,a.user,a.project,id(),'posts','Over cap','Body',env),e=>e.status===409);
 await assert.rejects(db.prepare('INSERT INTO cms_edit_requests(id,draft_request_id,body) VALUES(?,?,?)').bind(id(),draftId,'{}').run(),/not_available/);
 p.replaceVersion();await assert.rejects(deployCMS(db,a.project,digest,a.config,p),/version changed/);
 const b=await fixture(),bad=provider(b);bad.owner=id();await assert.rejects(deployCMS(db,b.project,digest,b.config,bad),/owner could not/);await assert.rejects(connectCMS(db,b.project,id()),/not recorded/);bad.owner=b.user;bad.missingPages=true;await assert.rejects(deployCMS(db,b.project,digest,b.config,bad),/collections are missing/);bad.missingPages=false;await deployCMS(db,b.project,digest,b.config,bad);assert.equal(bad.uploads,1);assert.equal(bad.setups,1);
 const c=await fixture(),uncertain=provider(c);uncertain.unresolved=true;await assert.rejects(deployCMS(db,c.project,digest,c.config,uncertain),/unresolved/);await assert.rejects(deployCMS(db,c.project,digest,c.config,uncertain),/unresolved/);assert.equal(uncertain.uploads,1);
 const d=await fixture(),collision=provider(d);collision.exists=async()=>true;await assert.rejects(deployCMS(db,d.project,digest,d.config,collision),/already exists/);assert.equal(collision.uploads,0);
 assert.notEqual(a.config.secret,b.config.secret);assert.equal(a.config.secret,await deriveCMSSecret(master,a.project,a.user,a.config.origin));
 console.log('CMS deployment checks passed: immutable artifact/key receipts, lost upload acknowledgment, no blind redeploy, exact setup request, owner/schema verification, readiness gate, platform status isolation, derived project keys, native draft request recovery, owner isolation, guided chat, authoritative agent receipts, revision-bound edits, exact edit recovery and combined content capacity.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
