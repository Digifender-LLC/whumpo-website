import {BillingError} from './billing';
export type ProjectDetails = {id:string;name:string;purpose:string;audience:string;style_notes:string;preferred_theme:string;revision:number};
const fields = ['name','purpose','audience','style_notes','preferred_theme'] as const;
const columns = 'id,name,purpose,audience,style_notes,preferred_theme,details_revision AS revision';
export async function readProjectDetails(db:D1Database,user:string,project:string){
 const row=await db.prepare(`SELECT ${columns} FROM projects WHERE id=? AND owner_user_id=?`).bind(project,user).first<ProjectDetails>();
 if(!row)throw new BillingError(404,'Project not found');return row;
}
export async function saveProjectDetails(db:D1Database,user:string,project:string,value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new BillingError(400,'Provide project details');
 const data=value as Record<string,unknown>;
 if(Object.keys(data).some(k=>k!=='revision'&&!fields.includes(k as typeof fields[number]))||!Number.isSafeInteger(data.revision)||Number(data.revision)<0||!fields.some(k=>k in data))throw new BillingError(400,'Provide a saved revision and the project fields to change');
 for(const key of fields){
  if(!(key in data))continue;
  const v=data[key];
  if(typeof v!=='string'||v.trim().length>(key==='name'?100:1000)||key==='name'&&(!v.trim()||/[\x00-\x1f\x7f]/.test(v))||key==='preferred_theme'&&!['ocean','clay','forest'].includes(v))throw new BillingError(400,'Use a name up to 100 characters, notes up to 1,000 characters and an available starting theme');
 }
 const before=await readProjectDetails(db,user,project);
 if(before.revision!==data.revision)throw new BillingError(409,'Project details changed. Read the latest details before saving again.');
 const next={...before};
 for(const key of fields)if(key in data)next[key]=(data[key] as string).trim();
 const row=await db.prepare(`UPDATE projects SET name=?,purpose=?,audience=?,style_notes=?,preferred_theme=? WHERE id=? AND owner_user_id=? AND details_revision=? RETURNING ${columns}`).bind(...fields.map(k=>next[k]),project,user,data.revision).first<ProjectDetails>();
 if(!row)throw new BillingError(409,'Project details changed. Read the latest details before saving again.');
 // RETURNING precedes the AFTER trigger; the validated revision pins this comparison.
 return {...row,revision:row.revision+(fields.some(k=>before[k]!==row[k])?1:0)};
}
