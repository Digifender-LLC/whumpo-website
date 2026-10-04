import type {AppMaintenancePresentation} from '../../../src/app-maintenance-shape';
import type {AppRestorePresentation} from '../../../src/app-restore-review-shape';
import type {AppPageReviewPresentation} from '../../../src/app-page-review-shape';
import type {ApplicationReviewPresentation} from '../../../src/application-review-shape';
import {QueryClient} from '@tanstack/react-query';
import {invalidateIdentity} from './identity-invalidation';
import {supportReference} from './workspace-navigation';
/** `support` is the status reference from the server's content-free support-page link, kept only in the current shape. */
export class APIError extends Error{constructor(message:string,public status:number,public code?:string,public fieldId?:string,public support?:string){super(message)}}
export const queryClient=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:15000,refetchOnWindowFocus:false},mutations:{retry:false}}});
let workspaceGeneration=0;
export function resetWorkspaceClient(){workspaceGeneration++;window.dispatchEvent(new Event('whumpo:workspace-reset'));queryClient.clear();}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{const generation=workspaceGeneration;const response=await fetch('/api'+path,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...options.headers}});const data=await response.json();if(generation!==workspaceGeneration)throw new APIError('Account access changed. Check your current workspace.',401);if(!response.ok){if(['proof_required','identity_changed','identity_incomplete'].includes(data.code))invalidateIdentity(true);throw new APIError(data.error??'This request could not finish.',response.status,typeof data.code==='string'?data.code:undefined,typeof data.fieldId==='string'?data.fieldId:undefined,supportReference(data.support)??undefined);}if(path==='/profile')requireCurrentAccountIdentity(data);return data;}
export function requireCurrentAccountIdentity(value:unknown):asserts value is {accountId:string}{
 if(!value||typeof value!=='object'||Array.isArray(value)||!('accountId'in value)||typeof value.accountId!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value.accountId))throw new APIError('Whumpo needs its current account response. Refresh the app and try again.',409);
}
export const send=<T>(path:string,body:unknown={},method='POST')=>api<T>(path,{method,body:JSON.stringify(body)});
export type Profile={accountId:string;revision:number;avatar_id:string;onboardingComplete:boolean;name:string;about_me:string;email:string;share_context:number;measurement_consent:number;theme:string;hasPhoto:number;photoSafety?:'none'|'pending'|'approved'|'blocked'};
export type Project={id:string;name:string;status:string;purpose:string;cms_articles:number};
export type Layout=import('../../../src/workspace-view-contract').WorkspaceLayout;
export type Traffic={enabledAt:string|null;days:number;rows:{project_id:string;day:string;requests:number}[];metric:string;telemetry?:import('../../../src/site-diagnostics-shape').TrafficTelemetry};
export type Dashboard={traffic?:Traffic;revision:number;layout:Layout;projects:Project[];measuredAt:string;billing:{plan:{id:string;name:string}};activity:{id:string;project_id:string;summary:string;created_at:string}[];storage:{project_id:string;bytes:number}[];capacity:{preferences:{revision:number;preferred_plan:string;billing_interval:string;draft_overage_cents:number}}};
export type Turn={interaction_id?:string;github_grant_review?:import('../../../src/github-grant-shape').GitHubGrantReview;app_maintenance_review?:AppMaintenancePresentation;app_restore_review?:AppRestorePresentation;app_page_review?:AppPageReviewPresentation;application_review?:ApplicationReviewPresentation;id:string;revision:number;user_text:string;action_json:string|null;assistant_text:string;status:string;[key:string]:unknown};
export type Chat={firstDraft?:{id:string;name:string;purpose:string;preferred_theme:string}|null;greeting:string;state:{revision:number};turns:Turn[];stats:{projects:number;live:number;cms_articles?:number};mode:string};
export const message=(error:unknown)=>error instanceof Error?error.message:'This request could not finish.';
