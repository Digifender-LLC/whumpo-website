import type {Definition} from './types';
export const projectIntakeTemplates=['project-brief@1','project-select@1','choice@1'] as const;
export type ProjectIntakeTemplate=typeof projectIntakeTemplates[number];
export const isProjectIntakeTemplate=(value:unknown):value is ProjectIntakeTemplate=>projectIntakeTemplates.some(template=>template===value);
/** Fixed information requests; project intake and selection explicitly continue their saved tasks. */
export function projectIntakeDefinition(template:ProjectIntakeTemplate):Definition{
 const base={version:1 as const,kind:'form' as const,template,presentation:'inline' as const,cards:[],submitBinding:'interaction.answers@1' as const,continuationBinding:null};
 if(template==='choice@1')return {...base,title:'Choose a writing style',summary:'Choose how your website should sound. You can refine it in Chat.',fields:[
  {id:'tone',type:'choice',label:'Writing style',help:'Choose the closest fit for this conversation.',required:true,binding:'answer.value@1',constraints:{options:[
   {id:'friendly',label:'Friendly and welcoming'},
   {id:'professional',label:'Professional and confident'},
   {id:'straightforward',label:'Simple and straightforward'}
  ]}}
 ]};
 return template==='project-brief@1'?{...base,continuationBinding:'agent.task-continue@1',title:'Tell Whumpo about your next project',summary:'Save your brief and continue planning with Whumpo. For a supported website, the follow-up can create your project and first private draft. Publishing needs your approval.',fields:[
  {id:'name',type:'text',label:'Project name',help:'A working name is fine.',required:true,binding:'answer.value@1',constraints:{maxLength:100}},
  {id:'purpose',type:'long-text',label:'What would you like to build?',help:'Describe who it is for and what it should help them do. Do not include passwords, recovery codes or payment details.',required:true,binding:'answer.value@1',constraints:{maxLength:1000}}
 ]}:{...base,continuationBinding:'agent.task-continue@1',title:'Choose the project you mean',summary:'Save your selection and continue this website task with Whumpo. Changes stay private until you review them; other forms keep their original project.',fields:[
  {id:'project',type:'resource',label:'Project',help:'Choose one of your current projects.',required:true,binding:'answer.value@1',constraints:{collection:'projects',multiple:false,maxItems:1}}
 ]};
}

/** A maintained upload handoff. It has no answers, photo references or continuation. */
export function photoIntakeDefinition():Definition{return {version:1,kind:'view',template:'status@1',title:'Add a project photo',summary:'Choose a photo for this project. Uploads stay private and held until safety checks clear them. Website changes require their own review.',presentation:'inline',fields:[],cards:[{id:'photo-upload',binding:'project.photos@1',display:'photos',limit:1,reviewId:null}],submitBinding:null,continuationBinding:null};}
export function isPhotoIntakeDefinition(d:Definition){
 const expected=photoIntakeDefinition();return d.version===1&&d.kind==='view'&&d.template==='status@1'&&d.title===expected.title&&d.summary===expected.summary&&d.presentation==='inline'&&d.fields.length===0&&d.cards.length===1&&d.cards[0].id==='photo-upload'&&d.cards[0].binding==='project.photos@1'&&d.cards[0].display==='photos'&&d.cards[0].limit===1&&d.cards[0].reviewId===null&&d.submitBinding===null&&d.continuationBinding===null;
}

