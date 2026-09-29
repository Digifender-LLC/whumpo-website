import {hashToken} from './security';
import {callCMS,verifyCMSInitialization,type CMSBridgeConfig} from './cms-bridge';
type Deployment={project_id:string;account_id:string;source_digest:string;secret_digest:string;origin:string;tag:string;state:string;worker_version_id:string|null};
export type CMSDeploymentProvider={accountId:string;exists(name:string):Promise<boolean>;deploy(name:string,tag:string):Promise<void>;activeVersion(name:string,tag:string):Promise<string|null>;service:Fetcher};
export async function deployCMS(db:D1Database,project:string,sourceDigest:string,config:CMSBridgeConfig,provider:CMSDeploymentProvider){
 const row=await db.prepare("SELECT c.*,r.title,r.tagline FROM cms_instances c JOIN cms_setup_reviews r ON r.id=c.review_id JOIN projects p ON p.id=c.project_id WHERE c.project_id=? AND c.user_id=? AND p.owner_user_id=c.user_id AND r.status='approved'").bind(project,config.ownerId).first<{worker_name:string;review_id:string;title:string;tagline:string}>();
 if(!row||config.projectId!==project||config.origin!=='https://'+row.worker_name+'.digifender.com'||!/^[0-9a-f]{64}$/.test(sourceDigest))throw new Error('Invalid approved CMS deployment');
 const secretDigest=await hashToken(config.secret),tag='cms-'+(await hashToken(JSON.stringify([project,sourceDigest,secretDigest,config.origin]))).slice(0,32);
 const read=()=>db.prepare('SELECT * FROM cms_deployments WHERE project_id=?').bind(project).first<Deployment>();
 let record=await read(),dispatch=false;
 if(!record){
  if(await provider.exists(row.worker_name))throw new Error('CMS Worker already exists without a deployment intent');
  try{const inserted=await db.prepare('INSERT INTO cms_deployments(project_id,account_id,source_digest,secret_digest,origin,tag) VALUES(?,?,?,?,?,?)').bind(project,provider.accountId,sourceDigest,secretDigest,config.origin,tag).run();dispatch=inserted.meta.changes===1;}catch{/* Lost or competing reservations only reconcile. */}
  record=await read();if(!record)throw new Error('CMS deployment reservation unavailable');
 }
 if(record.account_id!==provider.accountId||record.source_digest!==sourceDigest||record.secret_digest!==secretDigest||record.origin!==config.origin||record.tag!==tag)throw new Error('CMS deployment inputs changed; use the recorded artifact and signing key');
 if(dispatch){try{await provider.deploy(row.worker_name,tag);}catch{/* Inspect active deployment; do not blindly upload again. */}}
 const version=await provider.activeVersion(row.worker_name,tag);
 if(!version||!/^[0-9a-f-]{36}$/.test(version))throw new Error('CMS deployment outcome is unresolved');
 if(record.worker_version_id&&record.worker_version_id!==version)throw new Error('CMS Worker version changed after the deployment receipt');
 if(record.state==='reserved'){
  try{await db.prepare("UPDATE cms_deployments SET state='uploaded',worker_version_id=? WHERE project_id=? AND state='reserved'").bind(version,project).run();}catch{}
  record=await read();if(record?.worker_version_id!==version)throw new Error('CMS deployment receipt unavailable');
 }
 const previouslyVerified=record.state==='verified';
 if(record.state==='uploaded'){
  // The setup idempotency key is the user's immutable approval review, never a new retry UUID.
  const status=await callCMS(provider.service,config,'/_emdash/api/setup/status',crypto.randomUUID());
  if(typeof status?.needsSetup!=='boolean')throw new Error('Invalid CMS setup status');
  await callCMS(provider.service,config,'/_emdash/api/setup',row.review_id,{title:row.title,tagline:row.tagline,includeContent:false});
  await verifyCMSInitialization(provider.service,config);
  try{await db.prepare("UPDATE cms_deployments SET state='verified' WHERE project_id=? AND state='uploaded'").bind(project).run();}catch{}
  record=await read();if(!record||!['verified','connected'].includes(record.state))throw new Error('CMS initialization receipt unavailable');
 }
 if(previouslyVerified||record.state==='connected')await verifyCMSInitialization(provider.service,config);
 return {projectId:project,state:record.state,workerVersion:version};
}
export async function connectCMS(db:D1Database,project:string,platformVersion:string){
 if(!/^[0-9a-f-]{36}$/.test(platformVersion))throw new Error('Invalid platform deployment receipt');
 try{await db.prepare("UPDATE cms_deployments SET state='connected',platform_version_id=? WHERE project_id=? AND state='verified'").bind(platformVersion,project).run();}catch{}
 const row=await db.prepare("SELECT state,platform_version_id FROM cms_deployments WHERE project_id=?").bind(project).first<{state:string;platform_version_id:string}>();
 if(row?.state!=='connected')throw new Error('CMS platform connection was not recorded');return row;
}
