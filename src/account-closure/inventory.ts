/** WH-009/WH-018: the closure inventory inside the Worker. The metric list is the same JSON the operator CLI
 * (tools/account-closure-inventory.mjs) reads, so the customer closure review counts exactly what the operator inventory counts.
 * Static SQL fragments only; the account id is bound once in the scope CTE. No credential, identity, source code, Chat text,
 * filename, object key or provider identifier is returned. D1 refuses a result set above 100 columns, so the metrics run as
 * statements of at most 50 columns: the counts are not one atomic snapshot, which is why confirmation re-reads them. */
import metricList from './metrics.json';

export type ClosureCounts=Record<string,number>;
const metrics=metricList as unknown as Array<[string,string,string,string?]>;
export const closureMetricNames:readonly string[]=metrics.map(m=>m[0]);
const inventorySQL=(entries:typeof metrics)=>`WITH scope AS (SELECT id FROM users WHERE (?1 IS NULL OR id=?1)),
 owned_projects AS (SELECT id FROM projects WHERE owner_user_id IN (SELECT id FROM scope))
 SELECT ${entries.map(([name,table,owner,condition])=>
 `(SELECT COUNT(*) FROM ${table} WHERE ${owner.includes(' IN ')?owner:`${owner} IN (SELECT id FROM scope)`}${condition?` AND (${condition})`:''}) AS ${name}`).join(',\n')}`;
const statements=metrics.reduce<typeof metrics[]>((all,entry,i)=>{if(i%50)all[all.length-1].push(entry);else all.push([entry]);return all;},[]).map(inventorySQL);

/** Counts for every metric, or a thrown error: missing schema, failed queries and invalid counts never read as zero.
 * An unknown account fails rather than returning a reassuring empty report. */
export async function closureCounts(db:Pick<D1Database,'prepare'>,userId:string):Promise<ClosureCounts>{
 if(typeof userId!=='string'||!userId.length||userId.length>128)throw Error('Invalid account scope');
 const rows=await Promise.all(statements.map(sql=>db.prepare(sql).bind(userId).first<Record<string,unknown>>()));
 const row:Record<string,unknown>=Object.assign({},...rows);
 if(rows.some(r=>!r)||closureMetricNames.some(key=>!Number.isSafeInteger(row[key])||(row[key] as number)<0))throw Error('Closure inventory unavailable');
 if(row.accounts!==1)throw Error('Account scope unavailable');
 return Object.fromEntries(closureMetricNames.map(key=>[key,row[key] as number]));
}

/** A single SQL condition, true when none of the named metrics counts anything for the account bound at its one `?`. The purge batch repeats
 * the settle-first check with it, so work that appeared after the last read still stops the delete inside the same transaction. */
export function closureQuietSQL(keys:readonly string[]){
 const parts=keys.map(key=>{const m=metrics.find(x=>x[0]===key);if(!m)throw Error('Unknown closure metric');const [,table,owner,condition]=m;
  return `(SELECT COUNT(*) FROM ${table} WHERE ${owner.includes(' IN ')?owner:`${owner} IN (SELECT id FROM scope)`}${condition?` AND (${condition})`:''})`;});
 return `0=(WITH scope AS (SELECT id FROM users WHERE id=?), owned_projects AS (SELECT id FROM projects WHERE owner_user_id IN (SELECT id FROM scope)) SELECT ${parts.join('+')})`;
}
