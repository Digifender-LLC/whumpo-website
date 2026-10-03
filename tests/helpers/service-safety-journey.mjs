import assert from 'node:assert/strict';
import {hearOrca} from './orca-output.mjs';

/** Continues the signed current-Worker journey during simultaneous profile,
 * Chat and Dashboard outages. The fixture uses synthetic tested programs. */
export async function serviceSafetyJourney({page,db,state,requests,origin,activate,phase,project}){
 const read=()=>db.prepare('SELECT b.version_id AS backend,s.revision AS page,l.id AS app FROM backend_publications b JOIN app_page_settings s ON s.project_id=b.project_id LEFT JOIN app_live_pages l ON l.project_id=b.project_id WHERE b.project_id=?').bind(project).first();
 const beforeTurns=(await db.prepare('SELECT count(*) n FROM chat_turns').first()).n;
 const before=await read();assert(before.backend&&before.app);let last;
 for(const [kind,label] of [['backend','backend tool'],['application','visitor app']]){
  phase(label+' direct outage withdrawal');
  await page.goto(origin+'/workspace/safety');await page.getByRole('article',{name:'Garden care',exact:true}).waitFor();
  const count=(suffix)=>requests.filter(r=>r.method==='POST'&&r.path===suffix).length;
  const prepares=count('/api/workspace/service-safety/reviews');state.loseSafetyPrepare=true;
  await hearOrca(label+' saved review after lost preparation',()=>activate(page.getByRole('button',{name:'Review taking '+label+' offline',exact:true})),[new RegExp(label+' withdrawals','i'),/heading/i],false);
  await page.getByRole('heading',{name:'Awaiting confirmation: Garden care',exact:true}).waitFor();
  const id=new URL(page.url()).searchParams.get('review'),path='/api/workspace/service-safety/reviews/'+kind+'/'+id,link=page.url();assert(id);
  assert.equal(count('/api/workspace/service-safety/reviews'),prepares+1);
  await page.reload();await page.getByRole('heading',{name:'Awaiting confirmation: Garden care',exact:true}).waitFor();assert.equal(count('/api/workspace/service-safety/reviews'),prepares+1);
  await page.route('**'+path,route=>route.fulfill({status:503,json:{error:'Synthetic service review outage'}}));
  await activate(page.getByRole('button',{name:'Check saved result',exact:true}));await page.getByRole('alert').filter({hasText:'Synthetic service review outage'}).waitFor();assert.equal(await page.getByRole('button',{name:'Confirm taking '+label+' offline',exact:true}).count(),0);
  await page.unroute('**'+path);await activate(page.getByRole('button',{name:'Check saved result',exact:true}));await page.getByRole('heading',{name:'Awaiting confirmation: Garden care',exact:true}).waitFor();
  if(kind==='application'){
   for(const width of [360,390,1280]){await page.setViewportSize({width,height:844});await page.getByRole('button',{name:'Confirm taking '+label+' offline',exact:true}).scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/whumpo-service-safety-'+width+'.png',fullPage:true});}
   await page.setViewportSize({width:390,height:844});await page.addStyleTag({content:'html{font-size:32px!important}'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/whumpo-service-safety-large-text.png',fullPage:true});await page.reload();await page.getByRole('heading',{name:'Awaiting confirmation: Garden care',exact:true}).waitFor();
  }
  // A malformed explicit kind cannot fall back to a website review or approval.
  await page.goto(link.replace('service='+kind,'service=invalid'));await page.getByRole('alert').filter({hasText:'This saved service link is not valid.'}).waitFor();assert.equal(await page.getByRole('button',{name:/^Confirm taking/}).count(),0);
  await page.goto(link);await page.getByRole('heading',{name:'Awaiting confirmation: Garden care',exact:true}).waitFor();
  state.loseSafetyConfirm=true;
  await hearOrca(label+' result after lost confirmation',()=>activate(page.getByRole('button',{name:'Confirm taking '+label+' offline',exact:true})),[/Withdrawal applied/i,/Garden care/i],false);
  await page.getByText('This service is currently offline.',{exact:true}).waitFor();assert.equal(count(path+'/confirm'),1);assert(!await page.getByText(/Unexpected end of JSON input/).count());
  const current=await read();assert.equal(current.backend,null);assert.equal(current.app,kind==='backend'?before.app:null);assert.equal(current.page,kind==='backend'?before.page:before.page+1);
  await page.reload();await page.getByText('This service is currently offline.',{exact:true}).waitFor();assert.equal(count(path+'/confirm'),1);
  await activate(page.getByRole('button',{name:'Close review',exact:true}));
  await activate(page.getByRole('region',{name:new RegExp(label+' withdrawals','i')}).getByRole('button',{name:/Garden care.*Withdrawal applied/}));await page.getByText('This service is currently offline.',{exact:true}).waitFor();assert.equal(count(path+'/confirm'),1);
  last={path,link};
 }
 assert.equal((await db.prepare('SELECT count(*) n FROM inference_calls').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM chat_turns').first()).n,beforeTurns);
 return last;
}
