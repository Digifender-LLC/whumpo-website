// Component acceptance fixture only; it creates no server interaction or action.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ConversionSummary,LeadEditor,LeadFilters,overdue,type Lead,type LeadChanges} from '../../frontend/src/records-panel';
import {APIError} from '../../frontend/src/lib/api';
import '../../frontend/src/styles.css';
const today='2026-10-31';
const fresh:Lead={stage:'new',note:'',dueDate:null,revision:0};
/** Stands in for the list route: a save advances the revision and re-keys the editor, as RecordList does after its refetch. */
function Harness({id,start,editable=true,fail,sameRevision=false}:{id:string;start:Lead;editable?:boolean;fail?:'stale'|'down';sameRevision?:boolean}){
 const [lead,setLead]=useState(start),[saves,setSaves]=useState<LeadChanges[]>([]);
 const save=async(changes:LeadChanges)=>{
  if(fail==='stale')throw new APIError('This module changed. Reload it and try again.',409,'stale_configuration');
  if(fail==='down')throw new APIError('This request could not finish.',503,'unresolved');
  setSaves(s=>[...s,changes]);setLead(l=>({stage:changes.stage??l.stage,note:changes.note??l.note,dueDate:Object.hasOwn(changes,'dueDate')?changes.dueDate!:l.dueDate,revision:l.revision+1}));
 };
 return <div id={id}><LeadEditor id={'lead-'+id} lead={lead} editable={editable} today={today} onSave={save} onReload={()=>{if(!sameRevision)setLead({...start,revision:start.revision+5});}}/><output id={id+'-log'} hidden>{JSON.stringify(saves)}</output></div>;
}
function Filters(){const [f,setF]=useState({stage:'',due:''});return <div id="filters"><LeadFilters stage={f.stage} due={f.due} onChange={setF}/><output id="filter-state">{f.stage||'all'}|{f.due||'any'}</output></div>;}
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-[900px] space-y-6 p-4">
 <Filters/>
 <Harness id="fresh" start={fresh}/>
 <Harness id="late" start={{stage:'contacted',note:'Call back about the quote.',dueDate:'2026-10-20',revision:2}}/>
 <Harness id="closed" start={{stage:'won',note:'',dueDate:'2026-10-20',revision:3}}/>
 <Harness id="conflict" start={fresh} fail="stale"/>
 <Harness id="config" start={fresh} fail="stale" sameRevision/>
 <Harness id="down" start={fresh} fail="down"/>
 <Harness id="plan" start={{stage:'qualified',note:'Kept for reading.',dueDate:'2026-11-05',revision:1}} editable={false}/>
 <div id="conv-ok"><ConversionSummary data={{eligible:true,windowDays:30,keptDays:90,since:'2026-10-01T00:00:00.000Z',submitted:12,stages:{new:5,contacted:2,qualified:2,won:3,lost:0},partial:false}}/></div>
 <div id="conv-partial"><ConversionSummary data={{eligible:true,windowDays:30,keptDays:30,since:'2026-10-25T00:00:00.000Z',submitted:1,stages:{new:1,contacted:0,qualified:0,won:0,lost:0},partial:true}}/></div>
 <div id="conv-empty"><ConversionSummary data={{eligible:true,windowDays:30,keptDays:30,since:'2026-01-01T00:00:00.000Z',submitted:0,stages:{new:0,contacted:0,qualified:0,won:0,lost:0},partial:false}}/></div>
 <div id="conv-plan"><ConversionSummary data={{eligible:false,windowDays:30,keptDays:30,since:'2026-01-01T00:00:00.000Z'}}/></div>
 <div id="conv-fail"><ConversionSummary failed/></div>
 <output id="overdue-rule">{String([overdue({stage:'new',dueDate:'2026-10-30'},today),overdue({stage:'new',dueDate:today},today),overdue({stage:'lost',dueDate:'2026-10-30'},today),overdue({stage:'new',dueDate:null},today)])}</output>
</main>);
