Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';

const bundle=await build({stdin:{contents:"export * from './src/capability-catalog';export * from './src/composition-plans';export * from './src/backend-chat';export * from './src/backend-versions';export * from './src/agent-inspection';export * from './src/site-agent';export * from './src/ai-chat';export {readChat} from './src/chat';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const id=()=>crypto.randomUUID(),project=id(),request=(needs,extra={})=>({kind:'capabilities',operation:'plan',projectId:project,needs,...extra});
let maxBytes=0;
for(const needs of [['site.content'],['site.theme'],['site.contact','site.photos'],['function.line-total'],['function.text-statistics'],['app.task-list'],['form.function-inputs'],['diagnostics.website']]){
 const plan=api.composeCapabilities(request(needs));assert.notEqual(plan.outcome,'unsupported');assert.equal(plan.extension,null);assert.equal(plan.generatedSourceBytes,0);assert.deepEqual(plan.infrastructure,[]);
 assert.ok(plan.contracts.every(e=>e.version===1&&e.operations.length&&e.permissions.length&&e.contract.startsWith('docs/')));
 for(const entry of plan.contracts)await readFile(entry.contract);
 assert.ok(!JSON.stringify(plan).includes('source:'));maxBytes=Math.max(maxBytes,Buffer.byteLength(JSON.stringify(plan)));
}
const mixed=api.composeCapabilities(request(['site.contact','site.photos']));assert.equal(mixed.outcome,'composition');assert.equal(mixed.contracts.filter(e=>e.id==='site.content').length,1);
for(const need of ['schema.optional-field','access.staff-files','notification.staff','runtime.ai','infrastructure.dedicated','unknown.module']){
 const plan=api.composeCapabilities(request([need]));assert.equal(plan.outcome,'unsupported');assert.equal(plan.extension,null);assert.deepEqual(plan.infrastructure,[]);assert.equal(plan.generatedSourceBytes,0);
}
const custom=api.composeCapabilities(request(['custom.computation'],{extension:{missing:'Calculate a bounded rectangle area; existing helpers do not implement multiplication of dimensions.'}}));
assert.equal(custom.extension.scope,'pure-function');assert.equal(custom.extension.maxSourceBytes,8192);assert.equal(custom.extension.maintainerAI,false);assert.equal(custom.extension.network,false);
assert.equal(api.composeCapabilities(request(['custom.computation','notification.staff'],{extension:{missing:'A custom formula and a staff notification.'}})).extension,null);
for(const bad of [request([]),request(['site.content','site.content']),request(['site.content'],{ownerId:id()}),request(['site.content'],{source:'execute'}),request(['site.content@99']),request(['custom.computation']),request(['site.content'],{extension:{missing:'Arbitrary bypass description'}}),request(['custom.computation'],{extension:{missing:'Arbitrary custom work',network:true}}),request(['custom.computation','custom.visitor-transition'],{extension:{missing:'Unbounded multi-runtime work'}})])assert.throws(()=>api.composeCapabilities(bad));
const mutable=api.composeCapabilities(request(['site.content']));mutable.contracts[0].status='planned';assert.equal(api.composeCapabilities(request(['site.content'])).contracts[0].status,'available');
assert.match(await api.capabilityCatalogDigest(),/^[0-9a-f]{64}$/);
assert.equal(api.inspectionRequest(JSON.stringify({reply:'Inspect the supported tools.',action:request(['site.contact'])})),true);

// Use all migrations in disposable local D1; no remote bindings or paid inference.
const dir=await mkdtemp('/tmp/whumpo-composition-');let proxy;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 async function account(){const user=id(),projectId=id(),now=new Date().toISOString();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Synthetic garden','A harmless landscaping website','draft',?,?)").bind(projectId,user,now,now).run();return {user,projectId};}
 async function turn(owner){const t=id(),row=await db.prepare('SELECT coalesce(max(revision),0)+1 n FROM chat_turns WHERE user_id=?').bind(owner.user).first();await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Synthetic owner request','',?,'ai','pending')").bind(t,owner.user,row.n,new Date().toISOString()).run();return t;}
 async function plan(owner,needs=['custom.computation'],extension={missing:'Multiply width and length into rectangle area; neither library calculator nor text helper covers this.'},t){t??=await turn(owner);const result=await api.prepareCompositionPlan(db,owner.user,t,{kind:'capabilities',operation:'plan',projectId:owner.projectId,needs,...(extension?{extension}:{})});return {id:t,...result};}
 const owner=await account(),other=await account();
 const supported=await plan(owner,['site.content','site.theme'],null);
 assert.ok(!supported.inspection.includes(other.projectId));assert.ok(!supported.inspection.includes(other.user));assert.ok(!supported.inspection.includes('Synthetic garden'),'The catalog does not copy project content');
 assert.equal((await db.prepare('SELECT count(*) n FROM backend_versions').first()).n,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM site_versions').first()).n,0);
 const p=await plan(owner);assert.deepEqual((await plan(owner,['custom.computation'],undefined,p.id)).inspection,p.inspection);
 await assert.rejects(plan(owner,['site.content'],null,p.id),e=>e.status===409);
 await assert.rejects(api.prepareCompositionPlan(db,other.user,await turn(other),{kind:'capabilities',operation:'plan',projectId:owner.projectId,needs:['site.content']}),e=>e.status===404);
 await assert.rejects(db.prepare("UPDATE composition_plans SET extension_scope='visitor-transition' WHERE id=?").bind(p.id).run(),/composition_plan_immutable/);
 const source='export default input=>({area:input.width*input.length})';
 const create=(target,planId)=>({kind:'backend',operation:'create',projectId:target.projectId,source,...(planId?{planId}:{})});
 await assert.rejects(api.backendAction(db,owner.user,await turn(owner),create(owner)),e=>e.status===409);
 await assert.rejects(api.backendAction(db,other.user,await turn(other),create(other,p.id)),e=>e.status===404);
 await assert.rejects(api.backendAction(db,owner.user,await turn(owner),create(owner,supported.id)),e=>e.status===409);
 const customTurn=await turn(owner),draft=await api.backendAction(db,owner.user,customTurn,create(owner,p.id));await db.batch(draft.statements);
 assert.equal((await db.prepare('SELECT plan_id FROM backend_extension_uses WHERE version_id=?').bind(customTurn).first()).plan_id,p.id);
 assert.equal((await db.prepare('SELECT source FROM backend_versions WHERE id=?').bind(customTurn).first()).source,source);
 assert.equal((await db.prepare('SELECT count(*) n FROM backend_runs').first()).n,0);
 await assert.rejects(db.prepare('DELETE FROM backend_extension_uses WHERE version_id=?').bind(customTurn).run(),/composition_plan_retained/);
 await assert.rejects(api.backendAction(db,owner.user,await turn(owner),create(owner,p.id)),e=>e.status===409);
 await assert.rejects(plan(owner),e=>e.status===409,'Existing source needs an identified base');
 await assert.rejects(plan(owner,['custom.computation'],{missing:'Change the private transformation for this project.',baseVersionId:id()}),e=>e.status===404);
 const edit=await plan(owner,['custom.computation'],{missing:'Change the area function to include a perimeter value.',baseVersionId:customTurn});
 const editTurn=await turn(owner),pending=await api.backendAction(db,owner.user,editTurn,create(owner,edit.id));
 // An intervening version causes the same batch to roll back source, provenance and activity.
 const intervening=id();await api.saveBackend(db,owner.user,owner.projectId,intervening,'export default x=>x');
 await assert.rejects(db.batch(pending.statements),/composition_plan_changed/);
 assert.equal(await db.prepare('SELECT id FROM backend_versions WHERE id=?').bind(editTurn).first(),null);
 assert.equal(await db.prepare('SELECT id FROM activity_events WHERE id=?').bind('backend:'+editTurn).first(),null);
 // Removing and replacing a version cannot conceal the revision change behind the same count.
 const beforeCount=(await db.prepare('SELECT count(*) n FROM backend_versions WHERE project_id=?').bind(owner.projectId).first()).n;
 const stale=await plan(owner,['custom.computation'],{missing:'Add a numeric result field without changing other behavior.',baseVersionId:customTurn});
 await db.prepare('DELETE FROM backend_versions WHERE id=?').bind(intervening).run();await api.saveBackend(db,owner.user,owner.projectId,id(),'export default x=>x');
 assert.equal((await db.prepare('SELECT count(*) n FROM backend_versions WHERE project_id=?').bind(owner.projectId).first()).n,beforeCount);
 await assert.rejects(api.requireExtensionPlan(db,owner.user,owner.projectId,stale.id,'pure-function'),e=>e.status===409);
 const fresh=await account(),freshPlan=await plan(fresh);await db.prepare('UPDATE projects SET details_revision=details_revision+1 WHERE id=?').bind(fresh.projectId).run();await assert.rejects(api.requireExtensionPlan(db,fresh.user,fresh.projectId,freshPlan.id,'pure-function'),e=>e.status===409);
 const timed=await account(),realNow=Date.now;Date.now=()=>realNow()-1000000;let old;try{old=await plan(timed);}finally{Date.now=realNow;}await assert.rejects(api.requireExtensionPlan(db,timed.user,timed.projectId,old.id,'pure-function'),e=>e.status===409);
 // Exact committed lookup recovers when its write acknowledgement is lost.
 const recovering=await account();let lost=false;const lossy=new Proxy(db,{get(t,k){if(k==='prepare')return sql=>{const statement=t.prepare(sql);if(!sql.startsWith('INSERT INTO composition_plans'))return statement;return {bind(...args){const bound=statement.bind(...args);return {async run(){await bound.run();lost=true;throw Error('Lost plan acknowledgment');}};}};};const v=t[k];return typeof v==='function'?v.bind(t):v;}});
 const recovered=await api.prepareCompositionPlan(lossy,recovering.user,await turn(recovering),{kind:'capabilities',operation:'plan',projectId:recovering.projectId,needs:['site.content']});assert.equal(lost,true);assert.match(recovered.reply,/existing capabilities/);

 // End-to-end bounded model lookup -> existing content editor, with zero generated backend source.
 const chat=await account(),chatId=id(),state=(await api.readChat(db,chat.user)).state;let calls=0,lookupBytes=0;
 const cfg={baseURL:'https://fixture.example/v1',apiKey:'synthetic',model:'fixture'};
 const respond=action=>Response.json({choices:[{message:{content:JSON.stringify({reply:'Untrusted claim of deployment',action})},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:200}});
 const transport=async(_url,init)=>{calls++;const body=JSON.parse(init.body);if(calls===1)return respond({kind:'capabilities',operation:'plan',projectId:chat.projectId,needs:['site.content']});const lookup=body.messages.find(m=>m.content.includes('workspace_lookup_result'));assert.ok(lookup);lookupBytes=Buffer.byteLength(lookup.content);assert.ok(!lookup.content.includes('custom.computation'));assert.ok(!lookup.content.includes(other.projectId));return respond({kind:'preview',projectId:chat.projectId,config:{name:'Synthetic garden',headline:'Local garden care',description:'Landscaping for our neighbors.',theme:'forest',aboutTitle:'Our services',aboutText:'Garden maintenance.',sections:[{heading:'Hours',text:'Weekdays, 8am to 5pm.'}]}});};
 await api.sendAIChat(db,chat.user,chatId,state.revision,'Add my landscaping services and opening hours to a private website draft.',cfg,transport);
 assert.equal(calls,2);assert.ok(lookupBytes<8000);assert.ok(await db.prepare('SELECT id FROM site_versions WHERE id=?').bind(chatId).first());assert.equal(await db.prepare('SELECT id FROM backend_versions WHERE id=?').bind(chatId).first(),null);
 assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(chatId).first()).status,'completed');
 await api.sendAIChat(db,chat.user,chatId,state.revision,'Add my landscaping services and opening hours to a private website draft.',cfg,transport);assert.equal(calls,2);

 // Planning cannot be mounted through public/visitor routes. Existing app journey checks runtime isolation.
 for(const file of ['src/site-host.ts','src/app-host.ts','src/runtime/worker.ts']){const source=await readFile(file,'utf8');assert.doesNotMatch(source,/prepareCompositionPlan|sendAIChat|composition-plans|capability-catalog/);}
 // Whole-project deletion can cascade retained associations; isolated evidence deletion was refused above.
 await db.prepare('DELETE FROM projects WHERE id=?').bind(owner.projectId).run();
 assert.equal((await db.prepare('SELECT count(*) n FROM composition_plans WHERE project_id=?').bind(owner.projectId).first()).n,0);
 assert.equal(await db.prepare('SELECT version_id FROM backend_extension_uses WHERE version_id=?').bind(customTurn).first(),null);
 assert.equal((await db.prepare('SELECT count(*) n FROM publications WHERE version_id IS NOT NULL').first()).n,0);
 console.log(JSON.stringify({largestRepresentativeContractBytes:maxBytes,connectedLookupBytes:lookupBytes,connectedModelCalls:calls,generatedBackendSourceBytesForSupportedRequest:0}));
 console.log('Composition planner passed: versioned relevant contracts, configuration/composition preference, planned/unknown refusal, immutable private plans, owner/base/revision/expiry boundaries, atomic stale rollback, missing-plan denial, exact replay/lost acknowledgement and connected natural-language lookup to private site draft. No paid inference, runtime AI, publication or infrastructure activation.');
}finally{if(proxy)await proxy.dispose();await rm(dir,{recursive:true,force:true});}
