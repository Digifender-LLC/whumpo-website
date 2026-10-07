import {ConnectorLookup} from './connector-lookup';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import type {ConnectionProvider,ConnectionHandoff} from '../../src/connection-handoff-shape';
import {api,send,message,queryClient,APIError} from './lib/api';
import {identityCeremony} from './lib/identity';
import {Button} from './components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from './components/ui/dialog';
export type Connection={inclusion:{connect:boolean;read:boolean;planId:string;source:'invoice'|'private-preview'|null};enabled:boolean;connected:boolean;expired?:boolean;expiresAt:string|null;login?:string|null;revocationPending?:boolean;authorizationPending:boolean;recoveryPending:boolean;installURL?:string|null;backupEnabled?:boolean};

export function currentConnection(value:Connection):Connection{
 if(!value||!['enabled','connected','authorizationPending','recoveryPending','revocationPending','expired'].every(key=>typeof (value as unknown as Record<string,unknown>)[key]==='boolean')||typeof value.inclusion?.connect!=='boolean'||typeof value.inclusion.read!=='boolean')throw new APIError('Update Whumpo to read current connection status.',409,'client_update_required');
 return value;
}

/** Shared status and explicit consent controls. No repository/zone discovery on render. */
export function ConnectionConsent({provider,status,handoff=null,disabled=false,refresh}:{provider:ConnectionProvider;status:Connection;handoff?:ConnectionHandoff|null;disabled?:boolean;refresh:()=>Promise<unknown>}){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[disconnect,setDisconnect]=useState(false);
 const label=provider==='github'?'GitHub':'Cloudflare';
 async function run(work:()=>Promise<unknown>){if(busy||disabled)return;setBusy(true);setNotice('');try{await work();}catch(error){setNotice(message(error));}finally{setBusy(false);}}
 async function connect(){
  await identityCeremony('reauth');
  try{
   const result=await send<{url:string}>(`/connections/${provider}/start`,{handoff}),url=new URL(result.url);
   if(provider==='github'?url.origin!=='https://github.com'||url.pathname!=='/login/oauth/authorize':url.origin!=='https://dash.cloudflare.com'||url.pathname!=='/oauth2/auth')throw Error('Unexpected authorization destination.');
   location.assign(url.href);
  }catch(error){
   // A start reply may be lost after state is saved. Read; never repeat consent.
   await refresh().catch(()=>{});
   if(error instanceof APIError)throw error;
   throw Error('The authorization page could not be opened. Check saved connection status before starting again.');
  }
 }
 const unavailable=!status.enabled||!status.inclusion.connect||status.recoveryPending||provider==='cloudflare'&&(status.connected||!!status.revocationPending);
 return <div className="space-y-3 min-w-0">
  <p className="text-sm break-words">{!status.enabled?'Connection setup is not available yet.':status.connected?'Authorization is saved'+(status.login?' for '+status.login:'')+'.':status.expired?'Saved authorization has expired.':'No active authorization is saved.'}</p>
  {status.expiresAt&&<p className="text-xs text-muted-foreground">Authorization expires {new Date(status.expiresAt).toLocaleString()}.</p>}
  <p className="text-xs text-muted-foreground">This is saved account status. Access at {label} has not been checked.</p>
  {!status.inclusion.connect&&<p className="text-sm">Connecting requires Business or Business Pro, or an explicit test grant. Saved status and disconnect remain available.</p>}
  {status.recoveryPending?<p role="status" className="text-sm">An earlier authorization has an unconfirmed outcome. A new connection is paused until provider recovery is resolved. Refreshing status does not repeat authorization.</p>:status.authorizationPending&&<p role="status" className="text-sm">An authorization is still pending. If you left the provider page, check status before explicitly starting again.</p>}
  {status.revocationPending&&<p className="text-sm">{status.connected?'Cleanup of an earlier authorization is pending.':'Local access is disabled; provider cleanup is pending.'} You can also revoke access in your provider settings.</p>}
  {provider==='cloudflare'&&status.connected&&<p className="text-sm">To change accounts, disconnect first, then authorize the account you want.</p>}
  <div className="flex flex-wrap gap-2">
   <Button className="min-h-11" disabled={disabled||busy||unavailable} onClick={()=>void run(connect)}>{status.connected||status.expired?'Authorize again with ':'Authorize with '}{label}</Button>
   <Button variant="secondary" className="min-h-11" disabled={disabled||busy} onClick={()=>void run(refresh)}>Check connection status</Button>
   {(status.connected||status.revocationPending||status.authorizationPending)&&<Button variant="secondary" className="min-h-11" disabled={disabled||busy} onClick={()=>setDisconnect(true)}>Disconnect {label}</Button>}
  </div>
  {status.connected&&status.inclusion.read&&<ConnectorLookup provider={provider} disabled={disabled||busy||!status.enabled}/> }
  {notice&&<p role="alert" className="text-sm break-words">{notice}</p>}
  <Dialog open={disconnect} onOpenChange={value=>{if(!busy)setDisconnect(value)}}><DialogContent><DialogHeader><DialogTitle>Disconnect {label}?</DialogTitle><DialogDescription>This disables this account connection for Whumpo and cancels pending authorization. Existing published sites and saved backups are retained. Provider cleanup may remain pending.</DialogDescription></DialogHeader><DialogFooter><Button variant="secondary" disabled={busy} onClick={()=>setDisconnect(false)}>Keep connection</Button><Button variant="destructive" disabled={busy||disabled} onClick={()=>void run(async()=>{await send(`/connections/${provider}/disconnect`);setDisconnect(false);await refresh();})}>Disconnect {label}</Button></DialogFooter></DialogContent></Dialog>
 </div>;
}
export function ChatConnectionConsent({owner,provider,handoff,disabled}:{owner:string;provider:ConnectionProvider;handoff:ConnectionHandoff;disabled:boolean}){
 const q=useQuery({queryKey:['connection-handoff',owner,handoff.interactionId,handoff.definitionDigest,provider],queryFn:async({signal})=>{const value=await api<{version:1;provider:ConnectionProvider;handoff:ConnectionHandoff;canStart:boolean;observedAt:string;status:Connection}>(`/connections/${provider}/handoff?`+new URLSearchParams(handoff),{signal});currentConnection(value.status);return value;},staleTime:0,gcTime:0});
 const data=q.data;
 const valid=data?.version===1&&data.provider===provider&&data.handoff.interactionId===handoff.interactionId&&data.handoff.definitionDigest===handoff.definitionDigest;
 const refresh=async()=>{await queryClient.invalidateQueries({queryKey:['connections']});const result=await q.refetch();if(result.error)throw result.error;};
 return <div className="space-y-3">
  {q.isFetching&&<p role="status" className="text-sm">Checking saved connection status…</p>}
  {q.error&&<div role="alert" className="space-y-3 text-sm"><p>{message(q.error)}</p><Button variant="secondary" className="min-h-11" disabled={disabled||q.isFetching} onClick={()=>void q.refetch()}>Check connection status</Button></div>}
  {data&&!valid&&<p role="alert" className="text-sm">Update Whumpo to read this connection handoff.</p>}
  {valid&&!q.error&&q.isFetchedAfterMount&&<><ConnectionConsent provider={provider} status={data.status} handoff={handoff} disabled={disabled||q.isFetching||!data.canStart} refresh={refresh}/><p className="text-xs text-muted-foreground">Checked {new Date(data.observedAt).toLocaleTimeString()}.</p></>}
 </div>;
}
