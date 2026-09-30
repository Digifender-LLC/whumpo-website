import type {WxrData,WxrPost} from './vendor/emdash-wxr';
import {cmsTaxonomyTerm,type CMSTaxonomyName} from './cms-taxonomy-shape';
import {initialTaxonomies} from './cms-initial-taxonomy-shape';
export type WordPressTermMapping={taxonomy:CMSTaxonomyName;slug:string;label:string};
/** Source-only plan. Native IDs and existing destination state still require review. */
export type WordPressTaxonomyEvidence={languages:Set<string>;labels:Map<string,Set<string>>};
export function wordpressTaxonomyPlan(data:WxrData,post:WxrPost,evidence:WordPressTaxonomyEvidence){
 const issues=new Set<string>(),terms:WordPressTermMapping[]=[];
 const assigned:{taxonomy:CMSTaxonomyName;slug:string}[]=[
  ...[...new Set(post.categories)].map(slug=>({taxonomy:'categories' as const,slug})),
  ...[...new Set(post.tags)].map(slug=>({taxonomy:'tags' as const,slug}))];
 if(post.customTaxonomies?.size)issues.add('custom_taxonomies_require_mapping');
 if(assigned.length&&post.postType!=='post')issues.add('page_taxonomies_require_mapping');
 if(assigned.length&&(post.translationGroup||post.locale&&post.locale!=='en'||[...evidence.languages].some(language=>!/^en(?:[-_]US)?$/i.test(language))))issues.add('taxonomy_locale_requires_review');
 if(assigned.length>20)issues.add('too_many_initial_terms');
 for(const {taxonomy,slug} of assigned){
  const domain=taxonomy==='categories'?'category':'post_tag',labelKey=(taxonomy==='categories'?'category':'tag')+'\0'+slug;
  const definitions=taxonomy==='categories'?data.categories.filter(t=>t.nicename===slug):data.tags.filter(t=>t.slug===slug);
  const candidates=[...definitions,...data.terms.filter(t=>t.taxonomy===domain&&t.slug===slug)];
  if(!candidates.length){issues.add('missing_term_definition');continue;}
  const labels=new Set(candidates.map(t=>t.name));
  for(const label of evidence.labels.get(labelKey)??[])labels.add(label);
  if(labels.size!==1){issues.add('conflicting_term_labels');continue;}
  if(candidates.some(t=>'parent' in t&&t.parent&&t.parent!=='0'))issues.add('category_hierarchy_requires_mapping');
  if(candidates.some(t=>t.description?.trim()))issues.add('term_descriptions_require_mapping');
  const label=candidates[0].name;
  try{cmsTaxonomyTerm(slug,label);}catch{issues.add('term_shape_requires_changes');continue;}
  terms.push({taxonomy,slug,label:label!});
 }
 terms.sort((a,b)=>a.taxonomy<b.taxonomy?-1:a.taxonomy>b.taxonomy?1:a.slug<b.slug?-1:a.slug>b.slug?1:0);
 // Validate the eventual envelope's byte bound using fixed-width native IDs.
 if(terms.length)try{initialTaxonomies({draftRequestId:'00000000-0000-4000-8000-000000000000',itemId:'0'.repeat(26),terms:terms.map((t,i)=>({...t,id:String(i).padStart(26,'0')}))});}catch{issues.add('initial_term_request_exceeds_limit');}
 return {version:1 as const,status:issues.size?'needs_changes' as const:terms.length?'ready_for_review' as const:'none' as const,terms:issues.size?[]:terms,issues:[...issues].sort(),applied:false as const};
}
