import assert from 'node:assert/strict';
import {build} from 'esbuild';
// Synthetic current fixtures use the actual transaction builders. Never seed an
// unversioned page or provide an adapter for retired product actions.
// Callers obtain authority exports from this same bundle: admission capabilities
// are module-private and cannot be passed between separately bundled runtimes.
let module;
export async function currentSiteFixtureHandlers(){
 if(!module){const b=await build({stdin:{contents:"export {default as worker} from './src/index';export {comparisonErrorResponse} from './src/comparison-page';export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';export {createWebsite,prepareSpecification,readSpecificationProposal} from './src/project-specification/store';export {readChat,sendChatControl} from './src/chat';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});module=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].contents).toString('base64'));}
 return module;
}
async function saveProposal(db,user,turn,prepared){
 const m=await currentSiteFixtureHandlers(),revision=(await m.readChat(db,user)).state.revision,now=new Date().toISOString();
 await db.batch([
  db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at) VALUES(?,?,?,'Synthetic current website fixture','','ai','pending',?)").bind(turn,user,revision+1,now),
  ...prepared.statements,
  db.prepare("UPDATE chat_turns SET assistant_text=?,status='completed' WHERE id=?").bind(prepared.reply,turn),
  db.prepare('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?').bind(user)
 ]);
}
export async function createFixtureWebsite(db,user,project,config){
 const m=await currentSiteFixtureHandlers(),turn=crypto.randomUUID(),prepared=await m.createWebsite(db,user,turn,project,config);await saveProposal(db,user,turn,prepared);return turn;
}
export async function changeFixtureWebsite(db,user,project,operations){
 const m=await currentSiteFixtureHandlers(),turn=crypto.randomUUID(),head=await db.prepare('SELECT revision FROM project_spec_heads WHERE project_id=?').bind(project).first();assert.ok(head);
 await saveProposal(db,user,turn,await m.prepareSpecification(db,user,turn,{kind:'specification',operation:'change',projectId:project,expectedRevision:head.revision,operations}));
 const q=await m.readSpecificationProposal(db,user,turn),version=crypto.randomUUID(),revision=(await m.readChat(db,user)).state.revision;
 assert.equal((await m.sendChatControl(db,user,{id:version,revision,action:{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision}})).status,200);return version;
}

export async function createFixtureProject(db,user,name,purpose,theme='ocean'){
 const project=crypto.randomUUID(),now=new Date().toISOString();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,?,'draft',?,?)").bind(project,user,name,purpose,now,now).run();
 const version=await createFixtureWebsite(db,user,project,{name,headline:name,description:purpose,theme,aboutTitle:'About us',aboutText:purpose,sections:[],photos:[]});
 return {project,version};
}
