import {moduleCatalog} from '../project-specification/catalog';
import {prepareSpecification} from '../project-specification/store';
import type {ModuleInstance} from '../project-specification/v3/modules';
import {assertWorkspace} from '../workspace-identity/admission';
import {ModuleError} from './policy';
import {currentSpecification,instanceOf,publicFormState,registeredInstances} from './registry';
import type {RecordsSetup} from './shape';

/** WH-070 standard appointment request form (docs/shared-modules.md#owner-appointment-form-setup-wh-070--october-31-2026-utc).
 * Same shape as `files-setup.ts`: a typed owner Chat control (`appointmentFormReview`), never a model action and never
 * advertised to the site agent. It prepares the exact private website review that appends the project's one standard
 * records instance, through the existing `prepareSpecification`. Saving is the existing recent-sign-in `specificationApply`;
 * activation is the existing exact `moduleActivationReview`/`moduleActivationApply` pair. No review is skipped or combined.
 * The configuration is fixed (D31): instance `appointments`, one public form `appointment` over schema `appointment`, 90 days
 * retention, no access dependency and no view. Every field is owner-read: a field anyone else may read would need an access
 * dependency (`principalAudience`), and an anonymous submitter never reads a record back. `service` and `day` are the choice
 * keys the WH-158 receipt template binds. The `project_spec_appointment_setup_admit` trigger repeats this shape in the
 * commit. Deterministic: no inference or provider. */
export const standardAppointmentInstanceId='appointments';
export const standardAppointmentFormId='appointment';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

export function standardAppointmentInstance():Extract<ModuleInstance,{kind:'records'}>{
 const entry=moduleCatalog.find(x=>x.kind==='records');
 if(!entry||entry.state!=='available')throw new ModuleError('unavailable','The records module is not available right now.');
 return {id:standardAppointmentInstanceId,kind:'records',module:{...entry.module},schema:{...entry.schema},dependencies:[],config:{retentionDays:90,
  schemas:[{id:'appointment',fieldsRevision:1,staffWrite:[],fields:[
   {key:'name',label:'Your name',type:'text',optional:false,read:'owner'},
   {key:'contact',label:'Email or phone',type:'text',optional:false,read:'owner'},
   {key:'service',label:'What do you need?',type:'choice',options:[{value:'first-visit',label:'First visit'},{value:'follow-up',label:'Follow-up'},{value:'other',label:'Something else'}],optional:false,read:'owner'},
   {key:'day',label:'Preferred day',type:'choice',options:[{value:'weekday',label:'A weekday'},{value:'weekend',label:'A weekend day'},{value:'any',label:'Any day'}],optional:false,read:'owner'},
   {key:'note',label:'Anything we should know?',type:'text',optional:true,read:'owner'}]}],
  forms:[{id:standardAppointmentFormId,recordId:'appointment',submit:'public',uploadCollectionId:null}],views:[]}};
}
export const hasAppointmentForm=(i:ModuleInstance)=>i.kind==='records'&&i.config.forms.some(f=>f.id===standardAppointmentFormId&&f.submit==='public');

/** The project's standard appointment form while it is open to the public: active, bound to the live publication, not held,
 * retired or contained, and on a current catalog pin (`publicFormState` agrees with serving). Shared by the hosted page and the site link. */
export async function boundAppointment(db:D1Database,project:string){
 for(const row of (await registeredInstances(db,project)).filter(r=>r.kind==='records')){
  const instance=await instanceOf(row).catch(()=>null);
  if(instance&&hasAppointmentForm(instance)&&await publicFormState(db,row)==='bound')return {row,instance:instance as Extract<ModuleInstance,{kind:'records'}>};
 }
 return null;
}

/** Owner metadata for the records panel: which step of appointment form setup comes next, and the public form state once
 * registered. Ids and states only. */
export async function readRecordsSetup(db:D1Database,user:string,project:string):Promise<RecordsSetup>{
 for(const row of (await registeredInstances(db,project)).filter(r=>r.kind==='records')){
  if(hasAppointmentForm(await instanceOf(row)))return {state:'registered',instanceId:row.local_id,publicForm:await publicFormState(db,row)};
 }
 let spec;try{spec=await currentSpecification(db,user,project);}catch(error){if(error instanceof ModuleError)return {state:'unavailable',instanceId:null,publicForm:'none'};throw error;}
 if(!spec)return {state:'website-required',instanceId:null,publicForm:'none'};
 const saved=spec.instances.find(hasAppointmentForm);
 return saved?{state:'saved',instanceId:saved.id,publicForm:'none'}:{state:'not-configured',instanceId:null,publicForm:'none'};
}

/** `/review-appointment-form-setup PROJECT` from the typed appointmentFormReview control. Returns the existing specification
 * review reply and statements; the reply is linked to the review so Chat shows the exact save control. */
export async function prepareAppointmentFormCommand(db:D1Database,user:string,turn:string,command:string){
 if(!command.startsWith('/review-appointment-form-setup '))return;
 const m=/^\/review-appointment-form-setup ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.exec(command);
 if(!m||!uuid.test(turn))throw new ModuleError('invalid_request','Choose an owned project.');
 const project=m[1];
 await assertWorkspace(db,user);
 const spec=await currentSpecification(db,user,project);
 if(!spec)throw new ModuleError('not_found','This project has no saved website configuration yet. The appointment form is saved in it, so ask Whumpo to draft the project’s private website first.');
 const registered=await registeredInstances(db,project);
 const already='This project already has an appointment form. Review its activation from Form records.';
 for(const row of registered.filter(r=>r.kind==='records'))if(hasAppointmentForm(await instanceOf(row)))throw new ModuleError('invalid_request',already);
 if(spec.instances.some(hasAppointmentForm))throw new ModuleError('invalid_request',already);
 if(spec.instances.some(i=>i.id===standardAppointmentInstanceId)||registered.some(r=>r.local_id===standardAppointmentInstanceId))throw new ModuleError('invalid_request','Another module already uses the “appointments” id in this website configuration.');
 if(spec.instances.some(i=>i.kind==='records'&&i.config.forms.some(f=>f.id===standardAppointmentFormId)))throw new ModuleError('invalid_request','Another form already uses the “appointment” id in this website configuration.');
 // The existing review owns compilation, safety holds, staleness, bounds and the reply (BackendError on refusal).
 return prepareSpecification(db,user,turn,{kind:'specification',operation:'change',projectId:project,expectedRevision:spec.revision,operations:[{type:'modules.put',instance:standardAppointmentInstance()}]});
}
