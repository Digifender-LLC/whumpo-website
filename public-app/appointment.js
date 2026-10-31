// WH-070 hosted appointment request page. Plain script (CSP: script-src 'self' plus the Turnstile host), no storage.
// It sends the existing whumpo-modules v1 `forms.submit` to the same origin and shows only what the server answers.
(()=>{
 const form=document.getElementById('form');
 if(!form)return;
 const $=id=>document.getElementById(id),summary=$('summary'),send=$('send'),progress=$('progress'),done=$('done'),again=$('again');
 const siteKey=form.dataset.siteKey,fields=[...form.querySelectorAll('.field[data-key]')];
 let token='',widget=null,widgetFailed=false,busy=false,attempt=null;
 const message={
  unavailable:'This form isn’t open right now. Please try again later.',
  limited:'This form can’t take more requests right now. Please try again later.',
  forbidden:'The security check didn’t pass. Please try it again.',
  stale_configuration:'This form has changed. Reload the page to see the current form.',
  invalid_request:'Some answers couldn’t be accepted. Please check them and try again.',
  request_conflict:'This request was already sent with different answers. Reload the page and send it again.'
 };
 function show(el,text){el.textContent=text;el.hidden=!text;}
 function fieldError(f,text){
  const err=$('e-'+f.dataset.key),control=f.dataset.type==='choice'?f:f.querySelector('input,textarea');
  show(err,text);f.classList.toggle('invalid',!!text);
  if(f.dataset.type==='choice')f.querySelectorAll('input').forEach(i=>i.setAttribute('aria-invalid',text?'true':'false'));else control.setAttribute('aria-invalid',text?'true':'false');
 }
 function read(f){
  const key=f.dataset.key,type=f.dataset.type;
  if(type==='choice')return form.querySelector(`input[name="${CSS.escape(key)}"]:checked`)?.value??'';
  if(type==='boolean')return f.querySelector('input').checked;
  const raw=f.querySelector('input,textarea').value.trim();
  return type==='number'?(raw===''?'':Number(raw)):raw;
 }
 function validate(){
  const values={},problems=[];
  for(const f of fields){
   const v=read(f),optional=!!f.querySelector('.opt'),type=f.dataset.type;let problem='';
   if(type==='boolean'){values[f.dataset.key]=v;}
   else if(v===''||v===undefined){if(!optional)problem=type==='choice'?'Choose one.':'This is needed.';}
   else if(type==='number'&&!Number.isFinite(v))problem='Enter a number.';
   else if(type==='text'&&v.length>300)problem='Use 300 characters or fewer.';
   if(!problem&&v!==''&&type!=='boolean')values[f.dataset.key]=v;
   fieldError(f,problem);if(problem)problems.push([f,problem]);
  }
  return {values,problems};
 }
 function focusFirst(f){(f.dataset.type==='choice'?f.querySelector('input'):f.querySelector('input,textarea')).focus();}
 function renderWidget(){
  if(!siteKey||widget!==null||!window.turnstile)return;
  widget=window.turnstile.render('#widget',{sitekey:siteKey,action:'module-form',cData:form.dataset.resource,theme:'auto',
   callback:t=>{token=t;show($('e-check'),'');},'expired-callback':()=>{token='';},'error-callback':()=>{token='';widgetFailed=true;}});
 }
 if(siteKey){
  const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.async=true;
  s.onload=renderWidget;s.onerror=()=>{widgetFailed=true;show($('e-check'),'The security check couldn’t load. Check your connection, reload the page and try again.');};
  document.head.appendChild(s);
 }
 function fail(text,focus){show(summary,text);summary.hidden=false;if(focus!==false)summary.focus();}
 function busyState(on){busy=on;send.setAttribute('aria-disabled',on?'true':'false');form.setAttribute('aria-busy',on?'true':'false');send.textContent=on?'Sending…':'Send request';show(progress,on?'Sending your request…':'');}
 form.addEventListener('submit',async e=>{
  e.preventDefault();
  if(busy)return;
  show(summary,'');
  const {values,problems}=validate();
  if(siteKey&&!token){
   show($('e-check'),widgetFailed?'The security check couldn’t load. Reload the page and try again.':'Complete the security check before sending.');
   if(!problems.length){fail('Complete the security check below, then send again.',false);$('widget').scrollIntoView({block:'center'});}
  }
  if(problems.length){fail(`${problems.length===1?'One answer needs':problems.length+' answers need'} attention.`,false);focusFirst(problems[0][0]);return;}
  if(siteKey&&!token)return;
  // The same request id is reused while the answers are unchanged, so a lost reply is replayed by the server, never sent twice.
  const key=JSON.stringify(values);
  if(!attempt||attempt.key!==key)attempt={key,id:crypto.randomUUID()};
  busyState(true);
  const headers={'content-type':'application/json'};if(siteKey)headers['whumpo-turnstile-response']=token;
  try{
   const response=await fetch(form.dataset.modules,{method:'POST',credentials:'same-origin',redirect:'error',headers,
    body:JSON.stringify({api:'whumpo-modules',version:1,operation:'forms.submit',resourceId:form.dataset.resource,configRevision:Number(form.dataset.revision),requestId:attempt.id,target:{formId:form.dataset.form},input:{values}})});
   let body=null;try{body=await response.json();}catch{}
   if(response.ok&&body?.result?.accepted===true){
    $('reference').textContent=String(body.result.entryId??'').slice(0,8).toUpperCase();attempt=null;token='';form.hidden=true;done.hidden=false;done.focus();return;
   }
   if(siteKey&&window.turnstile&&widget!==null){token='';window.turnstile.reset(widget);}
   fail(message[body?.code]??'We couldn’t send your request. Your answers are still here. Please try again.');
  }catch{
   if(siteKey&&window.turnstile&&widget!==null){token='';window.turnstile.reset(widget);}
   fail('We couldn’t reach the server. Check your connection and try again. Your answers are still here.');
  }finally{busyState(false);}
 });
 // Clearing an error as soon as the field is corrected keeps the message next to what it describes.
 form.addEventListener('input',e=>{const f=e.target.closest?.('.field[data-key]');if(f&&!$('e-'+f.dataset.key).hidden)fieldError(f,'');});
 again.addEventListener('click',()=>{form.reset();fields.forEach(f=>fieldError(f,''));show(summary,'');done.hidden=true;form.hidden=false;if(widget!==null&&window.turnstile)window.turnstile.reset(widget);token='';focusFirst(fields[0]);});
})();
