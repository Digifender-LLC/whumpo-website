import type {Definition} from './types';
export type ProjectIntakeTemplate='project-brief@1'|'project-select@1';
/** Fixed information requests. No model questions, defaults or effect bindings. */
export function projectIntakeDefinition(template:ProjectIntakeTemplate):Definition{
 const base={version:1 as const,kind:'form' as const,template,presentation:'inline' as const,cards:[],submitBinding:'interaction.answers@1' as const,continuationBinding:null};
 return template==='project-brief@1'?{...base,title:'Tell Whumpo about your next project',summary:'Save a name and a short description to continue planning in Chat. This does not create or publish a project.',fields:[
  {id:'name',type:'text',label:'Project name',help:'A working name is fine.',required:true,binding:'answer.value@1',constraints:{maxLength:100}},
  {id:'purpose',type:'long-text',label:'What would you like to build?',help:'Describe who it is for and what it should help them do. Do not include passwords, recovery codes or payment details.',required:true,binding:'answer.value@1',constraints:{maxLength:1000}}
 ]}:{...base,title:'Choose the project you mean',summary:'Save your selection for this conversation. Other forms keep their original project; this does not change a website or start work.',fields:[
  {id:'project',type:'resource',label:'Project',help:'Choose one of your current projects.',required:true,binding:'answer.value@1',constraints:{collection:'projects',multiple:false,maxItems:1}}
 ]};
}
