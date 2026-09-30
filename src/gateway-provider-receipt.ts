import {type GatewayConfig} from './ai-gateway';
import {GatewaySpendError} from './gateway-spend';
function identifier(value:string|null,secret:string){return value&&/^[a-zA-Z0-9_.:-]{1,128}$/.test(value)&&!value.includes(secret)?value:null;}
/** Diagnostic header evidence only, never authority for usage or releasing a hold. */
export async function captureGatewayReceipt(db:D1Database,owner:string,id:string,config:GatewayConfig,response:Response){
 const values={account_id:config.accountId,gateway_id:config.gatewayId,http_status:response.status,event_id:identifier(response.headers.get('cf-aig-event-id'),config.apiToken),log_id:identifier(response.headers.get('cf-aig-log-id'),config.apiToken)};
 const read=()=>db.prepare('SELECT r.account_id,r.gateway_id,r.http_status,r.event_id,r.log_id FROM gateway_provider_receipts r JOIN gateway_spend_attempts a ON a.id=r.attempt_id WHERE r.attempt_id=? AND a.user_id=?').bind(id,owner).first<typeof values>();
 const matches=(row:typeof values|null)=>!!row&&Object.entries(values).every(([key,value])=>row[key as keyof typeof values]===value);
 if(matches(await read()))return;
 try{
  const inserted=await db.prepare("INSERT INTO gateway_provider_receipts(attempt_id,account_id,gateway_id,http_status,event_id,log_id) SELECT id,?,?,?,?,? FROM gateway_spend_attempts WHERE id=? AND user_id=? AND status='dispatched'").bind(values.account_id,values.gateway_id,values.http_status,values.event_id,values.log_id,id,owner).run();
  if(inserted.meta.changes!==1)throw new GatewaySpendError(409,'Provider evidence could not be recorded');
 }catch{
  if(!matches(await read()))throw new GatewaySpendError(409,'Provider evidence could not be recorded');
 }
}
