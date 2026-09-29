export function createAppAccess({api,text,sendMessage}){
 let selected='';
 function button(label,run,style='secondary'){const b=text('button',label,style);b.type='button';b.onclick=run;return b;}
 function render(container,projects,back,projectId){
  if(projectId)selected=projectId;
  if(!projects.some(p=>p.id===selected))selected=projects[0]?.id??'';
  const root=text('section','','settings-section'),heading=text('div','','control-grid');
  heading.append(button('Back to dashboard',back));root.append(heading,text('p','Visitor accounts are separate from your Whumpo account.'));
  container.append(root);
  if(!projects.length){root.append(text('p','Create a project in Chat to begin.'));return;}
  const label=text('label','Project'),select=document.createElement('select');for(const project of projects){const option=text('option',project.name);option.value=project.id;select.append(option);}select.value=selected;label.append(select);root.append(label);
  const status=text('p','','form-status');status.setAttribute('role','status');const content=text('div','','stack');root.append(status,content);let sequence=0;
  async function load(){
   const request=++sequence,project=select.value;selected=project;status.textContent='Loading access…';content.replaceChildren();
   try{const state=await api(`/projects/${project}/application-access`);if(!root.isConnected||request!==sequence)return;status.textContent='';show(state,project);}
   catch(error){if(root.isConnected&&request===sequence)status.textContent=error.message;}
  }
  async function change(path,b,done){
   b.disabled=true;select.disabled=true;status.textContent='';
   try{const result=await api(path,{method:'POST',body:'{}'});if(root.isConnected)await done(result);}
   catch(error){if(root.isConnected)status.textContent=error.message;}
   finally{b.disabled=false;select.disabled=false;}
  }
  function confirmAction(parent,description,actionLabel,path){
   const review=text('div','','access-review');review.setAttribute('role','group');review.setAttribute('aria-label','Confirm access change');review.append(text('p',description));
   const actions=text('div','','control-grid');const confirm=button(actionLabel,()=>change(path,confirm,load));actions.append(confirm,button('Keep access',()=>review.remove()));review.append(actions);parent.querySelector('.access-review')?.remove();parent.append(review);confirm.focus();
  }
  function show(state,project){
   const base=`/projects/${project}/application-access`,enabled=state.configuration?.enabled===1;
   const setup=text('div','','dashboard-card');setup.append(text('h3',enabled?'Application authorized':'Application setup'));
   if(!state.publicAccessReady)setup.append(text('p','No visitor page is published for this application. Ask Whumpo to prepare its page for your review. Invitations become usable after the page is published.'));
   if(!enabled)setup.append(text('p','Ask Whumpo to build and test your application, then review its access to visitor data before inviting anyone.'));
   if(state.publicAccessReady&&state.url){const link=text('a','Open visitor page');link.href=state.url;link.target='_blank';link.rel='noopener noreferrer';setup.append(link);}setup.append(button('Page settings in Chat',()=>sendMessage(`/app-page ${project}`)));
   setup.append(button('Review application in Chat',()=>sendMessage(`/application ${project}`)));content.append(setup);
   const invites=text('div','','dashboard-card');invites.append(text('h3','Invitations'),text('p','Each invitation works once and expires after 24 hours. Share it privately with the intended visitor. Never paste invitation codes into Chat.'));
   const secret=text('div','','access-secret');secret.hidden=true;
   const create=button('Create invitation',()=>change(base+'/invitations',create,async result=>{
    create.hidden=true;secret.replaceChildren(text('h4','Save this invitation'),text('p','This code is shown only now. If you lose it, cancel the invitation and create another.'));
    const code=document.createElement('textarea');code.readOnly=true;code.rows=3;code.value=result.code;code.autocomplete='off';code.spellcheck=false;code.setAttribute('aria-label','Private application invitation code');secret.append(code);
    const copied=text('p','','form-status');copied.setAttribute('role','status');const actions=text('div','','control-grid');
    actions.append(button('Copy invitation',async()=>{try{await navigator.clipboard.writeText(code.value);copied.textContent='Invitation copied. Share it privately.';}catch{code.focus();code.select();copied.textContent='Select and copy this code manually.';}}),button('I’ve saved it',()=>{code.value='';secret.replaceChildren();secret.hidden=true;load();}));secret.append(actions,copied);secret.hidden=false;code.focus();
   }),'primary');create.disabled=!enabled;invites.append(create,secret);
   if(!state.invitations.length)invites.append(text('p','No invitations have been created.','muted'));
   for(const invite of state.invitations){const row=text('div','','access-row');row.append(text('strong',`Invitation ${invite.id.slice(0,8)}`),text('p',`${invite.status} · Expires ${new Date(invite.expires_at).toLocaleString()}`));if(['ready','inactive'].includes(invite.status))row.append(button('Cancel invitation',()=>confirmAction(row,'Cancel this unused invitation? Its code will stop working.','Cancel invitation',`${base}/invitations/${invite.id}/cancel`)));invites.append(row);}
   content.append(invites);
   const visitors=text('div','','dashboard-card');visitors.append(text('h3','Visitors'));
   if(!state.visitors.length)visitors.append(text('p','No visitors have joined this application.','muted'));
   for(const visitor of state.visitors){const row=text('div','','access-row');row.append(text('strong',`Visitor ${visitor.id.slice(0,8)}`),text('p',visitor.revoked?'Access revoked':`${visitor.passkeys} passkey${visitor.passkeys===1?'':'s'} · ${visitor.sessions} active session${visitor.sessions===1?'':'s'}`),text('small','Joined '+new Date(visitor.created_at).toLocaleString()));if(!visitor.revoked)row.append(button('Revoke access',()=>confirmAction(row,`Permanently revoke access for visitor ${visitor.id.slice(0,8)}? Their passkeys, recovery code and sessions will stop working. Their saved data is retained. This cannot be undone.`,'Revoke this visitor',`${base}/visitors/${visitor.id}/revoke`)));visitors.append(row);}
   visitors.append(text('p','Private visitor data and credentials are not shown here. Revocation does not delete retained data.','muted'));content.append(visitors);
   content.append(button('Refresh access',load));
  }
  select.onchange=load;load();
 }
 return {render};
}
