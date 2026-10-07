import {visitorPasskey} from './visitor-passkey.js';
import {moduleClient,inputDigest} from './module-client.js';
const $=s=>document.querySelector(s),base=location.pathname.replace(/\/portal$/,''),key='whumpo-portal-request:'+base;
let manifest,client,roles=[],generation=0,pending=null,busy=false;
try{const p=JSON.parse(sessionStorage.getItem(key)||'null');if(p?.version===1&&/^[a-f0-9-]{36}$/.test(p.id)&&/^[a-f0-9]{64}$/.test(p.digest)&&typeof p.blockId==='string'&&Number.isSafeInteger(p.createdAt)&&p.createdAt>0)pending=p;}catch{}
const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const info=(message)=>{$('#portal-status').textContent=message;};
async function send(path,body,bytes){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const header=bytes?btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(body)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''):null;
  const response=await fetch(base+'/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',redirect:'error',signal:controller.signal,headers:bytes?{'content-type':'image/jpeg','whumpo-module-request':header}:{'content-type':'application/json'},body:bytes??(body===undefined?undefined:JSON.stringify(body))});
  if(response.ok&&response.headers.get('content-type')==='image/jpeg')return response.blob();
  let value;try{value=await response.json();}catch{throw Error('The response could not be read. The request may have saved. Retry the same request.');}if(!response.ok){const error=Error(value.code==='stale_configuration'?'This portal changed. Reload before continuing.':value.message??value.error??'This action is not available for your account.');error.code=value.code;error.status=response.status;throw error;}return value;
 }finally{clearTimeout(timer);}
}
const explain=e=>e.name==='AbortError'?'The response has not arrived. The request may have saved. Retry only this same request.':e.name==='NotAllowedError'?'Passkey verification was cancelled.':e.message;
function remember(value){if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);pending=value;$('#retry-help').hidden=!pending;}
async function action(fn){if(busy)return;busy=true;document.querySelectorAll('button,input,select,textarea').forEach(b=>b.disabled=true);try{await fn();}catch(e){info(explain(e));}finally{busy=false;document.querySelectorAll('button,input,select,textarea').forEach(b=>b.disabled=false);}}
function clearValues(){generation++;document.querySelectorAll('[data-content]').forEach(n=>n.replaceChildren(el('p','Sign in to load this component.')));}
function pendingMessage(){return pending?'A previous change has no confirmed response. Re-enter its original fields or select the same photo, then retry that component. Other changes are blocked.':'';}
async function write(block,envelope,bytes){
 if(pending&&Date.now()-pending.createdAt>86400000)throw Error('This retry record expired. Check your saved information and stop retrying before starting another request.');
 const digest=await inputDigest({...envelope,requestId:null});
 if(pending&&(pending.digest!==digest||pending.blockId!==block.id))throw Error('A different request is waiting for confirmation. Retry its exact original fields or photo first.');
 const id=pending?.id??crypto.randomUUID();
 remember({version:1,id,digest,blockId:block.id,createdAt:pending?.createdAt??Date.now()});
 const result=await send(bytes?'modules/upload':'modules',{...envelope,requestId:id},bytes);
 if(result?.requestId!==id)throw Error('The response did not confirm this request. Retry the same request.');
 remember(null);return result.result;
}
const allowed=audience=>audience==='visitor'||audience==='staff'&&roles.includes('staff');
function formInput(field){
 const label=el('label',field.label),input=el(field.type==='choice'?'select':'input');input.name=field.key;
 if(field.type==='choice'){
  const option=el('option','Choose an option');option.value='';input.append(option);
  for(const choice of field.options){const option=el('option',choice.label);option.value=choice.value;input.append(option);}
 }else input.type=field.type==='boolean'?'checkbox':field.type;
 if(field.type==='text')input.maxLength=300;if(field.type==='number')input.step='any';
 input.required=!field.optional&&field.type!=='boolean';input.autocomplete='off';label.append(input);return {label,input};
}
async function renderForm(block,target){
 if(!allowed(block.submit)){target.append(el('p','This form is for staff.'));return;}
 const form=el('form'),fields=block.fields.map(field=>({field,...formInput(field)}));fields.forEach(({label})=>form.append(label));
 let attachments=[];
 if(block.attachment){
  const {instanceId,collectionId}=block.attachment;
  const group=el('fieldset');group.append(el('legend','Attach your approved photos (up to four)'));
  // An optional attachment collection may not expose a gallery. The form still
  // admits an empty reference list; the backend independently checks every file.
  let items=[];try{items=(await client.read(instanceId,'files.gallery',{collectionId})).result.items;}catch{}
  items.forEach((file,n)=>{const label=el('label','Photo '+(n+1)),input=el('input');input.type='checkbox';input.value=file.fileId;label.prepend(input);attachments.push(input);group.append(label);});
  if(!attachments.length)group.append(el('p','No approved photos are available. You can send the form without an attachment.'));
  form.append(group);
 }
 form.append(el('button',pending?.blockId===block.id?'Retry this exact submission':'Send submission'));
 form.onsubmit=event=>{event.preventDefault();action(async()=>{
  const values=Object.fromEntries(fields.map(({field,input})=>[field.key,field.type==='boolean'?input.checked:field.type==='number'?input.valueAsNumber:input.value]));
  const input={values,...(block.attachment?{attachments:attachments.filter(a=>a.checked).map(a=>({fileId:a.value}))}:{})};
  const result=await write(block,client.request(block.instanceId,'forms.submit',{formId:block.targetId},input));
  if(result?.accepted!==true)throw Error('Submission was not confirmed.');form.reset();await loadBlocks();info('Your submission is saved.');
 });};target.append(form);
}
async function renderRecords(block,target){
 if(!allowed(block.audience)){target.append(el('p','These records are for staff.'));return;}
 const list=el('ul');list.className='records';target.append(list);let cursor=null;
 const more=el('button','Show more records');more.type='button';target.append(more);
 const load=async()=>{
  const result=(await client.read(block.instanceId,'records.view',{viewId:block.targetId,cursor})).result;
  for(const row of result.items){const li=el('li'),dl=el('dl');for(const field of block.fields){dl.append(el('dt',field.label),el('dd',String(row.values[field.key]??'')));}li.append(dl);list.append(li);}
  cursor=result.next;more.hidden=!cursor;if(!list.children.length)list.append(el('li','No saved records yet.'));
 };
 more.onclick=()=>action(load);await load();
}
async function renderGallery(block,target){
 if(!allowed(block.audience)){target.append(el('p','This gallery is for staff.'));return;}
 const grid=el('div');grid.className='gallery';target.append(grid);
 const {items}=(await client.read(block.instanceId,'files.gallery',{collectionId:block.targetId})).result;
 for(const [n,file] of items.entries()){
  const blob=await client.read(block.instanceId,'files.read',{collectionId:block.targetId,fileId:file.fileId});
  const image=el('img');image.alt='Approved photo '+(n+1);image.width=file.width;image.height=file.height;const url=URL.createObjectURL(blob);image.onload=image.onerror=()=>URL.revokeObjectURL(url);image.src=url;grid.append(image);
 }
 if(!items.length)grid.append(el('p','No approved photos yet.'));
 const role=roles.includes('staff')?'staff':'visitor';if(!block.upload.includes(role))return;
 const form=el('form'),label=el('label','Add a JPEG photo (up to 1 MiB)'),input=el('input');input.type='file';input.accept='image/jpeg';input.required=true;label.append(input);form.append(label,el('button',pending?.blockId===block.id?'Retry this exact photo':'Upload photo'));
 form.onsubmit=event=>{event.preventDefault();action(async()=>{
  const file=input.files[0];if(!file||file.size>1048576)throw Error('Choose a JPEG photo up to 1 MiB.');
  const bytes=new Uint8Array(await file.arrayBuffer()),sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  await write(block,client.request(block.instanceId,'files.putBytes',{collectionId:block.targetId},{mediaType:'image/jpeg',byteLength:bytes.length,sha256}),bytes);
  form.reset();info('Your photo is saved and waiting for safety review. It cannot appear or be attached yet.');
 });};target.append(form);
}
async function loadBlocks(){
 const run=++generation;
 for(const block of manifest.presentation.blocks){
  if(block.kind==='custom-card')continue;
  const section=document.querySelector('[data-block="'+block.id+'"]'),target=el('div');
  try{
   if(block.kind==='form')await renderForm(block,target);
   if(block.kind==='records')await renderRecords(block,target);
   if(block.kind==='gallery')await renderGallery(block,target);
   if(block.kind==='directory'){
    const data=(await client.read(block.instanceId,'collections.readPublic',{collectionId:block.targetId})).result;
    for(const item of data.listings??[]){target.append(el('h3',item.name),el('p',item.description));}
   }
  }catch(e){target.replaceChildren(el('p',explain(e)));}
  if(run!==generation)return;if(busy)target.querySelectorAll('button,input,select,textarea').forEach(b=>b.disabled=true);section.querySelector('[data-content]').replaceChildren(target);
 }
}
async function enter(){
 const me=await client.read(manifest.presentation.accessInstanceId,'access.me');roles=me.result.roles;
 $('#signin').hidden=true;$('#signedin').hidden=false;$('#account-status').textContent=roles.includes('staff')?'Signed in as staff.':'You’re signed in.';
 $('#export-account').href=base+'/export';$('#retry-help').hidden=!pending;info(pendingMessage());await loadBlocks();
}
$('#login').onclick=()=>action(async()=>{await visitorPasskey(send,'login');sessionStorage.removeItem(key+':logout');$('#retry-logout').hidden=true;await enter();});
$('#join').onsubmit=event=>{event.preventDefault();action(async()=>{const result=await visitorPasskey(send,'signup',event.target.elements.namedItem('code').value.trim());sessionStorage.removeItem(key+':logout');$('#retry-logout').hidden=true;event.target.reset();$('#recovery-code').value=result.recoveryCode;$('#recovery').hidden=false;$('#signin').hidden=true;$('#recovery-code').focus();});};
$('#saved-code').onclick=()=>action(async()=>{$('#recovery-code').value='';$('#recovery').hidden=true;await enter();});
function hidePrivateAccount(){clearValues();roles=[];$('#recovery-code').value='';$('#recovery').hidden=true;$('#signedin').hidden=true;$('#signin').hidden=false;$('#retry-logout').hidden=false;$('#account-status').textContent='Your private information is hidden. Sign-out needs confirmation.';}
async function signOut(){
 hidePrivateAccount();sessionStorage.setItem(key+':logout','pending');
 try{await send('auth/logout',{});}catch{throw Error('Your private information is hidden. Sign-out could not be confirmed. Retry sign-out.');}
 sessionStorage.removeItem(key+':logout');$('#retry-logout').hidden=true;$('#account-status').textContent='You’re signed out.';info(pendingMessage());
}
$('#logout').onclick=$('#retry-logout').onclick=()=>action(signOut);
$('#stop-retry').onclick=()=>action(async()=>{remember(null);await loadBlocks();info('The browser reminder is cleared. An already sent request may still finish; check your saved information before sending a new change.');});
$('#refresh').onclick=()=>action(async()=>{clearValues();await enter();});
action(async()=>{manifest=await send('portal/config');client=moduleClient({manifest,send});if(sessionStorage.getItem(key+':logout')){hidePrivateAccount();return;}try{await enter();}catch(e){if(e.status!==403&&e.status!==401)throw e;$('#signin').hidden=false;$('#account-status').textContent='Sign in to use this portal.';}});
