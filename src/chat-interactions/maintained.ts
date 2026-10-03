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
