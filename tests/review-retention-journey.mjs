// WH-184 connected local acceptance: one long-lived directory journey through the real Chat, directory and turnover paths on
// local D1. Past the former 100-row ceiling the owner keeps editing, publishing, restoring and exporting with no refusal,
// compacted snapshots answer digest-only, a replayed confirmation still gets its original answer, storage stays bounded,
// another owner is never blocked, and withdrawal works at active capacity. Offline, synthetic data, no credentials.
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,scopes=new Map(),scope=u=>scopes.get(u);
const {sendChat,sendChatControl,readChat,host}=m,{directoryHistory,directorySnapshot,exportDirectory}=m.directory;
async function chat(user,content){const s=await readChat(scope(user),user),id=crypto.randomUUID(),r=await sendChat(scope(user),user,{id,content,revision:s.state.revision});assert.equal(r.status,200,content+' '+JSON.stringify(r));return id;}
const approvals=new Map();
async function confirm(user,reviewId){const input={id:crypto.randomUUID(),revision:(await readChat(scope(user),user)).state.revision,action:{type:'confirm',kind:'directory',reviewId}};const r=await sendChatControl(scope(user),user,input);assert.equal(r.status,200,JSON.stringify(r));approvals.set(reviewId,input);}
async function fixture(){const user=crypto.randomUUID();scopes.set(user,await (await workspaceFixture(db,m,user)).scope());const {project,version}=await createFixtureProject(scope(user),user,'Community','A community directory');await chat(user,'/confirm '+await chat(user,'/publish '+version));return {user,project};}
const rows=p=>db.prepare('SELECT COUNT(*) AS n FROM directory_reviews WHERE project_id=?').bind(p).first().then(r=>r.n);
// Admission only compacts rows past their one-hour grace; age applied rows instead of waiting for the clock.
const guards=['directory_review_identity','directory_review_apply','directory_review_confirm'];
async function age(p){ // test-only: applied rows are immutable and re-apply on update, so lift those guards for the one UPDATE and restore them
 const sql=[];for(const n of guards)sql.push((await db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").bind(n).first()).sql);
 for(const n of guards)await db.prepare('DROP TRIGGER '+n).run();
 await db.prepare("UPDATE directory_reviews SET expires_at='2000-01-01T00:00:00.000Z' WHERE project_id=? AND status='applied'").bind(p).run();
 for(const q of sql)await db.prepare(q).run();
}
const pub=f=>host.fetch(new Request('https://'+f.project+'.whumpo.site/directory.json'),store.env);
try{
 const a=await fixture(),b=await fixture();
 const first=await chat(a.user,`/directory-add ${a.project} | Garden Club | v0 | https://example.com/0`);await confirm(a.user,first);
 const ids=[first];let peak=0;
 for(let i=1;i<=130;i++){await age(a.project);const id=await chat(a.user,`/directory-edit ${a.project} ${first} | Garden Club | v${i}`);await confirm(a.user,id);ids.push(id);peak=Math.max(peak,await rows(a.project));
  if(i%40===0){await confirm(a.user,await chat(a.user,'/directory-publish '+a.project));await confirm(b.user,await chat(b.user,`/directory-add ${b.project} | Other | n${i} | https://example.com/b`));}}
 assert.ok(ids.length>100,'journey passes the former 100-row ceiling');
 assert.ok(peak<60&&await rows(a.project)<60,'storage stays bounded: '+peak);
 // Compacted snapshot: digest-only, never restorable or exportable, but its replay answer survives.
 const h=await directoryHistory(scope(a.user),a.user,a.project),old=h.snapshots.find(s=>s.digestOnly); // history lists the newest 100, so the earliest compacted ones are beyond it
 assert.ok(old,'compacted snapshots stay listed digest-only');assert.ok(!ids.slice(-20).includes(old.id)&&h.snapshots.filter(s=>s.digestOnly).length>=50);
 await assert.rejects(exportDirectory(scope(a.user),a.user,a.project,old.id),{status:404,message:/digest-only/});
 await assert.rejects(directorySnapshot(scope(a.user),a.user,a.project,old.id),{status:404,message:/digest-only/});
 await assert.rejects(exportDirectory(scope(a.user),a.user,a.project,ids[1]),{status:404});
 const rev=(await readChat(scope(a.user),a.user)).state.revision;
 // Replaying the original confirmation of a compacted review returns its answer and never applies twice.
 assert.equal((await sendChatControl(scope(a.user),a.user,approvals.get(ids[1]))).status,200);assert.equal((await readChat(scope(a.user),a.user)).state.revision,rev);
 // A retained snapshot still restores and exports exactly; the published page is unchanged by a private restore.
 const newest=ids.at(-1),kept=h.snapshots.find(s=>s.digestOnly===false&&s.id!==newest)??h.snapshots.find(s=>!s.digestOnly);
 const exp=await exportDirectory(scope(a.user),a.user,a.project,kept.id);assert.equal(exp.snapshot.listingsSha256,kept.digest);
 const live=await (await pub(a)).json();await confirm(a.user,await chat(a.user,`/directory-restore ${a.project} ${kept.id}`));assert.deepEqual((await (await pub(a)).json()).listings,live.listings);
 // B1: owner b was never refused while a churned, and still can edit.
 await confirm(b.user,await chat(b.user,`/directory-add ${b.project} | Last | after | https://example.com/z`));
 // Withdrawal at active capacity: new mutations refuse, taking the directory offline still works.
 const ins=()=>db.prepare("INSERT INTO directory_reviews(id,user_id,project_id,kind,snapshot_json,digest,expected_revision,publication_revision,expires_at) VALUES(?,?,?,'edit','[]','unused',0,0,?)").bind(crypto.randomUUID(),a.user,a.project,new Date(Date.now()+600000).toISOString()).run();
 for(;;){try{await ins();}catch(e){assert.match(String(e.message),/directory_capacity/);break;}}
 const s=(await readChat(scope(a.user),a.user)).state.revision;assert.equal((await sendChat(scope(a.user),a.user,{id:crypto.randomUUID(),revision:s,content:`/directory-restore ${a.project} ${kept.id}`})).status,409);
 await confirm(a.user,await chat(a.user,'/directory-off '+a.project));assert.equal((await pub(a)).status,404);
 assert.equal((await exportDirectory(scope(a.user),a.user,a.project,kept.id)).snapshot.listingsSha256,kept.digest);
 console.log('Review retention journey passed: 130+ edits past the former ceiling, bounded storage, digest-only compaction, replay after compaction, restore/export of retained snapshots, other owner unaffected, withdrawal at capacity.');
}finally{await store.close();}
