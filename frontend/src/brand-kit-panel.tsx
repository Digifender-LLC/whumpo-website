import {useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import {useQuery} from '@tanstack/react-query';
import {AlertTriangle,Check,Moon,Sun} from 'lucide-react';
import {renderSite,type SiteConfig,type SiteSection} from '../../src/components';
import {adjustColors,brandDensities,brandFonts,brandRadii,contrastPairs,deriveDark,describeAdjustment,isHex,sectionVariants,colorProblems,type BrandColors,type BrandDensity,type BrandFont,type BrandRadius,type SectionVariant} from '../../src/brand-tokens';
import type {KitTokens,SectionContent} from '../../src/brand-kits/policy';
import {api,message,queryClient,send} from './lib/api';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Textarea} from './components/ui/textarea';
import {Section} from './workspace-layout';
import {StateNote} from './view-states';
import {useWorkspace} from './workspace';
import {ConfirmButton,QueryStatus} from './workspace-controls';

/** WH-091 owner screen for brand kits and saved sections (docs/brand-kits.md). Everything an owner can set is a labelled choice, a
 * hex color checked for contrast before it can be saved, or plain text. Applying never edits a site from here: it opens the
 * existing exact review in Chat, which shows the change and a preview and waits for the owner's confirmation. */
export type Kit={id:string;name:string;version:number;tokens:KitTokens};
export type SavedSection={id:string;name:string;version:number;content:SectionContent};
export const defaultTokens:KitTokens={light:{ink:'#1f2a44',paper:'#fbf8f1',accent:'#8a2c0d'},dark:null,font:'classic',radius:'soft',density:'comfortable',logoAlt:null};
const sampleSections:SiteSection[]=[{heading:'Opening hours',text:'Tuesday to Sunday, 7 to 3.',variant:'plain'},{heading:'Order ahead',text:'Call or message us the day before for large orders.',variant:'plain'}];
export const sampleSite=(sections:SiteSection[]=sampleSections):SiteConfig=>({name:'Harbour Bakery',description:'Bread, pastry and coffee, baked fresh every morning.',theme:'ocean',headline:'Good bread takes time',aboutTitle:'Our story',aboutText:'We bake in small batches and sell out most days.',sections});
const hexLabel=(c:BrandColors)=>`text ${c.ink}, background ${c.paper}, accent ${c.accent}`;

/** The workspace policy (`style-src 'self'`) blocks `style=` attributes, so owner-chosen sample values are applied through the CSSOM,
 * which the policy allows. Values are validated tokens or entries of the fixed tables in src/brand-tokens.ts. */
function Dyn({css,className,children}:{css:Record<string,string>;className?:string;children?:ReactNode}){
 const ref=useRef<HTMLSpanElement>(null);
 useEffect(()=>{const el=ref.current;if(el)for(const [k,v] of Object.entries(css))el.style.setProperty(k,v);},[css]);
 return <span ref={ref} className={className} aria-hidden="true">{children}</span>;
}
/** The real site renderer drawn in a shadow root. The workspace policy blocks inline styles in iframes and elements, so the
 * generated stylesheet is adopted (constructable stylesheets are not an inline-style load). The markup comes only from
 * `renderSite` over validated tokens; it is parsed inert, never executed, and hidden from assistive technology. */
