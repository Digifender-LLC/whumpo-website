import assert from 'node:assert/strict';
import {build} from 'esbuild';
const code=await build({entryPoints:['frontend/src/lib/cms-editor-shape.ts'],bundle:true,format:'esm',write:false});
const {editableCMS}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
const snapshot={item:{data:{title:'Bread | & butter',content:[{_type:'block',style:'normal',markDefs:[],children:[{_type:'span',text:'First line\n\nSecond <script>line</script> | unchanged',marks:[]}]}]}}};
assert.deepEqual(editableCMS(snapshot),{title:snapshot.item.data.title,text:snapshot.item.data.content[0].children[0].text});
for(const value of [null,{}, {item:{}}, {item:{data:null}}, {item:{data:{title:'A',content:[null]}}}])assert.equal(editableCMS(value),null);
for(const change of [b=>b.style='h1',b=>b.markDefs.push({_type:'link',href:'https://example.test'}),b=>b.children[0].marks.push('strong'),b=>b.children.push({...b.children[0]}),b=>b._type='image',b=>b.children[0].text='🙂'.repeat(601)]){
 const rich=structuredClone(snapshot);change(rich.item.data.content[0]);assert.equal(editableCMS(rich),null);
}
const multi=structuredClone(snapshot);multi.item.data.content.push(structuredClone(multi.item.data.content[0]));assert.equal(editableCMS(multi),null);
console.log('CMS editor shape passed: exact text round-trip, delimiter/HTML-as-text preservation, rich/malformed content refusal and UTF-8 limits.');
