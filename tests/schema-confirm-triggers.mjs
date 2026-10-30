import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';

// WH-004 R2 (schema batch 5): the five Chat confirm triggers (publication, saved-version removal, photo removal, contact form, contact
// notification address) accept only a GUIDED turn of the same owner that carries the typed confirm control for this exact review. Each review is
// prepared through the real Chat commands; the confirming turn is then forged in SQL (a plain guided turn, a model turn, a control of another kind,
// another review's control, another owner's matching control) and must be refused, and the real control must still apply. SQLite and, with --d1,
// actual local D1. Synthetic rows only.
const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db;
const owner=await workspaceFixture(db,m),other=await workspaceFixture(db,m),user=owner.account,scope=await owner.scope();
const {project,version}=await createFixtureProject(scope,user,'Garden','Testing');
let sequence=0,cases=0;
const run=(sql,...v)=>db.prepare(sql).bind(...v).run(),one=(sql,...v)=>db.prepare(sql).bind(...v).first();
const chat=async content=>{const state=await m.readChat(scope,user),input={id:crypto.randomUUID(),revision:state.state.revision,content},result=await m.sendChat(scope,user,input);assert.equal(result.status,200,content+' '+JSON.stringify(result));return input.id;};
const forge=async({mode='guided',action=null,as=user}={})=>{
 const id=crypto.randomUUID();
 await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status,action_json) VALUES(?,?,?,'forged','forged',datetime('now'),?,'completed',?)",id,as,100000+(++sequence),mode,action);
 return id;
};
const control=(kind,reviewId)=>JSON.stringify({type:'confirm',kind,reviewId});
const kinds=[
 {kind:'site',table:'publication_actions'},{kind:'version',table:'version_removals'},{kind:'photo',table:'photo_removals'},
 {kind:'contact',table:'contact_reviews'},{kind:'contactNotification',table:'contact_destination_reviews'},
];
const status=(table,review)=>one(`SELECT status,confirmed_by FROM ${table} WHERE id=?`,review);
async function exercise({kind,table},review,confirmCommand){
 const apply=turn=>run(`UPDATE ${table} SET status='applied',confirmed_by=? WHERE id=?`,turn,review);
 const otherKind=kinds.find(k=>k.kind!==kind).kind;
 const otherReview=crypto.randomUUID();
 const attempts={
  'a plain guided turn':await forge(),
  'a model (ai) turn':await forge({mode:'ai'}),
  'a control of another kind for this review':await forge({action:control(otherKind,review)}),
  'this kind\'s control for another review':await forge({action:control(kind,otherReview)}),
  'a malformed control (no review)':await forge({action:JSON.stringify({type:'confirm',kind})}),
  'another owner\'s matching control':await forge({action:control(kind,review),as:other.account}),
 };
 for(const [label,turn] of Object.entries(attempts)){
  await assert.rejects(apply(turn),/_changed/,`${kind}: ${label} must not confirm`);
  assert.equal((await status(table,review)).status,'pending',`${kind}: ${label} left the review pending`);
 }
 await chat(confirmCommand+' '+review);
 const done=await status(table,review);assert.equal(done.status,'applied',`${kind}: the typed control applies`);
 const turn=await one('SELECT mode,action_json FROM chat_turns WHERE id=?',done.confirmed_by);
 assert.deepEqual([turn.mode,JSON.parse(turn.action_json)],['guided',{type:'confirm',kind,reviewId:review}],`${kind}: the confirming turn is the guided control for this review`);
 cases++;
}
try{
 // publication: also, a publish review cannot be confirmed by its own preparing turn (that shortcut exists only for the withdrawal of a live site).
 const publishReview=await chat('/publish '+version);
 await assert.rejects(run("UPDATE publication_actions SET status='applied',confirmed_by=id WHERE id=?",publishReview),/publication_changed/,'a publish review is not self-confirming');
 await exercise(kinds[0],publishReview,'/confirm');
 assert.equal((await one('SELECT version_id FROM publications WHERE project_id=?',project)).version_id,version,'the control published the reviewed version');

 // saved-version removal: two newer drafts so the middle one is neither live nor the head.
 await changeFixtureWebsite(scope,user,project,[{type:'content.replace',contentId:'headline',text:'Draft 2'}]);
 const removable=(await one('SELECT version_id FROM project_spec_heads WHERE project_id=?',project)).version_id;
 await changeFixtureWebsite(scope,user,project,[{type:'content.replace',contentId:'headline',text:'Draft 3'}]);
 await exercise(kinds[1],await chat('/delete-version '+removable),'/confirm-version-delete');
 assert.equal(await one('SELECT id FROM site_versions WHERE id=?',removable),null,'the reviewed version was removed');

 // photo removal
 const file=crypto.randomUUID();
 await run("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,'Garden',?,?,100,10,10,'ready',datetime('now'))",file,project,`photos/${project}/${file}.jpg`,'a'.repeat(64));
 await exercise(kinds[2],await chat('/delete-photo '+file),'/confirm-photo-delete');

 // contact form (the site is live) and its notification address
 await exercise(kinds[3],await chat('/contact-on '+project),'/confirm-contact');
 await exercise(kinds[4],await chat(`/contact-notify ${project} owner-${sequence}@example.test`),'/confirm-contact-notify');

 // the withdrawal of a live site by its own review turn (service-safety path) is the one shortcut that remains.
 const withdraw=await chat('/unpublish '+project);
 await run("UPDATE publication_actions SET status='applied',confirmed_by=id WHERE id=?",withdraw);
 assert.equal((await one('SELECT version_id FROM publications WHERE project_id=?',project)).version_id,null,'an unpublish review can be confirmed by its own turn');
 cases++;
 console.log(`Confirm triggers (R2): ${cases} groups; each of the five refuses 6 forged confirming turns and applies only the guided typed control, on ${process.argv.includes('--d1')?'local D1':'SQLite'}.`);
}finally{await store.close?.();}
