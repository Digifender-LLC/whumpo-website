/** Navigate with actual keyboard events; never programmatically focus the target. */
export function keyboardJourney(page,enabled=true){
 async function reach(control){
  await control.waitFor();const element=await control.elementHandle();await page.waitForFunction(e=>!e.disabled,element);await element.dispose();
  for(let i=0;i<120;i++){if(await control.evaluate(e=>e===document.activeElement&&document.hasFocus()))return;
   const radio=await control.evaluate(e=>e.matches('input[type=radio]')&&document.activeElement?.matches('input[type=radio]')&&e.name===document.activeElement.name&&e.closest('fieldset')===document.activeElement.closest('fieldset'));
   if(radio){await page.keyboard.press('ArrowDown');continue;}
   const backwards=await control.evaluate(e=>document.activeElement!==document.body&&!!(document.activeElement.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_PRECEDING));await page.keyboard.press(backwards?'Shift+Tab':'Tab');}
  throw Error('Keyboard could not reach '+await control.evaluate(e=>e.getAttribute('aria-label')||e.labels?.[0]?.textContent||e.textContent||e.tagName));
 }
 async function activate(control){if(!enabled)return control.click();await reach(control);await page.keyboard.press(await control.evaluate(e=>e.matches('input[type=checkbox],input[type=radio]'))?'Space':'Enter');}
 async function enter(control,value){if(!enabled)return control.fill(value);await reach(control);await page.keyboard.press('Control+A');await page.keyboard.insertText(value);}
 return {reach,activate,enter};
}
