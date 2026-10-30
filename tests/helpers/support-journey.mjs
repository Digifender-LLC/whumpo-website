import assert from 'node:assert/strict';

/** D-9 touch-target rule (WCAG 2.2 SC 2.5.8 inline exception). Buttons, radios and standalone links need 44px.
 * An <a> is "inline" only when its parent also holds non-blank text of its own (a text node outside any
 * element) so the link sits inside a sentence. A link alone in a li/div/nav is standalone and still checked.
 * min is 44 at phone width and 24 at desktop (D-9, 2026-10-27). Runs in the page; the optional root scopes the query (the negative control passes a synthetic fixture). */
function smallTargets(min=44,root=document){
 const inline=e=>e.tagName==='A'&&[...e.parentElement.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
 return [...root.querySelectorAll(root===document?'main button, main a, main input[type=radio]':'button, a, input[type=radio]')].filter(e=>{const h=e.getBoundingClientRect().height;return h>0&&h<min-1&&!e.closest('label')&&!inline(e);}).map(e=>e.textContent?.trim()||e.getAttribute('aria-label'));
}

/** Rendered heading levels in page order; runs in the page. */
const headingLevels=()=>[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h=>+h.tagName[1]);

/** Actual built UI/Worker/current D1, keyboard-driven at a mobile viewport. Chat, dashboard and profile
 * are failing throughout: support needs identity only. No provider, notification or operator tool runs. */
export async function supportJourney({page,db,state,requests,origin,activate,enter,phase}){
 phase('support fixture');
 const user=(await db.prepare('SELECT owner_user_id id FROM projects').first()).id,count=table=>db.prepare('SELECT count(*) n FROM '+table).first().then(r=>r.n);
 const held=crypto.randomUUID(),old=new Date(Date.now()-3*3600000).toISOString();
 await db.prepare("INSERT INTO standard_ai_requests(id,user_id,request_hash,state,created_at,updated_at) VALUES(?,?,?,'reserved',?,?)").bind(held,user,'b'.repeat(64),old,old).run();
 const beforeTurns=await count('chat_turns'),beforeInference=await count('inference_calls');

 phase('direct support entry during Chat, dashboard and profile outages');
 state.failChat=true;state.failDashboard=true;state.failProfile=true;
 const start=requests.length;await page.goto(origin+'/workspace/support?ref='+encodeURIComponent('status:chat_unavailable'));
 await page.getByRole('heading',{name:'Support',level:1}).waitFor();await page.waitForFunction(()=>document.activeElement?.textContent==='Support');
 await page.getByRole('heading',{name:'Chat is unavailable',level:3}).waitFor();await page.waitForLoadState('networkidle');
 assert(requests.slice(start).filter(r=>r.path.startsWith('/api/')).every(r=>r.path.startsWith('/api/auth/identity/v1/')||r.path.startsWith('/api/support/v1')),'Support never reads profile, Chat, billing or the dashboard');
 assert.match(await page.locator('main').innerText(),/Support hours have not been set by the platform owner/);assert.match(await page.locator('main').innerText(),/Email hello@whumpo\.com for help, including sign-in lockouts\. We reply on business days\. Never send your recovery key\./);assert.equal(await page.locator('main a[href="mailto:hello@whumpo.com"]').count(),1);assert.match(await page.locator('main').innerText(),/External notifications are not configured/);
 assert.match(await page.getByText(/^Related to:/).innerText(),/Chat is unavailable/);

 phase('stuck operation prefills a related request; keyboard only');
 const operation=page.getByRole('article',{name:'AI request reserved',exact:true});await operation.waitFor();assert.match(await operation.innerText(),/It needs attention/);
 await activate(operation.getByRole('button',{name:'Ask about this',exact:true}));
 assert.match(await page.getByText(/^Related to:/).innerText(),/AI request \(reserved\)/);
 const statement='Synthetic: my AI request has been reserved for hours.';
 await enter(page.getByLabel('Describe what happened (up to 950 characters)'),statement);
 phase('lost reply is recovered by resubmitting the same draft');
 state.loseSupportCreate=true;
 await activate(page.getByRole('button',{name:'Save request',exact:true}));
 await page.getByRole('alert').filter({hasText:'check “Your requests” before sending again'}).waitFor();
 assert.equal(await count('usage_review_requests'),1,'The request committed even though its reply was lost');
 await activate(page.getByRole('button',{name:'Save request',exact:true}));
 await page.getByRole('status').filter({hasText:'saved for a platform operator'}).waitFor();
 assert.equal(await count('usage_review_requests'),1,'Resubmitting the same draft is replayed, not duplicated');
 const saved=await db.prepare('SELECT * FROM usage_review_requests').first();
 assert.deepEqual({kind:saved.kind,source:saved.source,reference:saved.reference,statement:saved.statement,state:saved.state,user:saved.user_id},{kind:'help',source:'support',reference:'operation:standard_ai:'+held,statement,state:'open',user});
 const card=page.getByRole('article',{name:'Help request '+saved.id,exact:true});await card.waitFor();
 assert.match(await card.innerText(),/Waiting for an operator to read it/);assert.match(await card.innerText(),/No response to read yet/);

 phase('saved response, delivery and read are separate');
 await db.prepare("UPDATE usage_review_requests SET state='answered',public_response='Synthetic visible reply.',answered_by='Synthetic operator',answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(saved.id).run();
 await page.reload();const answered=page.getByRole('article',{name:'Help request '+saved.id,exact:true});await answered.waitFor();
 let text=await answered.innerText();assert.match(text,/Response saved in Whumpo/);assert.match(text,/Saved in Whumpo only \(no external notification is configured\)/);assert.match(text,/You have not opened the response yet/);assert.doesNotMatch(text,/Synthetic visible reply/);
 assert.equal((await db.prepare('SELECT customer_read_at FROM usage_review_requests WHERE id=?').bind(saved.id).first()).customer_read_at,null,'Listing a response is not a read receipt');
 await activate(answered.getByRole('button',{name:'Open request',exact:true}));
 await answered.locator('[data-support-response]').waitFor();assert.equal(await answered.locator('[data-support-response]').innerText(),'Synthetic visible reply.');
 for(let i=0;i<100&&!(await db.prepare('SELECT customer_read_at FROM usage_review_requests WHERE id=?').bind(saved.id).first()).customer_read_at;i++)await new Promise(done=>setTimeout(done,50));
 assert.ok((await db.prepare('SELECT customer_read_at FROM usage_review_requests WHERE id=?').bind(saved.id).first()).customer_read_at,'Displaying the response records the read');
 await answered.getByText(/You read the response/).waitFor();assert.equal(await count('notification_notices'),0,'No external notification exists or was sent');
 assert.ok(!(await page.locator('body').innerText()).includes('Synthetic operator'),'Reviewer identity is never shown');

 phase('mobile, large text and follow-up');
 await activate(page.getByRole('radio',{name:'Review a usage decision or limit'}));
 for(const width of [360,390,1280]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal scroll at '+width);await page.screenshot({path:'/tmp/whumpo-support-'+width+'.png',fullPage:true});
  if(width!==360){const levels=await page.evaluate(headingLevels);assert.equal(levels.filter(l=>l===1).length,1,'Exactly one h1 at '+width+': '+levels);assert.ok(levels.every((l,i)=>l<=(levels[i-1]??0)+1),'No skipped heading level at '+width+': '+levels);}
  if(width===1280)assert.deepEqual(await page.evaluate(smallTargets,24),[],'Standalone controls are at least 24px on desktop (D-9)');}
 await page.setViewportSize({width:390,height:844});
 const small=await page.evaluate(smallTargets,44);
 const control=await page.evaluate(`(${smallTargets})(44,Object.assign(document.body.appendChild(document.createElement('div')),{innerHTML:'<p>Email <a href="#a">inline sample</a> now.</p><a href="#b" style="display:block;height:20px">standalone sample</a><button style="height:20px">tiny button</button>'}))`);
 assert.deepEqual(control,['standalone sample','tiny button'],'Negative control: standalone links and buttons under 44px still fail, inline links do not');
 assert.deepEqual(small,[],'Touch targets are at least 44px');
 await page.addStyleTag({content:'html{font-size:32px!important}'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Large text does not scroll horizontally');
 await page.getByRole('radio',{name:'Review a usage decision or limit'}).waitFor();
 assert.equal(await count('chat_turns'),beforeTurns,'Support created no Chat turn');assert.equal(await count('inference_calls'),beforeInference,'Support used no inference');
 state.failChat=false;state.failDashboard=false;state.failProfile=false;state.loseSupportCreate=false;
 await page.goto(origin+'/workspace');await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor();
}
