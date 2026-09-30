import {cmsTaxonomyTerm,type CMSTaxonomyName} from './cms-taxonomy-shape';
import {initialTaxonomies} from './cms-initial-taxonomy-shape';
export type ImportTerm={taxonomy:CMSTaxonomyName;slug:string;label:string};
export function importTaxonomyPlan(value:unknown):ImportTerm[]{
 if(!Array.isArray(value)||value.length>20)throw Error('Choose up to 20 source terms');
 const seen=new Set<string>();
 const terms=value.map(t=>{
  if(!t||typeof t!=='object'||Array.isArray(t)||Object.keys(t).length!==3||!['taxonomy','slug','label'].every(k=>Object.hasOwn(t,k))||!['categories','tags'].includes(t.taxonomy))throw Error('Choose source category or tag mappings');
  cmsTaxonomyTerm(t.slug,t.label);const key=t.taxonomy+'\0'+t.slug;if(seen.has(key))throw Error('Repeated term mapping');seen.add(key);
  return {taxonomy:t.taxonomy as CMSTaxonomyName,slug:t.slug as string,label:t.label as string};
 }).sort((a,b)=>a.taxonomy<b.taxonomy?-1:a.taxonomy>b.taxonomy?1:a.slug<b.slug?-1:a.slug>b.slug?1:0);
 if(terms.length)initialTaxonomies({draftRequestId:'00000000-0000-4000-8000-000000000000',itemId:'0'.repeat(26),terms:terms.map((t,i)=>({...t,id:String(i).padStart(26,'0')}))});
 return terms;
}
