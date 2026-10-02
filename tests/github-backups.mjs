import {paidPlan} from './helpers/paid-plan.mjs';
import {createFixtureProject,currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {unzipSync} from 'fflate';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),{reviewBackup,confirmBackup,listBackups,githubRepositories,worker,ownedExport,seal}=m;
const fixture=await databaseFixture({d1:true,r2:true}),db=fixture.db,dir=await mkdtemp('/tmp/whumpo-backups-'),identities=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
const config={clientId:'Iv1.test',clientSecret:'synthetic-secret',appId:123,slug:'test',key:'ab'.repeat(32)},now=new Date().toISOString();
async function account(){const a=await workspaceFixture(db,m);identities.set(a.account,a);scopes.set(a.account,await a.scope());await paidPlan(db,a.account,'business');return a.account;}
const denied=async()=>{throw Error('Unexpected network');};
try{
 const user=await account(),other=await account(),token=crypto.randomUUID();
 await db.prepare('INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,?,?)').bind(token,user,await seal(config.key,`tellumo:github:token:${user}:${token}`,'ghu_synthetic_private'),new Date(Date.now()+3600000).toISOString(),'active').run();
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
 const input=()=>({id:crypto.randomUUID(),versionId:version,owner:'test',repo:'backup',repoId:17});
 const review=(i=input())=>reviewBackup(scope(user),fixture.env.FILES,user,i,config,transport);
 const confirm=(id,database=scope(user))=>confirmBackup(database,fixture.env.FILES,user,id,config,transport);
 const reset=()=>{head='a'.repeat(40);repoPrivate=true;repoId=17;branch='main';remote=false;parentFile=false;malformed=false;mode='ok';};
 assert.equal((await githubRepositories(scope(user),user,config,1,1,transport)).repositories.length,1);await assert.rejects(()=>githubRepositories(scope(user),user,config,2,1,transport));
 await assert.rejects(()=>reviewBackup(scope(other),fixture.env.FILES,other,input(),config,denied));
 const i=input(),r=await review(i);assert.equal(writes,0);assert.equal(r.state,'pending');assert.equal(r.private,true);assert.equal((await db.prepare('SELECT tree_sha FROM github_backups WHERE id=?').bind(r.id).first()).tree_sha,independentTree);
 assert.deepEqual(await review(i),r);await assert.rejects(()=>review({...i,repo:'different'}));assert.equal((await listBackups(scope(other),other)).backups.length,0);await assert.rejects(()=>confirmBackup(scope(other),fixture.env.FILES,other,r.id,config,denied));
 const results=await Promise.all([confirm(r.id),confirm(r.id)]);assert.ok(results.some(x=>x.state==='complete'));assert.equal(writes,1);assert.equal((await confirm(r.id)).state,'complete');assert.equal(writes,1);assert.ok((await confirm(r.id)).url.includes(head));
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM activity_events WHERE action='github.backup'").first()).n,1);
 reset();repoPrivate=false;const publicReview=await review();assert.equal(publicReview.private,false);repoPrivate=true;await assert.rejects(()=>confirm(publicReview.id),/visibility/);
 for(const change of [()=>repoId=18,()=>branch='other',()=>head='d'.repeat(40),()=>parentFile=true,()=>remote='wrong',()=>malformed=true]){reset();const r=await review();change();await assert.rejects(()=>confirm(r.id));assert.equal(writes,1);}
 reset();const existing=await review();remote=true;assert.equal((await confirm(existing.id)).state,'complete');assert.equal(writes,1);
 reset();const after=await review();mode='after';assert.equal((await confirm(after.id)).state,'uncertain');assert.equal(writes,2);assert.equal((await confirm(after.id)).state,'complete');assert.equal(writes,2);
 reset();const before=await review();mode='before';assert.equal((await confirm(before.id)).state,'uncertain');assert.equal(writes,3);assert.equal((await confirm(before.id)).state,'uncertain');assert.equal(writes,3);
 reset();const stale=await review();mode='stale';assert.equal((await confirm(stale.id)).state,'uncertain');await confirm(stale.id);assert.equal(writes,4);
 reset();const lost=await review();let dropped=false;const lossy=await identities.get(user).scope(interceptDatabase(db,/UPDATE github_backups SET state='complete'/,async()=>{},async()=>{if(!dropped){dropped=true;throw Error('Lost database acknowledgement');}}));assert.equal((await confirm(lost.id,lossy)).state,'complete');assert.ok(dropped);assert.equal(writes,5);
 reset();const changedToken=await review();
 const replacement=crypto.randomUUID();await db.prepare('INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,?,?)').bind(replacement,user,await seal(config.key,`tellumo:github:token:${user}:${replacement}`,'ghu_synthetic_private'),new Date(Date.now()+3600000).toISOString(),'active').run();
 await db.prepare('UPDATE github_connections SET active_token_id=? WHERE user_id=?').bind(replacement,user).run();await assert.rejects(()=>confirm(changedToken.id),/connection changed/);
 await db.prepare('UPDATE github_connections SET active_token_id=? WHERE user_id=?').bind(token,user).run();
 const session=identities.get(other).token;
 const env={...fixture.env,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
 const request=(path,method='GET',authenticated=true,origin='https://whumpo.com')=>worker.fetch(new Request('https://whumpo.com/api'+path,{method,headers:{...(authenticated?{cookie:'__Host-whumpo_session='+session}:{}),origin,'content-type':'application/json'},...(method==='POST'?{body:'{}'}:{})}),env);
 assert.equal((await request('/github/backups','GET',false)).status,401);assert.deepEqual(await(await request('/github/backups')).json(),{backups:[]});
 assert.equal((await request('/github/backups/'+r.id+'/confirm','POST')).status,404);assert.equal((await request('/github/backups/review','POST',true,'https://evil.test')).status,403);assert.equal((await request('/github/backups/review','POST')).status,400);
 reset();const expiry=await review();await db.prepare("UPDATE github_token_vault SET expires_at='2000-01-01' WHERE id=?").bind(token).run();await assert.rejects(()=>confirm(expiry.id));assert.equal(writes,5);
 // Local history remains readable when provider authorization has expired/disconnected.
 await db.prepare('UPDATE github_connections SET active_token_id=NULL WHERE user_id=?').bind(user).run();
 const ownerSession=identities.get(user).token;
 const history=await worker.fetch(new Request('https://whumpo.com/api/github/backups',{headers:{cookie:'__Host-whumpo_session='+ownerSession}}),env);
 assert.equal(history.status,200);const retained=await history.json();assert.ok(retained.backups.some(b=>b.id===r.id&&b.state==='complete'));assert.ok(retained.backups.some(b=>b.id===before.id&&b.state==='uncertain'));assert.ok(!JSON.stringify(retained).includes('ghu_'));assert.equal(writes,5);
 await assert.rejects(()=>db.prepare("UPDATE github_backups SET path='elsewhere' WHERE id=?").bind(r.id).run(),/immutable/);
 console.log('GitHub backups passed: independent Git tree hash, exact readable files, ownership, review replay, concurrent confirmation, visibility/identity/head/path conflicts, malformed responses, prior exact copy, lost provider/database acknowledgements, no retry writes, token expiry and immutable reviews. No real GitHub writes.');
}finally{await fixture.close();await rm(dir,{recursive:true,force:true});}
