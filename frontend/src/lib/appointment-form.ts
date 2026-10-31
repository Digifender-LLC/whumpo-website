import type {ChatControl} from '../../../src/chat-controls';
import type {RecordsSetup} from '../../../src/shared-modules/shape';

/** WH-070 owner setup for the standard appointment request form. Pure: maps the server's `RecordsSetup` facts to the four
 * steps shown in the records panel, the one typed Chat control that comes next (ids only; the server chooses the fixed
 * instance) and, once the form is bound to the live website, its public link. Every step still goes through its own exact
 * review in Chat: this only chooses which button to offer. */
export type StepState='done'|'next'|'waiting';
export type AppointmentStep={label:string;state:StepState};
export type AppointmentSetupView={steps:AppointmentStep[];note:string;action:{label:string;control:ChatControl}|null;link:string|null};

export const appointmentLink=(project:string)=>`https://app-${project}.whumpo.site/forms/appointment`;

export function appointmentSetupView(project:string,setup:RecordsSetup|undefined):AppointmentSetupView|null{
 if(!setup)return null;
 const activate={label:'Review activating the form',control:{type:'moduleActivationReview',projectId:project,instanceId:setup.instanceId??'',action:'activate'} as ChatControl};
 const mk=(add:StepState,save:StepState,on:StepState,share:StepState):AppointmentStep[]=>[{label:'Add the form',state:add},{label:'Save it to your website',state:save},{label:'Turn it on',state:on},{label:'Publish and share the link',state:share}];
 switch(setup.state){
  case 'website-required':return {steps:mk('waiting','waiting','waiting','waiting'),note:'The form is saved in your website configuration. Ask Whumpo in Chat to draft your private website first, then come back here.',action:null,link:null};
  case 'unavailable':return {steps:mk('waiting','waiting','waiting','waiting'),note:'The saved website configuration could not be read. Try again in a moment.',action:null,link:null};
  case 'not-configured':return {steps:mk('next','waiting','waiting','waiting'),note:'Add a standard request form: name, how to reach them, what they need, a preferred day and an optional note. Chat shows the exact change first. Nothing is saved or published until you confirm it.',action:{label:'Add an appointment form',control:{type:'appointmentFormReview',projectId:project}},link:null};
  case 'saved':return {steps:mk('done','done','next','waiting'),note:'The form is saved in your private website but is not on yet. Turning it on is its own review in Chat.',action:activate,link:null};
 }
 switch(setup.publicForm){
  case 'bound':return {steps:mk('done','done','done','done'),note:'The form is on and matches your live website. Requests appear in this list. The form sends no email by itself.',action:null,link:appointmentLink(project)};
  case 'unpublished':return {steps:mk('done','done','done','next'),note:'The form is on, but your website is not published, so the form stays closed. Publish your website, then review activating the form again.',action:activate,link:null};
  case 'stale':return {steps:mk('done','done','next','waiting'),note:'Your website changed after the form was turned on, so the form is closed. Review activating it again to match the live website.',action:activate,link:null};
  case 'unavailable':return {steps:mk('done','done','waiting','waiting'),note:'The form is closed: this module version is no longer current, something it depends on is off, the website content is held for safety review, or Whumpo has paused public forms for this website.',action:null,link:null};
  default:return {steps:mk('done','done','next','waiting'),note:'The form is saved but turned off. Review activating it in Chat.',action:activate,link:null};
 }
}
