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
export type DNSChatOptions=HostingChatOptions & BackupChatOptions & HealthOptions & {cmsPublication?:(turn:string,content:string)=>(()=>Promise<string>)|undefined;cmsContent?:CMSContent;cms?:CMSRead;backendRuntime?:Fetcher;config?:CloudflareConfig;transport?:typeof fetch;hostingReady?:boolean};
const uuid=/^[0-9a-f-]{36}$/;
type Receipt=Awaited<ReturnType<typeof reviewTXT>>;
function describe(a:Receipt){
 const header=`Cloudflare ${a.record.type==='CNAME'?'website routing (CNAME)':'TXT proof'}: ${a.state}\nReview: ${a.id}\nZone: ${a.zoneName}\nName: ${a.record.name}\nValue: ${a.record.value}`;
 if(a.state==='review')return `${header}\n${a.record.type==='CNAME'?'DNS-only CNAME, automatic TTL. Adds routing only if absent; conflicting records are never replaced. This can direct website traffic (including traffic previously using wildcard DNS) to Whumpo. DNS and TLS checks must pass before hosting serves.':'Automatic TTL. Adds this proof only if absent; existing records are preserved. Hosting is unchanged.'}\nReview expires: ${a.expiresAt}\n\nTo authorize this exact addition, send /confirm-dns ${a.id}.`;
 return `${header}\n${a.detail}\n${['sending','uncertain'].includes(a.state)?'Use /check-dns '+a.id+' to observe the result without resending.':a.record.type==='CNAME'?'Use the Domains panel to check hosting status. This receipt is historical, not current DNS or TLS status.':'Use /domains to find the claim and /verify-domain CLAIM_ID to check public DNS. This receipt is historical, not current DNS status.'}`;
}
/** Returns a deferred operation. The caller must durably claim the user's chat turn before running it. */
export function dnsChatCommand(db:D1Database,user:string,turnId:string,command:string,options:DNSChatOptions={}){
 const [verb,...args]=command.split(/\s+/);
 if(!['/dns','/dns-zones','/review-dns','/review-routing','/confirm-dns','/check-dns'].includes(verb))return;
 if(verb==='/dns'&&args.length||verb==='/dns-zones'&&(args.length>1||args.length===1&&!/^(?:[1-9]|[1-9][0-9]|100)$/.test(args[0]))||['/review-dns','/review-routing'].includes(verb)&&(args.length!==2||!uuid.test(args[0])||!/^[0-9a-f]{32}$/.test(args[1]))||['/confirm-dns','/check-dns'].includes(verb)&&(args.length!==1||!uuid.test(args[0])))throw new DomainError(400,'Use /dns, /dns-zones [PAGE], /review-dns CLAIM_ID ZONE_ID, /review-routing CONNECTION_ID ZONE_ID, /confirm-dns REVIEW_ID or /check-dns REVIEW_ID.');
 return async()=>{
  try{
   if(verb==='/dns'){const {actions}=await listDNSActions(db,user),connections=await hostingConnections(db,user),routing=connections.filter(c=>['provisioning','active','needs_check'].includes(c.state));return (actions.length?actions.map(describe).join('\n\n'):'No Cloudflare DNS reviews yet.')+(routing.length?'\n\nHosting connections (saved state; check DNS and TLS separately):\n'+routing.map(c=>`${c.hostname} · ${c.state}\nConnection: ${c.id}`).join('\n\n'):'')+'\n\nUse /domains for claim IDs, /dns-zones for authorized zone IDs, then /review-dns CLAIM_ID ZONE_ID. Use /review-routing CONNECTION_ID ZONE_ID for a confirmed hosting connection. Reviews make no DNS changes. Connecting Cloudflare requires the Connected accounts panel. These commands use no AI units.';}
   if(verb==='/dns-zones'){const page=Number(args[0]??1),result=await cloudflareZones(db,user,options.config,page,options.transport);return (result.zones.length?result.zones.map(z=>`${z.name} · ${z.status}\nZone: ${z.id}`).join('\n\n'):'No authorized zones on this page.')+(result.hasMore&&page<100?'\n\nNext page: /dns-zones '+(page+1):'')+'\n\nUse /review-dns CLAIM_ID ZONE_ID to review a TXT proof.';}
   if(verb==='/review-dns')return describe(await reviewTXT(db,user,turnId,args[0],args[1],options.config,options.transport));
   if(verb==='/review-routing')return describe(await reviewCNAME(db,user,turnId,args[0],args[1],options.config,options.transport,options.hostingReady));
   if(verb==='/check-dns'){
    const {actions}=await listDNSActions(db,user),action=actions.find(a=>a.id===args[0]);if(!action)throw new DomainError(404,'DNS review not found.');
    // A check of a pending review must never become permission to create a record.
    if(action.state==='review')return describe(action)+'\nNo DNS write was authorized by this check.';
   }
   return describe(await confirmDNS(db,user,args[0],options.config,options.transport,options.hostingReady));
  }catch(cause){return cause instanceof DomainError||cause instanceof ConnectionError?cause.message+'\nNo automatic retry will be sent. Use /dns to inspect saved reviews.':'The DNS command result could not be saved. Use /dns to inspect reviews and /check-dns REVIEW_ID for an uncertain result. This message will not be dispatched again.';}
 };
}
