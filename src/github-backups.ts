import {prepareConnectorContract,assertConnectorConfirmation,connectorReceipt,type ConnectorSavedContract} from './connector-receipts';
import {unzipSync} from 'fflate';
import {ConnectionError,githubAccess,githubInstallations,readGitHubJSON,type GitHubConfig} from './github-connection';
import {ownedExport} from './exports';
import {hashToken} from './security';
import {connectionFeature,featurePredicate,requireFeature,assertFeature} from './feature-admission';
import {backupPathsQuery,backupPathsVariables} from './connection-recovery';
type Access=Awaited<ReturnType<typeof githubAccess>>;
type Repo={id:number;owner:string;name:string;private:boolean;branch:string;size:number};
type Backup=ConnectorSavedContract&{id:string;user_id:string;project_id:string;version_id:string;request_hash:string;token_id:string|null;github_user_id:string;repo_id:number;repo_owner:string;repo_name:string;repo_private:number;branch:string;path:string;sha256:string;tree_sha:string;base_head:string;files_json:string;byte_length:number;state:'pending'|'dispatching'|'uncertain'|'complete'|'failed';commit_sha:string|null;detail:string;created_at:string;expires_at:string;dispatched_at:string|null};
const uuid=/^[0-9a-f-]{36}$/,sha=/^[0-9a-f]{40}$/;
function validName(owner:string,name:string){return /^[A-Za-z0-9-]{1,39}$/.test(owner)&&/^[A-Za-z0-9_.-]{1,100}$/.test(name)&&!['.','..'].includes(name);}
function parseRepo(value:Record<string,unknown>):Repo{
 const owner=value.owner as Record<string,unknown>|undefined,permissions=value.permissions as Record<string,unknown>|undefined;
 if(!Number.isSafeInteger(value.id)||Number(value.id)<1||typeof owner?.login!=='string'||typeof value.name!=='string'||!validName(owner.login,value.name)||typeof value.private!=='boolean'||typeof value.default_branch!=='string'||!value.default_branch||value.default_branch.length>255||/[\x00-\x1f\x7f]/.test(value.default_branch)||value.archived===true||value.disabled===true||permissions?.push!==true)throw new ConnectionError(403,'Choose an available repository where your GitHub App connection has write access.');
 return {id:Number(value.id),owner:owner.login,name:value.name,private:value.private,branch:value.default_branch,size:typeof value.size==='number'?value.size:-1};
}
async function repository(access:Access,owner:string,name:string){if(!validName(owner,name))throw new ConnectionError(400,'Invalid repository name.');const value=await readGitHubJSON(await access.send('repository.get',{owner,name}));await access.assertCurrent();return parseRepo(value);}
export async function githubRepositories(db:D1Database,userId:string,config:GitHubConfig|undefined,installation:number,page:number,transport:typeof fetch=fetch){
 if(!Number.isSafeInteger(installation)||installation<1||!Number.isSafeInteger(page)||page<1||page>50)throw new ConnectionError(400,'Invalid repository page.');
 if(!(await githubInstallations(db,userId,config,transport)).installations.some(i=>i.id===installation))throw new ConnectionError(404,'Installation not found.');
 const access=await githubAccess(db,userId,config,transport,{projectId:null,operation:'read'}),data=await readGitHubJSON(await access.send('repositories.list',{installation,page}));
 await access.assertCurrent();
 if(!Array.isArray(data.repositories)||data.repositories.length>20)throw new ConnectionError(503,'GitHub returned invalid repositories.');
 const repositories=data.repositories.flatMap(r=>{try{return [parseRepo(r as Record<string,unknown>)];}catch{return [];}});
 return {repositories,page,hasMore:data.repositories.length===20&&page<50};
}
async function digest(bytes:Uint8Array,algorithm='SHA-256'){return Array.from(new Uint8Array(await crypto.subtle.digest(algorithm,bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
async function gitHash(kind:string,bytes:Uint8Array){const header=new TextEncoder().encode(`${kind} ${bytes.length}\0`),object=new Uint8Array(header.length+bytes.length);object.set(header);object.set(bytes,header.length);return digest(object,'SHA-1');}
async function sourceTree(archive:Uint8Array){
 const files=unzipSync(archive);if(Object.keys(files).length>8||Object.keys(files).some(p=>! /^(README\.txt|public\/(?:index\.html|_headers|assets\/[0-9a-f-]{36}\.jpg)|whumpo\/site\.json)$/.test(p)))throw new ConnectionError(409,'This source bundle is not supported for GitHub backup.');
 type Tree=Map<string,Tree|Uint8Array>;const root:Tree=new Map();
 for(const [path,bytes] of Object.entries(files)){const names=path.split('/');let node=root;for(const name of names.slice(0,-1)){if(!node.has(name))node.set(name,new Map());node=node.get(name) as Tree;}node.set(names.at(-1)!,bytes);}
 async function hashTree(node:Tree):Promise<string>{const chunks:Uint8Array[]=[];let size=0;const entries=[...node].sort(([a,x],[b,y])=>(a+(x instanceof Map?'/':''))<(b+(y instanceof Map?'/':''))?-1:1);
  for(const [name,value] of entries){const tree=value instanceof Map,hash=tree?await hashTree(value):await gitHash('blob',value),header=new TextEncoder().encode(`${tree?'40000':'100644'} ${name}\0`),entry=new Uint8Array(header.length+20);entry.set(header);entry.set(Uint8Array.from(hash.match(/../g)!,b=>parseInt(b,16)),header.length);chunks.push(entry);size+=entry.length;}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return gitHash('tree',bytes);
 }
 return {files,tree:await hashTree(root)};
}
function encoded(bytes:Uint8Array){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
function view(b:Backup){return {connector:connectorReceipt('github','backup.commit',b,b.state,b.expires_at,b.commit_sha),id:b.id,projectId:b.project_id,versionId:b.version_id,repository:`${b.repo_owner}/${b.repo_name}`,private:!!b.repo_private,branch:b.branch,path:b.path,sha256:b.sha256,bytes:b.byte_length,files:JSON.parse(b.files_json) as string[],state:b.state==='pending'&&b.expires_at<=new Date().toISOString()?'expired':b.state,detail:b.detail,expiresAt:b.expires_at,url:b.state==='complete'&&b.commit_sha?`https://github.com/${b.repo_owner}/${b.repo_name}/tree/${b.commit_sha}/${b.path}`:null};}
async function owned(db:D1Database,userId:string,id:string){const b=await db.prepare('SELECT b.* FROM github_backups b JOIN projects p ON p.id=b.project_id WHERE b.id=? AND b.user_id=? AND p.owner_user_id=?').bind(id,userId,userId).first<Backup>();if(!b)throw new ConnectionError(404,'Backup review not found.');return b;}
export async function listBackups(db:D1Database,userId:string){const {results}=await db.prepare('SELECT b.* FROM github_backups b JOIN projects p ON p.id=b.project_id WHERE b.user_id=? AND p.owner_user_id=? ORDER BY b.created_at DESC LIMIT 100').bind(userId,userId).all<Backup>();return {backups:results.map(view)};}
export async function reviewBackup(db:D1Database,bucket:R2Bucket|undefined,userId:string,input:Record<string,unknown>,config:GitHubConfig|undefined,transport:typeof fetch=fetch){
 if(typeof input.id!=='string'||!uuid.test(input.id)||typeof input.versionId!=='string'||!uuid.test(input.versionId)||typeof input.owner!=='string'||typeof input.repo!=='string'||!validName(input.owner,input.repo)||!Number.isSafeInteger(input.repoId))throw new ConnectionError(400,'Choose a saved version and an authorized repository.');
 const requestHash=await hashToken(JSON.stringify([input.versionId,input.owner,input.repo,input.repoId]));
 const prior=await db.prepare('SELECT * FROM github_backups WHERE id=? AND user_id=?').bind(input.id,userId).first<Backup>();if(prior){if(prior.request_hash!==requestHash)throw new ConnectionError(409,'This review request ID was already used.');return view(await owned(db,userId,prior.id));}
 const version=await db.prepare('SELECT v.project_id FROM site_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=? AND p.owner_user_id=?').bind(input.versionId,userId).first<{project_id:string}>();if(!version)throw new ConnectionError(404,'Saved version not found.');
 const scope=connectionFeature(userId,'github',version.project_id,'prepare'),gate=featurePredicate(db,scope);
 const access=await githubAccess(db,userId,config,transport,{projectId:version.project_id,operation:'prepare'}),repo=await repository(access,input.owner,input.repo);if(repo.id!==input.repoId)throw new ConnectionError(409,'The repository identity changed. Select it again.');
 const archive=await ownedExport(db,userId,input.versionId,bucket);if(!archive)throw new ConnectionError(404,'Saved version not found.');
 const tree=await sourceTree(archive),baseHead=await branchHead(access,repo);
 const now=new Date().toISOString(),expires=new Date(Date.now()+600000).toISOString(),path=`whumpo/${version.project_id}/versions/${input.versionId}`;
 const sourceDigest=await digest(archive),contract=await prepareConnectorContract('github','backup.commit',{id:input.id,owner:userId,credentialId:access.tokenId,destination:{repoId:repo.id,owner:repo.owner,name:repo.name,branch:repo.branch,path},request:{versionId:input.versionId,sourceDigest,tree:tree.tree,baseHead,private:repo.private},expiresAt:expires});
 await access.assertCurrent();
 try{const inserted=await db.prepare(`INSERT INTO github_backups(id,user_id,project_id,version_id,request_hash,token_id,github_user_id,repo_id,repo_owner,repo_name,repo_private,branch,path,sha256,tree_sha,base_head,files_json,byte_length,created_at,expires_at,operation_digest,request_digest,review_digest,price_json) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${gate.sql} AND EXISTS(SELECT 1 FROM github_connections c JOIN github_token_vault t ON t.id=c.active_token_id AND t.user_id=c.user_id WHERE c.user_id=? AND t.id=? AND t.state='active' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(input.id,userId,version.project_id,input.versionId,requestHash,access.tokenId,access.githubUserId,repo.id,repo.owner,repo.name,repo.private?1:0,repo.branch,path,sourceDigest,tree.tree,baseHead,JSON.stringify(Object.keys(tree.files).sort()),archive.length,now,expires,contract.operation_digest,contract.request_digest,contract.review_digest,contract.price_json,...gate.params,userId,access.tokenId).run();if(inserted.meta.changes!==1){await assertFeature(db,scope);throw new ConnectionError(409,'Backup review changed. Prepare a new review.');}}catch(cause){const retry=await db.prepare('SELECT * FROM github_backups WHERE id=? AND user_id=? AND request_hash=?').bind(input.id,userId,requestHash).first<Backup>();if(retry)return view(await owned(db,userId,retry.id));if(String(cause).includes('github_backup_quota'))throw new ConnectionError(409,'This account reached its 100-backup review test limit.');throw cause;}
 return view(await owned(db,userId,input.id));
}
async function branchHead(access:Access,repo:Repo){
 const response=await access.send('branch.head',{owner:repo.owner,name:repo.name,branch:repo.branch});if(response.status===404||response.status===409){await response.body?.cancel();throw new ConnectionError(409,'Initialize this repository with a README on its default branch before preparing a backup.');}
 const data=await readGitHubJSON(response),object=data.object as Record<string,unknown>|undefined;if(typeof object?.sha!=='string'||!sha.test(object.sha))throw new ConnectionError(503,'GitHub returned an invalid branch head.');await access.assertCurrent();return object.sha;
}
async function remoteCopy(access:Access,repo:Repo,b:Backup,head:string){
 const response=await readGitHubJSON(await access.send('backup.paths',{},{query:backupPathsQuery,variables:backupPathsVariables(repo.owner,repo.name,b.path,head)}));
 await access.assertCurrent();
 const data=response.data as {repository?:Record<string,{__typename?:string;oid?:string}|null>}|undefined;
 if(response.errors||!data?.repository||[0,1,2,3].some(i=>!Object.hasOwn(data.repository!,'p'+i)))throw new ConnectionError(503,'GitHub could not inspect the backup destination.');
 for(let i=0;i<3;i++){const parent=data.repository['p'+i];if(parent&&parent.__typename!=='Tree')throw new ConnectionError(409,'A file occupies a parent backup path. Whumpo will not replace it.');}
 const target=data.repository.p3;if(!target)return false;
 if(target.__typename!=='Tree'||target.oid!==b.tree_sha)throw new ConnectionError(409,'Different files already occupy the version folder. Whumpo will not overwrite them.');
 return true;
}
async function completeBackup(db:D1Database,userId:string,b:Backup,commit:string){
 await db.batch([db.prepare("UPDATE github_backups SET state='complete',commit_sha=?,detail='Readable source files verified in GitHub' WHERE id=? AND user_id=? AND state IN ('dispatching','uncertain')").bind(commit,b.id,userId),db.prepare("INSERT OR IGNORE INTO activity_events(id,user_id,project_id,action,summary,created_at) SELECT ?,user_id,project_id,'github.backup','Backed up a saved website version to GitHub',? FROM github_backups WHERE id=? AND user_id=? AND state='complete'").bind('github-backup:'+b.id,new Date().toISOString(),b.id,userId)]);
 return view(await owned(db,userId,b.id));
}
export async function confirmBackup(db:D1Database,bucket:R2Bucket|undefined,userId:string,id:string,config:GitHubConfig|undefined,transport:typeof fetch=fetch,confirmation?:unknown){
 const b=await owned(db,userId,id);if(['complete','failed'].includes(b.state))return view(b);
 if(b.state==='pending')await assertConnectorConfirmation('github','backup.commit',b,confirmation);
 if(b.state==='pending'&&b.expires_at<=new Date().toISOString())throw new ConnectionError(409,'This backup review expired. Prepare a fresh review.');
 const scope=connectionFeature(userId,'github',b.project_id,'confirm'),gate=featurePredicate(db,scope),dispatchScope=connectionFeature(userId,'github',b.project_id,'dispatch'),dispatchGate=featurePredicate(db,dispatchScope);
 const access=await githubAccess(db,userId,config,transport,b.state==='pending'?{projectId:b.project_id,operation:'confirm'}:{recoveryId:b.id});if(access.githubUserId!==b.github_user_id||b.state==='pending'&&access.tokenId!==b.token_id)throw new ConnectionError(409,'The GitHub connection changed. Prepare a fresh review.');
 const repo=await repository(access,b.repo_owner,b.repo_name);
 if(repo.id!==b.repo_id||repo.private!==!!b.repo_private||repo.branch!==b.branch)throw new ConnectionError(409,'Repository identity, visibility or default branch changed. Prepare a fresh review.');
 // Rechecks are read-only after a write was dispatched, even when GitHub still reports no file.
 if(b.state!=='pending'){
  const head=await branchHead(access,repo);if(await remoteCopy(access,repo,b,head))return completeBackup(db,userId,b,head);
  await db.prepare("UPDATE github_backups SET state='uncertain',detail='No matching GitHub copy is visible yet. No write was repeated. Check again later.' WHERE id=? AND user_id=? AND state IN ('dispatching','uncertain')").bind(id,userId).run();
  return view(await owned(db,userId,id));
 }
 const archive=await ownedExport(db,userId,b.version_id,bucket);if(!archive||archive.length!==b.byte_length||await digest(archive)!==b.sha256)throw new ConnectionError(409,'The source archive changed or is unavailable. Prepare a fresh review.');
 const head=await branchHead(access,repo),existing=await remoteCopy(access,repo,b,head);
 if(!existing&&head!==b.base_head)throw new ConnectionError(409,'The repository branch changed after review. Prepare a fresh review.');
 const tree=await sourceTree(archive);
 await requireFeature(db,dispatchScope);await access.assertCurrent();
 const claimed=await db.prepare(`UPDATE github_backups SET state='dispatching',dispatched_at=? WHERE id=? AND user_id=? AND state='pending' AND expires_at>? AND operation_digest=? AND review_digest=? AND price_json=? AND ${gate.sql} AND ${dispatchGate.sql} AND EXISTS(SELECT 1 FROM github_connections c JOIN github_token_vault t ON t.id=c.active_token_id AND t.user_id=c.user_id WHERE c.user_id=github_backups.user_id AND t.id=github_backups.token_id AND t.state='active' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) RETURNING id`).bind(new Date().toISOString(),id,userId,new Date().toISOString(),b.operation_digest,b.review_digest,b.price_json,...gate.params,...dispatchGate.params).first();
 if(!claimed){await assertFeature(db,scope);await assertFeature(db,dispatchScope);return view(await owned(db,userId,id));}
 try{
  if(existing)return await completeBackup(db,userId,b,head);
  const query='mutation BackupCommit($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}';
  const input={branch:{repositoryNameWithOwner:repo.owner+'/'+repo.name,branchName:b.branch},expectedHeadOid:b.base_head,clientMutationId:b.id,message:{headline:`[skip ci] Whumpo source backup ${b.version_id}`},fileChanges:{additions:Object.entries(tree.files).map(([path,bytes])=>({path:b.path+'/'+path,contents:encoded(bytes)}))}};
  const response=await access.send('backup.commit',{},{query,variables:{input}});
  const result=await readGitHubJSON(response),data=result.data as {createCommitOnBranch?:{commit?:{oid?:string}}}|undefined,commit=data?.createCommitOnBranch?.commit?.oid;
  if(result.errors||typeof commit!=='string'||!sha.test(commit))throw new ConnectionError(503,'The GitHub commit response could not be verified.');
  if(!await remoteCopy(access,repo,b,commit))throw new ConnectionError(503,'The committed source files could not be verified.');
  return await completeBackup(db,userId,b,commit);
 }catch(cause){
  const saved=await owned(db,userId,id);if(saved.state==='complete')return view(saved);
  await db.prepare("UPDATE github_backups SET state='uncertain',detail='The GitHub outcome needs checking. Checking again only reads GitHub; it never repeats the write.' WHERE id=? AND user_id=? AND state='dispatching'").bind(id,userId).run();
  if(cause instanceof ConnectionError&&cause.status===409)await db.prepare("UPDATE github_backups SET state='failed',detail=? WHERE id=? AND user_id=? AND state='uncertain'").bind(cause.message,id,userId).run();
  return view(await owned(db,userId,id));
 }
}
