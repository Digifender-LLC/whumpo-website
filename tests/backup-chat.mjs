import {fixtureKeyring,initializeFixtureKeys} from './helpers/connection-keyring.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {createFixtureProject,currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {unzipSync} from 'fflate';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {assertReplyEditRefused,assertTypedReplyEditRefused} from './helpers/receipt-forge.mjs';
const uiBuild=await build({entryPoints:['frontend/src/chat-turn-actions.tsx'],bundle:true,format:'cjs',platform:'node',jsx:'automatic',alias:{'@':'./frontend/src'},external:['react','react/*'],write:false});
const uiModule={exports:{}};new Function('require','module','exports',uiBuild.outputFiles[0].text)(createRequire(import.meta.url),uiModule,uiModule.exports);
const {TurnActions}=uiModule.exports;
const renderActions=turn=>renderToStaticMarkup(createElement(TurnActions,{turn,onSend:async()=>{}}));
const m=await currentSiteFixtureHandlers(),{listBackups,sendChat,sendChatControl,readChat,ownedExport,seal,sendAIChat,getBilling}=m;
const fixture=await databaseFixture({d1:true,r2:true}),db=fixture.db,dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-backup-chat-'),identities=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
const config={clientId:'Iv1.test',clientSecret:'synthetic-secret',appId:123,slug:'test',key:fixtureKeyring('ab'.repeat(32))},now=new Date().toISOString();
async function account(){const a=await workspaceFixture(db,m);identities.set(a.account,a);scopes.set(a.account,await a.scope());await paidPlan(db,a.account,'business');return a.account;}
const denied=async()=>{throw Error('Unexpected network');};
try{
 await initializeFixtureKeys(db,config.key);
 const user=await account(),other=await account(),token=crypto.randomUUID();
 await db.prepare('INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,?,?)').bind(token,user,await seal(config.key,`whumpo:github:token:${user}:${token}`,'ghu_synthetic_private'),new Date(Date.now()+3600000).toISOString(),'active').run();
 await db.prepare('INSERT INTO github_connections(user_id,github_user_id,login,active_token_id,connected_at) VALUES(?,?,?,?,?)').bind(user,'44','test',token,now).run();
 const {version}=await createFixtureProject(scope(user),user,'Bakery','A local bakery','clay');
 const archive=await ownedExport(scope(user),user,version),files=unzipSync(archive),gitdir=dir+'/git';await mkdir(gitdir);
 execFileSync('git',['init','-q',gitdir]);for(const [path,bytes] of Object.entries(files)){await mkdir(dirname(gitdir+'/'+path),{recursive:true});await writeFile(gitdir+'/'+path,bytes);}
 execFileSync('git',['-C',gitdir,'add','.']);const independentTree=execFileSync('git',['-C',gitdir,'write-tree'],{encoding:'utf8'}).trim();
 let head='a'.repeat(40),repoPrivate=true,repoId=17,branch='main',remote=false,parentFile=false,malformed=false,mode='ok',writes=0,lastInput;
 const transport=async(url,init={})=>{
  assert.equal(init.headers.authorization,'Bearer ghu_synthetic_private');assert.equal(init.redirect,'manual');
  if(url==='https://api.github.com/user/installations?per_page=100')return Response.json({total_count:1,installations:[{id:1,app_id:123,suspended_at:null,account:{login:'test'},repository_selection:'selected'}]});
  const repo={id:repoId,owner:{login:'test'},name:'backup',private:repoPrivate,default_branch:branch,permissions:{push:true}};
  if(url==='https://api.github.com/user/installations/1/repositories?per_page=20&page=1')return Response.json({repositories:[repo]});
  if(url==='https://api.github.com/repos/test/backup')return Response.json(repo);
  if(url.includes('/git/ref/heads/'))return Response.json({object:{sha:head}});
  assert.equal(url,'https://api.github.com/graphql');const payload=JSON.parse(init.body);
  if(payload.query.startsWith('query'))return Response.json({data:{repository:malformed?{}:{p0:parentFile?{__typename:'Blob',oid:head}:null,p1:null,p2:null,p3:remote?{__typename:'Tree',oid:remote===true?independentTree:'c'.repeat(40)}:null}}});
  writes++;lastInput=payload.variables.input;assert.equal(lastInput.expectedHeadOid,head);assert.deepEqual(lastInput.branch,{repositoryNameWithOwner:'test/backup',branchName:'main'});assert.ok(lastInput.message.headline.startsWith('[skip ci]'));assert.equal(lastInput.fileChanges.deletions,undefined);
  for(const file of lastInput.fileChanges.additions){const relative=file.path.split('/').slice(4).join('/');assert.deepEqual(Buffer.from(file.contents,'base64'),Buffer.from(files[relative]));assert.ok(!file.contents.includes('ghu_'));}
  if(mode==='before')throw Error('Disconnected before acknowledgement');
  if(mode==='stale')return Response.json({errors:[{message:'Expected head changed'}]});
  remote=true;head='b'.repeat(40);if(mode==='after')throw Error('Lost remote acknowledgement');
  return Response.json({data:{createCommitOnBranch:{commit:{oid:head}}}});
 };
 const options={github:config,githubTransport:transport,files:fixture.env.FILES};
 async function message(content,id=crypto.randomUUID(),revision,database,who=user){const state=await readChat(scope(who),who);const result=await sendChat(database??scope(who),who,{id,content,revision:revision??state.state.revision},undefined,options);return {id,result,turn:(await readChat(scope(who),who)).turns.at(-1)};}
 // Private handler dispatch is distinct from the natural-language HTTP surface.
 assert.match((await message('/github-installations')).turn.assistant_text,/Installation: 1/);
 assert.match((await message('/github-repos 1')).turn.assistant_text,/Repository ID: 17/);
 repoPrivate=false;const review=await message('/review-backup '+version+' test/backup 17');assert.equal(review.result.status,200);assert.match(review.turn.assistant_text,/PUBLIC — anyone can read/);assert.match(review.turn.assistant_text,/SHA-256:/);assert.equal(review.turn.backup_confirmation_id,review.id);assert.equal(writes,0);
 await message('/check-backup '+review.id);assert.equal(writes,0);
 assert.match((await message('/backups',crypto.randomUUID(),undefined,undefined,other)).turn.assistant_text,/No GitHub backup reviews/);
 // Receipt: an edited review reply is refused on the confirm control; nothing is written to GitHub.
 await assertReplyEditRefused({db,kind:'backup',reviewId:review.id,table:'github_backups',statusColumn:'state',confirm:async action=>sendChatControl(scope(user),user,{id:crypto.randomUUID(),revision:(await readChat(scope(user),user)).state.revision,action:{type:'confirm',...action}},undefined,options)});assert.equal(writes,0);
 await assertTypedReplyEditRefused({db,kind:'backup',reviewId:review.id,table:'github_backups',statusColumn:'state',typed:async()=>(await message('/confirm-backup '+review.id)).turn.assistant_text});assert.equal(writes,0);
 assert.match((await message('/confirm-backup '+review.id,crypto.randomUUID(),undefined,undefined,other)).turn.assistant_text,/no longer matches this review/);
 assert.equal((await message('/confirm-backup '+review.id,crypto.randomUUID(),0)).result.status,409);assert.equal(writes,0);
 const revision=(await readChat(scope(user),user)).state.revision,confirmId=crypto.randomUUID();
 const concurrent=await Promise.all([message('/confirm-backup '+review.id,confirmId,revision),message('/confirm-backup '+review.id,confirmId,revision)]);assert.ok(concurrent.every(r=>r.result.status===200));assert.equal(writes,1);
 await message('/confirm-backup '+review.id,confirmId,revision);assert.equal(writes,1);
 const completed=(await readChat(scope(user),user)).turns.find(t=>t.id===review.id);assert.equal(completed.backup_confirmation_id,null);assert.ok(completed.backup_url.startsWith('https://github.com/test/backup/tree/'));assert.ok(completed.backup_url.endsWith('/versions/'+version));
 const markup=renderActions(completed);assert.ok(markup.includes('View GitHub backup'));assert.ok(markup.includes('href="'+completed.backup_url+'"'));assert.ok(markup.includes('rel="noopener noreferrer"'));assert.ok(!markup.includes('Confirm GitHub backup'));
 for(const url of [completed.backup_url.replace('github.com','github.com.evil.invalid'),completed.backup_url+'?redirect=evil',completed.backup_url+'/../../settings',completed.backup_url.replace('/tree/','/commit/'),'javascript:alert(1)',null])assert.ok(!renderActions({...completed,backup_url:url}).includes('View GitHub backup'));

 // A lost provider response is reconciled by reading, never by repeating the commit.
 remote=false;const uncertain=await message('/review-backup '+version+' test/backup 17');mode='after';await message('/confirm-backup '+uncertain.id);assert.equal(writes,2);assert.equal((await listBackups(scope(user),user)).backups.find(b=>b.id===uncertain.id).state,'uncertain');
 await message('/check-backup '+uncertain.id);assert.equal(writes,2);assert.equal((await listBackups(scope(user),user)).backups.find(b=>b.id===uncertain.id).state,'complete');mode='ok';
 assert.equal((await getBilling(scope(user),user)).standardAI.creditCharge,0);
 // A lost durable chat claim must not call GitHub or create a saved review.
 const lost=crypto.randomUUID(),lossy=await identities.get(user).scope(interceptDatabase(db,/INSERT INTO chat_turns/,async()=>{},async()=>{throw Error('Lost claim acknowledgement');}));
 await message('/review-backup '+version+' test/backup 17',lost,undefined,lossy);assert.equal(await db.prepare('SELECT id FROM github_backups WHERE id=?').bind(lost).first(),null);assert.match((await readChat(scope(user),user)).turns.at(-1).assistant_text,/not yet been saved/);
 // Saved review plus lost final transcript: no confirmation button beside an incomplete receipt.
 const interrupted=crypto.randomUUID(),lostReceipt=await identities.get(user).scope(interceptDatabase(db,/UPDATE chat_turns SET assistant_text=\?/,async()=>{throw Error('Lost transcript write');}));
 await assert.rejects(message('/review-backup '+version+' test/backup 17',interrupted,undefined,lostReceipt));const pending=(await readChat(scope(user),user)).turns.at(-1);assert.equal(pending.backup_confirmation_id,null);assert.ok(await db.prepare('SELECT id FROM github_backups WHERE id=?').bind(interrupted).first());assert.match((await message('/backups')).turn.assistant_text,new RegExp(interrupted));
 const ai={baseURL:'https://model.invalid/v1',apiKey:'synthetic',model:'fixture',protocol:'responses'};
 for(const action of [{kind:'backup',operation:'list'},{kind:'backup',operation:'installations'},{kind:'backup',operation:'repositories',installationId:1},{kind:'backup',operation:'review',versionId:version,owner:'test',repo:'backup',repoId:17},{kind:'backup',operation:'confirm',reviewId:review.id},{kind:'backup',operation:'check',reviewId:review.id},{kind:'backup',operation:'review',versionId:version,owner:'test',repo:'backup',repoId:17,path:'arbitrary'},{kind:'backup',operation:'repositories',installationId:1,page:51}]){
  const state=await readChat(scope(user),user),id=crypto.randomUUID(),allowed=['list','installations','repositories','review'].includes(action.operation)&&!action.path&&action.page!==51;
  await sendAIChat(scope(user),user,id,state.state.revision,'Back up my saved website',ai,async(url,init)=>{assert.ok(!init.body.includes('ghu_synthetic_private'));assert.ok(!init.body.includes('synthetic-secret'));return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Committed everything.',action})}]}],usage:{input_tokens:100,output_tokens:100}});},options);
  const turn=(await readChat(scope(user),user)).turns.at(-1);assert.equal(turn.status,allowed?'completed':'failed');assert.ok(!turn.assistant_text.includes('Committed everything.'));assert.equal(writes,2);
 }
 const disabledState=await readChat(scope(other),other);await sendChat(scope(other),other,{id:crypto.randomUUID(),revision:disabledState.state.revision,content:'/github-installations'});assert.match((await readChat(scope(other),other)).turns.at(-1).assistant_text,/not configured/);
 console.log('Backup chat passed: installation/repository discovery, public-source warning, exact review, confirm/check separation, tenant isolation, stale/concurrent/replayed turns, uncertain read-only recovery, lost claim/transcript, safe confirmation controls, zero guided units and AI allowlist/secret isolation.');
}finally{await fixture.close();await rm(dir,{recursive:true,force:true});}
