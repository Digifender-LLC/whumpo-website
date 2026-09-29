import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {readProjectDetails,saveProjectDetails}=await module('src/project-details.ts');
const {prepareSiteAction}=await module('src/site-agent.ts');
const dir=await mkdtemp('/tmp/townhello-dashboard-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe'});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
try{
 const user=crypto.randomUUID(),other=crypto.randomUUID(),project=crypto.randomUUID(),now=new Date().toISOString();
 for(const id of [user,other])await db.prepare("INSERT INTO users VALUES(?,?,'00','test',?)").bind(id,id+'@example.test',now).run();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'First','Original purpose','draft',?,?)").bind(project,user,now,now).run();
 assert.equal((await readProjectDetails(db,user,project)).revision,0);
 const edit={revision:0,name:'New name',purpose:'New purpose'};const saved=await saveProjectDetails(db,user,project,edit);assert.equal(saved.revision,1);assert.equal((await readProjectDetails(db,user,project)).revision,1);
 await assert.rejects(saveProjectDetails(db,user,project,edit),e=>e.status===409);
 await assert.rejects(readProjectDetails(db,other,project),e=>e.status===404);await assert.rejects(saveProjectDetails(db,other,project,{...edit,revision:1}),e=>e.status===404);
 for(const data of [null,{...edit,revision:-1},{...edit,name:''},{...edit,name:'bad\nname'},{...edit,purpose:'x'.repeat(1001)},{...edit,owner_user_id:other}])await assert.rejects(saveProjectDetails(db,user,project,data),e=>e.status===400);
 const same=await saveProjectDetails(db,user,project,{...edit,revision:1});assert.equal(same.revision,1);
 const race=await Promise.allSettled(['One','Two'].map(name=>saveProjectDetails(db,user,project,{...edit,revision:1,name})));assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal((await readProjectDetails(db,user,project)).revision,2);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM activity_events WHERE action='project.details.updated'").first()).n,2);
 const result=await prepareSiteAction(db,user,crypto.randomUUID(),JSON.stringify({reply:'Made everything live',action:{kind:'projectDetails',projectId:project,revision:2,name:'Agent name',purpose:'New purpose'}}),{});assert.match(result.reply,/Project details saved/);assert.ok(!result.reply.includes('Made everything live'));assert.match(result.reply,/contact forms and directories/);
 assert.equal((await readProjectDetails(db,user,project)).revision,3);
 const {inspectWorkspace}=await module('src/workspace-read.ts');assert.match(await inspectWorkspace(db,user,'project',project),/Details revision: 3/);
 const {default:worker}=await module('src/index.ts'),{hashToken}=await module('src/security.ts');const session='f'.repeat(64);await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(session),user,new Date(Date.now()+3600000).toISOString(),now).run();
 const request=(method,body,token=session,origin='https://whumpo.com')=>worker.fetch(new Request('https://whumpo.com/api/projects/'+project+'/details',{method,headers:{origin,'content-type':'application/json',cookie:'tellumo_session='+token},body:body===undefined?undefined:JSON.stringify(body)}),{DB:db,API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},{waitUntil(){}});
 assert.equal((await request('GET')).status,200);assert.equal((await request('GET',undefined,'')).status,401);assert.equal((await request('PATCH',{...edit,revision:3},session,'https://foreign.example')).status,403);
 const response=await request('PATCH',{...edit,revision:3});assert.equal(response.status,200);assert.equal((await response.json()).revision,4);assert.equal((await request('PATCH',{...edit,revision:3})).status,409);
 // Partial brief edits preserve identity and existing fields; direct onboarding writers invalidate stale editors.
 const brief=await saveProjectDetails(db,user,project,{revision:4,audience:'Neighborhood families',style_notes:'Warm and welcoming',preferred_theme:'clay'});
 assert.equal(brief.revision,5);assert.equal(brief.name,edit.name);assert.equal(brief.purpose,edit.purpose);
 assert.equal((await readProjectDetails(db,user,project)).audience,'Neighborhood families');
 assert.equal((await saveProjectDetails(db,user,project,{revision:5,audience:brief.audience})).revision,5);
 for(const patch of [{audience:null},{style_notes:'x'.repeat(1001)},{preferred_theme:'neon'},{}])await assert.rejects(saveProjectDetails(db,user,project,{revision:5,...patch}),e=>e.status===400);
 await db.prepare("UPDATE projects SET audience='Changed during onboarding' WHERE id=?").bind(project).run();
 assert.equal((await readProjectDetails(db,user,project)).revision,6);
 await assert.rejects(saveProjectDetails(db,user,project,{revision:5,style_notes:'Stale edit'}),e=>e.status===409);
 const agentPatch=(revision,projectId=project)=>prepareSiteAction(db,user,crypto.randomUUID(),JSON.stringify({reply:'Published!',action:{kind:'projectDetails',projectId,revision,style_notes:'Accessible and calm'}}),{});
 assert.match((await agentPatch(5)).reply,/not saved.*changed/);
 assert.match((await agentPatch(6,crypto.randomUUID())).reply,/not saved.*not found/);
 assert.match((await agentPatch(6)).reply,/Project details saved/);
 const final=await readProjectDetails(db,user,project);assert.equal(final.revision,7);assert.equal(final.audience,'Changed during onboarding');assert.equal(final.style_notes,'Accessible and calm');assert.equal(final.preferred_theme,'clay');
 assert.match(await inspectWorkspace(db,user,'project',project),/Accessible and calm/);
 const context=await (await module('src/site-agent.ts')).siteContext(db,user);assert.equal(context.projects[0].style_notes,'Accessible and calm');assert.equal(context.projects[0].preferred_theme,'clay');
 console.log('Project details passed: validation, owner/HTTP/CSRF gates, atomic revision conflicts, no-op audit behavior, concurrency, model receipt and inspect revision.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
