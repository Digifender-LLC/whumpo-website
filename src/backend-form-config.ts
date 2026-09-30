// Shared pure field contract. No runtime, storage, provider or identity dependencies.
import {BackendError} from './backend-error';
import type {BackendForm,BackendField} from './backend-form-shape';
export function backendFormConfig(value:unknown):BackendForm{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new BackendError(400,'Provide a form configuration');
 const c=value as Record<string,unknown>;
 if(Object.keys(c).some(k=>!['title','description','buttonLabel','fields'].includes(k))||typeof c.title!=='string'||!c.title.trim()||c.title.length>100||typeof c.description!=='string'||c.description.length>400||typeof c.buttonLabel!=='string'||!c.buttonLabel.trim()||c.buttonLabel.length>40||!Array.isArray(c.fields)||c.fields.length<1||c.fields.length>8)throw new BackendError(400,'Use a title, description, buttonLabel and one to eight fields');
 const keys=new Set<string>();
 const fields:BackendField[]=c.fields.map((f:unknown):BackendField=>{
  if(!f||typeof f!=='object'||Array.isArray(f))throw new BackendError(400,'Invalid form field');
  const d=f as Record<string,unknown>;
  if(Object.keys(d).some(k=>!['key','label','type','options','optional'].includes(k))||typeof d.key!=='string'||!/^[a-z][a-zA-Z0-9_]{0,31}$/.test(d.key)||['constructor','prototype','__proto__','toJSON'].includes(d.key)||keys.has(d.key)||typeof d.label!=='string'||!d.label.trim()||d.label.length>80||(d.type!=='number'&&d.type!=='text'&&d.type!=='boolean'&&d.type!=='choice'))throw new BackendError(400,'Each field needs a unique safe key, label and number, text, boolean or choice type');
  if(Object.hasOwn(d,'optional')&&(d.type!=='text'||d.optional!==true))throw new BackendError(400,'Only text fields can be marked optional');
  if(Object.hasOwn(d,'options')&&d.type!=='choice')throw new BackendError(400,'Only choice fields accept options');
  keys.add(d.key);const base={key:d.key,label:d.label.trim()};
  if(d.type==='choice'){
   if(!Array.isArray(d.options)||d.options.length<2||d.options.length>12)throw new BackendError(400,'Choose two to twelve fixed options');
   const seen=new Set<string>();
   const options=d.options.map((value:unknown)=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new BackendError(400,'Invalid choice option');const option=value as Record<string,unknown>;if(Object.keys(option).length!==2||typeof option.value!=='string'||!/^[a-zA-Z0-9_-]{1,40}$/.test(option.value)||seen.has(option.value)||typeof option.label!=='string'||!option.label.trim()||option.label.length>80)throw new BackendError(400,'Use unique bounded option values and labels');seen.add(option.value);return {value:option.value,label:option.label.trim()};});
   return {...base,type:'choice',options};
  }
  if(d.type==='text')return {...base,type:'text',...(d.optional===true?{optional:true as const}:{})};
  return {...base,type:d.type as 'number'|'boolean'};
 });
 const result={title:c.title.trim(),description:c.description.trim(),buttonLabel:c.buttonLabel.trim(),fields};if(new TextEncoder().encode(JSON.stringify(result)).length>4096)throw new BackendError(400,'Form configuration too large');return result;
}
