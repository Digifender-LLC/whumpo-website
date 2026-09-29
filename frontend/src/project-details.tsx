import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useRouterState} from '@tanstack/react-router';
import {api,send,message,queryClient} from './lib/api';
import {Section,Field} from './workspace-pages';
import {useWorkspace} from './workspace';
import {CMSEditGuard,useCMSEditGuard,useCMSProtection} from './cms-edit-guard';
import {Input} from './components/ui/input';
import {Textarea} from './components/ui/textarea';
import {Button} from './components/ui/button';
type Details={id:string;name:string;purpose:string;revision:number};
export function ProjectDetailsPanel(){
 const search=useRouterState({select:s=>s.location.searchStr}),project=new URLSearchParams(search).get('project')??'';
 const data=useQuery({queryKey:['project-details',project],queryFn:()=>api<Details>('/projects/'+project+'/details'),enabled:!!project,refetchOnWindowFocus:false,refetchOnReconnect:false});
 if(!project)return <p>Select a project’s Details button in your dashboard.</p>;
 if(data.isPending)return <p>Opening project details…</p>;
 if(data.error)return <p role="alert">{message(data.error)}</p>;
 return <CMSEditGuard label="project update"><DetailsEditor key={project} details={data.data!}/></CMSEditGuard>;
}
function DetailsEditor({details}:{details:Details}){
 const {notify}=useWorkspace(),{run,protect}=useCMSEditGuard();
 const [saved,setSaved]=useState(details),[name,setName]=useState(details.name),[purpose,setPurpose]=useState(details.purpose),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const dirty=name!==saved.name||purpose!==saved.purpose;
 useCMSProtection(busy?'saving':dirty?'edited':'clean');
 async function reload(){setBusy(true);try{const latest=await api<Details>('/projects/'+details.id+'/details');queryClient.setQueryData(['project-details',details.id],latest);setSaved(latest);setName(latest.name);setPurpose(latest.purpose);setError('')}catch(e){setError(message(e))}finally{setBusy(false)}}
 return <Section title="Project details" description="The project name also appears on hosted contact forms and directories. Saved website versions and CMS articles keep their existing content."><form className="space-y-5" onSubmit={async e=>{e.preventDefault();setBusy(true);protect('saving');setError('');try{const result=await send<Details>('/projects/'+details.id+'/details',{revision:saved.revision,name,purpose},'PATCH');queryClient.setQueryData(['project-details',details.id],result);setSaved(result);setName(result.name);setPurpose(result.purpose);protect('clean');await queryClient.invalidateQueries({queryKey:['dashboard']});notify('Project details saved.')}catch(e){setError(message(e)+' Your input is still here. Reload saved details to check whether the change reached the server before retrying.')}finally{setBusy(false)}}}><Field label="Project name"><Input value={name} maxLength={100} required disabled={busy} onChange={e=>setName(e.target.value)}/></Field><Field label="Project description"><Textarea value={purpose} maxLength={1000} rows={5} disabled={busy} onChange={e=>setPurpose(e.target.value)}/></Field><p className="text-sm text-muted-foreground">Whumpo can use these details when helping with your project. Keep passwords and other secrets out.</p>{error&&<p role="alert" className="text-sm">{error}</p>}<div className="flex flex-wrap gap-3"><Button disabled={busy||!name.trim()||!dirty}>{busy?'Working…':'Save project details'}</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>run(()=>void reload())}>Reload saved details</Button></div></form></Section>;
}
