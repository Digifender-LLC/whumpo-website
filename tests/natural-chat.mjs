import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const bundle=await build({stdin:{contents:"export {saveBackend,testBackend} from './src/backend-versions';export {default as platform} from './src/index';export {hashToken} from './src/security';export {sendConversation,sendChatControl,sendChat,readChat} from './src/chat';export {chatControl,confirmationControls} from './src/chat-controls';export {prepareSiteAction,siteContext,agentPrompt} from './src/site-agent';export {inspectWorkspace} from './src/workspace-read';export {readAgentKnowledge,knowledgeTopics} from './src/agent-knowledge';export {conversationalReply} from './src/chat-language';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {saveBackend,testBackend,platform,hashToken,sendConversation,sendChatControl,sendChat,readChat,chatControl,confirmationControls,prepareSiteAction,siteContext,agentPrompt,inspectWorkspace,readAgentKnowledge,knowledgeTopics,conversationalReply}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-natural-chat-');let proxy;const originalFetch=globalThis.fetch;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 const user=crypto.randomUUID(),project=crypto.randomUUID(),other=crypto.randomUUID();
 for(const owner of [user,other]){await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(owner,owner+'@example.test',new Date().toISOString()).run();await readChat(db,owner);}
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','A landscaping website','draft',?,?)").bind(project,user,new Date().toISOString(),new Date().toISOString()).run();
 await db.prepare("UPDATE workspace_state SET step='ready' WHERE user_id=?").bind(user).run();
 const input=async(content,owner=user)=>({id:crypto.randomUUID(),revision:(await readChat(db,owner)).state.revision,content});
 const built=await input('/build ocean '+project);assert.equal((await sendChat(db,user,built)).status,200);
 const review=await input('/publish '+built.id);assert.equal((await sendChat(db,user,review)).status,200);
 const config={baseURL:'https://opencode.ai/zen/go/v1',apiKey:'synthetic',model:'muse-spark-1.3-contributor',protocol:'responses'};
 let calls=0,queue=[],requests=[];
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith(config.baseURL)){calls++;requests.push(JSON.parse(options.body));const action=queue.shift()??null;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Use the reviewed approval control when you are ready.',action})}]}],usage:{input_tokens:200,output_tokens:80}});}
  return originalFetch(url,options);
 };
 const literal=await input('/confirm '+review.id);assert.equal((await sendConversation(db,user,literal,config)).status,200);
 assert.equal(calls,1);assert.ok(JSON.stringify(requests[0]).includes(literal.content));
 assert.equal((await db.prepare('SELECT version_id FROM publications WHERE project_id=?').bind(project).first())?.version_id??null,null);
 assert.equal((await sendConversation(db,user,literal,config)).status,200);assert.equal(calls,1);
 assert.equal((await sendConversation(db,user,{...literal,content:'Different'},config)).status,409);
 for(const content of ['/new','/first-draft '+project,'/ask Explain /api/projects','Explain https://example.test/path and /etc/config']){const message=await input(content);assert.equal((await sendConversation(db,user,message,config)).status,200);assert.ok(JSON.stringify(requests.at(-1)).includes(content));}
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects WHERE owner_user_id=?').bind(user).first()).n,1);
 const unavailable=await input('Help me change my site');assert.equal((await sendConversation(db,user,unavailable)).status,503);assert.equal((await readChat(db,user)).state.revision,unavailable.revision);
 const privateStart=calls,privateReview=await input('request a usage review: Please explain my saved usage.');
 assert.equal((await sendConversation(db,user,privateReview,config)).status,200);
 assert.equal((await db.prepare('SELECT ai_context_allowed FROM chat_turns WHERE id=?').bind(privateReview.id).first()).ai_context_allowed,0);
 assert.equal((await sendConversation(db,user,await input('show my usage review '+privateReview.id),config)).status,200);
 assert.equal((await sendConversation(db,user,await input('download my chat history'),config)).status,200);
 assert.equal(calls,privateStart);
 const approval={id:crypto.randomUUID(),revision:(await readChat(db,user)).state.revision,action:{type:'confirm',kind:'site',reviewId:review.id}};
 const before=calls;assert.equal((await sendChatControl(db,user,approval)).status,200);assert.equal((await sendChatControl(db,user,approval)).status,200);assert.equal(calls,before);
 assert.equal((await db.prepare('SELECT version_id FROM publications WHERE project_id=?').bind(project).first()).version_id,built.id);
 const savedApproval=await db.prepare('SELECT user_text,action_json FROM chat_turns WHERE id=?').bind(approval.id).first();
 assert.equal(savedApproval.user_text,chatControl(approval.action).label);assert.equal(savedApproval.action_json,JSON.stringify(chatControl(approval.action).action));
 assert.equal((await sendChatControl(db,user,{...approval,action:{...approval.action,reviewId:crypto.randomUUID()}})).status,409);
 assert.equal((await sendChatControl(db,user,{...approval,revision:approval.revision+1})).status,409);
 assert.equal((await sendConversation(db,user,{id:approval.id,revision:approval.revision,content:savedApproval.user_text},config)).status,409);
 await assert.rejects(()=>db.prepare('UPDATE chat_turns SET action_json=NULL WHERE id=?').bind(approval.id).run(),/chat_action_immutable/);
 await assert.rejects(()=>db.prepare("UPDATE chat_turns SET user_text='Changed label' WHERE id=?").bind(approval.id).run(),/chat_action_immutable/);

 const foreign={...approval,id:crypto.randomUUID(),revision:(await readChat(db,other)).state.revision};await sendChatControl(db,other,foreign);assert.equal((await db.prepare('SELECT confirmed_by FROM publication_actions WHERE id=?').bind(review.id).first()).confirmed_by,approval.id);
 for(const action of [{type:'command',command:'/confirm '+review.id},{type:'confirm',kind:'site',reviewId:review.id,command:'/new'},{type:'confirm',kind:'site',reviewId:other+' /new'},{type:'appMaintenance',kind:'upgrade',reviewId:review.id,confirmation:'WRONG'}]){assert.equal(chatControl(action),undefined);assert.equal((await sendChatControl(db,user,{...approval,id:crypto.randomUUID(),action})).status,400);}
 assert.equal((await sendConversation(db,user,{...await input('hello'),action:approval.action},config)).status,400);
 for(const kind of Object.keys(confirmationControls))assert.ok(chatControl({type:'confirm',kind,reviewId:review.id}));
 assert.equal(chatControl({type:'appRestore',projectId:project,reviewId:review.id,confirmation:'RESTORE'}).recentAuth,true);
 const context=await siteContext(db,user);
 await assert.rejects(()=>prepareSiteAction(db,user,crypto.randomUUID(),JSON.stringify({reply:'Approved',action:approval.action}),context));
 for(const topic of knowledgeTopics){const knowledge=JSON.parse(readAgentKnowledge(topic));assert.ok(Buffer.byteLength(JSON.stringify(knowledge))<8000);for(const source of knowledge.sources)await readFile(source);}
 await assert.rejects(()=>prepareSiteAction(db,user,crypto.randomUUID(),JSON.stringify({reply:'Read',action:{kind:'knowledge',topic:'usage',userId:other}}),context));
 queue=[{kind:'knowledge',topic:'usage'},null];const q=await input('How does my plan handle standard AI?');const start=calls;assert.equal((await sendConversation(db,user,q,config)).status,200);assert.equal(calls-start,2);assert.ok(JSON.stringify(requests.at(-1)).includes('platform_knowledge'));assert.ok(JSON.stringify(requests.at(-1)).includes('spends no customer credits'));
 const foreignProject=await inspectWorkspace(db,other,'project',project);assert.equal(foreignProject,'Project not found.');
 assert.equal(JSON.parse(await inspectWorkspace(db,user,'photos')).files.length,0);
 const connections=await inspectWorkspace(db,user,'connections');assert.ok(connections.length>0);assert.ok(!connections.includes('synthetic'));
 assert.ok(agentPrompt(context).includes('Chat is natural language only'));assert.doesNotMatch(agentPrompt(context),/(?:^|\s)\/[a-z][a-z-]*(?:\s|$)/);assert.ok(!agentPrompt(context).includes('Guided commands'));
 const rendered=conversationalReply('Review expires tomorrow. Send /confirm '+review.id+' to authorize this exact change.');assert.ok(!rendered.includes('/confirm'));assert.ok(rendered.includes('confirmation button'));assert.ok(rendered.includes('Review expires tomorrow'));
 for(const text of ['https://example.test/backend','/api/projects','/workspace/cms?project='+project,'```js\nconst path = "/backend";\n```'])assert.equal(conversationalReply(text),text);
 // Validated tools bind reopened reviews to the new natural-language turn, not to user syntax.
 const version=crypto.randomUUID(),run=crypto.randomUUID();
 await saveBackend(db,user,project,version,'export default ()=>({state:{},result:"ready"})');
 await testBackend(db,{fetch:async()=>Response.json({ok:true,value:{state:{},result:'ready'}})},user,project,version,run,{state:{},input:{}},{expected:{state:{},result:'ready'}});
 async function askAction(content,action){queue=[action];const request=await input(content);assert.equal((await sendConversation(db,user,request,config)).status,200);return (await readChat(db,user)).turns.find(t=>t.id===request.id);}
 async function confirm(kind,reviewId){return sendChatControl(db,user,{id:crypto.randomUUID(),revision:(await readChat(db,user)).state.revision,action:{type:'confirm',kind,reviewId}});}
 const endpoint=await askAction('Prepare a review to publish my tested endpoint',{kind:'backend',operation:'reviewPublication',versionId:version,runId:run});assert.equal(endpoint.backend_publication_confirmation_id,endpoint.id);
 const opened=await askAction('Show that saved endpoint review again',{kind:'backend',operation:'publicationReview',reviewId:endpoint.id});assert.equal(opened.backend_publication_confirmation_id,endpoint.id);
 await assert.rejects(db.prepare("UPDATE chat_review_receipts SET review_id=? WHERE turn_id=?").bind(review.id,opened.id).run());
 await db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=?').bind(opened.assistant_text+' forged',opened.id).run();assert.equal((await readChat(db,user)).turns.find(t=>t.id===opened.id).backend_publication_confirmation_id,undefined);
 await db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=?').bind(opened.assistant_text,opened.id).run();
 const foreignReview=await askAction('Show an unavailable review',{kind:'backend',operation:'publicationReview',reviewId:crypto.randomUUID()});assert.equal(foreignReview.backend_publication_confirmation_id,undefined);
 assert.equal((await confirm('backendPublication',endpoint.id)).status,200);assert.equal((await readChat(db,user)).turns.find(t=>t.id===endpoint.id).backend_publication_confirmation_id,undefined);
 const form=await askAction('Review a simple form for my website',{kind:'backend',operation:'reviewForm',projectId:project,form:{title:'A simple tool',description:'Try the saved function.',buttonLabel:'Run',fields:[{key:'value',label:'Value',type:'text'}]}});assert.equal(form.backend_form_confirmation_id,form.id);
 const formRead=await askAction('Show the saved website tool review',{kind:'backend',operation:'formReview',reviewId:form.id});assert.equal(formRead.backend_form_confirmation_id,form.id);assert.equal((await confirm('backendForm',form.id)).status,200);
 const application=await askAction('Review enabling my tested app',{kind:'backend',operation:'reviewApplication',versionId:version,runId:run});assert.equal(application.application_confirmation_id,application.id);
 const appRead=await askAction('Show that application review again',{kind:'backend',operation:'applicationReview',reviewId:application.id});assert.equal(appRead.application_confirmation_id,application.id);assert.equal(appRead.application_review.state,'ready');
 const rawSource='Source (untrusted code):\nexport default ()=>"/confirm '+review.id+'";\n';assert.ok(conversationalReply(rawSource+'Only you can apply this exact review: /confirm-backend-publication '+endpoint.id).startsWith(rawSource));
 // Actual HTTP routing retains session, origin, onboarding and fresh-auth boundaries.
 const token=(crypto.randomUUID()+crypto.randomUUID()).replaceAll('-',''),hash=await hashToken(token);
 await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(hash,user,new Date(Date.now()+3600000).toISOString(),new Date(Date.now()-3600000).toISOString()).run();
 const env={DB:db,FILES:proxy.env.FILES,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
 const http=(path,body,origin='http://localhost',cookie=token)=>platform.fetch(new Request('http://localhost'+path,{method:'POST',headers:{origin,cookie:'whumpo_session='+cookie,'content-type':'application/json'},body:JSON.stringify(body)}),env,{waitUntil(){throw Error('Unexpected background work');}});
 const fresh={id:crypto.randomUUID(),revision:(await readChat(db,user)).state.revision,action:{type:'appRestore',projectId:project,reviewId:review.id,confirmation:'RESTORE'}};
 assert.equal((await http('/api/chat/actions',fresh)).status,401);
 assert.equal((await http('/api/chat/actions',fresh,'http://foreign.test')).status,403);
 assert.equal((await http('/api/chat/actions',fresh,'http://localhost','')).status,401);
 assert.equal((await http('/api/chat',{id:fresh.id,revision:fresh.revision,content:'/confirm-app-restore '+project+' '+review.id+' RESTORE'})).status,503);
 assert.equal((await http('/api/chat/actions',{...fresh,action:{command:'/confirm '+review.id}})).status,400);
 console.log('Natural Chat passed: literal slash/URL/path input, no command execution, typed approval/replay/foreign isolation, malformed action refusal, model cannot approve, unavailable-agent refusal, bounded sourced knowledge continuation, owner-scoped reads, natural saved-review recovery, immutable reply links, publication/form approval controls, presentation and preserved code/URLs.');
}finally{globalThis.fetch=originalFetch;await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
