import {hashToken} from './security';
/**
 * Per-client sub-limits inside each project's public allowance (WH-075).
 * A client is the connecting address (IPv6 grouped by /64). Only a scope-, project- and
 * UTC-day-specific SHA-256 key is stored, for at most the current and previous UTC day.
 * This is an abuse brake against one source exhausting a tenant's allowance, not a spend cap
 * and not a visitor identity: distributed callers still share the project allowance.
 * Limits are enforced by the public_client_usage trigger in schema/platform.sql.
 */
export type PublicScope='backend'|'contact'|'photo';
export const publicClientLimits:Readonly<Record<PublicScope,number>>=Object.freeze({backend:20,contact:10,photo:400});
export class PublicClientLimitError extends Error {status=429;constructor(){super('Too many requests from this connection today. Please try again tomorrow.');}}
function ipv6Prefix(address:string){
 const [head,tail='']=address.split('::'),left=head?head.split(':'):[],right=address.includes('::')&&tail?tail.split(':'):[];
 const groups=address.includes('::')?[...left,...Array(Math.max(0,8-left.length-right.length)).fill('0'),...right]:left;
 return groups.slice(0,4).map(g=>(g||'0').replace(/^0+(?=.)/,'')).join(':')+'::/64';
}
/** Normalized client source: IPv4 address, IPv6 /64 prefix, or one shared bucket when the edge supplied none. */
export function publicClientSource(request:Request){
 const ip=(request.headers.get('cf-connecting-ip')??'').trim().toLowerCase();
 if(!ip||ip.length>64||!/^[0-9a-f:.]+$/.test(ip))return 'unknown';
 if(ip.includes(':')&&!ip.includes('.'))return ipv6Prefix(ip);
 return ip.replace(/^::ffff:/,'');
}
export async function publicClientKey(request:Request,scope:PublicScope,project:string,now=new Date()){
 return hashToken(['public-client',scope,project,now.toISOString().slice(0,10),publicClientSource(request)].join('|'));
}
/** Counts one attempt for this client against the project's per-client sub-limit; never refunded. */
export async function reservePublicClient(db:D1Database,scope:PublicScope,project:string,key:string){
 try{
  await db.prepare("INSERT INTO public_client_usage(scope,project_id,client_key,day,uses) VALUES(?,?,?,strftime('%Y-%m-%d','now'),1) ON CONFLICT(scope,project_id,client_key,day) DO UPDATE SET uses=uses+1").bind(scope,project,key).run();
 }catch(cause){if(String(cause).includes('public_client_quota'))throw new PublicClientLimitError();throw cause;}
}
/** Daily with traffic cleanup: client keys older than yesterday, project read counters before last month. */
export async function cleanupPublicClients(db:D1Database){
 await db.prepare("DELETE FROM public_client_usage WHERE day<date('now','-1 day')").run();
 await db.prepare("DELETE FROM storage_project_usage WHERE period<strftime('%Y-%m','now','start of month','-1 month')").run();
}
