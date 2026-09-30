import {complete,ProviderError,type ChatMessage,type Completion} from './ai';

/** Server configuration only. Never populate credentials or routes from model output. */
export type GatewayConfig={
 accountId:string;gatewayId:string;apiToken:string;model:string;
 protocol:'chat'|'responses';maxOutputTokens:number;timeoutMs?:number;
};

export function validateGatewayConfig(config:GatewayConfig){
 if([config.accountId,config.gatewayId,config.model].some(value=>typeof value!=='string')||config.model.startsWith('dynamic/')||!/^[a-f0-9]{32}$/.test(config.accountId)||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(config.gatewayId)
  ||! /^(?:@cf\/)?[a-z0-9][a-z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(config.model)
  ||!Number.isSafeInteger(config.maxOutputTokens)||config.maxOutputTokens<64||config.maxOutputTokens>4096
  ||config.model.length>200||!['chat','responses'].includes(config.protocol)
  ||typeof config.apiToken!=='string'||!config.apiToken.length||config.apiToken.length>4096||/[^\x21-\x7e]/.test(config.apiToken))throw new ProviderError('configuration');
 if(config.timeoutMs!==undefined&&(!Number.isSafeInteger(config.timeoutMs)||config.timeoutMs<100||config.timeoutMs>60000))throw new ProviderError('configuration');
}

/** Transport only: callers must reserve spending and claim an attempt before invoking. */
export async function completeGateway(config:GatewayConfig,messages:ChatMessage[],transport:typeof fetch=globalThis.fetch.bind(globalThis)):Promise<Completion>{
 validateGatewayConfig(config);
 const baseURL=`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/v1`;
 const endpoint=baseURL+(config.protocol==='responses'?'/responses':'/chat/completions');
 return complete({baseURL,apiKey:config.apiToken,model:config.model,protocol:config.protocol,maxOutputTokens:config.maxOutputTokens,timeoutMs:config.timeoutMs},messages,async (url,request)=>{
  // Defense in depth: this credential can only leave for the selected Cloudflare account endpoint.
  if(String(url)!==endpoint||request?.method!=='POST'||request.redirect!=='manual')throw new ProviderError('configuration');
  const headers=new Headers(request.headers);
  headers.set('cf-aig-gateway-id',config.gatewayId);
  headers.set('cf-aig-skip-cache','true');
  headers.set('cf-aig-collect-log','false');
  headers.set('cf-aig-max-attempts','1');
  headers.set('cf-aig-no-wholesale','true');
  // End-to-end deadline remains enforced by complete(), including reading the body.
  headers.set('cf-aig-request-timeout',String(config.timeoutMs??60000));
  return transport(url,{...request,headers});
 });
}
