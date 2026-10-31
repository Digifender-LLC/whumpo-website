// Component acceptance fixture only; it creates no server interaction or action.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {KitEditor,SectionEditor,BrandPreview,defaultTokens,type Kit,type SavedSection} from '../../frontend/src/brand-kit-panel';
import {Page,Section} from '../../frontend/src/workspace-layout';
import '../../frontend/src/styles.css';
const kit:Kit={id:'11111111-1111-4111-8111-111111111111',name:'Harbour',version:3,tokens:{...defaultTokens,dark:{ink:'#f2efe6',paper:'#14161c',accent:'#f0a37f'},font:'editorial',radius:'round',density:'spacious',logoAlt:'Harbour Bakery logo'}};
const section:SavedSection={id:'22222222-2222-4222-8222-222222222222',name:'Opening hours',version:1,content:{heading:'Hours',text:'Open 7 to 3, Tuesday to Sunday.',variant:'callout'}};
function Harness({id,children}:{id:string;children:(log:(v:unknown)=>void,fail:boolean)=>React.ReactNode}){
 const [saves,setSaves]=useState<unknown[]>([]);
 return <div id={id}>{children(v=>setSaves(s=>[...s,v]),false)}<output id={id+'-log'} hidden>{JSON.stringify(saves)}</output></div>;
}
// The real workspace frame (grid, 76px rail at phone width, scrolling main, page padding and card padding), so overflow is measured the way the owner sees it.
createRoot(document.getElementById('root')!).render(<div className="workspace-grid"><aside aria-hidden="true"/><main className="workspace-main overflow-y-auto"><Page title="Brand & sections" description="Fixture">
 <Section title="New kit"><Harness id="new">{log=><KitEditor busy={false} error="" onSave={(name,tokens)=>log({name,tokens})} onCancel={()=>log('cancel')}/>}</Harness></Section>
 <Section title="Edit kit"><Harness id="edit">{log=><KitEditor initial={kit} busy={false} error="" onSave={(name,tokens)=>log({name,tokens})} onCancel={()=>log('cancel')}/>}</Harness></Section>
 <Section title="Stale kit"><Harness id="stale">{log=><KitEditor initial={kit} busy={false} error="This brand kit changed since you opened it. Reload it and try again." onSave={(name,tokens)=>log({name,tokens})} onCancel={()=>log('cancel')}/>}</Harness></Section>
 <Section title="Saved section"><Harness id="section">{log=><SectionEditor initial={section} busy={false} error="" onSave={(name,content)=>log({name,content})} onCancel={()=>log('cancel')}/>}</Harness></Section>
 <Section title="Previews"><div id="preview-dark"><BrandPreview tokens={kit.tokens} mode="dark"/></div><div id="preview-light-only"><BrandPreview tokens={defaultTokens} mode="dark"/></div></Section>
</Page></main></div>);
