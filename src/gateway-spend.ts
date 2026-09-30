import {inferenceCost} from './model-policy';
import {inferenceRoutingPolicy,planInferenceRoute} from './inference-routing';
type Decision=ReturnType<typeof planInferenceRoute>;
type Selection=NonNullable<Decision['selected']>;
export class GatewaySpendError extends Error{constructor(readonly status:number,message:string){super(message);}}
export type FundingBuckets={task:string;account:string;platform:string;premium?:string;approval?:string};
type Receipt={id:string;user_id:string;task_id:string;snapshot:string;task_bucket:string;account_bucket:string;platform_bucket:string;premium_bucket:string|null;approval_bucket:string|null;status:string;input_tokens:number|null;output_tokens:number|null;provider_actual:number|null;customer_actual:number|null};
const integer=(n:number)=>{if(!Number.isSafeInteger(n)||n<0)throw new GatewaySpendError(400,'Invalid inference spend amount');};
function customerCost(s:Selection,provider:number){if(s.tier==='standard')return 0;const multiplier=s.retailMultiplierBps;if(multiplier===null)throw new GatewaySpendError(400,'Premium tariff missing');integer(multiplier);const value=(BigInt(provider)*BigInt(multiplier)+9999n)/10000n;if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new GatewaySpendError(400,'Inference spend exceeds its bound');return Number(value);}
async function read(db:D1Database,owner:string,id:string){return db.prepare('SELECT * FROM gateway_spend_attempts WHERE id=? AND user_id=?').bind(id,owner).first<Receipt>();}
function same(old:Receipt,snapshot:string,b:FundingBuckets){return old.snapshot===snapshot&&old.task_bucket===b.task&&old.account_bucket===b.account&&old.platform_bucket===b.platform&&old.premium_bucket===(b.premium??null)&&old.approval_bucket===(b.approval??null);}
/** Trusted server decisions and authoritative bucket IDs only. No public funding/dispatch API. */
export async function reserveGatewaySpend(db:D1Database,owner:string,id:string,decision:Decision,b:FundingBuckets){
 const s=decision.selected;
 if(decision.policy!==inferenceRoutingPolicy||!s||s.ownerId!==owner||!id||id.length>100)throw new GatewaySpendError(400,'Inference decision is not valid');
 const expected=inferenceCost(s.rate,s.inputBound,s.outputBound)+s.extraMicrosPerCall;integer(expected);
 if(expected!==s.providerReservationMicros||customerCost(s,expected)!==s.customerReservationMicros)throw new GatewaySpendError(400,'Inference quote does not match its rate snapshot');
 const snapshot=JSON.stringify(s),old=await read(db,owner,id);
 if(old){if(!same(old,snapshot,b))throw new GatewaySpendError(409,'Inference request already has a different reservation');return {id,status:old.status,replayed:true};}
 try{
  await db.prepare('INSERT INTO gateway_spend_attempts(id,user_id,task_id,snapshot,task_bucket,account_bucket,platform_bucket,premium_bucket,approval_bucket,provider_reserved,customer_reserved) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,owner,s.taskId,snapshot,b.task,b.account,b.platform,b.premium??null,b.approval??null,s.providerReservationMicros,s.customerReservationMicros).run();
 }catch{
  const existing=await read(db,owner,id);if(existing&&same(existing,snapshot,b))return {id,status:existing.status,replayed:true};
  if(existing)throw new GatewaySpendError(409,'Inference request already has a different reservation');
  throw new GatewaySpendError(409,'Inference funding or approval could not be reserved');
 }
 return {id,status:'reserved',replayed:false};
}
export async function dispatchGatewaySpend(db:D1Database,owner:string,id:string){
 // Release and dispatch race on the same receipt. Only one can win.
 const result=await db.prepare("UPDATE gateway_spend_attempts SET status='dispatched' WHERE id=? AND user_id=? AND status='reserved'").bind(id,owner).run();return result.meta.changes>0;
}
export async function releaseGatewaySpend(db:D1Database,owner:string,id:string){
 const result=await db.prepare("UPDATE gateway_spend_attempts SET status='released' WHERE id=? AND user_id=? AND status='reserved'").bind(id,owner).run();return result.meta.changes>0;
}
export async function uncertainGatewaySpend(db:D1Database,owner:string,id:string){
 await db.prepare("UPDATE gateway_spend_attempts SET status='uncertain' WHERE id=? AND user_id=? AND status='dispatched'").bind(id,owner).run();
}
export async function settleGatewaySpend(db:D1Database,owner:string,id:string,input:number,output:number){
 integer(input);integer(output);const row=await read(db,owner,id);if(!row)throw new GatewaySpendError(404,'Inference reservation not found');
 const s=JSON.parse(row.snapshot) as Selection;
 const provider=inferenceCost(s.rate,input,output)+s.extraMicrosPerCall,customer=customerCost(s,provider);integer(provider);
 const matches=(r:Receipt)=>r.status==='settled'&&r.input_tokens===input&&r.output_tokens===output&&r.provider_actual===provider&&r.customer_actual===customer;
 if(matches(row))return {providerMicros:provider,customerMicros:customer,replayed:true};
 if(!['dispatched','uncertain'].includes(row.status))throw new GatewaySpendError(409,'Inference settlement conflicts with its receipt');
 if(input>s.inputBound||output>s.outputBound||provider>s.providerReservationMicros||customer>s.customerReservationMicros){await uncertainGatewaySpend(db,owner,id);throw new GatewaySpendError(409,'Reported inference usage exceeds its reservation; reconciliation required');}
 const result=await db.prepare("UPDATE gateway_spend_attempts SET status='settled',input_tokens=?,output_tokens=?,provider_actual=?,customer_actual=? WHERE id=? AND user_id=? AND status IN ('dispatched','uncertain')").bind(input,output,provider,customer,id,owner).run();
 if(result.meta.changes===0){const current=await read(db,owner,id);if(!current||!matches(current))throw new GatewaySpendError(409,'Inference settlement conflicts with its receipt');}
 return {providerMicros:provider,customerMicros:customer,replayed:result.meta.changes===0};
}
