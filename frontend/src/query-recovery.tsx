import {Button} from './components/ui/button';

/** Read retries never resubmit a message, approval or other mutation. */
export function QueryRecovery({name,error,fetching,hasData,retry}:{name:string;error:unknown;fetching:boolean;hasData:boolean;retry:()=>Promise<boolean>}){
 if(error)return <div className="rounded-xl border bg-card p-4 space-y-3 text-sm">
  <p role="alert">{hasData?`Couldn’t refresh your ${name}. The last loaded view is still shown.`:`Couldn’t load your ${name}. Check your connection and try again.`}</p>
  <Button type="button" variant="outline" size="sm" disabled={fetching} onClick={async event=>{
   const button=event.currentTarget,surface=button.closest<HTMLElement>('[data-recovery-surface]');
   if(await retry()){
    // Restore keyboard position after the retry control disappears, unless the
    // person moved elsewhere while this read was in flight.
    if(surface?.isConnected&&(document.activeElement===button||document.activeElement===document.body))surface.focus();
   }
  }} aria-label={`Retry ${name}`}>{fetching?'Trying again…':`Retry ${name}`}</Button>
 </div>;
 if(!hasData)return <p role="status" className="text-sm text-muted-foreground">Opening your {name}…</p>;
 return null;
}
