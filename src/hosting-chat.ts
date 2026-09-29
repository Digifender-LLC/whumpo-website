import {DomainError} from './domains';
import {hostingConnections,reviewHosting,confirmHosting,refreshHosting,disconnectHosting,type HostingConfig} from './domain-hosting';
export type HostingChatOptions={hosting?:HostingConfig;hostingTransport?:typeof fetch};
type Receipt=Awaited<ReturnType<typeof reviewHosting>>;
function describe(c:Receipt){
 const header=`Hosting for ${c.hostname}: ${c.connected?'connected':c.state}\nConnection: ${c.id}\nProject: ${c.projectId}\nCertificate: ${c.certificateStatus||'not requested'}`;
 if(c.state==='review')return `${header}\n\nConfirming requests a hostname and TLS certificate. Once DNS and certificate checks pass, this hostname serves the project's current published version, including future publication changes. This does not change DNS records or buy a domain.\nReview expires: ${c.expiresAt}\n\nSend /confirm-hosting ${c.id} to authorize this connection, or /disconnect-hosting ${c.id} to cancel the review.`;
 if(c.state==='expired')return `${header}\nReview expired. Use /review-hosting ${c.claimId} for a new review.`;
 if(c.state==='disconnected')return `${header}\n${c.detail}\nHosting is disconnected. DNS records are unchanged; remove or redirect any old CNAME at your DNS provider.`;
 if(c.state==='disconnecting')return `${header}\n${c.detail}\nLocal routing is disabled. Provider cleanup is unresolved. Use /disconnect-hosting ${c.id} to retry known-resource cleanup. Unknown provider outcomes need operator reconciliation. DNS records are unchanged.`;
 if(['creating','uncertain'].includes(c.state))return `${header}\n${c.detail}\nCreation is unresolved; it will not be automatically retried or adopted by hostname. Operator reconciliation is required. Use /disconnect-hosting ${c.id} to disable local routing.`;
 return `${header}\n${c.detail}\nLast check: ${c.checkedAt||'not yet checked'}. This is a saved status; it may change.\n\nDNS-only CNAME: ${c.hostname} → ${c.target}. Keep the TXT proof current. Moving this hostname changes where website traffic goes. Use /dns-zones and /review-routing ${c.id} ZONE_ID for a reviewed Cloudflare CNAME, or configure DNS at your provider.\n/check-hosting ${c.id} rechecks DNS, hostname and TLS; failed checks disable local routing. /disconnect-hosting ${c.id} disables local routing and removes the known provider hostname, without changing DNS or the project's shared publication URL.`;
}
/** Defer all operations until the chat turn is durably claimed. Never pass options into model context. */
export function hostingChatCommand(db:D1Database,user:string,turnId:string,command:string,options:HostingChatOptions={}){
 const [verb,...args]=command.split(/\s+/);
 if(!['/hosting','/review-hosting','/confirm-hosting','/check-hosting','/disconnect-hosting'].includes(verb))return;
 if(verb==='/hosting'?args.length:args.length!==1||!/^[0-9a-f-]{36}$/.test(args[0]))throw new DomainError(400,'Use /hosting, /review-hosting CLAIM_ID, /confirm-hosting CONNECTION_ID, /check-hosting CONNECTION_ID or /disconnect-hosting CONNECTION_ID.');
 return async()=>{
  try{
   if(verb==='/hosting'){const connections=await hostingConnections(db,user);return (connections.length?connections.map(describe).join('\n\n'):'No hosting connections yet.')+'\n\n'+(options.hosting?'Use /domains for ownership claim IDs, then /review-hosting CLAIM_ID. Reviews do not create a provider hostname.':'Domain hosting is awaiting platform configuration.')+' These commands use no AI units.';}
   if(verb==='/review-hosting')return describe(await reviewHosting(db,user,turnId,args[0],options.hosting));
   if(verb==='/confirm-hosting')return describe(await confirmHosting(db,user,args[0],options.hosting,options.hostingTransport));
   if(verb==='/disconnect-hosting')return describe(await disconnectHosting(db,user,args[0],options.hosting,options.hostingTransport));
   const connections=await hostingConnections(db,user),c=connections.find(c=>c.id===args[0]);if(!c)throw new DomainError(404,'Domain connection not found.');
   // A check cannot confirm a review, create a hostname, or retry provider deletion.
   if(!['active','needs_check','provisioning'].includes(c.state))return describe(c)+'\nThis check did not create or remove a provider hostname.';
   return describe(await refreshHosting(db,user,c.id,options.hosting,options.hostingTransport,false));
  }catch(cause){return cause instanceof DomainError?cause.message+'\nUse /hosting to inspect saved connections.':'The hosting command result could not be saved. Use /hosting to inspect connections. This chat message will not be dispatched again.';}
 };
}
