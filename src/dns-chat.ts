import {includedConnectorPrice,ConnectorReviewError} from './connector-receipts';
import {FeatureInclusionError} from './feature-inclusion';
import type {CMSContent} from './cms-content';
import type {CMSRead} from './cms-projects';
import type {HealthOptions} from './site-health';
import type {BackupChatOptions} from './backup-chat';
import type {HostingChatOptions} from './hosting-chat';
import {cloudflareZones,type CloudflareConfig} from './cloudflare-connection';
import {listDNSActions,reviewTXT,reviewCNAME,confirmDNS} from './cloudflare-dns';
import {DomainError} from './domains';
import {hostingConnections} from './domain-hosting';
import {ConnectionError} from './github-connection';
export type DNSChatOptions=HostingChatOptions & BackupChatOptions & HealthOptions & {background?:(promise:Promise<unknown>)=>void;cmsPublication?:(turn:string,content:string)=>(()=>Promise<string>)|undefined;cmsContent?:CMSContent;cms?:CMSRead;backendRuntime?:Fetcher;config?:CloudflareConfig;transport?:typeof fetch;hostingReady?:boolean};
const uuid=/^[0-9a-f-]{36}$/;
type Receipt=Awaited<ReturnType<typeof reviewTXT>>;
function describe(a:Receipt){
 const header=`Cloudflare ${a.record.type==='CNAME'?'website routing (CNAME)':'TXT proof'}: ${a.connector.state}\n${includedConnectorPrice}\nReview: ${a.id}\nZone: ${a.zoneName}\nName: ${a.record.name}\nValue: ${a.record.value}`;
 if(a.state==='review')return `${header}\n${a.record.type==='CNAME'?'DNS-only CNAME, automatic TTL. Adds routing only if absent; conflicting records are never replaced. This can direct website traffic (including traffic previously using wildcard DNS) to Whumpo. DNS and TLS checks must pass before hosting serves.':'Automatic TTL. Adds this proof only if absent; existing records are preserved. Hosting is unchanged.'}\nReview expires: ${a.expiresAt}\n\nAuthorize this exact addition using its review in Dashboard → Domains.`;
 return `${header}\n${a.detail}\n${['sending','uncertain'].includes(a.state)?"Check the saved DNS review "+a.id+' to observe the result without resending.':a.record.type==='CNAME'?'Use the Domains panel to check hosting status. This receipt is historical, not current DNS or TLS status.':"Ask to check the current domain ownership proof. This receipt is historical, not current DNS status."}`;
}
/** Returns a deferred operation. The caller must durably claim the user's chat turn before running it. */
export function dnsChatCommand(db:D1Database,user:string,turnId:string,command:string,options:DNSChatOptions={}){
 const [verb,...args]=command.split(/\s+/);
 if(!['/dns','/dns-zones','/review-dns','/review-routing','/confirm-dns','/check-dns'].includes(verb))return;
 if(verb==='/dns'&&args.length||verb==='/dns-zones'&&(args.length>1||args.length===1&&!/^(?:[1-9]|[1-9][0-9]|100)$/.test(args[0]))||['/review-dns','/review-routing'].includes(verb)&&(args.length!==2||!uuid.test(args[0])||!/^[0-9a-f]{32}$/.test(args[1]))||verb==='/check-dns'&&(args.length!==1||!uuid.test(args[0]))||verb==='/confirm-dns'&&(args.length!==4||!uuid.test(args[0])||!/^[0-9a-f]{64}$/.test(args[1])||args[2]!=='0'||args[3]!=='plan-inclusion'))throw new DomainError(400,"Choose an authorized zone, ownership proof, hosting connection or saved DNS review.");
 return async()=>{
  try{
   if(verb==='/dns'){const {actions}=await listDNSActions(db,user),connections=await hostingConnections(db,user),routing=connections.filter(c=>['provisioning','active','needs_check'].includes(c.state));return (actions.length?actions.map(describe).join('\n\n'):'No Cloudflare DNS reviews yet.')+(routing.length?'\n\nHosting connections (saved state; check DNS and TLS separately):\n'+routing.map(c=>`${c.hostname} · ${c.state}\nConnection: ${c.id}`).join('\n\n'):'')+"\n\nAsk to list domain ownership proofs and authorized Cloudflare zones, then prepare an exact TXT proof or website-routing review. Reviews make no DNS changes. Manage Cloudflare in Settings → External connections.";}
   if(verb==='/dns-zones'){const page=Number(args[0]??1),result=await cloudflareZones(db,user,options.config,page,options.transport);return (result.zones.length?result.zones.map(z=>`${z.name} · ${z.status}\nZone: ${z.id}`).join('\n\n'):'No authorized zones on this page.')+(result.hasMore&&page<100?"\n\nAsk for authorized zones page "+(page+1):'')+"\n\nAsk to review adding an exact TXT ownership proof in an authorized zone.";}
   if(verb==='/review-dns')return describe(await reviewTXT(db,user,turnId,args[0],args[1],options.config,options.transport));
   if(verb==='/review-routing')return describe(await reviewCNAME(db,user,turnId,args[0],args[1],options.config,options.transport,options.hostingReady));
   if(verb==='/check-dns'){
    const {actions}=await listDNSActions(db,user),action=actions.find(a=>a.id===args[0]);if(!action)throw new DomainError(404,'DNS review not found.');
    // A check of a pending review must never become permission to create a record.
    if(action.state==='review')return describe(action)+'\nNo DNS write was authorized by this check.';
   }
   return describe(await confirmDNS(db,user,args[0],options.config,options.transport,options.hostingReady,verb==='/confirm-dns'?{reviewDigest:args[1],acceptedPrice:{customerUnits:Number(args[2]),basis:args[3]}}:undefined));
  }catch(cause){return cause instanceof ConnectorReviewError||cause instanceof FeatureInclusionError||cause instanceof DomainError||cause instanceof ConnectionError?cause.message+"\nNo automatic retry will be sent. Ask to inspect the saved DNS review.":"The DNS result could not be saved. Ask to inspect the saved review and check its uncertain outcome. This request will not be dispatched again.";}
 };
}
