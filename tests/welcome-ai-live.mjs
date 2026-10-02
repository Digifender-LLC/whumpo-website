// Explicit opt-in: real Muse, synthetic content, disposable D1, no public changes.
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
if(process.env.RUN_LIVE_MUSE!=='1')throw Error('Set RUN_LIVE_MUSE=1 for the live welcome handoff check');
const bundled=await build({stdin:{contents:"export * from './src/onboarding';export * from './src/profile';export * from './src/ai-chat';export * from './src/chat';export * from './src/billing';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {readOnboarding,saveOnboarding,completeOnboarding,updateProfile,sendAIChat:sendInternalAIChat,readChat,getBilling}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
// Exercise the internal constrained-build adapter; public Chat uses natural messages.
const sendAIChat=(db,user,id,revision,content,config,transport,options)=>sendInternalAIChat(db,user,id,revision,content,config,transport,options,true);
const dir=await mkdtemp('/tmp/whumpo-welcome-ai-');
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
try{
 const user=crypto.randomUUID(),now=new Date().toISOString();
 await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();
 await updateProfile(db,user,{revision:0,name:'River',about_me:'Synthetic personal bio marker: lavender telescope',share_context:false,avatar_id:'moon'});
 let welcome=await readOnboarding(db,user);const project=welcome.state.project_id;
 welcome=await saveOnboarding(db,user,{revision:welcome.state.revision,stage:'review',prompt:'review',project_name:'Copper Oven',idea:'A neighborhood bakery website presenting sourdough bread and pastries. It should feel welcoming and make it easy for neighbors to learn what we bake. Use a clear introduction, a short description of our bread, and a separate section with useful visitor information. The opening hours are Tuesday through Sunday, 7am to 2pm. No online ordering yet.',audience:'Neighbors looking for fresh bread and a friendly local bakery',preferred_theme:'clay'});
 await completeOnboarding(db,user,{revision:welcome.state.revision});
 const {state,firstDraft}=await readChat(db,user,true),turn=crypto.randomUUID();
 assert.equal(firstDraft?.id,project,'Chat must offer the saved welcome project');
 const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:(await readFile('opencode.key','utf8')).trim(),protocol:'responses'};
 let calls=0;const transport=(url,init)=>{calls++;assert.ok(!init.body.includes('lavender telescope'),'Unshared bio must not reach provider');assert.ok(init.body.includes('Tuesday through Sunday, 7am to 2pm'),'Complete saved brief must reach provider');return fetch(url,init)};
 const content='/first-draft '+project;
 const outcome=await sendAIChat(db,user,turn,state.revision,content,config,transport);
 const receipt=await db.prepare('SELECT status,assistant_text FROM chat_turns WHERE id=?').bind(turn).first();
 const versions=(await db.prepare('SELECT project_id,component_id,config_json FROM site_versions').all()).results;
 const billing=await getBilling(db,user);
 console.log(JSON.stringify({outcome,status:receipt?.status,reply:receipt?.assistant_text,calls,versions:versions.length,spent:billing.standardAI.creditCharge,reserved:billing.standardAI.creditCharge}));
 assert.equal(receipt?.status,'completed');assert.equal(versions.length,1,'First request should produce one private draft');assert.equal(versions[0].project_id,project,'Reuse the welcome project');
 assert.equal(calls,1,'The complete brief should build without another inspection call');assert.equal((await readChat(db,user,true)).firstDraft,null);
 const page=JSON.parse(versions[0].config_json);assert.equal(page.name,'Copper Oven');assert.equal(page.theme,'clay');assert.match(JSON.stringify(page),/bread|sourdough/i);assert.match(JSON.stringify(page),/Tuesday/i);assert.match(JSON.stringify(page),/Sunday/i);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects WHERE owner_user_id=?').bind(user).first()).n,1);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM publications').first()).n,0);assert.equal(billing.standardAI.creditCharge,0);assert.equal(billing.standardAI.creditCharge,0);
 const previousCalls=calls;await sendAIChat(db,user,turn,state.revision,content,config,transport);assert.equal(calls,previousCalls);assert.equal((await getBilling(db,user)).standardAI.creditCharge,billing.standardAI.creditCharge);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM site_versions').first()).n,1);
 console.log('Live welcome handoff passed: saved brief/theme, existing project, private draft, opt-in context, settled usage and replay.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
