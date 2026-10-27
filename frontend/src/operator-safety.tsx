import {ReturnLink} from './navigation-links';
import {useEffect,useRef,useState} from 'react';
import {Brand} from './components/brand';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Label} from './components/ui/label';
import {identityCeremony} from './lib/identity';
import {identityGeneration} from './lib/identity-invalidation';
import {operatorSafetyRead,opaqueReference,type OperatorReadAction,type OperatorReadResult} from './lib/operator-safety';

const wrap='min-h-11 h-auto whitespace-normal text-left';
type Row=Record<string,unknown>;
const text=(value:unknown)=>value===null||value===undefined?'—':typeof value==='boolean'?(value?'yes':'no'):typeof value==='number'&&value>1e9&&value<1e10?new Date(value*1000).toISOString():String(value);
function Table({rows,columns,label}:{rows:Row[];columns:string[];label:string}){
 if(!rows.length)return <p className="text-sm">None.</p>;
 return <div className="overflow-x-auto rounded-md border"><table className="w-full text-sm" aria-label={label}><thead><tr>{columns.map(c=><th key={c} scope="col" className="p-2 text-left font-medium">{c}</th>)}</tr></thead>
  <tbody>{rows.map((row,i)=><tr key={i} className="border-t">{columns.map(c=><td key={c} className="p-2 break-all align-top">{text(row[c])}</td>)}</tr>)}</tbody></table></div>;
}
function Outcome({result,children}:{result:OperatorReadResult|null;children:(value:unknown)=>React.ReactNode}){
 if(!result)return null;
 if(result.state==='restricted')return <p role="status" className="rounded-md border p-3 text-sm">This read is restricted to a safety-case role you do not hold.</p>;
 if(result.state==='not_found')return <p role="status" className="rounded-md border p-3 text-sm">Not found.</p>;
 if(result.state==='error')return <p role="alert" className="rounded-md border p-3 text-sm">{result.message}</p>;
 return <>{children(result.result)}</>;
}

/** WH-132 minimal restricted case review. Read-only over the existing operator API; every read is role-gated, needs a
 * fresh passkey proof and is audited on the server. Not linked from customer navigation; nothing is cached or stored. */
