import {assertWorkspace} from '../workspace-identity/admission';
import {assertFeature} from '../feature-admission';
import {listPhotos} from '../files';
import type {ResourceCursor,ResourceOption} from './resource-shape';
import {resourceCursor} from './resource-shape';
import {InteractionError} from './protocol';

/** Trusted domain adapter. An issuing adapter must separately admit its form,
 * scoped project, answers and lifecycle; this reader cannot issue or submit it. */
export async function readOwnedResourceOptions(db:D1Database,user:string,collection:'projects'|'photos',projectId:string|null,before:ResourceCursor|null,limit:number){
 await assertWorkspace(db,user);
 if(!['projects','photos'].includes(collection)||!Number.isSafeInteger(limit)||limit<1||limit>20||before!==null&&!resourceCursor(before)||collection==='projects'&&projectId!==null||collection==='photos'&&(!projectId||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(projectId)))throw new InteractionError('SHAPE');
 const gate={userId:user,projectId,featureId:'core.editing' as const,operation:'read' as const};
 await assertFeature(db,gate);
 async function read():Promise<ResourceOption[]>{
  if(collection==='projects'){
   const {results}=await db.prepare('SELECT id,name FROM projects WHERE owner_user_id=? AND (? IS NULL OR name>? OR (name=? AND id>?)) ORDER BY name,id LIMIT ?').bind(user,before?.name??null,before?.name??null,before?.name??null,before?.id??null,limit+1).all<ResourceCursor>();
   return results.map(p=>({...p,photo:null}));
  }
  // Reuse the owned inventory's existing clearance predicate, with no image read.
  const {files}=await listPhotos(db,user,projectId!);
  return (files as unknown as {id:string;name:string;status:string;safetyStatus:string;width:number;height:number;size:number}[])
   .filter(f=>f.status==='ready'&&f.safetyStatus==='approved')
   .sort((a,b)=>compare(a.name,b.name)||compare(a.id,b.id))
   .filter(f=>!before||compare(f.name,before.name)>0||f.name===before.name&&compare(f.id,before.id)>0)
   .slice(0,limit+1).map(f=>({id:f.id,name:f.name,photo:{width:f.width,height:f.height,size:f.size}}));
 }
 const first=await read(),current=await read();
 // Refuse a mixed snapshot if ownership, names, metadata or safety changed.
 if(JSON.stringify(first)!==JSON.stringify(current))throw new InteractionError('REFERENCE');
 await assertWorkspace(db,user);await assertFeature(db,gate);
 const items=current.slice(0,limit),last=items.at(-1);
 return {items,nextBefore:current.length>limit&&last?{id:last.id,name:last.name}:null};
}
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
