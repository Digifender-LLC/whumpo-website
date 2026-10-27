import assert from 'node:assert/strict';

// Chromium does not open a physical phone keyboard in these fixtures. Supply
// its visual-viewport geometry independently of the unchanged layout viewport.
export async function inspectChatViewport(page,context){
 const dialog=page.getByRole('dialog'),search=dialog.getByRole('searchbox',{name:'Search saved messages'});
 const focused=async locator=>{for(let i=0;i<30;i++){if(await locator.evaluate(e=>e===document.activeElement))return;await new Promise(done=>setTimeout(done,20));}assert.fail('Unexpected focus: '+await page.evaluate(()=>document.activeElement?.outerHTML.slice(0,500)));};
 const geometry=async(height,offsetTop,event='resize')=>page.evaluate(({height,offsetTop,event})=>{
  for(const [key,value] of Object.entries({height,offsetTop}))Object.defineProperty(visualViewport,key,{configurable:true,value});
  visualViewport.dispatchEvent(new Event(event));
 },{height,offsetTop,event});
 const reset=async()=>page.evaluate(()=>{delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'));});
 try{
  await focused(dialog.getByRole('heading',{name:'Past messages & forms'}));
  await page.keyboard.press('Tab');await focused(dialog.getByRole('tab',{name:'Messages',exact:true}));
  await page.keyboard.press('Shift+Tab');await focused(dialog.getByRole('button',{name:'Close',exact:true}));
  for(let i=0;i<15;i++){await page.keyboard.press('Tab');assert(await dialog.evaluate(e=>e.contains(document.activeElement)));}
  await dialog.getByRole('tab',{name:'Messages',exact:true}).focus();await page.keyboard.press('ArrowRight');await focused(dialog.getByRole('tab',{name:'Saved forms',exact:true}));assert.equal(await dialog.getByRole('tab',{name:'Saved forms',exact:true}).getAttribute('aria-selected'),'true');await page.keyboard.press('ArrowLeft');await focused(dialog.getByRole('tab',{name:'Messages',exact:true}));
  for(const width of [360,390]){
   await page.setViewportSize({width,height:844});await search.fill('Garden');await search.evaluate(e=>e.setSelectionRange(2,4));
   await geometry(400,44);
   let box=await dialog.boundingBox();assert(box.y>=44&&box.y+box.height<=445,JSON.stringify({box,viewport:await page.evaluate(()=>({scale:visualViewport.scale,height:visualViewport.height,top:visualViewport.offsetTop,width:innerWidth,layoutHeight:innerHeight,style:document.documentElement.style.cssText}))}));
   await focused(search);assert.deepEqual(await search.evaluate(e=>[e.selectionStart,e.selectionEnd]),[2,4]);
   await geometry(400,80,'scroll');box=await dialog.boundingBox();assert(box.y>=80&&box.y+box.height<=481,JSON.stringify(box));
   await dialog.getByRole('button',{name:'Search',exact:true}).focus();
   assert((await dialog.locator('[aria-label="Earlier conversation"]').boundingBox()).height>=96,'Keyboard must leave a readable message area');
   box=await dialog.boundingBox();assert(box.y+box.height<=481,'Button focus must not drop the sheet under the still-open keyboard');
   await page.evaluate(()=>{
    const keyboard=document.createElement('div');keyboard.id='fixture-keyboard';keyboard.textContent='Simulated keyboard area';
    keyboard.style.cssText='position:fixed;inset:480px 0 0;background:#d6dce5;color:#0f2d5b;z-index:9999;display:grid;place-items:center;font:16px sans-serif;pointer-events:none';document.body.append(keyboard);
   });
   await page.screenshot({path:`/tmp/whumpo-chat-keyboard-${width}.png`});
   await page.evaluate(()=>document.getElementById('fixture-keyboard').remove());await reset();
   await search.focus();assert.equal(await search.inputValue(),'Garden');
  }
  // Also cover the production resizes-content policy: both viewports shrink.
  await search.focus();await page.setViewportSize({width:390,height:400});
  await page.waitForFunction(()=>document.documentElement.classList.contains('phone-keyboard'));
  let box=await dialog.boundingBox();assert(box.y>=0&&box.y+box.height<=401);
  await dialog.getByRole('button',{name:'Search',exact:true}).focus();assert(await page.evaluate(()=>document.documentElement.classList.contains('phone-keyboard')));
  await page.screenshot({path:'/tmp/whumpo-chat-layout-keyboard-390.png'});
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>!document.documentElement.classList.contains('phone-keyboard'));
  // Real browser magnification must not be mistaken for keyboard occlusion.
  const before=await page.evaluate(()=>document.documentElement.style.cssText),cdp=await context.newCDPSession(page);
  try{await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:2});await page.waitForFunction(()=>visualViewport.scale===2);assert.equal(await page.evaluate(()=>document.documentElement.style.cssText),before);}
  finally{await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});await cdp.detach();}
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await dialog.getByRole('button',{name:'Close',exact:true}).focus();await focused(dialog.getByRole('button',{name:'Close',exact:true}));
  assert.equal(await dialog.evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.screenshot({path:'/tmp/whumpo-chat-large-text-390.png'});
  const messages=dialog.locator('[aria-label="Earlier conversation"]');await messages.focus();await messages.scrollIntoViewIfNeeded();assert((await messages.boundingBox()).height>=192);await page.screenshot({path:'/tmp/whumpo-chat-large-text-messages-390.png'});
 }finally{
  await reset();await page.evaluate(()=>{document.documentElement.style.removeProperty('font-size');document.getElementById('fixture-keyboard')?.remove();});
  await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:390,height:844});
 }
}

// scrollIntoView lands on device pixels while layout uses 1/16px units, so allow 1px of rounding.
const inFrame=v=>v.heading.top>=v.frame.top-1&&v.heading.bottom<=v.frame.bottom+1&&v.selection.top>=v.frame.top-1&&v.selection.bottom<=v.frame.bottom+1;
/** Put a saved picker into a deliberate reading position after phone reflow. */
export async function captureSelectedChatProject(page,{interactionId,projectName,path}){
 const card=page.locator('[data-interaction-id="'+interactionId+'"]');
 const heading=card.getByRole('heading',{name:'Choose the project you mean',exact:true});
 await heading.evaluate(e=>e.scrollIntoView({block:'start',behavior:'instant'}));
 const geometry=()=>page.evaluate(interactionId=>{
  const card=document.querySelector('[data-interaction-id="'+interactionId+'"]'),heading=card?.querySelector('h2'),select=card?.querySelector('select'),scroll=document.querySelector('.chat-scroll');
  if(!heading||!select||!scroll)return null;
  const h=heading.getBoundingClientRect(),s=select.getBoundingClientRect(),frame=scroll.getBoundingClientRect();
  return {heading:{top:h.top,bottom:h.bottom},selection:{top:s.top,bottom:s.bottom,height:s.height},frame:{top:frame.top,bottom:frame.bottom},name:select.selectedOptions[0]?.textContent,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};
 },interactionId);
 let view;
 for(let n=0;n<60;n++){
  view=await geometry();
  if(view&&inFrame(view)&&view.name===projectName)break;
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
 }
 assert(view&&inFrame(view)&&view.name===projectName,JSON.stringify({message:'Saved picker must be readable inside the Chat scroll area',view}));
 assert(view.selection.height>=44);assert.equal(view.overflow,false);
 await page.screenshot({path});return view;
}
