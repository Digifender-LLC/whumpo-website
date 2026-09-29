export function createProfile({api,text,showMessage,openSecurity}){
 let profile;const $=s=>document.querySelector(s);
 const mode=window.matchMedia('(prefers-color-scheme: dark)');
 function theme(value){document.documentElement.dataset.theme=value==='system'?(mode.matches?'dark':'light'):value;try{localStorage.setItem('whumpo-theme',value);}catch{}}
 mode.addEventListener('change',()=>theme(profile?.theme??'system'));
 try{theme(localStorage.getItem('whumpo-theme')||'system');}catch{theme('system');}
 function avatar(){const img=$('#profile-avatar');img.src=profile?.hasPhoto?`/api/profile/photo?v=${profile.revision}`:'/brand/avatar.svg';}
 function button(label,fn,style=''){const b=text('button',label,style);b.type='button';b.onclick=()=>Promise.resolve().then(fn).catch(e=>showMessage(e.message));return b;}
 function field(form,label,el,help){const l=text('label',label);l.append(el);if(help)l.append(text('span',help,'field-hint'));form.append(l);return el;}
 function section(title,copy){const s=text('section','','settings-section');s.append(text('h2',title));if(copy)s.append(text('p',copy,'muted'));return s;}
 async function save(patch){profile=await api('/profile',{method:'PATCH',body:JSON.stringify({revision:profile.revision,...patch})});avatar();theme(profile.theme);return profile;}
 async function photo(file){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10485760)throw Error('Choose a JPEG, PNG or WebP under 10 MB');
  const bitmap=await createImageBitmap(file);try{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d');ctx.fillStyle='#eee9dc';ctx.fillRect(0,0,256,256);const size=Math.min(bitmap.width,bitmap.height);ctx.drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,256,256);
   let blob;for(const q of [.85,.65,.45,.25]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',q));if(blob&&blob.size<=32768)break;}if(!blob||blob.size>32768)throw Error('Choose a less detailed photo');
   const r=await fetch('/api/profile/photo',{method:'PUT',credentials:'same-origin',headers:{'content-type':'image/jpeg','if-match':String(profile.revision)},body:blob});const value=await r.json();if(!r.ok)throw Error(value.error);profile=value;avatar();
  }finally{bitmap.close();}
 }
 function render(container){
  const identity=section('Personal details','A familiar face and a little about you.'),form=document.createElement('form');form.className='profile-form';
  const photoRow=text('div','','profile-photo-row'),img=document.createElement('img');img.src=profile.hasPhoto?`/api/profile/photo?v=${profile.revision}`:'/brand/avatar.svg';img.alt='Your profile photo';img.className='profile-photo';
  const picker=document.createElement('input');picker.type='file';picker.accept='image/jpeg,image/png,image/webp';picker.id='profile-photo-input';picker.hidden=true;
  const pickerLabel=button('Change photo',()=>picker.click(),'secondary');photoRow.append(img,pickerLabel,picker);const photoStatus=text('p','','field-hint');photoStatus.setAttribute('role','status');
  picker.onchange=async()=>{picker.disabled=true;try{photoStatus.textContent='Preparing your photo…';await photo(picker.files[0]);img.src=`/api/profile/photo?v=${profile.revision}`;photoStatus.textContent='Photo saved. Only you can see it.';removePhoto.hidden=false;}catch(e){photoStatus.textContent=e.message;}finally{picker.disabled=false;picker.value='';}};
  const removePhoto=button('Remove',async()=>{profile=await api('/profile/photo',{method:'DELETE',headers:{'if-match':String(profile.revision)}});avatar();img.src='/brand/avatar.svg';photoStatus.textContent='Photo removed.';removePhoto.hidden=true;},'quiet');removePhoto.hidden=!profile.hasPhoto;photoRow.append(removePhoto);form.append(photoRow,photoStatus);
  const name=document.createElement('input');name.value=profile.name;name.maxLength=80;name.autocomplete='name';field(form,'Name',name);
  const email=document.createElement('input');email.type='email';email.value=profile.email;email.readOnly=true;field(form,'Sign-in email',email,'Email changes will be available once email verification is connected.');
  const about=document.createElement('textarea');about.value=profile.about_me;about.maxLength=1200;about.rows=4;field(form,'About me',about,'Your role, goals, and how you like to work. Keep passwords and sensitive information out.');
  const consent=document.createElement('input');consent.type='checkbox';consent.checked=!!profile.share_context;const l=text('label','','check-label');l.append(consent,text('span','Let Whumpo use my name and About me when helping me'));form.append(l,text('p','Shared context is sent to the AI provider. The current Contributor testing model may use it for training. Your photo and email are not included.','field-hint'));
  const submit=text('button','Save profile','primary');submit.type='submit';const status=text('p','','form-status');status.setAttribute('role','status');form.append(submit,status);
  form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{await save({name:name.value.trim(),about_me:about.value.trim(),share_context:consent.checked});status.textContent='Your profile is saved.';}catch(e){status.textContent=e.message;}finally{submit.disabled=false;}};identity.append(form);container.append(identity);
  const security=section('Sign-in & security','Manage the ways you access your account.');security.append(button('Passkeys & recovery',openSecurity,'secondary'));
  const details=document.createElement('details');details.className='account-password';details.append(text('summary',profile.passwordEnabled?'Change password':'Add a password'));
  const passwordForm=document.createElement('form');let current;
  if(profile.passwordEnabled){current=document.createElement('input');current.type='password';current.autocomplete='current-password';current.required=true;current.maxLength=128;field(passwordForm,'Current password',current);}
  const next=document.createElement('input');next.type='password';next.autocomplete='new-password';next.minLength=12;next.maxLength=128;next.required=true;field(passwordForm,'New password',next,'At least 12 characters. Changing it signs out your other sessions.');
  const confirm=document.createElement('input');confirm.type='password';confirm.autocomplete='new-password';confirm.required=true;field(passwordForm,'Confirm new password',confirm);
  const change=text('button','Save password','secondary');change.type='submit';const result=text('p','','form-status');result.setAttribute('role','status');passwordForm.append(change,result);
  passwordForm.onsubmit=async e=>{e.preventDefault();if(next.value!==confirm.value){result.textContent='The passwords don’t match.';return;}change.disabled=true;try{await api('/profile/password',{method:'POST',body:JSON.stringify({newPassword:next.value,currentPassword:current?.value})});passwordForm.reset();result.textContent='Password saved. Other sessions are signed out.';profile.passwordEnabled=true;if(!current){current=document.createElement('input');current.type='password';current.autocomplete='current-password';current.required=true;current.maxLength=128;field(passwordForm,'Current password',current);passwordForm.prepend(current.parentElement);}details.querySelector('summary').textContent='Change password';}catch(e){result.textContent=e.message;}finally{change.disabled=false;}};details.append(passwordForm);security.append(details);container.append(security);
  const session=section('Your session');session.append(button('Sign out',async()=>{await api('/auth/logout',{method:'POST'});location.reload();},'secondary'));container.append(session);
 }
 function appearance(container){const s=section('Appearance','Choose the light that feels right for you.'),group=text('div','','theme-options');group.setAttribute('aria-label','Color theme');for(const [value,label]of [['light','Day'],['dark','Night'],['system','Device']]){const b=button('',async()=>{group.querySelectorAll('button').forEach(el=>el.disabled=true);try{await save({theme:value});group.querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));}finally{group.querySelectorAll('button').forEach(el=>el.disabled=false);}});const preview=text('span','','theme-preview theme-preview-'+value);preview.setAttribute('aria-hidden','true');preview.append(text('span','','theme-preview-nav'),text('span','','theme-preview-content'));b.append(preview,text('span',label,'theme-label'));b.setAttribute('aria-label',value==='system'?'Use device setting':label);b.setAttribute('aria-pressed',String(profile.theme===value));group.append(b);}s.append(group);container.append(s);}
 return {async load(){profile=await api('/profile');avatar();theme(profile.theme);},render,appearance};
}
