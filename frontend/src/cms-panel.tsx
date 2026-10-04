import {CMSWordPressPanel} from './cms-wordpress-panel';
import {CMSMediaPanel} from './cms-media-panel';
import {RichEditor} from './cms-rich-editor';
import {richEditable,newRichBlock,type RichContent} from './lib/cms-rich-editor';
import {cmsRichDraftBody,cmsRichEditBody} from '../../src/cms-content-shape';
import {CMSEditGuard,useCMSEditGuard,useCMSProtection} from './cms-edit-guard';
import {editableCMS} from './lib/cms-editor-shape';
import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useRouterState} from '@tanstack/react-router';
import {api,send,message,APIError,queryClient} from './lib/api';
import {useWorkspace} from './workspace';
import {Section,Field} from './workspace-pages';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Textarea} from './components/ui/textarea';

type Instance={project_id:string;name:string;title:string;state:string};
type Draft={id:string;collection:string;item_id:string|null;created_at:string};
type Publication={id:string;draft_request_id:string;title:string;status:string;withdrawn:number;collection:string;item_id:string};
type Inventory={drafts:Draft[];publications:Publication[]};
type Snapshot={revision:string;item:{status:string;draftRevisionId?:string|null;data:{title?:unknown;content?:unknown}}};
type Content={title:string;text?:string;content?:RichContent[]};

export function CMSPanel(props:{projectId?:string}={}){return <CMSEditGuard><CMSPanelContent {...props}/></CMSEditGuard>}
function CMSPanelContent({projectId}:{projectId?:string}){
 const {run}=useCMSEditGuard();
 const {sendMessage}=useWorkspace();
 const search=useRouterState({select:s=>s.location.searchStr});
 const [chosen,setChosen]=useState(projectId??new URLSearchParams(search).get('project')??'');
 const instances=useQuery({queryKey:['cms-instances'],queryFn:()=>api<{instances:Instance[]}>('Help me set up a publishing space.')});
 const instance=instances.data?.instances.find(i=>i.project_id===chosen);
 const [selection,setSelection]=useState<string|null>(null);
 if(instances.isPending)return <p>Opening your publishing desk…</p>;
 if(instances.error)return <div role="alert"><p>{message(instances.error)}</p><Button onClick={()=>void instances.refetch()}>Try again</Button></div>;
 if(!instances.data?.instances.length)return <Section title="Your words belong here" description="Ask Whumpo to set up an EmDash publishing space for one of your projects."><Button onClick={()=>void sendMessage('Help me set up a publishing space.')}>Discuss CMS setup in Chat</Button></Section>;
 return <div className="space-y-6"><Field label="Publishing space"><select className="w-full rounded-lg border bg-background p-3" value={chosen} onChange={e=>{const value=e.target.value;run(()=>{setSelection(null);setChosen(value)})}}><option value="">Choose a publishing space</option>{instances.data.instances.map(i=><option key={i.project_id} value={i.project_id}>{i.name} · {i.state}</option>)}</select></Field>{instance&&<><Section title={instance.title} description={instance.state==='ready'?'Write privately. Review changes before publishing.':'Setup is '+instance.state+'. Content opens after provisioning and initialization are verified.'}><Button variant="outline" size="sm" onClick={()=>run(()=>void sendMessage('Check the publishing setup for project '+chosen))}>Check setup in Chat</Button></Section>{instance.state==='ready'&&<><CMSContent key={chosen} project={chosen} selected={selection} select={setSelection}/><CMSMediaPanel key={'media-'+chosen} project={chosen}/><CMSWordPressPanel key={'wordpress-'+chosen} project={chosen}/></>}</>}</div>;
}

