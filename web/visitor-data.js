// Read-only presentation of JSON. Values never become HTML, links or controls.
export function renderVisitorData(root,value){
 const doc=root.ownerDocument;let remaining=200;
 const element=(tag,className)=>{const node=doc.createElement(tag);node.className=className;return node;};
 const text=(tag,value,className='data-value')=>{const node=element(tag,className);node.textContent=value;return node;};
 function render(value,depth=0){
  if(value===null)return text('span','No value','data-empty');
  if(typeof value==='boolean')return text('span',value?'Yes':'No','data-boolean');
  if(typeof value!=='object')return text('span',String(value));
  if(depth>=5||remaining<=0)return text('pre',JSON.stringify(value,null,2),'data-raw');
  const entries=Array.isArray(value)?value:Object.entries(value);
  if(!entries.length)return text('p',Array.isArray(value)?'No items yet.':'Nothing saved yet.','data-empty');
  // Large collections remain complete without creating unbounded DOM trees.
  if(entries.length>remaining)return text('pre',JSON.stringify(value,null,2),'data-raw');
  remaining-=entries.length;
  if(Array.isArray(value)){
   const list=element('ol','data-items');
   for(const item of value){const row=element('li','data-item');row.append(render(item,depth+1));list.append(row);}return list;
  }
  const list=element('dl','data-fields');
  for(const [key,data] of entries){const row=element('div','data-field'),term=text('dt',key,'data-key'),description=element('dd','data-description');description.append(render(data,depth+1));row.append(term,description);list.append(row);}return list;
 }
 root.replaceChildren(render(value));
}
