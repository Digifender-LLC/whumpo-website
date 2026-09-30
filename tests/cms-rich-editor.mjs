import assert from 'node:assert/strict';import {build} from 'esbuild';
const b=await build({entryPoints:['frontend/src/lib/cms-rich-editor.ts'],bundle:true,format:'esm',platform:'node',write:false});const {richEditable,setRichLink,newRichBlock}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const block={_type:'block',_key:'existing',style:'h2',markDefs:[{_type:'link',_key:'shared',href:'https://example.com'}],children:[{_type:'span',_key:'a',text:'First',marks:['strong','shared']},{_type:'span',_key:'b',text:'Second',marks:['em','shared']}]};
const snapshot={revision:'rev1',item:{status:'draft',data:{title:'Story',content:[block],nativeExtra:'untouched'}}};const editable=richEditable(snapshot);assert.deepEqual(editable.content,[block]);editable.content[0].children[0].text='Changed';assert.equal(block.children[0].text,'First');
const updated=setRichLink(block,0,'https://example.org');assert.deepEqual(updated.children[1],block.children[1]);assert.ok(updated.markDefs.some(d=>d._key==='shared'));assert.equal(updated.children[0].marks[0],'strong');assert.equal(updated.markDefs.find(d=>updated.children[0].marks.includes(d._key)).href,'https://example.org');assert.deepEqual(snapshot.item.data.content,[block]);
const unused={_type:'link',_key:'unused',href:'https://example.net'};assert.ok(setRichLink({...block,markDefs:[...block.markDefs,unused]},0,'').markDefs.some(d=>d._key==='unused'));
assert.equal(setRichLink(block,0,'').children[0].marks.includes('shared'),false);assert.ok(setRichLink(block,0,'').markDefs.some(d=>d._key==='shared'));
assert.equal(richEditable({...snapshot,item:{...snapshot.item,data:{...snapshot.item.data,content:[{...block,alignment:'center'}]}}}),null);assert.equal(richEditable({...snapshot,item:{...snapshot.item,data:{...snapshot.item.data,content:[{...block,_key:{unsafe:true}}]}}}),null);
const fresh=newRichBlock();assert.equal(fresh.children[0].text,'');assert.notEqual(newRichBlock()._key,fresh._key);
console.log('Rich editor adapter passed: exact round-trip, cloned state, shared link isolation and unsupported-content refusal.');

const image={_type:'image',_key:'photo',asset:{_ref:'01ARZ3NDEKTSV4RRFFQ69G5FAV'},alt:'Original description',caption:'Original caption'};
const illustrated={...snapshot,item:{...snapshot.item,data:{...snapshot.item.data,content:[block,image]}}},imageEdit=richEditable(illustrated);assert.deepEqual(imageEdit.content,[block,image]);imageEdit.content[1].caption='Changed';assert.equal(image.caption,'Original caption');
assert.equal(richEditable({...illustrated,item:{...illustrated.item,data:{...illustrated.item.data,content:[block,{...image,asset:{...image.asset,url:'https://tracker.test'}}]}}}),null);
