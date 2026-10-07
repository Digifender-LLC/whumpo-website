import type {ActiveConnectorProvider} from './connector-catalog';
/** Transient owner request. Shared with maintained controls; carries no credential or provider response. */
export type ConnectorLookupInput={version:1;id:string;provider:ActiveConnectorProvider;operationId:string;params:Record<string,unknown>;destination:'owner-panel'|'model-context'};
