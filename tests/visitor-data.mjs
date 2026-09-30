import assert from 'node:assert/strict';
import {renderVisitorData} from '../web/visitor-data.js';
// Minimal DOM sink records every element and text write. Unsupported HTML or
// interaction APIs fail rather than silently accepting unsafe presentation.
class Node{
 constructor(tag){this.tag=tag;this.children=[];this.ownerDocument=doc;}
 set className(value){this.css=value;}
 set textContent(value){this.children=[String(value)];}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=[...nodes];}
}
const doc={createElement:tag=>new Node(tag)};
const flatten=node=>typeof node==='string'?node:node.children.map(flatten).join('|');
const nodes=node=>typeof node==='string'?[]:[node,...node.children.flatMap(nodes)];
const root=new Node('div');
const source={nextId:3,items:[{id:1,text:'Buy milk',done:false},{id:2,text:'<img src=x onerror=alert(1)>',done:true}]};const before=JSON.stringify(source);
renderVisitorData(root,source);assert.equal(JSON.stringify(source),before);assert.equal(nodes(root).filter(n=>n.tag==='li').length,2);assert.match(flatten(root),/Buy milk/);assert.match(flatten(root),/<img src=x onerror=alert\(1\)>/);assert.match(flatten(root),/No/);assert.match(flatten(root),/Yes/);
assert.ok(nodes(root).every(n=>['div','dl','dt','dd','ol','li','span'].includes(n.tag)),'Data cannot create active elements');
renderVisitorData(root,{'go to':'javascript:alert(1)','a_b':false,aB:true,nothing:null,empty:[],object:{}});assert.match(flatten(root),/a_b/);assert.match(flatten(root),/aB/);assert.match(flatten(root),/No value/);assert.match(flatten(root),/No items yet/);assert.ok(!flatten(root).includes('Buy milk'),'Replacement clears previous visitor information');
let deep={final:'Retained at the depth boundary'};for(let i=0;i<15;i++)deep={nested:deep};renderVisitorData(root,deep);assert.ok(nodes(root).some(n=>n.tag==='pre'));assert.match(flatten(root),/Retained at the depth boundary/);assert.ok(nodes(root).length<35);
const wide=Array.from({length:201},(_,id)=>({id,text:'record '+id}));renderVisitorData(root,wide);assert.equal(nodes(root).length,2);assert.match(flatten(root),/record 200/);
renderVisitorData(root,[0,'',false,null]);assert.equal(nodes(root).filter(n=>n.tag==='li').length,4);assert.ok(flatten(root).includes('0'));assert.ok(flatten(root).includes('No value'));
console.log('Visitor data passed: nested record/list presentation, literal unsafe text, no active controls or links, exact keys, source preservation, complete bounded fallback and replacement of previous data.');