export function BrandPreview({tokens,mode,sections,label}:{tokens:KitTokens;mode:'light'|'dark';sections?:SiteSection[];label?:string}){
 const host=useRef<HTMLDivElement>(null);
 const view=useMemo(()=>{
  const colors=mode==='dark'?tokens.dark:tokens.light;
  if(!colors)return {error:'Dark colors are not set, so visitors who prefer dark mode see the light colors.' as string};
  try{return {html:renderSite({...sampleSite(sections),brand:{source:null,logo:null,light:colors,dark:null,font:tokens.font,radius:tokens.radius,density:tokens.density}})};}
  catch{return {error:'Fix the colors to see the preview.' as string};}
 },[tokens,mode,sections]);
 useEffect(()=>{
  const el=host.current,html='html' in view?view.html:undefined;if(!el||!html)return;
  const root=el.shadowRoot??el.attachShadow({mode:'open'});
  // Plain string slicing, not DOMParser: a parsed `<style>` element is checked against the workspace policy even in an inert document.
  const css=/<style>([\s\S]*?)<\/style>/.exec(html)?.[1]??'',markup=html.slice(html.indexOf('<body>')+6,html.lastIndexOf('</body>'));
  const sheet=new CSSStyleSheet();sheet.replaceSync(css.replace(/:root/g,':host').replace(/(^|[,}{])\s*body\s*\{/g,'$1.pv{'));
  root.adoptedStyleSheets=[sheet];
  const body=document.createElement('div');body.className='pv';
  const template=document.createElement('template');template.innerHTML=markup;body.append(template.content);
  root.replaceChildren(body);
 },[view]);
 return <div className="space-y-2">
  {'error' in view?<p role="status" className="rounded-md border border-line bg-surface-sunken p-4 text-body-sm">{view.error}</p>
   :<div ref={host} aria-hidden="true" data-testid="brand-preview" className="max-h-[560px] overflow-auto rounded-md border border-line-strong"/>}
  <p className="text-caption text-ink-muted">{label??'A picture of how the example site below will look. Your own text and photos are used when you apply it.'}</p>
 </div>;
}

function ColorField({label,value,onChange,describedBy}:{label:string;value:string;onChange:(v:string)=>void;describedBy?:string}){
 const id=useId(),[draft,setDraft]=useState(value),valid=isHex(draft);
 useEffect(()=>setDraft(value),[value]);
 return <div className="grid gap-1">
  <label htmlFor={id} className="text-sm font-medium">{label}</label>
  <div className="flex items-center gap-2">
   <input type="color" aria-label={label+', color picker'} value={isHex(value)?value:'#000000'} onChange={e=>onChange(e.target.value.toLowerCase())} className="h-11 w-14 shrink-0 cursor-pointer rounded-md border border-line-strong bg-surface-raised p-1"/>
   <Input id={id} value={draft} maxLength={7} spellCheck={false} autoCapitalize="off" autoComplete="off" aria-invalid={!valid} aria-describedby={[describedBy,valid?'':id+'-err'].filter(Boolean).join(' ')||undefined} className="h-11 w-32 font-mono"
    onChange={e=>{const v=e.target.value.trim().toLowerCase();setDraft(v);if(isHex(v))onChange(v);}}/>
  </div>
  {!valid&&<p id={id+'-err'} className="text-caption text-attention-ink">Use six digits after the #, like #1f2a44.</p>}
 </div>;
}

/** Radio cards: a native radio per choice, so arrow keys, labels and focus work as the browser provides. */
function Choices<T extends string>({legend,help,name,value,options,onChange}:{legend:string;help?:string;name:string;value:T;options:{value:T;label:string;note:string;sample?:ReactNode}[];onChange:(v:T)=>void}){
 const id=useId();
 return <fieldset className="grid gap-2" aria-describedby={help?id:undefined}>
  <legend className="text-sm font-medium">{legend}</legend>{help&&<p id={id} className="text-caption text-ink-muted">{help}</p>}
  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{options.map(o=><label key={o.value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-line-strong bg-surface-raised p-3 has-[:checked]:border-action has-[:checked]:bg-action-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]">
   <input type="radio" name={name} value={o.value} checked={value===o.value} onChange={()=>onChange(o.value)} className="mt-1 size-5 shrink-0"/>
   <span className="min-w-0"><span className="block text-body-sm font-medium">{o.label}</span><span className="block text-caption text-ink-muted">{o.note}</span>{o.sample}</span>
  </label>)}</div>
 </fieldset>;
}

export function ContrastReport({colors,mode}:{colors:BrandColors;mode:'light'|'dark'}){
 const pairs=contrastPairs(colors);
 if(!pairs.length)return null;
 return <table className="w-full text-left text-body-sm"><caption className="sr-only">Contrast of the {mode} mode colors. At least 4.5 to 1 is needed.</caption>
  <thead><tr><th scope="col" className="py-1 pr-2 font-medium">Pairing</th><th scope="col" className="py-1 pr-2 font-medium">Contrast</th><th scope="col" className="py-1 font-medium">Result</th></tr></thead>
  <tbody>{pairs.map(p=><tr key={p.id} className="border-t border-line"><th scope="row" className="py-1.5 pr-2 font-normal">{p.label}</th><td className="py-1.5 pr-2 tabular-nums">{p.ratio.toFixed(1)} to 1</td>
   <td className="py-1.5"><span className="inline-flex items-center gap-1 font-medium">{p.pass?<><Check className="size-4" aria-hidden="true"/>Readable</>:<><AlertTriangle className="size-4 text-attention-ink" aria-hidden="true"/><span className="text-attention-ink">Too hard to read</span></>}</span></td></tr>)}</tbody>
 </table>;
}

function Palette({mode,colors,onChange,onNotice}:{mode:'light'|'dark';colors:BrandColors;onChange:(c:BrandColors)=>void;onNotice:(lines:string[])=>void}){
 const id=useId(),problems=colorProblems(colors,mode),word=mode==='light'?'Light mode':'Dark mode';
 const set=(key:keyof BrandColors)=>(v:string)=>onChange({...colors,[key]:v});
 function fix(){const fixed=adjustColors(colors,mode),lines=describeAdjustment(colors,fixed);const left=colorProblems(fixed,mode);
  onChange(fixed);onNotice(lines.length&&!left.length?lines:left.length?[...lines,'Some pairings still cannot be read. Choose a lighter or darker background color.']:[]);}
 return <div className="space-y-4">
  <div className="grid gap-4 sm:grid-cols-3">
   <ColorField label={word+' text'} value={colors.ink} onChange={set('ink')} describedBy={id}/>
   <ColorField label={word+' background'} value={colors.paper} onChange={set('paper')} describedBy={id}/>
   <ColorField label={word+' accent'} value={colors.accent} onChange={set('accent')} describedBy={id}/>
  </div>
  <p id={id} className={mode==='light'?'text-caption text-ink-muted':'sr-only'}>The accent colors small labels, links, lines and focus outlines. Soft panels use your background mixed lightly with your text color. Every pairing needs at least 4.5 to 1 contrast so it stays readable.</p>
  <ContrastReport colors={colors} mode={mode}/>
  {problems.length>0&&<div role="alert" className="space-y-2 rounded-md border border-attention-ink/40 bg-attention-soft p-3 text-body-sm">
   <p className="font-medium">These {mode} colors cannot be saved yet.</p>
   <ul className="list-disc space-y-1 pl-5">{problems.map(p=><li key={p.path}>{p.message}</li>)}</ul>
   <Button type="button" variant="secondary" className="min-h-11" onClick={fix}>Fix {mode} colors automatically</Button>
  </div>}
 </div>;
}

const fontOptions=(Object.keys(brandFonts) as BrandFont[]).map(k=>({value:k,label:brandFonts[k].label,note:brandFonts[k].note,sample:<Dyn className="mt-1 block text-lg" css={{'font-family':brandFonts[k].heading}}>Aa Harbour Bakery</Dyn>}));
const radiusOptions=(Object.keys(brandRadii) as BrandRadius[]).map(k=>({value:k,label:brandRadii[k].label,note:k==='sharp'?'Square corners':k==='soft'?'Gently rounded':'Very round',sample:<Dyn className="mt-2 block h-6 w-16 border-2 border-ink-muted bg-surface-sunken" css={{'border-radius':brandRadii[k].px*0.6+'px'}}/>}));
const densityOptions=(Object.keys(brandDensities) as BrandDensity[]).map(k=>({value:k,label:brandDensities[k].label,note:k==='compact'?'Tighter spacing':k==='comfortable'?'Balanced spacing':'More breathing room'}));

export function KitEditor({initial,busy,error,onSave,onCancel}:{initial?:Kit;busy:boolean;error:string;onSave:(name:string,tokens:KitTokens)=>void;onCancel:()=>void}){
 const [name,setName]=useState(initial?.name??''),[tokens,setTokens]=useState<KitTokens>(initial?.tokens??defaultTokens),[mode,setMode]=useState<'light'|'dark'>('light'),[notice,setNotice]=useState<string[]>([]);
 const heading=useRef<HTMLHeadingElement>(null),id=useId();
 useEffect(()=>heading.current?.focus(),[]);
 const problems=[...colorProblems(tokens.light,'light'),...(tokens.dark?colorProblems(tokens.dark,'dark'):[])];
 const changed=!initial||name.trim()!==initial.name||JSON.stringify(tokens)!==JSON.stringify(initial.tokens);
 const why=!name.trim()?'Give the kit a name.':problems.length?'Fix the colors marked above.':!changed?'Change something to save.':'';
 const patch=(p:Partial<KitTokens>)=>{setTokens(t=>({...t,...p}));setNotice([]);};
 return <form className="space-y-6" onSubmit={e=>{e.preventDefault();if(!why&&!busy)onSave(name.trim(),tokens);}} aria-labelledby={id+'-h'}>
  <h3 id={id+'-h'} ref={heading} tabIndex={-1} className="text-base font-semibold outline-none">{initial?`Edit “${initial.name}” (version ${initial.version})`:'New brand kit'}</h3>
  <div className="grid gap-2"><label htmlFor={id+'-name'} className="text-sm font-medium">Kit name</label>
   <Input id={id+'-name'} value={name} maxLength={60} onChange={e=>setName(e.target.value)} className="h-11 max-w-sm" autoComplete="off"/></div>
  <fieldset className="space-y-4"><legend className="text-sm font-semibold">Colors</legend>
   <Palette mode="light" colors={tokens.light} onChange={light=>patch({light})} onNotice={setNotice}/>
   <label className="flex min-h-11 items-start gap-3"><input type="checkbox" className="mt-1 size-5 shrink-0" checked={!!tokens.dark} onChange={e=>{patch({dark:e.target.checked?deriveDark(tokens.light):null});if(!e.target.checked)setMode('light');}}/>
    <span><span className="block text-sm font-medium">Also design for dark mode</span><span className="block text-caption text-ink-muted">Visitors whose device is set to dark see these colors. Without them the site stays light.</span></span></label>
   {tokens.dark&&<div className="space-y-3"><Palette mode="dark" colors={tokens.dark} onChange={dark=>patch({dark})} onNotice={setNotice}/>
    <Button type="button" variant="quiet" className="min-h-11" onClick={()=>{patch({dark:deriveDark(tokens.light)});setNotice(['Suggested dark colors from your light colors.']);}}>Suggest dark colors from my light colors</Button></div>}
   <div role="status" aria-live="polite" className="text-body-sm">{notice.map((n,i)=><p key={i}>{n}</p>)}</div>
  </fieldset>
  <Choices legend="Type style" help="Fonts already on your visitors’ devices, so pages stay fast and nothing is downloaded." name={id+'-font'} value={tokens.font} options={fontOptions} onChange={font=>patch({font})}/>
  <Choices legend="Corners" name={id+'-radius'} value={tokens.radius} options={radiusOptions} onChange={radius=>patch({radius})}/>
  <Choices legend="Spacing" name={id+'-density'} value={tokens.density} options={densityOptions} onChange={density=>patch({density})}/>
  <div className="grid gap-2"><label htmlFor={id+'-logo'} className="text-sm font-medium">Logo description (optional)</label>
   <Input id={id+'-logo'} value={tokens.logoAlt??''} maxLength={100} onChange={e=>patch({logoAlt:e.target.value.trim()?e.target.value:null})} className="h-11 max-w-md" autoComplete="off" aria-describedby={id+'-logo-help'}/>
   <p id={id+'-logo-help'} className="text-caption text-ink-muted">Read aloud to people who cannot see the logo. The logo picture itself is chosen from a project’s approved photos when you apply the kit.</p></div>
  <section aria-label="Preview" className="space-y-3">
   <div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold">Preview</h4>
    <div role="group" aria-label="Preview mode" className="flex gap-2">{(['light','dark'] as const).map(m=><Button key={m} type="button" variant={mode===m?'primary':'secondary'} size="sm" className="min-h-11" aria-pressed={mode===m} onClick={()=>setMode(m)}>{m==='light'?<Sun className="size-4" aria-hidden="true"/>:<Moon className="size-4" aria-hidden="true"/>}{m==='light'?'Light':'Dark'}</Button>)}</div></div>
   <BrandPreview tokens={tokens} mode={mode}/>
  </section>
  {error&&<p role="alert" className="text-body-sm text-attention-ink">{error}</p>}
  <div className="flex flex-wrap items-center gap-3">
   <Button type="submit" className="min-h-11" disabled={busy||!!why} aria-describedby={why?id+'-why':undefined}>{busy?'Saving…':initial?'Save as a new version':'Save brand kit'}</Button>
   <Button type="button" variant="secondary" className="min-h-11" onClick={onCancel}>Cancel</Button>
   {why&&<p id={id+'-why'} className="text-body-sm text-ink-muted">{why}</p>}
  </div>
  <p className="sr-only">Colors: {hexLabel(tokens.light)}</p>
 </form>;
}

const variantNotes:Record<SectionVariant,[string,string]>={plain:['Plain','A line above the text'],card:['Card','On a soft panel'],callout:['Callout','Soft panel with an accent edge'],quote:['Quote','Large italic text with a side line']};
export function SectionEditor({initial,busy,error,onSave,onCancel}:{initial?:SavedSection;busy:boolean;error:string;onSave:(name:string,content:SectionContent)=>void;onCancel:()=>void}){
 const [name,setName]=useState(initial?.name??''),[content,setContent]=useState<SectionContent>(initial?.content??{heading:'',text:'',variant:'plain'});
 const id=useId(),heading=useRef<HTMLHeadingElement>(null);useEffect(()=>heading.current?.focus(),[]);
 const changed=!initial||name.trim()!==initial.name||JSON.stringify(content)!==JSON.stringify(initial.content);
 const why=!name.trim()?'Give the section a name.':!content.heading.trim()?'Add a heading.':!content.text.trim()?'Add some text.':content.text.length>800?'Shorten the text to 800 characters.':!changed?'Change something to save.':'';
 const shown=useMemo(()=>[{heading:content.heading.trim()||'Your heading',text:content.text.trim()||'Your text appears here.',variant:content.variant}],[content]);
 return <form className="space-y-5" onSubmit={e=>{e.preventDefault();if(!why&&!busy)onSave(name.trim(),{...content,heading:content.heading.trim(),text:content.text.trim()});}} aria-labelledby={id+'-h'}>
  <h3 id={id+'-h'} ref={heading} tabIndex={-1} className="text-base font-semibold outline-none">{initial?`Edit “${initial.name}” (version ${initial.version})`:'New saved section'}</h3>
  <div className="grid gap-2"><label htmlFor={id+'-name'} className="text-sm font-medium">Name (only you see this)</label><Input id={id+'-name'} value={name} maxLength={60} onChange={e=>setName(e.target.value)} className="h-11 max-w-sm" autoComplete="off"/></div>
  <div className="grid gap-2"><label htmlFor={id+'-heading'} className="text-sm font-medium">Heading</label><Input id={id+'-heading'} value={content.heading} maxLength={100} onChange={e=>setContent({...content,heading:e.target.value})} className="h-11 max-w-md" autoComplete="off"/></div>
  <div className="grid gap-2"><label htmlFor={id+'-text'} className="text-sm font-medium">Text</label><Textarea id={id+'-text'} value={content.text} rows={4} onChange={e=>setContent({...content,text:e.target.value})} aria-describedby={id+'-count'} className="max-w-xl"/>
   <p id={id+'-count'} className="text-caption text-ink-muted">{content.text.length} of 800 characters. Plain text only.</p></div>
  <Choices legend="Style" name={id+'-variant'} value={content.variant} options={sectionVariants.map(v=>({value:v,label:variantNotes[v][0],note:variantNotes[v][1]}))} onChange={variant=>setContent({...content,variant})}/>
  <section aria-label="Preview" className="space-y-2"><h4 className="text-sm font-semibold">Preview</h4><BrandPreview tokens={defaultTokens} mode="light" sections={shown} label="Shown with neutral example colors. On your site it uses that site’s own colors and type."/></section>
  {error&&<p role="alert" className="text-body-sm text-attention-ink">{error}</p>}
  <div className="flex flex-wrap items-center gap-3"><Button type="submit" className="min-h-11" disabled={busy||!!why} aria-describedby={why?id+'-why':undefined}>{busy?'Saving…':initial?'Save as a new version':'Save section'}</Button><Button type="button" variant="secondary" className="min-h-11" onClick={onCancel}>Cancel</Button>{why&&<p id={id+'-why'} className="text-body-sm text-ink-muted">{why}</p>}</div>
 </form>;
}

type Photo={id:string;name:string;safetyStatus:string;status:string};
function ProjectChoice({value,onChange}:{value:string;onChange:(v:string)=>void}){
 const {dashboard}=useWorkspace(),id=useId(),projects=dashboard?.projects??[];
 return <div className="grid gap-1"><label htmlFor={id} className="text-sm font-medium">Project</label>
  <select id={id} value={value} onChange={e=>onChange(e.target.value)} className="h-11 max-w-sm rounded-md border border-line-strong bg-surface-raised px-3 text-body-sm"><option value="">Choose a project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>;
}
function Swatches({colors,label}:{colors:BrandColors;label:string}){
 return <span className="inline-flex items-center gap-1.5"><span className="sr-only">{label}: {hexLabel(colors)}.</span>{(['ink','paper','accent'] as const).map(k=><Dyn key={k} className="inline-block size-6 rounded-full border border-line-strong" css={{background:colors[k]}}/>)}<span aria-hidden="true" className="font-mono text-caption text-ink-muted">{colors.paper}</span></span>;
}
function ApplyKit({kit}:{kit:Kit}){
 const {runAction,commandBusy}=useWorkspace(),[project,setProject]=useState(''),[logo,setLogo]=useState(''),[error,setError]=useState(''),id=useId();
 const photos=useQuery({queryKey:['brand-logo-photos',project],queryFn:()=>api<{files:Photo[]}>(`/projects/${project}/files`),enabled:!!project&&!!kit.tokens.logoAlt,gcTime:0});
 const approved=(photos.data?.files??[]).filter(f=>f.safetyStatus==='approved'&&f.status==='ready');
 async function go(control:Parameters<typeof runAction>[0]){setError('');try{await runAction(control);}catch(e){setError(message(e));}}
 return <div className="space-y-3 rounded-md bg-surface-sunken p-4">
  <ProjectChoice value={project} onChange={v=>{setProject(v);setLogo('');}}/>
  {project&&kit.tokens.logoAlt&&<div className="grid gap-1"><label htmlFor={id} className="text-sm font-medium">Logo (optional)</label>
   <select id={id} value={logo} onChange={e=>setLogo(e.target.value)} disabled={photos.isPending} className="h-11 max-w-sm rounded-md border border-line-strong bg-surface-raised px-3 text-body-sm"><option value="">No logo</option>{approved.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select>
   <p className="text-caption text-ink-muted">{photos.isPending?'Loading approved photos…':approved.length?`Only approved photos of this project are listed. It will be described as “${kit.tokens.logoAlt}”.`:'This project has no approved photos yet. Add one in Photos first.'}</p></div>}
  {error&&<p role="alert" className="text-body-sm text-attention-ink">{error}</p>}
  <div className="flex flex-wrap gap-3">
   <Button type="button" variant="secondary" className="min-h-11" disabled={!project||commandBusy} onClick={()=>void go({type:'brandKitReview',projectId:project,kitId:kit.id,version:kit.version,logoId:logo||null})}>Review in Chat</Button>
   <Button type="button" variant="quiet" className="min-h-11" disabled={!project||commandBusy} onClick={()=>void go({type:'brandRemoveReview',projectId:project})}>Review removing the brand</Button></div>
  <p className="text-caption text-ink-muted">Chat shows the exact change and a preview of the website. Nothing is saved or published until you confirm it, and later edits to this kit never change a site that already has it.</p>
 </div>;
}
function ApplySection({section}:{section:SavedSection}){
 const {runAction,commandBusy}=useWorkspace(),[project,setProject]=useState(''),[error,setError]=useState('');
 async function go(){setError('');try{await runAction({type:'savedSectionReview',projectId:project,sectionId:section.id,version:section.version,pageId:'home'});}catch(e){setError(message(e));}}
 return <div className="space-y-3 rounded-md bg-surface-sunken p-4"><ProjectChoice value={project} onChange={setProject}/>
  {error&&<p role="alert" className="text-body-sm text-attention-ink">{error}</p>}
  <Button type="button" variant="secondary" className="min-h-11" disabled={!project||commandBusy} onClick={()=>void go()}>Review adding to the home page</Button>
  <p className="text-caption text-ink-muted">Adds a copy at the end of the page. Chat shows the exact change first; a page holds up to six sections.</p></div>;
}

function useList<T>(path:string,key:string){return useQuery({queryKey:[key],queryFn:()=>api<T>(path)});}
export function BrandPanel(){
 const kits=useList<{kits:Kit[]}>('/brand-kits','brand-kits'),sections=useList<{sections:SavedSection[]}>('/saved-sections','saved-sections');
 const [editing,setEditing]=useState<'new'|string|null>(null),[editingSection,setEditingSection]=useState<'new'|string|null>(null),[open,setOpen]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const {notify}=useWorkspace(),kitRows=kits.data?.kits??[],sectionRows=sections.data?.sections??[];
 const trigger=useRef<HTMLElement|null>(null);
 async function save(kind:'brand-kits'|'saved-sections',existing:{id:string;version:number}|undefined,body:Record<string,unknown>){
  setBusy(true);setError('');
  try{
   if(existing)await send(`/${kind}/${existing.id}`,{expectedVersion:existing.version,...body},'PUT');else await send(`/${kind}`,{id:crypto.randomUUID(),...body});
   await queryClient.invalidateQueries({queryKey:[kind]});(kind==='brand-kits'?setEditing:setEditingSection)(null);requestAnimationFrame(()=>trigger.current?.focus());notify(kind==='brand-kits'?'Brand kit saved.':'Section saved.');
  }catch(e){setError(message(e));}finally{setBusy(false);}
 }
 async function remove(kind:'brand-kits'|'saved-sections',id:string){await send(`/${kind}/${id}`,{},'DELETE');await queryClient.invalidateQueries({queryKey:[kind]});notify('Deleted. Websites that already use it keep their own copy.');}
 const opener=(set:()=>void)=>(e:{currentTarget:HTMLElement})=>{trigger.current=e.currentTarget;setError('');set();};
 return <div className="max-w-[900px] space-y-6">
  <p className="text-body-sm text-ink-muted">Save your colors, type and logo once, and reuse them across your websites. Applying a kit or section opens a review in Chat first. Nothing on a website changes until you confirm it, and changing a kit later never changes a site that already uses it.</p>
  <Section title="Brand kits" description="Colors for light and dark, a type style, corners and spacing.">
   <QueryStatus pending={kits.isPending} error={kits.error as Error|null}/>
   {editing==='new'?<KitEditor busy={busy} error={error} onSave={(name,tokens)=>void save('brand-kits',undefined,{name,tokens})} onCancel={()=>{setEditing(null);requestAnimationFrame(()=>trigger.current?.focus());}}/>
    :<div className="space-y-4">
     {!kits.isPending&&!kitRows.length&&<StateNote title="No brand kits yet.">Create one to keep your colors and type in one place.</StateNote>}
     <ul className="space-y-4">{kitRows.map(k=><li key={k.id} className="space-y-3 rounded-md border border-line p-4">
      {editing===k.id?<KitEditor initial={k} busy={busy} error={error} onSave={(name,tokens)=>void save('brand-kits',k,{name,tokens})} onCancel={()=>{setEditing(null);requestAnimationFrame(()=>trigger.current?.focus());}}/>
       :<><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="min-w-0 break-words text-base font-semibold">{k.name}</h3><span className="text-caption text-ink-muted">Version {k.version}</span></div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-body-sm"><Swatches colors={k.tokens.light} label="Light colors"/>{k.tokens.dark?<Swatches colors={k.tokens.dark} label="Dark colors"/>:<span className="text-ink-muted">No dark colors</span>}</p>
        <p className="text-body-sm text-ink-muted">{brandFonts[k.tokens.font].label} type · {brandRadii[k.tokens.radius].label.toLowerCase()} corners · {brandDensities[k.tokens.density].label.toLowerCase()} spacing</p>
        <div className="flex flex-wrap gap-3">
         <Button type="button" variant="secondary" className="min-h-11" onClick={opener(()=>setEditing(k.id))}>Edit<span className="sr-only"> {k.name}</span></Button>
         <Button type="button" variant="secondary" className="min-h-11" aria-expanded={open===k.id} onClick={()=>setOpen(open===k.id?null:k.id)}>Apply to a project<span className="sr-only">: {k.name}</span></Button>
         <ConfirmButton label="Delete" description={`Delete “${k.name}” and all its versions? Websites that already use it keep their own copy.`} run={()=>remove('brand-kits',k.id)}/></div>
        {open===k.id&&<ApplyKit kit={k}/>}</>}
     </li>)}</ul>
     <Button type="button" className="min-h-11" onClick={opener(()=>setEditing('new'))}>New brand kit</Button>
    </div>}
  </Section>
  <Section title="Saved sections" description="A heading and text you reuse, with a style. Add one to a page through a review.">
   <QueryStatus pending={sections.isPending} error={sections.error as Error|null}/>
   {editingSection==='new'?<SectionEditor busy={busy} error={error} onSave={(name,content)=>void save('saved-sections',undefined,{name,content})} onCancel={()=>{setEditingSection(null);requestAnimationFrame(()=>trigger.current?.focus());}}/>
    :<div className="space-y-4">
     {!sections.isPending&&!sectionRows.length&&<StateNote title="No saved sections yet.">Save opening hours, a price list or an About paragraph once, then add it to any page.</StateNote>}
     <ul className="space-y-4">{sectionRows.map(s=><li key={s.id} className="space-y-3 rounded-md border border-line p-4">
      {editingSection===s.id?<SectionEditor initial={s} busy={busy} error={error} onSave={(name,content)=>void save('saved-sections',s,{name,content})} onCancel={()=>{setEditingSection(null);requestAnimationFrame(()=>trigger.current?.focus());}}/>
       :<><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="min-w-0 break-words text-base font-semibold">{s.name}</h3><span className="text-caption text-ink-muted">Version {s.version} · {variantNotes[s.content.variant][0]}</span></div>
        <p className="break-words text-body-sm"><span className="font-medium">{s.content.heading}</span> — {s.content.text.length>140?s.content.text.slice(0,140)+'…':s.content.text}</p>
        <div className="flex flex-wrap gap-3">
         <Button type="button" variant="secondary" className="min-h-11" onClick={opener(()=>setEditingSection(s.id))}>Edit<span className="sr-only"> {s.name}</span></Button>
         <Button type="button" variant="secondary" className="min-h-11" aria-expanded={open===s.id} onClick={()=>setOpen(open===s.id?null:s.id)}>Add to a project<span className="sr-only">: {s.name}</span></Button>
         <ConfirmButton label="Delete" description={`Delete “${s.name}” and all its versions? Pages that already use it keep their own copy.`} run={()=>remove('saved-sections',s.id)}/></div>
        {open===s.id&&<ApplySection section={s}/>}</>}
     </li>)}</ul>
     <Button type="button" className="min-h-11" onClick={opener(()=>setEditingSection('new'))}>New saved section</Button>
    </div>}
  </Section>
 </div>;
}
