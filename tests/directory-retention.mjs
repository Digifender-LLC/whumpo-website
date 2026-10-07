import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
Error.stackTraceLimit=0;
// Current-only, synthetic directory reviews on SQLite or --d1. No network, inference or provider.
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),db=fixture.db,id=()=>crypto.randomUUID();
const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No external calls in directory retention');};
const approvals=new Map(),ago=new Date(Date.now()-91*86400000).toISOString(),soon=new Date(Date.now()+600000).toISOString();let phase='setup';
try{
 const actor=await workspaceFixture(db,m),user=actor.account,scope=await actor.scope(),{project,version}=await createFixtureProject(scope,user,'Retention directory','Synthetic review turnover');
 const revision=async()=>(await m.chatState(scope,user)).revision;
 const chat=async content=>{const turn=id(),input={id:turn,content,revision:await revision()};const r=await m.sendChat(scope,user,input);assert.equal(r.status,200,JSON.stringify(r));return {id:turn,input};};
 const confirm=async(reviewId,kind='directory')=>{const input={id:id(),revision:await revision(),action:{type:'confirm',kind,reviewId}},r=await m.sendChatControl(scope,user,input);assert.equal(r.status,200,JSON.stringify(r));approvals.set(reviewId,input);return input;};
 const current=()=>m.directory.readDirectory(scope,user,project),history=()=>rows('SELECT id FROM directory_reviews WHERE project_id=? ORDER BY id',project);
 const publish=await chat('/publish '+version);await confirm(publish.id,'site');
 const first=await chat(`/directory-add ${project} | Original draft | Original`);await confirm(first.id);
 const exported=await chat(`/directory-edit ${project} ${first.id} | Published listing | Published`);await confirm(exported.id);
 const live=await chat('/directory-publish '+project);await confirm(live.id);
 const obsolete1=await chat(`/directory-edit ${project} ${first.id} | Obsolete one | Not current`);await confirm(obsolete1.id);
 const obsolete2=await chat(`/directory-edit ${project} ${first.id} | Obsolete two | Not current`);await confirm(obsolete2.id);
 const restored=await chat(`/directory-restore ${project} ${first.id}`);await confirm(restored.id);
 await chat(`/directory-export ${project} ${exported.id}`);
 const before=await current();assert.equal(before.draft[0].title,'Original draft');assert.equal(JSON.parse(before.live_json)[0].title,'Published listing');
 // Age only synthetic fixture timestamps; no production clock/retention control is exposed.
 await run('UPDATE chat_turns SET created_at=? WHERE user_id=?',ago,user);
 const syntheticTurn=async(status='completed',action=null)=>{const turn=id(),r=await revision()+1;await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status,action_json) VALUES(?,?,?,'Synthetic retained authority','Synthetic',?,'guided',?,?)",turn,user,r,ago,status,action?JSON.stringify(action):null);await run('UPDATE workspace_state SET revision=? WHERE user_id=?',r,user);return turn;};
 const pending=async(status='completed',expires=ago)=>{const turn=await syntheticTurn(status);await run("INSERT INTO directory_reviews(id,user_id,project_id,kind,snapshot_json,digest,expected_revision,publication_revision,expires_at) VALUES(?,?,?,'edit','[]',?,?,?,?)",turn,user,project,await m.hashToken('[]'),(await current()).revision,before.current_publication,expires);return turn;};
 phase='completed expiry and unknown authority';const expired=await pending(),unknown=await pending('pending'),fresh=await pending('completed',soon);
 assert.ok(await row('SELECT id FROM prunable_directory_reviews WHERE id=?',expired));assert.equal(await row('SELECT id FROM prunable_directory_reviews WHERE id=?',unknown),null);
 for(const protectedId of [first.id,exported.id,live.id,restored.id,unknown,fresh])await assert.rejects(run('DELETE FROM directory_reviews WHERE id=?',protectedId),/directory_review_retained/);
 phase='safety hold and bounded cleanup';const caseId=id(),holdId=id();
 await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES(?,?,'synthetic-directory-retention','human:reviewer',unixepoch(),unixepoch()+31536000)",caseId,user);
 await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,'project',?,'synthetic-basis','human:approver',unixepoch(),unixepoch()+86400)",holdId,caseId,user,project);
 const held=await history();await m.directory.cleanupDirectoryReviews(db);assert.deepEqual(await history(),held);await assert.rejects(run('DELETE FROM directory_reviews WHERE id=?',obsolete1.id),/safety_preservation_hold/);
 await run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='synthetic-release' WHERE id=?",holdId);
 await m.directory.cleanupDirectoryReviews(db);
 for(const deleted of [expired,obsolete1.id,obsolete2.id])assert.equal(await row('SELECT id FROM directory_reviews WHERE id=?',deleted),null);
 for(const kept of [first.id,exported.id,live.id,restored.id,unknown,fresh])assert.ok(await row('SELECT id FROM directory_reviews WHERE id=?',kept));
 assert.deepEqual(await current(),before);assert.equal((await m.directory.exportDirectory(scope,user,project,exported.id)).listings[0].title,'Published listing');
 await run("UPDATE chat_turns SET status='uncertain' WHERE id=?",unknown);await m.directory.cleanupDirectoryReviews(db);assert.ok(await row('SELECT id FROM directory_reviews WHERE id=?',unknown),'Unknown outcome also preserves authority');
 phase='old request recovery cannot resurrect a pruned review';assert.equal((await m.sendChat(scope,user,obsolete1.input)).status,200);assert.equal((await m.sendChatControl(scope,user,approvals.get(obsolete1.id))).status,200);
 assert.equal(await row('SELECT id FROM directory_reviews WHERE id=?',obsolete1.id),null);await confirm(obsolete1.id);assert.deepEqual(await current(),before);
 await run("UPDATE chat_turns SET status='completed' WHERE id=?",unknown);await m.directory.cleanupDirectoryReviews(db);assert.equal(await row('SELECT id FROM directory_reviews WHERE id=?',unknown),null,'Only terminal known authority becomes eligible');
 phase='on-demand turnover clears completed expired proposals without operator writes';
 for(let n=0;n<105;n++)await pending();const pendingCount=(await row('SELECT count(*) n FROM directory_reviews WHERE project_id=?',project)).n;assert.ok(pendingCount>100);
 const next=await chat(`/directory-edit ${project} ${first.id} | Next draft | Turnover works`);assert.ok(await row('SELECT id FROM directory_reviews WHERE id=?',next.id));
 assert.ok((await row('SELECT count(*) n FROM directory_reviews WHERE project_id=?',project)).n<pendingCount);await confirm(next.id);assert.equal((await current()).draft[0].title,'Next draft');
 phase='referenced historical growth is preserved and excluded from the operational cap';
 const source=await m.directory.directorySnapshot(scope,user,project,first.id);let latest=first.id;
 // A retained ancestry chain and authenticated export links may exceed 100 historical records. That growth is
 // explicit policy, not a hidden deletion to fit a lifetime cap. Every synthetic approval uses real commit guards.
 for(let n=0;n<102;n++){
  const turn=await syntheticTurn(),state=await current();
  await run("INSERT INTO directory_reviews(id,user_id,project_id,kind,snapshot_json,digest,expected_revision,publication_revision,expires_at,source_review_id) VALUES(?,?,?,'edit',?,?,?,?,?,?)",turn,user,project,source.snapshot_json,source.digest,state.revision,state.current_publication,soon,latest);
  const approval=await syntheticTurn('completed',{type:'confirm',kind:'directory',reviewId:turn});await run("UPDATE directory_reviews SET status='applied',confirmed_by=? WHERE id=?",approval,turn);
  const exportTurn=await syntheticTurn();await run('INSERT INTO directory_exports(turn_id,review_id) VALUES(?,?)',exportTurn,turn);latest=turn;
 }
 await m.directory.cleanupDirectoryReviews(db);assert.ok((await row('SELECT count(*) n FROM directory_reviews WHERE project_id=?',project)).n>100);
 assert.ok(await row('SELECT id FROM directory_reviews WHERE id=?',first.id));const retainedExportCount=(await row('SELECT count(*) n FROM directory_exports e JOIN directory_reviews r ON r.id=e.review_id WHERE r.project_id=?',project)).n;assert.ok(retainedExportCount>=103);
 const afterHistory=await chat(`/directory-edit ${project} ${first.id} | Editable after history | Still private`);await confirm(afterHistory.id);assert.equal((await current()).draft[0].title,'Editable after history');
 await m.directory.cleanupDirectoryReviews(db);assert.equal((await row('SELECT count(*) n FROM directory_exports e JOIN directory_reviews r ON r.id=e.review_id WHERE r.project_id=?',project)).n,retainedExportCount);
 assert.equal(JSON.parse((await current()).live_json)[0].title,'Published listing');
 phase='actionable/recent cap and offline escape';
 const actionable=(await row("SELECT count(*) n FROM directory_reviews r WHERE r.project_id=? AND r.kind!='unpublish' AND NOT EXISTS(SELECT 1 FROM directory_reviews_outside_window w WHERE w.id=r.id)",project)).n;
 for(let n=actionable;n<100;n++)await pending('completed',soon);
 const rejected=await m.sendChat(scope,user,{id:id(),revision:await revision(),content:`/directory-edit ${project} ${first.id} | Limited | Recent cap`});assert.equal(rejected.status,409);
 const off=await chat('/directory-off '+project);await confirm(off.id);assert.equal((await current()).published,false);
 phase='project deletion still cascades after hold release';await run('DELETE FROM projects WHERE id=?',project);assert.equal((await row('SELECT count(*) n FROM directory_reviews WHERE project_id=?',project)).n,0);assert.equal((await row('SELECT count(*) n FROM directory_exports')).n,0);
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 console.log('Directory retention passed on '+(process.argv.includes('--d1')?'local D1':'SQLite')+': expired completed proposals and 90-day superseded receipts, current draft/live/latest provenance, ancestry/export and unknown authority preservation, holds/direct-delete guards, same-request recovery after prune without resurrection, on-demand turnover, explicit growth beyond 100 pinned historical records, rolling operational cap/offline escape and project cascade. No network/provider calls.');
}catch(e){console.error('Directory retention phase: '+phase);console.error(String(e.stack??e).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await fixture.close();}
