// WH-004 slice 9: the domain-proof removal review is guarded in SQL independently of its JavaScript preflight.
// Local SQLite (default) or local D1 (`--d1`); synthetic users, projects, claims and Chat turns, no network.
// Closes the evidence gap recorded in docs/boundary-audit.md ("Still open after slice 3": the
// `domain_proof_removal_expired` trigger independently of the JavaScript preflight) for the `domains` family.
// The confirming statement is always the one built by the real `domainProofRemoval` after its preflight admitted the
// review; the state then changes before the statement commits (the window between preflight and batch), or the
// statement is replaced by a raw UPDATE that skips the preflight entirely. Only the schema triggers stand in the way.
// Every refusal has a negative control in which only the property under test differs.
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';

const b=await build({stdin:{contents:"export {domainProofRemoval} from './src/domain-proof-removal';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {domainProofRemoval}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const store=await databaseFixture(),db=store.db,id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network is allowed');};
const revisions=new Map();let checks=0;
const later=ms=>new Date(Date.now()+ms).toISOString();
async function user(){const u=id();await db.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(u,u+'@example.invalid').run();return u;}
/** A Chat turn row as chat.ts inserts it; `action` is the typed control, stored only on guided turns. */
function turnStatement(u,turn,{action=null,mode='guided',text='/confirm'}={}){
 const revision=(revisions.get(u)??0)+1;revisions.set(u,revision);
 return db.prepare('INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,action_json) VALUES(?,?,?,?,?,?,?,?)').bind(turn,u,revision,text,'',now(),mode,action&&JSON.stringify(action));
}
const control=reviewId=>({type:'confirm',kind:'domainProof',reviewId});
async function claim(u,hostname='www.example.com'){
 const project=id(),c=id();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Domain proof','','draft',?,?)").bind(project,u,now(),now()).run();
 await db.prepare('INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(c,project,hostname,'proof-'+id(),later(7*86400000),now()).run();
 return {id:c,project,hostname,row:()=>db.prepare('SELECT * FROM domain_claims WHERE id=?').bind(c).first()};
}
/** Prepares a removal review through the real handler; `ttl` shortens its ten-minute expiry by moving the clock back. */
async function review(u,c,ttl=600000){
 const turn=id();await turnStatement(u,turn,{mode:'guided',text:'/remove-domain-proof '+c.id}).run();
 const clock=Date.now;Date.now=()=>clock()-(600000-ttl);
 let prepared;try{prepared=await domainProofRemoval(db,u,turn,'/remove-domain-proof '+c.id);}finally{Date.now=clock;}
 assert.equal(prepared.statements.length,1,'the removal review was prepared');await db.batch(prepared.statements);await db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=?').bind(prepared.reply,turn).run();/* the shown reply, which the confirm rebuilds and compares */
 return turn;
}
/** Runs the real confirm preflight and returns the turn plus the statements it admitted (not yet committed). */
async function preflight(u,reviewId){
 const turn=id(),built=await domainProofRemoval(db,u,turn,'/confirm-domain-proof-remove '+reviewId);
 return {turn,...built};
}
const stored=r=>db.prepare('SELECT status,confirmed_by,expires_at,proof_token FROM domain_proof_removals WHERE id=?').bind(r).first();
const removedEvents=c=>db.prepare("SELECT count(*) n FROM activity_events WHERE action='domain.proof.removed' AND id=?").bind('domain-proof-removal:'+c.id).first().then(r=>r.n);
const turnExists=t=>db.prepare('SELECT count(*) n FROM chat_turns WHERE id=?').bind(t).first().then(r=>r.n===1);
/** A refused commit leaves the proof, the pending review, the activity log and (the batch is atomic) the turn unchanged. */
async function unchanged(c,r,turn,label){
 assert.ok(await c.row(),label+': the proof is still saved');
 const s=await stored(r);assert.equal(s.status,'pending',label);assert.equal(s.confirmed_by,null,label);
 assert.equal(await removedEvents(c),0,label+': no removal was recorded');
 if(turn)assert.equal(await turnExists(turn),false,label+': the confirm turn rolled back with the refused update');
 checks++;
}
async function applied(c,r,turn,label){
 assert.equal(await c.row(),null,label+': the proof was removed');
 const s=await stored(r);assert.equal(s.status,'applied',label);assert.equal(s.confirmed_by,turn,label);
 assert.equal(await removedEvents(c),1,label);checks++;
}

try{
 const a=await user(),b=await user();

 // 1. Expiry between preflight and commit: the JavaScript check admits the review, the SQL guard refuses it.
 {
  const c=await claim(a),r=await review(a,c,1500);
  const p=await preflight(a,r);assert.equal(p.statements.length,1,'the preflight admitted the still-current review');
  await sleep(2100);assert.ok((await stored(r)).expires_at<=now(),'the stored review has now expired');
  await assert.rejects(db.batch([turnStatement(a,p.turn,{action:control(r)}),...p.statements]),/domain_proof_removal_expired/);
  await unchanged(c,r,p.turn,'expired after preflight');
  const again=await preflight(a,r);assert.equal(again.statements.length,0);assert.match(again.reply,/expired/);checks++;
  // A raw apply that skips the preflight altogether is refused the same way.
  const raw=id();await turnStatement(a,raw,{action:control(r)}).run();
  await assert.rejects(db.prepare("UPDATE domain_proof_removals SET status='applied',confirmed_by=? WHERE id=?").bind(raw,r).run(),/domain_proof_removal_expired/);
  await unchanged(c,r,null,'raw apply of an expired review');
  // Extending the window while applying is refused by the identity trigger (expiry and binding otherwise pass).
  const extend=id();await turnStatement(a,extend,{action:control(r)}).run();
  await assert.rejects(db.prepare("UPDATE domain_proof_removals SET status='applied',confirmed_by=?,expires_at=? WHERE id=?").bind(extend,later(600000),r).run(),/domain_proof_removal_immutable/);
  await unchanged(c,r,null,'expiry extended while applying');
  // Negative control: an unexpired twin of the same proof, committed the same way, removes it.
  const twin=await review(a,c),q=await preflight(a,twin);
  await db.batch([turnStatement(a,q.turn,{action:control(twin)}),...q.statements]);
  await applied(c,twin,q.turn,'unexpired twin');
 }

 // 2. The confirming turn must be the owner's guided confirm control for exactly this review.
 {
  const c=await claim(a),r=await review(a,c),other=await review(a,await claim(a,'other.example.com'));
  const cases=[
   ['a plain Chat message',a,{mode:'guided',action:null,text:'/confirm-domain-proof-remove '+r}],
   ['a control for another review',a,{action:control(other)}],
   ['a control of another kind',a,{action:{type:'confirm',kind:'site',reviewId:r}}],
   ['an AI turn',a,{mode:'ai',action:null,text:'/confirm-domain-proof-remove '+r}],
  ];
  for(const [label,u,shape] of cases){
   const p=await preflight(a,r);assert.equal(p.statements.length,1,label+': preflight admitted');
   await assert.rejects(db.batch([turnStatement(u,p.turn,shape),...p.statements]),/domain_proof_removal_changed/,label);
   await unchanged(c,r,p.turn,label);
  }
  // Another account's turn carrying a well-formed control for this review, applied without the preflight.
  const foreign=id();await turnStatement(b,foreign,{action:control(r)}).run();
  await assert.rejects(db.prepare("UPDATE domain_proof_removals SET status='applied',confirmed_by=? WHERE id=?").bind(foreign,r).run(),/domain_proof_removal_changed/);
  await unchanged(c,r,null,'foreign confirm turn');
  const fromB=await preflight(b,r);assert.equal(fromB.statements.length,0);assert.match(fromB.reply,/not found/);checks++;
  // Negative control: the same review with the owner's guided control is applied.
  const p=await preflight(a,r);await db.batch([turnStatement(a,p.turn,{action:control(r)}),...p.statements]);
  await applied(c,r,p.turn,'owner guided control');
 }

 // 3. The reviewed proof and project owner must still be current when the statement commits.
 {
  const c=await claim(a),r=await review(a,c),original=(await c.row()).expires_at;
  let p=await preflight(a,r);
  await db.prepare('UPDATE domain_claims SET expires_at=? WHERE id=?').bind(later(8*86400000),c.id).run();
  await assert.rejects(db.batch([turnStatement(a,p.turn,{action:control(r)}),...p.statements]),/domain_proof_removal_changed/);
  await unchanged(c,r,p.turn,'proof expiry changed after review');
  // Retargeting the review at the changed proof while applying is refused by the identity trigger.
  const retarget=id();await turnStatement(a,retarget,{action:control(r)}).run();
  await assert.rejects(db.prepare("UPDATE domain_proof_removals SET status='applied',confirmed_by=?,proof_expires_at=(SELECT expires_at FROM domain_claims WHERE id=?) WHERE id=?").bind(retarget,c.id,r).run(),/domain_proof_removal_immutable/);
  await unchanged(c,r,null,'review retargeted at the changed proof');
  await db.prepare('UPDATE domain_claims SET expires_at=? WHERE id=?').bind(original,c.id).run();
  p=await preflight(a,r);
  await db.prepare('UPDATE projects SET owner_user_id=? WHERE id=?').bind(b,c.project).run();
  await assert.rejects(db.batch([turnStatement(a,p.turn,{action:control(r)}),...p.statements]),/domain_proof_removal_changed/);
  await unchanged(c,r,p.turn,'project transferred after preflight');
  const afterTransfer=await preflight(a,r);assert.equal(afterTransfer.statements.length,0);assert.match(afterTransfer.reply,/not found/);checks++;
  // Negative control: with the proof and owner restored to the reviewed state, the same review applies.
  await db.prepare('UPDATE projects SET owner_user_id=? WHERE id=?').bind(a,c.project).run();
  p=await preflight(a,r);await db.batch([turnStatement(a,p.turn,{action:control(r)}),...p.statements]);
  await applied(c,r,p.turn,'reviewed state restored');

  // 4. Replay: an applied review cannot be re-applied, reopened, or used to revive the removed proof.
  const first=p.turn,stale=p.statements;
  const replay=await preflight(a,r);assert.equal(replay.statements.length,0);assert.match(replay.reply,/already removed/);checks++;
  const [rerun]=await db.batch(stale);assert.equal(rerun.meta.changes,0,'the committed statement matches nothing on replay');
  const second=id();await turnStatement(a,second,{action:control(r)}).run();
  await assert.rejects(db.prepare("UPDATE domain_proof_removals SET status='applied',confirmed_by=? WHERE id=?").bind(second,r).run(),/domain_proof_removal_(immutable|changed)/);
  await assert.rejects(db.prepare("UPDATE domain_proof_removals SET status='pending',confirmed_by=NULL WHERE id=?").bind(r).run(),/domain_proof_removal_(immutable|changed)/);
  assert.equal((await stored(r)).confirmed_by,first);assert.equal(await removedEvents(c),1);checks++;
  await assert.rejects(db.prepare('INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(c.id,c.project,c.hostname,'revived',later(86400000),now()).run(),/domain_proof_removal_replay/);
  assert.equal(await c.row(),null,'the removed proof id cannot be revived');checks++;
  // Negative control: a fresh proof for the same hostname and project is accepted under a new id.
  const fresh=id();await db.prepare('INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(fresh,c.project,c.hostname,'proof-'+id(),later(86400000),now()).run();
  assert.ok(await db.prepare('SELECT 1 FROM domain_claims WHERE id=?').bind(fresh).first());checks++;
 }

 console.log(`Boundary domain-proof removal SQL passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}: ${checks} checks — a review that expires after the JavaScript preflight, a confirm turn that is plain, AI, foreign, for another review or another kind, a proof or owner changed after review, an expiry or proof retargeted while applying, and every replay are refused by the schema triggers with the proof kept; each matching twin applies. Synthetic, local only.`);
}finally{globalThis.fetch=originalFetch;await store.close?.();}
