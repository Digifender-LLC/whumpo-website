export type CMSResourceKind='database'|'media'|'session';
export type CMSProvider={accountId:string;find(kind:CMSResourceKind,name:string):Promise<string|null>;create(kind:CMSResourceKind,name:string):Promise<void>};
type Job={account_id:string;resource_name:string;state:string;provider_id:string|null};
export async function allocateCMSResources(db:D1Database,project:string,provider:CMSProvider){
 if(!/^[0-9a-f-]{36}$/.test(project)||!/^[0-9a-f]{32}$/.test(provider.accountId))throw new Error('Invalid CMS provisioning target');
 const instance=await db.prepare("SELECT c.* FROM cms_instances c JOIN cms_setup_reviews r ON r.id=c.review_id JOIN projects p ON p.id=c.project_id WHERE c.project_id=? AND r.status='approved' AND p.owner_user_id=c.user_id").bind(project).first<{project_id:string;worker_name:string;database_name:string;bucket_name:string;state:string}>();
 if(!instance)throw new Error('CMS setup is not approved');
 if(instance.state==='ready')throw new Error('CMS is already ready; use an upgrade workflow');
 await db.prepare("UPDATE cms_instances SET state='provisioning' WHERE project_id=? AND state<>'ready'").bind(project).run();
 const resources:Record<CMSResourceKind,string>={database:instance.database_name,media:instance.bucket_name,session:instance.worker_name+'-session'};
 try{
  for(const kind of ['database','media','session'] as const){
   const name=resources[kind],read=()=>db.prepare('SELECT * FROM cms_resource_jobs WHERE project_id=? AND kind=?').bind(project,kind).first<Job>();
   let job=await read(),dispatch=false;
   if(!job){
    // Never adopt an unrelated pre-existing resource just because its name matches.
    if(await provider.find(kind,name)!==null)throw new Error('CMS resource name already exists without a recorded creation intent');
    try{const result=await db.prepare('INSERT INTO cms_resource_jobs(project_id,kind,account_id,resource_name) VALUES(?,?,?,?)').bind(project,kind,provider.accountId,name).run();dispatch=result.meta.changes===1;}catch{/* A competing or acknowledged-lost reservation must only reconcile. */}
    job=await read();if(!job)throw new Error('CMS resource reservation unavailable');
   }
   if(job.account_id!==provider.accountId||job.resource_name!==name)throw new Error('CMS resource account or identity changed');
   if(dispatch){try{await provider.create(kind,name);}catch{/* Inspect the provider after any uncertain response, never resend creation. */}}
   const found=await provider.find(kind,name);
   if(found===null)throw new Error('CMS resource creation is unresolved; reconcile before any further allocation');
   if(kind==='database'&&!/^[0-9a-f-]{36}$/.test(found)||kind==='session'&&!/^[0-9a-f]{32}$/.test(found)||kind==='media'&&found!==name)throw new Error('CMS provider returned an invalid resource identity');
   if(job.state==='complete'){if(job.provider_id!==found)throw new Error('CMS resource was replaced or mismatched');continue;}
   try{await db.prepare("UPDATE cms_resource_jobs SET state='complete',provider_id=? WHERE project_id=? AND kind=? AND state='pending'").bind(found,project,kind).run();}catch{/* Recover a committed resource receipt. */}
   const saved=await read();if(saved?.state!=='complete'||saved.provider_id!==found)throw new Error('CMS resource receipt could not be verified');
  }
  await db.prepare("UPDATE cms_instances SET state='provisioning' WHERE project_id=? AND state<>'ready'").bind(project).run();
  return {projectId:project,state:'provisioning',resources:(await db.prepare('SELECT kind,resource_name,provider_id FROM cms_resource_jobs WHERE project_id=? ORDER BY kind').bind(project).all()).results};
 }catch(error){await db.prepare("UPDATE cms_instances SET state='uncertain' WHERE project_id=? AND state<>'ready'").bind(project).run();throw error;}
}
