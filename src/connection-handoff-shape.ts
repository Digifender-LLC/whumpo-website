import {isConnectableProvider,type ConnectableProviderId} from './connector-catalog/catalog';
/** Navigation and maintained consent identity, never provider authority. Derived from the connector catalog:
 * exactly the providers that are not `planned` ('github' | 'cloudflare'); planned providers are refused. */
export type ConnectionProvider=ConnectableProviderId;
export type ConnectionHandoff={interactionId:string;definitionDigest:string};
export const isConnectionProvider=(value:unknown):value is ConnectionProvider=>isConnectableProvider(value);
export function isConnectionHandoff(value:unknown):value is ConnectionHandoff{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 return Object.keys(v).sort().join(',')==='definitionDigest,interactionId'&&typeof v.interactionId==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v.interactionId)&&typeof v.definitionDigest==='string'&&/^[0-9a-f]{64}$/.test(v.definitionDigest);
}