/** Fixed consent handoff; generated text cannot choose scopes, URLs or credentials. */
export function connectionIntakeDefinition(provider:'github'|'cloudflare'):Definition{
 const label=provider==='github'?'GitHub':'Cloudflare';
 return {version:1,kind:'view',template:'status@1',title:'Connect '+label,summary:'Review your saved connection status, then choose whether to authorize access with '+label+'. Connecting applies to your Whumpo account. Website changes and provider operations need their own approval.',presentation:'inline',fields:[],cards:[{id:'connection-consent',binding:'connection.'+provider+'@1',display:'consent',limit:1,reviewId:null}],submitBinding:null,continuationBinding:null};
}
export function connectionIntakeProvider(d:Definition):'github'|'cloudflare'|null{
 for(const provider of ['github','cloudflare'] as const){
  const e=connectionIntakeDefinition(provider);
  if(d.version===1&&d.kind==='view'&&d.template==='status@1'&&d.title===e.title&&d.summary===e.summary&&d.presentation==='inline'&&d.fields.length===0&&d.cards.length===1&&d.cards[0].id==='connection-consent'&&d.cards[0].binding===e.cards[0].binding&&d.cards[0].display==='consent'&&d.cards[0].limit===1&&d.cards[0].reviewId===null&&d.submitBinding===null&&d.continuationBinding===null&&!d.workspaceView&&!d.purpose)return provider;
 }
 return null;
}

/** WH-143 lookup-consent handoff. The card's reviewId is the consent ID; generated text cannot choose the lookup, credential or destination. */
export function lookupConsentDefinition(consentId:string):Definition{
 return {version:1,kind:'view',template:'status@1',title:'Confirm a lookup',summary:'Whumpo asks to run one exact lookup in your connected account. Confirming allows it once, for 15 minutes. It does not connect anything or change your account.',presentation:'inline',fields:[],cards:[{id:'lookup-consent',binding:'connector.lookup-consent@1',display:'consent',limit:1,reviewId:consentId}],submitBinding:null,continuationBinding:null};
}
export function lookupConsentCard(d:Definition):{cardId:string;consentId:string}|null{
 const id=d.cards[0]?.reviewId;
 return typeof id==='string'&&JSON.stringify(sortKeys(d))===JSON.stringify(sortKeys(lookupConsentDefinition(id)))?{cardId:'lookup-consent',consentId:id}:null;
}

/** WH-035 Chat help intake. Whumpo may suggest the statement; only the owner's explicit
 * submission saves it as a support request. No continuation, project or credential field. */
export const supportStatementLimit=950;
export function supportRequestDefinition(statement?:string):Definition{
 return {version:1,kind:'form',template:'support-request@1',title:'Ask Whumpo support',summary:'Review the help request Whumpo prepared and edit it as needed. Nothing is sent until you choose Send to support. A platform operator reads it. We reply on business days. Responses appear in Chat and on the Support page.',presentation:'inline',fields:[
  {id:'statement',type:'long-text',label:'What do you need help with?',help:'Up to 950 characters. Never include passwords, keys, payment details or your recovery kit.',required:true,binding:'answer.value@1',constraints:{maxLength:supportStatementLimit},...(statement===undefined?{}:{default:{value:statement,provenance:'suggested' as const}})}
 ],cards:[],submitBinding:'support.request@1',continuationBinding:null};
}
export function isSupportRequestDefinition(d:Definition){
 if(d.template!=='support-request@1'||d.fields.length!==1)return false;
 const preset=d.fields[0].default;
 const expected=supportRequestDefinition(preset?.provenance==='suggested'&&typeof preset.value==='string'?preset.value:undefined);
 return JSON.stringify(sortKeys(d))===JSON.stringify(sortKeys(expected));
}
/** Fixed read-only view of the owner's own support requests and saved responses. */
export function supportStatusDefinition():Definition{return {version:1,kind:'view',template:'status@1',title:'Your support requests',summary:'Your help requests and usage reviews with any saved operator response. Opening a response records that you read it. The Support page shows the same requests when Chat is unavailable.',presentation:'inline',fields:[],cards:[{id:'support-requests',binding:'support.requests@1',display:'support',limit:10,reviewId:null}],submitBinding:null,continuationBinding:null};}
export function isSupportStatusDefinition(d:Definition){return JSON.stringify(sortKeys(d))===JSON.stringify(sortKeys(supportStatusDefinition()));}
function sortKeys(value:unknown):unknown{
 if(Array.isArray(value))return value.map(sortKeys);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sortKeys((value as Record<string,unknown>)[k])]));
 return value;
}
