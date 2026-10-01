export type ImportProvenance={sourceHTML:string;author:string;sourceURL:string;sourceStatus:string;sourceDate:string;sourceSlug:string;excerpt:string;categories:string[];tags:string[]};
/** Complete current source attribution. Empty source fields remain explicit. */
export function canonicalImportProvenance(value:ImportProvenance){
 const fields=['sourceHTML','author','sourceURL','sourceStatus','sourceDate','sourceSlug','excerpt'] as const;
 const terms=['categories','tags'] as const;
 const allowed:readonly string[]=[...fields,...terms];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||fields.some(k=>typeof value[k]!=='string'||value[k].length>(k==='sourceHTML'?24000:k==='sourceURL'?2000:k==='excerpt'?4000:500)))throw Error('Invalid source attribution');
 const result:Record<string,unknown>=Object.fromEntries(fields.map(k=>[k,value[k]]));
 for(const field of terms){
  const entries=value[field];if(!Array.isArray(entries)||entries.length>50||entries.some(term=>typeof term!=='string'||!term.trim()||term.length>200))throw Error('Source taxonomy exceeds its limit');
  result[field]=entries;
 }
 const text=JSON.stringify(result);if(new TextEncoder().encode(text).length>32768)throw Error('Source metadata exceeds the import review limit');return text;
}