function CMSContent({project,selected,select}:{project:string;selected:string|null;select:(id:string|null)=>void}){
 const {run}=useCMSEditGuard();
 const {sendMessage}=useWorkspace();
 const capabilities=useQuery({queryKey:['cms-capabilities',project],queryFn:()=>api<{structuredContent:boolean;imageContent?:boolean}>('/cms/'+project+'/capabilities'),retry:false,refetchOnWindowFocus:false,staleTime:Infinity});
 const inventory=useQuery({queryKey:['cms-content',project],queryFn:()=>api<Inventory>('/cms/'+project+'/content')});
 const snapshot=useQuery({queryKey:['cms-draft',project,selected],queryFn:()=>api<Snapshot>(`/cms/${project}/content/${selected}`),enabled:!!selected&&selected!=='new',retry:false});
 const row=inventory.data?.drafts.find(d=>d.id===selected);
 const publication=inventory.data?.publications.find(p=>p.draft_request_id===selected&&p.status==='published'&&!p.withdrawn);
 const structured=capabilities.data?.structuredContent===true,imageEnabled=capabilities.data?.imageContent===true;
 const editable=snapshot.data?(structured?richEditable(snapshot.data):editableCMS(snapshot.data)):null;
 if(capabilities.isPending)return <p>Checking your publishing tools…</p>;
 return <div className="grid xl:grid-cols-[minmax(220px,1fr)_2fr] gap-6"><Section title="Saved content" description="Select a saved post or page to read its current title and text."><div className="flex gap-2 mb-5"><Button size="sm" onClick={()=>{if(selected!=='new')run(()=>select('new'))}}>New draft</Button><Button size="sm" variant="ghost" onClick={()=>void inventory.refetch()}>Refresh</Button></div>{inventory.error&&<p role="alert">{message(inventory.error)}</p>}{inventory.isPending&&<p>Loading content…</p>}{inventory.data&&!inventory.data.drafts.length&&<p className="text-sm text-muted-foreground">Nothing written yet. Start with a private draft, or ask Whumpo to help in Chat.</p>}<div className="space-y-2">{inventory.data?.drafts.map(d=><button key={d.id} onClick={()=>{if(selected!==d.id)run(()=>select(d.id))}} className={'w-full text-left rounded-md border p-3 '+(selected===d.id?'bg-secondary':'bg-background')}><span className="block font-semibold text-sm">{d.collection==='posts'?'Post':'Page'} · {new Date(d.created_at).toLocaleDateString()}</span><span className="text-xs text-muted-foreground">{d.item_id?'Open saved content':'Outcome needs checking'}</span></button>)}</div></Section><div className="space-y-5">{snapshot.data&&selected!=='new'&&<Section title="Download your content" description="Save the latest stored article as a JSON file, including structured content. Unsaved edits and media files are not included. This is not a full CMS backup."><Button asChild variant="outline"><a href={`/api/cms/${project}/content/${selected}/export`} download>Download CMS content</a></Button></Section>}{selected==='new'?<CMSEditor key="new" project={project} structured={structured} imageEnabled={imageEnabled} saved={select}/>:selected?<>{row&&!row.item_id?<Section title="Check this saved request"><p className="text-sm mb-4">Its result was not confirmed. Recover the existing request before creating a replacement.</p><Button onClick={()=>void sendMessage('Recover the existing article request '+selected+' for project '+project+' without creating another draft.')}>Recover draft in Chat</Button></Section>:snapshot.isPending?<p>Reading your content…</p>:snapshot.error?<Section title="Couldn’t read this content"><p role="alert">{message(snapshot.error)}</p><Button className="mt-4" onClick={()=>void snapshot.refetch()}>Try again</Button></Section>:snapshot.data&&editable?<><CMSEditor key={selected+snapshot.data.revision} project={project} request={selected} revision={snapshot.data.revision} initial={editable} structured={structured} imageEnabled={imageEnabled} saved={select}/><Section title="Preview & publishing" description={publication?'This article is live. Saved edits stay private until you approve a new publication review.':'Saving a draft does not publish it.'}><div className="flex flex-wrap gap-3">{(snapshot.data.item.status==='draft'||snapshot.data.item.draftRevisionId)&&<Button asChild variant="outline"><a href={`/api/cms/${project}/content/${selected}/preview`} target="_blank" rel="noopener noreferrer">Private preview</a></Button>}{inventory.data?.publications.filter(p=>p.draft_request_id===selected&&['pending','approved'].includes(p.status)).map(p=><Button key={p.id} variant="outline" onClick={()=>run(()=>void sendMessage('Show saved publication review '+p.id))}>Open saved publication review</Button>)}<Button disabled={snapshot.data.item.status==='published'&&!snapshot.data.item.draftRevisionId} onClick={()=>run(()=>void sendMessage('Prepare publication review for article request '+selected+' in project '+project))}>Review publication in Chat</Button><Button variant="outline" onClick={()=>run(()=>void sendMessage('Show saved edit requests for article '+selected+' in project '+project))}>Saved edit requests</Button>{publication&&<><Button asChild variant="outline"><a href={`https://${project}.whumpo.site/cms/${publication.collection}/${publication.item_id}`} target="_blank" rel="noopener noreferrer">View live article</a></Button><Button variant="outline" onClick={()=>run(()=>void sendMessage('Prepare to take article publication '+publication.id+' offline.'))}>Review taking offline</Button>{snapshot.data.item.draftRevisionId&&<Button variant="outline" onClick={()=>run(()=>void sendMessage('Prepare to discard staged edits for article publication '+publication.id))}>Review discarding edits</Button>}</>}</div></Section></>:<Section title="Formatted content"><p>This content has formatting outside the current text editor. It has not been changed.</p><div className="flex flex-wrap gap-3 mt-4">{(snapshot.data?.item.status==='draft'||snapshot.data?.item.draftRevisionId)&&<Button asChild variant="outline"><a href={`/api/cms/${project}/content/${selected}/preview`} target="_blank" rel="noopener noreferrer">Preview formatted draft</a></Button>}<Button disabled={snapshot.data?.item.status==='published'&&!snapshot.data?.item.draftRevisionId} onClick={()=>run(()=>void sendMessage('Prepare publication review for article request '+selected+' in project '+project))}>Review publication in Chat</Button></div></Section>}</>:<Section title="Make room for your next story"><p className="text-sm text-muted-foreground">Choose saved content or start a new post or page. You can also draft, edit and prepare publication through Chat.</p></Section>}</div></div>;
}

