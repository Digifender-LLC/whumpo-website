import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Check,Copy,Download,KeyRound,LifeBuoy,Printer} from 'lucide-react';
import {Button} from '../components/ui/button';
import {arrival,calm} from '../journey/motion';
import type {PreparedIdentityKit,IdentityOffer} from '../lib/identity';
/** Setup's real state as one list. The newest saved passkey lands here after the server confirms it, never before. */
export function Keyring({keys,kit}:{keys:{id:string;name:string}[];kit:'none'|'unsaved'|'lost'|'saved'}){
 const list=useRef<HTMLUListElement>(null),kitSaved=kit==='saved';
 useLayoutEffect(()=>{
  const badge=list.current?.querySelector(`li:nth-child(${kitSaved?keys.length+1:keys.length}) .journey-key-badge`);
  if(!badge||calm())return;
  const moment=badge.animate([{opacity:0,transform:'scale(.5)'},{opacity:1,transform:'none'}],{...arrival,delay:280,fill:'backwards'});
  return()=>moment.cancel();
 },[keys.length,kitSaved]);
 return <ul ref={list} className="journey-keyring" data-compact={keys.length>=2||undefined}>
  {keys.map(key=><li key={key.id} data-state="saved"><span className="journey-key-badge"><Check className="size-5"/></span><span className="min-w-0"><span className="block font-medium break-words">{key.name}</span><span className="block text-xs text-ink-muted">Saved for this setup</span></span></li>)}
  {Array.from({length:Math.max(0,2-keys.length)},(_,index)=><li key={index} data-state="empty"><span className="journey-key-badge"><KeyRound className="size-5"/></span><span className="min-w-0"><span className="block font-medium">{keys.length+index?'Second passkey':'First passkey'}</span><span className="block text-xs text-ink-muted">Use a different device or provider</span></span></li>)}
  <li data-state={kitSaved?'saved':'empty'}><span className="journey-key-badge">{kitSaved?<Check className="size-5"/>:<LifeBuoy className="size-5"/>}</span><span className="min-w-0"><span className="block font-medium">Recovery kit</span><span className="block text-xs text-ink-muted">{kitSaved?'Marked as saved':kit==='unsaved'?'Ready for you to save':kit==='lost'?'Prepare a new kit':'Comes after your passkeys'}</span></span></li>
 </ul>;
}
export function IdentityKit({prepared,offer,busy,onSaved,onReplace}:{prepared:PreparedIdentityKit|null;offer:IdentityOffer;busy:boolean;onSaved:()=>void;onReplace:()=>void}){
 const [note,setNote]=useState(''),printFrame=useRef<HTMLIFrameElement|null>(null),urls=useRef(new Set<string>());
 useEffect(()=>{const discard=()=>{for(const url of urls.current)URL.revokeObjectURL(url);urls.current.clear();printFrame.current?.remove();printFrame.current=null;};window.addEventListener('pagehide',discard);return()=>{window.removeEventListener('pagehide',discard);discard();};},[]);
 useEffect(()=>{setNote('');},[offer.id,offer.saved]);
 const text=prepared?.offer?.id===offer.id?prepared.text:null;
 async function copy(){try{if(text)await navigator.clipboard.writeText(text);setNote('Copied. Store the kit somewhere separate from your passkeys.');}catch{setNote('Copy did not finish. Use Download, or select the recovery key below.');}}
 function download(){if(!text)return;const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));urls.current.add(url);const a=document.createElement('a');a.href=url;a.download='whumpo-recovery-kit.txt';a.click();setTimeout(()=>{URL.revokeObjectURL(url);urls.current.delete(url);},1000);setNote('Save the downloaded kit somewhere private, separate from your passkeys.');}
 function print(){
  if(!text)return;printFrame.current?.remove();const frame=document.createElement('iframe');frame.title='Recovery kit print view';frame.style.cssText='position:fixed;width:1px;height:1px;left:-9999px;border:0';document.body.append(frame);printFrame.current=frame;
  const doc=frame.contentDocument,win=frame.contentWindow;if(!doc||!win){frame.remove();setNote('The print view could not open. You can download a text copy instead.');return;}
  doc.title='Whumpo recovery kit';const style=doc.createElement('style');style.textContent='body{padding:24px;color:CanvasText;background:Canvas;font:14px/1.6 sans-serif}pre{white-space:pre-wrap;overflow-wrap:anywhere}';const pre=doc.createElement('pre');pre.textContent=text;doc.head.append(style);doc.body.append(pre);
  win.addEventListener('afterprint',()=>{frame.remove();if(printFrame.current===frame)printFrame.current=null;},{once:true});win.focus();win.print();setNote('Printing is optional. Confirm below only after saving a copy.');
 }
 return <section className="space-y-5" aria-labelledby="kit-heading"><h2 id="kit-heading" data-identity-step tabIndex={-1} className="text-heading font-semibold focus-visible:outline-2 focus-visible:outline-focus-ring">{offer.saved?'Your kit is saved':'Save your recovery kit'}</h2><p className="text-sm text-ink-muted">Keep it private and separate from your passkeys. This kit becomes active only when Whumpo confirms setup or replacement. Until then, keep your current kit.</p>
 {text?<><div className="grid grid-cols-1 sm:grid-cols-3 gap-2"><Button variant="secondary" disabled={busy} onClick={download}><Download className="size-4"/>Download</Button><Button variant="secondary" disabled={busy} onClick={()=>void copy()}><Copy className="size-4"/>Copy</Button><Button variant="secondary" disabled={busy} onClick={print}><Printer className="size-4"/>Print / PDF</Button></div><details className="rounded-md border px-4"><summary className="min-h-11 flex cursor-pointer items-center text-sm font-medium">Show private recovery key</summary><p className="font-mono text-sm break-all select-all pb-4">{prepared!.key}</p></details></>:!offer.saved?<p className="text-sm">This unsaved kit can’t be shown again. If you did not save a copy, prepare a new one.</p>:null}
 <p role="status" className="text-sm text-ink-muted">{note}</p>{!offer.saved&&<Button className="w-full min-h-12 whitespace-normal" disabled={busy} onClick={onSaved}>I’ve saved my recovery kit</Button>}<Button variant="quiet" disabled={busy} onClick={onReplace}>Prepare a different kit</Button><p className="text-xs text-ink-muted">This confirmation doesn’t verify your backup. Whumpo cannot retrieve this key for you. It restores account access, not separately encrypted content keys. Never share it in Chat or with support.</p></section>;
}
