import {publicClientKey,reservePublicClient} from './public-admission';
export class StorageLimitError extends Error {status=503;constructor(message='The test platform’s monthly photo allowance has been reached. Please try again after the monthly reset.'){super(message);}}
/** Platform-wide R2 operation ceiling, separate from customer AI units and account-wide allowances. */
export async function reserveStorage(db:D1Database,kind:'read'|'write',count=1){
 if(!Number.isSafeInteger(count)||count<1||count>4)throw Error('Invalid storage reservation');
 const column=kind==='read'?'read_ops':'write_ops',limit=kind==='read'?100000:10000;
 const row=await db.prepare(`INSERT INTO storage_usage(period,${column}) VALUES(?,?) ON CONFLICT(period) DO UPDATE SET ${column}=${column}+excluded.${column} WHERE ${column}+excluded.${column}<=? RETURNING period`).bind(new Date().toISOString().slice(0,7),count,limit).first();
 if(!row)throw new StorageLimitError();
}
/**
 * One anonymous public photo read (WH-075). Charges, in order: the caller's per-client daily attempt
 * sub-limit for this project, then atomically the project's monthly read budget (10,000, with an
 * account fair share once half the platform ceiling is used) and the platform ceiling (100,000).
 * One project or client exhausting its budget therefore no longer refuses every tenant's photos.
 */
export async function reservePublicPhotoRead(db:D1Database,request:Request,project:string){
 await reservePublicClient(db,'photo',project,await publicClientKey(request,'photo',project));
 try{
  await db.batch([
   db.prepare("INSERT INTO storage_project_usage(project_id,period,read_ops) VALUES(?,strftime('%Y-%m','now'),1) ON CONFLICT(project_id,period) DO UPDATE SET read_ops=read_ops+1").bind(project),
   db.prepare("INSERT INTO storage_usage(period,read_ops) VALUES(strftime('%Y-%m','now'),1) ON CONFLICT(period) DO UPDATE SET read_ops=read_ops+1")
  ]);
 }catch(cause){
  if(String(cause).includes('storage_project_quota'))throw new StorageLimitError('This site’s monthly photo allowance has been reached. Please try again after the monthly reset.');
  if(/CHECK constraint failed/i.test(String(cause)))throw new StorageLimitError();
  throw cause;
 }
}
