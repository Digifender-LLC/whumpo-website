/** Native-only building blocks. Customer import mapping still requires a bound review. */
export const cmsTaxonomyNames=['categories','tags'] as const;
export type CMSTaxonomyName=typeof cmsTaxonomyNames[number];
export const cmsTermSlug=/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
export function cmsTaxonomyDefinition(name:unknown){
 if(name!=='categories'&&name!=='tags')throw Error('Choose categories or tags');
 return {name,label:name==='categories'?'Categories':'Tags',labelSingular:name==='categories'?'Category':'Tag',hierarchical:name==='categories',collections:['posts'],locale:'en'};
}
export function cmsTaxonomyTerm(slug:unknown,label:unknown){
 if(typeof slug!=='string'||!cmsTermSlug.test(slug)||typeof label!=='string'||!label.trim()||label!==label.trim()||label.length>200||/[\x00-\x1f\x7f]/.test(label))throw Error('Choose a bounded term slug and label');
 return {slug,label,locale:'en'};
}
export function cmsTaxonomyRequestAllowed(method:string,path:string,body:string){
 const assignment=/^\/_emdash\/api\/content\/posts\/[0-9A-HJKMNP-TV-Z]{26}\/terms\/(categories|tags)$/.test(path);
 const definition=/^\/_emdash\/api\/taxonomies\/(categories|tags)$/.test(path);
 const term=/^\/_emdash\/api\/taxonomies\/(categories|tags)\/terms\/([a-z0-9-]+)$/.exec(path);
 if(method==='GET'&&body===''&&(assignment||definition||(term&&cmsTermSlug.test(term[2]))))return true;
 if(method!=='POST')return false;
 try{const v=JSON.parse(body);if(path==='/_emdash/api/taxonomies')return body===JSON.stringify(cmsTaxonomyDefinition(v?.name));if(/^\/_emdash\/api\/taxonomies\/(categories|tags)\/terms$/.test(path))return body===JSON.stringify(cmsTaxonomyTerm(v?.slug,v?.label));}catch{}
 return false;
}
