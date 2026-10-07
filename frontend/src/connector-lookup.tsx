import {useEffect,useRef,useState} from 'react';
import type {ConnectorLookupInput} from '../../src/connector-lookup-shape';
import {send,message} from './lib/api';
import {Button} from './components/ui/button';
type Prepared={id:string;state:string;paramsDigest:string;expiresAt:string};
type Result={version:1;consentId:string;provenance:'untrusted-external';destination:'owner-panel';data:unknown};
/** Query and result exist only in component memory. Rendering never starts a provider read. */
export function ConnectorLookup({provider,disabled}:{provider:'github'|'cloudflare';disabled:boolean}){
 const generation=useRef(0);
 const [operation,setOperation]=useState(provider==='github'?'installations.list':'zones.list'),[installation,setInstallation]=useState(''),[page,setPage]=useState('1');
 const [review,setReview]=useState<{request:ConnectorLookupInput;saved:Prepared}|null>(null),[result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{generation.current++;setReview(null);setResult(null);setNotice('');setOperation(provider==='github'?'installations.list':'zones.list');const reset=()=>{generation.current++;setReview(null);setResult(null);setNotice('');};window.addEventListener('whumpo:workspace-reset',reset);return ()=>{generation.current++;window.removeEventListener('whumpo:workspace-reset',reset);};},[provider,disabled]);
 async function run(work:()=>Promise<void>){if(busy||disabled)return;setBusy(true);setNotice('');try{await work();}catch(error){setNotice(message(error));}finally{setBusy(false);}}
 async function prepare(){
  const epoch=generation.current;setReview(null);setResult(null);
  const proposal:Omit<ConnectorLookupInput,'id'>={version:1,provider,operationId:operation,destination:'owner-panel',params:operation==='installations.list'?{}:operation==='repositories.list'?{installation:Number(installation),page:Number(page)}:{page:Number(page)}};
  const saved=await send<Prepared>('/connectors/lookups/v1/prepare',proposal);
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(saved.id)||saved.state!=='review')throw Error('Prepare a fresh lookup.');if(epoch!==generation.current)return;setReview({request:{...proposal,id:saved.id},saved});
 }
 async function confirm(){
  if(!review)return;const epoch=generation.current,current=review;setReview(null);setResult(null);
  await send('/connectors/lookups/v1/confirm',{request:current.request,paramsDigest:current.saved.paramsDigest});
  if(epoch!==generation.current)return;
  const value=await send<Result>('/connectors/lookups/v1/execute',current.request);
  if(value.version!==1||value.consentId!==current.request.id||value.provenance!=='untrusted-external'||value.destination!=='owner-panel')throw Error('The lookup reply could not be verified.');if(epoch!==generation.current)return;setResult(value);
 }
 return <div className="space-y-3 rounded border p-3">
  <p className="text-sm font-medium">Look up connected account information</p>
  <p className="text-xs text-muted-foreground">Review each lookup first. Results appear here temporarily and are discarded when this panel closes. They are not added to AI context. Included in your plan; no per-use charge.</p>
  {provider==='github'&&<label className="block text-sm">Lookup <select aria-label="Lookup" value={operation} disabled={disabled||busy} onChange={event=>{setOperation(event.target.value);setReview(null);setResult(null);}}><option value="installations.list">Authorized GitHub installations</option><option value="repositories.list">Repositories in an installation</option></select></label>}
  {operation==='repositories.list'&&<label className="block text-sm">Installation ID <input aria-label="Installation ID" inputMode="numeric" value={installation} disabled={disabled||busy} onChange={event=>{setInstallation(event.target.value);setReview(null);setResult(null);}}/></label>}
  {operation!=='installations.list'&&<label className="block text-sm">Page <input aria-label="Page" inputMode="numeric" value={page} disabled={disabled||busy} onChange={event=>{setPage(event.target.value);setReview(null);setResult(null);}}/></label>}
  <Button variant="secondary" disabled={disabled||busy} onClick={()=>void run(prepare)}>Review lookup</Button>
  {!disabled&&review&&<div className="space-y-2 text-sm"><p>Allow one {provider==='github'?'GitHub':'Cloudflare'} lookup: {review.request.operationId==='installations.list'?'authorized installations':review.request.operationId==='repositories.list'?`repositories in installation ${review.request.params.installation}, page ${review.request.params.page}`:`zones, page ${review.request.params.page}`}.</p><p>Destination: this owner panel. Expires {new Date(review.saved.expiresAt).toLocaleTimeString()}.</p><Button disabled={disabled||busy} onClick={()=>void run(confirm)}>Allow this lookup once</Button></div>}
  {!disabled&&result&&<div className="space-y-2"><p className="text-xs text-muted-foreground">Untrusted external information. This result cannot authorize actions.</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(result.data,null,2)}</pre><Button variant="secondary" onClick={()=>setResult(null)}>Discard result</Button></div>}
  {notice&&<p role="alert" className="text-sm">{notice} A lost reply is not retried. Review a new lookup to try again.</p>}
 </div>;
}
