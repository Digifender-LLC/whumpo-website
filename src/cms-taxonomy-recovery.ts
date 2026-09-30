import {cmsTaxonomyRequestAllowed} from './cms-taxonomy-shape';
import {cmsItemId} from './cms-content-shape';
import {signCMSRequest,type CMSBridgeConfig} from './cms-bridge';
import {boundedCMSJSON} from './cms-draft-identity';
type TaxonomyIntent={kind:'definition'|'term';name:string;readPath:string;body:Record<string,unknown>};
export function taxonomyIntent(path:string,body:string):TaxonomyIntent|null{
 if(!cmsTaxonomyRequestAllowed('POST',path,body))return null;
 const value=JSON.parse(body);
 if(path==='/_emdash/api/taxonomies')return {kind:'definition',name:value.name,readPath:path+'/'+value.name,body:value};
 const name=/^\/_emdash\/api\/taxonomies\/(categories|tags)\/terms$/.exec(path)?.[1];
 return name?{kind:'term',name,readPath:path+'/'+value.slug,body:value}:null;
}
export function matchesTaxonomyIntent(payload:any,intent:TaxonomyIntent){
 if(payload?.success!==true)return false;
 const item=intent.kind==='definition'?payload.data?.taxonomy:payload.data?.term;
 if(!cmsItemId.test(item?.id??'')||item.name!==intent.name||item.locale!=='en'||item.label!==intent.body.label)return false;
 if(intent.kind==='definition')return item.labelSingular===intent.body.labelSingular&&item.hierarchical===intent.body.hierarchical&&Array.isArray(item.collections)&&item.collections.length===1&&item.collections[0]==='posts';
 return item.slug===intent.body.slug&&item.parentId==null&&(item.description===undefined||item.description===null||item.description==='');
}
export async function ensureTaxonomyIntents(db:D1Database){
 await db.prepare('CREATE TABLE IF NOT EXISTS _whumpo_taxonomy_intents(request_id TEXT PRIMARY KEY REFERENCES _whumpo_requests(id),read_path TEXT NOT NULL)').run();
}
export async function reserveTaxonomyIntent(db:D1Database,id:string,hash:string,intent:TaxonomyIntent){
 const results=await db.batch([
  db.prepare('INSERT INTO _whumpo_requests(id,request_hash) SELECT ?,? WHERE (SELECT count(*) FROM _whumpo_requests)<100').bind(id,hash),
  db.prepare('INSERT INTO _whumpo_taxonomy_intents(request_id,read_path) SELECT id,? FROM _whumpo_requests WHERE id=? AND request_hash=? AND status IS NULL').bind(intent.readPath,id,hash),
 ]);return results[0].meta.changes===1&&results[1].meta.changes===1;
}
/** Verifies the requested state exists; never retries creation or overwrites a native term. */
export async function recoverTaxonomyIntent(db:D1Database,config:CMSBridgeConfig,id:string,hash:string,intent:TaxonomyIntent,dispatch:(request:Request)=>Promise<Response>){
 const saved=await db.prepare('SELECT read_path FROM _whumpo_taxonomy_intents WHERE request_id=?').bind(id).first<{read_path:string}>();
 if(saved?.read_path!==intent.readPath)return;
 try{
  const request=await signCMSRequest(config,intent.readPath,id);request.headers.set('origin',config.origin);request.headers.set('x-emdash-request','1');
  const text=await boundedCMSJSON(await dispatch(request));if(!text)return;const result=JSON.parse(text);
  if(!matchesTaxonomyIntent(result,intent))return;
  // A matching existing object fulfills the intent; do not claim this attempt created it.
  const response=JSON.stringify({...result,data:{...result.data,reconciled:true}});if(new TextEncoder().encode(response).length>65536)return;
  await db.prepare('UPDATE _whumpo_requests SET status=200,response=? WHERE id=? AND request_hash=? AND status IS NULL').bind(response,id,hash).run();
 }catch{/* Keep uncertain/missing/changed state unresolved for the same request. */}
}
