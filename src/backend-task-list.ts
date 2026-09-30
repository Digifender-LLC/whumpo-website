/** Platform-authored pure transition. Only synthetic data belongs in this module. */
export const taskListSource=`export default ({state,input}) => {
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 const integer=v=>Number.isSafeInteger(v)&&v>0&&v<=1000000000;
 const validText=v=>typeof v==='string'&&v.trim().length>0&&v.length<=80&&!/[\\u0000-\\u001f\\u007f]/.test(v)&&Array.from(v).every(c=>{const n=c.codePointAt(0);return n<0xd800||n>0xdfff;});
 if(!object(state)||!object(input)||Object.keys(input).some(k=>!['action','id','text'].includes(k)))throw Error('Provide state and a task action');
 if(input.text!==undefined&&typeof input.text!=='string'||input.id!==undefined&&(!Number.isSafeInteger(input.id)||input.id<0))throw Error('Invalid task input');
 const empty=Object.keys(state).length===0;
 if(!empty&&(Object.keys(state).length!==2||!Object.hasOwn(state,'items')||!Object.hasOwn(state,'nextId')))throw Error('Unsupported task document');
 const nextId=empty?1:state.nextId,items=empty?[]:state.items;
 if(!integer(nextId)||!Array.isArray(items)||items.length>12)throw Error('Invalid task document');
 const seen=new Set();
 for(const item of items){
  if(!object(item)||Object.keys(item).length!==3||!integer(item.id)||item.id>=nextId||seen.has(item.id)||!validText(item.text)||typeof item.done!=='boolean')throw Error('Invalid saved task');
  seen.add(item.id);
 }
 let next=nextId,result=items.map(item=>({id:item.id,text:item.text,done:item.done}));
 if(input.action==='add'){
  if(!validText(input.text)||items.length>=12||nextId>=1000000000)throw Error('Use up to 12 tasks with 80 characters each');
  result.push({id:nextId,text:input.text.trim(),done:false});next++;
 }else if(['complete','reopen','remove'].includes(input.action)){
  if(!integer(input.id)||!seen.has(input.id))throw Error('Choose a saved task ID');
  result=input.action==='remove'?result.filter(item=>item.id!==input.id):result.map(item=>item.id===input.id?{...item,done:input.action==='complete'}:item);
 }else if(input.action!=='list')throw Error('Choose add, complete, reopen, remove or list');
 return {state:{nextId:next,items:result},result:{items:result}};
};`;
