import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';

// Private operator-only projection. No prompt, saved answer, email or credential reads.
export async function gatewayEvidenceReport(db,limit=50){
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Invalid report limit');
 const totals=await db.prepare("SELECT COUNT(*) AS unresolved,COALESCE(SUM(provider_reserved),0) AS providerHeldMicros,COALESCE(SUM(customer_reserved),0) AS customerHeldMicros FROM gateway_spend_attempts WHERE status IN ('dispatched','uncertain')").first();
 if(!totals||Object.values(totals).some(value=>!Number.isSafeInteger(value)||value<0))throw Error('Gateway totals exceed report bounds');
 const {results}=await db.prepare("SELECT a.id AS attemptId,a.status,a.provider_reserved AS providerHeldMicros,a.customer_reserved AS customerHeldMicros,r.http_status AS httpStatus,r.event_id AS eventId,r.log_id AS logId,r.account_id AS cloudflareAccount,r.gateway_id AS gateway,r.received_at AS headersReceivedAt,CASE WHEN q.result_json IS NULL THEN 0 ELSE 1 END AS hasSavedResult FROM gateway_spend_attempts a LEFT JOIN gateway_provider_receipts r ON r.attempt_id=a.id LEFT JOIN gateway_inference_requests q ON q.attempt_id=a.id WHERE a.status IN ('dispatched','uncertain') ORDER BY a.id LIMIT ?").bind(limit).all();
 return {observedAt:new Date().toISOString(),totals,attempts:results,truncated:totals.unresolved>results.length,
  guidance:'Header IDs are evidence for investigation, not proof of usage or no charge. Do not redispatch or release unresolved holds solely from this report. An identical request with a saved result may complete existing settlement without inference.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==2)throw Error('Unexpected arguments');
  const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
  const credentials=process.env.CLOUDFLARE_API_TOKEN?{type:'api_token',token:process.env.CLOUDFLARE_API_TOKEN}:undefined;
  const api=cloudflareClient(config.account_id,fetch,credentials),db=remoteD1(api,config.d1_databases.find(b=>b.binding==='DB').database_id);
  console.log(JSON.stringify(await gatewayEvidenceReport(db),null,2));
 }catch{console.error('Gateway evidence report unavailable. Check operator authorization and accounting migrations. No settings were changed.');process.exitCode=1;}
}