function CMSEditor({project,request,revision,initial,saved,structured=false,imageEnabled=false}:{project:string;request?:string;revision?:string;initial?:Content;saved:(id:string)=>void;structured?:boolean;imageEnabled?:boolean}){
 const {notify}=useWorkspace();
 const {run,protect}=useCMSEditGuard();
 const [title,setTitle]=useState(initial?.title??''),[text,setText]=useState(initial?.text??''),[collection,setCollection]=useState('posts'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [content,setContent]=useState<RichContent[]>(()=>initial?.content??[newRichBlock()]);
 let validation='';if(structured){try{if(request)cmsRichEditBody(title,content,revision);else cmsRichDraftBody(title,content);}catch(e){validation=message(e);if(validation.includes('richer preview renderer'))validation='Check your links and list depth. Lists start at depth 1 and increase one level at a time. Links need a web address, email link, or local path.';}}
 if(structured&&!imageEnabled&&content.some(b=>b._type==='image'))validation='This publishing space needs an update before saving articles with images.';
 const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 const pending=useRef<{id:string;title:string;text?:string;content?:RichContent[];collection?:string;revision?:string}|null>(null);
 const [baseline,setBaseline]=useState({title:initial?.title??'',text:initial?.text??'',content:JSON.stringify(initial?.content??content)});
 const dirty=title!==baseline.title||(structured?JSON.stringify(content)!==baseline.content:text!==baseline.text);
 useCMSProtection(busy?'saving':pending.current?'uncertain':dirty?'edited':'clean');
 async function save(){
  if(busy||structured&&validation&&!pending.current)return;protect('saving');setBusy(true);setError('');
  const recovering=!!pending.current;
  pending.current??={id:crypto.randomUUID(),title,...(structured?{content:structuredClone(content)}:{text}),...(request?{revision}:{collection})};
  try{
   const result=await send<{requestId:string}>(`/cms/${project}/content${request?'/'+request:''}`,pending.current,request?'PATCH':'POST');
   const confirmed=pending.current;pending.current=null;if(mounted.current){setBaseline({title:confirmed.title,text:confirmed.text??'',content:JSON.stringify(confirmed.content??content)});protect('clean');saved(result.requestId);}
   await Promise.all([queryClient.invalidateQueries({queryKey:['cms-content',project]}),queryClient.invalidateQueries({queryKey:['cms-draft',project,result.requestId]})]);
   notify('Draft saved. Public content has not changed.');
  }catch(e){setError(message(e));if(!recovering&&e instanceof APIError&&[400,401,403,404].includes(e.status))pending.current=null;}finally{setBusy(false)}
 }
 const locked=busy||!!pending.current;
 return <Section title={request?'Edit content':'New private draft'}><form className="space-y-5" onSubmit={e=>{e.preventDefault();void save()}}>{!request&&<Field label="Content type"><select disabled={locked} className="rounded-lg border bg-background p-3" value={collection} onChange={e=>setCollection(e.target.value)}><option value="posts">Post</option><option value="pages">Page</option></select></Field>}<Field label="Title"><Input required maxLength={100} value={title} disabled={locked} onChange={e=>setTitle(e.target.value)}/></Field>{structured?<><RichEditor project={project} imageEnabled={imageEnabled} content={content} onChange={setContent} disabled={locked}/>{validation&&<p className="text-sm text-muted-foreground">{validation}</p>}</>:<><Field label="Body"><Textarea required rows={12} value={text} disabled={locked} onChange={e=>setText(e.target.value)}/></Field><p className="text-xs text-muted-foreground">{new TextEncoder().encode(text).length} / 2,400 bytes · Plain text</p></>}{error&&<p role="alert" className="text-sm">{error}</p>}{pending.current&&!busy&&<p className="text-sm">Retry uses the same saved request. Keep these fields unchanged until its result is confirmed.</p>}<div className="flex flex-wrap gap-3"><Button disabled={busy||!pending.current&&(structured?!!validation:!title.trim()||!text.trim()||new TextEncoder().encode(text).length>2400)}>{busy?'Saving…':pending.current?'Retry saved request':'Save private draft'}</Button>{request&&!pending.current&&<Button type="button" variant="outline" disabled={busy} onClick={()=>run(()=>{setTitle(initial?.title??'');setText(initial?.text??'');setContent(initial?.content??[newRichBlock()]);void queryClient.invalidateQueries({queryKey:['cms-draft',project,request]})})}>Reload saved version</Button>}</div></form></Section>;
}
