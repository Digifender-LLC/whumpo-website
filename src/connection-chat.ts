import {connectionStatus,type GitHubConfig} from './github-connection';
import {cloudflareStatus,type CloudflareConfig} from './cloudflare-connection';
/** Read local authorization metadata only. Never query providers or read secrets. */
export async function describeConnections(db:D1Database,user:string,options:{github?:GitHubConfig;config?:CloudflareConfig}={}){
 const [{github},cloudflare]=await Promise.all([connectionStatus(db,user,options.github),cloudflareStatus(db,user,options.config)]);
 const describe=(name:string,state:{enabled:boolean;connected:boolean;revocationPending:boolean})=>`${name}: ${state.connected?'connected':state.enabled?'not connected':'not available in this environment'}.${state.revocationPending?' Provider revocation is still pending; disconnected access is already blocked locally.':''}`;
 return ['Connection status when this message was requested (saved authorization, not a provider health check):',describe('GitHub',github),describe('Cloudflare',cloudflare),'','GitHub supports separately reviewed source backups. Cloudflare supports authorized zone lookup and reviewed TXT proofs or website-routing records. Each operation checks current access again; a connection does not publish a site or change DNS.','','Type open connected accounts to connect or disconnect through Settings. Provider consent happens on the provider’s website. Do not paste API keys or passwords into Chat.','Send /connections again to refresh this snapshot. This status check uses no AI units.'].join('\n');
}