export function OperatorSafetyPage(){
 const heading=useRef<HTMLHeadingElement>(null),mounted=useRef(true);
 const [busy,setBusy]=useState(false),[holds,setHolds]=useState<OperatorReadResult|null>(null),[retention,setRetention]=useState<OperatorReadResult|null>(null),[caseId,setCaseId]=useState(''),[caseResult,setCaseResult]=useState<OperatorReadResult|null>(null);
 const [audit,setAudit]=useState<OperatorReadResult|null>(null),[disclosure,setDisclosure]=useState<OperatorReadResult|null>(null),[inputError,setInputError]=useState('');
 useEffect(()=>{mounted.current=true;document.title='Restricted case review — Whumpo';heading.current?.focus();return()=>{mounted.current=false;};},[]);
 async function read(action:OperatorReadAction,input:Record<string,string>,set:(r:OperatorReadResult|null)=>void){
  if(busy)return;const generation=identityGeneration();setBusy(true);set(null);
  try{const result=await operatorSafetyRead(action,input,{fetch:(url,init)=>fetch(url,init),reauth:()=>identityCeremony('reauth')});if(mounted.current&&generation===identityGeneration())set(result);}
  catch(e){if(mounted.current)set({state:'error',message:e instanceof Error?e.message:'This restricted read could not finish.'});}
  finally{if(mounted.current)setBusy(false);}
 }
 function openCase(id:string){
  if(!opaqueReference.test(id)){setInputError('Use an opaque case identifier (letters, digits, _ . : -, up to 128).');return;}
  setInputError('');setCaseId(id);setAudit(null);setDisclosure(null);void read('cases/read',{caseId:id},setCaseResult);
 }
 return <main className="min-h-dvh bg-background px-5 py-6 sm:px-8 sm:py-9"><div className="mx-auto max-w-4xl space-y-8">
  <Brand/><ReturnLink/>
  <header><h1 ref={heading} tabIndex={-1} className="text-3xl font-bold">Restricted case review</h1>
   <p className="mt-3 text-muted-foreground">Read-only. Only named safety-case operators can read here; each read needs a recent passkey check and is written to the case audit. Identifiers and digests only: no evidence bytes, messages or customer content are shown.</p></header>
  <section aria-labelledby="op-holds" className="space-y-3"><h2 id="op-holds" className="text-xl font-bold">Active preservation holds</h2>
   <Button variant="secondary" className={wrap} disabled={busy} onClick={()=>void read('holds/list',{},setHolds)}>List active holds</Button>
   <Outcome result={holds}>{value=><ul className="grid gap-2">{(value as Row[]).length?(value as Row[]).map(h=><li key={String(h.id)} className="rounded-md border p-3 text-sm space-y-1"><p className="break-all">Hold {text(h.id)} · {text(h.scope)} · review due {text(h.reviewDueAt)}{h.overdue?' · overdue (still in force)':''}</p><Button variant="quiet" className={wrap} disabled={busy} onClick={()=>openCase(String(h.caseId))}>Open case {text(h.caseId)}</Button></li>):<li className="text-sm">No active holds.</li>}</ul>}</Outcome></section>
  <section aria-labelledby="op-retention" className="space-y-3"><h2 id="op-retention" className="text-xl font-bold">Retention reviews due</h2>
   <p className="text-sm text-muted-foreground">Cases and evidence are kept for one year by default (pending counsel). Cases past their term are listed here as due for review; nothing is released or deleted until a preservation approver decides through the operator API.</p>
   <Button variant="secondary" className={wrap} disabled={busy} onClick={()=>void read('retention/list',{},setRetention)}>List retention reviews</Button>
   <Outcome result={retention}>{value=><ul className="grid gap-2">{(value as Row[]).length?(value as Row[]).map(i=><li key={String(i.caseId)} className="rounded-md border p-3 text-sm space-y-1"><p className="break-all">Case {text(i.caseId)} · {i.status==='retention_review_due'?'retention review due':'released, evidence awaiting disposal'} · due {text(i.retentionDueAt)}</p><p className="break-all">Closed {text(i.closedAt)} · {text(i.storedEvidence)} stored evidence objects · {text(i.activeHolds)} active holds · {text(i.openDisclosures)} open disclosures · {i.releasable?'can be released':'cannot be released yet'}</p><Button variant="quiet" className={wrap} disabled={busy} onClick={()=>openCase(String(i.caseId))}>Open case {text(i.caseId)}</Button></li>):<li className="text-sm">No retention reviews are due.</li>}</ul>}</Outcome></section>
  <section aria-labelledby="op-case" className="space-y-3"><h2 id="op-case" className="text-xl font-bold">Case</h2>
   <form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();openCase(String(new FormData(e.currentTarget).get('case')??'').trim());}}>
    <div className="grid gap-2"><Label htmlFor="op-case-id">Case identifier</Label><Input id="op-case-id" name="case" autoComplete="off" spellCheck={false} maxLength={128} required/></div>
    <Button type="submit" className={wrap} disabled={busy}>Read case</Button></form>
   {inputError&&<p role="alert" className="text-sm">{inputError}</p>}
   <Outcome result={caseResult}>{value=>{const c=value as Row&{findings:Row[];holds:Row[];evidenceObjects:Row[];disclosures:Row[];evidenceIds:string[];retention:{dueAt:number;released:boolean;reviewDue:boolean;decisions:Row[]}};return <div className="space-y-4">
    <dl className="grid gap-1 text-sm">{['id','subjectUserId','intakeRef','openedBy','openedAt','closedAt','currentFinding'].map(k=><div key={k}><dt className="inline font-medium">{k}: </dt><dd className="inline break-all">{text(c[k])}</dd></div>)}</dl>
    <h3 className="font-bold">Retention</h3><p className="text-sm">Due {text(c.retention.dueAt)}{c.retention.released?' · released':c.retention.reviewDue?' · review due':''}</p>
    <Table label="Retention decisions" rows={c.retention.decisions} columns={['seq','decision','reviewedDueAt','nextDueAt','decisionRef','decidedBy','decidedAt']}/>
    <h3 className="font-bold">Findings</h3><Table label="Findings" rows={c.findings} columns={['seq','finding','reviewerRef','decisionRef','recordedAt']}/>
    <h3 className="font-bold">Holds</h3><Table label="Holds" rows={c.holds} columns={['id','scope','projectId','fileId','legalBasisRef','approvedBy','placedAt','reviewDueAt','active','overdue','releasedAt']}/>
    <h3 className="font-bold">Linked evidence</h3><p className="text-sm break-all">{c.evidenceIds.length?c.evidenceIds.join(', '):'None.'}</p>
    <h3 className="font-bold">Evidence objects</h3><Table label="Evidence objects" rows={c.evidenceObjects} columns={['id','source','sourceRef','contentType','sha256','size','capturedBy','retentionDueAt','storedAt','disposedAt']}/>
    <h3 className="font-bold">Disclosures</h3>{c.disclosures.length?<ul className="grid gap-2">{c.disclosures.map(d=><li key={String(d.id)} className="text-sm"><span className="break-all">{text(d.id)} · {text(d.state)} · {text(d.itemCount)} items </span><Button variant="quiet" className={wrap} disabled={busy} onClick={()=>void read('disclosures/read',{disclosureId:String(d.id),caseId},setDisclosure)}>Read manifest</Button></li>)}</ul>:<p className="text-sm">None.</p>}
    <Outcome result={disclosure}>{m=>{const d=m as Row&{items:Row[]};return <div className="space-y-2"><dl className="grid gap-1 text-sm">{['id','state','legalProcessRef','recipientRef','manifestSha256','requestedBy','approvedBy','closedAt','closeRef'].map(k=><div key={k}><dt className="inline font-medium">{k}: </dt><dd className="inline break-all">{text(d[k])}</dd></div>)}</dl><Table label="Manifest items" rows={d.items} columns={['id','sha256','size','contentType']}/></div>;}}</Outcome>
    <Button variant="secondary" className={wrap} disabled={busy} onClick={()=>void read('cases/audit',{caseId},setAudit)}>Read case audit</Button>
    <Outcome result={audit}>{rows=><Table label="Case audit" rows={rows as Row[]} columns={['seq','at','actorRef','action','targetRef','outcome','reason']}/>}</Outcome>
   </div>;}}</Outcome></section>
 </div></main>;
}
