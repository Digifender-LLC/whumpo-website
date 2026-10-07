import {isConnectorConfirmation,type ConnectorPrice} from './connector-review-shape';
import {connectorOperation,type ActiveConnectorProvider} from './connector-catalog';
import {hashToken} from './security';
export type ConnectorSavedContract={operation_digest:string;request_digest:string;review_digest:string;price_json:string};
export type ConnectorReceiptState='review'|'dispatching'|'applied'|'unchanged'|'uncertain'|'observed'|'failed'|'expired'|'cancelled';
export class ConnectorReviewError extends Error{readonly status=409;constructor(){super('The connector review or accepted price changed. Prepare and confirm a fresh review.');}}
function canonical(value:unknown):string{
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
 throw new ConnectorReviewError();
}
export const connectorDigest=(value:unknown)=>hashToken(canonical(value));
export const includedConnectorPrice='Included in your plan; no per-use charge.';
export async function prepareConnectorContract(provider:ActiveConnectorProvider,operationId:string,input:{id:string;owner:string;credentialId:string;destination:unknown;request:unknown;expiresAt:string}):Promise<ConnectorSavedContract>{
 const op=connectorOperation(provider,operationId),operationDigest=await connectorDigest(op),requestDigest=await connectorDigest(input.request),price=op.price;
 if(op.kind!=='action'||price.customerUnits!==0||price.basis!=='plan-inclusion')throw new ConnectorReviewError();
 const reviewDigest=await connectorDigest({version:1,provider,operationId,authority:'owner-request',id:input.id,owner:input.owner,credentialId:input.credentialId,destination:input.destination,expiresAt:input.expiresAt,operationDigest,requestDigest,price});
 return {operation_digest:operationDigest,request_digest:requestDigest,review_digest:reviewDigest,price_json:canonical(price)};
}
export async function assertConnectorConfirmation(provider:ActiveConnectorProvider,operationId:string,saved:ConnectorSavedContract,confirmation:unknown){
 const op=connectorOperation(provider,operationId);
 if(!isConnectorConfirmation(confirmation)||confirmation.reviewDigest!==saved.review_digest||canonical(confirmation.acceptedPrice)!==saved.price_json||canonical(op.price)!==saved.price_json||await connectorDigest(op)!==saved.operation_digest)throw new ConnectorReviewError();
}
/** Shared view over authoritative domain receipts; it creates no second state machine. */
export function connectorReceipt(provider:ActiveConnectorProvider,operationId:string,saved:ConnectorSavedContract,state:string,expiresAt:string,providerObjectId:string|null){
 const price:ConnectorPrice=JSON.parse(saved.price_json);
 const normalized=provider==='github'?state==='pending'?'review':state==='complete'?'applied':state:state==='sending'?'dispatching':state;
 const receiptState:ConnectorReceiptState=normalized==='review'&&expiresAt<=new Date().toISOString()?'expired':normalized as ConnectorReceiptState;
 return {version:1 as const,provider,operationId,authority:'owner-request' as const,state:receiptState,operationDigest:saved.operation_digest,requestDigest:saved.request_digest,reviewDigest:saved.review_digest,price,providerObjectId};
}
