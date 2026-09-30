export type ImportProvenance={sourceHTML:string;author:string;sourceURL:string;sourceStatus:string;sourceDate:string;sourceSlug:string;excerpt?:string;categories?:string[];tags?:string[]};
/** Preserve exact legacy receipts; new optional fields are bounded and never executable. */
export function canonicalImportProvenance(value:ImportProvenance){
 const fields=['sourceHTML','author','sourceURL','sourceStatus','sourceDate','sourceSlug'] as const;
 const optional=['excerpt','categories','tags'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>![...fields,...optional].includes(k))||fields.some(k=>typeof value[k]!=='string'||value[k].length>(k==='sourceHTML'?24000:k==='sourceURL'?2000:500)))throw Error('Invalid source attribution');
 const result:Record<string,unknown>=Object.fromEntries(fields.map(k=>[k,value[k]]));
 if(Object.hasOwn(value,'excerpt')){if(typeof value.excerpt!=='string'||value.excerpt.length>4000)throw Error('Source excerpt exceeds its limit');result.excerpt=value.excerpt;}
 for(const field of ['categories','tags'] as const)if(Object.hasOwn(value,field)){
  const terms=value[field];if(!Array.isArray(terms)||terms.length>50||terms.some(term=>typeof term!=='string'||!term.trim()||term.length>200))throw Error('Source taxonomy exceeds its limit');
  result[field]=terms;
 }
 const text=JSON.stringify(result);if(new TextEncoder().encode(text).length>32768)throw Error('Source metadata exceeds the import review limit');return text;
}
