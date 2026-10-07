import {taskListSource} from './backend-task-list';
import {requireArtifactsAvailable} from './artifact-admission';
import {BackendError,listBackends} from './backend-versions';
import {hashToken} from './security';
/** Platform-authored source only. Never populate this catalog from tenant artifacts. */
type Installation={project_id:string;digest:string;component_id:string;component_version:number};
const entries=[{
 id:'line-total',artifactDigest:'2f716d8f44e680e8f62b0ce36a6ad1feef1ffcd04148c22034c00670c3ed9f4b',version:1,title:'Line-item total',description:'Total up to 50 integer-cent line items. No tax, discount, currency conversion or payment processing.',
 source:`export default input => {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='items')||!Array.isArray(input.items)||input.items.length>50) throw Error('Provide up to 50 items');
 let totalCents=0;
 for(const item of input.items){
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['unitCents','quantity'].includes(k))||!Number.isSafeInteger(item.unitCents)||item.unitCents<0||item.unitCents>100000000||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>1000) throw Error('Invalid line item');
  totalCents+=item.unitCents*item.quantity;
 }
 return {totalCents};
};`,
 example:{input:{items:[{unitCents:1250,quantity:2},{unitCents:300,quantity:1}]},expected:{totalCents:2800}}
},{
 id:'text-statistics',artifactDigest:'f4cf73a5a6a7d36b75f5a8875c4a83d7f6bf676718e002160263c77c67ac5db5',version:1,title:'Text statistics',description:'Count Unicode code points, whitespace-delimited words and lines in up to 2,400 characters. This is not language-aware word segmentation.',
 source:`export default input => {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='text')||typeof input.text!=='string'||input.text.length>2400) throw Error('Provide text up to 2400 characters');
 const text=input.text;
 return {characters:Array.from(text).length,words:text.trim()?text.trim().split(/\\s+/u).length:0,lines:text?text.split(/\\r\\n|\\r|\\n/u).length:0};
};`,
 example:{input:{text:'Hello world\nNew idea'},expected:{characters:20,words:4,lines:2}}
},{
 id:'private-task-list',artifactDigest:'d123cb3f7d4bdaf5459ffc17ae75da077cd5299e756d52acd43624ff041d1eea',version:1,title:'Private task list',description:'A reusable per-visitor task document: add, list, complete, reopen and remove up to 12 tasks of 80 characters. Requires separate reviewed application authority and a visitor page.',usage:'application-transition',
 source:taskListSource,
 example:{input:{state:{},input:{action:'add',text:'Plan the first page'}},expected:{state:{nextId:2,items:[{id:1,text:'Plan the first page',done:false}]},result:{items:[{id:1,text:'Plan the first page',done:false}]}}}
}] as const;
export const backendLibrary=entries.map(entry=>({...entry,reference:entry.id+'@'+entry.version,provenance:'Whumpo platform-authored',license:'MIT',runtime:'bounded-quickjs-v1',verification:'tests/backend-library.mjs (automated synthetic checks)',capabilities:[] as string[],dependencies:[] as string[],state:'available' as 'available'|'withdrawn'}));
export async function readBackendComponent(reference:string){
 const entry=backendLibrary.find(e=>e.reference===reference);if(!entry)throw new BackendError(404,"Choose an exact component version from the maintained backend library.");
 const digest=await hashToken(entry.source);if(digest!==entry.artifactDigest)throw new BackendError(503,'Component integrity check failed');return {...entry,digest};
}
export function describeBackendLibrary(){return 'Reusable backend helpers\n'+backendLibrary.filter(e=>e.state==='available').map(e=>`${e.reference} — ${e.title}\n${e.description}`).join('\n\n')+"\n\nPlatform-authored code with synthetic examples only. Ask to inspect a library component and its test example, or copy an exact component version into a private untested project version. Existing sign-in and visitor access use Whumpo’s shared authentication; these helpers never handle credentials.";}
export async function describeBackendComponent(reference:string){const e=await readBackendComponent(reference);return `${e.title} (${e.reference})\n${e.description}\nSource: ${e.provenance} · ${e.license}\nRuntime: ${e.runtime}; no network, secrets, authentication or storage access.\nSHA-256: ${e.digest}\nStatus: ${e.state}\n${'usage' in e&&e.usage==='application-transition'?'Application transition: receives {state,input} and returns {state,result}. Whumpo supplies the isolated visitor document only after owner review; this code has no direct storage access.\n':''}Synthetic check: ${JSON.stringify(e.example)}\n\n${e.source}`;}
export async function installBackendComponent(db:D1Database,user:string,project:string,id:string,reference:string){
 await listBackends(db,user,project);
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id))throw new BackendError(400,'Provide a request UUID');
 const entry=await readBackendComponent(reference);
 const previous=await db.prepare('SELECT v.project_id,v.digest,c.component_id,c.component_version FROM backend_versions v LEFT JOIN backend_component_instances c ON c.version_id=v.id WHERE v.id=?').bind(id).first<Installation>();
 if(previous){if(previous.project_id!==project||previous.digest!==entry.digest||previous.component_id!==entry.id||previous.component_version!==entry.version)throw new BackendError(409,'This request belongs to another backend version');}
 else{
  if(entry.state!=='available')throw new BackendError(409,'This component was withdrawn. Choose another available version.');
  await requireArtifactsAvailable(db,user,[entry.digest]);
  try{await db.batch([
   db.prepare('INSERT INTO backend_versions(id,project_id,source,digest,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_user_id=?)').bind(id,project,entry.source,entry.digest,new Date().toISOString(),project,user),
   db.prepare('INSERT INTO backend_component_instances(version_id,component_id,component_version,artifact_digest,provenance,license) VALUES(?,?,?,?,?,?)').bind(id,entry.id,entry.version,entry.digest,entry.provenance,entry.license)
  ]);}catch{
   const saved=await db.prepare('SELECT v.project_id,v.digest,c.component_id,c.component_version FROM backend_versions v JOIN backend_component_instances c ON c.version_id=v.id WHERE v.id=?').bind(id).first<Installation>();
   if(!saved||saved.project_id!==project||saved.digest!==entry.digest||saved.component_id!==entry.id||saved.component_version!==entry.version)throw new BackendError(409,'The component copy could not be confirmed. Inspect saved backend versions before making a replacement.');
  }
 }
 return `Copied ${entry.reference} into an untested private backend version.\nVersion: ${id}\nProject: ${project}\nSHA-256: ${entry.digest}\nAsk to inspect this saved source and run its synthetic check.\nSynthetic check: ${JSON.stringify(entry.example)}\nNo model call, execution, activation or publication was performed. Customize this private copy after inspecting it; changes never update the shared library.`;
}
export function backendLibraryCommand(db:D1Database,user:string,id:string,content:string){
 const parts=content.trim().split(/\s+/),verb=parts[0].toLowerCase();if(!['/backend-library','/backend-component','/use-backend'].includes(verb))return;
 return async()=>{try{
  if(verb==='/backend-library'&&parts.length===1)return describeBackendLibrary();
  if(verb==='/backend-component'&&parts.length===2)return await describeBackendComponent(parts[1]);
  if(verb==='/use-backend'&&parts.length===3)return await installBackendComponent(db,user,parts[1],id,parts[2]);
  throw new BackendError(400,"Choose a backend library component to inspect, or a project and exact component version to copy.");
 }catch(error){return error instanceof BackendError?error.message:'The library request could not finish. Inspect saved versions before preparing a replacement.';}};
}
