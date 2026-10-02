// Explicit opt-in provider probe. Current schema, synthetic local owner, private work only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
if(process.env.RUN_LIVE_MUSE!=='1')throw Error('Set RUN_LIVE_MUSE=1 to run the live provider acceptance check');
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db;
const {sendAIChat,getBilling}=m;
try{
 const user=crypto.randomUUID(),project=crypto.randomUUID(),other=crypto.randomUUID(),turn=crypto.randomUUID(),now=new Date().toISOString();
 const authority=await workspaceFixture(db,m,user),owned=await authority.scope();
 await db.prepare("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(user).run();
 for(const [id,name] of [[project,'Neighborhood Events'],[other,'Weekend Recipes']])await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at,audience,style_notes,preferred_theme) VALUES(?,?,?,'Fictional acceptance project','draft',?,?,'Local families','Simple and warm','clay')").bind(id,user,name,now,now).run();
 const before=await getBilling(owned,user);assert.equal(before.standardAI.creditCharge,0);
 const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:(await readFile('opencode.key','utf8')).trim(),protocol:'responses'};
 let calls=0;const transport=(...args)=>{calls++;return fetch(...args);};
 const request='For Neighborhood Events, save this as my style preference: "Calm colors and generous spacing". Keep its name, description, audience and starting theme as they are. This is a planning preference only; do not create or publish any page.';
 const outcome=await sendAIChat(owned,user,turn,0,request,config,transport);
 const row=await db.prepare('SELECT status,assistant_text,input_tokens,output_tokens FROM chat_turns WHERE id=?').bind(turn).first();
 const changed=await db.prepare('SELECT name,purpose,audience,style_notes,preferred_theme,details_revision FROM projects WHERE id=?').bind(project).first();
 const billing=await getBilling(owned,user);
 console.log(JSON.stringify({outcome,status:row?.status,reply:row?.assistant_text,calls,spent:billing.standardAI.creditCharge,reserved:billing.standardAI.creditCharge,details:changed}));
 assert.equal(row?.status,'completed');assert.equal(changed.style_notes,'Calm colors and generous spacing');assert.equal(changed.details_revision,1);
 assert.equal(changed.name,'Neighborhood Events');assert.equal(changed.purpose,'Fictional acceptance project');assert.equal(changed.audience,'Local families');assert.equal(changed.preferred_theme,'clay');
 assert.equal((await db.prepare('SELECT details_revision FROM projects WHERE id=?').bind(other).first()).details_revision,0);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM site_versions').first()).n,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM publications').first()).n,0);
 assert.equal(billing.standardAI.creditCharge,0);
 const initialCalls=calls;
 await sendAIChat(owned,user,turn,0,request,config,transport);
 assert.equal(calls,initialCalls);
 assert.equal((await getBilling(owned,user)).standardAI.creditCharge,billing.standardAI.creditCharge);
 assert.equal((await db.prepare('SELECT details_revision FROM projects WHERE id=?').bind(project).first()).details_revision,1);
 console.log('Live brief accepted: named project, exact partial update, preserved unrelated project/fields, no draft/publication, settled usage and replay.');
}finally{await store.close();}
