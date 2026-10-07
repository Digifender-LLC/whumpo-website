import type {ConnectorOperation} from './connector-catalog';
export type ConnectorPrice=ConnectorOperation['price'];
export type ConnectorConfirmation={reviewDigest:string;acceptedPrice:ConnectorPrice};
export function isConnectorConfirmation(value:unknown):value is ConnectorConfirmation{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>,p=v.acceptedPrice as Record<string,unknown>|undefined;
 return Object.keys(v).sort().join(',')==='acceptedPrice,reviewDigest'&&typeof v.reviewDigest==='string'&&/^[0-9a-f]{64}$/.test(v.reviewDigest)&&!!p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).sort().join(',')==='basis,customerUnits'&&p.customerUnits===0&&p.basis==='plan-inclusion';
}
export function connectorConfirmation(value:{connector:{reviewDigest:string;price:ConnectorPrice}}):ConnectorConfirmation{return {reviewDigest:value.connector.reviewDigest,acceptedPrice:value.connector.price};}
