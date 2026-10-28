import {DomainError} from './domains';
import {reviewedReply,reviewChangedMessage} from './chat-review-receipts';
import {hostingConnections,reviewHosting,confirmHosting,refreshHosting,disconnectHosting,type HostingConfig} from './domain-hosting';
export type HostingChatOptions={hosting?:HostingConfig;hostingTransport?:typeof fetch};
type Receipt=Awaited<ReturnType<typeof reviewHosting>>;
function describe(c:Receipt){
 const header=`Hosting for ${c.hostname}: ${c.connected?'connected':c.state}\nConnection: ${c.id}\nProject: ${c.projectId}\nCertificate: ${c.certificateStatus||'not requested'}`;
 if(c.state==='review')return `${header}\n\nConfirming requests a hostname and TLS certificate. Once DNS and certificate checks pass, this hostname serves the project's current published version, including future publication changes. This does not change DNS records or buy a domain.\nReview expires: ${c.expiresAt}\n\nAuthorize this exact connection or cancel the review in Dashboard → Domains.`;
 if(c.state==='expired')return `${header}\nReview expired. Ask to prepare a new hosting review for this ownership proof.`;
 if(c.state==='disconnected')return `${header}\n${c.detail}\nHosting is disconnected. DNS records are unchanged; remove or redirect any old CNAME at your DNS provider.`;
 if(c.state==='disconnecting')return `${header}\n${c.detail}\nLocal routing is disabled. Provider cleanup is unresolved. Use the saved connection’s disconnect control in Dashboard → Domains to retry known-resource cleanup. Unknown provider outcomes need operator reconciliation. DNS records are unchanged.`;
 if(['creating','uncertain'].includes(c.state))return `${header}\n${c.detail}\nCreation is unresolved; it will not be automatically retried or adopted by hostname. Operator reconciliation is required. Use the saved connection’s disconnect control in Dashboard → Domains to disable local routing.`;
 return `${header}\n${c.detail}\nLast check: ${c.checkedAt||'not yet checked'}. This is a saved status; it may change.\n\nDNS-only CNAME: ${c.hostname} → ${c.target}. Keep the TXT proof current. Moving this hostname changes where website traffic goes. Ask to review a Cloudflare routing record in an authorized zone, or configure DNS at your provider.\nUse this connection’s controls in Dashboard → Domains to recheck DNS, hostname and TLS, or disconnect it. Failed checks disable local routing. Disconnecting also removes the known provider hostname; DNS and the project’s shared publication URL stay unchanged.`;
}
/** Defer all operations until the chat turn is durably claimed. Never pass options into model context. */
export function hostingChatCommand(db:D1Database,user:string,turnId:string,command:string,options:HostingChatOptions={}){
 const [verb,...args]=command.split(/\s+/);
 if(!['/hosting','/review-hosting','/confirm-hosting','/check-hosting','/disconnect-hosting'].includes(verb))return;
 if(verb==='/hosting'?args.length:args.length!==1||!/^[0-9a-f-]{36}$/.test(args[0]))throw new DomainError(400,"Choose a saved domain ownership proof or hosting connection to inspect, review or disconnect.");
 return async()=>{
  try{
   if(verb==='/hosting'){const connections=await hostingConnections(db,user);return (connections.length?connections.map(describe).join('\n\n'):'No hosting connections yet.')+'\n\n'+(options.hosting?"Ask to choose an owned domain proof and prepare its hosting review. Preparing a review does not create a provider hostname.":'Domain hosting is awaiting platform configuration.');}
   if(verb==='/review-hosting')return describe(await reviewHosting(db,user,turnId,args[0],options.hosting));
   if(verb==='/confirm-hosting'){if(!await reviewedReply(db,user,'hosting',args[0]))throw new DomainError(409,reviewChangedMessage);return describe(await confirmHosting(db,user,args[0],options.hosting,options.hostingTransport));}
   if(verb==='/disconnect-hosting')return describe(await disconnectHosting(db,user,args[0],options.hosting,options.hostingTransport));
   const connections=await hostingConnections(db,user),c=connections.find(c=>c.id===args[0]);if(!c)throw new DomainError(404,'Domain connection not found.');
   // A check cannot confirm a review, create a hostname, or retry provider deletion.
   if(!['active','needs_check','provisioning'].includes(c.state))return describe(c)+'\nThis check did not create or remove a provider hostname.';
   return describe(await refreshHosting(db,user,c.id,options.hosting,options.hostingTransport,false));
  }catch(cause){return cause instanceof DomainError?cause.message+"\nAsk to inspect the saved hosting connection.":"The hosting result could not be saved. Ask to inspect the saved connection. This request will not be dispatched again.";}
 };
}
