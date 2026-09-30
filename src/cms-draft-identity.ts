import {cmsRichDraftBody,validCMSDraft,cmsItemId} from './cms-content-shape';
import {signCMSRequest,type CMSBridgeConfig} from './cms-bridge';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export const identifiedDraftPath=/^\/_emdash\/api\/content\/(posts|pages)$/;
const slug=(id:string)=>'whumpo-draft-'+id;
/** Only internal dispatch authentication uses this. Public bridge admission stays unchanged. */
export function nativeDraftIdentityAllowed(method:string,path:string,body:string,id:string){
 if(!uuid.test(id))return false;
 if(method==='GET'&&body===''&&['posts','pages'].some(c=>path==='/_emdash/api/content/'+c+'/'+slug(id)))return true;
 if(method!=='POST'||!identifiedDraftPath.test(path))return false;
 try{const v=JSON.parse(body);return v.slug===slug(id)&&body===JSON.stringify({...cmsRichDraftBody(v.data?.title,v.data?.content,v.data?.excerpt),slug:slug(id)})&&(path.endsWith('/posts')||v.data?.excerpt===undefined);}catch{return false;}
}
export async function identityRequest(config:CMSBridgeConfig,path:string,id:string,body?:string){
 const request=await signCMSRequest(config,path,id,body===undefined?undefined:{...JSON.parse(body),slug:slug(id)});
 request.headers.set('origin',config.origin);request.headers.set('x-emdash-request','1');return request;
}
export async function ensureDraftIdentities(db:D1Database){
 await db.prepare('CREATE TABLE IF NOT EXISTS _townhello_draft_identities(request_id TEXT PRIMARY KEY REFERENCES _townhello_requests(id),collection TEXT NOT NULL CHECK(collection IN (\'posts\',\'pages\')),slug TEXT NOT NULL UNIQUE)').run();
}
/** Both inserts commit together; a lost batch acknowledgement never authorizes dispatch. */
export async function reserveIdentifiedDraft(db:D1Database,id:string,hash:string,collection:string){
 const results=await db.batch([
  db.prepare('INSERT INTO _townhello_requests(id,request_hash) SELECT ?,? WHERE (SELECT count(*) FROM _townhello_requests)<100').bind(id,hash),
  db.prepare('INSERT INTO _townhello_draft_identities(request_id,collection,slug) SELECT id,?,? FROM _townhello_requests WHERE id=? AND request_hash=? AND status IS NULL').bind(collection,slug(id),id,hash),
 ]);return results[0].meta.changes===1&&results[1].meta.changes===1;
}
function sameData(actual:unknown,expected:unknown):boolean{
 if(actual===null||expected===null||typeof actual!=='object'||typeof expected!=='object')return actual===expected;
 if(Array.isArray(actual)||Array.isArray(expected))return Array.isArray(actual)&&Array.isArray(expected)&&actual.length===expected.length&&actual.every((v,i)=>sameData(v,expected[i]));
 const a=actual as Record<string,unknown>,e=expected as Record<string,unknown>,keys=Object.keys(e);return Object.keys(a).length===keys.length&&keys.every(k=>Object.hasOwn(a,k)&&sameData(a[k],e[k]));
}
export function matchesIdentifiedDraft(payload:any,body:string,id:string){
 if(!validCMSDraft(body))return false;
 const item=payload?.data?.item,expected=JSON.parse(body).data;
 return payload?.success===true&&cmsItemId.test(item?.id??'')&&item.status==='draft'&&item.version===1&&!item.deletedAt&&!item.draftRevisionId&&!item.liveRevisionId&&!item.publishedAt&&!item.scheduledAt&&item.slug===slug(id)&&typeof payload.data._rev==='string'&&/^[A-Za-z0-9+/=_-]{4,256}$/.test(payload.data._rev)&&item.data?.title===expected.title&&sameData(item.data?.content,expected.content)&&(expected.excerpt===undefined?(item.data?.excerpt===undefined||item.data?.excerpt===null||item.data?.excerpt===''):item.data?.excerpt===expected.excerpt);
}
async function boundedJSON(response:Response){
 if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json')){await response.body?.cancel();return null;}
 const reader=response.body?.getReader();if(!reader)return null;const parts:Uint8Array[]=[];let size=0;
 for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>65536){await reader.cancel();return null;}parts.push(r.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);
}
/** Reconciliation only reads an identity reserved before dispatch; it never repeats POST. */
export async function recoverIdentifiedDraft(db:D1Database,config:CMSBridgeConfig,id:string,hash:string,path:string,body:string,dispatch:(request:Request)=>Promise<Response>){
 const collection=identifiedDraftPath.exec(path)?.[1];if(!collection||!validCMSDraft(body))return;
 const identity=await db.prepare('SELECT collection,slug FROM _townhello_draft_identities WHERE request_id=?').bind(id).first<{collection:string;slug:string}>();
 if(!identity||identity.collection!==collection||identity.slug!==slug(id))return;
 try{const text=await boundedJSON(await dispatch(await identityRequest(config,path+'/'+identity.slug,id)));if(text&&matchesIdentifiedDraft(JSON.parse(text),body,id))await db.prepare('UPDATE _townhello_requests SET status=201,response=? WHERE id=? AND request_hash=? AND status IS NULL').bind(text,id,hash).run();}catch{/* Missing, changed or unavailable drafts remain unresolved. */}
}
