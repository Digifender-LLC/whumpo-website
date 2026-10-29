import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,message,send} from './lib/api';
import {Button} from './components/ui/button';

type Summary={version:1;provider:string;operationId:string;destination:string;expiresAt:string;state:string};
const body=(interactionId:string,digest:string)=>JSON.stringify({version:1,interactionId,definitionDigest:digest,cardId:'lookup-consent'});
const where=(d:string)=>d==='model-context'?'Whumpo’s assistant':'your private panel';

/** WH-143. Shows what one exact lookup is and lets only the signed-in owner confirm it once. Parameters, credentials and results never appear here. */
export function ChatLookupConsent({interactionId,digest,disabled}:{interactionId:string;digest:string;disabled:boolean}){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const query=useQuery({queryKey:['chat-lookup-consent',interactionId,digest],queryFn:({signal})=>api<Summary>('/chat/interactions/v1/lookup-consent',{method:'POST',body:body(interactionId,digest),signal}),staleTime:0,gcTime:0,retry:false});
 const s=query.data;
 async function confirm(){
  setBusy(true);setNotice('');
  try{await send('/chat/interactions/v1/lookup-consent-confirm',JSON.parse(body(interactionId,digest)));await query.refetch();}
  catch(error){setNotice(message(error));}
  finally{setBusy(false);}
 }
 return <div className="space-y-3 min-w-0">
  {query.isFetching&&!s?<p role="status" className="text-sm">Checking this lookup…</p>:query.error?<p role="alert" className="text-sm">{message(query.error)}</p>:s&&<>
   <dl className="grid gap-1 text-sm"><div><dt className="inline font-medium">Account: </dt><dd className="inline">{s.provider}</dd></div><div><dt className="inline font-medium">Lookup: </dt><dd className="inline">{s.operationId}</dd></div><div><dt className="inline font-medium">Results go to: </dt><dd className="inline">{where(s.destination)}</dd></div><div><dt className="inline font-medium">Valid until: </dt><dd className="inline">{new Date(s.expiresAt).toLocaleTimeString()}</dd></div></dl>
   {s.state==='issued'?<Button type="button" className="min-h-11" disabled={disabled||busy} onClick={()=>void confirm()}>Allow this lookup once</Button>
    :<p role="status" className="text-sm">{s.state==='confirmed'?'Confirmed. It can run once.':s.state==='used'?'This lookup has run. Ask again for another.':s.state==='expired'?'This lookup request expired. Ask Whumpo again.':'This lookup request is closed.'}</p>}
  </>}
  {notice&&<p role="alert" className="text-sm">{notice}</p>}
 </div>;
}
