import {useRef,useState} from 'react';
import {send,message} from './lib/api';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from './components/ui/dialog';

export function VisitorErasure({project,projectName,visitor,onErased}:{project:string;projectName:string;visitor:string;onErased:()=>Promise<unknown>}){
 const [open,setOpen]=useState(false),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef<string|null>(null),lock=useRef(false);
 async function erase(){
  if(lock.current||confirmation!=='ERASE')return;lock.current=true;setBusy(true);setError('');request.current??=crypto.randomUUID();
  try{await send(`/projects/${project}/application-access/visitors/${visitor}/erase`,{id:request.current,confirmation});await onErased();setOpen(false);}
  catch(e){setError(message(e));}finally{lock.current=false;setBusy(false);}
 }
 return <><Button variant="outline" className="min-h-11" onClick={()=>setOpen(true)}>Erase retained data</Button><Dialog open={open} onOpenChange={v=>{if(!busy){setOpen(v);if(!v){setConfirmation('');setError('');}}}}><DialogContent><DialogHeader><DialogTitle>Erase this revoked visitor?</DialogTitle><DialogDescription>This permanently removes their saved document, execution history, passkeys, recovery codes, sessions and used invitation. There is no restore. Other visitors and the app itself are unchanged.</DialogDescription></DialogHeader>
  <p className="text-sm font-medium break-words">{projectName}</p><p className="text-sm break-all">Visitor: {visitor}</p><p className="text-xs text-muted-foreground">Aggregate usage totals remain. A receipt with account and visitor identifiers is retained for 30 days for audit and safe retries. This does not erase provider backups or copies already exported.</p>
  <label className="space-y-2 text-sm font-medium">Type ERASE to confirm<Input value={confirmation} onChange={e=>setConfirmation(e.target.value)} disabled={busy} autoComplete="off" autoCapitalize="characters" spellCheck={false} className="min-h-11"/></label>
  {error&&<p role="alert" className="text-sm text-destructive">{error} Retrying uses the same request.</p>}
  <DialogFooter><Button variant="ghost" disabled={busy} onClick={()=>{setOpen(false);setConfirmation('');setError('')}}>Cancel</Button><Button variant="destructive" disabled={busy||confirmation!=='ERASE'} onClick={()=>void erase()} className="min-h-11">{busy?'Erasing…':'Permanently erase visitor'}</Button></DialogFooter>
 </DialogContent></Dialog></>;
}
