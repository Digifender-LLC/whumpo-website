import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';

// WH-041 owner decision Q-31 (November 1, 2026): a lost card dispute voids that invoice's coverage (WH-042) and flags the account for support review. This is the flag: a read-only list
// of the voids whose reason is a lost dispute, oldest first, as internal account and invoice ids only. It reads no email, name, card or message, writes nothing, and clears nothing:
// a void is immutable, and what support does with the account is outside this tool. Limited to 200 rows; a longer list says so.
export async function lostDisputes(db,limit=200){
 if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('Invalid limit');
 const {results}=await db.prepare(`SELECT i.user_id AS account_id,v.invoice_id,v.source_id AS dispute_id,v.created_at AS voided_at
  FROM stripe_invoice_voids v JOIN stripe_paid_invoices i ON i.id=v.invoice_id WHERE v.reason='dispute-lost' ORDER BY v.created_at,v.invoice_id LIMIT ?`).bind(limit+1).all();
 if(!Array.isArray(results)||results.some(r=>![r.account_id,r.invoice_id,r.dispute_id].every(x=>typeof x==='string')||!Number.isSafeInteger(r.voided_at)))throw Error('Dispute inventory unavailable');
 const rows=results.slice(0,limit).map(r=>({accountId:r.account_id,invoiceId:r.invoice_id,disputeId:r.dispute_id,voidedAt:new Date(r.voided_at*1000).toISOString()}));
 return {observedAt:new Date().toISOString(),scope:'Internal account, invoice and dispute ids of lost disputes only; no identities, payment details or writes.',count:rows.length,truncated:results.length>limit,disputes:rows,
  nextStep:rows.length?'Support reviews each account. Coverage for the invoice is already void; this report does not change any account.':'No lost disputes recorded.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==2)throw Error('Unexpected arguments');
  const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
  const credentials=process.env.CLOUDFLARE_API_TOKEN?{type:'api_token',token:process.env.CLOUDFLARE_API_TOKEN}:undefined;
  const api=cloudflareClient(config.account_id,fetch,credentials);
  const db=remoteD1(api,config.d1_databases.find(b=>b.binding==='DB').database_id);
  console.log(JSON.stringify(await lostDisputes(db),null,2));
 }catch(error){console.error(error instanceof Error?error.message:'Lost dispute report failed');process.exitCode=1;}
}
