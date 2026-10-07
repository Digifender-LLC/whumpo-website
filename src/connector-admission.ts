import {connectorOperation,ConnectorOperationError,type ConnectorProvider} from './connector-catalog';
import type {FeatureOperation} from './feature-inclusion';
function requireOperation(value:unknown,code:string):asserts value{if(!value)throw new ConnectorOperationError(code);}
/** Lifecycle admission remains separate from operation feature inclusion. Rules stay refused until WH-145. */
export function connectorOperationUse(provider:ConnectorProvider,id:string,use:{projectId:string|null;operation:Exclude<FeatureOperation,'connect'>}|{recoveryId:string}):Exclude<FeatureOperation,'connect'>|null{
 const op=connectorOperation(provider,id);
 if('recoveryId' in use){requireOperation(op.kind==='read','RECOVERY_READ_ONLY');return null;}
 requireOperation(['read','prepare','confirm','dispatch'].includes(use.operation),'INVALID_USE');
 if(op.destinations.includes('owner-panel')||op.destinations.includes('chat-reply'))requireOperation(use.projectId===null&&use.operation==='read','DISCOVERY_ONLY');
 if(op.kind==='action')requireOperation(use.projectId!==null&&['confirm','dispatch'].includes(use.operation),'REVIEW_REQUIRED');
 return op.kind==='action'?'dispatch':use.operation;
}
