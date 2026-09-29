// Opt-in provider acceptance: synthetic content in disposable local D1; no public changes.
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
if(process.env.RUN_LIVE_MUSE!=='1')throw Error('Set RUN_LIVE_MUSE=1 to run the live provider acceptance check');
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {sendAIChat}=await module('src/ai-chat.ts'),{getBilling}=await module('src/billing.ts');
const dir=await mkdtemp('/tmp/whumpo-brief-live-');
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe'});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
try{
 const user=crypto.randomUUID(),project=crypto.randomUUID(),other=crypto.randomUUID(),turn=crypto.randomUUID(),now=new Date().toISOString();
 await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();
 await db.prepare("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(user).run();
 for(const [id,name] of [[project,'Neighborhood Events'],[other,'Weekend Recipes']])await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at,audience,style_notes,preferred_theme) VALUES(?,?,?,'Fictional acceptance project','draft',?,?,'Local families','Simple and warm','clay')").bind(id,user,name,now,now).run();
 const before=await getBilling(db,user);assert.equal(before.quota.spent,0);
 const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:(await readFile('opencode.key','utf8')).trim(),protocol:'responses'};
 let calls=0;const transport=(...args)=>{calls++;return fetch(...args);};
 const request='For Neighborhood Events, save this as my style preference: "Calm colors and generous spacing". Keep its name, description, audience and starting theme as they are. This is a planning preference only; do not create or publish any page.';
 const outcome=await sendAIChat(db,user,turn,0,request,config,transport);
 const row=await db.prepare('SELECT status,assistant_text,input_tokens,output_tokens FROM chat_turns WHERE id=?').bind(turn).first();
 const changed=await db.prepare('SELECT name,purpose,audience,style_notes,preferred_theme,details_revision FROM projects WHERE id=?').bind(project).first();
 const billing=await getBilling(db,user);
 console.log(JSON.stringify({outcome,status:row?.status,reply:row?.assistant_text,calls,initialAllowance:before.quota.available,spent:billing.quota.spent,reserved:billing.quota.reserved,details:changed}));
 assert.equal(row?.status,'completed');assert.equal(changed.style_notes,'Calm colors and generous spacing');assert.equal(changed.details_revision,1);
 assert.equal(changed.name,'Neighborhood Events');assert.equal(changed.purpose,'Fictional acceptance project');assert.equal(changed.audience,'Local families');assert.equal(changed.preferred_theme,'clay');
 assert.equal((await db.prepare('SELECT details_revision FROM projects WHERE id=?').bind(other).first()).details_revision,0);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM site_versions').first()).n,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM publications').first()).n,0);
 assert.equal(billing.quota.reserved,0);
 const initialCalls=calls;
 await sendAIChat(db,user,turn,0,request,config,transport);
 assert.equal(calls,initialCalls);
 assert.equal((await getBilling(db,user)).quota.spent,billing.quota.spent);
 assert.equal((await db.prepare('SELECT details_revision FROM projects WHERE id=?').bind(project).first()).details_revision,1);
 console.log('Live brief accepted: named project, exact partial update, preserved unrelated project/fields, no draft/publication, settled usage and replay.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
