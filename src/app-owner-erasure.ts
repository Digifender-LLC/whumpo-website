import {BackendError} from './backend-versions';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
/** Owner-only sensitive control, never an agent tool. HTTP boundary requires recent sign-in. */
export async function eraseRevokedVisitor(db:D1Database,user:string,project:string,visitor:string,input:Record<string,unknown>){
 if(!uuid.test(project)||!uuid.test(visitor)||typeof input.id!=='string'||!uuid.test(input.id)||input.confirmation!=='ERASE'||Object.keys(input).length!==2)throw new BackendError(400,'Choose the revoked visitor and type ERASE to confirm');
 const owner=await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first();
 if(!owner)throw new BackendError(404,'Project not found');
 const receipt=()=>db.prepare('SELECT id,user_id,project_id,visitor_id FROM app_owner_erasures WHERE id=?').bind(input.id).first<{id:string;user_id:string;project_id:string;visitor_id:string}>();
 const reply=(row:Awaited<ReturnType<typeof receipt>>)=>{
  if(!row)return null;
  if(row.user_id!==user||row.project_id!==project||row.visitor_id!==visitor)throw new BackendError(409,'Erasure request ID already used');
  return {erased:true,receiptId:row.id,projectId:project,visitorId:visitor};
 };
 const old=reply(await receipt());if(old)return old;
 const target=await db.prepare('SELECT revoked FROM app_visitors WHERE id=? AND project_id=?').bind(visitor,project).first<{revoked:number}>();
 if(!target){const raced=reply(await receipt());if(raced)return raced;throw new BackendError(404,'Visitor not found');}
 if(target.revoked!==1)throw new BackendError(409,'Revoke access before erasing this visitor');
 try{await db.prepare('INSERT INTO app_owner_erasures(id,user_id,project_id,visitor_id) VALUES(?,?,?,?)').bind(input.id,user,project,visitor).run();}
 catch{const recovered=reply(await receipt());if(recovered)return recovered;throw new BackendError(409,'Erasure was not confirmed. Retry the same request; the visitor or application may have changed, or receipt storage is full');}
 const saved=reply(await receipt());if(!saved)throw new BackendError(503,'Erasure result is unavailable. Retry this same request');return saved;
}
