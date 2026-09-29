export class StorageLimitError extends Error {status=503;constructor(){super('The test platform’s monthly photo allowance has been reached. Please try again after the monthly reset.');}}
/** Platform-wide R2 operation ceiling, separate from customer AI units and account-wide allowances. */
export async function reserveStorage(db:D1Database,kind:'read'|'write',count=1){
 if(!Number.isSafeInteger(count)||count<1||count>4)throw Error('Invalid storage reservation');
 const column=kind==='read'?'read_ops':'write_ops',limit=kind==='read'?100000:10000;
 const row=await db.prepare(`INSERT INTO storage_usage(period,${column}) VALUES(?,?) ON CONFLICT(period) DO UPDATE SET ${column}=${column}+excluded.${column} WHERE ${column}+excluded.${column}<=? RETURNING period`).bind(new Date().toISOString().slice(0,7),count,limit).first();
 if(!row)throw new StorageLimitError();
}
