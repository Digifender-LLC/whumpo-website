import assert from 'node:assert/strict';
import {build} from 'esbuild';
const b=await build({stdin:{contents:"export * from './src/cms-taxonomy-shape';export * from './src/cms-content-shape';export {cmsRequestAllowed} from './src/cms-bridge';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {cmsTaxonomyDefinition,cmsTaxonomyTerm,cmsRichDraftBody,cmsDraftBody,cmsRequestAllowed}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
for(const name of ['categories','tags']){
 assert.ok(cmsRequestAllowed('POST','/_emdash/api/taxonomies',JSON.stringify(cmsTaxonomyDefinition(name))));
 assert.ok(cmsRequestAllowed('POST','/_emdash/api/taxonomies/'+name+'/terms',JSON.stringify(cmsTaxonomyTerm('studio','Studio'))));
 assert.ok(cmsRequestAllowed('GET','/_emdash/api/taxonomies/'+name,''));
 assert.ok(cmsRequestAllowed('GET','/_emdash/api/taxonomies/'+name+'/terms/studio',''));
 for(const field of [{collections:['pages']},{locale:'fr'},{name:'users'},{unexpected:true}])assert.equal(cmsRequestAllowed('POST','/_emdash/api/taxonomies',JSON.stringify({...cmsTaxonomyDefinition(name),...field})),false);
 for(const field of [{parentId:'other'},{locale:'fr'},{slug:'../secret'},{description:'unreviewed'},{label:'x'.repeat(201)}])assert.equal(cmsRequestAllowed('POST','/_emdash/api/taxonomies/'+name+'/terms',JSON.stringify({...cmsTaxonomyTerm('studio','Studio'),...field})),false);
 for(const method of ['PUT','DELETE'])assert.equal(cmsRequestAllowed(method,'/_emdash/api/taxonomies/'+name+'/terms/studio','{}'),false);
}
const plain=cmsDraftBody('Article','Body');
assert.deepEqual(cmsRichDraftBody('Article',plain.data.content),plain);
assert.equal(cmsRequestAllowed('POST','/_emdash/api/content/posts',JSON.stringify({...plain,taxonomies:{tags:['studio']}})),false);
console.log('Taxonomy shape passed: strict native names, locale/collection boundaries, no arbitrary edits, combined article assignment denial and unchanged legacy drafts.');
