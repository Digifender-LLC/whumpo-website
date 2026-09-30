import {callCMS} from './cms-bridge';
import {cmsConnection} from './cms-status';
import {cmsCapabilitiesPath,supportsCMSImportTaxonomies} from './cms-capability-contract';
import {cmsTaxonomyDefinition,cmsTaxonomyTerm} from './cms-taxonomy-shape';
import {matchesTaxonomyIntent,taxonomyIntent} from './cms-taxonomy-recovery';
import {initialTaxonomies,initialTaxonomyPath} from './cms-initial-taxonomy-shape';
import {importTaxonomyPlan} from './cms-import-taxonomy-plan';
import {cmsItemId} from './cms-content-shape';
import {CMSProjectError} from './cms-error';
type Job={body:string;state:'prepared'|'applied'};
export async function requireCMSImportTaxonomies(db:D1Database,user:string,project:string,env:Record<string,unknown>){
 const {service,config}=await cmsConnection(db,user,project,env);let ready=false;
 try{ready=supportsCMSImportTaxonomies(await callCMS(service,config,cmsCapabilitiesPath,crypto.randomUUID()));}catch{}
 if(!ready)throw new CMSProjectError(409,'Importing categories and tags requires an updated publishing space. No new import was started.');
}
/** Stable, purpose-separated native receipt IDs; never a customer-supplied URL or ID. */
export async function importStepId(review:string,step:string){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['whumpo-import-taxonomy-v1',review,step]))));
 bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const h=Array.from(bytes.slice(0,16),v=>v.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
/** Only confirmCMSImport calls this, after immutable owner approval and capacity reservation. */
export async function completeMappedCMSImport(db:D1Database,user:string,id:string,env:Record<string,unknown>){
 const row=await db.prepare("SELECT r.* FROM cms_import_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.user_id=? AND p.owner_user_id=? AND r.status IN ('approved','imported') AND r.taxonomy_plan<>'[]'").bind(id,user,user).first<{project_id:string;body:string;taxonomy_plan:string;status:string}>();
 if(!row)throw new CMSProjectError(404,'An approved mapped import was not found');if(row.status==='imported')return;
 const {service,config}=await cmsConnection(db,user,row.project_id,env);await requireCMSImportTaxonomies(db,user,row.project_id,env);
 const read=()=>db.prepare('SELECT body,state FROM cms_import_taxonomy_jobs WHERE review_id=?').bind(id).first<Job>();
 let job=await read();
 try{
  if(!job){
   const terms=importTaxonomyPlan(JSON.parse(row.taxonomy_plan)),nativeTerms=[];
   const ensure=async(path:string,body:unknown,step:string)=>{
    const requestId=await importStepId(id,step),intent=taxonomyIntent(path,JSON.stringify(body));if(!intent)throw Error('Invalid import term intent');
    let result;
    try{result=await callCMS(service,config,path,requestId,body);}catch{
     // Same ID retry only: the native gateway reconciles uncertain/existing state by GET.
     result=await callCMS(service,config,path,requestId,body);
    }
    if(!matchesTaxonomyIntent({success:true,data:result},intent))throw Error('Native taxonomy differs from review');
    return result;
   };
   for(const name of new Set(terms.map(t=>t.taxonomy)))await ensure('/_emdash/api/taxonomies',cmsTaxonomyDefinition(name),'definition:'+name);
   for(const term of terms){const result=await ensure('/_emdash/api/taxonomies/'+term.taxonomy+'/terms',cmsTaxonomyTerm(term.slug,term.label),'term:'+term.taxonomy+':'+term.slug);nativeTerms.push({...term,id:result.term.id});}
   const draft=await callCMS(service,config,'/_emdash/api/content/posts',id,JSON.parse(row.body));
   if(!cmsItemId.test(draft?.item?.id??'')||draft.item.status!=='draft')throw Error('Invalid imported draft receipt');
   const body=JSON.stringify(initialTaxonomies({draftRequestId:id,itemId:draft.item.id,terms:nativeTerms}));
   try{await db.prepare('INSERT INTO cms_import_taxonomy_jobs(review_id,body) VALUES(?,?)').bind(id,body).run();}catch{/* Reconcile concurrent reservation or a lost commit acknowledgement. */}
   job=await read();if(!job||job.body!==body)throw Error('Import mapping reservation unavailable');
  }
  const body=initialTaxonomies(JSON.parse(job.body));
  if(job.state==='prepared'){
   const result=await callCMS(service,config,initialTaxonomyPath,await importStepId(id,'assign'),body);
   if(result?.version!==2||result.itemId!==body.itemId||result.draftRequestId!==id||JSON.stringify(result.terms)!==JSON.stringify(body.terms))throw Error('Import mapping receipt differs');
   // Visibility and completion commit together, after the native receipt is confirmed.
   await db.batch([
    db.prepare("UPDATE cms_import_taxonomy_jobs SET state='applied' WHERE review_id=? AND state='prepared'").bind(id),
    db.prepare('UPDATE cms_draft_requests SET item_id=? WHERE id=? AND item_id IS NULL').bind(body.itemId,id),
    db.prepare("UPDATE cms_import_reviews SET status='imported' WHERE id=? AND status='approved'").bind(id),
   ]);
  }
 }catch{
  const done=await db.prepare("SELECT id FROM cms_import_reviews WHERE id=? AND user_id=? AND status='imported'").bind(id,user).first();if(done)return;
  throw new CMSProjectError(503,'This import is saved but unfinished. Retry the same import review to recover it; do not start another import. No partial draft is available for editing or publication.');
 }
}
