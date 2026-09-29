import {BillingError} from './billing';
export async function readProjectDetails(db:D1Database,user:string,project:string){
 const row=await db.prepare('SELECT id,name,purpose,details_revision AS revision FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first<{id:string;name:string;purpose:string;revision:number}>();
 if(!row)throw new BillingError(404,'Project not found');return row;
}
export async function saveProjectDetails(db:D1Database,user:string,project:string,value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new BillingError(400,'Provide project details');
 const data=value as Record<string,unknown>;
 if(Object.keys(data).some(k=>!['revision','name','purpose'].includes(k))||!Number.isSafeInteger(data.revision)||Number(data.revision)<0||typeof data.name!=='string'||!data.name.trim()||data.name.trim().length>100||typeof data.purpose!=='string'||data.purpose.trim().length>1000||/[\x00-\x1f\x7f]/.test(data.name))throw new BillingError(400,'Choose a name up to 100 characters and a description up to 1,000 characters');
 const before=await readProjectDetails(db,user,project);
 if(before.revision!==data.revision)throw new BillingError(409,'Project details changed. Read the latest details before saving again.');
 const row=await db.prepare('UPDATE projects SET name=?,purpose=? WHERE id=? AND owner_user_id=? AND details_revision=? RETURNING id,name,purpose,details_revision AS revision').bind(data.name.trim(),data.purpose.trim(),project,user,data.revision).first<{id:string;name:string;purpose:string;revision:number}>();
 if(!row)throw new BillingError(409,'Project details changed. Read the latest details before saving again.');
 return {...row,revision:row.revision+(before.name!==row.name||before.purpose!==row.purpose?1:0)};
}
