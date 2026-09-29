import { createProfile } from './profile.js';
import { createAppAccess } from './app-access.js';
import { publicPlans } from '../src/plans.ts';
const labels={projects:'Projects',usage:'AI assistance',storage:'File storage',activity:'Recent activity',traffic:'Visitor traffic',cms:'Publishing desk',performance:'Processing performance'};
export function createDashboard({api,text,sendMessage,showMessage,controls}){
 const $=s=>document.querySelector(s);let data,active='chat',editing='dashboard',loadSequence=0,activePanel=null;
 const content=$('#workspace-content');
 function button(label,run){const b=text('button',label);b.type='button';b.onclick=()=>Promise.resolve().then(run).catch(e=>showMessage(e.message));return b;}
 function choose(view){active=view;render();$('#workspace-stage').scrollTop=0;}
 const profile=createProfile({api,text,showMessage,openSecurity:controls.security});
 const access=createAppAccess({api,text,sendMessage});let accessProject='';
 function openAccess(project=''){accessProject=project;choose('visitors');}
 function askForPage(){choose('chat');const input=$('#chat-input');if(!input.value.trim())input.value='Help me build a custom page for my workflow.';input.focus();}
 function card(title){const a=text('article','','dashboard-card');a.append(text('h2',title));return a;}
 function command(label,message){return button(label,()=>sendMessage(message));}
 function metric(a,value,caption){a.append(text('strong',value,'metric-value'),text('p',caption,'muted'));}
 function actionControl(id,label){return button(label,controls[id.replace('-open','')]);}
 function renderCard(kind,projectId){
  const a=card(labels[kind]),projects=data.projects.filter(p=>!projectId||p.id===projectId);
  if(kind==='projects'){
   if(!projects.length)a.append(text('p','Your next idea starts here. Tell TownHello what you’d like to make.'));
   for(const p of projects){const row=text('div','','dashboard-project');row.append(text('strong',p.name),text('small',p.status),command('Work on this',`/project ${p.id}`),button('Visitor access',()=>openAccess(p.id)));a.append(row);}
   a.append(command('Start an idea','/new'));
  }
  if(kind==='usage'){
   const q=data.billing.quota;metric(a,String(q.available),'AI test units available · account-wide');
   const meter=document.createElement('meter');meter.min=0;meter.max=Math.max(q.allowance,1);meter.value=q.spent+q.reserved;meter.setAttribute('aria-label','AI test allowance used or reserved');a.append(meter,text('p',`${q.spent} used · ${q.reserved} held · ${q.allowance} this month`),actionControl('billing-open','Usage details'));
  }
  if(kind==='storage'){
   const rows=data.storage.filter(p=>!projectId||p.project_id===projectId),bytes=rows.reduce((n,p)=>n+p.bytes,0);metric(a,`${(bytes/1048576).toFixed(1)} MB`,'Saved project photos only. CMS media and database storage are not included in this measurement.');a.append(actionControl('files-open','Manage photos'));
  }
  if(kind==='activity'){
   const rows=data.activity.filter(p=>!projectId||p.project_id===projectId).slice(0,6);
   if(!rows.length)a.append(text('p','No recent activity for this view.'));
   for(const e of rows){const row=text('div','','dashboard-event');row.append(text('p',e.summary),text('small',new Date(e.created_at).toLocaleString()));a.append(row);}
  }
  if(kind==='cms'){
   if(!projects.length)a.append(text('p','Choose or create a project to begin publishing.'));
   for(const p of projects){const row=text('div','','dashboard-project');row.append(text('strong',p.name),text('p',`${p.cms_articles} published article${p.cms_articles===1?'':'s'}`),command('Content & drafts',`/cms-drafts ${p.id}`),command('CMS status',`/cms ${p.id}`),command('Write with TownHello',`I want to write a new CMS article for project ${p.id}. Help me plan it.`));a.append(row);}
   a.append(text('p','Open Chat to draft, edit, and review publications.'));
  }
  if(kind==='traffic'||kind==='performance')metric(a,'Not connected',kind==='traffic'?'Visitor analytics have not been collected. No traffic estimate is shown.':'No processing telemetry is connected. A dashboard tab does not provision a video server or other compute.');
  return a;
 }
 function closePanels(){activePanel=null;document.querySelectorAll('.embedded-dialog[open]').forEach(d=>d.close());}
 function render(){
  if(!data)return;closePanels();$('#workspace-back').hidden=true;content.hidden=false;content.replaceChildren();
  const tab=data.layout.tabs.find(t=>t.id===active);if(!['dashboard','chat','settings','profile','visitors'].includes(active)&&!tab)active='chat';
  document.querySelectorAll('[data-view]').forEach(b=>{if(b.dataset.view===active||active==='visitors'&&b.dataset.view==='dashboard')b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  $('#workspace-stage').hidden=active==='chat';$('.chat-view').hidden=active!=='chat';
  content.className=['settings','profile','visitors'].includes(active)?'settings-content':'';
  $('#view-title').textContent=tab?.label||({settings:'Settings',profile:'Your profile',dashboard:'Dashboard',visitors:'Visitor access'}[active]??'');
  $('#workspace-stage').setAttribute('aria-label',$('#view-title').textContent||'Workspace');
  $('#view-eyebrow').textContent=tab?'YOUR CUSTOM PAGE':active==='dashboard'?'YOUR WORKSPACE':active==='visitors'?'PROJECT ACCESS':'MAKE YOURSELF AT HOME';
  $('#view-description').textContent=tab?'The details that matter to your work.':({settings:'Make TownHello work the way you do.',profile:'A little about you. A better way to work together.',dashboard:'A clear view of what you’re building.',visitors:'Invite people and manage their access.'}[active]??'');
  $('#customize-dashboard').hidden=['settings','profile','chat','visitors'].includes(active);
  document.title=(active==='chat'?'Chat':$('#view-title').textContent)+' — TownHello';
  $('#workspace-stage').classList.toggle('settings-stage',['settings','profile','visitors'].includes(active));
  if(active==='chat')return;
  if(active==='profile'){profile.render(content);return;}
  if(active==='settings'){renderSettings();return;}
  if(active==='visitors'){access.render(content,data.projects,()=>choose('dashboard'),accessProject);return;}
  const grid=text('div','','dashboard-grid');for(const kind of tab?.widgets??data.layout.widgets)grid.append(renderCard(kind,tab?.projectId));content.append(grid);
  if(!tab){
   const tools=card('Project controls'),primary=text('div','','control-grid');
   for(const [id,label]of [['files-open','Photos'],['inbox-open','Contact inbox'],['domains-open','Domains']])primary.append(actionControl(id,label));
   primary.append(button('Visitor access',()=>openAccess()));
   tools.append(primary);const detail=document.createElement('details');detail.append(text('summary','Publishing & maintenance'));const group=text('div','','control-grid');
   for(const [label,message]of [['Website health','/health'],['Directories','/directory'],['Saved versions','/versions'],['Export website','/export'],['Publish a version','/publish'],['Unpublish a site','/unpublish']])group.append(command(label,message));detail.append(group);tools.append(detail);content.append(tools);
  }
  const footer=text('div','','dashboard-footer');footer.append(text('small','Updated '+new Date(data.measuredAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})),button('Refresh',refresh));content.append(footer);
 }
 function renderSettings(){
  profile.appearance(content);
  const services=card('Account services');services.classList.add('settings-section');const links=text('div','','settings-links');for(const [id,label] of [['billing-open','Billing & usage'],['connections-open','External connections']])links.append(actionControl(id,label));links.append(command('Plans & pricing','/plans'));services.append(links);content.append(services);
  const prefs=data.capacity.preferences,a=card('Plan & spending preferences');a.classList.add('settings-section');a.append(text('p','Draft preferences only. Your current plan is '+data.billing.plan.name+'. Saving here cannot upgrade, purchase capacity, or authorize charges.'));
  const form=document.createElement('form');
  function field(label,element){const l=text('label',label);l.append(element);form.append(l);return element;}
  function select(options,value){const s=document.createElement('select');for(const [v,label]of options){const o=text('option',label);o.value=v;s.append(o);}s.value=value;return s;}
  const plan=field('Preferred launch plan',select(publicPlans.filter(p=>p.monthlyCents).map(p=>[p.id,`${p.name} · $${p.monthlyCents/100}/month`]),prefs.preferred_plan));
  const interval=field('Billing preference',select([['month','Monthly'],['year','Annual · two months saved + eligible domain benefit']],prefs.billing_interval));
  const preset=field('Temporary overage preference',select([['0','No overages'],['10','$10'],['25','$25'],['50','$50'],['100','$100'],['custom','Custom']],['0','10','25','50','100'].includes(String(prefs.draft_overage_cents/100))?String(prefs.draft_overage_cents/100):'custom'));
  const amount=document.createElement('input');amount.type='number';amount.min='0';amount.max='1000';amount.step='0.01';amount.value=String(prefs.draft_overage_cents/100);field('Custom monthly overage limit (USD)',amount);amount.parentElement.hidden=preset.value!=='custom';preset.onchange=()=>{amount.parentElement.hidden=preset.value!=='custom';};
  const estimate=text('p','','muted');estimate.setAttribute('aria-live','polite');
  function showEstimate(){const p=publicPlans.find(p=>p.id===plan.value),dollars=preset.value==='custom'?Number(amount.value):Number(preset.value);if(!p||!Number.isFinite(dollars)||dollars<0){estimate.textContent='Choose a valid draft limit.';return;}estimate.textContent=interval.value==='year'?`Draft: $${p.annualCents/100}/year prepaid + up to $${dollars.toFixed(2)} in monthly overages. Dedicated add-ons and any taxes would be separate.`:`Draft monthly maximum: $${(p.monthlyCents/100+dollars).toFixed(2)}, before separately approved add-ons and any taxes. No charges are enabled.`;}
  plan.addEventListener('change',showEstimate);interval.addEventListener('change',showEstimate);preset.addEventListener('change',showEstimate);amount.addEventListener('input',showEstimate);showEstimate();form.append(estimate);
  const status=text('p','','muted');status.setAttribute('role','status');
  const submit=text('button','Save draft preferences','primary');submit.type='submit';form.append(submit,status);form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{const dollars=preset.value==='custom'?Number(amount.value):Number(preset.value);if(!Number.isFinite(dollars)||dollars<0||dollars>1000)throw Error('Choose a limit from $0 to $1,000');data.capacity=await api('/workspace/capacity',{method:'PUT',body:JSON.stringify({revision:prefs.revision,preferred_plan:plan.value,billing_interval:interval.value,draft_overage_cents:Math.round(dollars*100)})});render();showMessage('Draft preferences saved. Spending remains disabled.');}catch(error){status.textContent=error.message;}finally{submit.disabled=false;}};
  a.append(form,text('p','Plan changes always require approval. Temporary spikes can use an explicitly authorized allowance after billing launches. Dedicated services need a separate cost review.'),text('p','Upgrades keep the renewal date and credit unused subscription value. Downgrades start at renewal after your approval; recommendations need two complete lower-use periods with headroom.'));content.append(a);
 }
 function navigation(){
  const nav=$('#workflow-navigation');nav.replaceChildren();if(!data.layout.tabs.length){const cta=text('div','','workflow-empty');cta.append(text('p','A page made for your work.'),text('span','Ask TownHello to build a custom page around your workflow.'),button('Ask TownHello',askForPage));nav.append(cta);}for(const tab of data.layout.tabs){const b=button('',()=>choose(tab.id));const icon=text('span','▦','workflow-icon');icon.setAttribute('aria-hidden','true');b.append(icon,text('span',tab.label));b.dataset.view=tab.id;nav.append(b);}
 }
 async function refresh(){const sequence=++loadSequence;const next=await api('/workspace/dashboard');if(sequence!==loadSequence)return;if($('#layout-dialog').open||['settings','profile','visitors'].includes(active)||document.querySelector('.embedded-dialog[open]'))return;data=next;navigation();render();}
 function edit(id){
  if(!data)return;editing=id;const tab=data.layout.tabs.find(t=>t.id===id);$('#layout-label').value=tab?.label??'';$('#layout-label').parentElement.hidden=id==='dashboard';$('#layout-project').parentElement.hidden=id==='dashboard';$('#layout-label').required=id!=='dashboard';
  const select=$('#layout-project');select.replaceChildren();const all=text('option','All projects');all.value='';select.append(all);for(const p of data.projects){const o=text('option',p.name);o.value=p.id;select.append(o);}select.value=tab?.projectId??'';
  const fields=$('#layout-widgets');fields.replaceChildren(text('legend','Cards'));for(const [kind,label]of Object.entries(labels)){const l=text('label',label,'check-label'),i=document.createElement('input');i.type='checkbox';i.value=kind;i.checked=(id==='dashboard'?data.layout.widgets:tab?.widgets??['projects','activity']).includes(kind);l.prepend(i);fields.append(l);}
  $('#layout-remove').hidden=!tab;$('#layout-error').textContent='';$('#layout-dialog').showModal();
 }
 async function persist(layout){const saved=await api('/workspace/layout',{method:'PUT',body:JSON.stringify({revision:data.revision,layout})});data={...data,...saved};navigation();render();$('#layout-dialog').close();}
 $('#layout-form').onsubmit=async e=>{e.preventDefault();const submit=e.currentTarget.querySelector('[type=submit]');submit.disabled=true;try{const widgets=[...$('#layout-widgets').querySelectorAll('input:checked')].map(i=>i.value),layout=structuredClone(data.layout);if(editing==='dashboard')layout.widgets=widgets;else{const tab={id:editing,label:$('#layout-label').value.trim(),projectId:$('#layout-project').value||null,widgets};const index=layout.tabs.findIndex(t=>t.id===editing);if(index<0)throw Error('Choose an existing page to customize. Ask TownHello to create a new one.');layout.tabs[index]=tab;active=tab.id;}await persist(layout);}catch(e){$('#layout-error').textContent=e.message;}finally{submit.disabled=false;}};
 $('#layout-remove').onclick=()=>persist({...data.layout,tabs:data.layout.tabs.filter(t=>t.id!==editing)}).catch(e=>{$('#layout-error').textContent=e.message;});
 $('#layout-close').onclick=()=>$('#layout-dialog').close();$('#customize-dashboard').onclick=()=>edit(active);
 $('#settings-open').onclick=()=>choose('settings');document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>choose(b.dataset.view));
 // Account and project panels retain their established controls in the full page.
 for(const [name,parent] of [['connections','settings'],['domains','dashboard'],['files','dashboard'],['billing','settings'],['inbox','dashboard']]){
  const d=$('#'+name+'-dialog');d.classList.add('embedded-dialog');$('#workspace-stage').append(d);
  d.showModal=()=>{active=parent;render();activePanel=d;content.hidden=true;$('#view-title').textContent=d.querySelector('h2').textContent;document.title=$('#view-title').textContent+' — TownHello';$('#workspace-stage').setAttribute('aria-label',$('#view-title').textContent);$('#view-description').textContent='';$('#customize-dashboard').hidden=true;const back=$('#workspace-back');back.textContent='← '+(parent==='settings'?'Settings':'Dashboard');back.hidden=false;back.onclick=()=>choose(parent);$('#workspace-stage').scrollTop=0;d.show();};
  d.addEventListener('close',()=>{if(activePanel===d){activePanel=null;render();}});
 }
 return {openAccess,showChat(){choose('chat');},async start(){await profile.load();$('#primary-navigation').hidden=false;$('#sidebar-account').hidden=false;await refresh();},refresh};
}
