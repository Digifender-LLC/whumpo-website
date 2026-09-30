import {QueryClient} from '@tanstack/react-query';
export class APIError extends Error{constructor(message:string,public status:number){super(message)}}
export const queryClient=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:15000,refetchOnWindowFocus:false},mutations:{retry:false}}});
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{const response=await fetch('/api'+path,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...options.headers}});const data=await response.json();if(!response.ok)throw new APIError(data.error??'This request could not finish.',response.status);return data;}
export const send=<T>(path:string,body:unknown={},method='POST')=>api<T>(path,{method,body:JSON.stringify(body)});
export type Profile={revision:number;avatar_id:string;onboardingComplete:boolean;name:string;about_me:string;email:string;share_context:number;theme:string;hasPhoto:number;passwordEnabled:boolean};
export type Project={id:string;name:string;status:string;purpose:string;cms_articles:number};
export type Layout={widgets:string[];tabs:{id:string;label:string;projectId:string|null;widgets:string[]}[]};
export type Traffic={enabledAt:string|null;days:number;rows:{project_id:string;day:string;requests:number}[];metric:string};
export type Dashboard={traffic?:Traffic;revision:number;layout:Layout;projects:Project[];measuredAt:string;billing:{plan:{id:string;name:string};quota:{allowance:number;available:number;spent:number;reserved:number}};activity:{id:string;project_id:string;summary:string;created_at:string}[];storage:{project_id:string;bytes:number}[];capacity:{preferences:{revision:number;preferred_plan:string;billing_interval:string;draft_overage_cents:number}}};
export type Turn={id:string;user_text:string;assistant_text:string;status:string;[key:string]:unknown};
export type Chat={greeting:string;state:{revision:number;brief_stage?:string};turns:Turn[];stats:{projects:number;live:number;cms_articles?:number};mode:string;usage:{available:number;reserved:number}};
export const message=(error:unknown)=>error instanceof Error?error.message:'This request could not finish.';
