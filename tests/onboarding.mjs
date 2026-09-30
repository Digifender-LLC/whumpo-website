import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {sendChat,readChat}=await module('src/chat.ts');const {siteContext}=await module('src/site-agent.ts');const {getBilling}=await module('src/billing.ts');
const dir=await mkdtemp('/tmp/tellumo-onboarding-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
const ai={baseURL:'https://provider.invalid/v1',apiKey:'unused',model:'unused',protocol:'responses'};
async function account(){const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,id+'@example.com','00',new Date().toISOString()).run();return id;}
async function send(user,content,id=crypto.randomUUID()){const state=await readChat(db,user);const response=await sendChat(db,user,{content,id,revision:state.state.revision},ai);assert.equal(response.status,200,JSON.stringify(response));return id;}
try{
 const user=await account(),other=await account();
 await send(user,'A bakery selling sourdough');const project=await send(user,'Bread & Butter');
 assert.equal((await readChat(db,user)).state.brief_stage,'audience');
 await send(user,'Neighbors looking for fresh bread. Private audience note.');
 assert.equal((await readChat(db,user)).state.brief_stage,'style');
 await send(user,'/usage');assert.equal((await readChat(db,user)).state.brief_stage,'style');
 const state=(await readChat(db,user)).state, id=crypto.randomUUID();
 const same=await Promise.all([sendChat(db,user,{content:'forest',id,revision:state.revision},ai),sendChat(db,user,{content:'forest',id,revision:state.revision},ai)]);assert.ok(same.every(r=>r.status===200));
 const row=await db.prepare('SELECT * FROM site_versions WHERE id=?').bind(id).first();assert.equal(JSON.parse(row.config_json).theme,'forest');assert.ok(!row.html.includes('Private audience note'));assert.equal((await readChat(db,user)).state.brief_stage,null);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM site_versions WHERE project_id=?').bind(project).first()).n,1);
 assert.equal((await db.prepare('SELECT status FROM projects WHERE id=?').bind(project).first()).status,'draft');
 const context=await siteContext(db,user);assert.equal(context.projects[0].audience,'Neighbors looking for fresh bread. Private audience note.');assert.equal(context.projects[0].style_notes,'forest');assert.equal((await siteContext(db,other)).projects.length,0);
 assert.equal((await getBilling(db,user)).quota.spent,0);
 const rebuild=await send(user,'/build');assert.equal(JSON.parse((await db.prepare('SELECT config_json FROM site_versions WHERE id=?').bind(rebuild).first()).config_json).theme,'forest');
 await send(user,'/new');await send(user,'Another idea');await send(user,'Another project');await send(user,'/skip');const skipped=await send(user,'/skip');assert.equal(JSON.parse((await db.prepare('SELECT config_json FROM site_versions WHERE id=?').bind(skipped).first()).config_json).theme,'ocean');
 await send(user,'/new');await send(user,'Third idea');const third=await send(user,'Third project');await send(user,'Audience three');const free=await send(user,'Minimal with purple accents');assert.equal(JSON.parse((await db.prepare('SELECT config_json FROM site_versions WHERE id=?').bind(free).first()).config_json).theme,'ocean');assert.equal((await db.prepare('SELECT style_notes FROM projects WHERE id=?').bind(third).first()).style_notes,'Minimal with purple accents');
 await send(user,'/new');await send(user,'Fourth idea');const fourth=await send(user,'Fourth project');await send(user,'/cancel');assert.equal((await readChat(db,user)).state.brief_stage,null);assert.ok(await db.prepare('SELECT id FROM projects WHERE id=?').bind(fourth).first());
 // A corrupted/stale foreign pointer never edits another account's project.
 await readChat(db,other);await db.prepare("UPDATE workspace_state SET step='ready',brief_stage='style',brief_project_id=? WHERE user_id=?").bind(project,other).run();await send(other,'clay');assert.equal((await db.prepare('SELECT preferred_theme FROM projects WHERE id=?').bind(project).first()).preferred_theme,'forest');
 await send(user,'/brief '+project);assert.ok((await readChat(db,user)).turns.at(-1).assistant_text.includes('Private audience note'));
 await send(other,'/brief '+project);assert.equal((await readChat(db,other)).turns.at(-1).assistant_text,'No project found. Use /new to start one.');
 await db.prepare("UPDATE workspace_state SET brief_stage='style',brief_project_id=? WHERE user_id=?").bind(fourth,user).run();
 for(let n=0;n<25;n++)await db.prepare("INSERT INTO site_versions(id,project_id,component_id,config_json,html,digest,created_at) VALUES(?,?,'launch-page@1','{}','quota fixture','fixture',?)").bind(crypto.randomUUID(),fourth,new Date().toISOString()).run();
 const before=(await readChat(db,user)).state;
 const blocked=await sendChat(db,user,{content:'clay',id:crypto.randomUUID(),revision:before.revision},ai);assert.equal(blocked.status,409);
 assert.equal((await readChat(db,user)).state.brief_stage,'style');assert.equal((await readChat(db,user)).state.revision,before.revision);assert.equal((await db.prepare('SELECT preferred_theme FROM projects WHERE id=?').bind(fourth).first()).preferred_theme,'ocean');
 assert.equal((await getBilling(db,user)).quota.spent,0);
 console.log('Onboarding passed: persisted stages, command interruption, simultaneous replay, private preferences, owner isolation, first draft, saved theme, skip, free-form notes, cancellation and zero inference.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
