import {cmsItemId} from './cms-content-shape';
import {cmsTaxonomyTerm} from './cms-taxonomy-shape';
export const initialTaxonomyPath='/_emdash/api/whumpo/import-taxonomies';
export type InitialTerm={taxonomy:'categories'|'tags';id:string;slug:string;label:string};
export type InitialTaxonomies={draftRequestId:string;itemId:string;terms:InitialTerm[]};
export function initialTaxonomies(value:unknown):InitialTaxonomies{
 const v=value as Partial<InitialTaxonomies>|null;
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['draftRequestId','itemId','terms'].includes(k))||typeof v.draftRequestId!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v.draftRequestId)||typeof v.itemId!=='string'||!cmsItemId.test(v.itemId)||!Array.isArray(v.terms)||v.terms.length<1||v.terms.length>20)throw Error('Choose a fresh post and up to 20 reviewed terms');
 const ids=new Set<string>();const terms=v.terms.map(t=>{if(!t||typeof t!=='object'||Object.keys(t).length!==4||Object.keys(t).some(k=>!['taxonomy','id','slug','label'].includes(k))||!['categories','tags'].includes(t.taxonomy)||!cmsItemId.test(t.id)||ids.has(t.id))throw Error('Choose unique reviewed terms');ids.add(t.id);cmsTaxonomyTerm(t.slug,t.label);return {taxonomy:t.taxonomy,id:t.id,slug:t.slug,label:t.label};}).sort((a,b)=>a.taxonomy.localeCompare(b.taxonomy)||a.id.localeCompare(b.id));
 const result={draftRequestId:v.draftRequestId,itemId:v.itemId,terms};if(new TextEncoder().encode(JSON.stringify(result)).length>4096)throw Error('Reviewed terms exceed the request bound');return result;
}
export function validInitialTaxonomies(body:string){try{return body===JSON.stringify(initialTaxonomies(JSON.parse(body)));}catch{return false;}}
